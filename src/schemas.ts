import type { CollectionSchema } from 'deepspace/schema'
import { usersSchema } from './schemas/users-schema'
import { settingsSchema } from './schemas/admin-schema'
import { teamMembersSchema } from './schemas/team-members-schema'
import { householdsSchema } from './schemas/households-schema'
import { receiptScansSchema } from './schemas/receipt-scans-schema'
import { receiptLinesSchema } from './schemas/receipt-lines-schema'
import { skuSwapCacheSchema } from './schemas/sku-swap-cache-schema'

export const schemas: CollectionSchema[] = [
  usersSchema,
  settingsSchema,
  teamMembersSchema,
  householdsSchema,
  receiptScansSchema,
  receiptLinesSchema,
  skuSwapCacheSchema,
]
