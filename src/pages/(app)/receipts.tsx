import { useState } from 'react'
import { AuthOverlay, useAuthProfileReady, useMutations, useQuery } from 'deepspace'
import {
  ExternalLink,
  Loader2,
  Mail,
  ReceiptText,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { ScanReceiptModal } from '../../components/ScanReceiptModal'
import { Button, useToast } from '../../components/ui'
import { invokeAction } from '../../lib/actions-client'
import { resolveRetailerUrl } from '../../lib/locality'
import { computeSavingsPercent, formatCents } from '../../lib/money'
import type { ReceiptLineData } from '../../schemas/receipt-lines-schema'
import type { ReceiptScanData } from '../../schemas/receipt-scans-schema'

export default function ReceiptsPage() {
  const { isSignedIn } = useAuthProfileReady({ requireUser: true })
  const [showAuthModal, setShowAuthModal] = useState(false)

  if (!isSignedIn) {
    return (
      <div className="mx-auto max-w-md px-6 py-20 text-center">
        <ReceiptText className="mx-auto h-8 w-8 text-muted-foreground" />
        <h1 className="mt-3 text-lg font-semibold">Sign in to view Receipt History</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your receipts and local store swaps are private to your account.
        </p>
        <Button className="mt-5" onClick={() => setShowAuthModal(true)}>
          Sign In
        </Button>
        {showAuthModal && <AuthOverlay onClose={() => setShowAuthModal(false)} />}
      </div>
    )
  }

  return <ReceiptsContent />
}

function ReceiptsContent() {
  const { records: scans } = useQuery<ReceiptScanData>('receipt_scans', {
    orderBy: 'scannedAt',
    orderDir: 'desc',
    limit: 50,
  })
  const { records: allLines } = useQuery<ReceiptLineData>('receipt_lines', {
    limit: 300,
  })
  const { put: updateLine, ready: linesReady } = useMutations<Partial<ReceiptLineData>>('receipt_lines')
  const { success, error } = useToast()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [scannerOpen, setScannerOpen] = useState(false)

  const activeScan = scans.find((s) => s.recordId === selectedId) ?? scans[0] ?? null
  const activeLines = activeScan
    ? allLines.filter((l) => l.data.receiptScanId === activeScan.recordId)
    : []

  async function handleDismiss(lineId: string) {
    await updateLine(lineId, { swapStatus: 'dismissed' })
  }

  async function handleDeleteReceipt(receiptScanId: string) {
    const res = await invokeAction('deleteReceipt', { receiptScanId })
    if (!res.success) {
      error('Could not delete receipt', res.error ?? 'Unknown error')
    } else {
      setSelectedId(null)
      success('Receipt removed', 'You can re-run Check Groceries to re-import it.')
    }
  }

  async function handleRecheckSwaps(receiptScanId: string) {
    const res = await invokeAction<{ queued: number }>('recheckReceiptSwaps', { receiptScanId })
    if (!res.success) {
      error('Could not check cheaper stores', res.error ?? 'Unknown error')
    } else {
      success(
        'Checking live store prices',
        `Comparing ${res.data?.queued ?? 0} items against live local listings — results will appear shortly.`,
      )
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Receipt History</h1>
          <p className="text-sm text-muted-foreground">
            Inspect extracted line items, compare generic swaps, and see cheaper local options.
          </p>
        </div>
        <Button onClick={() => setScannerOpen(true)} className="inline-flex items-center gap-2">
          <Mail className="h-4 w-4" />
          Check Email
        </Button>
      </div>

      {scans.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card px-6 py-16 text-center">
          <ReceiptText className="mx-auto h-8 w-8 text-muted-foreground" />
          <h2 className="mt-3 text-base font-semibold">No receipts checked yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Check your email receipts to find your first grocery savings.
          </p>
          <Button className="mt-5" onClick={() => setScannerOpen(true)}>
            Check Email
          </Button>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-12">
          <aside className="space-y-2.5 lg:col-span-4">
            {scans.map((scan) => {
              const selected = activeScan?.recordId === scan.recordId
              return (
                <button
                  key={scan.recordId}
                  type="button"
                  onClick={() => setSelectedId(scan.recordId)}
                  className={`w-full rounded-xl border p-4 text-left transition-colors ${
                    selected
                      ? 'border-primary bg-accent/40'
                      : 'border-border bg-card hover:bg-secondary/50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-foreground">
                        {scan.data.storeName}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {scan.data.purchasedAt} · {scan.data.lineCount} lines
                      </div>
                    </div>
                    <div className="shrink-0 text-right font-mono tabular-nums">
                      {scan.data.potentialSavingsCents > 0 ? (
                        <div className="text-sm font-bold text-primary">
                          -{formatCents(scan.data.potentialSavingsCents)}
                        </div>
                      ) : (
                        <div className="text-xs font-medium text-muted-foreground">Best prices</div>
                      )}
                      <div className="text-[11px] text-muted-foreground">
                        {formatCents(scan.data.totalCents)}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2.5 flex flex-wrap gap-1.5 text-[11px]">
                    {scan.data.source === 'gmail' ? (
                      <span className="rounded bg-accent px-2 py-0.5 font-medium text-primary">
                        Email Receipt
                      </span>
                    ) : (
                      <span className="rounded bg-secondary px-2 py-0.5 text-muted-foreground">
                        Pasted Receipt
                      </span>
                    )}
                  </div>
                </button>
              )
            })}
          </aside>

          {activeScan && (
            <section className="space-y-4 lg:col-span-8">
              <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-dashed border-border pb-4">
                  <div>
                    <h2 className="text-lg font-semibold">{activeScan.data.storeName}</h2>
                    <p className="text-xs text-muted-foreground">
                      Purchased {activeScan.data.purchasedAt} · Total{' '}
                      <span className="font-mono font-medium text-foreground">
                        {formatCents(activeScan.data.totalCents)}
                      </span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleRecheckSwaps(activeScan.recordId)}
                    >
                      <Sparkles className="mr-1.5 h-3.5 w-3.5 text-primary" />
                      Compare Stores
                    </Button>
                    {activeScan.data.potentialSavingsCents > 0 && (
                      <div className="rounded-lg bg-accent px-3.5 py-2 text-right">
                        <div className="text-[11px] font-medium text-accent-foreground">
                          Potential Savings
                        </div>
                        <div className="font-mono text-lg font-bold tabular-nums text-primary">
                          {formatCents(activeScan.data.potentialSavingsCents)}
                        </div>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleDeleteReceipt(activeScan.recordId)}
                      title="Delete receipt"
                      className="rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="mt-4 divide-y divide-border">
                  {activeLines.map((line) => {
                    const d = line.data
                    const pct = computeSavingsPercent(d.unitPriceCents, d.swapPriceCents)
                    return (
                      <div key={line.recordId} className="py-3.5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium text-foreground">
                                {d.normalizedName}
                              </span>
                              <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground">
                                {d.category}
                              </span>
                              {d.swapName && d.savingsCents > 0 && (
                                <span className="inline-flex items-center gap-1 rounded bg-accent px-1.5 py-0.5 text-[11px] font-medium text-primary">
                                  <Sparkles className="h-3 w-3" />
                                  Cheaper Swap
                                </span>
                              )}
                            </div>
                            <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                              Receipt line: {d.rawText}
                            </div>
                          </div>

                          <div className="shrink-0 font-mono text-sm font-semibold tabular-nums">
                            {formatCents(d.lineTotalCents)}
                          </div>
                        </div>

                        {d.swapStatus === 'pending' && (
                          <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                            Checking live prices at nearby stores...
                          </div>
                        )}

                        {d.swapName && d.savingsCents > 0 && d.swapStatus !== 'dismissed' && (
                          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/20 bg-accent/40 px-3.5 py-2.5">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-foreground">
                                <span className="truncate">{d.swapName}</span>
                                {d.snapEligible === 1 && (
                                  <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                                    SNAP/EBT
                                  </span>
                                )}
                              </div>
                              <div className="mt-0.5 flex items-center gap-2 font-mono text-xs tabular-nums text-primary">
                                <span>{formatCents(d.swapPriceCents)}</span>
                                <span className="font-semibold">
                                  Save {formatCents(d.savingsCents)} ({pct}%)
                                </span>
                                {d.swapName && (
                                  <a
                                    href={resolveRetailerUrl(d.retailer, d.swapName, d.retailerUrl)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-0.5 font-sans text-[11px] underline"
                                  >
                                    {d.retailer || 'Amazon'}
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5">
                              {d.swapName && (
                                <a
                                  href={resolveRetailerUrl(d.retailer, d.swapName, d.retailerUrl)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
                                >
                                  Shop {d.retailer || 'Now'}
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              )}
                              <button
                                type="button"
                                disabled={!linesReady}
                                onClick={() => handleDismiss(line.recordId)}
                                title="Dismiss swap"
                                className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </section>
          )}
        </div>
      )}

      <ScanReceiptModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onCompleted={(res) => setSelectedId(res.receiptScanId)}
      />
    </div>
  )
}
