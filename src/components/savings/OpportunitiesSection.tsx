import { BadgePercent, ExternalLink, Repeat, Tag, X } from 'lucide-react'
import { formatCents } from '../../lib/money'
import type { OpportunityKind } from '../../schemas/savings-opportunities-schema'

export interface DisplayOpportunity {
  id: string
  saved: boolean
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

interface OpportunitiesSectionProps {
  opportunities: DisplayOpportunity[]
  filter: 'all' | OpportunityKind
  oppReady: boolean
  onFilterChange: (next: 'all' | OpportunityKind) => void
  onDismiss: (id: string) => void
}

function getKindMeta(kind: OpportunityKind) {
  if (kind === 'subscription') {
    return { label: 'Subscription', icon: Repeat, badgeClass: 'bg-accent text-primary' }
  }
  if (kind === 'coupon') {
    return { label: 'Coupon', icon: BadgePercent, badgeClass: 'bg-accent text-primary' }
  }
  return { label: 'Deal', icon: Tag, badgeClass: 'bg-secondary text-foreground' }
}

export function OpportunitiesSection({
  opportunities,
  filter,
  oppReady,
  onFilterChange,
  onDismiss,
}: OpportunitiesSectionProps) {
  if (opportunities.length === 0) return null

  const filtered =
    filter === 'all' ? opportunities : opportunities.filter((o) => o.kind === filter)

  return (
    <section className="space-y-4">
      <div className="inline-flex rounded-lg bg-secondary p-1 text-xs">
        {(
          [
            ['all', 'All'],
            ['subscription', 'Subscriptions'],
            ['coupon', 'Coupons'],
            ['deal', 'Deals'],
          ] as const
        )
          .filter(([key]) => key === 'all' || opportunities.some((opp) => opp.kind === key))
          .map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => onFilterChange(key)}
              className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
                filter === key ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground'
              }`}
            >
              {label}
            </button>
          ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {filtered.map((opp) => {
          const meta = getKindMeta(opp.kind)
          const Icon = meta.icon
          return (
            <div
              key={opp.id}
              className="flex flex-col justify-between rounded-xl border border-border bg-card p-5 shadow-xs"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${meta.badgeClass}`}
                  >
                    <Icon className="h-3 w-3" aria-hidden />
                    {meta.label}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold tabular-nums text-primary">
                      Save ~{formatCents(opp.estimatedAnnualSavingsCents)}/yr
                    </span>
                    {opp.saved && (
                      <button
                        type="button"
                        disabled={!oppReady}
                        onClick={() => onDismiss(opp.id)}
                        aria-label="Dismiss"
                        className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <h2 className="mt-3 text-base font-semibold text-foreground">{opp.title}</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  {opp.description}
                </p>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs">
                <div className="text-muted-foreground">
                  <span className="font-medium text-foreground">{opp.storeOrProvider}</span>
                  {opp.membershipCostCents > 0 && (
                    <span>
                      {' '}
                      · {formatCents(opp.membershipCostCents)}/yr
                      {opp.breakEvenMonths > 0 ? ` (pays off in ${opp.breakEvenMonths} mo)` : ''}
                    </span>
                  )}
                </div>

                {opp.actionUrl && (
                  <a
                    href={opp.actionUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                  >
                    {opp.actionLabel || 'View Offer'}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
