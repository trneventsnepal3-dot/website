import { useEffect, useState } from 'react'
import { api } from './settings'
export type LiveEvent = { id: string; revision: number; name: string; location: string; date: string; imageId: string; imageUrl: string; published: boolean }
export const formatEventDate = (value: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`))
export function useEvents() {
  const [events, setEvents] = useState<LiveEvent[] | null>(null)
  useEffect(() => {
    let active = true
    const refresh = () => { if (!document.hidden) void api<LiveEvent[]>('events').then(value => { if (active) setEvents(value) }).catch(() => {}) }
    refresh()
    const timer = window.setInterval(refresh, 30000)
    window.addEventListener('focus', refresh)
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [])
  return events
}
