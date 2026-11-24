import type { EventStop, LiveEvent } from './events'
import { countdownState, type CountdownSchedule } from './countdown'
import { SITE_DOMAIN, SITE_ORIGIN, siteEventUrl } from './site'

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

/** Compact UTC timestamp with the required trailing `Z` for ICS and Google Calendar. */
const basic = (epoch: number) => new Date(epoch).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const text = (value: string) => value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
const safeName = (value: string) => value.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()
/** RFC 5545 folds content lines longer than 75 octets. */
const fold = (line: string) => {
  if (line.length <= 75) return line
  const parts: string[] = []
  let rest = line
  let first = true
  while (rest.length > 74) {
    parts.push(`${first ? '' : ' '}${rest.slice(0, first ? 75 : 74)}`)
    rest = rest.slice(first ? 75 : 74)
    first = false
  }
  parts.push(` ${rest}`)
  return parts.join('\r\n')
}

export function eventLink(event: LiveEvent) {
  return siteEventUrl(event)
}

/** Event id from the canonical `/event/:id` page or an older `?event=` link. */
export function linkedEventId() {
  const match = /^\/event\/([0-9a-f-]{36})\/?$/i.exec(window.location.pathname)
  return match?.[1] || new URLSearchParams(window.location.search).get('event')
}

/** Return to the homepage after closing a directly linked event. */
export function clearEventUrl() {
  if (/^\/event\/[0-9a-f-]{36}\/?$/i.test(window.location.pathname) || new URLSearchParams(window.location.search).get('event')) {
    window.history.replaceState({}, '', '/')
  }
}

export function eventLocation(event: LiveEvent, stop?: EventStop) {
  return stop?.location || event.location || 'TRN Events Nepal'
}

export function calendarDetails(event: LiveEvent) {
  return [event.description || event.organizerMessage, `TRN Events Nepal — ${SITE_ORIGIN}`, eventLink(event)].filter(Boolean).join('\n')
}

export function buildIcs(event: LiveEvent, stop?: EventStop): string | null {
  const window = calendarWindow(stop ?? event, stop?.timezone || event.timezone || 'Asia/Kathmandu')
  if (!window) return null
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TRN Events Nepal//Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.id}@${SITE_DOMAIN}`,
    `DTSTAMP:${basic(Date.now())}`,
    `DTSTART:${basic(window.start)}`,
    `DTEND:${basic(window.end)}`,
    `SUMMARY:${text(event.name)}`,
    `LOCATION:${text(eventLocation(event, stop))}`,
    `DESCRIPTION:${text(calendarDetails(event))}`,
    `URL:${eventLink(event)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].map(fold).join('\r\n')
}

function saveIcs(ics: string, event: LiveEvent) {
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${safeName(event.name) || 'trn-event'}.ics`
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export function downloadIcs(event: LiveEvent, stop?: EventStop) {
  const ics = buildIcs(event, stop)
  if (!ics) return false
  saveIcs(ics, event)
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

/**
 * Android intent that opens the device's default calendar app with the event
 * prefilled. Chrome falls back to Google Calendar when no app handles it.
 */
export function androidCalendarIntent(event: LiveEvent, stop?: EventStop): string | null {
  const window = calendarWindow(stop ?? event, stop?.timezone || event.timezone || 'Asia/Kathmandu')
  const fallback = googleCalendarUrl(event, stop)
  if (!window || !fallback) return null
  const extras = [
    'action=android.intent.action.INSERT',
    'scheme=content',
    'type=vnd.android.cursor.item/event',
    `l.beginTime=${window.start}`,
    `l.endTime=${window.end}`,
    'l.allDay=0',
    `S.title=${encodeURIComponent(event.name)}`,
    `S.description=${encodeURIComponent(calendarDetails(event))}`,
    `S.eventLocation=${encodeURIComponent(eventLocation(event, stop))}`,
    `S.browser_fallback_url=${encodeURIComponent(fallback)}`,
  ].join(';')
  return `intent://com.android.calendar/events#Intent;${extras};end`
}

/**
 * iOS has no public API to silently write to Apple Calendar. Sharing the .ics
 * file hands it to the system share sheet, where Calendar can save it.
 */
export async function shareOrOpenIcs(event: LiveEvent, stop?: EventStop): Promise<'shared' | 'downloaded' | 'unavailable'> {
  const ics = buildIcs(event, stop)
  if (!ics) return 'unavailable'
  const file = new File([ics], `${safeName(event.name) || 'trn-event'}.ics`, { type: 'text/calendar;charset=utf-8' })
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function' && typeof navigator.canShare === 'function') {
    try {
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: event.name })
        return 'shared'
      }
    } catch {
      // Cancelled or unsupported here; fall through to the .ics download.
    }
  }
  saveIcs(ics, event)
  return 'downloaded'
}
