import { useEffect, useMemo, useRef, useState } from 'react'
import { feature } from 'topojson-client'
import { geoGraticule10, geoMercator, geoPath } from 'd3-geo'
import countriesTopology from 'world-atlas/countries-110m.json'
import type { FeatureCollection } from 'geojson'
import { formatEventDate, formatEventTime, type EventStop } from '../events'
import { countryName, usePlaces, type Place } from '../geocode'
import StopAftermovie from './StopAftermovie'
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
  aftermovieUrl: string
}
type Segment = { key: string; d: string; order: number }
type Journey = { stopIndex: number; segmentIndex: number; progress: number }
type Point = { x: number; y: number }

const locationKey = (location: string) => location.trim().replace(/\s+/g, ' ').toLowerCase()
const normalizeLongitude = (longitude: number) => ((longitude + 180) % 360 + 360) % 360 - 180
const titleCase = (value: string) => value.trim().toLowerCase().replace(/\b\w/g, character => character.toUpperCase())
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const easeInOut = (value: number) => value < 0.5 ? 4 * value ** 3 : 1 - (-2 * value + 2) ** 3 / 2

function curvePoint(from: Pin, to: Pin, progress: number): Point {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const distance = Math.hypot(dx, dy) || 1
  const bend = Math.min(42, distance * 0.16)
  const control = {
    x: (from.x + to.x) / 2 - (dy / distance) * bend,
    y: (from.y + to.y) / 2 + (dx / distance) * bend,
  }
  const remaining = 1 - progress
  return {
    x: remaining ** 2 * from.x + 2 * remaining * progress * control.x + progress ** 2 * to.x,
    y: remaining ** 2 * from.y + 2 * remaining * progress * control.y + progress ** 2 * to.y,
  }
}

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

export default function TourMap({ stops, nextIndex }: {
  stops: EventStop[]
  nextIndex?: number
}) {
  const { places, loading } = usePlaces(stops.map(stop => stop.location))
  const frame = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState(FALLBACK_SIZE)
  const [journey, setJourney] = useState<Journey>({ stopIndex: 0, segmentIndex: 0, progress: 0 })
  const [autoPlaying, setAutoPlaying] = useState(true)
  const journeyRef = useRef(journey)
  const interactionTimer = useRef<number | undefined>(undefined)
  const reducedMotion = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, [])

  useEffect(() => () => window.clearTimeout(interactionTimer.current), [])

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
      aftermovieUrl: stop.aftermovieUrl || '',
    }]
  }), [located, map, nextIndex])

  const segments = useMemo<Segment[]>(() => pins.slice(1).flatMap((pin, order) => {
    const previous = pins[order]
    if (!previous) return []
    return [{ key: `${previous.index}-${pin.index}`, d: curvedRoute(previous, pin), order }]
  }), [pins])

  const segmentCount = Math.max(0, pins.length - 1)
  const timelineLength = segmentCount + 1

  useEffect(() => {
    const next = { stopIndex: pins[0]?.index ?? 0, segmentIndex: 0, progress: 0 }
    journeyRef.current = next
    setJourney(next)
    setAutoPlaying(true)
  }, [timelineLength, pins.map(pin => `${pin.index}:${pin.x}:${pin.y}`).join('|')])

  useEffect(() => {
    if (!autoPlaying || !segmentCount || reducedMotion) return
    let frame = 0
    let previous: number | undefined
    let timer: number | undefined

    const apply = (next: Journey) => {
      journeyRef.current = next
      setJourney(next)
    }

    const resume = (current: Journey) => {
      const atFinalStop = current.segmentIndex >= segmentCount - 1
      const next: Journey = atFinalStop
        ? { stopIndex: pins[0].index, segmentIndex: 0, progress: 0 }
        : { stopIndex: pins[current.segmentIndex + 1].index, segmentIndex: current.segmentIndex + 1, progress: 0 }
      timer = window.setTimeout(() => {
        apply(next)
        previous = undefined
        frame = requestAnimationFrame(tick)
      }, atFinalStop ? 2200 : 1500)
    }

    const tick = (time: number) => {
      if (previous === undefined) previous = time
      const delta = Math.min(time - previous, 100)
      previous = time
      const current = journeyRef.current

      if (current.progress >= 1) {
        if (!timer) resume(current)
        return
      }

      const nextProgress = clamp(current.progress + delta / 2600, 0, 1)
      apply({ ...current, progress: nextProgress })
      if (nextProgress < 1) {
        frame = requestAnimationFrame(tick)
        return
      }

      apply({ ...current, stopIndex: pins[current.segmentIndex + 1].index, progress: 1 })
      resume(current)
    }

    if (journeyRef.current.progress >= 1) resume(journeyRef.current)
    else frame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [autoPlaying, pins, segmentCount, reducedMotion])

  if (!loading && !pins.length) return null
  const selected = pins.find(pin => pin.index === journey.stopIndex) || pins[0]
  const locatedCount = pins.length
  const focus = !reducedMotion && selected
    ? {
      scale: 1.015,
      x: (size.width / 2 - selected.x) * 0.06,
      y: (size.height / 2 - selected.y) * 0.06,
    }
    : { scale: 1, x: 0, y: 0 }

  const pauseJourney = () => {
    window.clearTimeout(interactionTimer.current)
    setAutoPlaying(false)
  }

  const resumeJourneyLater = () => {
    window.clearTimeout(interactionTimer.current)
    interactionTimer.current = window.setTimeout(() => setAutoPlaying(true), 6500)
  }

  const selectStop = (index: number) => {
    const pinIndex = pins.findIndex(pin => pin.index === index)
    if (pinIndex < 0) return
    const next: Journey = {
      stopIndex: index,
      segmentIndex: pinIndex === 0 ? 0 : Math.min(pinIndex - 1, segmentCount - 1),
      progress: pinIndex === 0 ? 0 : 1,
    }
    journeyRef.current = next
    setJourney(next)
    pauseJourney()
    resumeJourneyLater()
  }

  const travelerPoint: Point | null = !pins.length ? null
    : journey.progress >= 1
      ? (pins.find(pin => pin.index === journey.stopIndex) || pins[Math.min(journey.segmentIndex, pins.length - 1)])
      : journey.segmentIndex < segmentCount
        ? curvePoint(pins[journey.segmentIndex], pins[journey.segmentIndex + 1], easeInOut(journey.progress))
        : pins[pins.length - 1]
  const revealFor = (order: number) => order < journey.segmentIndex
    ? 1
    : order === journey.segmentIndex
      ? journey.progress
      : 0

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
        {segments.map(segment => {
          const reveal = revealFor(segment.order)
          return <g className="tour-map-route" key={segment.key}>
            <path className="tour-map-route-base" d={segment.d} />
            {reveal > 0 && <>
              <path className="tour-map-route-glow" d={segment.d} pathLength={1} style={{ strokeDasharray: 1, strokeDashoffset: 1 - reveal }} />
              <path className="tour-map-route-line" d={segment.d} pathLength={1} style={{ strokeDasharray: 1, strokeDashoffset: 1 - reveal }} />
            </>}
          </g>
        })}
        {travelerPoint && <g className="tour-map-traveler" transform={`translate(${travelerPoint.x} ${travelerPoint.y})`}>
          <circle className="tour-map-traveler-glow" r="9" />
          <circle className="tour-map-traveler-dot" r="3.5" />
        </g>}
        {pins.map(pin => {
          const labelBelow = pin.y < 44
          return <g key={`${pin.index}-${pin.location}`} transform={`translate(${pin.x} ${pin.y})`}>
            <g
              className={`tour-map-pin${pin.index === selected?.index ? ' is-selected' : ''}${pin.index === nextIndex ? ' is-next' : ''}`}
              role="button"
              tabIndex={0}
              aria-label={`Stop ${pin.index + 1}: ${pin.city}${pin.country ? `, ${pin.country}` : ''}, ${pin.date}`}
              onClick={() => selectStop(pin.index)}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  selectStop(pin.index)
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
      {selected ? <div className="tour-map-panel-body" key={selected.index}>
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
        <StopAftermovie
          url={selected.aftermovieUrl}
          title={selected.city || `Stop ${selected.index + 1}`}
          onOpen={pauseJourney}
          onClose={resumeJourneyLater}
        />
      </div> : <p className="tour-map-panel-empty">Select a marker to explore each stop.</p>}
    </div>
  </figure>
}
