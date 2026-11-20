import { useMemo } from 'react'
import { feature } from 'topojson-client'
import { geoNaturalEarth1, geoPath } from 'd3-geo'
import land from 'world-atlas/land-110m.json'
import type { FeatureCollection } from 'geojson'
import type { EventStop } from '../events'
import { usePlaces } from '../geocode'
import './tour-map.css'

const WIDTH = 800
const HEIGHT = 420

type Pin = { index: number; location: string; x: number; y: number }

function shortLocation(location: string) {
  return location.split(',')[0].trim()
}

export default function TourMap({ stops, nextIndex, onPick }: {
  stops: EventStop[]
  nextIndex?: number
  onPick: (index: number) => void
}) {
  const { places, loading } = usePlaces(stops.map(stop => stop.location))

  const world = useMemo(() => {
    const collection = feature(land as never, land.objects.land) as unknown as FeatureCollection
    const projection = geoNaturalEarth1().fitExtent([[6, 8], [WIDTH - 6, HEIGHT - 8]], collection)
    const path = geoPath(projection)
    return { collection, projection, path }
  }, [])

  const pins = useMemo<Pin[]>(() => stops.flatMap((stop, index) => {
    const place = places[stop.location.trim().replace(/\s+/g, ' ').toLowerCase()]
    if (!place) return []
    const point = world.projection([place.lon, place.lat])
    if (!point) return []
    return [{ index, location: stop.location, x: point[0], y: point[1] }]
  }), [stops, places, world])

  const segments = useMemo(() => {
    const result: { key: string; x1: number; y1: number; x2: number; y2: number }[] = []
    for (let index = 1; index < pins.length; index += 1) {
      const from = pins[index - 1]
      const to = pins[index]
      if (Math.abs(to.x - from.x) > WIDTH / 2) continue
      result.push({ key: `${from.index}-${to.index}`, x1: from.x, y1: from.y, x2: to.x, y2: to.y })
    }
    return result
  }, [pins])

  if (!loading && !pins.length) return null
  const located = pins.length

  return <figure className="tour-map">
    <figcaption className="tour-map-head">
      <span className="tour-map-title">Tour route</span>
      <span className="tour-map-count">{loading ? `Mapping ${stops.length} stops…` : `${located} of ${stops.length} stops mapped`}</span>
    </figcaption>
    <div className="tour-map-frame">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`Route map for ${stops.length} tour stops`}>
        <path className="tour-map-land" d={world.path(world.collection) || ''} />
        {segments.map(segment => <line className="tour-map-route" key={segment.key} x1={segment.x1} y1={segment.y1} x2={segment.x2} y2={segment.y2} />)}
        {pins.map(pin => {
          const labelY = pin.y < 24 ? 26 : -15
          return <g
            className={`tour-map-pin${pin.index === nextIndex ? ' is-next' : ''}`}
            key={`${pin.index}-${pin.location}`}
            transform={`translate(${pin.x} ${pin.y})`}
            role="button"
            tabIndex={0}
            aria-label={`Show ${pin.index + 1}: ${pin.location}`}
            onClick={() => onPick(pin.index)}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onPick(pin.index) } }}
          >
            <circle className="tour-map-pin-halo" r="11" />
            <circle className="tour-map-pin-dot" r="4.5" />
            <text className="tour-map-pin-index" y="3">{pin.index + 1}</text>
            <text className="tour-map-pin-label" y={labelY} textAnchor="middle">{shortLocation(pin.location)}</text>
          </g>
        })}
      </svg>
      {!loading && located < stops.length && <p className="tour-map-note">{stops.length - located} {stops.length - located === 1 ? 'location' : 'locations'} could not be located</p>}
    </div>
  </figure>
}
