import { useState } from 'react'
import { ExternalLink, FileText, Loader2, Mail, MapPin, Sparkles } from 'lucide-react'
import { Button, Input, Modal, Textarea } from './ui'
import { useReceiptImporter, type ProcessReceiptResult } from '../hooks/useReceiptImporter'
import type { AuditTimeframeDays } from '../lib/email-parser'
import { SAMPLE_RECEIPT_TEXT } from '../lib/sku-normalize'

export type { ProcessReceiptResult }

interface ScanReceiptModalProps {
  open: boolean
  onClose: () => void
  onCompleted?: (result: ProcessReceiptResult) => void
}

const TIMEFRAMES: Array<{ days: AuditTimeframeDays; label: string }> = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '3 months' },
  { days: 180, label: '6 months' },
]

export function ScanReceiptModal({ open, onClose, onCompleted }: ScanReceiptModalProps) {
  const [tab, setTab] = useState<'gmail' | 'text'>('gmail')
  const imp = useReceiptImporter({ onClose, onCompleted })

  return (
    <Modal open={open} onClose={onClose} title="Check Your Groceries" size="md">
      <div className="space-y-4">
        <div className="grid grid-cols-2 rounded-lg bg-secondary p-1 text-xs">
          {(
            [
              ['gmail', Mail, 'Email (Gmail)'],
              ['text', FileText, 'Paste Receipt'],
            ] as const
          ).map(([key, Icon, label]) => (
            <button
              key={key}
              type="button"
              data-testid={key === 'text' ? 'tab-paste-receipt' : 'tab-gmail'}
              onClick={() => setTab(key)}
              className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors ${
                tab === key ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        {tab === 'gmail' ? (
          <div className="space-y-4">
            <div className="space-y-3 rounded-xl border border-border bg-secondary/40 p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Mail className="h-4 w-4 text-primary" />
                Connect Gmail to check receipts &amp; active memberships
              </div>
              <p className="text-xs text-muted-foreground">
                We read digital receipts from Target, Walmart, Instacart, Amazon, and Costco, and
                auto-detect memberships like Prime or Target Circle 360.
              </p>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 flex items-center gap-1 text-xs font-medium">
                    <MapPin className="h-3 w-3 text-primary" /> Your ZIP code
                  </label>
                  <Input
                    value={imp.zipInput}
                    onChange={(e) => imp.setZipInput(e.target.value.replace(/\D/g, '').slice(0, 5))}
                    placeholder="e.g. 55414"
                    className="h-8 font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">Time frame</label>
                  <div className="flex flex-wrap gap-1">
                    {TIMEFRAMES.map((t) => (
                      <button
                        key={t.days}
                        type="button"
                        onClick={() => imp.setTimeframeDays(t.days)}
                        className={`rounded-md px-2 py-1 text-[11px] font-medium ${
                          imp.timeframeDays === t.days
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-card text-muted-foreground hover:bg-secondary'
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {imp.progress && (
              <div className="flex items-center gap-2 rounded-lg bg-accent/60 px-3 py-2 text-xs text-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> {imp.progress}
              </div>
            )}
            {imp.gmailError && (
              <div className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {imp.gmailError}
              </div>
            )}
            {imp.authUrl && (
              <a
                href={imp.authUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary underline"
              >
                Open Google Sign-In <ExternalLink className="h-3 w-3" />
              </a>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                data-testid="check-gmail-btn"
                disabled={imp.busy}
                onClick={() => void imp.checkGmail()}
              >
                {imp.busy ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Checking...
                  </>
                ) : (
                  'Check Groceries'
                )}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Paste any digital grocery receipt below.</span>
              <button
                type="button"
                data-testid="load-sample-receipt-btn"
                onClick={() => imp.setReceiptText(SAMPLE_RECEIPT_TEXT)}
                className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
              >
                <Sparkles className="h-3 w-3" /> Load sample receipt
              </button>
            </div>
            <Textarea
              data-testid="receipt-text-input"
              rows={9}
              value={imp.receiptText}
              onChange={(e) => imp.setReceiptText(e.target.value)}
              placeholder={
                'Target #1422 - Minneapolis\n2026-11-18\nTide Liquid Detergent 92 oz $13.49\n...'
              }
              className="font-mono text-xs"
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                data-testid="submit-receipt-text-btn"
                disabled={imp.busy || imp.receiptText.trim().length < 10}
                onClick={() => void imp.submitPastedReceipt()}
              >
                {imp.busy ? 'Checking...' : 'Check Receipt'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
