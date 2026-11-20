/**
 * Dynamic local grocery store discovery (via Google Maps `serpapi/places-search`)
 * + net-of-shipping & extra-trip savings guardrails.
 */

export const AMAZON_SHIPPING_CENTS = 699
export const AMAZON_FREE_SHIPPING_MIN_CENTS = 3500
export const MIN_EXTRA_TRIP_SAVINGS_CENTS = 300

export const DEFAULT_STORES = [
  'Aldi',
  'Walmart',
  'Target',
  'Costco',
  'Trader Joe’s',
  'Amazon',
]

const DISCOVERED_STORES_MAX = 11
const CACHE_KEY_LENGTH_MAX = 120

const US_STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
  MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina',
  ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee',
  TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia',
}

/** Clean a Google Maps place title into a concise store name. */
export function cleanStoreName(raw: string): string {
  const cleaned = raw
    .replace(/\s*\(via [^)]+\)/gi, '')
    .replace(/\s+[-–—|]\s+.*$/i, '')
    .replace(/\s+#\d+.*$/i, '')
    .replace(/\b(supercenter|neighborhood market|wholesale|grocery|hypermarket|express)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (/^aldi$/i.test(cleaned)) {
    return 'Aldi'
  }
  if (/^cub foods?$/i.test(cleaned)) {
    return 'Cub'
  }
  return cleaned || raw.trim()
}

function getPlaceList(raw: unknown): unknown[] {
  if (!raw || typeof raw !== 'object') {
    return []
  }
  const obj = raw as Record<string, unknown>
  if (Array.isArray(obj.local_results)) {
    return obj.local_results
  }
  if (Array.isArray(obj.places)) {
    return obj.places
  }
  if (Array.isArray(obj.results)) {
    return obj.results
  }
  return []
}

/** Extract canonical "City, State, United States" from Google Maps addresses. */
export function parseGoogleMapsLocation(raw: unknown): string {
  for (const item of getPlaceList(raw)) {
    if (!item || typeof item !== 'object') {
      continue
    }
    const addr = (item as Record<string, unknown>).address
    if (typeof addr !== 'string') {
      continue
    }
    const match = addr.match(/,\s*([A-Za-z .'-]{2,40}),\s*([A-Z]{2})\b/)
    if (match && US_STATES[match[2]]) {
      return `${match[1].trim()}, ${US_STATES[match[2]]}, United States`
    }
  }
  return 'United States'
}

export function regionalCacheKey(skuKey: string, zipCode?: string): string {
  const prefix = (zipCode ?? '').replace(/\D/g, '').slice(0, 3)
  if (prefix.length === 3) {
    return `${prefix}:${skuKey}`.slice(0, CACHE_KEY_LENGTH_MAX)
  }
  return skuKey
}

/** Extract unique nearby grocery store names from Google Maps results. */
export function parseGoogleMapsStores(raw: unknown): string[] {
  const seen = new Map<string, string>()

  for (const item of getPlaceList(raw)) {
    if (!item || typeof item !== 'object') {
      continue
    }
    const rec = item as Record<string, unknown>
    let rawTitle = ''
    if (typeof rec.title === 'string') {
      rawTitle = rec.title
    } else if (typeof rec.name === 'string') {
      rawTitle = rec.name
    }
    if (!rawTitle) {
      continue
    }
    const name = cleanStoreName(rawTitle)
    const key = name.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (key.length >= 2 && !seen.has(key)) {
      seen.set(key, name)
    }
    if (seen.size >= DISCOVERED_STORES_MAX) {
      break
    }
  }

  const stores = Array.from(seen.values())
  if (stores.length > 0 && !seen.has('amazon')) {
    stores.push('Amazon')
  }
  return stores
}

export function storeMatchesAllowed(
  retailer: string | undefined,
  allowedStores: string[],
): boolean {
  if (!retailer) {
    return false
  }
  if (allowedStores.length === 0) {
    return true
  }
  const normalized = cleanStoreName(retailer).toLowerCase().replace(/[^a-z0-9]/g, '')
  if (normalized.length < 2) {
    return false
  }
  return allowedStores.some((store) => {
    const clean = cleanStoreName(store).toLowerCase().replace(/[^a-z0-9]/g, '')
    return clean.length >= 2 && (normalized.includes(clean) || clean.includes(normalized))
  })
}

const KNOWN_SEARCH_URLS: Array<[string, (q: string) => string]> = [
  ['aldi', (q) => `https://shop.aldi.us/store/aldi/s?k=${q}`],
  ['walmart', (q) => `https://www.walmart.com/search?q=${q}`],
  ['target', (q) => `https://www.target.com/s?searchTerm=${q}`],
  ['cub', (q) => `https://www.instacart.com/store/cub-foods/s?k=${q}`],
  ['costco', (q) => `https://www.costco.com/CatalogSearch?keyword=${q}`],
  ['amazon', (q) => `https://www.amazon.com/s?k=${q}`],
  ['trader', (q) => `https://www.traderjoes.com/home/search?q=${q}&section=products`],
  ['hy-vee', (q) => `https://www.hy-vee.com/aisles-online/search?search=${q}`],
  ['h-e-b', (q) => `https://www.heb.com/search/?q=${q}`],
  ['kroger', (q) => `https://www.kroger.com/search?query=${q}`],
]

export function resolveRetailerUrl(
  retailer: string | undefined,
  itemName: string,
  existingUrl?: string,
): string {
  const isBrokenLegacy = Boolean(
    existingUrl && /aldi\.us\/results|cub\.com\/sm\/pickup/i.test(existingUrl),
  )
  if (existingUrl && /^https:\/\//i.test(existingUrl) && !isBrokenLegacy) {
    return existingUrl
  }
  const encoded = encodeURIComponent(itemName.trim())
  const lower = (retailer ?? '').toLowerCase()
  const match = KNOWN_SEARCH_URLS.find(([key]) => lower.includes(key))
  if (match) {
    return match[1](encoded)
  }
  const fallback = encodeURIComponent(`${retailer ?? ''} ${itemName}`.trim())
  return `https://www.google.com/search?tbm=shop&q=${fallback}`
}

export interface StoreSavingsSummary {
  store: string
  grossSavingsCents: number
  shippingCostCents: number
  netSavingsCents: number
  basketCostCents: number
  itemCount: number
  worthIt: boolean
}

export function computeNetStoreSavings(
  items: Array<{
    retailer?: string
    storeName: string
    swapPriceCents: number
    savingsCents: number
    quantity: number
  }>,
  options: { allowedStores: string[]; hasPrime: boolean },
): Map<string, StoreSavingsSummary> {
  const byStore = new Map<
    string,
    { gross: number; basket: number; count: number; sameStoreOnly: boolean }
  >()

  for (const item of items) {
    if (!item.retailer || item.savingsCents <= 0) {
      continue
    }
    if (!storeMatchesAllowed(item.retailer, options.allowedStores)) {
      continue
    }
    const qty = Math.max(1, Math.round(item.quantity || 1))
    const cur = byStore.get(item.retailer) ?? {
      gross: 0,
      basket: 0,
      count: 0,
      sameStoreOnly: true,
    }
    cur.gross += item.savingsCents * qty
    cur.basket += item.swapPriceCents * qty
    cur.count += 1
    if (!item.storeName.toLowerCase().includes(item.retailer.toLowerCase())) {
      cur.sameStoreOnly = false
    }
    byStore.set(item.retailer, cur)
  }

  const out = new Map<string, StoreSavingsSummary>()
  for (const [store, stats] of byStore) {
    const isAmazon = store.toLowerCase().includes('amazon')
    const needsShipping =
      isAmazon && !options.hasPrime && stats.basket < AMAZON_FREE_SHIPPING_MIN_CENTS
    const shipping = needsShipping ? AMAZON_SHIPPING_CENTS : 0
    const net = Math.max(0, stats.gross - shipping)
    const worthIt = isAmazon
      ? net > 0
      : stats.sameStoreOnly || net >= MIN_EXTRA_TRIP_SAVINGS_CENTS

    out.set(store, {
      store,
      grossSavingsCents: stats.gross,
      shippingCostCents: shipping,
      netSavingsCents: net,
      basketCostCents: stats.basket,
      itemCount: stats.count,
      worthIt,
    })
  }
  return out
}
