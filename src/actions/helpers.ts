import type { ActionTools } from 'deepspace/worker'
import { parseDetectedMemberships } from '../lib/email-parser'
import { getRegionalStoresForZip, parseNearbyStores } from '../lib/locality'
import { STARTER_SKU_CACHE } from '../lib/sku-normalize'
import type { HouseholdData } from '../schemas/households-schema'
import type { TeamMemberData } from '../schemas/team-members-schema'

export interface RecordEnvelope<T> {
  recordId: string
  data: T
}

export function extractRecords<T>(res: { success: boolean; data?: unknown }): RecordEnvelope<T>[] {
  if (!res.success || !res.data || typeof res.data !== 'object') return []
  const records = (res.data as { records?: unknown }).records
  return Array.isArray(records) ? (records as RecordEnvelope<T>[]) : []
}

export function extractRecord<T>(
  res: { success: boolean; data?: unknown },
): RecordEnvelope<T> | null {
  if (!res.success || !res.data || typeof res.data !== 'object') return null
  const record = (res.data as { record?: unknown }).record
  return record && typeof record === 'object' ? (record as RecordEnvelope<T>) : null
}

export function generateInviteCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let out = ''
  for (let i = 0; i < 6; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return out
}

export async function getCallerHouseholdId(
  tools: ActionTools,
  userId: string,
): Promise<string | null> {
  const res = await tools.query('team_members', {
    where: { userId, status: 'active' },
    limit: 1,
  })
  const rows = extractRecords<TeamMemberData>(res)
  return rows[0]?.data.teamId ?? null
}

/**
 * Auto-provisions a personal household on first use so users can check
 * email or pasted receipts immediately without an extra setup screen.
 */
export async function ensureCallerHouseholdId(
  tools: ActionTools,
  userId: string,
): Promise<string> {
  const existing = await getCallerHouseholdId(tools, userId)
  if (existing) return existing

  const householdId = `hh_${crypto.randomUUID().slice(0, 12)}`
  const inviteCode = generateInviteCode()
  const now = new Date().toISOString()

  await tools.create(
    'households',
    {
      householdId,
      name: 'My Groceries',
      inviteCode,
      ownerId: userId,
      monthlyBudgetCents: 60000,
      createdAt: now,
    },
    householdId,
  )

  await tools.create('team_members', {
    teamId: householdId,
    userId,
    status: 'active',
    memberRole: 'owner',
    joinedAt: now,
  })

  await tools.update('users', userId, { householdId })
  return householdId
}

export interface HouseholdLocality {
  zipCode: string
  allowedStores: string[]
  hasPrime: boolean
  detectedMemberships: string[]
}

export async function getHouseholdLocality(
  tools: ActionTools,
  householdId: string,
): Promise<HouseholdLocality> {
  const res = await tools.get('households', householdId)
  const record = extractRecord<HouseholdData>(res)
  const zipCode = record?.data.zipCode ?? ''
  const stored = parseNearbyStores(record?.data.nearbyStores)
  const allowedStores = stored.length > 0 ? stored : getRegionalStoresForZip(zipCode)
  const detectedMemberships = parseDetectedMemberships(record?.data.detectedMemberships)
  const hasPrime =
    record?.data.hasPrime === 1 ||
    detectedMemberships.some((m) => m.toLowerCase() === 'amazon prime')
  return { zipCode, allowedStores, hasPrime, detectedMemberships }
}

export async function ensureStarterCacheSeeded(tools: ActionTools): Promise<number> {
  const existing = await tools.query('sku_swap_cache', { limit: 1 })
  if (extractRecords(existing).length > 0) return 0

  const now = new Date().toISOString()
  let seeded = 0
  for (const item of STARTER_SKU_CACHE) {
    const created = await tools.create('sku_swap_cache', { ...item, refreshedAt: now })
    if (created.success) seeded++
  }
  return seeded
}
