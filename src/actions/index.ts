import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import { householdActions } from './households'
import { receiptActions } from './receipts'
import { savingsActions } from './savings'

export const actions: Record<string, ActionHandler<Env>> = {
  ...householdActions,
  ...receiptActions,
  ...savingsActions,
}
