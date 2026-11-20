import { ExternalLink, X } from 'lucide-react'
import { resolveRetailerUrl } from '../lib/locality'
import { computeSavingsPercent, formatCents } from '../lib/money'
import type { ReceiptLineData } from '../schemas/receipt-lines-schema'

interface SwapRowProps {
  lineId: string
  line: ReceiptLineData
  showOriginal?: boolean
  ready: boolean
  onDismiss: (lineId: string) => void
}

export function SwapRow({ lineId, line, showOriginal = false, ready, onDismiss }: SwapRowProps) {
  if (!line.swapName || line.savingsCents <= 0) return null
  const pct = computeSavingsPercent(line.unitPriceCents, line.swapPriceCents)
  const href = resolveRetailerUrl(line.retailer, line.swapName, line.retailerUrl)

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0 flex-1">
        {showOriginal && <div className="truncate text-sm font-medium">{line.normalizedName}</div>}
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-primary">
          <span className="truncate font-medium">
            {showOriginal ? `Swap → ${line.swapName}` : line.swapName}
            {line.retailer ? ` (${line.retailer})` : ''}
          </span>
          {line.snapEligible === 1 && (
            <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold">SNAP</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2.5">
        <div className="text-right font-mono tabular-nums">
          {showOriginal && (
            <div className="text-[11px] text-muted-foreground line-through">
              {formatCents(line.unitPriceCents)}
            </div>
          )}
          <div className="text-xs font-semibold text-primary">
            {formatCents(line.swapPriceCents)} (-{formatCents(line.savingsCents)} / {pct}%)
          </div>
        </div>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
        >
          Shop {line.retailer || 'Now'}
          <ExternalLink className="h-3 w-3" />
        </a>
        <button
          type="button"
          disabled={!ready}
          onClick={() => onDismiss(lineId)}
          title="Dismiss swap"
          className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
