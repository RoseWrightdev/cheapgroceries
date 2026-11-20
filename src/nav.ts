import type { Role } from './constants'

export interface NavItem {
  path: string
  label: string
  roles?: Role[]
  devOnly?: boolean
}

// Primary navigation lives in the brand link (/home) and the History button
// in the top right of Navigation.tsx.
export const nav: NavItem[] = []
