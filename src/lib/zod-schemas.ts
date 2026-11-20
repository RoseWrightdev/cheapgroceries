import { z } from 'zod'

export const createHouseholdInputSchema = z.object({
  name: z.string().trim().min(2, 'Household name must be at least 2 characters').max(80),
  monthlyBudgetCents: z.number().int().min(1000).max(10_000_000).default(60000),
})

export const joinHouseholdInputSchema = z.object({
  inviteCode: z
    .string()
    .trim()
    .toUpperCase()
    .min(4, 'Invite code is too short')
    .max(16),
})

export const extractedLineSchema = z.object({
  rawText: z.string().trim().min(1).max(160),
  normalizedName: z.string().trim().min(1).max(160),
  category: z.string().trim().min(1).max(40).catch('Pantry'),
  quantity: z.number().min(0.1).max(100).catch(1),
  unitPriceCents: z.number().int().min(0).max(500_000),
  lineTotalCents: z.number().int().min(0).max(500_000),
  isNameBrand: z.boolean().catch(true),
})

export const extractedReceiptSchema = z.object({
  storeName: z.string().trim().min(1).max(100).catch('Grocery Store'),
  purchasedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .catch(() => new Date().toISOString().slice(0, 10)),
  subtotalCents: z.number().int().min(0).max(10_000_000).catch(0),
  totalCents: z.number().int().min(0).max(10_000_000).catch(0),
  lines: z.array(extractedLineSchema).max(80),
})

export const processReceiptInputSchema = z.object({
  source: z.enum(['gmail', 'text']).default('text'),
  emailMessageId: z.string().trim().min(1).max(160).optional(),
  receiptText: z.string().trim().min(10, 'Provide a Gmail receipt or pasted receipt text').max(25_000),
})

export type ExtractedReceipt = z.infer<typeof extractedReceiptSchema>
export type ExtractedLine = z.infer<typeof extractedLineSchema>
