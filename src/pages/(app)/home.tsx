import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthOverlay, useAuthProfileReady, useJobs, useQuery } from 'deepspace'
import { History, Loader2, Mail } from 'lucide-react'
import { SavingsView } from '../../components/SavingsView'
import { ScanReceiptModal } from '../../components/ScanReceiptModal'
import { Button } from '../../components/ui'
import { SCOPE_ID } from '../../constants'
import type { ReceiptScanData } from '../../schemas/receipt-scans-schema'

export default function HomePage() {
  const navigate = useNavigate()
  const { isSignedIn } = useAuthProfileReady({ requireUser: true })
  const { records: scans, status: scansStatus } = useQuery<ReceiptScanData>('receipt_scans', {
    limit: 50,
  })
  const { jobs } = useJobs(SCOPE_ID)

  const [scannerOpen, setScannerOpen] = useState(false)
  const [showAuthModal, setShowAuthModal] = useState(false)

  const activeJobs = jobs.filter((j) => j.status === 'queued' || j.status === 'running')
  const hasAuditedReceipts = isSignedIn && scans.length > 0

  function handleAction(action: 'email' | 'history') {
    if (!isSignedIn) {
      setShowAuthModal(true)
      return
    }
    if (action === 'history') {
      navigate('/receipts')
      return
    }
    setScannerOpen(true)
  }

  if (hasAuditedReceipts) {
    return (
      <>
        {activeJobs.length > 0 && (
          <div className="mx-auto max-w-5xl px-6 pt-6">
            <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/30 bg-accent/60 px-4 py-2.5 text-xs">
              <span className="inline-flex items-center gap-2 font-medium text-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden />
                {activeJobs[0].progressMessage || 'Checking nearby stores...'}
              </span>
              <span className="font-mono font-semibold tabular-nums text-primary">
                {Math.round((activeJobs[0].progress ?? 0) * 100)}%
              </span>
            </div>
          </div>
        )}

        <SavingsView
          headerActions={
            <Button
              size="sm"
              data-testid="open-gmail-btn"
              onClick={() => handleAction('email')}
              className="inline-flex items-center gap-1.5"
            >
              <Mail className="h-3.5 w-3.5" aria-hidden />
              Check Email
            </Button>
          }
        />

        <ScanReceiptModal open={scannerOpen} onClose={() => setScannerOpen(false)} />
      </>
    )
  }

  return (
    <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-2xl flex-col items-center justify-center px-6 py-12">
      <div className="w-full text-center">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">CheapGroceries</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {scansStatus === 'loading' && isSignedIn
            ? 'Loading your receipts...'
            : 'Check your email grocery receipts to see cheaper local swaps, coupons, and subscriptions.'}
        </p>
      </div>

      <div className="mt-8 grid w-full gap-4 sm:grid-cols-2">
        <button
          type="button"
          data-testid="open-gmail-btn"
          onClick={() => handleAction('email')}
          className="group flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-primary/30 bg-card px-5 py-8 text-center shadow-xs transition-all hover:border-primary hover:shadow-md"
        >
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Mail className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <div className="text-base font-semibold text-foreground">Check Email</div>
            <div className="mt-1 text-xs text-muted-foreground">Check Gmail or paste receipt</div>
          </div>
        </button>

        <button
          type="button"
          data-testid="open-history-btn"
          onClick={() => handleAction('history')}
          className="group flex flex-col items-center justify-center gap-3 rounded-2xl border border-border bg-card px-5 py-8 text-center shadow-xs transition-all hover:border-primary/60 hover:shadow-md"
        >
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-secondary text-foreground">
            <History className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <div className="text-base font-semibold text-foreground">See History</div>
            <div className="mt-1 text-xs text-muted-foreground">Past receipts &amp; swaps</div>
          </div>
        </button>
      </div>

      <ScanReceiptModal open={scannerOpen} onClose={() => setScannerOpen(false)} />

      {showAuthModal && <AuthOverlay onClose={() => setShowAuthModal(false)} />}
    </div>
  )
}
