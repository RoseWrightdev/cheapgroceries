import { useEffect, useState } from 'react'
import { integration, useQuery } from 'deepspace'
import {
  Calendar,
  FileText,
  Loader2,
  Mail,
  MapPin,
  Sparkles,
  X,
} from 'lucide-react'
import { Button, Input, Textarea, useToast } from './ui'
import { invokeAction } from '../lib/actions-client'
import {
  buildGroceryGmailQuery,
  detectMembershipsFromTexts,
  extractEmailReceiptText,
  htmlEmailToReceiptText,
  MEMBERSHIP_GMAIL_QUERY,
  SAMPLE_INSTACART_EMAIL_HTML,
  type AuditTimeframeDays,
  type GmailMessagePayload,
} from '../lib/email-parser'
import { formatCents } from '../lib/money'
import { SAMPLE_RECEIPT_TEXT } from '../lib/sku-normalize'
import type { HouseholdData } from '../schemas/households-schema'
import type { ReceiptScanData } from '../schemas/receipt-scans-schema'

interface ProcessReceiptResult {
  receiptScanId: string
  storeName: string
  lineCount: number
  cacheHits: number
  cacheMisses: number
  potentialSavingsCents: number
  enrichmentJobId?: string
}

interface ScanReceiptModalProps {
  open: boolean
  initialTab?: 'gmail' | 'text'
  onClose: () => void
  onCompleted?: (result: ProcessReceiptResult) => void
}

const TIMEFRAME_OPTIONS: Array<{ days: AuditTimeframeDays; label: string }> = [
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
  { days: 180, label: 'Last 6 months' },
]

export function ScanReceiptModal({
  open,
  initialTab = 'gmail',
  onClose,
  onCompleted,
}: ScanReceiptModalProps) {
  const { records: existingScans } = useQuery<ReceiptScanData>('receipt_scans', { limit: 100 })
  const { records: households } = useQuery<HouseholdData>('households', { limit: 1 })
  const { success, error } = useToast()

  const savedZip = households[0]?.data.zipCode ?? ''
  const [tab, setTab] = useState<'gmail' | 'text'>(initialTab)
  const [receiptText, setReceiptText] = useState('')
  const [zipCode, setZipCode] = useState(savedZip)

  const [timeframeDays, setTimeframeDays] = useState<AuditTimeframeDays>(30)
  const [gmailAuthUrl, setGmailAuthUrl] = useState<string | null>(null)
  const [auditingGmail, setAuditingGmail] = useState(false)
  const [auditProgress, setAuditProgress] = useState<string | null>(null)
  const [gmailError, setGmailError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const importedEmailIds = new Set(
    existingScans.map((s) => s.data.emailMessageId).filter((id): id is string => Boolean(id)),
  )

  useEffect(() => {
    if (!open) return
    setTab(initialTab)
    if (savedZip) setZipCode(savedZip)
    setGmailError(null)
    setAuditProgress(null)
  }, [open, initialTab, savedZip])

  if (!open) return null

  function openGoogleAuthPopup(url: string) {
    const popup = window.open(url, 'google-auth', 'width=520,height=640')
    if (!popup) {
      setGmailError(
        'Popup blocked — click "Open Google Sign-In" below, then click Check Groceries again.',
      )
      return
    }
    const poll = window.setInterval(() => {
      if (popup.closed) {
        window.clearInterval(poll)
        void handleAuditGmail()
      }
    }, 800)
  }

  async function handleAuditGmail() {
    setAuditingGmail(true)
    setGmailError(null)
    setAuditProgress(`Searching Gmail for grocery receipts (${timeframeDays}d)...`)

    try {
      const q = buildGroceryGmailQuery(timeframeDays)
      const listRes = await integration.post('google/gmail-list', {
        q,
        maxResults: 25,
      })

      if (!listRes.success) {
        if (listRes.error?.startsWith('Token refresh failed')) {
          setGmailError('Your Gmail token expired. Click Check Groceries again to reconnect.')
        } else {
          setGmailError(listRes.error ?? 'Could not connect to Gmail.')
        }
        return
      }

      const payload = (listRes.data ?? listRes) as Record<string, unknown>
      if (payload?.requiresOAuth && typeof payload.authUrl === 'string') {
        setGmailAuthUrl(payload.authUrl)
        setAuditProgress(null)
        openGoogleAuthPopup(payload.authUrl)
        return
      }

      setGmailAuthUrl(null)

      // Onboarding step: detect current memberships (Prime, Target Circle 360, Costco, Walmart+, etc.)
      setAuditProgress('Checking your active grocery memberships...')
      const membershipTexts: string[] = []
      try {
        const memListRes = await integration.post('google/gmail-list', {
          q: MEMBERSHIP_GMAIL_QUERY,
          maxResults: 8,
        })
        if (memListRes.success) {
          const mp = (memListRes.data ?? memListRes) as Record<string, unknown>
          const memMsgs = (mp?.messages ?? []) as Array<Record<string, unknown>>
          for (const m of memMsgs.slice(0, 5)) {
            if (m.subject) membershipTexts.push(String(m.subject))
            if (m.snippet) membershipTexts.push(String(m.snippet))
            const mid = String(m.id ?? m.messageId ?? '')
            if (mid && !m.subject) {
              const metaRes = await integration.post('google/gmail-get', {
                messageId: mid,
                id: mid,
                format: 'metadata',
              })
              if (metaRes.success) {
                const detail = (metaRes.data ?? metaRes) as Record<string, unknown>
                const msgObj = (detail.message ?? detail) as GmailMessagePayload
                membershipTexts.push(extractEmailReceiptText(msgObj))
              }
            }
          }
        }
      } catch {
        // Non-blocking — membership detection will also inspect receipt bodies below
      }

      const rawMessages = (payload?.messages ?? []) as Array<Record<string, unknown>>
      const ids = rawMessages
        .map((m) => String(m.id ?? m.messageId ?? ''))
        .filter((id) => Boolean(id) && !importedEmailIds.has(id))
        .slice(0, 15)

      if (ids.length === 0) {
        const detected = detectMembershipsFromTexts(membershipTexts)
        if (detected.length > 0 || zipCode.length === 5) {
          await invokeAction('updateHouseholdLocality', {
            ...(zipCode.length === 5 ? { zipCode } : {}),
            detectedMemberships: detected,
          })
        }
        setGmailError(
          rawMessages.length > 0
            ? `All ${rawMessages.length} grocery emails from the last ${timeframeDays} days are already checked.${detected.length > 0 ? ` Detected memberships: ${detected.join(', ')}.` : ''}`
            : `No grocery receipt emails found in the last ${timeframeDays} days. Try a longer time frame or test with the sample Instacart email.`,
        )
        return
      }

      let auditedCount = 0
      let totalSavings = 0
      let lastResult: ProcessReceiptResult | null = null
      let lastError: string | null = null

      // Save ZIP + any memberships already detected before processing receipts so locality applies immediately
      const preDetected = detectMembershipsFromTexts(membershipTexts)
      if (preDetected.length > 0 || zipCode.length === 5) {
        await invokeAction('updateHouseholdLocality', {
          ...(zipCode.length === 5 ? { zipCode } : {}),
          detectedMemberships: preDetected,
        })
      }

      for (let i = 0; i < ids.length; i++) {
        const messageId = ids[i]
        setAuditProgress(`Checking grocery email ${i + 1} of ${ids.length}...`)

        const msgRes = await integration.post('google/gmail-get', {
          messageId,
          id: messageId,
          format: 'full',
        })
        if (!msgRes.success) {
          lastError = msgRes.error ?? 'Failed to read Gmail message'
          continue
        }

        const msgPayload = (msgRes.data ?? msgRes) as Record<string, unknown>
        const rawMessage = (msgPayload.message ?? msgPayload) as GmailMessagePayload
        const cleanedText = extractEmailReceiptText(rawMessage)
        if (cleanedText.length < 20) continue
        membershipTexts.push(cleanedText)

        const auditRes = await invokeAction<ProcessReceiptResult>('processReceipt', {
          source: 'gmail',
          emailMessageId: messageId,
          receiptText: cleanedText,
        })
        if (auditRes.success && auditRes.data) {
          auditedCount++
          totalSavings += auditRes.data.potentialSavingsCents
          lastResult = auditRes.data
        } else if (auditRes.error) {
          lastError = auditRes.error
        }
      }

      // Persist any memberships discovered inside the receipt text itself (e.g. Target Circle 360)
      const finalDetected = detectMembershipsFromTexts(membershipTexts)
      if (finalDetected.length > preDetected.length) {
        await invokeAction('updateHouseholdLocality', {
          detectedMemberships: finalDetected,
        })
      }

      if (auditedCount === 0) {
        setGmailError(
          `Checked ${ids.length} matching email${ids.length === 1 ? '' : 's'}, none had itemized grocery lines.${lastError ? ` (${lastError})` : ''}`,
        )
        return
      }

      success(
        `Checked ${auditedCount} email receipt${auditedCount === 1 ? '' : 's'}`,
        totalSavings > 0
          ? `Found ${formatCents(totalSavings)} in potential savings.`
          : 'Your receipts are saved — checking nearby stores now.',
      )
      if (lastResult) onCompleted?.(lastResult)
      onClose()
    } finally {
      setAuditingGmail(false)
      setAuditProgress(null)
    }
  }

  async function handleSampleEmailImport() {
    setSubmitting(true)
    try {
      const cleaned = htmlEmailToReceiptText(SAMPLE_INSTACART_EMAIL_HTML)
      const res = await invokeAction<ProcessReceiptResult>('processReceipt', {
        source: 'gmail',
        emailMessageId: `sample_instacart_${Date.now()}`,
        receiptText: cleaned,
      })
      if (!res.success || !res.data) {
        error('Sample email check failed', res.error ?? 'Unknown error')
        return
      }
      success(
        `Checked ${res.data.storeName}`,
        `Found ${formatCents(res.data.potentialSavingsCents)} in potential savings.`,
      )
      onCompleted?.(res.data)
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  async function handlePasteSubmit() {
    if (receiptText.trim().length < 10) {
      error('Receipt text too short', 'Paste a receipt or load the sample receipt.')
      return
    }
    setSubmitting(true)
    try {
      const res = await invokeAction<ProcessReceiptResult>('processReceipt', {
        source: 'text',
        receiptText: receiptText.trim(),
      })
      if (!res.success || !res.data) {
        error('Receipt check failed', res.error ?? 'Unknown error')
        return
      }
      success(
        `Checked ${res.data.storeName}`,
        `Found ${formatCents(res.data.potentialSavingsCents)} in potential savings.`,
      )
      onCompleted?.(res.data)
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Check groceries"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]"
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-primary" aria-hidden />
            <h2 className="text-sm font-semibold">Check Groceries</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-border bg-secondary/40 px-5 py-2.5">
          <div className="inline-flex flex-wrap rounded-lg bg-secondary p-1">
            <button
              type="button"
              data-testid="tab-gmail-receipt"
              onClick={() => setTab('gmail')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === 'gmail' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground'
              }`}
            >
              <Mail className="h-3.5 w-3.5" aria-hidden />
              Email (Gmail)
            </button>
            <button
              type="button"
              data-testid="tab-paste-receipt"
              onClick={() => setTab('text')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === 'text' ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground'
              }`}
            >
              <FileText className="h-3.5 w-3.5" aria-hidden />
              Paste Receipt
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'gmail' ? (
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-12">
                <div className="sm:col-span-4">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5" aria-hidden />
                    Your ZIP code
                  </div>
                  <Input
                    value={zipCode}
                    onChange={(e) => setZipCode(e.target.value.replace(/\D/g, '').slice(0, 5))}
                    placeholder="e.g. 55401"
                    className="mt-2 font-mono text-xs"
                    aria-label="Your ZIP code"
                  />
                </div>

                <div className="sm:col-span-8">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Calendar className="h-3.5 w-3.5" aria-hidden />
                    Time frame
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {TIMEFRAME_OPTIONS.map((opt) => (
                      <button
                        key={opt.days}
                        type="button"
                        onClick={() => setTimeframeDays(opt.days)}
                        className={`rounded-lg border px-2.5 py-2 text-xs font-medium transition-colors ${
                          timeframeDays === opt.days
                            ? 'border-primary bg-accent text-primary'
                            : 'border-border bg-background text-muted-foreground hover:bg-secondary hover:text-foreground'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-background/60 p-5 text-center">
                <p className="text-sm text-muted-foreground">
                  Automatically checks your active memberships (Prime, Target Circle 360, Costco,
                  Walmart+) and reviews grocery order emails from the{' '}
                  <strong className="text-foreground">
                    {TIMEFRAME_OPTIONS.find((o) => o.days === timeframeDays)?.label.toLowerCase()}
                  </strong>{' '}
                  against stores near you.
                </p>

                <div className="mt-5 flex flex-col items-center gap-3">
                  <Button
                    type="button"
                    data-testid="audit-groceries-btn"
                    disabled={auditingGmail || submitting}
                    onClick={() => void handleAuditGmail()}
                    className="w-full max-w-xs"
                  >
                    {auditingGmail ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Checking Groceries...
                      </>
                    ) : (
                      <>
                        <Mail className="mr-2 h-4 w-4" />
                        Check Groceries
                      </>
                    )}
                  </Button>

                  <button
                    type="button"
                    data-testid="sample-instacart-email-btn"
                    disabled={auditingGmail || submitting}
                    onClick={() => void handleSampleEmailImport()}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline disabled:opacity-50"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {submitting
                      ? 'Checking sample...'
                      : 'Or test instantly with a sample Instacart email'}
                  </button>
                </div>

                {auditProgress && (
                  <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-accent px-3 py-1 text-xs font-medium text-primary">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {auditProgress}
                  </div>
                )}

                {gmailAuthUrl && (
                  <div className="mt-4 rounded-lg border border-primary/25 bg-accent/50 px-3.5 py-2.5 text-xs text-foreground">
                    Finish signing in with Google to check your inbox —{' '}
                    <a
                      href={gmailAuthUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-primary underline"
                    >
                      Open Google Sign-In →
                    </a>
                  </div>
                )}

                {gmailError && (
                  <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive">
                    {gmailError}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  Paste any digital receipt from your store’s order history page.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="load-sample-receipt-btn"
                  onClick={() => setReceiptText(SAMPLE_RECEIPT_TEXT)}
                >
                  <Sparkles className="mr-1.5 h-3.5 w-3.5 text-primary" />
                  Load sample
                </Button>
              </div>
              <Textarea
                data-testid="receipt-text-input"
                rows={12}
                className="font-mono text-xs"
                placeholder="Paste store receipt lines with prices..."
                value={receiptText}
                onChange={(e) => setReceiptText(e.target.value)}
              />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border bg-secondary/30 px-5 py-3">
          <span className="text-xs text-muted-foreground">
            Your receipts stay private to your household.
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={submitting || auditingGmail}
            >
              Close
            </Button>
            {tab === 'text' && (
              <Button
                type="button"
                data-testid="submit-receipt-btn"
                onClick={() => void handlePasteSubmit()}
                disabled={submitting || receiptText.trim().length < 10}
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Checking...
                  </>
                ) : (
                  'Check Groceries'
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
