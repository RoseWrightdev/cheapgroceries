import { BadgePercent, CheckCircle2, ExternalLink, Loader2, MapPin, Repeat, Sparkles, TrendingUp } from 'lucide-react'
import { Button, Input } from './ui'
import { SwapRow } from './SwapRow'
import { useSavingsSummary } from '../hooks/useSavingsSummary'
import { formatCents } from '../lib/money'

export function SavingsView({ headerActions }: { headerActions?: React.ReactNode }) {
  const s = useSavingsSummary()
  const isEmpty =
    s.pendingCount === 0 &&
    s.totalAnnual === 0 &&
    s.topSwaps.length === 0 &&
    s.priceIncreases.length === 0 &&
    s.liveDeals.length === 0

  return (
    <div className="mx-auto max-w-5xl space-y-7 px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Your Savings</h1>
          <p className="text-sm text-muted-foreground">
            Live local swaps, weekly ads, and memberships that beat what you paid.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {s.pendingCount > 0 && (
            <Loader2
              className="h-4 w-4 animate-spin text-primary"
              aria-label={`Checking ${s.pendingCount} items`}
            />
          )}
          {headerActions}
          {s.scansCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              disabled={s.loadingDeals}
              onClick={() => void s.loadLiveDeals()}
              className="inline-flex items-center gap-1.5"
            >
              {s.loadingDeals ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Finding ads...
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5 text-primary" /> Weekly Ads
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {/* ZIP & Nearby Stores Bar */}
      <div className="space-y-2.5 rounded-xl border border-border bg-card px-4 py-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void s.saveLocality(s.zipInput)
            }}
            className="flex items-center gap-2"
          >
            <MapPin className="h-3.5 w-3.5 text-primary" />
            <span className="font-medium">Your ZIP:</span>
            <Input
              value={s.zipInput}
              onChange={(e) => s.setZipInput(e.target.value.replace(/\D/g, '').slice(0, 5))}
              placeholder="55414"
              className="h-7 w-24 font-mono text-xs"
              aria-label="ZIP code"
            />
            <Button
              type="submit"
              size="sm"
              variant="outline"
              className="h-7 px-2.5 text-xs"
              disabled={s.savingLocality || s.zipInput.length < 5}
            >
              {s.savingLocality ? 'Saving...' : 'Set Area'}
            </Button>
          </form>
          {s.detectedMemberships.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
              <span>Active from email:</span>
              {s.detectedMemberships.map((m) => (
                <span
                  key={m}
                  className="rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-medium text-primary"
                >
                  {m}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">Comparing near you:</span>
          {s.chipStores.map((store) => {
            const active = s.allowedStores.includes(store)
            return (
              <button
                key={store}
                type="button"
                onClick={() => s.toggleStore(store)}
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                  active ? 'bg-accent text-primary' : 'bg-secondary/60 text-muted-foreground line-through'
                }`}
              >
                {store}
              </button>
            )
          })}
        </div>
      </div>

      {isEmpty ? (
        <div className="rounded-2xl border border-border bg-card px-6 py-14 text-center">
          <CheckCircle2 className="mx-auto h-9 w-9 text-primary" />
          <h2 className="mt-3 text-base font-semibold">You’re already getting great prices</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            No cheaper local swaps or memberships beat your recent receipts.
          </p>
        </div>
      ) : (
        <>
          {s.totalAnnual > 0 && (
            <div className="flex flex-wrap items-end justify-between gap-6 rounded-2xl border border-primary/25 bg-card p-6 shadow-xs">
              <div>
                <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Total Estimated Yearly Savings
                </div>
                <div
                  data-testid="kpi-savings-found"
                  className="mt-1 font-mono text-4xl font-bold tabular-nums text-primary"
                >
                  {formatCents(s.totalAnnual)}
                  <span className="text-base font-normal text-muted-foreground"> / yr</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-6 font-mono tabular-nums">
                {s.annualSwaps > 0 && (
                  <div>
                    <div className="font-sans text-xs text-muted-foreground">Store Swaps</div>
                    <div className="text-base font-semibold">{formatCents(s.annualSwaps)}</div>
                  </div>
                )}
                {s.annualSubs > 0 && (
                  <div>
                    <div className="font-sans text-xs text-muted-foreground">Subscriptions</div>
                    <div className="text-base font-semibold">{formatCents(s.annualSubs)}</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {s.topSwaps.length > 0 && (
            <section className="rounded-xl border border-border bg-card p-5">
              <h2 className="text-sm font-semibold">Cheaper Store &amp; Generic Swaps</h2>
              <div className="mt-2 divide-y divide-border">
                {s.topSwaps.map((line) => (
                  <SwapRow
                    key={line.recordId}
                    lineId={line.recordId}
                    line={line.data}
                    showOriginal
                    ready={s.lineReady}
                    onDismiss={s.dismissSwap}
                  />
                ))}
              </div>
            </section>
          )}

          {s.opportunities.length > 0 && (
            <section className="grid gap-4 md:grid-cols-2">
              {s.opportunities.map((opp, idx) => (
                <div
                  key={idx}
                  className="flex flex-col justify-between rounded-xl border border-border bg-card p-5 shadow-xs"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-medium text-primary">
                        <Repeat className="h-3 w-3" /> Subscription
                      </span>
                      <span className="font-mono text-sm font-bold tabular-nums text-primary">
                        Save ~{formatCents(opp.estimatedAnnualSavingsCents)}/yr
                      </span>
                    </div>
                    <h3 className="mt-3 text-base font-semibold">{opp.title}</h3>
                    <p className="mt-1.5 text-sm text-muted-foreground">{opp.description}</p>
                  </div>
                  <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
                    <span>
                      <strong className="text-foreground">{opp.storeOrProvider}</strong>
                      {opp.membershipCostCents > 0
                        ? ` · ${formatCents(opp.membershipCostCents)}/yr (${opp.breakEvenMonths} mo payoff)`
                        : ''}
                    </span>
                    {opp.actionUrl && (
                      <a
                        href={opp.actionUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                      >
                        {opp.actionLabel || 'View'} <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </section>
          )}

          {s.liveDeals.length > 0 && (
            <section className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-2">
                <BadgePercent className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold">Live Weekly Ads &amp; Coupons</h2>
              </div>
              <div className="mt-3 divide-y divide-border">
                {s.liveDeals.map((deal, idx) => (
                  <div key={idx} className="flex items-start justify-between gap-4 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-accent px-2 py-0.5 text-[11px] font-medium text-primary">
                          {deal.store}
                        </span>
                        <span className="truncate text-sm font-medium">{deal.title}</span>
                      </div>
                      {deal.snippet && (
                        <p className="mt-1 text-xs text-muted-foreground">{deal.snippet}</p>
                      )}
                    </div>
                    <a
                      href={deal.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-secondary"
                    >
                      Open <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                ))}
              </div>
            </section>
          )}

          {s.priceIncreases.length > 0 && (
            <section className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-destructive" />
                <h2 className="text-sm font-semibold">Prices That Went Up</h2>
              </div>
              <div className="mt-3 divide-y divide-border">
                {s.priceIncreases.map((item) => (
                  <div key={item.skuKey} className="flex items-center justify-between py-2.5 text-sm">
                    <div>
                      <div className="font-medium">{item.name}</div>
                      <div className="text-xs text-muted-foreground">Seen on {item.trips} receipts</div>
                    </div>
                    <div className="font-mono tabular-nums">
                      <span className="text-muted-foreground">{formatCents(item.first)}</span> →{' '}
                      <span className="font-semibold">{formatCents(item.latest)}</span>
                      <span className="ml-2 rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-semibold text-destructive">
                        +{formatCents(item.diff)}
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
