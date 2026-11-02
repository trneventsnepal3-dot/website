import './events.css'
import { eventDateLabel, eventLocationLabel, formatEventDate, useEvents } from '../events'
import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, X } from '@phosphor-icons/react'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

export default function UpcomingEvents() {
  const events = useEvents()
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const active = events?.find(event => event.id === selected)
  const close = () => { setSelected(null); trigger.current?.focus({ preventScroll: true }) }
  useEffect(() => { ScrollTrigger.refresh() }, [events])
  useEffect(() => {
    if (active && !dialog.current?.open) dialog.current?.showModal()
    if (!active && dialog.current?.open) dialog.current.close()
  }, [active])
  useEffect(() => {
    if (!active) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [Boolean(active)])
  if (!events?.length) return null
  return <>
    <section className="events section-pad" id="upcoming" aria-labelledby="events-title">
      <div className="events-heading" data-reveal><h2 id="events-title">Live events.</h2></div>
      <div className="events-list">{events.map(event => <article key={event.id}>
        <button className="event-row" aria-label={`View details for ${event.name}`} aria-haspopup="dialog" onClick={click => { trigger.current = click.currentTarget; setSelected(event.id) }}>
          <img src={event.imageUrl} alt="" width="240" height="180" loading="lazy" />
          <div className="event-info"><h3>{event.name}</h3><p>{event.type === 'tour' ? `${event.artist} · ${event.stops.length} shows` : event.location}</p></div>
          <div className="event-date"><p>{eventDateLabel(event)}</p><span>View {event.type === 'tour' ? 'tour dates' : 'event details'} <ArrowUpRight size={18} aria-hidden="true" /></span></div>
        </button>
      </article>)}</div>
    </section>
    <dialog ref={dialog} className="event-dialog" aria-labelledby="event-dialog-title" onCancel={close} onClose={() => { if (selected) close() }} onClick={event => {
      if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close() }
    }}>
      {active && <><button className="event-close icon-button" onClick={close} aria-label="Close event details" autoFocus><X size={24} /></button>
        <div className="event-dialog-layout"><div className="event-dialog-artwork"><img src={active.imageUrl} alt={`${active.name} artwork`} /></div>
          <div className="event-dialog-details"><h2 id="event-dialog-title">{active.name}</h2>{active.artist && <p className="event-artist">{active.artist}</p>}
            <p>{eventDateLabel(active)}</p>{active.type === 'concert' && <p>{eventLocationLabel(active)}</p>}
            {active.description && <p className="event-description">{active.description}</p>}
            {active.type === 'tour' && <section className="event-schedule" aria-labelledby="tour-dates-title"><h3 id="tour-dates-title">Tour dates</h3><ol>{active.stops.map((stop,index) => <li key={`${stop.date}-${index}`}><time dateTime={stop.date}>{formatEventDate(stop.date)}</time><p>{stop.location}</p></li>)}</ol></section>}
          </div></div></>}
    </dialog>
  </>
}
