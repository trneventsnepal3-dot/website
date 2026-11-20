import type { EventStop, LiveEvent } from './events'
import { countdownState, type CountdownSchedule } from './countdown'

export type CalendarWindow = {
  start: number
  end: number
  timeZone: string
}

export function calendarWindow(schedule: CountdownSchedule, timeZone: string, now = Date.now()): CalendarWindow | null {
  const state = countdownState(schedule, now, false, timeZone)
  if (state.start === undefined || state.end === undefined) return null
  return { start: state.start, end: state.end, timeZone: state.timeZone || timeZone }
}

const basic = (epoch: number) => new Date(epoch).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const text = (value: string) => value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
const safeName = (value: string) => value.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()

export function eventLink(event: LiveEvent) {
  const base = `${window.location.origin}${window.location.pathname}`
  return `${base}?event=${event.id}`
}

export function eventLocation(event: LiveEvent, stop?: EventStop) {
  return stop?.location || event.location || 'TRN Events Nepal'
}

export function calendarDetails(event: LiveEvent) {
  return [event.description || event.organizerMessage, 'TRN Events Nepal — https://website-trn13.vercel.app'].filter(Boolean).join('\n')
}

export function downloadIcs(event: LiveEvent, stop?: EventStop) {
  const window = calendarWindow(stop ?? event, stop?.timezone || event.timezone || 'Asia/Kathmandu')
  if (!window) return false
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TRN Events Nepal//Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.id}@trneventsnepal`,
    `DTSTAMP:${basic(Date.now())}`,
    `DTSTART:${basic(window.start)}`,
    `DTEND:${basic(window.end)}`,
    `SUMMARY:${text(event.name)}`,
    `LOCATION:${text(eventLocation(event, stop))}`,
    `DESCRIPTION:${text(calendarDetails(event))}`,
    `URL:${text(eventLink(event))}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${safeName(event.name) || 'trn-event'}.ics`
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
  return true
}

export function googleCalendarUrl(event: LiveEvent, stop?: EventStop) {
  const window = calendarWindow(stop ?? event, stop?.timezone || event.timezone || 'Asia/Kathmandu')
  if (!window) return null
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.name,
    dates: `${basic(window.start)}/${basic(window.end)}`,
    details: calendarDetails(event),
    location: eventLocation(event, stop),
  })
  return `https://calendar.google.com/calendar/render?${params}`
}
