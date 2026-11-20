import type { CollectionSchema } from 'deepspace/schema'

export interface TeamMemberData {
  teamId: string
  userId: string
  status: 'active' | 'removed'
  memberRole: 'owner' | 'member'
  joinedAt: string
}

/**
 * Required by DeepSpace's `'team'` permission rule: RecordRoom resolves
 * membership in `team_members` matching `teamId`, `userId`, and `status='active'`.
 * Client writes are denied — membership mutations happen exclusively through
 * validated Server Actions (`createHousehold`, `joinHousehold`).
 */
export const teamMembersSchema: CollectionSchema = {
  name: 'team_members',
  columns: [
    { name: 'teamId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'userId', storage: 'text', interpretation: 'plain', required: true },
    {
      name: 'status',
      storage: 'text',
      interpretation: { kind: 'select', options: ['active', 'removed'] },
      default: 'active',
    },
    {
      name: 'memberRole',
      storage: 'text',
      interpretation: { kind: 'select', options: ['owner', 'member'] },
      default: 'member',
    },
    { name: 'joinedAt', storage: 'text', interpretation: 'datetime' },
  ],
  uniqueOn: ['teamId', 'userId'],
  teamField: 'teamId',
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    viewer: { read: 'team', create: false, update: false, delete: false },
    member: { read: 'team', create: false, update: false, delete: false },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
