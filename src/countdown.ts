import { DEFAULT_TIME_ZONE, type EventStop, type LiveEvent } from './events'

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

export type CountdownStatus = 'upcoming' | 'live' | 'ended' | 'tba' | 'past'

export type CountdownSchedule = {
  date?: string | null
  dateTba?: boolean
  startTime?: string | null
  endDate?: string | null
  endTime?: string | null
  timezone?: string | null
  completed?: boolean
}

export type CountdownState = {
  status: CountdownStatus
  start?: number
  end?: number
  remaining?: number
  timeZone?: string
  hasTime?: boolean
}

type DateParts = { year: number; month: number; day: number }
type ClockParts = { hour: number; minute: number }

export const isExactTime = (value?: string | null): value is string => Boolean(value && TIME_PATTERN.test(value))

function dateParts(date?: string | null): DateParts | null {
  if (!date) return null
  const match = DATE_PATTERN.exec(date)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const check = new Date(Date.UTC(year, month - 1, day))
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null
  return { year, month, day }
}

function clockParts(time?: string | null): ClockParts {
  if (isExactTime(time)) {
    const [, hour, minute] = TIME_PATTERN.exec(time) || []
    return { hour: Number(hour), minute: Number(minute) }
  }
  return { hour: 0, minute: 0 }
}

function safeTimeZone(value?: string | null) {
  if (!value) return DEFAULT_TIME_ZONE
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0)
    return value
  } catch {
    return DEFAULT_TIME_ZONE
  }
}

function timeZoneOffset(milliseconds: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(milliseconds))
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)?.value || 0)
  const wallTime = Date.UTC(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'), value('second'))
  return wallTime - milliseconds
}

/** Convert a wall-clock date and time in a named time zone into a UTC timestamp. */
function wallTimeInZoneToEpoch(date: DateParts, time: ClockParts, timeZone: string) {
  const wallTime = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute, 0)
  const firstOffset = timeZoneOffset(wallTime, timeZone)
  let epoch = wallTime - firstOffset
  const secondOffset = timeZoneOffset(epoch, timeZone)
  if (secondOffset !== firstOffset) epoch = wallTime - secondOffset
  return epoch
}

export function countdownState(
  schedule: CountdownSchedule,
  now: number,
  past = false,
  fallbackTimeZone: string = DEFAULT_TIME_ZONE,
): CountdownState {
  if (past || schedule.completed) return { status: 'past' }
  const startDate = dateParts(schedule.date)
  if (schedule.dateTba || !startDate) return { status: 'tba' }

  const timeZone = safeTimeZone(schedule.timezone || fallbackTimeZone)
  const start = wallTimeInZoneToEpoch(startDate, clockParts(schedule.startTime), timeZone)
  const endDate = dateParts(schedule.endDate)
  const endDay = endDate && schedule.endDate && schedule.date && schedule.endDate >= schedule.date ? endDate : startDate
  const lastMinute = { hour: 23, minute: 59 }
  let end = wallTimeInZoneToEpoch(endDay, isExactTime(schedule.endTime) ? clockParts(schedule.endTime) : lastMinute, timeZone)
  if (end < start) end = wallTimeInZoneToEpoch(startDate, lastMinute, timeZone)

  const hasTime = isExactTime(schedule.startTime)
  if (now < start) return { status: 'upcoming', start, end, remaining: start - now, timeZone, hasTime }
  if (now <= end) return { status: 'live', start, end, remaining: end - now, timeZone, hasTime }
  return { status: 'ended' }
}

export type CountdownSlot = { event: LiveEvent; stop?: EventStop; state: CountdownState }

/** Every dated concert or tour stop that is currently upcoming or live. */
export function activeSlots(events: LiveEvent[], now: number): CountdownSlot[] {
  const slots: CountdownSlot[] = []
  for (const event of events) {
    if (event.type === 'tour') {
      for (const stop of event.stops) {
        const state = countdownState(stop, now, Boolean(event.isPast), event.timezone)
        if (state.status === 'upcoming' || state.status === 'live') slots.push({ event, stop, state })
      }
      continue
    }
    const state = countdownState(event, now, Boolean(event.isPast), event.timezone)
    if (state.status === 'upcoming' || state.status === 'live') slots.push({ event, state })
  }
  return slots
}

/** The soonest upcoming show, or the live show that finishes first. */
export function nextShowSlot(events: LiveEvent[], now: number): CountdownSlot | null {
  const slots = activeSlots(events, now)
  const upcoming = slots.filter(slot => slot.state.status === 'upcoming')
  if (upcoming.length) return upcoming.reduce((first, slot) => (slot.state.start! < first.state.start! ? slot : first))
  const live = slots.filter(slot => slot.state.status === 'live')
  if (live.length) return live.reduce((first, slot) => (slot.state.end! > first.state.end! ? slot : first))
  return null
}

/** The next show still to come for a tour, used for calendar actions. */
export function nextStop(event: LiveEvent, now: number): EventStop | undefined {
  if (event.type !== 'tour') return undefined
  return event.stops.find(stop => {
    const state = countdownState(stop, now, Boolean(event.isPast), event.timezone)
    return state.status === 'upcoming' || state.status === 'live'
  })
}

export type CountdownUnit = { label: string; value: number }

export function countdownUnits(remaining: number): CountdownUnit[] {
  const total = Math.max(0, Math.floor(remaining / 1000))
  return [
    { label: 'Days', value: Math.floor(total / 86400) },
    { label: 'Hrs', value: Math.floor((total % 86400) / 3600) },
    { label: 'Min', value: Math.floor((total % 3600) / 60) },
    { label: 'Sec', value: total % 60 },
  ]
}

export const padCountdown = (value: number) => String(Math.max(0, value)).padStart(2, '0')
