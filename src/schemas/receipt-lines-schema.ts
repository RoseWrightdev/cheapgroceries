import type { CollectionSchema } from 'deepspace/schema'

export type SwapStatus = 'pending' | 'matched' | 'accepted' | 'dismissed' | 'no_swap'
export type SwapSource = 'cache' | 'amazon_job' | 'google_shopping_job' | 'ai_estimate' | 'none'

export interface ReceiptLineData {
  householdId: string
  receiptScanId: string
  storeName: string
  purchasedAt: string
  rawText: string
  normalizedName: string
  skuKey: string
  category: string
  quantity: number
  unitPriceCents: number
  lineTotalCents: number
  isNameBrand: number
  swapStatus: SwapStatus
  swapName?: string
  swapPriceCents: number
  savingsCents: number
  retailer?: string
  retailerUrl?: string
  snapEligible: number
  swapSource: SwapSource
}

export const receiptLinesSchema: CollectionSchema = {
  name: 'receipt_lines',
  columns: [
    { name: 'householdId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'receiptScanId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'storeName', storage: 'text', interpretation: 'plain', required: true },
    { name: 'purchasedAt', storage: 'text', interpretation: 'date', required: true },
    { name: 'rawText', storage: 'text', interpretation: 'plain', required: true, maxLength: 160 },
    { name: 'normalizedName', storage: 'text', interpretation: 'plain', required: true, maxLength: 160 },
    { name: 'skuKey', storage: 'text', interpretation: 'plain', required: true, maxLength: 120 },
    { name: 'category', storage: 'text', interpretation: 'plain', default: 'Pantry' },
    { name: 'quantity', storage: 'number', interpretation: 'plain', default: 1 },
    { name: 'unitPriceCents', storage: 'number', interpretation: 'plain', default: 0 },
    { name: 'lineTotalCents', storage: 'number', interpretation: 'plain', default: 0 },
    { name: 'isNameBrand', storage: 'number', interpretation: 'boolean', default: 1 },
    {
      name: 'swapStatus',
      storage: 'text',
      interpretation: { kind: 'select', options: ['pending', 'matched', 'accepted', 'dismissed', 'no_swap'] },
      default: 'pending',
    },
    { name: 'swapName', storage: 'text', interpretation: 'plain' },
    { name: 'swapPriceCents', storage: 'number', interpretation: 'plain', default: 0 },
    { name: 'savingsCents', storage: 'number', interpretation: 'plain', default: 0 },
    { name: 'retailer', storage: 'text', interpretation: 'plain' },
    { name: 'retailerUrl', storage: 'text', interpretation: 'url' },
    { name: 'snapEligible', storage: 'number', interpretation: 'boolean', default: 0 },
    {
      name: 'swapSource',
      storage: 'text',
      interpretation: { kind: 'select', options: ['cache', 'amazon_job', 'google_shopping_job', 'ai_estimate', 'none'] },
      default: 'none',
    },
  ],
  teamField: 'householdId',
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    viewer: { read: 'team', create: false, update: false, delete: false },
    member: { read: 'team', create: true, update: 'team', delete: 'team' },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
