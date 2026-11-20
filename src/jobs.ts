/**
 * Durable background-job handler — invoked by AppJobRoom (worker.ts).
 *
 * `enrich-unknown-skus`:
 * Live two-source price verification for cache misses (zero LLM price guessing):
 * 1. Shelf-stable pantry/household items try `amazon/search-products` when Amazon
 *    is enabled in the household's nearby stores.
 * 2. Every item without a live Amazon beat runs `serpapi/search` with
 *    `engine: "google_shopping"` localized to the user's ZIP region to fetch
 *    real live prices from nearby stores (Aldi, Walmart, Target, Cub, Costco, etc.).
 *
 * Only listings that pass apples-to-apples size, dietary/lean parity, token
 * relevance, and nearby-store checks are saved. If no live listing beats what
 * the user paid, the item is marked `no_swap`.
 */

import { buildCronContext } from 'deepspace/worker'
import type { Job, JobContext } from 'deepspace/worker'
import type { Env } from '../worker'
import {
  buildLiveSearchQuery,
  parseSerpApiShoppingResults,
  selectBestLiveSwap,
  type LiveShoppingCandidate,
} from './lib/live-price-matcher'
import {
  getRegionalStoresForZip,
  resolveRetailerUrl,
  storeMatchesAllowed,
  zipToGoogleLocation,
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
  hasPrime?: boolean
}

interface AmazonProduct {
  title: string
  link: string
  price: string
  image: string
  rating?: string | number
  snapEligible: boolean
}

const AMAZON_FRIENDLY_CATEGORIES = new Set(['Household', 'Pantry', 'Breakfast', 'Beverages', 'Snacks'])

async function upsertCacheSwap(
  cronCtx: ReturnType<typeof buildCronContext>,
  skuKey: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const existing = (await cronCtx.records.query('sku_swap_cache', {
      where: { skuKey },
      limit: 1,
    })) as unknown as Array<{ recordId: string }>
    if (existing[0]?.recordId) {
      await cronCtx.records.update('sku_swap_cache', existing[0].recordId, payload)
    } else {
      await cronCtx.records.create('sku_swap_cache', { skuKey, ...payload })
    }
  } catch {
    // Cache write is best-effort; never block updating the user's receipt line
  }
}

export async function runJob(
  job: Job,
  ctx: JobContext,
  env: Env,
): Promise<unknown> {
  if (job.type !== 'enrich-unknown-skus') {
    throw new Error(`Unknown job type: ${job.type}`)
  }

  const payload = job.payload as EnrichPayload
  const misses = payload.misses ?? []
  if (misses.length === 0) return { enriched: 0, totalAddedSavingsCents: 0 }

  const zipCode = payload.zipCode ?? ''
  const allowedStores =
    payload.allowedStores && payload.allowedStores.length > 0
      ? payload.allowedStores
      : getRegionalStoresForZip(zipCode)
  const amazonAllowed = storeMatchesAllowed('Amazon', allowedStores)
  const googleLocation = zipToGoogleLocation(zipCode)

  const cronCtx = buildCronContext(env, env.OWNER_USER_ID, `app:${env.DEEPSPACE_APP_ID}`)
  let enriched = 0
  let totalAddedSavingsCents = 0

  for (let i = 0; i < misses.length; i++) {
    if (ctx.signal.aborted) break
    const miss = misses[i]
    const searchQuery = buildLiveSearchQuery(miss.normalizedName)
    const candidates: LiveShoppingCandidate[] = []
    let matchedSource: 'amazon_job' | 'google_shopping_job' = 'google_shopping_job'

    ctx.progress(
      Math.max(0.05, i / misses.length),
      `Checking live prices for ${miss.normalizedName}...`,
    )

    // Source 1: Live Amazon product search on shelf-stable items when Amazon is enabled
    if (amazonAllowed && AMAZON_FRIENDLY_CATEGORIES.has(miss.category)) {
      try {
        const searchRes = (await cronCtx.integrations.call('amazon/search-products', {
          query: `amazon fresh ${searchQuery}`.slice(0, 90),
          limit: 5,
        })) as { products?: AmazonProduct[] }

        for (const product of searchRes?.products ?? []) {
          const priceCents = parsePriceToCents(product.price)
          if (!priceCents || priceCents <= 0) continue
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
      } catch (err) {
        console.warn('[enrich-unknown-skus] Amazon lookup failed:', err)
      }
    }

    // Source 2: Live Google Shopping search localized to the user's region
    try {
      const serpRes = await cronCtx.integrations.call('serpapi/search', {
        engine: 'google_shopping',
        q: searchQuery,
        num: 12,
        location: googleLocation,
      })
      const shoppingCandidates = parseSerpApiShoppingResults(serpRes)
      candidates.push(...shoppingCandidates)
    } catch (err) {
      console.warn('[enrich-unknown-skus] Google Shopping lookup failed:', err)
    }

    const best = selectBestLiveSwap(
      {
        normalizedName: miss.normalizedName,
        unitPriceCents: miss.unitPriceCents,
        storeName: miss.storeName,
      },
      candidates,
      allowedStores,
    )

    if (best) {
      const isAmazon = best.retailer.toLowerCase().includes('amazon')
      matchedSource = isAmazon ? 'amazon_job' : 'google_shopping_job'
      const retailerUrl = resolveRetailerUrl(best.retailer, best.swapName, best.retailerUrl)
      const now = new Date().toISOString()

      await upsertCacheSwap(cronCtx, miss.skuKey, {
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
        refreshedAt: now,
      })

      await cronCtx.records.update('receipt_lines', miss.lineId, {
        swapStatus: 'matched',
        swapName: best.swapName,
        swapPriceCents: best.swapPriceCents,
        savingsCents: best.savingsCents,
        retailer: best.retailer,
        retailerUrl,
        snapEligible: best.snapEligible ? 1 : 0,
        swapSource: matchedSource,
      })

      enriched++
      totalAddedSavingsCents += best.savingsCents
    } else {
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
    }
  }

  // Recalculate total savings on the receipt scan cleanly from all its lines
  const allScanLines = (await cronCtx.records.query('receipt_lines', {
    where: { householdId: payload.householdId, receiptScanId: payload.receiptScanId },
    limit: 100,
  })) as unknown as Array<{
    recordId: string
    data: { savingsCents?: number; quantity?: number }
  }>

  const recomputedTotal = allScanLines.reduce(
    (acc, row) =>
      acc +
      Math.max(0, Number(row.data.savingsCents ?? 0)) *
        Math.max(1, Math.round(Number(row.data.quantity ?? 1))),
    0,
  )

  await cronCtx.records.update('receipt_scans', payload.receiptScanId, {
    potentialSavingsCents: recomputedTotal,
  })

  ctx.progress(1, `Verified live prices for ${misses.length} items (${enriched} cheaper swaps found)`)
  return { enriched, missesCount: misses.length, totalAddedSavingsCents: recomputedTotal }
}
