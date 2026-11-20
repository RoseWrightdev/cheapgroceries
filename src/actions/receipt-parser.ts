import { generateText } from 'ai'
import { createDeepSpaceAI } from 'deepspace/worker'
import type { Env } from '../../worker'
import { parsePriceToCents } from '../lib/money'
import { extractedReceiptSchema, type ExtractedReceipt } from '../lib/zod-schemas'
import type { SkuSwapCacheData } from '../schemas/sku-swap-cache-schema'
import type { RecordEnvelope } from './helpers'

function inferCategory(name: string): string {
  const n = name.toLowerCase()
  if (/(milk|yogurt|butter|cheese|cream|egg)/.test(n)) return 'Dairy'
  if (/(detergent|paper towel|soap|trash|dish|cleaner|toilet paper)/.test(n)) return 'Household'
  if (/(oat|cereal|granola|pancake)/.test(n)) return 'Breakfast'
  if (/(juice|soda|coffee|tea|water|sparkling)/.test(n)) return 'Beverages'
  if (/(spinach|apple|banana|avocado|berry|lettuce|tomato)/.test(n)) return 'Produce'
  if (/(chicken|beef|pork|salmon|turkey)/.test(n)) return 'Meat'
  if (/(chip|cracker|cookie|pretzel|popcorn|bar)/.test(n)) return 'Snacks'
  return 'Pantry'
}

/**
 * Deterministic parser for clean plain-text receipts (pasted text or sample receipts)
 * so demos and pasted lists resolve instantly without needing an LLM call.
 */
export function parsePlainTextReceipt(text: string): ExtractedReceipt | null {
  const rawLines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  if (rawLines.length === 0) return null

  const firstLine = rawLines[0] ?? ''
  const storeName =
    firstLine
      .replace(/^From:\s*/i, '')
      .replace(/<[^>]+>/g, '')
      .replace(/[#0-9—-]+.*$/, '')
      .trim() || 'Local Grocery'
  const dateMatch = text.match(/(\d{4}-\d{2}-\d{2})/)
  const purchasedAt = dateMatch ? dateMatch[1] : new Date().toISOString().slice(0, 10)

  let subtotalCents = 0
  let totalCents = 0
  const lines: ExtractedReceipt['lines'] = []

  for (const line of rawLines.slice(1)) {
    const match = line.match(/^(.+?)\s+\$?(\d+\.\d{2})$/)
    if (!match) continue
    const label = match[1].trim()
    // Reject price ranges ("$7.99 -"), bare numbers, or promo lines
    if (/^\$?\d/.test(label) || !/[a-zA-Z]{3,}/.test(label)) continue
    const priceCents = parsePriceToCents(match[2])
    if (priceCents === null || priceCents <= 0) continue

    const upper = label.toUpperCase()
    if (upper.startsWith('SUBTOTAL')) {
      subtotalCents = priceCents
      continue
    }
    if (upper.startsWith('TAX')) continue
    if (upper.startsWith('TOTAL') || upper.startsWith('BALANCE')) {
      totalCents = priceCents
      continue
    }

    const lower = label.toLowerCase()
    const isStoreBrand =
      lower.includes('great value') ||
      lower.includes('kirkland') ||
      lower.includes('amazon fresh') ||
      lower.includes('good & gather') ||
      lower.includes('365') ||
      lower.startsWith('gv ')

    const normalizedName = label
      .toLowerCase()
      .replace(/\bliq\b/g, 'liquid')
      .replace(/\bgrk\b/g, 'greek')
      .replace(/\bold fash\b/g, 'old fashioned')
      .replace(/\braos\b/g, "rao's")
      .replace(/\b\w/g, (c) => c.toUpperCase())

    lines.push({
      rawText: label,
      normalizedName,
      category: inferCategory(normalizedName),
      quantity: 1,
      unitPriceCents: priceCents,
      lineTotalCents: priceCents,
      isNameBrand: !isStoreBrand,
    })
  }

  if (lines.length === 0) return null
  const summed = lines.reduce((acc, l) => acc + l.lineTotalCents, 0)
  return {
    storeName,
    purchasedAt,
    subtotalCents: subtotalCents || summed,
    totalCents: totalCents || summed,
    lines,
  }
}

/**
 * Extract structured grocery line items from messy retailer HTML/text emails
 * using owner-billed Claude Haiku via DeepSpace's AI proxy.
 */
export async function extractReceiptWithAI(
  env: Env,
  receiptText: string,
): Promise<ExtractedReceipt> {
  const ai = createDeepSpaceAI(env, 'anthropic')
  const today = new Date().toISOString().slice(0, 10)

  const prompt = [
    'Extract ONLY the actually purchased grocery / household items from this receipt or order email into strict JSON.',
    'Return ONLY raw JSON (no markdown fences) matching this exact shape:',
    '{"storeName":"Target","purchasedAt":"YYYY-MM-DD","subtotalCents":5172,"totalCents":5279,"lines":[{"rawText":"TIDE LIQ DET 92OZ","normalizedName":"Tide Liquid Laundry Detergent 92 oz","category":"Household","quantity":1,"unitPriceCents":1299,"lineTotalCents":1299,"isNameBrand":true}]}',
    'Rules:',
    '- storeName must be a clean retailer name (e.g. "Target", "Walmart", "Kroger", "Whole Foods"), NEVER an email address or "From:" header.',
    '- All prices MUST be integer cents (e.g. $6.49 -> 649).',
    '- Expand cryptic receipt abbreviations into clean human product names in normalizedName.',
    '- IGNORE promotional carousels, "You might also like", price ranges like "$7.99 - $39.99", shipping, tips, discounts, subtotal, tax, total, and payment lines.',
    `- If this email is NOT an itemized purchase receipt (e.g. a marketing promo or shipping notice with no item prices), return {"storeName":"Unknown","purchasedAt":"${today}","subtotalCents":0,"totalCents":0,"lines":[]}.`,
    '- Set isNameBrand=false for store brands (Great Value, Kirkland, 365, Good & Gather, Market Pantry, Up&Up, Amazon Fresh, Favorite Day).',
    `- If date is unreadable, use ${today}.`,
  ].join('\n')

  const { text } = await generateText({
    model: ai('claude-haiku-5-5'),
    maxOutputTokens: 4096,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'text', text: `Receipt text:\n${receiptText}` },
        ],
      },
    ],
  })

  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error('Receipt parser did not return valid JSON')
  }
  return extractedReceiptSchema.parse(JSON.parse(jsonMatch[0]))
}

/** Find best matching cached swap by exact skuKey or token overlap. */
export function findCacheMatch(
  skuKey: string,
  cacheRows: RecordEnvelope<SkuSwapCacheData>[],
): RecordEnvelope<SkuSwapCacheData> | null {
  const exact = cacheRows.find((r) => r.data.skuKey === skuKey)
  if (exact) return exact

  const tokens = new Set(skuKey.split('-').filter((t) => t.length > 2))
  if (tokens.size === 0) return null

  let best: RecordEnvelope<SkuSwapCacheData> | null = null
  let bestScore = 0
  for (const row of cacheRows) {
    const candTokens = row.data.skuKey.split('-').filter((t) => t.length > 2)
    let overlap = 0
    for (const t of candTokens) {
      if (tokens.has(t)) overlap++
    }
    const score = overlap / Math.max(tokens.size, candTokens.length, 1)
    if (score >= 0.55 && score > bestScore) {
      bestScore = score
      best = row
    }
  }
  return best
}
