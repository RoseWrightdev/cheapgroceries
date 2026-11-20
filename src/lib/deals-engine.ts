import type { ReceiptLineData } from '../schemas/receipt-lines-schema'
import type { ReceiptScanData } from '../schemas/receipt-scans-schema'
import type { OpportunityKind } from '../schemas/savings-opportunities-schema'

export interface ComputedOpportunity {
  kind: OpportunityKind
  title: string
  description: string
  storeOrProvider: string
  estimatedAnnualSavingsCents: number
  membershipCostCents: number
  breakEvenMonths: number
  actionUrl?: string
  actionLabel?: string
}

const SUBSCRIBE_ELIGIBLE_CATEGORIES = new Set(['Household', 'Pantry', 'Breakfast', 'Beverages'])

export function isSubscribeAndSaveEligible(category: string): boolean {
  return SUBSCRIBE_ELIGIBLE_CATEGORIES.has(category)
}

/**
 * Deterministic subscription break-even & store-membership analysis based on
 * the household's real audited receipts and line items.
 */
export function computeDeterministicOpportunities(
  scans: ReceiptScanData[],
  lines: ReceiptLineData[],
  options?: { hasPrime?: boolean; detectedMemberships?: string[] },
): ComputedOpportunity[] {
  if (scans.length === 0) return []

  const results: ComputedOpportunity[] = []
  const tripsPerYear = Math.max(12, Math.min(52, scans.length * 12))
  const memberships = new Set((options?.detectedMemberships ?? []).map((m) => m.toLowerCase()))
  const hasPrime = Boolean(options?.hasPrime) || memberships.has('amazon prime')
  const hasCostco = memberships.has('costco') || memberships.has('sam’s club')

  // 1. Amazon Subscribe & Save (5-15% off shelf-stable pantry & household items, $0 fee + free shipping)
  const subLines = lines.filter((l) => isSubscribeAndSaveEligible(l.category) && l.lineTotalCents > 0)
  if (subLines.length > 0) {
    const subSpendTotal = subLines.reduce((acc, l) => acc + l.lineTotalCents, 0)
    const avgSubSpendPerTrip = subSpendTotal / Math.max(1, scans.length)
    const discountRate = subLines.length >= 5 ? 0.15 : 0.05
    const annualSavings = Math.round(avgSubSpendPerTrip * tripsPerYear * discountRate)
    if (annualSavings >= 1500) {
      results.push({
        kind: 'subscription',
        title: `Amazon Subscribe & Save (${Math.round(discountRate * 100)}% off staples + free shipping)`,
        description: `You bought ${subLines.length} shelf-stable pantry & household items. Bundling 5+ recurring staples unlocks 15% off with free shipping and $0 membership fee.`,
        storeOrProvider: 'Amazon Subscribe & Save',
        estimatedAnnualSavingsCents: annualSavings,
        membershipCostCents: 0,
        breakEvenMonths: 0,
        actionUrl: 'https://www.amazon.com/subscribe-and-save',
        actionLabel: 'Browse Subscribe & Save',
      })
    }
  }

  // 1b. Amazon Prime ($139/yr) — automatically recommended ONLY when annualized
  // Amazon swap savings + avoided shipping beats the $139/yr membership fee.
  if (!hasPrime) {
    const amazonMatchedLines = lines.filter(
      (l) =>
        (l.retailer ?? '').toLowerCase().includes('amazon') &&
        l.savingsCents > 0 &&
        l.swapStatus !== 'dismissed',
    )
    if (amazonMatchedLines.length > 0) {
      const amazonSwapSavingsPerTrip =
        amazonMatchedLines.reduce(
          (acc, l) => acc + l.savingsCents * Math.max(1, Math.round(l.quantity || 1)),
          0,
        ) / Math.max(1, scans.length)
      const annualAmazonGrossSavings = Math.round(amazonSwapSavingsPerTrip * tripsPerYear)
      const primeFeeCents = 13900
      if (annualAmazonGrossSavings > primeFeeCents + 1500) {
        const netSavings = annualAmazonGrossSavings - primeFeeCents
        const breakEvenMonths = Math.max(
          1,
          Math.round((primeFeeCents / (annualAmazonGrossSavings / 12)) * 10) / 10,
        )
        results.push({
          kind: 'subscription',
          title: 'Amazon Prime (Free shipping on all swaps)',
          description: `Your Amazon swaps save ~${(annualAmazonGrossSavings / 100).toFixed(0)}/yr — enough to cover the $139/yr Prime fee in ${breakEvenMonths} months and unlock free shipping on every order.`,
          storeOrProvider: 'Amazon Prime',
          estimatedAnnualSavingsCents: netSavings,
          membershipCostCents: primeFeeCents,
          breakEvenMonths,
          actionUrl: 'https://www.amazon.com/amazonprime',
          actionLabel: 'Check Amazon Prime',
        })
      }
    }
  }

  // 2. Store-specific membership break-even checks
  const spendByStore = new Map<string, { totalCents: number; count: number }>()
  for (const s of scans) {
    const key = s.storeName.toLowerCase()
    const entry = spendByStore.get(key) ?? { totalCents: 0, count: 0 }
    entry.totalCents += s.totalCents
    entry.count += 1
    spendByStore.set(key, entry)
  }

  // Target Circle Card (free 5% off every Target order) + Target Circle 360
  const targetSpend = Array.from(spendByStore.entries())
    .filter(([k]) => k.includes('target'))
    .reduce((acc, [, v]) => acc + v.totalCents, 0)
  if (targetSpend > 0) {
    const projectedAnnualTarget = Math.round((targetSpend / Math.max(1, scans.length)) * tripsPerYear)
    const fivePercentSavings = Math.round(projectedAnnualTarget * 0.05)
    if (fivePercentSavings >= 1000) {
      results.push({
        kind: 'subscription',
        title: 'Target Circle Card (5% off every order)',
        description: `At your current Target pace, the free debit/reloadable Circle Card saves 5% automatically on every grocery pickup or delivery with $0 annual fee.`,
        storeOrProvider: 'Target Circle',
        estimatedAnnualSavingsCents: fivePercentSavings,
        membershipCostCents: 0,
        breakEvenMonths: 0,
        actionUrl: 'https://www.target.com/circle',
        actionLabel: 'Check Target Circle Deals',
      })
    }
  }

  // Costco Gold Star ($65/yr) break-even check — skip if already a Costco / Sam's Club member
  const totalSpend = scans.reduce((acc, s) => acc + s.totalCents, 0)
  const projectedAnnualTotal = Math.round((totalSpend / Math.max(1, scans.length)) * tripsPerYear)
  const estimatedBulkSavings = Math.round(projectedAnnualTotal * 0.12)
  const costcoFeeCents = 6500
  if (!hasCostco && estimatedBulkSavings > costcoFeeCents + 3000) {
    const netSavings = estimatedBulkSavings - costcoFeeCents
    const breakEvenMonths = Math.max(1, Math.round((costcoFeeCents / (estimatedBulkSavings / 12)) * 10) / 10)
    results.push({
      kind: 'subscription',
      title: 'Costco / Bulk Warehouse Membership',
      description: `Moving ~40% of your recurring staples to bulk warehouse sizing saves ~12% on unit prices — covering the $65/yr fee in about ${breakEvenMonths} months.`,
      storeOrProvider: 'Costco / Sam’s Club',
      estimatedAnnualSavingsCents: netSavings,
      membershipCostCents: costcoFeeCents,
      breakEvenMonths,
      actionUrl: 'https://www.costco.com/join-costco.html',
      actionLabel: 'Compare Membership',
    })
  }

  // Store digital coupons reminder tailored to their top store
  const topStore = scans[0]?.storeName
  if (topStore) {
    const storeLower = topStore.toLowerCase()
    const couponUrl = storeLower.includes('target')
      ? 'https://www.target.com/circle/offers'
      : storeLower.includes('kroger')
        ? 'https://www.kroger.com/savings/cl/coupons/'
        : storeLower.includes('walmart')
          ? 'https://www.walmart.com/shop/walmart-cash'
          : 'https://www.amazon.com/Coupons/b?node=2231352011'

    results.push({
      kind: 'coupon',
      title: `Clip weekly ${topStore} digital coupons before checkout`,
      description: `Stack manufacturer digital coupons and store-app offers on your repeat items at ${topStore} (typically 5–10% extra off on top of generic swaps).`,
      storeOrProvider: topStore,
      estimatedAnnualSavingsCents: Math.max(2400, Math.round(projectedAnnualTotal * 0.06)),
      membershipCostCents: 0,
      breakEvenMonths: 0,
      actionUrl: couponUrl,
      actionLabel: `Open ${topStore} Coupons`,
    })
  }

  return results
}
