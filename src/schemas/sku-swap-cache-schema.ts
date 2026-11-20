import type { CollectionSchema } from 'deepspace/schema'

export interface SkuSwapCacheData {
  skuKey: string
  canonicalName: string
  category: string
  typicalPriceCents: number
  genericAlternativeName: string
  genericPriceCents: number
  savingsCents: number
  retailer: string
  retailerUrl: string
  imageUrl?: string
  rating?: string
  snapEligible: number
  source: 'seed' | 'amazon_live' | 'google_shopping_live' | 'ai_estimate'
  hitCount: number
  refreshedAt: string
}

/**
 * Shared app-wide SKU -> generic swap cache.
 *
 * Security & margin boundary:
 * - Authenticated members can READ cached swaps (instant O(1) lookup).
 * - Client WRITES are strictly denied (`create/update/delete: false` for members)
 *   so no user can poison affiliate links or prices.
 * - Only privileged Server Actions, AppJobRoom, AppCronRoom, or admins write here.
 */
export const skuSwapCacheSchema: CollectionSchema = {
  name: 'sku_swap_cache',
  columns: [
    { name: 'skuKey', storage: 'text', interpretation: 'plain', required: true, maxLength: 120 },
    { name: 'canonicalName', storage: 'text', interpretation: 'plain', required: true, maxLength: 160 },
    { name: 'category', storage: 'text', interpretation: 'plain', default: 'Pantry' },
    { name: 'typicalPriceCents', storage: 'number', interpretation: 'plain', default: 0 },
    { name: 'genericAlternativeName', storage: 'text', interpretation: 'plain', required: true, maxLength: 200 },
    { name: 'genericPriceCents', storage: 'number', interpretation: 'plain', default: 0 },
    { name: 'savingsCents', storage: 'number', interpretation: 'plain', default: 0 },
    { name: 'retailer', storage: 'text', interpretation: 'plain', default: 'Amazon' },
    { name: 'retailerUrl', storage: 'text', interpretation: 'url' },
    { name: 'imageUrl', storage: 'text', interpretation: 'url' },
    { name: 'rating', storage: 'text', interpretation: 'plain' },
    { name: 'snapEligible', storage: 'number', interpretation: 'boolean', default: 0 },
    {
      name: 'source',
      storage: 'text',
      interpretation: { kind: 'select', options: ['seed', 'amazon_live', 'google_shopping_live', 'ai_estimate'] },
      default: 'seed',
    },
    { name: 'hitCount', storage: 'number', interpretation: 'plain', default: 0 },
    { name: 'refreshedAt', storage: 'text', interpretation: 'datetime', required: true },
  ],
  uniqueOn: ['skuKey'],
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    viewer: { read: true, create: false, update: false, delete: false },
    member: { read: true, create: false, update: false, delete: false },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
