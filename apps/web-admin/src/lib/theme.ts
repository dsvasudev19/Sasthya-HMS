import { useCallback, useEffect, useState } from 'react'

export type ThemeChoice = 'light' | 'dark' | 'system'
const KEY = 'hms.theme'

const read = (): ThemeChoice => { try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'system' } catch { return 'system' } }
const dark = (c: ThemeChoice) => c === 'dark' || (c === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
export const applyTheme = (c: ThemeChoice = read()) => document.documentElement.classList.toggle('dark', dark(c))

/** Light, dark, or follow the device. Applied before the first paint (see main.tsx) so there is no flash. */
export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(read)
  useEffect(() => {
    applyTheme(choice)
    if (choice !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const on = () => applyTheme('system')
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [choice])
  const set = useCallback((c: ThemeChoice) => { try { localStorage.setItem(KEY, c) } catch { /* private mode */ } setChoice(c) }, [])
  return { choice, set, isDark: dark(choice) }
}
