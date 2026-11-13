import { useLocation } from 'react-router-dom'

export default function Soon() {
  const { pathname } = useLocation()
  return (
    <div className="grid place-items-center py-24 text-center">
      <h1 className="text-2xl font-semibold capitalize">{pathname.slice(1).replace('-', ' ')}</h1>
      <p className="mt-2 max-w-sm text-sm text-muted">This module is on the roadmap and will appear here once it is built.</p>
    </div>
  )
}
