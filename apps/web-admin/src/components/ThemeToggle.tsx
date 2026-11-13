import { Moon, Sun, TextCursorInput } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTheme } from '../lib/theme'

/** One tap between light and dark. The choice is remembered; until it is made, the app follows the device. */
export default function ThemeToggle() {
  const { isDark, set } = useTheme()
  const [large, setLarge] = useState(() => { try { return localStorage.getItem('hms.large') === '1' } catch { return false } })
  useEffect(() => { document.documentElement.classList.toggle('large-text', large); try { localStorage.setItem('hms.large', large ? '1' : '0') } catch { /* private mode */ } }, [large])
  return (
    <>
    <button onClick={() => setLarge((l) => !l)} aria-pressed={large} className="rounded-xl p-2.5 text-slate-600 hover:bg-surface hover:text-ink" aria-label="Larger text" title="Larger text"><TextCursorInput size={19} /></button>
    <button onClick={() => set(isDark ? 'light' : 'dark')} className="rounded-xl p-2.5 text-slate-600 hover:bg-surface hover:text-ink" aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'} title={isDark ? 'Light mode' : 'Dark mode'}>
      {isDark ? <Sun size={19} /> : <Moon size={19} />}
    </button>
    </>
  )
}
