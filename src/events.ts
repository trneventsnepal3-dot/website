import { useEffect, useState } from 'react'
import { api } from './settings'
export type EventStop = { date: string; dateTba: boolean; location: string; startTime?: string; endDate?: string; endTime?: string; timezone?: string; completed?: boolean }
export type EventAlbumPhoto = { id: string; url: string; alt: string }
export type EventAlbum = { id: string; name: string; count: number; photos: EventAlbumPhoto[] }
export type LiveEvent = { id: string; revision: number; name: string; location: string; date: string; dateTba: boolean; imageId: string; imageUrl: string; published: boolean; type: 'concert' | 'tour'; artist: string; description: string; stops: EventStop[]; isPast: boolean; organizer: string; organizerType: 'org' | 'tour'; organizerMessage: string; eventNumber: string; musicId: string | null; musicUrl: string | null; musicName: string | null; startTime?: string; endDate?: string; endTime?: string; timezone?: string; albumId?: string | null; albumName?: string | null; album?: EventAlbum | null; recapUrl?: string }
export const TBA_LABEL = 'To be Announced'
export const DEFAULT_TIME_ZONE = 'Asia/Kathmandu'
export const TIME_ZONE_OPTIONS = [
  'Asia/Kathmandu',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Europe/London',
  'Europe/Paris',
  'America/New_York',
  'America/Los_Angeles',
  'Australia/Sydney',
  'Pacific/Auckland',
  'UTC',
]
export const formatEventDate = (value: string) => value ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`)) : TBA_LABEL
export const formatEventTime = (value?: string | null) => {
  if (!value || !/^([01]\d|2[0-3]):([0-5]\d)$/.test(value)) return ''
  const [hour, minute] = value.split(':').map(Number)
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}
export const eventDateLabel = (event: LiveEvent) => {
  if (event.type === 'concert') return event.dateTba ? TBA_LABEL : formatEventDate(event.date)
  const dated = event.stops.filter(stop => !stop.dateTba && stop.date)
  return dated.length ? dated.length === 1 ? formatEventDate(dated[0].date) : `${formatEventDate(dated[0].date)} – ${formatEventDate(dated[dated.length - 1].date)}` : TBA_LABEL
}
export const eventLocationLabel = (event: LiveEvent) => event.type === 'tour' ? `${event.stops.length} shows · ${[...new Set(event.stops.map(stop => stop.location))].join(' / ')}` : event.location
export const eventVenueLabel = (event: LiveEvent) => event.type === 'tour' ? `${event.stops.length} shows` : event.location
export function useEvents() {
  const [events, setEvents] = useState<LiveEvent[] | null>(null)
  useEffect(() => {
    let active = true
    const refresh = () => { if (!document.hidden) void api<LiveEvent[]>('events').then(value => { if (active) setEvents(value) }).catch(() => {}) }
    refresh()
    const timer = window.setInterval(refresh, 30000)
    window.addEventListener('focus', refresh)
    window.addEventListener('trn-events-refresh', refresh)
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('trn-events-refresh', refresh) }
  }, [])
  return events
}
export function usePastEvents() {
  const [events, setEvents] = useState<LiveEvent[] | null>(null)
  useEffect(() => {
    let active = true
    const refresh = () => { if (!document.hidden) void api<LiveEvent[]>('past-events').then(value => { if (active) setEvents(value) }).catch(() => {}) }
    refresh()
    const timer = window.setInterval(refresh, 30000)
    window.addEventListener('focus', refresh)
    window.addEventListener('trn-events-refresh', refresh)
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('trn-events-refresh', refresh) }
  }, [])
  return events
}
