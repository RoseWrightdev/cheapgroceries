import { generateText } from 'ai'
import { createDeepSpaceAI } from 'deepspace/worker'
import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import { computeDeterministicOpportunities } from '../lib/deals-engine'
import type { ReceiptLineData } from '../schemas/receipt-lines-schema'
import type { ReceiptScanData } from '../schemas/receipt-scans-schema'
import { ensureCallerHouseholdId, extractRecords, getHouseholdLocality } from './helpers'

export const savingsActions: Record<string, ActionHandler<Env>> = {
  analyzeSavingsOpportunities: async ({ userId, tools, env }) => {
    const householdId = await ensureCallerHouseholdId(tools, userId)
    const [scansRes, linesRes] = await Promise.all([
      tools.query('receipt_scans', { where: { householdId }, limit: 50 }),
      tools.query('receipt_lines', { where: { householdId }, limit: 200 }),
    ])

    const scans = extractRecords<ReceiptScanData>(scansRes).map((r) => r.data)
    const lines = extractRecords<ReceiptLineData>(linesRes).map((r) => r.data)

    if (scans.length === 0) {
      return { success: false, error: 'Check at least one receipt first to find tailored deals.' }
    }

    const locality = await getHouseholdLocality(tools, householdId)
    const opportunities = computeDeterministicOpportunities(scans, lines, {
      hasPrime: locality.hasPrime,
      detectedMemberships: locality.detectedMemberships,
    })

    try {
      const topItems = lines
        .slice(0, 20)
        .map((l) => `${l.normalizedName} ($${(l.unitPriceCents / 100).toFixed(2)} at ${l.storeName})`)
        .join('; ')

      const ai = createDeepSpaceAI(env, 'anthropic')
      const { text } = await generateText({
        model: ai('claude-haiku-5-5'),
        maxOutputTokens: 1200,
        messages: [
          {
            role: 'user',
            content: [
              'Based on these actual grocery purchases, suggest 3 specific, practical coupon, multi-buy deal, or subscription-savings tips.',
              `Purchases: ${topItems}`,
              'Return ONLY raw JSON array (no markdown):',
              '[{"kind":"coupon"|"deal"|"subscription","title":"Short actionable title","description":"1-2 concrete sentences naming the exact items and how to save","storeOrProvider":"Store or Program","estimatedAnnualSavingsCents":4800,"membershipCostCents":0,"breakEvenMonths":0,"actionLabel":"View Deal"}]',
            ].join('\n'),
          },
        ],
      })

      const match = text.match(/\[[\s\S]*\]/)
      if (match) {
        const aiItems = JSON.parse(match[0]) as Array<Record<string, unknown>>
        for (const item of aiItems.slice(0, 3)) {
          const kind =
            item.kind === 'coupon' || item.kind === 'deal' || item.kind === 'subscription'
              ? item.kind
              : 'deal'
          const title = String(item.title ?? '').slice(0, 140)
          const description = String(item.description ?? '').slice(0, 390)
          if (!title || !description) continue
          opportunities.push({
            kind,
            title,
            description,
            storeOrProvider: String(item.storeOrProvider ?? scans[0].storeName).slice(0, 80),
            estimatedAnnualSavingsCents: Math.max(
              500,
              Math.min(200_000, Math.round(Number(item.estimatedAnnualSavingsCents) || 3600)),
            ),
            membershipCostCents: Math.max(0, Math.round(Number(item.membershipCostCents) || 0)),
            breakEvenMonths: Math.max(0, Number(item.breakEvenMonths) || 0),
            actionLabel: String(item.actionLabel ?? 'See Offer').slice(0, 40),
          })
        }
      }
    } catch (err) {
      console.warn('[analyzeSavingsOpportunities] AI deal tips skipped:', err)
    }

    await tools.deleteWhere('savings_opportunities', { householdId })
    const now = new Date().toISOString()
    for (const opp of opportunities) {
      await tools.create('savings_opportunities', {
        householdId,
        kind: opp.kind,
        title: opp.title,
        description: opp.description,
        storeOrProvider: opp.storeOrProvider,
        estimatedAnnualSavingsCents: opp.estimatedAnnualSavingsCents,
        membershipCostCents: opp.membershipCostCents,
        breakEvenMonths: opp.breakEvenMonths,
        actionUrl: opp.actionUrl ?? '',
        actionLabel: opp.actionLabel ?? '',
        dismissed: 0,
        createdAt: now,
      })
    }

    return { success: true, data: { count: opportunities.length } }
  },
}
