import { useEffect, useMemo, useRef, useState } from 'react'
import { feature } from 'topojson-client'
import { geoGraticule10, geoMercator, geoPath } from 'd3-geo'
import countriesTopology from 'world-atlas/countries-110m.json'
import type { FeatureCollection } from 'geojson'
import { formatEventDate, formatEventTime, type EventStop } from '../events'
import { countryName, usePlaces, type Place } from '../geocode'
import './tour-map.css'

const FALLBACK_SIZE = { width: 900, height: 480 }

type LocatedStop = { stop: EventStop; index: number; place: Place }
type Pin = {
  index: number
  location: string
  city: string
  country: string
  venue: string
  x: number
  y: number
  date: string
  dateTime: string
  time: string
  status: string
}
type Segment = { key: string; d: string; order: number }

const locationKey = (location: string) => location.trim().replace(/\s+/g, ' ').toLowerCase()
const normalizeLongitude = (longitude: number) => ((longitude + 180) % 360 + 360) % 360 - 180
const titleCase = (value: string) => value.trim().toLowerCase().replace(/\b\w/g, character => character.toUpperCase())

function parseLocation(location: string) {
  const countryCode = /\(([A-Z]{2})\)/i.exec(location)?.[1]?.toUpperCase()
  const cleaned = location
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  const dashParts = cleaned.split(/\s+-\s+/).map(part => part.trim()).filter(Boolean)
  const mainParts = (dashParts[0] || cleaned).split(',').map(part => part.trim()).filter(Boolean)
  return {
    city: titleCase(mainParts[0] || cleaned),
    venue: dashParts.slice(1).join(' - ').trim() || mainParts.slice(1).join(', ').trim(),
    countryCode,
  }
}

function stopStatus(stop: EventStop, index: number, nextIndex?: number) {
  if (stop.completed) return 'Completed'
  if (index === nextIndex) return 'Next stop'
  if (stop.dateTba || !stop.date) return 'TBA'
  return 'Scheduled'
}

function curvedRoute(from: Pin, to: Pin): string {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const distance = Math.hypot(dx, dy) || 1
  const bend = Math.min(42, distance * 0.16)
  const controlX = (from.x + to.x) / 2 - (dy / distance) * bend
  const controlY = (from.y + to.y) / 2 + (dx / distance) * bend
  return `M${from.x},${from.y} Q${controlX},${controlY} ${to.x},${to.y}`
}

export default function TourMap({ stops, nextIndex, onPick }: {
  stops: EventStop[]
  nextIndex?: number
  onPick: (index: number) => void
}) {
  const { places, loading } = usePlaces(stops.map(stop => stop.location))
  const frame = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState(FALLBACK_SIZE)
  const [selectedIndex, setSelectedIndex] = useState(nextIndex ?? 0)
  const [focused, setFocused] = useState(false)
  const reducedMotion = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, [])

  useEffect(() => {
    if (nextIndex !== undefined) setSelectedIndex(nextIndex)
  }, [nextIndex])

  useEffect(() => { setFocused(false) }, [stops])

  useEffect(() => {
    const element = frame.current
    if (!element) return
    const update = (width: number, height: number) => {
      if (width > 0 && height > 0) setSize(current => (
        current.width === width && current.height === height ? current : { width, height }
      ))
    }
    update(Math.round(element.clientWidth), Math.round(element.clientHeight))
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect
      if (rect) update(Math.round(rect.width), Math.round(rect.height))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const located = useMemo<LocatedStop[]>(() => stops.flatMap((stop, index) => {
    const place = places[locationKey(stop.location)]
    return place ? [{ stop, index, place }] : []
  }), [stops, places])

  const map = useMemo(() => {
    const countries = feature(countriesTopology as never, countriesTopology.objects.countries as never) as unknown as FeatureCollection
    const graticule = geoGraticule10()
    const empty = { projection: geoMercator(), path: geoPath(geoMercator()), countries, graticule }
    if (!located.length) return empty

    const coordinates = located.map(({ place }) => [place.lon, place.lat] as [number, number])
    const reference = coordinates[0][0]
    const unwrapped = coordinates.map(([longitude]) => {
      let value = longitude
      while (value - reference > 180) value -= 360
      while (reference - value > 180) value += 360
      return value
    })
    const centerLongitude = normalizeLongitude((Math.min(...unwrapped) + Math.max(...unwrapped)) / 2)
    const latitudes = coordinates.map(([, latitude]) => latitude)
    let west = Math.min(...unwrapped)
    let east = Math.max(...unwrapped)
    let south = Math.min(...latitudes)
    let north = Math.max(...latitudes)

    // Keep single-stop and tightly clustered tours readable instead of overzooming.
    if (east - west < 0.7) { const middle = (east + west) / 2; west = middle - 0.35; east = middle + 0.35 }
    if (north - south < 0.5) { const middle = (north + south) / 2; south = middle - 0.25; north = middle + 0.25 }

    const fitPoints: [number, number][] = [
      [normalizeLongitude(west), south],
      [normalizeLongitude(east), north],
      ...coordinates,
    ]
    const paddingX = Math.max(38, Math.min(96, size.width * 0.11))
    const paddingY = Math.max(40, Math.min(92, size.height * 0.15))
    const projection = geoMercator().rotate([-centerLongitude, 0])
    projection.fitExtent(
      [[paddingX, paddingY], [size.width - paddingX, size.height - paddingY]],
      { type: 'MultiPoint', coordinates: fitPoints } as never,
    )
    projection.clipExtent([[0, 0], [size.width, size.height]])
    return { projection, path: geoPath(projection), countries, graticule }
  }, [located, size])

  const pins = useMemo<Pin[]>(() => located.flatMap(({ stop, index, place }) => {
    const point = map.projection([place.lon, place.lat])
    if (!point) return []
    const parsed = parseLocation(stop.location)
    const startTime = stop.dateTba ? '' : formatEventTime(stop.startTime)
    return [{
      index,
      location: stop.location,
      city: parsed.city,
      country: place.country || countryName(parsed.countryCode) || countryName(place.countryCode),
      venue: parsed.venue,
      x: point[0],
      y: point[1],
      date: stop.date ? formatEventDate(stop.date) : 'Date to be announced',
      dateTime: stop.date,
      time: startTime,
      status: stopStatus(stop, index, nextIndex),
    }]
  }), [located, map, nextIndex])

  const segments = useMemo<Segment[]>(() => pins.slice(1).flatMap((pin, order) => {
    const previous = pins[order]
    if (!previous) return []
    return [{ key: `${previous.index}-${pin.index}`, d: curvedRoute(previous, pin), order }]
  }), [pins])

  if (!loading && !pins.length) return null
  const selected = pins.find(pin => pin.index === selectedIndex) || pins[0]
  const locatedCount = pins.length
  const focus = !reducedMotion && focused && selected
    ? {
      scale: 1.03,
      x: (size.width / 2 - selected.x) * 0.12,
      y: (size.height / 2 - selected.y) * 0.12,
    }
    : { scale: 1, x: 0, y: 0 }

  return <figure className="tour-map">
    <figcaption className="tour-map-head">
      <span className="tour-map-title">Tour route</span>
      <span className="tour-map-count">{loading ? `Mapping ${stops.length} stops…` : `${locatedCount} of ${stops.length} stops mapped`}</span>
    </figcaption>
    <div className="tour-map-frame" ref={frame}>
      <svg viewBox={`0 0 ${size.width} ${size.height}`} role="img" aria-label={`Animated route map for ${stops.length} tour stops`}>
        <g
          className="tour-map-scene"
          style={{ transform: `translate(${focus.x}px, ${focus.y}px) scale(${focus.scale})` }}
        >
        <path className="tour-map-graticule" d={map.path(map.graticule) || ''} />
        <path className="tour-map-land" d={map.path(map.countries) || ''} />
        {segments.map(segment => <g className="tour-map-route" key={segment.key}>
          <path className="tour-map-route-glow" d={segment.d} />
          <path
            className="tour-map-route-line"
            d={segment.d}
            pathLength={1}
            style={{ animationDelay: `${segment.order * 220}ms` }}
          />
          {!reducedMotion && <>
            <path
              className="tour-map-route-flow"
              d={segment.d}
              pathLength={1}
              style={{ animationDelay: `${900 + segment.order * 220}ms` }}
            />
            <g className="tour-map-traveler">
              <animateMotion
                dur={`${2.8 + segment.order * 0.4}s`}
                begin={`${1.1 + segment.order * 0.3}s`}
                repeatCount="indefinite"
                path={segment.d}
              />
              <circle className="tour-map-traveler-glow" r="9" />
              <circle className="tour-map-traveler-dot" r="3.5" />
            </g>
          </>}
        </g>)}
        {pins.map(pin => {
          const labelBelow = pin.y < 44
          return <g key={`${pin.index}-${pin.location}`} transform={`translate(${pin.x} ${pin.y})`}>
            <g
              className={`tour-map-pin${pin.index === selected?.index ? ' is-selected' : ''}${pin.index === nextIndex ? ' is-next' : ''}`}
              role="button"
              tabIndex={0}
              aria-label={`Stop ${pin.index + 1}: ${pin.city}${pin.country ? `, ${pin.country}` : ''}, ${pin.date}`}
              onClick={() => { setSelectedIndex(pin.index); setFocused(true) }}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setSelectedIndex(pin.index)
                  setFocused(true)
                }
              }}
              style={{ animationDelay: `${pin.index * 90}ms` }}
            >
              <circle className="tour-map-pin-ripple" r="13" />
              <circle className="tour-map-pin-halo" r="11" />
              <circle className="tour-map-pin-dot" r="7.5" />
              <text className="tour-map-pin-index" y="3.1">{pin.index + 1}</text>
              <text className="tour-map-pin-label" y={labelBelow ? 31 : -19} textAnchor="middle">{pin.city}</text>
            </g>
          </g>
        })}
        </g>
      </svg>
      {!loading && locatedCount < stops.length && <p className="tour-map-note">{stops.length - locatedCount} {stops.length - locatedCount === 1 ? 'location' : 'locations'} could not be located</p>}
    </div>
    <div className="tour-map-panel" aria-live="polite">
      {selected ? <>
        <div className="tour-map-panel-top">
          <span className="tour-map-panel-index">Stop {String(selected.index + 1).padStart(2, '0')}</span>
          <span className={`tour-map-status${selected.status === 'Next stop' ? ' is-next' : ''}`}>{selected.status}</span>
        </div>
        <strong className="tour-map-panel-city">{selected.city}{selected.country ? `, ${selected.country}` : ''}</strong>
        {selected.venue && <span className="tour-map-panel-venue">{selected.venue}</span>}
        <div className="tour-map-panel-date">
          <time dateTime={selected.dateTime || undefined}>{selected.date}</time>
          {selected.time && <span> · {selected.time}</span>}
        </div>
        <button className="tour-map-panel-link" type="button" onClick={() => onPick(selected.index)}>
          View in schedule <span aria-hidden="true">↗</span>
        </button>
      </> : <p className="tour-map-panel-empty">Select a marker to explore each stop.</p>}
    </div>
  </figure>
}
