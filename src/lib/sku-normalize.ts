const NOISE_WORDS = new Set([
  'the',
  'and',
  'with',
  'for',
  'brand',
  'original',
  'classic',
  'fresh',
  'pack',
  'size',
  'fl',
])

const SKU_TOKEN_MAX = 6
const SKU_KEY_LENGTH_MAX = 96

/** Deterministic slug key for deduplicating and caching grocery SKUs. */
export function normalizeSkuKey(rawName: string): string {
  const tokens = rawName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0 && !NOISE_WORDS.has(token))

  const slug = tokens.slice(0, SKU_TOKEN_MAX).join('-') || 'grocery-item'
  return slug.slice(0, SKU_KEY_LENGTH_MAX)
}

export const SAMPLE_RECEIPT_TEXT = [
  'Target #1422 - Minneapolis',
  new Date().toISOString().slice(0, 10),
  'Tide Liquid Laundry Detergent 92 oz $13.49',
  'Bounty Select-A-Size Paper Towels 6 Rolls $14.99',
  'Kerrygold Pure Irish Butter 8 oz $4.99',
  'Chobani Greek Yogurt Vanilla 32 oz $6.29',
  'Fairlife 2% Ultra-Filtered Milk 52 oz $4.69',
  "Rao's Homemade Marinara Sauce 24 oz $8.99",
  'Good & Gather 93/7 Lean Ground Beef 1 lb $7.99',
  'SUBTOTAL $61.43',
  'TOTAL $62.80',
].join('\n')
