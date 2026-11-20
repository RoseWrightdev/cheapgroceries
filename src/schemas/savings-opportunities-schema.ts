import type { CollectionSchema } from 'deepspace/schema'

export type OpportunityKind = 'coupon' | 'deal' | 'subscription'

export interface SavingsOpportunityData {
  householdId: string
  kind: OpportunityKind
  title: string
  description: string
  storeOrProvider: string
  estimatedAnnualSavingsCents: number
  membershipCostCents: number
  breakEvenMonths: number
  actionUrl?: string
  actionLabel?: string
  dismissed: number
  createdAt: string
}

export const savingsOpportunitiesSchema: CollectionSchema = {
  name: 'savings_opportunities',
  columns: [
    { name: 'householdId', storage: 'text', interpretation: 'plain', required: true },
    {
      name: 'kind',
      storage: 'text',
      interpretation: { kind: 'select', options: ['coupon', 'deal', 'subscription'] },
      required: true,
    },
    { name: 'title', storage: 'text', interpretation: 'plain', required: true, maxLength: 140 },
    { name: 'description', storage: 'text', interpretation: 'plain', required: true, maxLength: 400 },
    { name: 'storeOrProvider', storage: 'text', interpretation: 'plain', required: true, maxLength: 80 },
    { name: 'estimatedAnnualSavingsCents', storage: 'number', interpretation: 'plain', default: 0 },
    { name: 'membershipCostCents', storage: 'number', interpretation: 'plain', default: 0 },
    { name: 'breakEvenMonths', storage: 'number', interpretation: 'plain', default: 0 },
    { name: 'actionUrl', storage: 'text', interpretation: 'url' },
    { name: 'actionLabel', storage: 'text', interpretation: 'plain' },
    { name: 'dismissed', storage: 'number', interpretation: 'boolean', default: 0 },
    { name: 'createdAt', storage: 'text', interpretation: 'datetime', required: true },
  ],
  teamField: 'householdId',
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    viewer: { read: 'team', create: false, update: false, delete: false },
    member: { read: 'team', create: true, update: 'team', delete: 'team' },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
