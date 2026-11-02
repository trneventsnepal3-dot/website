import { useEffect, useState } from 'react'
import { api } from './settings'
export type EventStop = { date: string; location: string }
export type LiveEvent = { id: string; revision: number; name: string; location: string; date: string; imageId: string; imageUrl: string; published: boolean; type: 'concert' | 'tour'; artist: string; description: string; stops: EventStop[] }
export const formatEventDate = (value: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`))
export const eventDateLabel = (event: LiveEvent) => event.type === 'tour' ? `${formatEventDate(event.stops[0].date)} – ${formatEventDate(event.stops[event.stops.length - 1].date)}` : formatEventDate(event.date)
export const eventLocationLabel = (event: LiveEvent) => event.type === 'tour' ? `${event.stops.length} shows · ${[...new Set(event.stops.map(stop => stop.location))].join(' / ')}` : event.location
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
