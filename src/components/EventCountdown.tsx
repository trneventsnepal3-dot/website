import { useEffect, useRef, useSyncExternalStore } from 'react'
import './countdown.css'
import { formatEventDate, formatEventTime, type EventStop, type LiveEvent } from '../events'
import { countdownState, countdownUnits, padCountdown } from '../countdown'

let clock = Date.now()
const listeners = new Set<() => void>()
let clockTimer: number | null = null
let watchingVisibility = false

function publishClock() {
  clock = Date.now()
  for (const listener of listeners) listener()
}

function onVisibilityChange() {
  if (!document.hidden) publishClock()
}

function subscribeClock(listener: () => void) {
  if (!listeners.size) clock = Date.now()
  listeners.add(listener)
  if (clockTimer === null) {
    clockTimer = window.setInterval(publishClock, 1000)
    if (!watchingVisibility) {
      document.addEventListener('visibilitychange', onVisibilityChange)
      watchingVisibility = true
    }
  }
  return () => {
    listeners.delete(listener)
    if (!listeners.size && clockTimer !== null) {
      window.clearInterval(clockTimer)
      clockTimer = null
      if (watchingVisibility) {
        document.removeEventListener('visibilitychange', onVisibilityChange)
        watchingVisibility = false
      }
    }
  }
}

const currentClock = () => clock

function useClock() {
  return useSyncExternalStore(subscribeClock, currentClock, currentClock)
}

type Props = {
  event: LiveEvent
  stop?: EventStop
  compact?: boolean
}

export default function EventCountdown({ event, stop, compact = false }: Props) {
  const now = useClock()
  const schedule = stop ?? event
  const fallbackTimeZone = stop?.timezone || event.timezone
  const state = countdownState(schedule, now, Boolean(event.isPast), fallbackTimeZone)
  const previousStatus = useRef(state.status)
  useEffect(() => {
    if (previousStatus.current !== 'ended' && state.status === 'ended') window.dispatchEvent(new Event('trn-events-refresh'))
    previousStatus.current = state.status
  }, [state.status])
  if (state.status === 'tba' || state.status === 'past' || state.status === 'ended') return null

  const dateLabel = formatEventDate(schedule.date || '')
  const timeLabel = state.hasTime ? formatEventTime(schedule.startTime) : ''
  const zoneLabel = state.hasTime ? state.timeZone : ''
  const when = [dateLabel, timeLabel, zoneLabel].filter(Boolean).join(' · ')
  const units = state.status === 'upcoming' && state.remaining !== undefined ? countdownUnits(state.remaining) : []
  const timerLabel = state.status === 'upcoming'
    ? `Time remaining until ${dateLabel}${timeLabel ? ` at ${timeLabel}` : ''}`
    : 'The event is live now'

  return (
    <div className={`event-countdown${compact ? ' is-compact' : ''}`} role="group" aria-label={`${compact ? 'Show' : 'Event'} countdown`}>
      <div className="event-countdown-head">
        <p className="event-countdown-kicker">{state.status === 'upcoming' ? 'Countdown to showtime' : 'Live now'}</p>
        {when && <p className="event-countdown-when">{when}</p>}
      </div>
      {state.status === 'upcoming'
        ? <div className="event-countdown-timer" role="timer" aria-label={timerLabel}>
          {units.map(unit => (
            <div className="event-countdown-unit" key={unit.label}>
              <span className="event-countdown-value">{padCountdown(unit.value)}</span>
              <span className="event-countdown-unit-label">{unit.label}</span>
            </div>
          ))}
        </div>
        : <div className="event-countdown-live" role="status">{timerLabel}</div>}
    </div>
  )
}
