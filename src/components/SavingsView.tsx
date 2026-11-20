import { useEffect, useState } from 'react'
import { useMutations, useQuery } from 'deepspace'
import { CheckCircle2, Loader2, Sparkles, TrendingUp } from 'lucide-react'
import { Button, useToast } from './ui'
import { LocalityBar } from './savings/LocalityBar'
import { OpportunitiesSection, type DisplayOpportunity } from './savings/OpportunitiesSection'
import { SwapsSection } from './savings/SwapsSection'
import { invokeAction } from '../lib/actions-client'
import { computeDeterministicOpportunities } from '../lib/deals-engine'
import { parseDetectedMemberships } from '../lib/email-parser'
import {
  computeNetStoreSavings,
  getRegionalStoresForZip,
  parseNearbyStores,
  storeMatchesAllowed,
} from '../lib/locality'
import { formatCents, projectAnnualSavingsCents } from '../lib/money'
import type { HouseholdData } from '../schemas/households-schema'
import type { ReceiptLineData } from '../schemas/receipt-lines-schema'
import type { ReceiptScanData } from '../schemas/receipt-scans-schema'
import type {
  OpportunityKind,
  SavingsOpportunityData,
} from '../schemas/savings-opportunities-schema'

interface SavingsViewProps {
  householdId?: string
  headerActions?: React.ReactNode
}

export function SavingsView({ householdId, headerActions }: SavingsViewProps) {
  const scopeWhere = householdId ? { householdId } : undefined
  const { records: households } = useQuery<HouseholdData>('households', { limit: 1 })
  const { records: scans } = useQuery<ReceiptScanData>('receipt_scans', {
    where: scopeWhere,
    orderBy: 'scannedAt',
    orderDir: 'desc',
    limit: 50,
  })
  const { records: lines } = useQuery<ReceiptLineData>('receipt_lines', {
    where: scopeWhere,
    limit: 300,
  })
  const { records: savedOpportunities } = useQuery<SavingsOpportunityData>(
    'savings_opportunities',
    { where: scopeWhere, limit: 50 },
  )
  const { put: updateOpp, ready: oppReady } =
    useMutations<Partial<SavingsOpportunityData>>('savings_opportunities')
  const { put: updateLine, ready: lineReady } =
    useMutations<Partial<ReceiptLineData>>('receipt_lines')
  const { success, error } = useToast()

  const activeHousehold = households[0]?.data
  const savedZip = activeHousehold?.zipCode ?? ''
  const savedStores = parseNearbyStores(activeHousehold?.nearbyStores)
  const detectedMemberships = parseDetectedMemberships(activeHousehold?.detectedMemberships)
  const hasPrime =
    activeHousehold?.hasPrime === 1 ||
    detectedMemberships.some((m) => m.toLowerCase() === 'amazon prime')

  const [zipInput, setZipInput] = useState(savedZip)
  const [savingLocality, setSavingLocality] = useState(false)
  const [filter, setFilter] = useState<'all' | OpportunityKind>('all')
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    if (savedZip) setZipInput(savedZip)
  }, [savedZip])

  const allowedStores =
    savedStores.length > 0 ? savedStores : getRegionalStoresForZip(zipInput || savedZip)
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

  const activeSaved = savedOpportunities.filter(
    (o) => o.data.dismissed !== 1 && (o.data.estimatedAnnualSavingsCents ?? 0) > 0,
  )
  const allOpportunities: DisplayOpportunity[] =
    activeSaved.length > 0
      ? activeSaved.map((r) => ({ id: r.recordId, saved: true, ...r.data }))
      : computeDeterministicOpportunities(
          scans.map((s) => s.data),
          lines.map((l) => l.data),
          { hasPrime, detectedMemberships },
        )
          .filter((o) => o.estimatedAnnualSavingsCents > 0)
          .map((o, idx) => ({ id: `preview_${idx}`, saved: false, ...o }))

  const netSwapSavingsTotal = Array.from(storeSummaries.values())
    .filter((s) => s.worthIt)
    .reduce((acc, s) => acc + s.netSavingsCents, 0)
  const totalSwapSavingsPerTrip =
    scans.length > 0 ? Math.round(netSwapSavingsTotal / scans.length) : 0
  const annualSwapSavingsCents = projectAnnualSavingsCents(totalSwapSavingsPerTrip)
  const annualSubscriptionSavingsCents = allOpportunities
    .filter((o) => o.kind === 'subscription')
    .reduce((acc, o) => acc + o.estimatedAnnualSavingsCents, 0)
  const annualCouponDealSavingsCents = allOpportunities
    .filter((o) => o.kind === 'coupon' || o.kind === 'deal')
    .reduce((acc, o) => acc + o.estimatedAnnualSavingsCents, 0)
  const totalAnnualSavingsCents =
    annualSwapSavingsCents + annualSubscriptionSavingsCents + annualCouponDealSavingsCents

  const bySku = new Map<string, ReceiptLineData[]>()
  for (const row of lines) {
    const list = bySku.get(row.data.skuKey) ?? []
    list.push(row.data)
    bySku.set(row.data.skuKey, list)
  }
  const priceIncreases = Array.from(bySku.entries())
    .filter(([, list]) => list.length >= 2)
    .map(([skuKey, list]) => {
      const sorted = [...list].sort((a, b) => a.purchasedAt.localeCompare(b.purchasedAt))
      const first = sorted[0]
      const latest = sorted[sorted.length - 1]
      return {
        skuKey,
        name: latest.normalizedName,
        firstPriceCents: first.unitPriceCents,
        latestPriceCents: latest.unitPriceCents,
        diffCents: latest.unitPriceCents - first.unitPriceCents,
        trips: sorted.length,
      }
    })
    .filter((item) => item.diffCents > 0)
    .sort((a, b) => b.diffCents - a.diffCents)

  async function handleSaveLocality(nextZip: string, nextStores: string[]) {
    setSavingLocality(true)
    try {
      const res = await invokeAction<{ requeuedItems?: number }>('updateHouseholdLocality', {
        zipCode: nextZip,
        nearbyStores: nextStores,
        hasPrime,
        refreshSwaps: true,
      })
      if (!res.success) {
        error('Could not save location', res.error ?? 'Unknown error')
      } else {
        const queued = res.data?.requeuedItems ?? 0
        success(
          nextZip ? `Updated area to ${nextZip}` : 'Local stores updated',
          queued > 0
            ? `Checking live prices for ${queued} items at your nearby stores...`
            : 'Only comparing against stores in your area.',
        )
      }
    } finally {
      setSavingLocality(false)
    }
  }

  async function handleToggleStore(store: string) {
    const exists = allowedStores.includes(store)
    const next = exists ? allowedStores.filter((s) => s !== store) : [...allowedStores, store]
    if (next.length === 0) return
    await handleSaveLocality(zipInput, next)
  }

  async function handleFindDeals() {
    setRefreshing(true)
    try {
      const res = await invokeAction<{ count: number }>('analyzeSavingsOpportunities')
      if (!res.success) {
        error('Could not refresh deals', res.error ?? 'Check a receipt first.')
      } else {
        success('Savings updated', `Found ${res.data?.count ?? 0} ways to save on your groceries.`)
      }
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Your Savings</h1>
          <p className="text-sm text-muted-foreground">
            Swaps, coupons, deals, and subscriptions that actually beat what you paid.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {headerActions}
          {scans.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              data-testid="find-deals-btn"
              disabled={refreshing}
              onClick={() => void handleFindDeals()}
              className="inline-flex items-center gap-1.5"
            >
              {refreshing ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Checking...
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  Refresh Deals
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      <LocalityBar
        zipInput={zipInput}
        savedZip={savedZip}
        allowedStores={allowedStores}
        detectedMemberships={detectedMemberships}
        savingLocality={savingLocality}
        onZipChange={setZipInput}
        onSubmitZip={(zip, regional) => void handleSaveLocality(zip, regional)}
        onToggleStore={(store) => void handleToggleStore(store)}
      />

      {pendingCount > 0 && (
        <div className="flex items-center gap-2.5 rounded-xl border border-primary/25 bg-accent/50 px-4 py-3 text-sm text-foreground">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden />
          <span>
            Checking live prices{savedZip ? ` near ${savedZip}` : ''} for{' '}
            <span className="font-mono font-semibold">{pendingCount}</span>{' '}
            {pendingCount === 1 ? 'item' : 'items'} — new swaps will appear automatically.
          </span>
        </div>
      )}

      {pendingCount === 0 &&
      totalAnnualSavingsCents === 0 &&
      topSwaps.length === 0 &&
      priceIncreases.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card px-6 py-14 text-center">
          <CheckCircle2 className="mx-auto h-9 w-9 text-primary" aria-hidden />
          <h2 className="mt-3 text-base font-semibold text-foreground">
            You’re already getting great prices
          </h2>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
            We didn’t find any coupons, subscriptions, or cheaper swaps that beat your recent
            receipts.
          </p>
        </div>
      ) : (
        <>
          {totalAnnualSavingsCents > 0 && (
            <div className="rounded-2xl border border-primary/25 bg-card p-6 shadow-xs">
              <div className="flex flex-wrap items-end justify-between gap-6">
                <div>
                  <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Total Estimated Yearly Savings
                  </div>
                  <div
                    data-testid="kpi-savings-found"
                    className="mt-1 font-mono text-4xl font-bold tabular-nums text-primary"
                  >
                    {formatCents(totalAnnualSavingsCents)}
                    <span className="text-base font-normal text-muted-foreground"> / yr</span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-6 font-mono tabular-nums">
                  {annualSwapSavingsCents > 0 && (
                    <div>
                      <div className="font-sans text-xs text-muted-foreground">Store Swaps</div>
                      <div className="text-base font-semibold text-foreground">
                        {formatCents(annualSwapSavingsCents)}
                      </div>
                    </div>
                  )}
                  {annualSubscriptionSavingsCents > 0 && (
                    <div>
                      <div className="font-sans text-xs text-muted-foreground">Subscriptions</div>
                      <div className="text-base font-semibold text-foreground">
                        {formatCents(annualSubscriptionSavingsCents)}
                      </div>
                    </div>
                  )}
                  {annualCouponDealSavingsCents > 0 && (
                    <div>
                      <div className="font-sans text-xs text-muted-foreground">
                        Coupons &amp; Deals
                      </div>
                      <div className="text-base font-semibold text-foreground">
                        {formatCents(annualCouponDealSavingsCents)}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <SwapsSection
            swaps={topSwaps}
            lineReady={lineReady}
            onDismiss={(id) => void updateLine(id, { swapStatus: 'dismissed' })}
          />

          <OpportunitiesSection
            opportunities={allOpportunities}
            filter={filter}
            oppReady={oppReady}
            onFilterChange={setFilter}
            onDismiss={(id) => void updateOpp(id, { dismissed: 1 })}
          />

          {priceIncreases.length > 0 && (
            <section className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-destructive" aria-hidden />
                <h2 className="text-sm font-semibold">Prices That Went Up</h2>
              </div>
              <div className="mt-4 divide-y divide-border">
                {priceIncreases.map((item) => (
                  <div
                    key={item.skuKey}
                    className="flex items-center justify-between py-2.5 text-sm"
                  >
                    <div>
                      <div className="font-medium">{item.name}</div>
                      <div className="text-xs text-muted-foreground">
                        Seen on {item.trips} receipts
                      </div>
                    </div>
                    <div className="font-mono tabular-nums">
                      <span className="text-muted-foreground">
                        {formatCents(item.firstPriceCents)}
                      </span>
                      <span className="mx-2 text-muted-foreground">→</span>
                      <span className="font-semibold">{formatCents(item.latestPriceCents)}</span>
                      <span className="ml-2 rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-semibold text-destructive">
                        +{formatCents(item.diffCents)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
