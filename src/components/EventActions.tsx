import { useEffect, useRef, useState } from 'react'
import { CalendarPlus, Check } from '@phosphor-icons/react'
import type { EventStop, LiveEvent } from '../events'
import { calendarWindow, downloadIcs } from '../calendar'
import { EventShareButton } from './EventShareButton'
import './event-actions.css'

type Props = { event: LiveEvent; stop?: EventStop }

export default function EventActions({ event, stop }: Props) {
  const [status, setStatus] = useState('')
  const timer = useRef<number | null>(null)
  const schedule = stop ?? event
  const calendar = calendarWindow(schedule, stop?.timezone || event.timezone || 'Asia/Kathmandu')

  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current) }, [])

  const add = () => {
    downloadIcs(event, stop)
    setStatus('Calendar file downloaded')
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setStatus(''), 2600)
  }

  return <div className="event-actions">
    {calendar && <button type="button" className="event-action" onClick={add}><CalendarPlus size={16} weight="fill" aria-hidden="true" />Add to calendar</button>}
    <EventShareButton event={event} />
    {status && <span className="event-action-status" role="status"><Check size={13} aria-hidden="true" />{status}</span>}
  </div>
}
