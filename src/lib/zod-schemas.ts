import { z } from 'zod'

const RECEIPT_TEXT_LENGTH_MAX = 25_000
const RECEIPT_LINES_MAX = 80
const LINE_PRICE_CENTS_MAX = 500_000
const RECEIPT_TOTAL_CENTS_MAX = 10_000_000

export const extractedLineSchema = z.object({
  rawText: z.string().trim().min(1).max(160),
  normalizedName: z.string().trim().min(1).max(160),
  category: z.string().trim().min(1).max(40).catch('Pantry'),
  quantity: z.number().min(0.1).max(100).catch(1),
  unitPriceCents: z.number().int().min(0).max(LINE_PRICE_CENTS_MAX),
  lineTotalCents: z.number().int().min(0).max(LINE_PRICE_CENTS_MAX),
  isNameBrand: z.boolean().catch(true),
})

export const extractedReceiptSchema = z.object({
  storeName: z.string().trim().min(1).max(100).catch('Grocery Store'),
  purchasedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .catch(() => new Date().toISOString().slice(0, 10)),
  subtotalCents: z.number().int().min(0).max(RECEIPT_TOTAL_CENTS_MAX).catch(0),
  totalCents: z.number().int().min(0).max(RECEIPT_TOTAL_CENTS_MAX).catch(0),
  lines: z.array(extractedLineSchema).max(RECEIPT_LINES_MAX),
})

export const processReceiptInputSchema = z.object({
  source: z.enum(['gmail', 'text']).default('text'),
  emailMessageId: z.string().trim().min(1).max(160).optional(),
  receiptText: z
    .string()
    .trim()
    .min(10, 'Provide a Gmail receipt or pasted receipt text')
    .max(RECEIPT_TEXT_LENGTH_MAX),
})

export type ExtractedReceipt = z.infer<typeof extractedReceiptSchema>
