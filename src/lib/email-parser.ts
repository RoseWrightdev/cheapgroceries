export type AuditTimeframeDays = 7 | 30 | 90 | 180

const EMAIL_BODY_LENGTH_MAX = 24_000
const RETAILER_SENDERS = [
  'instacart', 'walmart', 'target', 'kroger', 'amazon', 'wholefoods',
  'costco', 'samsclub', 'heb', 'safeway', 'albertsons', 'publix',
  'shipt', 'traderjoes', 'aldi', 'lidl', 'meijer', 'hy-vee',
  'wegmans', 'sprouts', 'fredmeyer', 'jewelosco', 'cub',
]

export function buildGroceryGmailQuery(days: AuditTimeframeDays = 30): string {
  const fromClause = `from:(${RETAILER_SENDERS.join(' OR ')})`
  const receiptClause = '(order OR receipt OR pickup OR delivered OR subtotal)'
  return `${fromClause} ${receiptClause} -category:promotions newer_than:${days}d`
}

export const MEMBERSHIP_GMAIL_QUERY = [
  '("Amazon Prime" OR "Target Circle 360" OR "Walmart+" OR "Costco" OR "Instacart+"',
  'OR "Sam\'s Club") (membership OR renewal OR welcome OR "delivered free"',
  'OR "free delivery" OR "your benefits") -category:promotions newer_than:365d',
].join(' ')

const MEMBERSHIP_PATTERNS: Array<[string, RegExp]> = [
  ['Amazon Prime', /amazon\s+prime|prime\s+membership|prime\s+delivery|your\s+prime\s+benefits/i],
  ['Target Circle 360', /target\s+circle\s*360/i],
  ['Walmart+', /walmart\+|walmart\s+plus/i],
  ['Costco', /costco\s+(gold\s+star|executive|membership|renewal)/i],
  ['Instacart+', /instacart\+|instacart\s+express/i],
  ['Sam’s Club', /sam'?s\s+club\s+(membership|plus|renewal)/i],
]

export function detectMembershipsFromTexts(texts: string[]): string[] {
  const combined = texts.join('\n')
  return MEMBERSHIP_PATTERNS.filter(([, re]) => re.test(combined)).map(([name]) => name)
}

export function parseJsonStringArray(raw?: string): string[] {
  if (!raw) {
    return []
  }
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
  } catch {
    return []
  }
}

export interface GmailPayloadPart {
  mimeType?: string
  body?: { data?: string }
  parts?: GmailPayloadPart[]
}

export interface GmailMessagePayload {
  id?: string
  snippet?: string
  subject?: string
  from?: string
  date?: string
  body?: string
  text?: string
  html?: string
  payload?: {
    headers?: Array<{ name?: string; value?: string }>
    body?: { data?: string }
    parts?: GmailPayloadPart[]
  }
}

function decodeBase64Url(input: string): string {
  const norm = input.replace(/-/g, '+').replace(/_/g, '/')
  const pad = norm.length % 4 === 0 ? '' : '='.repeat(4 - (norm.length % 4))
  const bytes = Uint8Array.from(atob(norm + pad), (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

export function cleanEmailPlainText(text: string): string {
  return text
    .replace(/&#8199;|&#847;|&shy;|&zwnj;|&zwj;|&#x200[cd];|[\u034f\u200b-\u200f\u2007\ufeff]/gi, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/&trade;/gi, '™')
    .replace(/&amp;|&#38;/gi, '&')
    .replace(/&nbsp;/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
}

export function htmlEmailToReceiptText(html: string): string {
  return cleanEmailPlainText(
    html
      .replace(/<(head|style|script)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\/(tr|p|div|li|h[1-6]|br)>|<br\s*\/?>/gi, '\n')
      .replace(/<\/(td|th)>/gi, '  ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&apos;|&#39;/gi, "'")
      .replace(/&quot;/gi, '"'),
  )
}

/** Iterative BFS over MIME parts (no recursion, bounded depth). */
function findPartBody(rootParts: GmailPayloadPart[] | undefined, mime: string): string | null {
  const queue: GmailPayloadPart[] = [...(rootParts ?? [])]
  const VISIT_MAX = 64
  let visited = 0

  while (queue.length > 0 && visited < VISIT_MAX) {
    visited++
    const part = queue.shift()
    if (!part) {
      break
    }
    if (part.mimeType === mime && part.body?.data) {
      return decodeBase64Url(part.body.data)
    }
    if (part.parts) {
      queue.push(...part.parts)
    }
  }
  return null
}

function extractBodyFromPayload(payload: NonNullable<GmailMessagePayload['payload']>): string {
  const plain = findPartBody(payload.parts, 'text/plain')
  const cleanedPlain = plain ? cleanEmailPlainText(plain) : ''
  if (cleanedPlain.length > 40) {
    return cleanedPlain
  }
  const html = findPartBody(payload.parts, 'text/html')
  if (html) {
    return htmlEmailToReceiptText(html)
  }
  if (payload.body?.data) {
    const raw = decodeBase64Url(payload.body.data)
    return raw.includes('<') ? htmlEmailToReceiptText(raw) : cleanEmailPlainText(raw)
  }
  return ''
}

function resolveMessageBody(msg: GmailMessagePayload): string {
  if (msg.text?.trim()) {
    return cleanEmailPlainText(msg.text)
  }
  if (msg.html?.trim()) {
    return htmlEmailToReceiptText(msg.html)
  }
  if (msg.body?.trim()) {
    return msg.body.includes('<')
      ? htmlEmailToReceiptText(msg.body)
      : cleanEmailPlainText(msg.body)
  }
  if (msg.payload) {
    return extractBodyFromPayload(msg.payload)
  }
  return ''
}

export function extractEmailReceiptText(msg: GmailMessagePayload): string {
  const headers = msg.payload?.headers ?? []
  const getHeader = (name: string) =>
    headers.find((h) => h.name?.toLowerCase() === name)?.value ?? ''

  const from = msg.from || getHeader('from')
  const subject = msg.subject || getHeader('subject')
  const date = msg.date || getHeader('date')
  const body = resolveMessageBody(msg)

  const headerLines = [
    from ? `From: ${from}` : '',
    subject ? `Subject: ${subject}` : '',
    date ? `Date: ${date}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  return [headerLines, body || msg.snippet || '']
    .filter(Boolean)
    .join('\n\n')
    .slice(0, EMAIL_BODY_LENGTH_MAX)
}
