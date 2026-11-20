import { cleanStoreName, storeMatchesAllowed } from './locality'
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

const STOP_WORDS = new Set([
  'good', 'gather', 'market', 'pantry', 'great', 'value', 'kirkland', 'simply', 'nature',
  'amazon', 'fresh', 'target', 'walmart', 'aldi', 'costco', 'cub', 'kroger', 'heb', 'publix',
  'the', 'and', 'with', 'for', 'per', 'pkg', 'pack', 'bag', 'box', 'bottle', 'can', 'jar',
  'count', 'ct', 'oz', 'fl', 'lb', 'lbs', 'each',
])

const STRICT_QUALIFIERS = [
  'organic', 'grass fed', 'gluten free', 'vegan', 'dairy free',
  'sugar free', 'zero sugar', 'decaf', 'lactose free',
]

const NON_GROCERY_RE =
  /\b(dog food|cat food|pet|treat|toy|cookbook|shirt|mug|sticker|supplement|capsule)\b/i

const STORE_BRAND_PREFIX_RE =
  /\b(good\s*&\s*gather|market\s+pantry|favorite\s+day|up\s*&\s*up|great\s+value|kirkland\s+signature|simply\s+nature|365\s+by\s+whole\s+foods|amazon\s+fresh|happy\s+belly)\b/gi

const MIN_SAVINGS_CENTS = 25
const MIN_CANDIDATE_PRICE_CENTS = 75
const MIN_PRICE_RATIO = 0.35
const SIZE_RATIO_MIN = 0.85
const SIZE_RATIO_MAX = 1.35

export function buildLiveSearchQuery(name: string): string {
  const cleaned = name
    .replace(STORE_BRAND_PREFIX_RE, '')
    .replace(/[™®©]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return (cleaned || name).slice(0, 95)
}

export function canonicalizeMerchant(
  rawSource?: string,
  allowedStores: string[] = [],
): string | null {
  if (!rawSource) {
    return null
  }
  const stripped = rawSource.replace(/\bvia\s+instacart\b/gi, '').replace(/\.com\b/gi, '').trim()
  const cleaned = cleanStoreName(stripped)
  if (!cleaned) {
    return null
  }
  const cleanedKey = cleaned.toLowerCase().replace(/[^a-z0-9]/g, '')
  const matched = allowedStores.find((store) => {
    const storeKey = cleanStoreName(store).toLowerCase().replace(/[^a-z0-9]/g, '')
    return storeKey.length >= 2 && (cleanedKey.includes(storeKey) || storeKey.includes(cleanedKey))
  })
  return matched ?? cleaned
}

function extractMeasure(
  text: string,
): { kind: 'weight' | 'volume' | 'count'; value: number } | null {
  const lower = text.toLowerCase()
  const rules: Array<[RegExp, 'weight' | 'volume' | 'count', number]> = [
    [/(\d+(?:\.\d+)?)\s*fl\.?\s*oz\b/, 'volume', 1],
    [/(\d+(?:\.\d+)?)\s*(?:gal|gallon)s?\b/, 'volume', 128],
    [/(\d+(?:\.\d+)?)\s*(?:qt|quart)s?\b/, 'volume', 32],
    [/(\d+(?:\.\d+)?)\s*(?:l|liter|litre)s?\b/, 'volume', 33.814],
    [/(\d+(?:\.\d+)?)\s*(?:lb|lbs|pound|pounds)\b/, 'weight', 16],
    [/(\d+(?:\.\d+)?)\s*oz\b/, 'weight', 1],
    [/(\d+)\s*(?:ct|count|pack|pk|rolls?|bars?|eggs?|pods?)\b/, 'count', 1],
  ]
  for (const [pattern, kind, mult] of rules) {
    const match = lower.match(pattern)
    if (match) {
      return { kind, value: Number.parseFloat(match[1]) * mult }
    }
  }
  return null
}

function extractCoreTokens(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, ' ')
    .split(/\s+/)
    .filter((tok) => tok.length > 2 && !/^\d+$/.test(tok) && !STOP_WORDS.has(tok))
  return new Set(words)
}

function extractLeanRatio(text: string): number | null {
  const match = text.match(/\b(7[0-9]|8[0-9]|9[0-9])(?:\s*\/\s*0?[1-9][0-9]?|%\s*lean)\b/i)
  return match ? Number.parseInt(match[1], 10) : null
}

function extractItemPriceCents(rec: Record<string, unknown>): number | null {
  if (typeof rec.extracted_price === 'number' && Number.isFinite(rec.extracted_price)) {
    return Math.round(rec.extracted_price * 100)
  }
  if (typeof rec.price === 'string') {
    return parsePriceToCents(rec.price)
  }
  return null
}

function extractItemUrl(rec: Record<string, unknown>): string {
  if (typeof rec.link === 'string' && rec.link.startsWith('https://')) {
    return rec.link
  }
  if (typeof rec.product_link === 'string' && rec.product_link.startsWith('https://')) {
    return rec.product_link
  }
  return ''
}

function parseSingleShoppingItem(item: unknown): LiveShoppingCandidate | null {
  if (!item || typeof item !== 'object') {
    return null
  }
  const rec = item as Record<string, unknown>
  const title = typeof rec.title === 'string' ? rec.title.trim() : ''
  const rawMerchant = typeof rec.source === 'string' ? rec.source : rec.merchant
  const merchant = typeof rawMerchant === 'string' ? rawMerchant.trim() : ''
  const priceCents = extractItemPriceCents(rec)

  if (!title || !merchant || !priceCents || priceCents <= 0) {
    return null
  }
  return {
    title: title.slice(0, 190),
    merchant,
    priceCents,
    url: extractItemUrl(rec),
    imageUrl: typeof rec.thumbnail === 'string' ? rec.thumbnail : undefined,
    rating: rec.rating != null ? String(rec.rating) : undefined,
    snapEligible: /\b(ebt|snap)\b/i.test(`${title} ${String(rec.extensions ?? '')}`),
  }
}

export function parseSerpApiShoppingResults(raw: unknown): LiveShoppingCandidate[] {
  if (!raw || typeof raw !== 'object') {
    return []
  }
  const obj = raw as Record<string, unknown>
  let list: unknown[] = []
  if (Array.isArray(obj.shopping_results)) {
    list = obj.shopping_results
  } else if (Array.isArray(obj.results)) {
    list = obj.results
  }

  const out: LiveShoppingCandidate[] = []
  for (const item of list) {
    const parsed = parseSingleShoppingItem(item)
    if (parsed) {
      out.push(parsed)
    }
  }
  return out
}

const DOMAIN_TO_MERCHANT: Array<[string, string]> = [
  ['aldi.us', 'Aldi'],
  ['walmart.com', 'Walmart'],
  ['target.com', 'Target'],
  ['amazon.com', 'Amazon'],
  ['costco.com', 'Costco'],
  ['samsclub.com', 'Sam’s Club'],
  ['kroger.com', 'Kroger'],
  ['heb.com', 'H-E-B'],
  ['hy-vee.com', 'Hy-Vee'],
  ['cub.com', 'Cub'],
  ['meijer.com', 'Meijer'],
  ['safeway.com', 'Safeway'],
  ['albertsons.com', 'Albertsons'],
  ['publix.com', 'Publix'],
  ['sprouts.com', 'Sprouts'],
  ['wegmans.com', 'Wegmans'],
  ['traderjoes.com', 'Trader Joe’s'],
  ['lidl.com', 'Lidl'],
]

function merchantFromUrl(urlStr: string): string | null {
  try {
    const parsed = new URL(urlStr)
    const host = parsed.hostname.toLowerCase()
    if (host.includes('instacart.com')) {
      const storeMatch = parsed.pathname.match(/\/store\/([a-z0-9-]+)/i)
      if (storeMatch) {
        return cleanStoreName(storeMatch[1].replace(/-/g, ' '))
      }
    }
    const found = DOMAIN_TO_MERCHANT.find(([domain]) => host.includes(domain))
    return found ? found[1] : null
  } catch {
    return null
  }
}

function parseSingleExaItem(item: unknown): LiveShoppingCandidate | null {
  if (!item || typeof item !== 'object') {
    return null
  }
  const rec = item as Record<string, unknown>
  const title = typeof rec.title === 'string' ? rec.title.trim() : ''
  const url = typeof rec.url === 'string' && rec.url.startsWith('https://') ? rec.url : ''
  if (!title || !url) {
    return null
  }
  const merchant = merchantFromUrl(url)
  if (!merchant) {
    return null
  }

  const highlights = Array.isArray(rec.highlights) ? rec.highlights.join(' ') : ''
  const textBody = typeof rec.text === 'string' ? rec.text.slice(0, 600) : ''
  const priceMatch = `${title} ${highlights} ${textBody}`.match(/\$\s*(\d{1,3}\.\d{2})\b/)
  const priceCents = priceMatch ? parsePriceToCents(priceMatch[1]) : null
  if (!priceCents || priceCents <= 0) {
    return null
  }

  return {
    title: title.slice(0, 190),
    merchant,
    priceCents,
    url,
    imageUrl: typeof rec.image === 'string' ? rec.image : undefined,
    snapEligible: /\b(ebt|snap)\b/i.test(`${title} ${highlights}`),
  }
}

/** Parse live product listings & prices from an `exa/search` response. */
export function parseExaShoppingResults(raw: unknown): LiveShoppingCandidate[] {
  if (!raw || typeof raw !== 'object') {
    return []
  }
  const list = (raw as Record<string, unknown>).results
  if (!Array.isArray(list)) {
    return []
  }
  const out: LiveShoppingCandidate[] = []
  for (const item of list) {
    const parsed = parseSingleExaItem(item)
    if (parsed) {
      out.push(parsed)
    }
  }
  return out
}

interface MatchContext {
  targetTokens: Set<string>
  targetMeasure: { kind: 'weight' | 'volume' | 'count'; value: number } | null
  targetNorm: string
  targetLean: number | null
  purchasedStore: string
}

function measureMatchesTarget(
  candTitle: string,
  targetMeasure: MatchContext['targetMeasure'],
): boolean {
  if (!targetMeasure) {
    return true
  }
  const candMeasure = extractMeasure(candTitle)
  if (!candMeasure || candMeasure.kind !== targetMeasure.kind) {
    return true
  }
  const ratio = candMeasure.value / targetMeasure.value
  return ratio >= SIZE_RATIO_MIN && ratio <= SIZE_RATIO_MAX
}

function tokensMatchTarget(candTitle: string, retailer: string, ctx: MatchContext): boolean {
  if (ctx.targetTokens.size === 0) {
    return true
  }
  const candTokens = extractCoreTokens(candTitle)
  let overlap = 0
  for (const tok of ctx.targetTokens) {
    if (candTokens.has(tok)) {
      overlap++
    }
  }
  if (overlap === 0 || (ctx.targetTokens.size >= 2 && overlap / ctx.targetTokens.size < 0.5)) {
    return false
  }
  const retailerClean = retailer.toLowerCase().replace(/[^a-z0-9]/g, '')
  const isIdenticalSameStore =
    Boolean(ctx.purchasedStore) &&
    retailerClean === ctx.purchasedStore &&
    overlap === ctx.targetTokens.size &&
    candTokens.size === ctx.targetTokens.size
  return !isIdenticalSameStore
}

function candidateMatchesTarget(
  cand: LiveShoppingCandidate,
  retailer: string,
  ctx: MatchContext,
): boolean {
  const candNorm = cand.title.toLowerCase().replace(/-/g, ' ')
  if (NON_GROCERY_RE.test(candNorm) && !NON_GROCERY_RE.test(ctx.targetNorm)) {
    return false
  }
  if (STRICT_QUALIFIERS.some((q) => ctx.targetNorm.includes(q) && !candNorm.includes(q))) {
    return false
  }
  if (ctx.targetLean !== null) {
    const candLean = extractLeanRatio(cand.title)
    if (candLean !== null && Math.abs(candLean - ctx.targetLean) > 3) {
      return false
    }
  }
  if (!measureMatchesTarget(cand.title, ctx.targetMeasure)) {
    return false
  }
  return tokensMatchTarget(cand.title, retailer, ctx)
}

export function selectBestLiveSwap(
  purchased: { normalizedName: string; unitPriceCents: number; storeName?: string },
  candidates: LiveShoppingCandidate[],
  allowedStores: string[],
): MatchedLiveSwap | null {
  const ctx: MatchContext = {
    targetTokens: extractCoreTokens(purchased.normalizedName),
    targetMeasure: extractMeasure(purchased.normalizedName),
    targetNorm: purchased.normalizedName.toLowerCase().replace(/-/g, ' '),
    targetLean: extractLeanRatio(purchased.normalizedName),
    purchasedStore: (purchased.storeName ?? '').toLowerCase().replace(/[^a-z0-9]/g, ''),
  }

  let best: MatchedLiveSwap | null = null
  for (const cand of candidates) {
    const retailer = canonicalizeMerchant(cand.merchant, allowedStores)
    if (!retailer || !storeMatchesAllowed(retailer, allowedStores)) {
      continue
    }
    const savingsCents = computeSavingsCents(purchased.unitPriceCents, cand.priceCents)
    const tooSmall =
      savingsCents < MIN_SAVINGS_CENTS ||
      cand.priceCents < MIN_CANDIDATE_PRICE_CENTS ||
      cand.priceCents < purchased.unitPriceCents * MIN_PRICE_RATIO
    if (tooSmall || !candidateMatchesTarget(cand, retailer, ctx)) {
      continue
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
