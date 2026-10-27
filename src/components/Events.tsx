import './events.css'
import { formatEventDate, useEvents } from '../events'
import { useEffect } from 'react'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

export default function UpcomingEvents() {
  const events = useEvents()
  useEffect(() => { ScrollTrigger.refresh() }, [events])
  if (!events?.length) return null
  return (
    <section className="events section-pad" id="upcoming" aria-labelledby="events-title">
      <div className="events-heading" data-reveal><h2 id="events-title">Live events.</h2></div>
      <div className="events-list">{events.map(event => <article className="event-row" key={event.id}>
        <img src={event.imageUrl} alt={`${event.name} event photo`} width="240" height="180" loading="lazy" />
        <div className="event-info"><h3>{event.name}</h3><p>{event.location}</p></div>
        <div className="event-date"><p><time dateTime={event.date}>{formatEventDate(event.date)}</time></p></div>
      </article>)}</div>
    </section>
  )
}
