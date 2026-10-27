import './events.css'

export default function UpcomingEvents({ photoBaseUrl = '/media' }: { photoBaseUrl?: string }) {
  return (
    <section className="events section-pad" id="upcoming" aria-labelledby="events-title">
      <div className="events-heading" data-reveal><h2 id="events-title">Live events.</h2></div>
      <article className="event-row" data-reveal>
        <img src={`${photoBaseUrl}/IMG_0674.JPG.jpeg`} alt="A live performance from the TRN photo archive" width="240" height="180" loading="lazy" />
        <div className="event-info"><h3>Sushant KC Live</h3><p>United Kingdom</p></div>
        <div className="event-date"><p>28 March</p></div>
      </article>
    </section>
  )
}
