import type { ReceiptLineData } from '../schemas/receipt-lines-schema'
import type { ReceiptScanData } from '../schemas/receipt-scans-schema'
import { estimateTripsPerYear } from './money'

export type OpportunityKind = 'subscription' | 'coupon'

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

const SUBSCRIBE_CATEGORIES = new Set(['Household', 'Pantry', 'Breakfast', 'Beverages'])
const PRIME_FEE_CENTS = 13_900
const PRIME_NET_BUFFER_CENTS = 1_500
const SUBSCRIBE_MIN_SAVINGS_CENTS = 1_500
const TARGET_CARD_MIN_SAVINGS_CENTS = 1_000

function buildSubscribeAndSave(
  scansCount: number,
  lines: ReceiptLineData[],
  tripsPerYear: number,
): ComputedOpportunity | null {
  const eligible = lines.filter(
    (line) => SUBSCRIBE_CATEGORIES.has(line.category) && line.lineTotalCents > 0,
  )
  if (eligible.length === 0) {
    return null
  }

  const rate = eligible.length >= 5 ? 0.15 : 0.05
  const totalSpend = eligible.reduce((acc, line) => acc + line.lineTotalCents, 0)
  const annual = Math.round((totalSpend / scansCount) * tripsPerYear * rate)
  if (annual < SUBSCRIBE_MIN_SAVINGS_CENTS) {
    return null
  }

  return {
    kind: 'subscription',
    title: `Amazon Subscribe & Save (${Math.round(rate * 100)}% off staples + free shipping)`,
    description: [
      `Based on ${eligible.length} shelf-stable pantry & household items you bought.`,
      "Bundling 5+ items unlocks Amazon's published 15% tier with $0 fee.",
    ].join(' '),
    storeOrProvider: 'Amazon Subscribe & Save',
    estimatedAnnualSavingsCents: annual,
    membershipCostCents: 0,
    breakEvenMonths: 0,
    actionUrl: 'https://www.amazon.com/subscribe-and-save',
    actionLabel: 'Browse Subscribe & Save',
  }
}

function buildAmazonPrime(
  scansCount: number,
  lines: ReceiptLineData[],
  tripsPerYear: number,
): ComputedOpportunity | null {
  const amazonLines = lines.filter(
    (line) =>
      (line.retailer ?? '').toLowerCase().includes('amazon') &&
      line.savingsCents > 0 &&
      line.swapStatus !== 'dismissed',
  )
  const totalSavings = amazonLines.reduce(
    (acc, line) => acc + line.savingsCents * Math.max(1, Math.round(line.quantity || 1)),
    0,
  )
  const grossAnnual = Math.round((totalSavings / scansCount) * tripsPerYear)
  if (grossAnnual <= PRIME_FEE_CENTS + PRIME_NET_BUFFER_CENTS) {
    return null
  }

  const breakEvenMonths = Math.max(
    1,
    Math.round((PRIME_FEE_CENTS / (grossAnnual / 12)) * 10) / 10,
  )
  return {
    kind: 'subscription',
    title: 'Amazon Prime (Free shipping on all swaps)',
    description: [
      `Your live Amazon swaps save ~$${(grossAnnual / 100).toFixed(0)}/yr —`,
      `covering the $139/yr Prime fee in ${breakEvenMonths} months.`,
    ].join(' '),
    storeOrProvider: 'Amazon Prime',
    estimatedAnnualSavingsCents: grossAnnual - PRIME_FEE_CENTS,
    membershipCostCents: PRIME_FEE_CENTS,
    breakEvenMonths,
    actionUrl: 'https://www.amazon.com/amazonprime',
    actionLabel: 'Check Amazon Prime',
  }
}

function buildTargetCircleCard(
  scans: ReceiptScanData[],
  tripsPerYear: number,
): ComputedOpportunity | null {
  const targetSpend = scans
    .filter((scan) => scan.storeName.toLowerCase().includes('target'))
    .reduce((acc, scan) => acc + scan.totalCents, 0)
  const annualFivePct = Math.round((targetSpend / scans.length) * tripsPerYear * 0.05)
  if (annualFivePct < TARGET_CARD_MIN_SAVINGS_CENTS) {
    return null
  }

  return {
    kind: 'subscription',
    title: 'Target Circle Card (5% off every Target order)',
    description: [
      'Target’s free debit/reloadable Circle Card takes 5% off every',
      'grocery order automatically with $0 annual fee.',
    ].join(' '),
    storeOrProvider: 'Target Circle',
    estimatedAnnualSavingsCents: annualFivePct,
    membershipCostCents: 0,
    breakEvenMonths: 0,
    actionUrl: 'https://www.target.com/circle',
    actionLabel: 'Check Target Circle',
  }
}

/**
 * Strictly verifiable membership math based only on published fees/discounts
 * applied to the household's actual receipt spend and live verified swaps.
 */
export function computeDeterministicOpportunities(
  scans: ReceiptScanData[],
  lines: ReceiptLineData[],
  options?: { hasPrime?: boolean; detectedMemberships?: string[] },
): ComputedOpportunity[] {
  if (scans.length === 0) {
    return []
  }

  const tripsPerYear = estimateTripsPerYear(scans.map((scan) => scan.purchasedAt))
  const memberships = new Set((options?.detectedMemberships ?? []).map((m) => m.toLowerCase()))
  const hasPrime = Boolean(options?.hasPrime) || memberships.has('amazon prime')

  const candidates = [
    buildSubscribeAndSave(scans.length, lines, tripsPerYear),
    hasPrime ? null : buildAmazonPrime(scans.length, lines, tripsPerYear),
    buildTargetCircleCard(scans, tripsPerYear),
  ]
  return candidates.filter((item): item is ComputedOpportunity => item !== null)
}
