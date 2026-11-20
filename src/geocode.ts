import { useEffect, useState } from 'react'

export type Place = { lat: number; lon: number }
const CACHE_KEY = 'trn-place-cache-v1'
const CACHE_LIMIT = 400
const memory = new Map<string, Place>()

const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase()
const uniqueKeys = (locations: string[]) => [...new Set(locations.map(normalize).filter(Boolean))]

const COUNTRY_NAMES: Record<string, string> = {
  AU: 'Australia', NZ: 'New Zealand', NP: 'Nepal', IN: 'India', US: 'United States',
  CA: 'Canada', GB: 'United Kingdom', UK: 'United Kingdom', AE: 'United Arab Emirates',
  SG: 'Singapore', JP: 'Japan', DE: 'Germany', FR: 'France',
}

/** Turn venue strings like "PERTH (AU) - METRO CITY" into usable geocoding queries. */
function locationCandidates(location: string): string[] {
  const cleaned = location
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  const country = /\(([A-Z]{2})\)/.exec(location)?.[1]
  const countryName = country ? COUNTRY_NAMES[country] : undefined
  const commaParts = cleaned.split(',').map(part => part.trim()).filter(Boolean)
  const dashParts = cleaned.split(/\s+-\s+/).map(part => part.trim()).filter(Boolean)
  const city = dashParts[0] || commaParts[0] || cleaned
  const candidates = [
    location,
    cleaned,
    city,
    countryName ? `${city}, ${countryName}` : '',
    countryName ? `${city} ${countryName}` : '',
    ...commaParts.slice().reverse(),
    ...dashParts.slice(1),
  ]
  return [...new Set(candidates.map(value => value.trim().replace(/\s+/g, ' ')).filter(value => value.length >= 2))]
}

function loadCache() {
  const cache = new Map<string, Place>()
  try {
    const raw = window.localStorage.getItem(CACHE_KEY)
    if (!raw) return cache
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') for (const [key, value] of Object.entries(parsed)) {
      const place = value as Place
      if (Number.isFinite(place?.lat) && Number.isFinite(place?.lon)) cache.set(key, place)
    }
  } catch {}
  return cache
}

function saveCache(cache: Map<string, Place>) {
  try {
    while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(cache)))
  } catch {}
}

async function geocode(location: string): Promise<Place | null> {
  for (const candidate of locationCandidates(location)) {
    try {
      const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(candidate)}&count=1&language=en&format=json`, { signal: AbortSignal.timeout(7000) })
      if (!response.ok) continue
      const data = await response.json() as { results?: { latitude: number; longitude: number }[] }
      const result = data.results?.[0]
      if (result && Number.isFinite(result.latitude) && Number.isFinite(result.longitude)) return { lat: result.latitude, lon: result.longitude }
    } catch {}
  }
  return null
}

/** Geocode stop locations on demand, caching successful lookups in localStorage. */
export function usePlaces(locations: string[]) {
  const [state, setState] = useState<{ places: Record<string, Place>; loading: boolean }>({ places: {}, loading: false })
  const signature = uniqueKeys(locations).join('\u0001')

  useEffect(() => {
    const keys = signature ? signature.split('\u0001') : []
    const originals = new Map(keys.map(key => [key, locations.find(location => normalize(location) === key) || key]))
    const cache = loadCache()
    const found: Record<string, Place> = {}
    const missing: string[] = []
    for (const key of keys) {
      const place = memory.get(key) || cache.get(key)
      if (place) found[key] = place
      else missing.push(key)
    }
    setState({ places: found, loading: Boolean(missing.length) })
    if (!missing.length) return
    let active = true
    const worker = async () => {
      for (let index = 0; index < missing.length; index += 3) {
        await Promise.all(missing.slice(index, index + 3).map(async key => {
          const place = await geocode(originals.get(key) || key)
          if (!place) return
          memory.set(key, place)
          cache.set(key, place)
          if (active) setState(current => ({ ...current, places: { ...current.places, [key]: place } }))
        }))
        saveCache(cache)
      }
      if (active) setState(current => ({ ...current, loading: false }))
    }
    void worker()
    return () => { active = false }
  }, [signature])

  return state
}
