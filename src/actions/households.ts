import { enqueueJob } from 'deepspace/worker'
import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import { getRegionalStoresForZip } from '../lib/locality'
import { createHouseholdInputSchema, joinHouseholdInputSchema } from '../lib/zod-schemas'
import type { HouseholdData } from '../schemas/households-schema'
import type { ReceiptLineData } from '../schemas/receipt-lines-schema'
import type { TeamMemberData } from '../schemas/team-members-schema'
import {
  ensureCallerHouseholdId,
  ensureStarterCacheSeeded,
  extractRecords,
  generateInviteCode,
  getCallerHouseholdId,
  getHouseholdLocality,
} from './helpers'

export const householdActions: Record<string, ActionHandler<Env>> = {
  createHousehold: async ({ userId, params, tools }) => {
    const parsed = createHouseholdInputSchema.safeParse(params)
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid household input' }
    }

    const existingHouseholdId = await getCallerHouseholdId(tools, userId)
    if (existingHouseholdId) {
      return { success: true, data: { householdId: existingHouseholdId, alreadyMember: true } }
    }

    const householdId = `hh_${crypto.randomUUID().slice(0, 12)}`
    const inviteCode = generateInviteCode()
    const now = new Date().toISOString()

    const hhRes = await tools.create(
      'households',
      {
        householdId,
        name: parsed.data.name,
        inviteCode,
        ownerId: userId,
        monthlyBudgetCents: parsed.data.monthlyBudgetCents,
        createdAt: now,
      },
      householdId,
    )
    if (!hhRes.success) return hhRes

    const memberRes = await tools.create('team_members', {
      teamId: householdId,
      userId,
      status: 'active',
      memberRole: 'owner',
      joinedAt: now,
    })
    if (!memberRes.success) return memberRes

    await tools.update('users', userId, { householdId })
    await ensureStarterCacheSeeded(tools)

    return { success: true, data: { householdId, inviteCode, name: parsed.data.name } }
  },

  joinHousehold: async ({ userId, params, tools }) => {
    const parsed = joinHouseholdInputSchema.safeParse(params)
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid invite code' }
    }

    const hhQuery = await tools.query('households', {
      where: { inviteCode: parsed.data.inviteCode },
      limit: 1,
    })
    if (!hhQuery.success) return hhQuery

    const household = extractRecords<HouseholdData>(hhQuery)[0]
    if (!household) {
      return { success: false, error: 'No household found with that invite code.' }
    }

    const householdId = household.data.householdId
    const existingMember = await tools.query('team_members', {
      where: { teamId: householdId, userId },
      limit: 1,
    })
    const member = extractRecords<TeamMemberData>(existingMember)[0]

    if (member) {
      await tools.update('team_members', member.recordId, { status: 'active' })
    } else {
      await tools.create('team_members', {
        teamId: householdId,
        userId,
        status: 'active',
        memberRole: 'member',
        joinedAt: new Date().toISOString(),
      })
    }

    await tools.update('users', userId, { householdId })
    await ensureStarterCacheSeeded(tools)

    return {
      success: true,
      data: { householdId, name: household.data.name, inviteCode: household.data.inviteCode },
    }
  },

  updateHouseholdLocality: async ({ userId, params, tools, env }) => {
    const householdId = await ensureCallerHouseholdId(tools, userId)
    const current = await getHouseholdLocality(tools, householdId)

    const zipCode =
      typeof params.zipCode === 'string'
        ? params.zipCode.replace(/\D/g, '').slice(0, 5)
        : current.zipCode

    const incomingStores = Array.isArray(params.nearbyStores)
      ? params.nearbyStores.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      : []

    const resolvedStores =
      incomingStores.length > 0
        ? incomingStores
        : typeof params.zipCode === 'string'
          ? getRegionalStoresForZip(zipCode)
          : current.allowedStores

    const incomingMemberships = Array.isArray(params.detectedMemberships)
      ? params.detectedMemberships.filter(
          (s): s is string => typeof s === 'string' && s.trim().length > 0,
        )
      : null

    const mergedMemberships = incomingMemberships
      ? Array.from(new Set([...current.detectedMemberships, ...incomingMemberships]))
      : current.detectedMemberships

    const hasPrime =
      mergedMemberships.some((m) => m.toLowerCase() === 'amazon prime') ||
      (typeof params.hasPrime === 'boolean' ? params.hasPrime : current.hasPrime)

    const res = await tools.update('households', householdId, {
      zipCode,
      nearbyStores: JSON.stringify(resolvedStores),
      detectedMemberships: JSON.stringify(mergedMemberships),
      hasPrime: hasPrime ? 1 : 0,
    })
    if (!res.success) return res

    // Re-check recent receipts against live prices whenever the user updates their ZIP/stores.
    let requeuedItems = 0
    let requeuedReceipts = 0
    if (params.refreshSwaps === true) {
      const scansRes = await tools.query('receipt_scans', {
        where: { householdId },
        orderBy: 'scannedAt',
        orderDir: 'desc',
        limit: 5,
      })
      const scans = extractRecords<{ householdId: string }>(scansRes)

      for (const scan of scans) {
        const linesRes = await tools.query('receipt_lines', {
          where: { householdId, receiptScanId: scan.recordId },
          limit: 100,
        })
        const misses = extractRecords<ReceiptLineData>(linesRes)
          .filter((r) => r.data.unitPriceCents >= 125 && r.data.swapStatus !== 'accepted')
          .map((r) => ({
            lineId: r.recordId,
            skuKey: r.data.skuKey,
            normalizedName: r.data.normalizedName,
            category: r.data.category,
            unitPriceCents: r.data.unitPriceCents,
            storeName: r.data.storeName,
          }))

        if (misses.length === 0) continue

        for (const m of misses) {
          await tools.update('receipt_lines', m.lineId, {
            swapStatus: 'pending',
            swapName: '',
            swapPriceCents: 0,
            savingsCents: 0,
            retailer: '',
            retailerUrl: '',
            swapSource: 'none',
          })
        }
        await tools.update('receipt_scans', scan.recordId, { potentialSavingsCents: 0 })

        try {
          await enqueueJob(
            env.JOB_ROOMS,
            `app:${env.DEEPSPACE_APP_ID}`,
            'enrich-unknown-skus',
            {
              householdId,
              receiptScanId: scan.recordId,
              misses,
              allowedStores: resolvedStores,
              zipCode,
              hasPrime,
            },
          )
          requeuedItems += misses.length
          requeuedReceipts += 1
        } catch (err) {
          console.warn('[updateHouseholdLocality] Failed to enqueue swap refresh:', err)
        }
      }
    }

    return {
      success: true,
      data: {
        zipCode,
        nearbyStores: resolvedStores,
        detectedMemberships: mergedMemberships,
        hasPrime,
        requeuedItems,
        requeuedReceipts,
      },
    }
  },
}
