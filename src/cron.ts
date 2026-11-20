import { buildCronContext, type CronTask } from 'deepspace/worker'
import type { Env } from '../worker'
import { computeSavingsCents, parsePriceToCents } from './lib/money'
import type { SkuSwapCacheData } from './schemas/sku-swap-cache-schema'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
const REFRESH_BATCH_MAX = 15

export const tasks: CronTask[] = [
  { name: 'weekly-stale-cache-refresh', schedule: '0 6 * * 0' },
]

export async function runTask(name: string, env: Env): Promise<void> {
  if (name !== 'weekly-stale-cache-refresh') {
    return
  }
  const ctx = buildCronContext(env, env.OWNER_USER_ID, `app:${env.DEEPSPACE_APP_ID}`)
  const rows = (await ctx.records.query('sku_swap_cache', {
    limit: 100,
  })) as unknown as Array<{ recordId: string; data: SkuSwapCacheData }>

  const cutoff = Date.now() - SEVEN_DAYS_MS
  const stale = rows
    .filter((row) => {
      const isAmazon = row.data.source === 'amazon_live'
      const isOld = !row.data.refreshedAt || Date.parse(row.data.refreshedAt) < cutoff
      return isAmazon && isOld
    })
    .slice(0, REFRESH_BATCH_MAX)

  for (const row of stale) {
    try {
      const res = (await ctx.integrations.call('amazon/search-products', {
        query: `amazon fresh ${row.data.canonicalName}`.slice(0, 90),
        limit: 3,
      })) as {
        products?: Array<{ title: string; link: string; price: string; snapEligible: boolean }>
      }
      const first = res?.products?.[0]
      const priceCents = parsePriceToCents(first?.price)
      if (first && priceCents && priceCents >= 75) {
        await ctx.records.update('sku_swap_cache', row.recordId, {
          genericAlternativeName: first.title.slice(0, 190),
          genericPriceCents: priceCents,
          savingsCents: computeSavingsCents(row.data.typicalPriceCents, priceCents),
          retailerUrl: first.link,
          snapEligible: first.snapEligible ? 1 : 0,
          refreshedAt: new Date().toISOString(),
        })
      }
    } catch {
      // Retry on the next weekly schedule.
    }
  }
}
