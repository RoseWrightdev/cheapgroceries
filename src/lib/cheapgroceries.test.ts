import { describe, expect, it } from 'vitest'
import { assert } from './assert'
import { computeDeterministicOpportunities } from './deals-engine'
import {
  detectMembershipsFromTexts,
  extractEmailReceiptText,
  htmlEmailToReceiptText,
} from './email-parser'
import {
  buildLiveSearchQuery,
  canonicalizeMerchant,
  parseExaShoppingResults,
  parseSerpApiShoppingResults,
  selectBestLiveSwap,
} from './live-price-matcher'
import {
  computeNetStoreSavings,
  parseGoogleMapsLocation,
  parseGoogleMapsStores,
  regionalCacheKey,
} from './locality'
import {
  computeSavingsCents,
  computeSavingsPercent,
  estimateTripsPerYear,
  formatCents,
  parsePriceToCents,
  projectAnnualSavingsCents,
} from './money'
import { parsePlainTextReceipt } from './receipt-parser'
import { normalizeSkuKey, SAMPLE_RECEIPT_TEXT } from './sku-normalize'
import { extractedReceiptSchema, processReceiptInputSchema } from './zod-schemas'

describe('money & sku utilities', () => {
  it('formats cents, parses prices, and computes savings accurately', () => {
    expect(formatCents(450)).toBe('$4.50')
    expect(parsePriceToCents('$12.99')).toBe(1299)
    expect(parsePriceToCents('N/A')).toBeNull()
    expect(computeSavingsCents(1299, 899)).toBe(400)
    expect(computeSavingsPercent(1000, 750)).toBe(25)
    expect(estimateTripsPerYear(['2026-11-01', '2026-11-15'])).toBe(52)
    expect(estimateTripsPerYear(['2026-11-01'])).toBe(26)
    expect(projectAnnualSavingsCents(1000, 26)).toBe(26000)
    expect(normalizeSkuKey('Tide Liquid Laundry Detergent 92 oz')).toBe(
      'tide-liquid-laundry-detergent-92-oz',
    )
  })

  it('validates receipt payloads strictly with Zod', () => {
    expect(processReceiptInputSchema.safeParse({ source: 'text', receiptText: '' }).success).toBe(
      false,
    )
    const valid = extractedReceiptSchema.safeParse({
      storeName: 'Target',
      purchasedAt: '2026-11-18',
      subtotalCents: 1299,
      totalCents: 1350,
      lines: [
        {
          rawText: 'TIDE',
          normalizedName: 'Tide 92 oz',
          category: 'Household',
          quantity: 1,
          unitPriceCents: 1299,
          lineTotalCents: 1299,
          isNameBrand: true,
        },
      ],
    })
    expect(valid.success).toBe(true)
  })
})

describe('email parser & membership detection', () => {
  it('strips HTML & tracking URLs and detects active memberships', () => {
    const html = '<table><tr><td>Tide 92 oz</td><td>$12.99</td></tr></table>'
    const text = htmlEmailToReceiptText(html)
    expect(text).toContain('Tide 92 oz')
    expect(text).toContain('$12.99')

    const extracted = extractEmailReceiptText({
      from: 'orders@oe1.target.com',
      subject: 'Your Target order',
      text: 'Delivered free with your Target Circle 360 membership https://trk.target.com/xyz',
    })
    expect(extracted).not.toContain('https://')

    const found = detectMembershipsFromTexts([extracted, 'Your Amazon Prime membership renewal'])
    expect(found).toContain('Target Circle 360')
    expect(found).toContain('Amazon Prime')
    expect(found).not.toContain('Costco')
  })
})

describe('locality & shipping guardrails', () => {
  it('parses Google Maps stores/location and deducts Amazon shipping without Prime', () => {
    const mapsPayload = {
      local_results: [
        { title: 'ALDI', address: '1311 E Franklin Ave, Minneapolis, MN 55404' },
        { title: 'Cub Foods - Minneapolis' },
        { title: 'Walmart Supercenter #1422' },
        { title: 'Fresh Thyme Market' },
      ],
    }
    expect(parseGoogleMapsStores(mapsPayload)).toEqual([
      'Aldi',
      'Cub',
      'Walmart',
      'Fresh Thyme Market',
      'Amazon',
    ])
    expect(parseGoogleMapsLocation(mapsPayload)).toBe('Minneapolis, Minnesota, United States')
    expect(regionalCacheKey('ground-beef-1-lb', '55414')).toBe('554:ground-beef-1-lb')

    const item = [
      {
        retailer: 'Amazon',
        storeName: 'Target',
        swapPriceCents: 1000,
        savingsCents: 400,
        quantity: 1,
      },
    ]
    const noPrime = computeNetStoreSavings(item, { allowedStores: ['Amazon'], hasPrime: false })
    const withPrime = computeNetStoreSavings(item, { allowedStores: ['Amazon'], hasPrime: true })
    expect(noPrime.get('Amazon')?.worthIt).toBe(false)
    expect(withPrime.get('Amazon')?.worthIt).toBe(true)
  })
})

describe('subscription break-even', () => {

  it('recommends Amazon Prime only when annualized swap savings beat $139/yr', () => {
    const scan = {
      householdId: 'hh_1',
      storeName: 'Kroger',
      purchasedAt: '2026-11-18',
      subtotalCents: 6000,
      totalCents: 6200,
      potentialSavingsCents: 1500,
      source: 'gmail' as const,
      lineCount: 1,
      cacheHits: 1,
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
    const alreadyPrime = computeDeterministicOpportunities([scan], lines, { hasPrime: true })
    expect(withoutPrime.some((opp) => opp.storeOrProvider === 'Amazon Prime')).toBe(true)
    expect(alreadyPrime.some((opp) => opp.storeOrProvider === 'Amazon Prime')).toBe(false)
  })
})

describe('live price matcher', () => {
  it('enforces organic, lean-ratio, pack-size, and nearby-store parity', () => {
    expect(buildLiveSearchQuery('Good & Gather 93/7 Ground Beef 1 lb')).toBe(
      '93/7 Ground Beef 1 lb',
    )
    expect(canonicalizeMerchant('ALDI via Instacart')).toBe('Aldi')

    const candidates = parseSerpApiShoppingResults({
      shopping_results: [
        {
          title: 'Simply Nature Organic Grass Fed 93/07 Ground Beef 1 lb',
          source: 'ALDI',
          extracted_price: 8.05,
          link: 'https://shop.aldi.us/1',
        },
        {
          title: '73/27 Ground Beef 1 lb',
          source: 'Walmart',
          extracted_price: 4.99,
          link: 'https://www.walmart.com/1',
        },
        {
          title: '93/7 Lean Ground Beef 8 oz',
          source: 'Walmart',
          extracted_price: 4.25,
          link: 'https://www.walmart.com/2',
        },
        {
          title: '93/7 Lean Ground Beef 1 lb',
          source: 'H-E-B',
          extracted_price: 6.49,
          link: 'https://www.heb.com/1',
        },
        {
          title: '93/7 Lean Ground Beef 1 lb',
          source: 'ALDI',
          extracted_price: 7.39,
          link: 'https://shop.aldi.us/2',
        },
      ],
    })
    const mnStores = ['Aldi', 'Cub', 'Target', 'Walmart', 'Costco', 'Amazon']

    const best = selectBestLiveSwap(
      {
        normalizedName: 'Good & Gather 93/7 Lean Ground Beef 1 lb',
        unitPriceCents: 799,
        storeName: 'Target',
      },
      candidates,
      mnStores,
    )
    expect(best?.retailer).toBe('Aldi')
    expect(best?.swapPriceCents).toBe(739)

    // Organic beef must never swap to cheaper non-organic beef.
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

describe('Exa shopping parser', () => {
  it('parses Exa shopping results and Instacart store slugs accurately', () => {
    const parsed = parseExaShoppingResults({
      results: [
        {
          title: 'Tide Liquid Laundry Detergent 92 oz',
          url: 'https://www.walmart.com/ip/tide-92oz/123',
          highlights: ['Current price $10.49 in stock'],
        },
        {
          title: '93/7 Lean Ground Beef 1 lb',
          url: 'https://www.instacart.com/store/cub-foods/products/99',
          highlights: ['$7.29 per lb'],
        },
        {
          title: 'No price blog post',
          url: 'https://example.com/blog',
          highlights: ['Great savings tips'],
        },
      ],
    })
    expect(parsed).toHaveLength(2)
    expect(parsed[0].merchant).toBe('Walmart')
    expect(parsed[0].priceCents).toBe(1049)
    expect(parsed[1].merchant).toBe('Cub')
    expect(parsed[1].priceCents).toBe(729)
  })
})

describe('receipt parser & assertions', () => {
  it('parses plain-text receipts and rejects promo ranges', () => {
    const parsed = parsePlainTextReceipt(SAMPLE_RECEIPT_TEXT)
    expect(parsed).not.toBeNull()
    expect(parsed?.storeName).toBe('Target')
    expect(parsed?.lines.length).toBeGreaterThanOrEqual(7)

    const withJunk = parsePlainTextReceipt('Target\n$7.99 - $39.99\nMilk 1 gal $3.49\nTOTAL $3.49')
    expect(withJunk?.lines).toHaveLength(1)
    expect(withJunk?.lines[0].unitPriceCents).toBe(349)
    expect(() => assert(false, 'boom')).toThrow('Assertion failed: boom')
  })
})
