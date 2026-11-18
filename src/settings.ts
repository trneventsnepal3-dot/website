import { useEffect, useState } from 'react'
export type Media = { id: string; kind: 'popup' | 'audio' | 'hero' | 'event' | 'gallery'; url: string; name: string; size: number; content_type: string }
export type Settings = { revision: number; effectsEnabled: boolean; popupEnabled: boolean; audioEnabled: boolean; heroVideoEnabled: boolean; popupId: string | null; audioId: string | null; heroId: string | null; popupAlt: string; popupLink: string; audioVolume: number; popup: Media | null; audio: Media | null; hero: Media | null; galleryBaseUrl: string; uploadsAvailable?: boolean }
export const defaults: Settings = { revision: 0, effectsEnabled: true, popupEnabled: false, audioEnabled: false, heroVideoEnabled: true, popupId: null, audioId: null, heroId: null, popupAlt: '', popupLink: '', audioVolume: .35, popup: null, audio: null, hero: null, galleryBaseUrl: '' }

/** Last published settings, kept so the film and soundtrack can start on the first frame instead of waiting for the API. */
export const SETTINGS_CACHE_KEY = 'trn-site-settings-v1'
declare global { interface Window { __trnSettings?: Promise<Settings | null> } }

function readCachedSettings(): Settings | null {
  try {
    const cached = JSON.parse(localStorage.getItem(SETTINGS_CACHE_KEY) || 'null')
    return cached && typeof cached === 'object' ? { ...defaults, ...cached } : null
  } catch { return null }
}
function writeCachedSettings(value: Settings) {
  try { localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(value)) } catch { /* storage may be unavailable */ }
}
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-TRN-Admin': '1' }, body: body === undefined ? undefined : JSON.stringify(body) })
  let data
  try { data = await response.json() } catch {
    throw new Error(response.status === 404 ? 'The API route was not found. Refresh after the latest deployment finishes.' : `The API returned an unexpected response (HTTP ${response.status}). Please try again.`)
  }
  if (!response.ok) throw Object.assign(new Error(data.error || 'Something went wrong.'), { status: response.status })
  return data as T
}
export function useSiteSettings(): { settings: Settings; ready: boolean } {
  const [settings, setSettings] = useState<Settings>(() => readCachedSettings() || defaults)
  const [ready, setReady] = useState(() => readCachedSettings() !== null)
  useEffect(() => {
    let active = true
    let first = true
    const update = () => {
      if (document.hidden) return
      // index.html starts this request before the bundle downloads; reuse it for the first paint.
      const request = first && window.__trnSettings
        ? window.__trnSettings.then(value => value || api<Settings>('site-settings'))
        : api<Settings>('site-settings')
      first = false
      void request.then(value => {
        if (!active) return
        setSettings(value); setReady(true); writeCachedSettings(value)
      }).catch(() => { if (active) setReady(true) })
    }
    update()
    const timer = window.setInterval(update, 30000)
    window.addEventListener('focus', update)
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', update) }
  }, [])
  return { settings, ready }
}
