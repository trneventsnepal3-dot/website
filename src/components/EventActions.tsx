import { useEffect, useRef, useState } from 'react'
import { CalendarPlus, Check, ShareNetwork } from '@phosphor-icons/react'
import type { EventStop, LiveEvent } from '../events'
import { calendarWindow, downloadIcs, eventLink } from '../calendar'
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
  }
  const share = async () => {
    const link = eventLink(event)
    if (navigator.share) {
      try { await navigator.share({ title: event.name, text: `${event.name} — TRN Events Nepal`, url: link }); return } catch (error) {
        if ((error as Error).name === 'AbortError') return
      }
    }
    try {
      await navigator.clipboard.writeText(link)
      setStatus('Event link copied')
    } catch {
      setStatus('Could not copy the event link')
    }
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setStatus(''), 2600)
  }

  return <div className="event-actions">
    {calendar && <button type="button" className="event-action" onClick={add}><CalendarPlus size={16} weight="fill" aria-hidden="true" />Add to calendar</button>}
    <button type="button" className="event-action" onClick={() => void share()}><ShareNetwork size={16} aria-hidden="true" />Share event</button>
    {status && <span className="event-action-status" role="status"><Check size={13} aria-hidden="true" />{status}</span>}
  </div>
}
