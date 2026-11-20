import { describe, expect, it } from 'vitest'
import {
  computeSavingsCents,
  computeSavingsPercent,
  formatCents,
  parsePriceToCents,
  projectAnnualSavingsCents,
} from './money'
import { normalizeSkuKey, STARTER_SKU_CACHE } from './sku-normalize'
import {
  detectMembershipsFromTexts,
  extractEmailReceiptText,
  htmlEmailToReceiptText,
  SAMPLE_INSTACART_EMAIL_HTML,
} from './email-parser'
import { computeDeterministicOpportunities } from './deals-engine'
import { computeNetStoreSavings, getRegionalStoresForZip, zipToGoogleLocation } from './locality'
import {
  buildLiveSearchQuery,
  canonicalizeMerchant,
  parseSerpApiShoppingResults,
  selectBestLiveSwap,
} from './live-price-matcher'
import { extractedReceiptSchema, processReceiptInputSchema } from './zod-schemas'

describe('money utilities', () => {
  it('formats integer cents accurately', () => {
    expect(formatCents(0)).toBe('$0.00')
    expect(formatCents(450)).toBe('$4.50')
    expect(formatCents(129900)).toBe('$1,299.00')
    expect(formatCents(-250)).toBe('-$2.50')
  })

  it('parses human price strings into integer cents', () => {
    expect(parsePriceToCents('$4.98')).toBe(498)
    expect(parsePriceToCents('12.50')).toBe(1250)
    expect(parsePriceToCents('$1,299.05')).toBe(129905)
    expect(parsePriceToCents('free')).toBeNull()
    expect(parsePriceToCents(-5)).toBeNull()
  })

  it('computes savings and annualized projections safely', () => {
    expect(computeSavingsCents(1299, 849)).toBe(450)
    expect(computeSavingsCents(500, 600)).toBe(0)
    expect(computeSavingsPercent(1000, 750)).toBe(25)
    expect(projectAnnualSavingsCents(1400)).toBe(72800)
  })
})

describe('SKU normalization and starter cache', () => {
  it('expands common grocery receipt abbreviations deterministically', () => {
    expect(normalizeSkuKey('ORG BBY SPN 5OZ')).toBe('organic-baby-spinach-5oz')
    expect(normalizeSkuKey('CHOBANI GRK YOG 32OZ')).toBe('chobani-greek-yogurt-32oz')
  })

  it('keeps starter cache entries well-formed with positive savings', () => {
    expect(STARTER_SKU_CACHE.length).toBeGreaterThanOrEqual(8)
    for (const entry of STARTER_SKU_CACHE) {
      expect(entry.savingsCents).toBeGreaterThan(0)
      expect(entry.genericPriceCents).toBeLessThan(entry.typicalPriceCents)
      expect(entry.retailerUrl.startsWith('https://')).toBe(true)
    }
  })
})

describe('Zod validation contracts', () => {
  it('accepts valid extracted receipt payloads', () => {
    const parsed = extractedReceiptSchema.parse({
      storeName: 'Kroger',
      purchasedAt: '2026-11-20',
      subtotalCents: 1299,
      totalCents: 1299,
      lines: [
        {
          rawText: 'TIDE LIQ DET 92OZ',
          normalizedName: 'Tide Liquid Laundry Detergent 92 oz',
          category: 'Household',
          quantity: 1,
          unitPriceCents: 1299,
          lineTotalCents: 1299,
          isNameBrand: true,
        },
      ],
    })
    expect(parsed.lines).toHaveLength(1)
  })

  it('rejects empty processReceipt calls without image or text', () => {
    const result = processReceiptInputSchema.safeParse({ source: 'text', receiptText: '' })
    expect(result.success).toBe(false)
  })
})

describe('Gmail digital receipt parsing', () => {
  it('strips HTML email markup while preserving item lines and prices', () => {
    const text = htmlEmailToReceiptText(SAMPLE_INSTACART_EMAIL_HTML)
    expect(text).toContain('Tide Liquid Laundry Detergent 92 oz')
    expect(text).toContain('$12.99')
    expect(text).not.toContain('<td>')
  })

  it('decodes base64url Gmail API payloads cleanly', () => {
    const html = '<div><p>Target Order</p><p>Chobani Greek Yogurt 32 oz  $6.49</p></div>'
    const b64 = Buffer.from(html, 'utf8').toString('base64url')
    const out = extractEmailReceiptText({
      payload: {
        headers: [
          { name: 'From', value: 'orders@target.com' },
          { name: 'Subject', value: 'Your Target receipt' },
        ],
        parts: [{ mimeType: 'text/html', body: { data: b64 } }],
      },
    })
    expect(out).toContain('From: orders@target.com')
    expect(out).toContain('Chobani Greek Yogurt 32 oz')
    expect(out).toContain('$6.49')
  })
})

describe('locality and shipping guardrails', () => {
  it('maps ZIP codes to real regional chains without out-of-range stores', () => {
    const mn = getRegionalStoresForZip('55401')
    expect(mn).toContain('Cub')
    expect(mn).toContain('Aldi')
    expect(mn).not.toContain('H-E-B')
    expect(mn).not.toContain('Publix')

    const tx = getRegionalStoresForZip('78701')
    expect(tx).toContain('H-E-B')
    expect(tx).not.toContain('Cub')
  })

  it('deducts Amazon shipping when under $35 without Prime and enforces trip threshold', () => {
    const items = [
      { retailer: 'Amazon', storeName: 'Target', swapPriceCents: 400, savingsCents: 250, quantity: 1 },
      { retailer: 'Aldi', storeName: 'Target', swapPriceCents: 600, savingsCents: 150, quantity: 1 },
    ]
    const noPrime = computeNetStoreSavings(items, { allowedStores: ['Amazon', 'Aldi'], hasPrime: false })
    expect(noPrime.get('Amazon')?.worthIt).toBe(false) // $2.50 saving wiped out by $6.99 shipping
    expect(noPrime.get('Aldi')?.worthIt).toBe(false) // $1.50 saving < $3.00 extra-trip threshold

    const withPrime = computeNetStoreSavings(items, { allowedStores: ['Amazon', 'Aldi'], hasPrime: true })
    expect(withPrime.get('Amazon')?.worthIt).toBe(true)
  })

  it('auto-recommends Amazon Prime only when annualized Amazon swap savings beat $139/yr', () => {
    const scan = {
      householdId: 'hh_1',
      storeName: 'Kroger',
      purchasedAt: '2026-11-18',
      subtotalCents: 6000,
      totalCents: 6200,
      potentialSavingsCents: 1800,
      source: 'gmail' as const,
      lineCount: 2,
      cacheHits: 2,
      cacheMisses: 0,
      scannedBy: 'u_1',
      scannedAt: '2026-11-18T12:00:00Z',
    }
    const lines = [
      {
        householdId: 'hh_1',
        receiptScanId: 'rcpt_1',
        storeName: 'Kroger',
        purchasedAt: '2026-11-18',
        rawText: 'TIDE 92OZ',
        normalizedName: 'Tide Detergent 92 oz',
        skuKey: 'tide-92oz',
        category: 'Household',
        quantity: 2,
        unitPriceCents: 1300,
        lineTotalCents: 2600,
        isNameBrand: 1,
        swapStatus: 'matched' as const,
        swapName: 'Amazon Basics Detergent',
        swapPriceCents: 550,
        savingsCents: 750,
        retailer: 'Amazon',
        snapEligible: 0,
        swapSource: 'cache' as const,
      },
    ]

    const withoutPrime = computeDeterministicOpportunities([scan], lines, { hasPrime: false })
    expect(withoutPrime.some((o) => o.storeOrProvider === 'Amazon Prime')).toBe(true)

    const alreadyHasPrime = computeDeterministicOpportunities([scan], lines, { hasPrime: true })
    expect(alreadyHasPrime.some((o) => o.storeOrProvider === 'Amazon Prime')).toBe(false)
  })

  it('detects existing memberships from email receipts and snippets', () => {
    const found = detectMembershipsFromTexts([
      'Delivered free with your Target Circle 360 membership',
      'Your Amazon Prime membership benefits summary',
    ])
    expect(found).toContain('Target Circle 360')
    expect(found).toContain('Amazon Prime')
    expect(found).not.toContain('Costco')
  })
})

describe('live price matcher (Google Shopping & Amazon)', () => {
  it('strips store brand prefixes and maps ZIP to canonical Google location', () => {
    expect(buildLiveSearchQuery('Good & Gather 93/7 Ground Beef 1 lb')).toBe('93/7 Ground Beef 1 lb')
    expect(zipToGoogleLocation('55414')).toBe('Minneapolis, Minnesota, United States')
    expect(canonicalizeMerchant('ALDI via Instacart')).toBe('Aldi')
    expect(canonicalizeMerchant('Walmart - Grocery')).toBe('Walmart')
  })

  it('rejects pricier organic swaps, wrong lean ratios, smaller sizes, and out-of-area stores', () => {
    const raw = {
      shopping_results: [
        {
          title: 'Simply Nature Organic Grass Fed 93/07 Ground Beef 1 lb',
          source: 'ALDI',
          extracted_price: 8.05,
          link: 'https://shop.aldi.us/store/aldi/products/25320555',
        },
        {
          title: '73/27 Ground Beef 1 lb',
          source: 'Walmart',
          extracted_price: 4.99,
          link: 'https://www.walmart.com/ip/1',
        },
        {
          title: '93/7 Lean Ground Beef 8 oz',
          source: 'Walmart',
          extracted_price: 4.25,
          link: 'https://www.walmart.com/ip/2',
        },
        {
          title: '93/7 Lean Ground Beef 1 lb',
          source: 'H-E-B',
          extracted_price: 6.49,
          link: 'https://www.heb.com/product/1',
        },
        {
          title: '93/7 Lean Ground Beef 1 lb',
          source: 'ALDI',
          extracted_price: 7.39,
          link: 'https://shop.aldi.us/store/aldi/products/17679850',
        },
      ],
    }

    const candidates = parseSerpApiShoppingResults(raw)
    const mnStores = getRegionalStoresForZip('55414')

    const best = selectBestLiveSwap(
      {
        normalizedName: 'Good & Gather 93/7 Lean Ground Beef 1 lb',
        unitPriceCents: 799,
        storeName: 'Target',
      },
      candidates,
      mnStores,
    )

    expect(best).not.toBeNull()
    expect(best?.retailer).toBe('Aldi')
    expect(best?.swapPriceCents).toBe(739)
    expect(best?.savingsCents).toBe(60)
    expect(best?.retailerUrl).toBe('https://shop.aldi.us/store/aldi/products/17679850')

    // If user bought Organic 93/7 beef at $7.99, non-organic $7.39 must NOT be suggested
    const bestOrganic = selectBestLiveSwap(
      {
        normalizedName: 'Good & Gather Organic 93/7 Lean Ground Beef 1 lb',
        unitPriceCents: 799,
        storeName: 'Target',
      },
      candidates,
      mnStores,
    )
    expect(bestOrganic).toBeNull()
  })
})
