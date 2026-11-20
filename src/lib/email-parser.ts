/**
 * Gmail digital grocery receipt helpers:
 * - Gmail search query targeting major grocery & delivery retailers
 * - Base64url decoding + HTML-to-text cleanup for Gmail API `format: 'full'` payloads
 * - Sample HTML digital receipt (Instacart) for 1-click testing without personal Gmail OAuth
 */

export type AuditTimeframeDays = 7 | 30 | 90 | 180

export function buildGroceryGmailQuery(days: AuditTimeframeDays = 30): string {
  return `from:(instacart OR walmart OR target OR kroger OR amazon OR wholefoods OR costco OR heb OR safeway OR publix OR shipt OR traderjoes OR aldi) (order OR receipt OR pickup OR delivered OR subtotal) -category:promotions newer_than:${days}d`
}

export const GROCERY_GMAIL_QUERY = buildGroceryGmailQuery(30)

export const MEMBERSHIP_GMAIL_QUERY =
  '("Amazon Prime" OR "Target Circle 360" OR "Walmart+" OR "Costco" OR "Instacart+" OR "Sam\'s Club") (membership OR renewal OR welcome OR "delivered free" OR "free delivery" OR "your benefits") -category:promotions newer_than:365d'

const MEMBERSHIP_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'Amazon Prime', pattern: /amazon\s+prime|prime\s+membership|prime\s+delivery|your\s+prime\s+benefits/i },
  { name: 'Target Circle 360', pattern: /target\s+circle\s*360/i },
  { name: 'Walmart+', pattern: /walmart\+|walmart\s+plus/i },
  { name: 'Costco', pattern: /costco\s+(gold\s+star|executive|membership|renewal)/i },
  { name: 'Instacart+', pattern: /instacart\+|instacart\s+express/i },
  { name: 'Sam’s Club', pattern: /sam'?s\s+club\s+(membership|plus|renewal)/i },
]

/** Detect active grocery/delivery subscriptions from Gmail subjects, snippets, and receipt text. */
export function detectMembershipsFromTexts(texts: string[]): string[] {
  const combined = texts.join('\n')
  const found: string[] = []
  for (const { name, pattern } of MEMBERSHIP_PATTERNS) {
    if (pattern.test(combined)) {
      found.push(name)
    }
  }
  return found
}

export function parseDetectedMemberships(raw?: string): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    }
  } catch {
    // ignore malformed JSON
  }
  return []
}

export interface GmailPayloadPart {
  mimeType?: string
  body?: { data?: string; size?: number }
  parts?: GmailPayloadPart[]
}

export interface GmailMessagePayload {
  id?: string
  threadId?: string
  snippet?: string
  internalDate?: string
  subject?: string
  from?: string
  date?: string
  body?: string
  text?: string
  html?: string
  payload?: {
    headers?: Array<{ name?: string; value?: string }>
    mimeType?: string
    body?: { data?: string }
    parts?: GmailPayloadPart[]
  }
}

export function decodeBase64Url(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4))
  const binary = atob(normalized + pad)
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/** Strip tracking URLs, invisible email preheader padding (&#8199; &#847;), and excessive whitespace. */
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

/** Convert an HTML email receipt into clean line-oriented text preserving item names & prices. */
export function htmlEmailToReceiptText(html: string): string {
  const stripped = html
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(tr|p|div|li|h[1-6]|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(td|th)>/gi, '  ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
  return cleanEmailPlainText(stripped)
}

function findPartBody(parts: GmailPayloadPart[] | undefined, targetMime: string): string | null {
  if (!parts) return null
  for (const part of parts) {
    if (part.mimeType === targetMime && part.body?.data) {
      return decodeBase64Url(part.body.data)
    }
    if (part.parts) {
      const nested = findPartBody(part.parts, targetMime)
      if (nested) return nested
    }
  }
  return null
}

/** Extract clean receipt text from either a raw Gmail API message or a normalized DeepSpace envelope. */
export function extractEmailReceiptText(message: GmailMessagePayload): string {
  const headers = message.payload?.headers ?? []
  const headerVal = (name: string) =>
    headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? ''

  const subject = message.subject || headerVal('subject')
  const from = message.from || headerVal('from')
  const date = message.date || headerVal('date')

  let bodyText = ''
  if (typeof message.text === 'string' && message.text.trim()) {
    bodyText = cleanEmailPlainText(message.text)
  } else if (typeof message.html === 'string' && message.html.trim()) {
    bodyText = htmlEmailToReceiptText(message.html)
  } else if (typeof message.body === 'string' && message.body.trim()) {
    bodyText = message.body.includes('<')
      ? htmlEmailToReceiptText(message.body)
      : cleanEmailPlainText(message.body)
  } else if (message.payload) {
    const plain = findPartBody(message.payload.parts, 'text/plain')
    const html = findPartBody(message.payload.parts, 'text/html')
    const cleanedPlain = plain ? cleanEmailPlainText(plain) : ''
    if (cleanedPlain.length > 40) {
      bodyText = cleanedPlain
    } else if (html) {
      bodyText = htmlEmailToReceiptText(html)
    } else if (message.payload.body?.data) {
      const raw = decodeBase64Url(message.payload.body.data)
      bodyText = raw.includes('<') ? htmlEmailToReceiptText(raw) : cleanEmailPlainText(raw)
    }
  }

  if (!bodyText && message.snippet) {
    bodyText = message.snippet
  }

  const headerPrefix = [from ? `From: ${from}` : '', subject ? `Subject: ${subject}` : '', date ? `Date: ${date}` : '']
    .filter(Boolean)
    .join('\n')

  return [headerPrefix, bodyText].filter(Boolean).join('\n\n').slice(0, 24_000)
}

export const SAMPLE_INSTACART_EMAIL_HTML = `<!doctype html>
<html>
  <body>
    <h2>Instacart Order Receipt — Whole Foods Market</h2>
    <p>Delivered on ${new Date().toISOString().slice(0, 10)}</p>
    <table>
      <tr><td>Tide Liquid Laundry Detergent 92 oz</td><td>$12.99</td></tr>
      <tr><td>Chobani Non-Fat Greek Yogurt 32 oz</td><td>$6.49</td></tr>
      <tr><td>Rao's Homemade Marinara Sauce 24 oz</td><td>$8.99</td></tr>
      <tr><td>Skippy Creamy Peanut Butter 40 oz</td><td>$6.79</td></tr>
      <tr><td>Tropicana Pure Premium Orange Juice 52 oz</td><td>$5.49</td></tr>
      <tr><td>Kerrygold Pure Irish Butter 8 oz</td><td>$5.49</td></tr>
      <tr><td>Dave's Killer Bread 21 Whole Grains 27 oz</td><td>$6.99</td></tr>
      <tr><td>Subtotal</td><td>$53.23</td></tr>
      <tr><td>Total</td><td>$53.23</td></tr>
    </table>
  </body>
</html>`
