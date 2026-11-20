import { buildCronContext } from 'deepspace/worker'
import type { Job, JobContext } from 'deepspace/worker'
import type { Env } from '../worker'
import { assert } from './lib/assert'
import {
  buildLiveSearchQuery,
  parseExaShoppingResults,
  parseSerpApiShoppingResults,
  selectBestLiveSwap,
  type LiveShoppingCandidate,
} from './lib/live-price-matcher'
import {
  DEFAULT_STORES,
  regionalCacheKey,
  resolveRetailerUrl,
  storeMatchesAllowed,
} from './lib/locality'
import { parsePriceToCents } from './lib/money'

interface MissItem {
  lineId: string
  skuKey: string
  normalizedName: string
  category: string
  unitPriceCents: number
  storeName?: string
}

interface EnrichPayload {
  householdId: string
  receiptScanId: string
  misses: MissItem[]
  allowedStores?: string[]
  zipCode?: string
  locationLabel?: string
}

interface AmazonProduct {
  title: string
  link: string
  price: string
  image: string
  rating?: string | number
  snapEligible: boolean
}

const AMAZON_CATEGORIES = new Set(['Household', 'Pantry', 'Breakfast', 'Beverages', 'Snacks'])
const BATCH_CONCURRENCY = 5
const MISSES_MAX = 80

async function upsertCache(
  cronCtx: ReturnType<typeof buildCronContext>,
  skuKey: string,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    const existing = (await cronCtx.records.query('sku_swap_cache', {
      where: { skuKey },
      limit: 1,
    })) as unknown as Array<{ recordId: string }>
    if (existing[0]?.recordId) {
      await cronCtx.records.update('sku_swap_cache', existing[0].recordId, data)
    } else {
      await cronCtx.records.create('sku_swap_cache', { skuKey, ...data })
    }
  } catch {
    // Best-effort cache write; never block updating the user's receipt line.
  }
}

const GROCERY_EXA_DOMAINS = [
  'walmart.com',
  'target.com',
  'aldi.us',
  'instacart.com',
  'amazon.com',
  'costco.com',
  'samsclub.com',
  'kroger.com',
  'heb.com',
  'hy-vee.com',
  'meijer.com',
  'safeway.com',
]

interface ProviderHealth {
  serpExhausted: boolean
  exaExhausted: boolean
}

function isQuotaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  const lower = msg.toLowerCase()
  return (
    msg.includes('429') ||
    lower.includes('run out of searches') ||
    lower.includes('insufficient credits')
  )
}

async function searchExaShopping(
  cronCtx: ReturnType<typeof buildCronContext>,
  query: string,
  health: ProviderHealth,
): Promise<LiveShoppingCandidate[]> {
  if (health.exaExhausted) {
    return []
  }
  try {
    const exaRes = await cronCtx.integrations.call('exa/search', {
      query: `${query} grocery price`,
      numResults: 8,
      type: 'auto',
      includeDomains: GROCERY_EXA_DOMAINS,
      contents: {
        highlights: {
          query: 'price $',
          numSentences: 2,
          highlightsPerUrl: 2,
        },
      },
    })
    return parseExaShoppingResults(exaRes)
  } catch (err) {
    if (isQuotaError(err)) {
      health.exaExhausted = true
      console.warn('[enrich] Exa credits/quota exhausted — tripping circuit breaker')
    } else {
      console.warn('[enrich] Exa shopping search failed:', err)
    }
    return []
  }
}

async function searchGoogleShopping(
  cronCtx: ReturnType<typeof buildCronContext>,
  query: string,
  location: string,
  health: ProviderHealth,
): Promise<LiveShoppingCandidate[]> {
  if (!health.serpExhausted) {
    try {
      const serp = await cronCtx.integrations.call('serpapi/search', {
        engine: 'google_shopping',
        q: query,
        num: 12,
        location,
      })
      const parsed = parseSerpApiShoppingResults(serp)
      if (parsed.length > 0) {
        return parsed
      }
    } catch (err) {
      if (isQuotaError(err)) {
        health.serpExhausted = true
        console.warn('[enrich] SerpApi quota exhausted — tripping circuit breaker')
      } else {
        console.warn('[enrich] Google Shopping failed, falling back to Exa:', err)
      }
    }
  }

  return searchExaShopping(cronCtx, query, health)
}

async function fetchCandidatesForMiss(
  cronCtx: ReturnType<typeof buildCronContext>,
  miss: MissItem,
  options: { amazonAllowed: boolean; location: string; health: ProviderHealth },
): Promise<LiveShoppingCandidate[]> {
  const query = buildLiveSearchQuery(miss.normalizedName)
  const candidates: LiveShoppingCandidate[] = []
  const tasks: Promise<void>[] = []

  const tryAmazon =
    options.amazonAllowed && AMAZON_CATEGORIES.has(miss.category) && !options.health.serpExhausted
  if (tryAmazon) {
    tasks.push(
      cronCtx.integrations
        .call('amazon/search-products', { query: `amazon fresh ${query}`.slice(0, 90), limit: 5 })
        .then((res) => {
          for (const product of (res as { products?: AmazonProduct[] })?.products ?? []) {
            const priceCents = parsePriceToCents(product.price)
            if (priceCents && priceCents > 0) {
              candidates.push({
                title: product.title.slice(0, 190),
                merchant: 'Amazon',
                priceCents,
                url: product.link,
                imageUrl: product.image,
                rating: product.rating != null ? String(product.rating) : undefined,
                snapEligible: Boolean(product.snapEligible),
              })
            }
          }
        })
        .catch((err) => {
          if (isQuotaError(err)) {
            options.health.serpExhausted = true
          } else {
            console.warn('[enrich] Amazon lookup failed:', err)
          }
        }),
    )
  }

  tasks.push(
    searchGoogleShopping(cronCtx, query, options.location, options.health).then((results) => {
      candidates.push(...results)
    }),
  )

  await Promise.all(tasks)
  return candidates
}

async function enrichSingleMiss(
  cronCtx: ReturnType<typeof buildCronContext>,
  miss: MissItem,
  options: {
    allowedStores: string[]
    amazonAllowed: boolean
    location: string
    zipCode: string
    health: ProviderHealth
  },
): Promise<boolean> {
  const candidates = await fetchCandidatesForMiss(cronCtx, miss, options)
  const best = selectBestLiveSwap(miss, candidates, options.allowedStores)

  if (!best) {
    await cronCtx.records.update('receipt_lines', miss.lineId, {
      swapStatus: 'no_swap',
      swapName: '',
      swapPriceCents: 0,
      savingsCents: 0,
      retailer: '',
      retailerUrl: '',
      snapEligible: 0,
      swapSource: 'none',
    })
    return false
  }

  const isAmazon = best.retailer.toLowerCase().includes('amazon')
  const retailerUrl = resolveRetailerUrl(best.retailer, best.swapName, best.retailerUrl)
  const cacheKey = isAmazon ? miss.skuKey : regionalCacheKey(miss.skuKey, options.zipCode)

  await Promise.all([
    upsertCache(cronCtx, cacheKey, {
      canonicalName: miss.normalizedName,
      category: miss.category,
      typicalPriceCents: miss.unitPriceCents,
      genericAlternativeName: best.swapName,
      genericPriceCents: best.swapPriceCents,
      savingsCents: best.savingsCents,
      retailer: best.retailer,
      retailerUrl,
      imageUrl: best.imageUrl ?? '',
      rating: best.rating ?? '',
      snapEligible: best.snapEligible ? 1 : 0,
      source: isAmazon ? 'amazon_live' : 'google_shopping_live',
      hitCount: 1,
      refreshedAt: new Date().toISOString(),
    }),
    cronCtx.records.update('receipt_lines', miss.lineId, {
      swapStatus: 'matched',
      swapName: best.swapName,
      swapPriceCents: best.swapPriceCents,
      savingsCents: best.savingsCents,
      retailer: best.retailer,
      retailerUrl,
      snapEligible: best.snapEligible ? 1 : 0,
      swapSource: isAmazon ? 'amazon_job' : 'google_shopping_job',
    }),
  ])
  return true
}

export async function runJob(job: Job, ctx: JobContext, env: Env): Promise<unknown> {
  assert(job.type === 'enrich-unknown-skus', `Unknown job type: ${job.type}`)

  const payload = job.payload as EnrichPayload
  const misses = (payload.misses ?? []).slice(0, MISSES_MAX)
  if (misses.length === 0) {
    return { enriched: 0, totalAddedSavingsCents: 0 }
  }

  const zipCode = payload.zipCode ?? ''
  const location = payload.locationLabel || 'United States'
  const allowedStores = payload.allowedStores?.length ? payload.allowedStores : DEFAULT_STORES
  const amazonAllowed = storeMatchesAllowed('Amazon', allowedStores)
  const cronCtx = buildCronContext(env, env.OWNER_USER_ID, `app:${env.DEEPSPACE_APP_ID}`)

  let enriched = 0
  let completed = 0
  const health: ProviderHealth = { serpExhausted: false, exaExhausted: false }

  for (let idx = 0; idx < misses.length; idx += BATCH_CONCURRENCY) {
    if (ctx.signal.aborted || (health.serpExhausted && health.exaExhausted)) {
      const remaining = misses.slice(idx)
      await Promise.all(
        remaining.map((miss) =>
          cronCtx.records.update('receipt_lines', miss.lineId, {
            swapStatus: 'no_swap',
            swapSource: 'none',
          }),
        ),
      )
      break
    }
    const batch = misses.slice(idx, idx + BATCH_CONCURRENCY)
    const outcomes = await Promise.all(
      batch.map((miss) =>
        enrichSingleMiss(cronCtx, miss, {
          allowedStores,
          amazonAllowed,
          location,
          zipCode,
          health,
        }),
      ),
    )
    enriched += outcomes.filter(Boolean).length
    completed += batch.length
    ctx.progress(
      Math.max(0.05, completed / misses.length),
      `Checked ${completed}/${misses.length} items...`,
    )
  }

  const allLines = (await cronCtx.records.query('receipt_lines', {
    where: { householdId: payload.householdId, receiptScanId: payload.receiptScanId },
    limit: 100,
  })) as unknown as Array<{ data: { savingsCents?: number; quantity?: number } }>

  const totalSavings = allLines.reduce((acc, row) => {
    const unit = Math.max(0, Number(row.data.savingsCents ?? 0))
    const qty = Math.max(1, Math.round(Number(row.data.quantity ?? 1)))
    return acc + unit * qty
  }, 0)

  await cronCtx.records.update('receipt_scans', payload.receiptScanId, {
    potentialSavingsCents: totalSavings,
  })
  ctx.progress(1, `Verified live prices for ${misses.length} items (${enriched} swaps found)`)
  return { enriched, missesCount: misses.length, totalAddedSavingsCents: totalSavings }
}
