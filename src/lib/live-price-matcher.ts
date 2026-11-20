/**
 * Pure matching + sanity-check helpers for live Google Shopping (`serpapi/search`)
 * and Amazon (`amazon/search-products`) price comparisons.
 *
 * Zero LLM guessing: every returned swap is backed by a live merchant listing
 * that passes unit/size parity, dietary/quality parity, token relevance,
 * nearby-store filtering, and real savings bounds.
 */

import { ALL_KNOWN_STORES, storeMatchesAllowed } from './locality'
import { computeSavingsCents, parsePriceToCents } from './money'

export interface LiveShoppingCandidate {
  title: string
  merchant: string
  priceCents: number
  url: string
  imageUrl?: string
  rating?: string
  snapEligible: boolean
}

export interface MatchedLiveSwap {
  swapName: string
  swapPriceCents: number
  savingsCents: number
  retailer: string
  retailerUrl: string
  imageUrl?: string
  rating?: string
  snapEligible: boolean
}

const STORE_BRAND_STOP_WORDS = new Set([
  'good',
  'gather',
  'market',
  'pantry',
  'favorite',
  'day',
  'up',
  'great',
  'value',
  'kirkland',
  'signature',
  'simply',
  'nature',
  'amazon',
  'fresh',
  'happy',
  'belly',
  '365',
  'whole',
  'foods',
  'target',
  'walmart',
  'aldi',
  'costco',
  'cub',
  'kroger',
  'heb',
  'publix',
  'safeway',
  'meijer',
  'hyvee',
  'trader',
  'joes',
  'the',
  'and',
  'with',
  'for',
  'per',
  'pkg',
  'pack',
  'bag',
  'box',
  'bottle',
  'can',
  'jar',
  'tub',
  'container',
  'count',
  'ct',
  'oz',
  'fl',
  'lb',
  'lbs',
  'ea',
  'each',
])

const STRICT_QUALIFIERS = [
  'organic',
  'grass-fed',
  'grass fed',
  'gluten-free',
  'gluten free',
  'vegan',
  'dairy-free',
  'dairy free',
  'sugar-free',
  'sugar free',
  'zero sugar',
  'decaf',
  'lactose free',
  'lactose-free',
] as const

const DISQUALIFYING_NON_GROCERY = /\b(dog food|cat food|pet|treat|toy|cookbook|shirt|mug|sticker|seed packet|supplement|capsule|powdered)\b/i

/**
 * Strip store-brand prefixes so cross-store searches find true equivalents
 * (e.g. "Good & Gather 93/7 Ground Beef 1 lb" -> "93/7 Ground Beef 1 lb").
 */
export function buildLiveSearchQuery(normalizedName: string): string {
  const cleaned = normalizedName
    .replace(
      /\b(good\s*&\s*gather|market\s+pantry|favorite\s+day|up\s*&\s*up|great\s+value|kirkland\s+signature|simply\s+nature|365\s+by\s+whole\s+foods|amazon\s+fresh|happy\s+belly)\b/gi,
      '',
    )
    .replace(/[™®©]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return (cleaned || normalizedName).slice(0, 95)
}

/**
 * Map a Google Shopping `source` string (e.g. "ALDI via Instacart", "Walmart - Grocery",
 * "Amazon.com") to our canonical local store name, or null if not a known grocery retailer.
 */
export function canonicalizeMerchant(rawSource: string | undefined): string | null {
  if (!rawSource) return null
  const lower = rawSource.toLowerCase()
  const clean = lower.replace(/[^a-z0-9]/g, '')

  for (const known of ALL_KNOWN_STORES) {
    const knownClean = known.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (clean.includes(knownClean)) {
      return known
    }
  }
  if (lower.includes('heb')) return 'H-E-B'
  if (lower.includes('hyvee')) return 'Hy-Vee'
  if (lower.includes('trader joe')) return 'Trader Joe’s'
  return null
}

/**
 * Extract normalized quantity in ounces (weight/volume) or count when present.
 */
export function extractPackMeasure(
  text: string,
): { kind: 'weight_oz' | 'volume_oz' | 'count'; value: number } | null {
  const lower = text.toLowerCase()

  const flOz = lower.match(/(\d+(?:\.\d+)?)\s*fl\.?\s*oz\b/)
  if (flOz) return { kind: 'volume_oz', value: Number.parseFloat(flOz[1]) }

  const gal = lower.match(/(\d+(?:\.\d+)?)\s*(?:gal|gallon)s?\b/)
  if (gal) return { kind: 'volume_oz', value: Number.parseFloat(gal[1]) * 128 }

  const qt = lower.match(/(\d+(?:\.\d+)?)\s*(?:qt|quart)s?\b/)
  if (qt) return { kind: 'volume_oz', value: Number.parseFloat(qt[1]) * 32 }

  const liter = lower.match(/(\d+(?:\.\d+)?)\s*(?:l|liter|litre)s?\b/)
  if (liter) return { kind: 'volume_oz', value: Number.parseFloat(liter[1]) * 33.814 }

  const lb = lower.match(/(\d+(?:\.\d+)?)\s*(?:lb|lbs|pound|pounds)\b/)
  if (lb) return { kind: 'weight_oz', value: Number.parseFloat(lb[1]) * 16 }

  const oz = lower.match(/(\d+(?:\.\d+)?)\s*oz\b/)
  if (oz) return { kind: 'weight_oz', value: Number.parseFloat(oz[1]) }

  const ct = lower.match(/(\d+)\s*(?:ct|count|pack|pk|rolls?|bars?|eggs?|pods?)\b/)
  if (ct) return { kind: 'count', value: Number.parseInt(ct[1], 10) }

  return null
}

function extractCoreTokens(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !/^\d+$/.test(t) && !STORE_BRAND_STOP_WORDS.has(t))
  return new Set(tokens)
}

function extractLeanRatio(text: string): number | null {
  const ratio = text.match(/\b(7[0-9]|8[0-9]|9[0-9])\s*\/\s*0?[1-9][0-9]?\b/)
  if (ratio) return Number.parseInt(ratio[1], 10)
  const pct = text.match(/\b(7[0-9]|8[0-9]|9[0-9])%\s*lean\b/i)
  if (pct) return Number.parseInt(pct[1], 10)
  return null
}

/**
 * Parse raw SerpApi `google_shopping` response into normalized candidates.
 */
export function parseSerpApiShoppingResults(raw: unknown): LiveShoppingCandidate[] {
  if (!raw || typeof raw !== 'object') return []
  const obj = raw as Record<string, unknown>
  const list = Array.isArray(obj.shopping_results)
    ? obj.shopping_results
    : Array.isArray(obj.results)
      ? obj.results
      : []

  const out: LiveShoppingCandidate[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const title = typeof rec.title === 'string' ? rec.title.trim() : ''
    const source =
      typeof rec.source === 'string'
        ? rec.source.trim()
        : typeof rec.merchant === 'string'
          ? rec.merchant.trim()
          : ''

    let priceCents: number | null = null
    if (typeof rec.extracted_price === 'number' && Number.isFinite(rec.extracted_price)) {
      priceCents = Math.round(rec.extracted_price * 100)
    } else if (typeof rec.price === 'string') {
      priceCents = parsePriceToCents(rec.price)
    }

    const url =
      (typeof rec.link === 'string' && rec.link.startsWith('https://') ? rec.link : '') ||
      (typeof rec.product_link === 'string' && rec.product_link.startsWith('https://')
        ? rec.product_link
        : '')

    if (!title || !source || !priceCents || priceCents <= 0) continue

    out.push({
      title: title.slice(0, 190),
      merchant: source,
      priceCents,
      url,
      imageUrl: typeof rec.thumbnail === 'string' ? rec.thumbnail : undefined,
      rating: rec.rating != null ? String(rec.rating) : undefined,
      snapEligible: /\b(ebt|snap)\b/i.test(`${title} ${String(rec.extensions ?? '')}`),
    })
  }
  return out
}

/**
 * Select the single best verified cheaper listing from live candidates.
 * Returns null if no candidate passes apples-to-apples + nearby-store + real-savings checks.
 */
export function selectBestLiveSwap(
  purchased: {
    normalizedName: string
    unitPriceCents: number
    storeName?: string
  },
  candidates: LiveShoppingCandidate[],
  allowedStores: string[],
): MatchedLiveSwap | null {
  const targetTokens = extractCoreTokens(purchased.normalizedName)
  const targetMeasure = extractPackMeasure(purchased.normalizedName)
  const targetLower = purchased.normalizedName.toLowerCase()
  const targetLean = extractLeanRatio(purchased.normalizedName)
  const purchasedStoreClean = (purchased.storeName ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

  let best: MatchedLiveSwap | null = null

  for (const cand of candidates) {
    const retailer = canonicalizeMerchant(cand.merchant)
    if (!retailer) continue
    if (!storeMatchesAllowed(retailer, allowedStores)) continue

    // Sanity price bounds: must save >= $0.25 and not be a tiny accessory/single-serve packet
    const savingsCents = computeSavingsCents(purchased.unitPriceCents, cand.priceCents)
    if (savingsCents < 25) continue
    if (cand.priceCents < 75 || cand.priceCents < purchased.unitPriceCents * 0.35) continue

    const candLower = cand.title.toLowerCase()
    if (DISQUALIFYING_NON_GROCERY.test(candLower) && !DISQUALIFYING_NON_GROCERY.test(targetLower)) {
      continue
    }

    // Strict dietary / quality parity (e.g. don't compare organic to conventional)
    let qualifierMismatch = false
    for (const q of STRICT_QUALIFIERS) {
      const normalizedQ = q.replace('-', ' ')
      const targetHas = targetLower.includes(q) || targetLower.includes(normalizedQ)
      if (targetHas) {
        const candHas = candLower.includes(q) || candLower.includes(normalizedQ)
        if (!candHas) {
          qualifierMismatch = true
          break
        }
      }
    }
    if (qualifierMismatch) continue

    // Ground meat lean-ratio parity (e.g. don't compare 93/7 to 73/27)
    if (targetLean !== null) {
      const candLean = extractLeanRatio(cand.title)
      if (candLean !== null && Math.abs(candLean - targetLean) > 3) {
        continue
      }
    }

    // Pack size / weight parity: never recommend a smaller package as "cheaper"
    if (targetMeasure) {
      const candMeasure = extractPackMeasure(cand.title)
      if (candMeasure && candMeasure.kind === targetMeasure.kind) {
        const ratio = candMeasure.value / targetMeasure.value
        if (ratio < 0.85 || ratio > 1.35) {
          continue
        }
      }
    }

    // Core product token overlap so we never match "Ground Beef" -> "Beef Broth"
    if (targetTokens.size > 0) {
      const candTokens = extractCoreTokens(cand.title)
      let overlap = 0
      for (const tok of targetTokens) {
        if (candTokens.has(tok)) overlap++
      }
      const coverage = overlap / targetTokens.size
      if (overlap === 0 || (targetTokens.size >= 2 && coverage < 0.5)) {
        continue
      }
    }

    // Avoid suggesting the exact same item at the exact same store if names are nearly identical
    const retailerClean = retailer.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (purchasedStoreClean && retailerClean === purchasedStoreClean) {
      const candTokens = extractCoreTokens(cand.title)
      let sameCount = 0
      for (const t of targetTokens) {
        if (candTokens.has(t)) sameCount++
      }
      if (targetTokens.size > 0 && sameCount === targetTokens.size && candTokens.size === targetTokens.size) {
        continue
      }
    }

    if (!best || savingsCents > best.savingsCents) {
      best = {
        swapName: cand.title,
        swapPriceCents: cand.priceCents,
        savingsCents,
        retailer,
        retailerUrl: cand.url,
        imageUrl: cand.imageUrl,
        rating: cand.rating,
        snapEligible: cand.snapEligible,
      }
    }
  }

  return best
}
