import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from '@phosphor-icons/react'
import { useEvents, TBA_LABEL, formatEventDate, formatEventTime, type EventStop, type LiveEvent } from '../events'
import { countdownUnits, nextShowSlot, padCountdown, type CountdownSlot } from '../countdown'
import { useCountdownClock } from './EventCountdown'
import './next-show.css'

function readDismissed() {
  try { return window.sessionStorage.getItem('trn-next-show-dismissed') || '' } catch { return '' }
}

function metaLabel(event: LiveEvent, stop?: EventStop) {
  const date = stop?.date || (stop ? '' : event.date)
  const time = formatEventTime(stop?.startTime ?? event.startTime)
  const zone = stop?.timezone || event.timezone
  const place = stop?.location || event.location
  const dateText = date ? formatEventDate(date) : TBA_LABEL
  const timeText = date && time ? `${time}${zone ? ` · ${zone}` : ''}` : ''
  return [dateText, timeText, place].filter(Boolean).join(' · ')
}

function NextClock({ slot }: { slot: CountdownSlot }) {
  const units = slot.state.status === 'upcoming' && slot.state.remaining !== undefined ? countdownUnits(slot.state.remaining) : []
  if (slot.state.status !== 'upcoming' || !units.length) return <span className="next-clock is-live" role="status">Live now</span>
  return <div className="next-clock" aria-label="Time until this event starts">
    {units.map(unit => <span className="next-clock-unit" key={unit.label}><b>{padCountdown(unit.value)}</b><i>{unit.label}</i></span>)}
  </div>
}

export default function NextShow() {
  const events = useEvents()
  const now = useCountdownClock()
  const slot = events ? nextShowSlot(events, now) : null
  const [visible, setVisible] = useState(false)
  const [dismissed, setDismissed] = useState(readDismissed)

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > window.innerHeight * 0.7)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const open = () => {
    if (!slot) return
    window.dispatchEvent(new CustomEvent('trn-open-event', { detail: { id: slot.event.id } }))
  }
  const dismiss = () => {
    if (!slot) return
    try { window.sessionStorage.setItem('trn-next-show-dismissed', slot.event.id) } catch {}
    setDismissed(slot.event.id)
  }

  const reserveSpace = Boolean(slot && slot.event.id !== dismissed)
  const showBar = Boolean(visible && reserveSpace)
  const meta = slot ? metaLabel(slot.event, slot.stop) : ''

  useEffect(() => {
    if (!reserveSpace) return
    document.body.classList.add('trn-next-show-visible')
    return () => document.body.classList.remove('trn-next-show-visible')
  }, [reserveSpace])

  return <>
    {slot && <button className="hero-next" onClick={open}>
      <span className="next-kicker"><span className="next-dot" aria-hidden="true" />{slot.state.status === 'live' ? 'Live now' : 'Next show'}</span>
      <strong className="next-title">{slot.event.name}</strong>
      <span className="next-meta">{meta}</span>
      <NextClock slot={slot} />
    </button>}
    {createPortal(<div className={`next-show-bar${showBar ? ' is-visible' : ''}`} aria-hidden={!showBar}>
      {slot && <button className="next-show-bar-main" onClick={open} tabIndex={showBar ? 0 : -1}>
        <img className="next-show-bar-thumb" src={slot.event.imageUrl} alt="" width="44" height="44" />
        <span className="next-show-bar-copy">
          <span className="next-kicker"><span className="next-dot" aria-hidden="true" />{slot.state.status === 'live' ? 'Live now' : 'Next show'}</span>
          <strong className="next-show-bar-title">{slot.event.name}</strong>
          <span className="next-show-bar-meta">{meta}</span>
        </span>
        <NextClock slot={slot} />
        <span className="next-show-bar-details">Details</span>
      </button>}
      {slot && showBar && <button className="next-show-bar-close" onClick={dismiss} tabIndex={showBar ? 0 : -1} aria-label="Hide next show bar"><X size={18} /></button>}
    </div>, document.body)}
  </>
}
