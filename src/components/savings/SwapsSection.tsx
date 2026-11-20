import { ExternalLink, X } from 'lucide-react'
import { resolveRetailerUrl } from '../../lib/locality'
import { formatCents } from '../../lib/money'
import type { ReceiptLineData } from '../../schemas/receipt-lines-schema'

interface SwapsSectionProps {
  swaps: Array<{ recordId: string; data: ReceiptLineData }>
  lineReady: boolean
  onDismiss: (lineId: string) => void
}

export function SwapsSection({ swaps, lineReady, onDismiss }: SwapsSectionProps) {
  if (swaps.length === 0) return null

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-sm font-semibold">Cheaper Store &amp; Generic Swaps</h2>
      <div className="mt-3 divide-y divide-border">
        {swaps.map((line) => (
          <div
            key={line.recordId}
            className="flex flex-wrap items-center justify-between gap-3 py-3"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{line.data.normalizedName}</div>
              <div className="mt-0.5 truncate text-xs text-primary">
                Swap → {line.data.swapName}
                {line.data.retailer ? ` (${line.data.retailer})` : ''}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right font-mono tabular-nums">
                <div className="text-[11px] text-muted-foreground line-through">
                  {formatCents(line.data.unitPriceCents)}
                </div>
                <div className="text-xs font-semibold text-primary">
                  {formatCents(line.data.swapPriceCents)} (-{formatCents(line.data.savingsCents)})
                </div>
              </div>
              {line.data.swapName && (
                <a
                  href={resolveRetailerUrl(
                    line.data.retailer,
                    line.data.swapName,
                    line.data.retailerUrl,
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
                >
                  Shop {line.data.retailer || 'Now'}
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
              <button
                type="button"
                disabled={!lineReady}
                onClick={() => onDismiss(line.recordId)}
                title="Dismiss swap"
                className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
