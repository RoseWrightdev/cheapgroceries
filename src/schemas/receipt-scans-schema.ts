import type { CollectionSchema } from 'deepspace/schema'

export type ReceiptSource = 'gmail' | 'text'

export interface ReceiptScanData {
  householdId: string
  storeName: string
  purchasedAt: string
  subtotalCents: number
  totalCents: number
  potentialSavingsCents: number
  source: ReceiptSource
  emailMessageId?: string
  lineCount: number
  cacheHits: number
  cacheMisses: number
  enrichmentJobId?: string
  scannedBy: string
  scannedAt: string
}

export const receiptScansSchema: CollectionSchema = {
  name: 'receipt_scans',
  columns: [
    { name: 'householdId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'storeName', storage: 'text', interpretation: 'plain', required: true, maxLength: 100 },
    { name: 'purchasedAt', storage: 'text', interpretation: 'date', required: true },
    { name: 'subtotalCents', storage: 'number', interpretation: 'plain', default: 0 },
    { name: 'totalCents', storage: 'number', interpretation: 'plain', default: 0 },
    { name: 'potentialSavingsCents', storage: 'number', interpretation: 'plain', default: 0 },
    {
      name: 'source',
      storage: 'text',
      interpretation: { kind: 'select', options: ['gmail', 'text'] },
      default: 'gmail',
    },
    { name: 'emailMessageId', storage: 'text', interpretation: 'plain' },
    { name: 'lineCount', storage: 'number', interpretation: 'plain', default: 0 },
    { name: 'cacheHits', storage: 'number', interpretation: 'plain', default: 0 },
    { name: 'cacheMisses', storage: 'number', interpretation: 'plain', default: 0 },
    { name: 'enrichmentJobId', storage: 'text', interpretation: 'plain' },
    { name: 'scannedBy', storage: 'text', interpretation: 'plain', required: true },
    { name: 'scannedAt', storage: 'text', interpretation: 'datetime', required: true },
  ],
  teamField: 'householdId',
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    viewer: { read: 'team', create: false, update: false, delete: false },
    member: { read: 'team', create: true, update: 'team', delete: 'team' },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
