export const THEMES = [
  {
    id: 'market',
    label: 'Market Paper',
    description: 'Warm receipt-paper light theme with forest-pine savings accents.',
  },
  {
    id: 'slate',
    label: 'Slate',
    description: 'Neutral dark fallback theme.',
  },
] as const

export type ThemeId = (typeof THEMES)[number]['id']

export function getActiveTheme(): ThemeId {
  if (typeof document === 'undefined') return 'market'
  const id = document.documentElement.getAttribute('data-theme') as ThemeId | null
  return id ?? 'market'
}

export function getTheme(id: string) {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}
