import { enqueueJob } from 'deepspace/worker'
import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import { storeMatchesAllowed } from '../lib/locality'
import { computeSavingsCents } from '../lib/money'
import { normalizeSkuKey } from '../lib/sku-normalize'
import { processReceiptInputSchema, type ExtractedReceipt } from '../lib/zod-schemas'
import type { ReceiptLineData } from '../schemas/receipt-lines-schema'
import type { SkuSwapCacheData } from '../schemas/sku-swap-cache-schema'
import {
  ensureCallerHouseholdId,
  ensureStarterCacheSeeded,
  extractRecord,
  extractRecords,
  getCallerHouseholdId,
  getHouseholdLocality,
} from './helpers'
import { extractReceiptWithAI, findCacheMatch, parsePlainTextReceipt } from './receipt-parser'

export const receiptActions: Record<string, ActionHandler<Env>> = {
  seedDemoCache: async ({ tools }) => {
    const seeded = await ensureStarterCacheSeeded(tools)
    return { success: true, data: { seeded } }
  },

  processReceipt: async ({ userId, params, tools, env }) => {
    const parsed = processReceiptInputSchema.safeParse(params)
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid receipt payload' }
    }

    const householdId = await ensureCallerHouseholdId(tools, userId)

    // Prevent importing the same Gmail receipt twice
    if (parsed.data.emailMessageId) {
      const dupRes = await tools.query('receipt_scans', {
        where: { householdId, emailMessageId: parsed.data.emailMessageId },
        limit: 1,
      })
      if (extractRecords(dupRes).length > 0) {
        return {
          success: false,
          code: 'duplicate_email_receipt',
          error: 'This email receipt has already been imported into your household.',
        }
      }
    }

    await ensureStarterCacheSeeded(tools)

    let extracted: ExtractedReceipt | null = null
    let llmError: string | null = null
    const isRealGmailEmail =
      parsed.data.source === 'gmail' &&
      !(parsed.data.emailMessageId ?? '').startsWith('sample_')

    if (isRealGmailEmail) {
      try {
        extracted = await extractReceiptWithAI(env, parsed.data.receiptText)
      } catch (err) {
        llmError = err instanceof Error ? err.message : 'AI extraction failed'
        extracted = parsePlainTextReceipt(parsed.data.receiptText)
      }
    } else {
      extracted = parsePlainTextReceipt(parsed.data.receiptText)
      if (!extracted) {
        try {
          extracted = await extractReceiptWithAI(env, parsed.data.receiptText)
        } catch (err) {
          llmError = err instanceof Error ? err.message : 'AI extraction failed'
        }
      }
    }

    if (!extracted || extracted.lines.length === 0) {
      return {
        success: false,
        error: llmError
          ? `AI receipt parser error: ${llmError}`
          : 'No itemized grocery lines found in this receipt.',
      }
    }

    const [cacheRes, locality] = await Promise.all([
      tools.query('sku_swap_cache', { limit: 250 }),
      getHouseholdLocality(tools, householdId),
    ])
    const cacheRows = extractRecords<SkuSwapCacheData>(cacheRes)

    const receiptScanId = `rcpt_${crypto.randomUUID().slice(0, 12)}`
    const now = new Date().toISOString()

    let cacheHits = 0
    let cacheMisses = 0
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

    for (const line of extracted.lines) {
      const skuKey = normalizeSkuKey(line.normalizedName)
      const lineId = `line_${crypto.randomUUID().slice(0, 12)}`
      const rawCached = findCacheMatch(skuKey, cacheRows)
      const cached =
        rawCached &&
        rawCached.data.source !== 'ai_estimate' &&
        storeMatchesAllowed(rawCached.data.retailer, locality.allowedStores)
          ? rawCached
          : null

      if (cached) {
        const savings = computeSavingsCents(line.unitPriceCents, cached.data.genericPriceCents)
        if (savings > 0) {
          cacheHits++
          potentialSavingsCents += savings * Math.max(1, Math.round(line.quantity))
          await tools.update('sku_swap_cache', cached.recordId, {
            hitCount: (cached.data.hitCount ?? 0) + 1,
          })
          pendingLines.push({
            id: lineId,
            data: {
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
              swapStatus: 'matched',
              swapName: cached.data.genericAlternativeName,
              swapPriceCents: cached.data.genericPriceCents,
              savingsCents: savings,
              retailer: cached.data.retailer,
              retailerUrl: cached.data.retailerUrl,
              snapEligible: cached.data.snapEligible ? 1 : 0,
              swapSource: 'cache',
            },
          })
          continue
        }
      }

      const shouldLookup = line.unitPriceCents >= 125
      if (shouldLookup) {
        cacheMisses++
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
        data: {
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
          swapStatus: shouldLookup ? 'pending' : 'no_swap',
          swapPriceCents: 0,
          savingsCents: 0,
          snapEligible: 0,
          swapSource: 'none',
        },
      })
    }

    let enrichmentJobId: string | undefined
    if (misses.length > 0) {
      try {
        enrichmentJobId = await enqueueJob(
          env.JOB_ROOMS,
          `app:${env.DEEPSPACE_APP_ID}`,
          'enrich-unknown-skus',
          {
            householdId,
            receiptScanId,
            misses,
            allowedStores: locality.allowedStores,
            zipCode: locality.zipCode,
            hasPrime: locality.hasPrime,
          },
        )
      } catch (err) {
        console.warn('[processReceipt] Failed to enqueue enrich-unknown-skus job:', err)
      }
    }

    const scanRes = await tools.create(
      'receipt_scans',
      {
        householdId,
        storeName: extracted.storeName,
        purchasedAt: extracted.purchasedAt,
        subtotalCents: extracted.subtotalCents,
        totalCents: extracted.totalCents,
        potentialSavingsCents,
        source: parsed.data.source,
        emailMessageId: parsed.data.emailMessageId ?? '',
        lineCount: pendingLines.length,
        cacheHits,
        cacheMisses,
        enrichmentJobId: enrichmentJobId ?? '',
        scannedBy: userId,
        scannedAt: now,
      },
      receiptScanId,
    )
    if (!scanRes.success) return scanRes

    for (const item of pendingLines) {
      await tools.create(
        'receipt_lines',
        { ...item.data } as unknown as Record<string, unknown>,
        item.id,
      )
    }

    return {
      success: true,
      data: {
        receiptScanId,
        storeName: extracted.storeName,
        lineCount: pendingLines.length,
        cacheHits,
        cacheMisses,
        potentialSavingsCents,
        enrichmentJobId,
      },
    }
  },

  deleteReceipt: async ({ userId, params, tools }) => {
    const receiptScanId = typeof params.receiptScanId === 'string' ? params.receiptScanId : ''
    if (!receiptScanId) return { success: false, error: 'Missing receiptScanId' }

    const householdId = await getCallerHouseholdId(tools, userId)
    if (!householdId) return { success: false, error: 'Household not found' }

    const scanRes = await tools.get('receipt_scans', receiptScanId)
    if (!scanRes.success) return scanRes
    const record = extractRecord<{ householdId: string }>(scanRes)
    if (!record || record.data.householdId !== householdId) {
      return { success: false, error: 'Receipt not found in your household' }
    }

    await tools.deleteWhere('receipt_lines', { householdId, receiptScanId })
    return tools.remove('receipt_scans', receiptScanId)
  },

  recheckReceiptSwaps: async ({ userId, params, tools, env }) => {
    const receiptScanId = typeof params.receiptScanId === 'string' ? params.receiptScanId : ''
    if (!receiptScanId) return { success: false, error: 'Missing receiptScanId' }

    const householdId = await getCallerHouseholdId(tools, userId)
    if (!householdId) return { success: false, error: 'Household not found' }

    const linesRes = await tools.query('receipt_lines', {
      where: { householdId, receiptScanId },
      limit: 100,
    })
    const misses = extractRecords<ReceiptLineData>(linesRes)
      .filter((r) => r.data.unitPriceCents >= 125 && r.data.swapStatus !== 'accepted')
      .map((r) => ({
        lineId: r.recordId,
        skuKey: r.data.skuKey,
        normalizedName: r.data.normalizedName,
        category: r.data.category,
        unitPriceCents: r.data.unitPriceCents,
        storeName: r.data.storeName,
      }))

    if (misses.length === 0) {
      return { success: true, data: { queued: 0 } }
    }

    for (const m of misses) {
      await tools.update('receipt_lines', m.lineId, {
        swapStatus: 'pending',
        swapName: '',
        swapPriceCents: 0,
        savingsCents: 0,
        retailer: '',
        retailerUrl: '',
        swapSource: 'none',
      })
    }

    const locality = await getHouseholdLocality(tools, householdId)
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
        hasPrime: locality.hasPrime,
      },
    )
    return { success: true, data: { queued: misses.length, jobId } }
  },
}
