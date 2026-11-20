/**
 * Integer-cent monetary utilities.
 * All prices and savings are stored as integer cents to avoid float drift.
 */

import { assert } from './assert'

const MS_PER_DAY = 24 * 60 * 60 * 1000
const TRIPS_PER_YEAR_DEFAULT = 26
const TRIPS_PER_YEAR_MIN = 12
const TRIPS_PER_YEAR_MAX = 104
const SPAN_DAYS_MIN = 7

export function formatCents(cents: number): string {
  const safe = Number.isFinite(cents) ? Math.round(cents) : 0
  const sign = safe < 0 ? '-' : ''
  const abs = Math.abs(safe)
  const dollars = Math.floor(abs / 100)
  const remainder = abs % 100
  return `${sign}$${dollars.toLocaleString('en-US')}.${remainder.toString().padStart(2, '0')}`
}

export function parsePriceToCents(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
    return Math.round(raw * 100)
  }
  if (typeof raw !== 'string') {
    return null
  }
  const match = raw.replace(/,/g, '').match(/\$?\s*(\d+(?:\.\d{1,2})?)/)
  if (!match) {
    return null
  }
  const value = Number.parseFloat(match[1])
  if (!Number.isFinite(value) || value < 0) {
    return null
  }
  return Math.round(value * 100)
}

export function computeSavingsCents(paidCents: number, swapCents: number): number {
  if (!Number.isFinite(paidCents) || !Number.isFinite(swapCents)) {
    return 0
  }
  if (swapCents <= 0 || paidCents <= swapCents) {
    return 0
  }
  const savings = Math.round(paidCents - swapCents)
  assert(savings > 0, 'savings must be positive when paidCents > swapCents')
  return savings
}

export function computeSavingsPercent(paidCents: number, swapCents: number): number {
  if (paidCents <= 0 || swapCents <= 0 || swapCents >= paidCents) {
    return 0
  }
  return Math.round(((paidCents - swapCents) / paidCents) * 100)
}

/**
 * Derive trips/year from the actual date span of imported receipts.
 * Falls back to 26 trips/yr (bi-weekly) when fewer than 2 dates exist.
 */
export function estimateTripsPerYear(purchasedDates: string[]): number {
  const timestamps = purchasedDates
    .map((dateStr) => Date.parse(dateStr))
    .filter((ts) => Number.isFinite(ts))
    .sort((a, b) => a - b)

  if (timestamps.length < 2) {
    return TRIPS_PER_YEAR_DEFAULT
  }

  const first = timestamps[0]
  const last = timestamps[timestamps.length - 1]
  const spanDays = Math.max(SPAN_DAYS_MIN, (last - first) / MS_PER_DAY)
  const estimated = Math.round((timestamps.length / spanDays) * 365)

  return Math.max(TRIPS_PER_YEAR_MIN, Math.min(TRIPS_PER_YEAR_MAX, estimated))
}

export function projectAnnualSavingsCents(
  perTripSavingsCents: number,
  tripsPerYear = TRIPS_PER_YEAR_DEFAULT,
): number {
  assert(tripsPerYear > 0, 'tripsPerYear must be positive')
  return Math.max(0, Math.round(perTripSavingsCents * tripsPerYear))
}
