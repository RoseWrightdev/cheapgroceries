import { generateText } from 'ai'
import { createDeepSpaceAI } from 'deepspace/worker'
import type { Env } from '../../worker'
import { parsePriceToCents } from './money'
import { extractedReceiptSchema, type ExtractedReceipt } from './zod-schemas'

const CATEGORY_RULES: Array<[RegExp, string]> = [
  [/(milk|yogurt|butter|cheese|cream|egg)/, 'Dairy'],
  [/(detergent|paper towel|soap|trash|dish|cleaner|toilet paper)/, 'Household'],
  [/(oat|cereal|granola|pancake)/, 'Breakfast'],
  [/(juice|soda|coffee|tea|water|sparkling)/, 'Beverages'],
  [/(spinach|apple|banana|avocado|berry|lettuce|tomato)/, 'Produce'],
  [/(chicken|beef|pork|salmon|turkey)/, 'Meat'],
  [/(chip|cracker|cookie|pretzel|popcorn|bar)/, 'Snacks'],
]

const STORE_BRAND_RE = /\b(great value|kirkland|amazon fresh|good & gather|365)\b/i
const LINE_ITEM_RE = /^(.+?)\s+\$?(\d+\.\d{2})$/

function inferCategory(name: string): string {
  const lower = name.toLowerCase()
  const match = CATEGORY_RULES.find(([pattern]) => pattern.test(lower))
  return match ? match[1] : 'Pantry'
}

function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/\bliq\b/g, 'liquid')
    .replace(/\bgrk\b/g, 'greek')
    .replace(/\braos\b/g, "rao's")
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
}

function parseLineEntry(line: string): { label: string; priceCents: number } | null {
  const match = line.match(LINE_ITEM_RE)
  if (!match) {
    return null
  }
  const label = match[1].trim()
  if (/^\$?\d/.test(label) || !/[a-zA-Z]{3,}/.test(label)) {
    return null
  }
  const priceCents = parsePriceToCents(match[2])
  if (!priceCents || priceCents <= 0) {
    return null
  }
  return { label, priceCents }
}

export function parsePlainTextReceipt(text: string): ExtractedReceipt | null {
  const rawLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (rawLines.length === 0) {
    return null
  }

  const storeName =
    rawLines[0]
      .replace(/^From:\s*/i, '')
      .replace(/<[^>]+>/g, '')
      .replace(/[#0-9—-]+.*$/, '')
      .trim() || 'Local Grocery'
  const purchasedAt = text.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? new Date().toISOString().slice(0, 10)

  let subtotalCents = 0
  let totalCents = 0
  const lines: ExtractedReceipt['lines'] = []

  for (const raw of rawLines.slice(1)) {
    const entry = parseLineEntry(raw)
    if (!entry) {
      continue
    }
    const upper = entry.label.toUpperCase()
    if (upper.startsWith('SUBTOTAL')) {
      subtotalCents = entry.priceCents
      continue
    }
    if (upper.startsWith('TAX')) {
      continue
    }
    if (upper.startsWith('TOTAL') || upper.startsWith('BALANCE')) {
      totalCents = entry.priceCents
      continue
    }

    const normalizedName = normalizeLabel(entry.label)
    lines.push({
      rawText: entry.label,
      normalizedName,
      category: inferCategory(normalizedName),
      quantity: 1,
      unitPriceCents: entry.priceCents,
      lineTotalCents: entry.priceCents,
      isNameBrand: !STORE_BRAND_RE.test(entry.label),
    })
  }

  if (lines.length === 0) {
    return null
  }
  const summed = lines.reduce((acc, item) => acc + item.lineTotalCents, 0)
  return {
    storeName,
    purchasedAt,
    subtotalCents: subtotalCents || summed,
    totalCents: totalCents || summed,
    lines,
  }
}

export async function extractReceiptWithAI(
  env: Env,
  receiptText: string,
): Promise<ExtractedReceipt> {
  const ai = createDeepSpaceAI(env, 'anthropic')
  const today = new Date().toISOString().slice(0, 10)
  const example = JSON.stringify({
    storeName: 'Target',
    purchasedAt: 'YYYY-MM-DD',
    subtotalCents: 5172,
    totalCents: 5279,
    lines: [
      {
        rawText: 'TIDE 92OZ',
        normalizedName: 'Tide Liquid Laundry Detergent 92 oz',
        category: 'Household',
        quantity: 1,
        unitPriceCents: 1299,
        lineTotalCents: 1299,
        isNameBrand: true,
      },
    ],
  })

  const prompt = [
    'Extract ONLY actually purchased grocery/household items into strict raw JSON (no markdown):',
    example,
    'Rules: integer cents only; clean retailer storeName; ignore promos, price ranges, shipping,',
    `tax, subtotal, total; if not an itemized receipt return lines:[]; fallback date ${today}.`,
  ].join('\n')

  const { text } = await generateText({
    model: ai('claude-haiku-5-5'),
    maxOutputTokens: 4096,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'text', text: receiptText },
        ],
      },
    ],
  })

  const match = text.match(/\{[\s\S]*\}/)
  if (!match) {
    throw new Error('Receipt parser did not return valid JSON')
  }
  return extractedReceiptSchema.parse(JSON.parse(match[0]))
}
