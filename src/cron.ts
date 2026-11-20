/**
 * Scheduled tasks registered into AppCronRoom (worker.ts).
 *
 * `weekly-stale-cache-refresh`:
 * Periodically refreshes up to 5 stale entries in `sku_swap_cache` (> 7 days old)
 * via `amazon/search-products` so cached generic swap prices stay accurate without
 * running per-scan scraping.
 */

import { buildCronContext } from 'deepspace/worker'
import type { CronTask } from 'deepspace/worker'
import type { Env } from '../worker'
import { computeSavingsCents, parsePriceToCents } from './lib/money'
import type { SkuSwapCacheData } from './schemas/sku-swap-cache-schema'

export const tasks: CronTask[] = [
  {
    name: 'weekly-stale-cache-refresh',
    schedule: '0 8 * * 1',
    timezone: 'America/Chicago',
  },
]

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export async function runTask(name: string, env: Env): Promise<void> {
  if (name !== 'weekly-stale-cache-refresh') return

  const ctx = buildCronContext(env, env.OWNER_USER_ID, `app:${env.DEEPSPACE_APP_ID}`)
  const rows = (await ctx.records.query('sku_swap_cache', { limit: 100 })) as unknown as Array<{
    recordId: string
    data: SkuSwapCacheData
  }>
  const cutoff = Date.now() - SEVEN_DAYS_MS

  const stale = rows
    .filter((row) => {
      const ts = Date.parse(row.data.refreshedAt ?? '')
      return Number.isNaN(ts) || ts < cutoff
    })
    .slice(0, 5)

  for (const row of stale) {
    const data = row.data
    try {
      const searchRes = (await ctx.integrations.call('amazon/search-products', {
        query: data.genericAlternativeName,
        limit: 3,
      })) as { products?: Array<{ title: string; link: string; price: string; snapEligible: boolean }> }

      const first = searchRes?.products?.[0]
      const newPrice = first ? parsePriceToCents(first.price) : null
      if (first && newPrice && newPrice > 50) {
        await ctx.records.update('sku_swap_cache', row.recordId, {
          genericPriceCents: newPrice,
          savingsCents: computeSavingsCents(data.typicalPriceCents, newPrice),
          retailerUrl: first.link,
          snapEligible: first.snapEligible ? 1 : 0,
          source: 'amazon_live',
          refreshedAt: new Date().toISOString(),
        })
      }
    } catch (err) {
      console.warn(`[cron] Failed to refresh ${data.skuKey}:`, err)
    }
  }
}
