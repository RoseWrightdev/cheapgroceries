import { buildCronContext, enqueueJob } from 'deepspace/worker'
import type { ActionHandler, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { parseJsonStringArray } from '../lib/email-parser'
import {
  DEFAULT_STORES,
  parseGoogleMapsLocation,
  parseGoogleMapsStores,
  regionalCacheKey,
  storeMatchesAllowed,
} from '../lib/locality'
import { computeSavingsCents } from '../lib/money'
import { extractReceiptWithAI, parsePlainTextReceipt } from '../lib/receipt-parser'
import { normalizeSkuKey } from '../lib/sku-normalize'
import { processReceiptInputSchema, type ExtractedReceipt } from '../lib/zod-schemas'
import type { HouseholdData } from '../schemas/households-schema'
import type { ReceiptLineData } from '../schemas/receipt-lines-schema'
import type { SkuSwapCacheData } from '../schemas/sku-swap-cache-schema'
import type { TeamMemberData } from '../schemas/team-members-schema'

interface RecordEnvelope<T> {
  recordId: string
  data: T
}

interface HouseholdLocality {
  zipCode: string
  locationLabel: string
  allowedStores: string[]
  detectedMemberships: string[]
  hasPrime: boolean
}

const MIN_LOOKUP_PRICE_CENTS = 125
const RECHECK_SCANS_MAX = 1
const LIVE_DEALS_STORES_MAX = 3

function getRecords<T>(res: { success: boolean; data?: unknown }): RecordEnvelope<T>[] {
  if (!res.success || !res.data) {
    return []
  }
  const records = (res.data as { records?: unknown }).records
  return Array.isArray(records) ? (records as RecordEnvelope<T>[]) : []
}

function getRecord<T>(res: { success: boolean; data?: unknown }): RecordEnvelope<T> | null {
  if (!res.success || !res.data) {
    return null
  }
  const record = (res.data as { record?: unknown }).record
  return record && typeof record === 'object' ? (record as RecordEnvelope<T>) : null
}

async function ensureHouseholdId(tools: ActionTools, userId: string): Promise<string> {
  const rows = getRecords<TeamMemberData>(
    await tools.query('team_members', { where: { userId, status: 'active' }, limit: 1 }),
  )
  if (rows[0]?.data.teamId) {
    return rows[0].data.teamId
  }

  const householdId = `hh_${crypto.randomUUID().slice(0, 12)}`
  const now = new Date().toISOString()
  await Promise.all([
    tools.create(
      'households',
      {
        householdId,
        name: 'My Groceries',
        inviteCode: householdId.slice(-6).toUpperCase(),
        ownerId: userId,
        monthlyBudgetCents: 60000,
        createdAt: now,
      },
      householdId,
    ),
    tools.create('team_members', {
      teamId: householdId,
      userId,
      status: 'active',
      memberRole: 'owner',
      joinedAt: now,
    }),
    tools.update('users', userId, { householdId }),
  ])
  return householdId
}

async function getLocality(tools: ActionTools, householdId: string): Promise<HouseholdLocality> {
  const rec = getRecord<HouseholdData>(await tools.get('households', householdId))
  const zipCode = rec?.data.zipCode ?? ''
  const stored = parseJsonStringArray(rec?.data.nearbyStores)
  const detectedMemberships = parseJsonStringArray(rec?.data.detectedMemberships)
  const hasPrime =
    rec?.data.hasPrime === 1 ||
    detectedMemberships.some((member) => member.toLowerCase() === 'amazon prime')

  return {
    zipCode,
    locationLabel: rec?.data.locationLabel ?? 'United States',
    allowedStores: stored.length > 0 ? stored : DEFAULT_STORES,
    detectedMemberships,
    hasPrime,
  }
}

async function requeueScanSwaps(
  tools: ActionTools,
  env: Env,
  householdId: string,
  receiptScanId: string,
  locality: Pick<HouseholdLocality, 'zipCode' | 'locationLabel' | 'allowedStores' | 'hasPrime'>,
): Promise<{ queued: number; jobId?: string }> {
  const rows = getRecords<ReceiptLineData>(
    await tools.query('receipt_lines', { where: { householdId, receiptScanId }, limit: 100 }),
  )
  const misses = rows
    .filter(
      (r) => r.data.unitPriceCents >= MIN_LOOKUP_PRICE_CENTS && r.data.swapStatus !== 'accepted',
    )
    .map((r) => ({
      lineId: r.recordId,
      skuKey: r.data.skuKey,
      normalizedName: r.data.normalizedName,
      category: r.data.category,
      unitPriceCents: r.data.unitPriceCents,
      storeName: r.data.storeName,
    }))

  if (misses.length === 0) {
    return { queued: 0 }
  }

  await Promise.all([
    ...misses.map((miss) =>
      tools.update('receipt_lines', miss.lineId, {
        swapStatus: 'pending',
        swapName: '',
        swapPriceCents: 0,
        savingsCents: 0,
        retailer: '',
        retailerUrl: '',
        swapSource: 'none',
      }),
    ),
    tools.update('receipt_scans', receiptScanId, { potentialSavingsCents: 0 }),
  ])

  const jobId = await enqueueJob(
    env.JOB_ROOMS,
    `app:${env.DEEPSPACE_APP_ID}`,
    'enrich-unknown-skus',
    {
      householdId,
      receiptScanId,
      misses,
      allowedStores: locality.allowedStores,
      zipCode: locality.zipCode,
      locationLabel: locality.locationLabel,
      hasPrime: locality.hasPrime,
    },
  )
  return { queued: misses.length, jobId }
}

async function parseIncomingReceipt(
  env: Env,
  source: 'gmail' | 'text',
  receiptText: string,
): Promise<{ extracted: ExtractedReceipt | null; llmError: string | null }> {
  if (source === 'gmail') {
    try {
      return { extracted: await extractReceiptWithAI(env, receiptText), llmError: null }
    } catch (err) {
      const llmError = err instanceof Error ? err.message : 'AI extraction failed'
      return { extracted: parsePlainTextReceipt(receiptText), llmError }
    }
  }

  const plain = parsePlainTextReceipt(receiptText)
  if (plain) {
    return { extracted: plain, llmError: null }
  }
  try {
    return { extracted: await extractReceiptWithAI(env, receiptText), llmError: null }
  } catch (err) {
    const llmError = err instanceof Error ? err.message : 'AI extraction failed'
    return { extracted: null, llmError }
  }
}

async function lookupCachedSwap(
  tools: ActionTools,
  skuKey: string,
  locality: HouseholdLocality,
): Promise<RecordEnvelope<SkuSwapCacheData> | null> {
  const regKey = regionalCacheKey(skuKey, locality.zipCode)
  const regHit = getRecords<SkuSwapCacheData>(
    await tools.query('sku_swap_cache', { where: { skuKey: regKey }, limit: 1 }),
  )[0]
  if (
    regHit &&
    regHit.data.source !== 'ai_estimate' &&
    storeMatchesAllowed(regHit.data.retailer, locality.allowedStores)
  ) {
    return regHit
  }
  if (regKey === skuKey) {
    return null
  }
  const globalHit = getRecords<SkuSwapCacheData>(
    await tools.query('sku_swap_cache', { where: { skuKey }, limit: 1 }),
  )[0]
  if (
    globalHit?.data.source === 'amazon_live' &&
    storeMatchesAllowed(globalHit.data.retailer, locality.allowedStores)
  ) {
    return globalHit
  }
  return null
}

function createBaseLine(
  householdId: string,
  receiptScanId: string,
  extracted: ExtractedReceipt,
  line: ExtractedReceipt['lines'][number],
  skuKey: string,
): ReceiptLineData {
  return {
    householdId,
    receiptScanId,
    storeName: extracted.storeName,
    purchasedAt: extracted.purchasedAt,
    rawText: line.rawText,
    normalizedName: line.normalizedName,
    skuKey,
    category: line.category,
    quantity: line.quantity,
    unitPriceCents: line.unitPriceCents,
    lineTotalCents: line.lineTotalCents,
    isNameBrand: line.isNameBrand ? 1 : 0,
    swapStatus: 'no_swap',
    swapPriceCents: 0,
    savingsCents: 0,
    snapEligible: 0,
    swapSource: 'none',
  }
}

function buildPendingLines(
  householdId: string,
  receiptScanId: string,
  extracted: ExtractedReceipt,
  lookups: Array<{
    line: ExtractedReceipt['lines'][number]
    skuKey: string
    cached: RecordEnvelope<SkuSwapCacheData> | null
  }>,
) {
  let cacheHits = 0
  let potentialSavingsCents = 0
  const misses: Array<{
    lineId: string
    skuKey: string
    normalizedName: string
    category: string
    unitPriceCents: number
    storeName: string
  }> = []
  const pendingLines: Array<{ id: string; data: ReceiptLineData }> = []

  for (const { line, skuKey, cached } of lookups) {
    const lineId = `line_${crypto.randomUUID().slice(0, 12)}`
    const base = createBaseLine(householdId, receiptScanId, extracted, line, skuKey)
    const cachedSavings = cached
      ? computeSavingsCents(line.unitPriceCents, cached.data.genericPriceCents)
      : 0

    if (cached && cachedSavings > 0) {
      cacheHits++
      potentialSavingsCents += cachedSavings * Math.max(1, Math.round(line.quantity))
      pendingLines.push({
        id: lineId,
        data: {
          ...base,
          swapStatus: 'matched',
          swapName: cached.data.genericAlternativeName,
          swapPriceCents: cached.data.genericPriceCents,
          savingsCents: cachedSavings,
          retailer: cached.data.retailer,
          retailerUrl: cached.data.retailerUrl,
          snapEligible: cached.data.snapEligible ? 1 : 0,
          swapSource: 'cache',
        },
      })
      continue
    }

    const shouldLookup = line.unitPriceCents >= MIN_LOOKUP_PRICE_CENTS
    if (shouldLookup) {
      misses.push({
        lineId,
        skuKey,
        normalizedName: line.normalizedName,
        category: line.category,
        unitPriceCents: line.unitPriceCents,
        storeName: extracted.storeName,
      })
    }
    pendingLines.push({
      id: lineId,
      data: { ...base, swapStatus: shouldLookup ? 'pending' : 'no_swap' },
    })
  }

  return { cacheHits, potentialSavingsCents, misses, pendingLines }
}

async function discoverNearbyStores(
  env: Env,
  zipCode: string,
  fallbackStores: string[],
  fallbackLocation: string,
): Promise<{ stores: string[]; locationLabel: string }> {
  try {
    const cronCtx = buildCronContext(env, env.OWNER_USER_ID, `app:${env.DEEPSPACE_APP_ID}`)
    const mapsRes = await cronCtx.integrations.call('serpapi/places-search', {
      q: `grocery stores near ${zipCode}`,
    })
    const discovered = parseGoogleMapsStores(mapsRes)
    return {
      stores: discovered.length > 0 ? discovered : fallbackStores,
      locationLabel: parseGoogleMapsLocation(mapsRes),
    }
  } catch (err) {
    console.warn('[updateHouseholdLocality] Google Maps failed:', err)
    return { stores: fallbackStores, locationLabel: fallbackLocation }
  }
}

async function requeueRecentScans(
  tools: ActionTools,
  env: Env,
  householdId: string,
  locality: Pick<HouseholdLocality, 'zipCode' | 'locationLabel' | 'allowedStores' | 'hasPrime'>,
): Promise<number> {
  const scans = getRecords<{ householdId: string }>(
    await tools.query('receipt_scans', {
      where: { householdId },
      orderBy: 'scannedAt',
      orderDir: 'desc',
      limit: RECHECK_SCANS_MAX,
    }),
  )
  let totalQueued = 0
  for (const scan of scans) {
    try {
      const out = await requeueScanSwaps(tools, env, householdId, scan.recordId, locality)
      totalQueued += out.queued
    } catch (err) {
      console.warn('[updateHouseholdLocality] Requeue failed:', err)
    }
  }
  return totalQueued
}

async function enqueueReceiptEnrichment(
  env: Env,
  payload: Record<string, unknown>,
): Promise<string> {
  try {
    return await enqueueJob(
      env.JOB_ROOMS,
      `app:${env.DEEPSPACE_APP_ID}`,
      'enrich-unknown-skus',
      payload,
    )
  } catch (err) {
    console.warn('[processReceipt] Failed to enqueue job:', err)
    return ''
  }
}

async function persistReceiptRecords(
  tools: ActionTools,
  args: {
    householdId: string
    receiptScanId: string
    userId: string
    source: 'gmail' | 'text'
    emailMessageId: string
    extracted: ExtractedReceipt
    enrichmentJobId: string
    built: ReturnType<typeof buildPendingLines>
  },
) {
  const scanRes = await tools.create(
    'receipt_scans',
    {
      householdId: args.householdId,
      storeName: args.extracted.storeName,
      purchasedAt: args.extracted.purchasedAt,
      subtotalCents: args.extracted.subtotalCents,
      totalCents: args.extracted.totalCents,
      potentialSavingsCents: args.built.potentialSavingsCents,
      source: args.source,
      emailMessageId: args.emailMessageId,
      lineCount: args.built.pendingLines.length,
      cacheHits: args.built.cacheHits,
      cacheMisses: args.built.misses.length,
      enrichmentJobId: args.enrichmentJobId,
      scannedBy: args.userId,
      scannedAt: new Date().toISOString(),
    },
    args.receiptScanId,
  )
  if (!scanRes.success) {
    return scanRes
  }
  await Promise.all(
    args.built.pendingLines.map((item) =>
      tools.create(
        'receipt_lines',
        { ...item.data } as unknown as Record<string, unknown>,
        item.id,
      ),
    ),
  )
  return scanRes
}

async function isDuplicateEmailReceipt(
  tools: ActionTools,
  householdId: string,
  emailMessageId?: string,
): Promise<boolean> {
  if (!emailMessageId) {
    return false
  }
  const dup = getRecords(
    await tools.query('receipt_scans', { where: { householdId, emailMessageId }, limit: 1 }),
  )
  return dup.length > 0
}

export const actions: Record<string, ActionHandler<Env>> = {
  processReceipt: async ({ userId, params, tools, env }) => {
    const parsed = processReceiptInputSchema.safeParse(params)
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid receipt' }
    }

    const householdId = await ensureHouseholdId(tools, userId)
    if (await isDuplicateEmailReceipt(tools, householdId, parsed.data.emailMessageId)) {
      return { success: false, code: 'duplicate_email_receipt', error: 'Already imported.' }
    }

    const { extracted, llmError } = await parseIncomingReceipt(
      env,
      parsed.data.source,
      parsed.data.receiptText,
    )
    if (!extracted || extracted.lines.length === 0) {
      const msg = llmError ? `Parser error: ${llmError}` : 'No itemized grocery lines found.'
      return { success: false, error: msg }
    }

    const locality = await getLocality(tools, householdId)
    const receiptScanId = `rcpt_${crypto.randomUUID().slice(0, 12)}`
    const lookups = await Promise.all(
      extracted.lines.map(async (line) => {
        const skuKey = normalizeSkuKey(line.normalizedName)
        const cached = await lookupCachedSwap(tools, skuKey, locality)
        return { line, skuKey, cached }
      }),
    )

    const built = buildPendingLines(householdId, receiptScanId, extracted, lookups)
    const enrichmentJobId =
      built.misses.length > 0
        ? await enqueueReceiptEnrichment(env, {
            householdId,
            receiptScanId,
            misses: built.misses,
            allowedStores: locality.allowedStores,
            zipCode: locality.zipCode,
            locationLabel: locality.locationLabel,
            hasPrime: locality.hasPrime,
          })
        : ''

    const scanRes = await persistReceiptRecords(tools, {
      householdId,
      receiptScanId,
      userId,
      source: parsed.data.source,
      emailMessageId: parsed.data.emailMessageId ?? '',
      extracted,
      enrichmentJobId,
      built,
    })
    if (!scanRes.success) {
      return scanRes
    }

    return {
      success: true,
      data: {
        receiptScanId,
        storeName: extracted.storeName,
        lineCount: built.pendingLines.length,
        cacheHits: built.cacheHits,
        cacheMisses: built.misses.length,
        potentialSavingsCents: built.potentialSavingsCents,
        enrichmentJobId,
      },
    }
  },

  deleteReceipt: async ({ userId, params, tools }) => {
    const receiptScanId = typeof params.receiptScanId === 'string' ? params.receiptScanId : ''
    const householdId = await ensureHouseholdId(tools, userId)
    const rec = getRecord<{ householdId: string }>(await tools.get('receipt_scans', receiptScanId))
    if (!receiptScanId || !rec || rec.data.householdId !== householdId) {
      return { success: false, error: 'Receipt not found' }
    }
    await tools.deleteWhere('receipt_lines', { householdId, receiptScanId })
    return tools.remove('receipt_scans', receiptScanId)
  },

  recheckReceiptSwaps: async ({ userId, params, tools, env }) => {
    const receiptScanId = typeof params.receiptScanId === 'string' ? params.receiptScanId : ''
    if (!receiptScanId) {
      return { success: false, error: 'Missing receiptScanId' }
    }
    const householdId = await ensureHouseholdId(tools, userId)
    const locality = await getLocality(tools, householdId)
    const data = await requeueScanSwaps(tools, env, householdId, receiptScanId, locality)
    return { success: true, data }
  },

  updateHouseholdLocality: async ({ userId, params, tools, env }) => {
    const householdId = await ensureHouseholdId(tools, userId)
    const current = await getLocality(tools, householdId)
    const zipCode =
      typeof params.zipCode === 'string'
        ? params.zipCode.replace(/\D/g, '').slice(0, 5)
        : current.zipCode
    const incomingStores = Array.isArray(params.nearbyStores)
      ? params.nearbyStores.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      : []

    let resolvedStores = incomingStores.length > 0 ? incomingStores : current.allowedStores
    let locationLabel = current.locationLabel
    const shouldDiscover =
      incomingStores.length === 0 &&
      zipCode.length === 5 &&
      (zipCode !== current.zipCode || current.allowedStores === DEFAULT_STORES)

    if (shouldDiscover) {
      const discovered = await discoverNearbyStores(env, zipCode, resolvedStores, locationLabel)
      resolvedStores = discovered.stores
      locationLabel = discovered.locationLabel
    }

    const incomingMem = Array.isArray(params.detectedMemberships)
      ? params.detectedMemberships.filter(
          (s): s is string => typeof s === 'string' && s.trim().length > 0,
        )
      : []
    const mergedMemberships = Array.from(new Set([...current.detectedMemberships, ...incomingMem]))
    const hasPrime =
      mergedMemberships.some((m) => m.toLowerCase() === 'amazon prime') ||
      (typeof params.hasPrime === 'boolean' ? params.hasPrime : current.hasPrime)

    const res = await tools.update('households', householdId, {
      zipCode,
      locationLabel,
      nearbyStores: JSON.stringify(resolvedStores),
      detectedMemberships: JSON.stringify(mergedMemberships),
      hasPrime: hasPrime ? 1 : 0,
    })
    if (!res.success) {
      return res
    }

    const requeuedItems =
      params.refreshSwaps === true
        ? await requeueRecentScans(tools, env, householdId, {
            zipCode,
            locationLabel,
            allowedStores: resolvedStores,
            hasPrime,
          })
        : 0

    return {
      success: true,
      data: {
        zipCode,
        nearbyStores: resolvedStores,
        detectedMemberships: mergedMemberships,
        hasPrime,
        requeuedItems,
      },
    }
  },

  fetchLiveStoreDeals: async ({ userId, tools, env }) => {
    const householdId = await ensureHouseholdId(tools, userId)
    const scans = getRecords<{ storeName: string }>(
      await tools.query('receipt_scans', {
        where: { householdId },
        orderBy: 'scannedAt',
        orderDir: 'desc',
        limit: 10,
      }),
    )
    const uniqueStores = Array.from(
      new Set(scans.map((s) => s.data.storeName.trim()).filter(Boolean)),
    ).slice(0, LIVE_DEALS_STORES_MAX)

    if (uniqueStores.length === 0) {
      return { success: true, data: { deals: [] } }
    }

    const cronCtx = buildCronContext(env, env.OWNER_USER_ID, `app:${env.DEEPSPACE_APP_ID}`)
    const results = await Promise.all(
      uniqueStores.map(async (store) => {
        const query = `${store} weekly ad grocery coupons deals this week`
        try {
          const res = (await cronCtx.integrations.call('serpapi/search', {
            engine: 'google',
            q: query,
            num: 3,
          })) as { organic_results?: Array<{ title?: string; snippet?: string; link?: string }> }
          const items = (res?.organic_results ?? [])
            .slice(0, 2)
            .filter((r) => Boolean(r.title && r.link?.startsWith('https://')))
            .map((r) => ({
              store,
              title: (r.title ?? '').slice(0, 140),
              snippet: (r.snippet ?? '').slice(0, 240),
              url: r.link ?? '',
            }))
          if (items.length > 0) {
            return items
          }
        } catch {
          // Fall back to Exa when SerpApi is rate-limited or out of quota.
        }

        try {
          const exa = (await cronCtx.integrations.call('exa/search', {
            query,
            numResults: 2,
            type: 'auto',
            contents: { highlights: { numSentences: 2, highlightsPerUrl: 1 } },
          })) as { results?: Array<{ title?: string; url?: string; highlights?: string[] }> }
          return (exa?.results ?? [])
            .filter((r) => Boolean(r.title && r.url?.startsWith('https://')))
            .map((r) => ({
              store,
              title: (r.title ?? '').slice(0, 140),
              snippet: (r.highlights?.[0] ?? '').slice(0, 240),
              url: r.url ?? '',
            }))
        } catch {
          return []
        }
      }),
    )
    return { success: true, data: { deals: results.flat() } }
  },

  deleteUserData: async ({ userId, tools }) => {
    const memberships = getRecords<TeamMemberData>(
      await tools.query('team_members', { where: { userId }, limit: 20 }),
    )

    for (const member of memberships) {
      const householdId = member.data.teamId
      const hh = getRecord<HouseholdData>(await tools.get('households', householdId))
      if (hh?.data.ownerId === userId) {
        await Promise.all([
          tools.deleteWhere('receipt_lines', { householdId }),
          tools.deleteWhere('receipt_scans', { householdId }),
          tools.deleteWhere('team_members', { teamId: householdId }),
          tools.remove('households', householdId),
        ])
      } else {
        await tools.remove('team_members', member.recordId)
      }
    }

    await tools.update('users', userId, { householdId: '' })
    return { success: true, data: { deleted: true } }
  },
}
