import { useEffect, useState } from 'react'
import { integration, useQuery } from 'deepspace'
import { useToast } from '../components/ui'
import { invokeAction } from '../lib/actions-client'
import {
  buildGroceryGmailQuery,
  detectMembershipsFromTexts,
  extractEmailReceiptText,
  MEMBERSHIP_GMAIL_QUERY,
  type AuditTimeframeDays,
  type GmailMessagePayload,
} from '../lib/email-parser'
import { formatCents } from '../lib/money'
import type { HouseholdData } from '../schemas/households-schema'
import type { ReceiptScanData } from '../schemas/receipt-scans-schema'

export interface ProcessReceiptResult {
  receiptScanId: string
  storeName: string
  lineCount: number
  cacheHits: number
  cacheMisses: number
  potentialSavingsCents: number
}

export function useReceiptImporter(options: {
  onClose: () => void
  onCompleted?: (result: ProcessReceiptResult) => void
}) {
  const { success, error } = useToast()
  const { records: households } = useQuery<HouseholdData>('households', { limit: 1 })
  const { records: existingScans } = useQuery<ReceiptScanData>('receipt_scans', { limit: 100 })

  const importedIds = new Set(
    existingScans.map((s) => s.data.emailMessageId).filter((id): id is string => Boolean(id)),
  )

  const [zipInput, setZipInput] = useState('')
  const [timeframeDays, setTimeframeDays] = useState<AuditTimeframeDays>(30)
  const [receiptText, setReceiptText] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [gmailError, setGmailError] = useState<string | null>(null)
  const [authUrl, setAuthUrl] = useState<string | null>(null)

  const savedZip = households[0]?.data.zipCode ?? ''
  useEffect(() => {
    if (savedZip && !zipInput) {
      setZipInput(savedZip)
    }
  }, [savedZip, zipInput])

  function openGooglePopup(url: string) {
    const popup = window.open(url, 'google-auth', 'width=520,height=640')
    if (!popup) {
      setGmailError('Popup blocked — click "Open Google Sign-In" below, then try again.')
      return
    }
    const poll = window.setInterval(() => {
      if (popup.closed) {
        window.clearInterval(poll)
        void checkGmail()
      }
    }, 800)
  }

  async function checkGmail() {
    setBusy(true)
    setGmailError(null)
    setProgress(`Searching Gmail for grocery receipts (${timeframeDays}d)...`)
    try {
      const listRes = await integration.post('google/gmail-list', {
        q: buildGroceryGmailQuery(timeframeDays),
        maxResults: 25,
      })
      if (!listRes.success) {
        setGmailError(listRes.error ?? 'Could not connect to Gmail.')
        return
      }

      const payload = (listRes.data ?? listRes) as Record<string, unknown>
      if (payload?.requiresOAuth && typeof payload.authUrl === 'string') {
        setAuthUrl(payload.authUrl)
        setProgress(null)
        openGooglePopup(payload.authUrl)
        return
      }
      setAuthUrl(null)

      setProgress('Checking your active grocery memberships...')
      const memTexts: string[] = []
      try {
        const memRes = await integration.post('google/gmail-list', {
          q: MEMBERSHIP_GMAIL_QUERY,
          maxResults: 6,
        })
        const msgs =
          ((memRes.data ?? memRes) as { messages?: Array<Record<string, unknown>> })?.messages ?? []
        for (const m of msgs.slice(0, 5)) {
          if (m.subject) {
            memTexts.push(String(m.subject))
          }
          if (m.snippet) {
            memTexts.push(String(m.snippet))
          }
        }
      } catch {
        // Non-blocking membership scan.
      }

      const preDetected = detectMembershipsFromTexts(memTexts)
      if (zipInput.length === 5 || preDetected.length > 0) {
        await invokeAction('updateHouseholdLocality', {
          ...(zipInput.length === 5 ? { zipCode: zipInput } : {}),
          ...(preDetected.length > 0 ? { detectedMemberships: preDetected } : {}),
        })
      }

      const rawMsgs = (payload?.messages ?? []) as Array<Record<string, unknown>>
      const ids = rawMsgs
        .map((m) => String(m.id ?? m.messageId ?? ''))
        .filter((id) => id && !importedIds.has(id))
        .slice(0, 15)

      if (ids.length === 0) {
        setGmailError(
          `No new grocery receipts found in the last ${timeframeDays} days. Try a longer timeframe or Paste Receipt.`,
        )
        return
      }

      let count = 0
      let totalSavings = 0
      let lastRes: ProcessReceiptResult | null = null
      let lastErr = ''

      for (let i = 0; i < ids.length; i++) {
        setProgress(`Reading email ${i + 1} of ${ids.length}...`)
        const msgRes = await integration.post('google/gmail-get', {
          messageId: ids[i],
          id: ids[i],
          format: 'full',
        })
        if (!msgRes.success) {
          continue
        }
        const raw = (msgRes.data ?? msgRes) as { message?: GmailMessagePayload }
        const text = extractEmailReceiptText((raw.message ?? raw) as GmailMessagePayload)
        if (text.length < 20) {
          continue
        }
        memTexts.push(text)

        const res = await invokeAction<ProcessReceiptResult>('processReceipt', {
          source: 'gmail',
          emailMessageId: ids[i],
          receiptText: text,
        })
        if (res.success && res.data) {
          count++
          totalSavings += res.data.potentialSavingsCents
          lastRes = res.data
        } else if (res.error) {
          lastErr = res.error
        }
      }

      const finalMem = detectMembershipsFromTexts(memTexts)
      if (finalMem.length > preDetected.length) {
        await invokeAction('updateHouseholdLocality', { detectedMemberships: finalMem })
      }
      if (count === 0) {
        setGmailError(
          `Checked ${ids.length} emails, none had itemized grocery lines.${lastErr ? ` (${lastErr})` : ''}`,
        )
        return
      }

      success(
        `Checked ${count} email receipt${count === 1 ? '' : 's'}`,
        totalSavings > 0 ? `Found ${formatCents(totalSavings)} in savings.` : 'Checking nearby stores now.',
      )
      if (lastRes) {
        options.onCompleted?.(lastRes)
      }
      options.onClose()
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  async function submitPastedReceipt() {
    if (receiptText.trim().length < 10) {
      return
    }
    setBusy(true)
    try {
      const res = await invokeAction<ProcessReceiptResult>('processReceipt', {
        source: 'text',
        receiptText: receiptText.trim(),
      })
      if (!res.success || !res.data) {
        error('Could not parse receipt', res.error ?? 'Unknown error')
        return
      }
      success(
        `Checked ${res.data.storeName}`,
        res.data.potentialSavingsCents > 0
          ? `Found ${formatCents(res.data.potentialSavingsCents)} in savings.`
          : 'Checking live local prices now.',
      )
      options.onCompleted?.(res.data)
      setReceiptText('')
      options.onClose()
    } finally {
      setBusy(false)
    }
  }

  return {
    zipInput,
    setZipInput,
    timeframeDays,
    setTimeframeDays,
    receiptText,
    setReceiptText,
    busy,
    progress,
    gmailError,
    authUrl,
    checkGmail,
    submitPastedReceipt,
  }
}
