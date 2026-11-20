import { USERS_COLUMNS, type CollectionSchema } from 'deepspace/schema'

export interface UserProfileData {
  email?: string
  name?: string
  imageUrl?: string
  role?: string
  householdId?: string
  preferredStores?: string
}

export const usersSchema: CollectionSchema = {
  name: 'users',
  columns: [
    ...USERS_COLUMNS,
    { name: 'householdId', storage: 'text', interpretation: 'plain' },
    { name: 'preferredStores', storage: 'text', interpretation: 'plain' },
  ],
  permissions: {
    viewer: { read: 'own', create: false, update: 'own', delete: false },
    member: { read: 'own', create: false, update: 'own', delete: false },
    admin: { read: true, create: false, update: true, delete: true },
  },
}
