import './events.css'
import EventCountdown from './EventCountdown'
import EventActions from './EventActions'
import EventRecap from './EventRecap'
import StopAftermovie from './StopAftermovie'
import TourMap from './TourMap'
import { EventShareButton } from './EventShareButton'
import { eventDateLabel, eventVenueLabel, formatEventDate, formatEventTime, useEvents, usePastEvents } from '../events'
import { nextStop } from '../countdown'
import { clearEventUrl, linkedEventId } from '../calendar'
import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, X } from '@phosphor-icons/react'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { setEventMusicActive } from '../siteMusic'

function useEventMusic(active: { id: string; musicUrl: string | null } | undefined, volume: number) {
  const audio = useRef<HTMLAudioElement | null>(null)
  useEffect(() => {
    if (!active?.musicUrl) return
    const player = new Audio(active.musicUrl)
    player.loop = true
    player.volume = volume
    audio.current = player
    setEventMusicActive(true)
    window.dispatchEvent(new Event('trn-site-music-pause'))
    void player.play().catch(() => {})
    return () => {
      setEventMusicActive(false)
      window.dispatchEvent(new Event('trn-site-music-start'))
      player.pause()
      player.src = ''
      audio.current = null
    }
  }, [active?.id, active?.musicUrl])
  useEffect(() => { if (audio.current) audio.current.volume = volume }, [volume])
}

export default function UpcomingEvents({ musicVolume = 0.35 }: { musicVolume?: number }) {
  const events = useEvents()
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const linked = useRef(false)
  const active = events?.find(event => event.id === selected)
  useEventMusic(active, musicVolume)
  const close = () => {
    setSelected(null)
    trigger.current?.focus({ preventScroll: true })
    clearEventUrl()
  }
  useEffect(() => { ScrollTrigger.refresh() }, [events])
  useEffect(() => {
    if (linked.current || !events) return
    const id = linkedEventId()
    if (id && events.some(event => event.id === id)) { linked.current = true; setSelected(id) }
  }, [events])
  useEffect(() => {
    const handler = (event: Event) => {
      const id = (event as CustomEvent<{ id?: string }>).detail?.id
      if (id && events?.some(item => item.id === id)) setSelected(id)
    }
    window.addEventListener('trn-open-event', handler)
    return () => window.removeEventListener('trn-open-event', handler)
  }, [events])
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
  const calendarStop = active ? nextStop(active, Date.now()) : undefined
  const nextIndex = active?.type === 'tour' && calendarStop ? active.stops.indexOf(calendarStop) : undefined
  if (!events?.length) return null
  return <>
    <section className="events section-pad" id="upcoming" aria-labelledby="events-title">
      <div className="events-heading" data-reveal><h2 id="events-title">Live events.</h2></div>
      <div className="events-list">{events.map(event => <article key={event.id}>
        <button className="event-row" aria-label={`View details for ${event.name}`} aria-haspopup="dialog" onClick={click => { trigger.current = click.currentTarget; setSelected(event.id) }}>
          <img className="event-thumb" src={event.imageUrl} alt="" width="150" height="130" loading="lazy" />
          <div className="event-info">{event.eventNumber && <span className="event-number">Event No. {event.eventNumber}</span>}<h3>{event.name}</h3><p>{event.type === 'tour' ? `${event.artist} · ${event.stops.length} shows` : event.location}</p></div>
          <div className="event-date"><span className="event-status">Upcoming</span><p>{eventDateLabel(event)}</p><span className="event-view">View {event.type === 'tour' ? 'tour dates' : 'event details'} <ArrowUpRight size={18} aria-hidden="true" /></span></div>
        </button>
      </article>)}</div>
    </section>
    <dialog ref={dialog} className="past-event-dialog" aria-labelledby="event-dialog-title" onCancel={close} onClose={() => { if (selected) close() }} onClick={event => {
      if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close() }
    }}>
      {active && <><button className="event-close icon-button" onClick={close} aria-label="Close event details" autoFocus><X size={24} /></button>
        <div className="past-dialog-artwork"><img src={active.imageUrl} alt={`${active.name} artwork`} /></div>
        <div className="past-dialog-body">
          <div className="past-dialog-head">
            <span className="past-dialog-badge is-upcoming">Upcoming event</span>
            {active.eventNumber && <span className="past-dialog-number">Event No. {active.eventNumber}</span>}
          </div>
          <h2 id="event-dialog-title">{active.name}</h2>
          {(active.description || active.organizerMessage) && <p className="past-dialog-tagline">{active.description || active.organizerMessage}</p>}
          <div className="past-dialog-tags">
            <span className="past-dialog-tag">{active.type === 'tour' ? 'TOUR' : 'LIVE CONCERT'}</span>
            {active.date && <span className="past-dialog-tag">{new Date(`${active.date}T00:00:00Z`).getUTCFullYear()}</span>}
            <span className="past-dialog-tag">{active.type === 'tour' ? `${active.stops.length} shows` : active.location}</span>
          </div>
          {active.type === 'concert' && <EventCountdown event={active} />}
          <EventActions event={active} stop={calendarStop} />
          <dl className="past-dialog-info">
            <div><dt>Date</dt><dd>{eventDateLabel(active)}</dd></div>
            <div><dt>{active.type === 'tour' ? 'Shows' : 'Venue'}</dt><dd>{eventVenueLabel(active)}</dd></div>
            {active.artist && <div><dt>Artist</dt><dd>{active.artist}</dd></div>}
            {active.organizer && <div><dt>{active.organizerType === 'tour' ? 'Tour by' : 'Org by'}</dt><dd>{active.organizer}</dd></div>}
          </dl>
          {active.organizerMessage && active.description && <div className="past-dialog-note"><h3>A note from the organiser</h3><p>{active.organizerMessage}</p></div>}
          {active.type === 'tour' && active.stops.length > 0 && <section className="past-dialog-stops" aria-labelledby="tour-dates-title"><TourMap stops={active.stops} nextIndex={nextIndex} /><h3 id="tour-dates-title">Tour dates</h3><ol>{active.stops.map((stop,index) => {
            const stopTime = stop.dateTba ? '' : formatEventTime(stop.startTime)
            return <li key={`${stop.date}-${index}`} id={`upcoming-${active.id}-stop-${index}`}>
              <div className="past-dialog-stop-head"><time dateTime={stop.date || undefined}>{formatEventDate(stop.date)}</time>{stopTime && <span className="past-dialog-stop-time">{stopTime}</span>}</div>
              <p>{stop.location}</p>
              <EventCountdown event={active} stop={stop} compact />
              <StopAftermovie url={stop.aftermovieUrl} title={stop.location} variant="list" />
            </li>
          })}</ol></section>}
        </div></>}
    </dialog>
  </>
}

export function PastEvents({ musicVolume = 0.35 }: { musicVolume?: number }) {
  const events = usePastEvents()
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const linked = useRef(false)
  const active = events?.find(event => event.id === selected)
  useEventMusic(active, musicVolume)
  const close = () => {
    setSelected(null)
    trigger.current?.focus({ preventScroll: true })
    clearEventUrl()
  }
  useEffect(() => { ScrollTrigger.refresh() }, [events])
  useEffect(() => {
    if (linked.current || !events) return
    const id = linkedEventId()
    if (id && events.some(event => event.id === id)) { linked.current = true; setSelected(id) }
  }, [events])
  useEffect(() => {
    const handler = (event: Event) => {
      const id = (event as CustomEvent<{ id?: string }>).detail?.id
      if (id && events?.some(item => item.id === id)) setSelected(id)
    }
    window.addEventListener('trn-open-event', handler)
    return () => window.removeEventListener('trn-open-event', handler)
  }, [events])
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
    <section className="events section-pad past-events" id="past-events" aria-labelledby="past-events-title">
      <div className="events-heading" data-reveal><h2 id="past-events-title">Past events.</h2><p>The nights we have shared together.</p></div>
      <div className="past-events-list">{events.map(event => {
        const year = event.date ? new Date(`${event.date}T00:00:00Z`).getUTCFullYear() : null
        return <button className="past-event-row" key={event.id} data-reveal aria-haspopup="dialog" aria-label={`View details for ${event.name}`} onClick={click => { trigger.current = click.currentTarget; setSelected(event.id) }}>
          <img className="past-event-thumb" src={event.imageUrl} alt="" width="150" height="130" loading="lazy" />
          <div className="past-event-info">{event.eventNumber && <span className="event-number">Event No. {event.eventNumber}</span>}<h3 className="past-event-name">{event.name}</h3>
            <p className="past-event-venue">{eventVenueLabel(event)}{year ? ` · ${year}` : ''}</p>
          </div>
          <div className="past-event-date">
            <span className="past-event-status">Completed</span>
            <p>{eventDateLabel(event)}</p>
            <span className="past-event-view">View event details <ArrowUpRight size={18} aria-hidden="true" /></span>
          </div>
        </button>
      })}</div>
    </section>
    <dialog ref={dialog} className="past-event-dialog" aria-labelledby="past-dialog-title" onCancel={close} onClose={() => { if (selected) close() }} onClick={event => {
      if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close() }
    }}>
      {active && <>
        <button className="event-close icon-button" onClick={close} aria-label="Close event details" autoFocus><X size={24} /></button>
        {active.imageUrl
          ? <div className="past-dialog-artwork"><img src={active.imageUrl} alt={`${active.name} poster`} /></div>
          : <div className="past-dialog-artwork past-dialog-artwork-empty"><span>Event poster unavailable</span></div>}
        <div className="past-dialog-body">
          <div className="past-dialog-head">
            <span className="past-dialog-badge">Completed event</span>
            {active.eventNumber && <span className="past-dialog-number">Event No. {active.eventNumber}</span>}
          </div>
          <h2 id="past-dialog-title">{active.name}</h2>
          {(active.organizerMessage || active.description) && <p className="past-dialog-tagline">{active.organizerMessage || active.description}</p>}
          <div className="past-dialog-tags">
            <span className="past-dialog-tag">{active.type === 'tour' ? 'TOUR' : 'LIVE CONCERT'}</span>
            {active.date && <span className="past-dialog-tag">{new Date(`${active.date}T00:00:00Z`).getUTCFullYear()}</span>}
            <span className="past-dialog-tag">{active.location}</span>
          </div>
          <div className="past-dialog-share"><EventShareButton event={active} /></div>
          <dl className="past-dialog-info">
            <div><dt>Date</dt><dd>{eventDateLabel(active)}</dd></div>
            <div><dt>{active.type === 'tour' ? 'Shows' : 'Venue'}</dt><dd>{eventVenueLabel(active)}</dd></div>
            {active.artist && <div><dt>Artist</dt><dd>{active.artist}</dd></div>}
            {active.organizer && <div><dt>{active.organizerType === 'tour' ? 'Tour by' : 'Org by'}</dt><dd>{active.organizer}</dd></div>}
          </dl>
          <EventRecap event={active} onNavigate={close} />
          {active.type === 'tour' && active.stops.length > 0 && <section className="past-dialog-stops" aria-labelledby="past-tour-title">
            <TourMap stops={active.stops} />
            <h3 id="past-tour-title">Tour dates</h3>
            <ol>{active.stops.map((stop, index) => <li key={`${stop.date}-${index}`} id={`past-${active.id}-stop-${index}`}><time dateTime={stop.date || undefined}>{formatEventDate(stop.date)}</time><p>{stop.location}</p><StopAftermovie url={stop.aftermovieUrl} title={stop.location} variant="list" /></li>)}</ol>
          </section>}
        </div>
      </>}
    </dialog>
  </>
}
