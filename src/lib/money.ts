/**
 * Integer-cent monetary utilities.
 * All prices and savings are stored as integer cents to avoid floating-point drift.
 */

export function formatCents(cents: number): string {
  const safe = Number.isFinite(cents) ? Math.round(cents) : 0
  const sign = safe < 0 ? '-' : ''
  const abs = Math.abs(safe)
  const dollars = Math.floor(abs / 100)
  const rem = abs % 100
  return `${sign}$${dollars.toLocaleString('en-US')}.${rem.toString().padStart(2, '0')}`
}

/**
 * Parse a human price string such as "$4.98", "12.50", or "$1,299.00" into integer cents.
 * Returns null if unparseable or negative.
 */
export function parsePriceToCents(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
    return Math.round(raw * 100)
  }
  if (typeof raw !== 'string') return null
  const match = raw.replace(/,/g, '').match(/\$?\s*(\d+(?:\.\d{1,2})?)/)
  if (!match) return null
  const value = Number.parseFloat(match[1])
  if (!Number.isFinite(value) || value < 0) return null
  return Math.round(value * 100)
}

export function computeSavingsCents(paidCents: number, swapCents: number): number {
  if (!Number.isFinite(paidCents) || !Number.isFinite(swapCents)) return 0
  if (swapCents <= 0 || paidCents <= swapCents) return 0
  return Math.round(paidCents - swapCents)
}

export function computeSavingsPercent(paidCents: number, swapCents: number): number {
  if (paidCents <= 0 || swapCents <= 0 || swapCents >= paidCents) return 0
  return Math.round(((paidCents - swapCents) / paidCents) * 100)
}

/** Project annual household savings assuming weekly grocery cadence. */
export function projectAnnualSavingsCents(weeklySavingsCents: number): number {
  return Math.max(0, Math.round(weeklySavingsCents * 52))
}
