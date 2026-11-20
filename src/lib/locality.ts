/**
 * Regional grocery chain locality + net-of-shipping / trip-worth-it guardrails.
 * Ensures swap recommendations only compare against stores actually in the
 * user's area and never claim fake savings wiped out by shipping or an extra drive.
 */

export const ALL_KNOWN_STORES = [
  'Aldi',
  'Walmart',
  'Target',
  'Costco',
  'Trader Joe’s',
  'Cub',
  'Hy-Vee',
  'Kroger',
  'Meijer',
  'H-E-B',
  'Publix',
  'Safeway',
  'Wegmans',
  'ShopRite',
  'Sprouts',
  'Amazon',
] as const

export const AMAZON_SHIPPING_CENTS = 699
export const AMAZON_FREE_SHIPPING_MIN_CENTS = 3500
export const MIN_EXTRA_TRIP_SAVINGS_CENTS = 300 // Don't send someone to another store for < $3

/**
 * Infer realistic local grocery chains from a US 5-digit ZIP code prefix.
 */
export function getRegionalStoresForZip(zipCode: string): string[] {
  const digits = zipCode.replace(/\D/g, '')
  if (digits.length < 3) {
    return ['Aldi', 'Walmart', 'Target', 'Costco', 'Trader Joe’s', 'Amazon']
  }
  const prefix = Number.parseInt(digits.slice(0, 3), 10)

  // Minnesota (550-567)
  if (prefix >= 550 && prefix <= 567) {
    return ['Aldi', 'Cub', 'Target', 'Walmart', 'Costco', 'Hy-Vee', 'Trader Joe’s', 'Amazon']
  }
  // Iowa / Nebraska / Dakotas / Kansas / Missouri (500-528, 570-588, 630-693)
  if (
    (prefix >= 500 && prefix <= 528) ||
    (prefix >= 570 && prefix <= 588) ||
    (prefix >= 630 && prefix <= 693)
  ) {
    return ['Aldi', 'Hy-Vee', 'Walmart', 'Target', 'Costco', 'Amazon']
  }
  // Texas (750-799)
  if (prefix >= 750 && prefix <= 799) {
    return ['H-E-B', 'Aldi', 'Walmart', 'Target', 'Costco', 'Kroger', 'Trader Joe’s', 'Amazon']
  }
  // Southeast: FL / GA / AL / SC / NC / TN (270-349, 350-385)
  if (prefix >= 270 && prefix <= 385) {
    return ['Publix', 'Aldi', 'Walmart', 'Target', 'Costco', 'Kroger', 'Trader Joe’s', 'Amazon']
  }
  // Great Lakes / Midwest: OH / IN / MI / IL / WI (430-499, 530-549, 600-629)
  if (
    (prefix >= 430 && prefix <= 499) ||
    (prefix >= 530 && prefix <= 549) ||
    (prefix >= 600 && prefix <= 629)
  ) {
    return ['Aldi', 'Meijer', 'Kroger', 'Walmart', 'Target', 'Costco', 'Trader Joe’s', 'Amazon']
  }
  // Northeast: MA / NY / NJ / PA / CT / MD / VA (010-246)
  if (prefix >= 10 && prefix <= 246) {
    return ['Aldi', 'ShopRite', 'Wegmans', 'Target', 'Walmart', 'Costco', 'Trader Joe’s', 'Amazon']
  }
  // West Coast / Mountain: CA / WA / OR / CO / AZ (800-994)
  if (prefix >= 800 && prefix <= 994) {
    return ['Trader Joe’s', 'Safeway', 'Sprouts', 'Costco', 'Walmart', 'Target', 'Aldi', 'Amazon']
  }

  return ['Aldi', 'Walmart', 'Target', 'Costco', 'Trader Joe’s', 'Amazon']
}

export function parseNearbyStores(raw?: string): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    }
  } catch {
    // ignore malformed JSON
  }
  return []
}

export function storeMatchesAllowed(retailer: string | undefined, allowedStores: string[]): boolean {
  if (!retailer) return false
  if (allowedStores.length === 0) return true
  const r = retailer.toLowerCase()
  return allowedStores.some((s) => {
    const clean = s.toLowerCase().replace(/[^a-z0-9]/g, '')
    const rClean = r.replace(/[^a-z0-9]/g, '')
    return rClean.includes(clean) || clean.includes(rClean)
  })
}

/**
 * Map a US 5-digit ZIP code prefix to a canonical Google / SerpApi location string
 * so Google Shopping returns local regional pricing without rejecting raw ZIPs.
 */
export function zipToGoogleLocation(zipCode: string): string {
  const digits = zipCode.replace(/\D/g, '')
  if (digits.length < 3) return 'United States'
  const prefix = Number.parseInt(digits.slice(0, 3), 10)

  if (prefix >= 550 && prefix <= 567) return 'Minneapolis, Minnesota, United States'
  if (prefix >= 500 && prefix <= 528) return 'Des Moines, Iowa, United States'
  if (prefix >= 530 && prefix <= 549) return 'Milwaukee, Wisconsin, United States'
  if (prefix >= 600 && prefix <= 629) return 'Chicago, Illinois, United States'
  if (prefix >= 750 && prefix <= 799) return 'Austin, Texas, United States'
  if (prefix >= 320 && prefix <= 349) return 'Miami, Florida, United States'
  if (prefix >= 300 && prefix <= 319) return 'Atlanta, Georgia, United States'
  if (prefix >= 100 && prefix <= 149) return 'New York, New York, United States'
  if (prefix >= 10 && prefix <= 27) return 'Boston, Massachusetts, United States'
  if (prefix >= 900 && prefix <= 961) return 'Los Angeles, California, United States'
  if (prefix >= 980 && prefix <= 994) return 'Seattle, Washington, United States'
  if (prefix >= 800 && prefix <= 816) return 'Denver, Colorado, United States'
  return 'United States'
}

/**
 * Build a verified live search URL for a retailer + product name.
 * Preserves live Amazon Associate or Google Shopping merchant URLs when present.
 */
export function resolveRetailerUrl(
  retailer: string | undefined,
  itemName: string,
  existingUrl?: string,
): string {
  // Keep real live product URLs intact (excluding legacy broken search URLs)
  if (
    existingUrl &&
    /^https:\/\//i.test(existingUrl) &&
    !/aldi\.us\/results/i.test(existingUrl) &&
    !/cub\.com\/sm\/pickup/i.test(existingUrl)
  ) {
    return existingUrl
  }
  const cleanQuery = itemName
    .replace(/\b(aldi|walmart|cub|costco|target|hy-vee|heb|h-e-b|kroger|publix|safeway)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  const q = encodeURIComponent(cleanQuery || itemName)
  const lower = (retailer ?? '').toLowerCase()

  if (lower.includes('aldi')) return `https://shop.aldi.us/store/aldi/s?k=${q}`
  if (lower.includes('walmart')) return `https://www.walmart.com/search?q=${q}`
  if (lower.includes('target')) return `https://www.target.com/s?searchTerm=${q}`
  if (lower.includes('cub')) return `https://www.instacart.com/store/cub-foods/s?k=${q}`
  if (lower.includes('costco')) return `https://www.costco.com/CatalogSearch?keyword=${q}`
  if (lower.includes('hy-vee') || lower.includes('hyvee')) {
    return `https://www.hy-vee.com/aisles-online/search?search=${q}`
  }
  if (lower.includes('h-e-b') || lower.includes('heb')) return `https://www.heb.com/search/?q=${q}`
  if (lower.includes('kroger')) return `https://www.kroger.com/search?query=${q}`
  if (lower.includes('publix')) return `https://www.instacart.com/store/publix/s?k=${q}`
  if (lower.includes('safeway')) return `https://www.safeway.com/shop/search-results.html?q=${q}`
  if (lower.includes('trader')) return `https://www.traderjoes.com/home/search?q=${q}&section=products`
  return `https://www.amazon.com/s?k=${q}`
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

/**
 * Compute net savings per store after factoring in Amazon shipping (when no Prime
 * and basket < $35) and extra-trip threshold for physical stores.
 */
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
    { grossSavingsCents: number; basketCostCents: number; itemCount: number; sameStoreOnly: boolean }
  >()

  for (const item of items) {
    if (!item.retailer || item.savingsCents <= 0) continue
    if (!storeMatchesAllowed(item.retailer, options.allowedStores)) continue

    const qty = Math.max(1, Math.round(item.quantity || 1))
    const key = item.retailer
    const current = byStore.get(key) ?? {
      grossSavingsCents: 0,
      basketCostCents: 0,
      itemCount: 0,
      sameStoreOnly: true,
    }
    current.grossSavingsCents += item.savingsCents * qty
    current.basketCostCents += item.swapPriceCents * qty
    current.itemCount += 1
    if (!item.storeName.toLowerCase().includes(key.toLowerCase())) {
      current.sameStoreOnly = false
    }
    byStore.set(key, current)
  }

  const out = new Map<string, StoreSavingsSummary>()
  for (const [store, stats] of byStore.entries()) {
    const isAmazon = store.toLowerCase().includes('amazon')
    const shippingCostCents =
      isAmazon && !options.hasPrime && stats.basketCostCents < AMAZON_FREE_SHIPPING_MIN_CENTS
        ? AMAZON_SHIPPING_CENTS
        : 0
    const netSavingsCents = Math.max(0, stats.grossSavingsCents - shippingCostCents)
    const worthIt = isAmazon
      ? netSavingsCents > 0
      : stats.sameStoreOnly || netSavingsCents >= MIN_EXTRA_TRIP_SAVINGS_CENTS

    out.set(store, {
      store,
      grossSavingsCents: stats.grossSavingsCents,
      shippingCostCents,
      netSavingsCents,
      basketCostCents: stats.basketCostCents,
      itemCount: stats.itemCount,
      worthIt,
    })
  }
  return out
}
