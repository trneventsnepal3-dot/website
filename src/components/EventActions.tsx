import { useEffect, useRef, useState } from 'react'
import { CalendarPlus, Check } from '@phosphor-icons/react'
import type { EventStop, LiveEvent } from '../events'
import { androidCalendarIntent, calendarWindow, googleCalendarUrl, shareOrOpenIcs } from '../calendar'
import { EventShareButton } from './EventShareButton'
import './event-actions.css'

type Props = { event: LiveEvent; stop?: EventStop }

function deviceKind(): 'android' | 'ios' | 'desktop' {
  if (typeof navigator === 'undefined') return 'desktop'
  const agent = navigator.userAgent
  if (/Android/i.test(agent)) return 'android'
  if (/iPad|iPhone|iPod/.test(agent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios'
  return 'desktop'
}

export default function EventActions({ event, stop }: Props) {
  const [status, setStatus] = useState('')
  const timer = useRef<number | null>(null)
  const schedule = stop ?? event
  const timeZone = stop?.timezone || event.timezone || 'Asia/Kathmandu'
  const calendar = calendarWindow(schedule, timeZone)

  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current) }, [])

  const flash = (message: string) => {
    setStatus(message)
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setStatus(''), 3200)
  }

  const add = async () => {
    const device = deviceKind()

    if (device === 'android') {
      const intent = androidCalendarIntent(event, stop)
      if (intent) {
        window.location.href = intent
        flash('Opening your calendar app…')
        return
      }
    }

    if (device === 'ios') {
      const result = await shareOrOpenIcs(event, stop)
      flash(result === 'shared' ? 'Choose Calendar to save the event' : result === 'downloaded' ? 'Open the file in Calendar to save' : 'Calendar date not available yet')
      return
    }

    const google = googleCalendarUrl(event, stop)
    if (google) {
      window.open(google, '_blank', 'noopener,noreferrer')
      flash('Opening Google Calendar…')
      return
    }

    flash('Calendar date not available yet')
  }

  return <div className="event-actions">
    {calendar && <button type="button" className="event-action" onClick={add}><CalendarPlus size={16} weight="fill" aria-hidden="true" />Add to calendar</button>}
    <EventShareButton event={event} />
    {status && <span className="event-action-status" role="status"><Check size={13} aria-hidden="true" />{status}</span>}
  </div>
}
