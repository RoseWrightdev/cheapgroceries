import { test, expect, loadAllTestAccounts } from 'deepspace/testing'

const usableTestAccounts = loadAllTestAccounts().length
test.skip(
  usableTestAccounts < 2,
  `Needs 2 usable test accounts, found ${usableTestAccounts}.`,
)

test('each browser renders its own signed-in account', async ({ users }) => {
  const [a, b] = await users(2)
  await Promise.all([a.page.goto('/home'), b.page.goto('/home')])

  for (const user of [a, b]) {
    await expect(user.page.getByTestId('app-navigation')).toBeVisible({ timeout: 15_000 })
    await expect(user.page.getByTestId('nav-user-name')).toHaveText(/\S/, { timeout: 15_000 })
    await user.page.getByRole('button', { name: 'Account menu' }).click()
    await expect(user.page.getByTestId('nav-user-email')).toHaveText(user.email, {
      timeout: 15_000,
    })
  }
})

test('user A receipt audit stays private from user B (RBAC isolation)', async ({ users }) => {
  const [a, b] = await users(2)
  const suffix = Math.random()
    .toString(36)
    .replace(/[^a-z]/g, '')
    .slice(0, 6)
  const uniqueStore = `MarketIso${suffix}`

  await a.page.goto('/home')
  await expect(a.page.getByTestId('app-navigation')).toBeVisible({ timeout: 15_000 })

  // User A pastes a unique receipt and verifies it appears in their Receipt History
  await a.page.getByTestId('open-gmail-btn').click()
  await a.page.getByTestId('tab-paste-receipt').click()
  await a.page
    .getByTestId('receipt-text-input')
    .fill(
      [
        uniqueStore,
        '2026-11-18',
        'Tide Liquid Laundry Detergent 92 oz $13.49',
        'Bounty Paper Towels 6 Rolls $14.99',
        'Quaker Oats 42 oz $5.99',
        'TOTAL $34.47',
      ].join('\n'),
    )
  await a.page.getByTestId('submit-receipt-text-btn').click()
  await expect(a.page.getByTestId('submit-receipt-text-btn')).toBeHidden({ timeout: 15_000 })

  await a.page.goto('/receipts')
  await expect(a.page.getByRole('heading', { name: uniqueStore })).toBeVisible({ timeout: 15_000 })

  // User B visits /receipts and must NOT see User A's private receipt
  await b.page.goto('/receipts')
  await expect(b.page.getByTestId('app-navigation')).toBeVisible({ timeout: 15_000 })
  await expect(b.page.getByText(uniqueStore)).toHaveCount(0)
})
