import type { CollectionSchema } from 'deepspace/schema'

export interface HouseholdData {
  householdId: string
  name: string
  inviteCode: string
  ownerId: string
  monthlyBudgetCents: number
  zipCode?: string
  locationLabel?: string
  nearbyStores?: string
  hasPrime?: number
  detectedMemberships?: string
  createdAt: string
}

export const householdsSchema: CollectionSchema = {
  name: 'households',
  columns: [
    { name: 'householdId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'name', storage: 'text', interpretation: 'plain', required: true, maxLength: 80 },
    { name: 'inviteCode', storage: 'text', interpretation: 'plain', required: true, maxLength: 16 },
    { name: 'ownerId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'monthlyBudgetCents', storage: 'number', interpretation: 'plain', default: 60000 },
    { name: 'zipCode', storage: 'text', interpretation: 'plain', maxLength: 12 },
    { name: 'locationLabel', storage: 'text', interpretation: 'plain', maxLength: 120 },
    { name: 'nearbyStores', storage: 'text', interpretation: 'plain', maxLength: 1000 },
    { name: 'hasPrime', storage: 'number', interpretation: 'boolean', default: 0 },
    { name: 'detectedMemberships', storage: 'text', interpretation: 'plain', maxLength: 500 },
    { name: 'createdAt', storage: 'text', interpretation: 'datetime' },
  ],
  ownerField: 'ownerId',
  teamField: 'householdId',
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    viewer: { read: 'team', create: false, update: false, delete: false },
    member: { read: 'team', create: false, update: 'own', delete: false },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
