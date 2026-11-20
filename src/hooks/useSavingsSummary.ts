import { useEffect, useState } from 'react'
import { useMutations, useQuery } from 'deepspace'
import { useToast } from '../components/ui'
import { invokeAction } from '../lib/actions-client'
import { computeDeterministicOpportunities } from '../lib/deals-engine'
import { parseJsonStringArray } from '../lib/email-parser'
import { computeNetStoreSavings, DEFAULT_STORES, storeMatchesAllowed } from '../lib/locality'
import { estimateTripsPerYear, projectAnnualSavingsCents } from '../lib/money'
import type { HouseholdData } from '../schemas/households-schema'
import type { ReceiptLineData } from '../schemas/receipt-lines-schema'
import type { ReceiptScanData } from '../schemas/receipt-scans-schema'

export interface LiveDeal {
  store: string
  title: string
  snippet: string
  url: string
}

function computePriceIncreases(lines: Array<{ data: ReceiptLineData }>) {
  const bySku = new Map<string, ReceiptLineData[]>()
  for (const row of lines) {
    const list = bySku.get(row.data.skuKey) ?? []
    list.push(row.data)
    bySku.set(row.data.skuKey, list)
  }

  return Array.from(bySku.entries())
    .filter(([, list]) => list.length >= 2)
    .map(([skuKey, list]) => {
      const sorted = [...list].sort((a, b) => a.purchasedAt.localeCompare(b.purchasedAt))
      const first = sorted[0]
      const latest = sorted[sorted.length - 1]
      return {
        skuKey,
        name: latest.normalizedName,
        first: first.unitPriceCents,
        latest: latest.unitPriceCents,
        diff: latest.unitPriceCents - first.unitPriceCents,
        trips: sorted.length,
      }
    })
    .filter((item) => item.diff > 0)
    .sort((a, b) => b.diff - a.diff)
}

export function useSavingsSummary() {
  const { records: households } = useQuery<HouseholdData>('households', { limit: 1 })
  const { records: scans } = useQuery<ReceiptScanData>('receipt_scans', {
    orderBy: 'scannedAt',
    orderDir: 'desc',
    limit: 50,
  })
  const { records: lines } = useQuery<ReceiptLineData>('receipt_lines', { limit: 300 })
  const { put: updateLine, ready: lineReady } =
    useMutations<Partial<ReceiptLineData>>('receipt_lines')
  const { success, error } = useToast()

  const hh = households[0]?.data
  const savedZip = hh?.zipCode ?? ''
  const savedStores = parseJsonStringArray(hh?.nearbyStores)
  const detectedMemberships = parseJsonStringArray(hh?.detectedMemberships)
  const hasPrime =
    hh?.hasPrime === 1 || detectedMemberships.some((m) => m.toLowerCase() === 'amazon prime')

  const [zipInput, setZipInput] = useState(savedZip)
  const [savingLocality, setSavingLocality] = useState(false)
  const [liveDeals, setLiveDeals] = useState<LiveDeal[]>([])
  const [loadingDeals, setLoadingDeals] = useState(false)

  useEffect(() => {
    if (savedZip) {
      setZipInput(savedZip)
    }
  }, [savedZip])

  const allowedStores = savedStores.length > 0 ? savedStores : DEFAULT_STORES
  const [allAreaStores, setAllAreaStores] = useState<string[]>(allowedStores)
  const rawNearbyStores = hh?.nearbyStores
  useEffect(() => {
    const parsed = parseJsonStringArray(rawNearbyStores)
    setAllAreaStores((prev) =>
      Array.from(new Set([...parsed, ...prev.filter((s) => parsed.includes(s))])),
    )
  }, [rawNearbyStores])

  const chipStores = allAreaStores.length > 0 ? allAreaStores : allowedStores
  const pendingCount = lines.filter((l) => l.data.swapStatus === 'pending').length

  const matchedLines = lines.filter(
    (l) => l.data.swapStatus === 'matched' && l.data.savingsCents > 0 && Boolean(l.data.swapName),
  )
  const storeSummaries = computeNetStoreSavings(
    matchedLines.map((l) => l.data),
    { allowedStores, hasPrime },
  )
  const worthItStores = new Set(
    Array.from(storeSummaries.values())
      .filter((s) => s.worthIt)
      .map((s) => s.store),
  )
  const topSwaps = matchedLines
    .filter(
      (l) =>
        storeMatchesAllowed(l.data.retailer, allowedStores) &&
        Boolean(l.data.retailer && worthItStores.has(l.data.retailer)),
    )
    .sort((a, b) => b.data.savingsCents - a.data.savingsCents)
    .slice(0, 6)

  const opportunities = computeDeterministicOpportunities(
    scans.map((s) => s.data),
    lines.map((l) => l.data),
    { hasPrime, detectedMemberships },
  ).filter((o) => o.estimatedAnnualSavingsCents > 0)

  const tripsPerYear = estimateTripsPerYear(scans.map((s) => s.data.purchasedAt))
  const netSwapTotal = Array.from(storeSummaries.values())
    .filter((s) => s.worthIt)
    .reduce((acc, s) => acc + s.netSavingsCents, 0)
  const annualSwaps = projectAnnualSavingsCents(
    scans.length > 0 ? Math.round(netSwapTotal / scans.length) : 0,
    tripsPerYear,
  )
  const annualSubs = opportunities.reduce((acc, o) => acc + o.estimatedAnnualSavingsCents, 0)
  const totalAnnual = annualSwaps + annualSubs
  const priceIncreases = computePriceIncreases(lines)

  async function saveLocality(nextZip: string, nextStores?: string[]) {
    setSavingLocality(true)
    try {
      const res = await invokeAction<{ requeuedItems?: number; nearbyStores?: string[] }>(
        'updateHouseholdLocality',
        {
          zipCode: nextZip,
          ...(nextStores ? { nearbyStores: nextStores } : {}),
          hasPrime,
          refreshSwaps: true,
        },
      )
      if (!res.success) {
        error('Could not save location', res.error ?? 'Unknown error')
      } else {
        if (!nextStores && res.data?.nearbyStores?.length) {
          setAllAreaStores(res.data.nearbyStores)
        }
        const queued = res.data?.requeuedItems ?? 0
        const storeCount = res.data?.nearbyStores?.length ?? 0
        success(
          nextZip ? `Found ${storeCount} stores near ${nextZip}` : 'Local stores updated',
          queued > 0 ? `Checking live prices for ${queued} items...` : 'Comparing stores in your area.',
        )
      }
    } finally {
      setSavingLocality(false)
    }
  }

  function toggleStore(store: string) {
    const active = allowedStores.includes(store)
    const next = active ? allowedStores.filter((s) => s !== store) : [...allowedStores, store]
    if (next.length > 0) {
      void saveLocality(zipInput, next)
    }
  }

  async function loadLiveDeals() {
    setLoadingDeals(true)
    try {
      const res = await invokeAction<{ deals: LiveDeal[] }>('fetchLiveStoreDeals')
      if (!res.success) {
        error('Could not load weekly ads', res.error ?? 'Unknown error')
      } else {
        setLiveDeals(res.data?.deals ?? [])
      }
    } finally {
      setLoadingDeals(false)
    }
  }

  function dismissSwap(lineId: string) {
    void updateLine(lineId, { swapStatus: 'dismissed' })
  }

  return {
    scansCount: scans.length,
    zipInput,
    setZipInput,
    savingLocality,
    allowedStores,
    chipStores,
    detectedMemberships,
    pendingCount,
    topSwaps,
    opportunities,
    priceIncreases,
    liveDeals,
    loadingDeals,
    annualSwaps,
    annualSubs,
    totalAnnual,
    lineReady,
    saveLocality,
    toggleStore,
    loadLiveDeals,
    dismissSwap,
  }
}
