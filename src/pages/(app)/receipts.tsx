import { useState } from 'react'
import { AuthOverlay, useAuthProfileReady, useMutations, useQuery } from 'deepspace'
import { Loader2, Mail, ReceiptText, Sparkles, Trash2 } from 'lucide-react'
import { ScanReceiptModal } from '../../components/ScanReceiptModal'
import { SwapRow } from '../../components/SwapRow'
import { Button, useToast } from '../../components/ui'
import { invokeAction } from '../../lib/actions-client'
import { formatCents } from '../../lib/money'
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
        <p className="mt-1 text-sm text-muted-foreground">Your receipts and local store swaps are private to your account.</p>
        <Button className="mt-5" onClick={() => setShowAuthModal(true)}>Sign In</Button>
        {showAuthModal && <AuthOverlay onClose={() => setShowAuthModal(false)} />}
      </div>
    )
  }
  return <ReceiptsContent />
}

function ReceiptsContent() {
  const { records: scans } = useQuery<ReceiptScanData>('receipt_scans', { orderBy: 'scannedAt', orderDir: 'desc', limit: 50 })
  const { records: allLines } = useQuery<ReceiptLineData>('receipt_lines', { limit: 300 })
  const { put: updateLine, ready: linesReady } = useMutations<Partial<ReceiptLineData>>('receipt_lines')
  const { success, error } = useToast()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [scannerOpen, setScannerOpen] = useState(false)

  const sortedScans = [...scans].sort(
    (a, b) =>
      b.data.potentialSavingsCents - a.data.potentialSavingsCents ||
      b.data.scannedAt.localeCompare(a.data.scannedAt),
  )
  const activeScan = sortedScans.find((s) => s.recordId === selectedId) ?? sortedScans[0] ?? null
  const activeLines = activeScan
    ? allLines
        .filter((l) => l.data.receiptScanId === activeScan.recordId)
        .sort((a, b) => b.data.savingsCents - a.data.savingsCents || b.data.lineTotalCents - a.data.lineTotalCents)
    : []

  async function handleDelete(receiptScanId: string) {
    const res = await invokeAction('deleteReceipt', { receiptScanId })
    if (!res.success) error('Could not delete receipt', res.error ?? 'Unknown error')
    else { setSelectedId(null); success('Receipt removed') }
  }

  async function handleRecheck(receiptScanId: string) {
    const res = await invokeAction<{ queued: number }>('recheckReceiptSwaps', { receiptScanId })
    if (!res.success) error('Could not check stores', res.error ?? 'Unknown error')
    else success('Checking live store prices', `Comparing ${res.data?.queued ?? 0} items...`)
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Receipt History</h1>
          <p className="text-sm text-muted-foreground">Inspect line items and live local store comparisons.</p>
        </div>
        <Button onClick={() => setScannerOpen(true)} className="inline-flex items-center gap-2">
          <Mail className="h-4 w-4" /> Check Email
        </Button>
      </div>

      {scans.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card px-6 py-16 text-center">
          <ReceiptText className="mx-auto h-8 w-8 text-muted-foreground" />
          <h2 className="mt-3 text-base font-semibold">No receipts checked yet</h2>
          <Button className="mt-5" onClick={() => setScannerOpen(true)}>Check Email</Button>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-12 lg:items-start">
          <aside className="max-h-[68vh] space-y-2.5 overflow-y-auto pr-1 lg:col-span-4 lg:h-[calc(100vh-13rem)] lg:max-h-none">
            {sortedScans.map((scan) => (
              <button
                key={scan.recordId}
                type="button"
                onClick={() => setSelectedId(scan.recordId)}
                className={`w-full rounded-xl border p-4 text-left transition-colors ${activeScan?.recordId === scan.recordId ? 'border-primary bg-accent/40' : 'border-border bg-card hover:bg-secondary/50'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{scan.data.storeName}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{scan.data.purchasedAt} · {scan.data.lineCount} lines</div>
                  </div>
                  <div className="shrink-0 text-right font-mono tabular-nums">
                    {scan.data.potentialSavingsCents > 0
                      ? <div className="text-sm font-bold text-primary">-{formatCents(scan.data.potentialSavingsCents)}</div>
                      : <div className="text-xs text-muted-foreground">Best prices</div>}
                    <div className="text-[11px] text-muted-foreground">{formatCents(scan.data.totalCents)}</div>
                  </div>
                </div>
                <span className="mt-2 inline-block rounded bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">
                  {scan.data.source === 'gmail' ? 'Email Receipt' : 'Pasted Receipt'}
                </span>
              </button>
            ))}
          </aside>

          {activeScan && (
            <section className="lg:col-span-8">
              <div className="flex flex-col rounded-xl border border-border bg-card p-5 lg:h-[calc(100vh-13rem)]">
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-dashed border-border pb-4">
                  <div>
                    <h2 className="text-lg font-semibold">{activeScan.data.storeName}</h2>
                    <p className="text-xs text-muted-foreground">
                      Purchased {activeScan.data.purchasedAt} · Total <span className="font-mono font-medium text-foreground">{formatCents(activeScan.data.totalCents)}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => void handleRecheck(activeScan.recordId)}>
                      <Sparkles className="mr-1.5 h-3.5 w-3.5 text-primary" /> Compare Stores
                    </Button>
                    {activeScan.data.potentialSavingsCents > 0 && (
                      <div className="rounded-lg bg-accent px-3 py-1.5 text-right font-mono">
                        <div className="font-sans text-[10px] text-accent-foreground">Savings</div>
                        <div className="text-base font-bold text-primary">{formatCents(activeScan.data.potentialSavingsCents)}</div>
                      </div>
                    )}
                    <button type="button" onClick={() => void handleDelete(activeScan.recordId)} title="Delete receipt" className="rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="mt-3 min-h-0 flex-1 divide-y divide-border overflow-y-auto pr-1">
                  {activeLines.map((line) => (
                    <div key={line.recordId} className="py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{line.data.normalizedName}</span>
                            <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground">{line.data.category}</span>
                          </div>
                          <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{line.data.rawText}</div>
                        </div>
                        <div className="shrink-0 font-mono text-sm font-semibold tabular-nums">{formatCents(line.data.lineTotalCents)}</div>
                      </div>

                      {line.data.swapStatus === 'pending' && (
                        <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> Checking live prices at nearby stores...
                        </div>
                      )}

                      {line.data.swapName && line.data.savingsCents > 0 && line.data.swapStatus !== 'dismissed' && (
                        <div className="mt-2 rounded-lg border border-primary/20 bg-accent/40 px-3">
                          <SwapRow lineId={line.recordId} line={line.data} ready={linesReady} onDismiss={(id) => void updateLine(id, { swapStatus: 'dismissed' })} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}
        </div>
      )}

      <ScanReceiptModal open={scannerOpen} onClose={() => setScannerOpen(false)} onCompleted={(r) => setSelectedId(r.receiptScanId)} />
    </div>
  )
}
