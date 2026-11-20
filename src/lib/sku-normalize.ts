import type { SkuSwapCacheData } from '../schemas/sku-swap-cache-schema'

const ABBREVIATION_MAP: Record<string, string> = {
  org: 'organic',
  bby: 'baby',
  spn: 'spinach',
  chkn: 'chicken',
  brst: 'breast',
  grk: 'greek',
  yog: 'yogurt',
  whl: 'whole',
  mlk: 'milk',
  alm: 'almond',
  pnut: 'peanut',
  btr: 'butter',
  det: 'detergent',
  ppr: 'paper',
  twl: 'towels',
  oj: 'orange juice',
  sft: 'soft',
  lg: 'large',
  med: 'medium',
  sm: 'small',
  pk: 'pack',
  ct: 'count',
  gv: 'great value',
  ks: 'kirkland signature',
}

/**
 * Deterministically normalize a cryptic receipt string or product name into a
 * canonical cache key so repeat staples hit `sku_swap_cache` in O(1).
 */
export function normalizeSkuKey(input: string): string {
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => ABBREVIATION_MAP[token] ?? token)
    .filter((token) => token.length > 1 || /^\d+$/.test(token))
    .join('-')
    .slice(0, 100)

  return cleaned || 'grocery-item'
}

/**
 * Starter catalog of high-frequency grocery staples seeded into `sku_swap_cache`
 * on first app run. Demonstrates immediate O(1) cache hits alongside real-time
 * `JobRoom` + `amazon/search-products` enrichment on cache misses.
 */
export const STARTER_SKU_CACHE: Omit<SkuSwapCacheData, 'refreshedAt'>[] = [
  {
    skuKey: 'tide-liquid-laundry-detergent-92oz',
    canonicalName: 'Tide Liquid Laundry Detergent 92 oz',
    category: 'Household',
    typicalPriceCents: 1299,
    genericAlternativeName: 'Amazon Basics Concentrated Liquid Laundry Detergent 100 oz',
    genericPriceCents: 849,
    savingsCents: 450,
    retailer: 'Amazon',
    retailerUrl: 'https://www.amazon.com/s?k=amazon+basics+liquid+laundry+detergent+100oz',
    rating: '4.6',
    snapEligible: 0,
    source: 'seed',
    hitCount: 0,
  },
  {
    skuKey: 'chobani-greek-yogurt-32oz',
    canonicalName: 'Chobani Non-Fat Greek Yogurt 32 oz',
    category: 'Dairy',
    typicalPriceCents: 649,
    genericAlternativeName: 'Amazon Fresh Plain Nonfat Greek Yogurt 32 oz',
    genericPriceCents: 399,
    savingsCents: 250,
    retailer: 'Amazon Fresh',
    retailerUrl: 'https://www.amazon.com/s?k=amazon+fresh+plain+greek+yogurt+32oz',
    rating: '4.6',
    snapEligible: 1,
    source: 'seed',
    hitCount: 0,
  },
  {
    skuKey: 'quaker-old-fashioned-oats-42oz',
    canonicalName: 'Quaker Old Fashioned Oats 42 oz',
    category: 'Breakfast',
    typicalPriceCents: 599,
    genericAlternativeName: 'Amazon Fresh Old Fashioned Rolled Oats 42 oz',
    genericPriceCents: 349,
    savingsCents: 250,
    retailer: 'Amazon Fresh',
    retailerUrl: 'https://www.amazon.com/s?k=amazon+fresh+old+fashioned+oats+42oz',
    rating: '4.7',
    snapEligible: 1,
    source: 'seed',
    hitCount: 0,
  },
  {
    skuKey: 'bounty-paper-towels-6-rolls',
    canonicalName: 'Bounty Select-A-Size Paper Towels 6 Double Rolls',
    category: 'Household',
    typicalPriceCents: 1599,
    genericAlternativeName: 'Presto! Flex-a-Size Paper Towels 6 Huge Rolls',
    genericPriceCents: 1129,
    savingsCents: 470,
    retailer: 'Amazon',
    retailerUrl: 'https://www.amazon.com/s?k=presto+paper+towels+6+rolls',
    rating: '4.7',
    snapEligible: 0,
    source: 'seed',
    hitCount: 0,
  },
  {
    skuKey: 'skippy-creamy-peanut-butter-40oz',
    canonicalName: 'Skippy Creamy Peanut Butter 40 oz',
    category: 'Pantry',
    typicalPriceCents: 679,
    genericAlternativeName: 'Happy Belly Creamy Peanut Butter 40 oz',
    genericPriceCents: 429,
    savingsCents: 250,
    retailer: 'Amazon',
    retailerUrl: 'https://www.amazon.com/s?k=happy+belly+creamy+peanut+butter+40oz',
    rating: '4.7',
    snapEligible: 1,
    source: 'seed',
    hitCount: 0,
  },
  {
    skuKey: 'barilla-spaghetti-pasta-16oz',
    canonicalName: 'Barilla Classic Spaghetti 16 oz',
    category: 'Pantry',
    typicalPriceCents: 219,
    genericAlternativeName: 'Amazon Fresh Enriched Spaghetti Pasta 16 oz',
    genericPriceCents: 119,
    savingsCents: 100,
    retailer: 'Amazon Fresh',
    retailerUrl: 'https://www.amazon.com/s?k=amazon+fresh+spaghetti+pasta+16oz',
    rating: '4.6',
    snapEligible: 1,
    source: 'seed',
    hitCount: 0,
  },
  {
    skuKey: 'raos-homemade-marinara-24oz',
    canonicalName: "Rao's Homemade Marinara Sauce 24 oz",
    category: 'Pantry',
    typicalPriceCents: 899,
    genericAlternativeName: '365 by Whole Foods Market Organic Marinara 25 oz',
    genericPriceCents: 449,
    savingsCents: 450,
    retailer: 'Whole Foods / Amazon',
    retailerUrl: 'https://www.amazon.com/s?k=365+whole+foods+marinara+sauce+25oz',
    rating: '4.5',
    snapEligible: 1,
    source: 'seed',
    hitCount: 0,
  },
  {
    skuKey: 'tropicana-orange-juice-52oz',
    canonicalName: 'Tropicana Pure Premium Orange Juice 52 oz',
    category: 'Beverages',
    typicalPriceCents: 549,
    genericAlternativeName: 'Amazon Fresh 100% Pure Orange Juice 52 oz',
    genericPriceCents: 369,
    savingsCents: 180,
    retailer: 'Amazon Fresh',
    retailerUrl: 'https://www.amazon.com/s?k=amazon+fresh+orange+juice+52oz',
    rating: '4.6',
    snapEligible: 1,
    source: 'seed',
    hitCount: 0,
  },
  {
    skuKey: 'silk-almond-milk-64oz',
    canonicalName: 'Silk Unsweetened Almond Milk 64 oz',
    category: 'Dairy',
    typicalPriceCents: 429,
    genericAlternativeName: '365 by Whole Foods Unsweetened Almondmilk 64 oz',
    genericPriceCents: 299,
    savingsCents: 130,
    retailer: 'Whole Foods / Amazon',
    retailerUrl: 'https://www.amazon.com/s?k=365+unsweetened+almond+milk+64oz',
    rating: '4.6',
    snapEligible: 1,
    source: 'seed',
    hitCount: 0,
  },
  {
    skuKey: 'cheerios-original-cereal-18oz',
    canonicalName: 'General Mills Cheerios Cereal 18 oz',
    category: 'Breakfast',
    typicalPriceCents: 549,
    genericAlternativeName: 'Amazon Fresh Toasted Oats Cereal 18 oz',
    genericPriceCents: 289,
    savingsCents: 260,
    retailer: 'Amazon Fresh',
    retailerUrl: 'https://www.amazon.com/s?k=amazon+fresh+toasted+oats+cereal+18oz',
    rating: '4.5',
    snapEligible: 1,
    source: 'seed',
    hitCount: 0,
  },
]

/**
 * Sample receipt text used by the "Try Sample Receipt" button so evaluators
 * can test the full cache-hit + JobRoom cache-miss pipeline in one click.
 */
export const SAMPLE_RECEIPT_TEXT = `KROGER #0412 — AUSTIN TX
DATE: ${new Date().toISOString().slice(0, 10)}

TIDE LIQ DETERGENT 92OZ           12.99
CHOBANI GRK YOGURT 32OZ            6.49
QUAKER OLD FASH OATS 42OZ          5.99
RAOS MARINARA 24OZ                 8.99
BARILLA SPAGHETTI 16OZ             2.19
SILK ALMOND MILK 64OZ              4.29
KERRYGOLD IRISH BUTTER 8OZ         5.29
FAIRLIFE WHOLE MILK 52OZ           5.49
SUBTOTAL                          51.72
TAX                                1.07
TOTAL                             52.79`
