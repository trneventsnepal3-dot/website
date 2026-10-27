import { useEffect, useState } from 'react'
export type Media = { id: string; kind: 'popup' | 'audio' | 'hero'; url: string; name: string; size: number; content_type: string }
export type Settings = { revision: number; effectsEnabled: boolean; popupEnabled: boolean; audioEnabled: boolean; heroVideoEnabled: boolean; popupId: string | null; audioId: string | null; heroId: string | null; popupAlt: string; popupLink: string; audioVolume: number; popup: Media | null; audio: Media | null; hero: Media | null; galleryBaseUrl: string; uploadsAvailable?: boolean }
export const defaults: Settings = { revision: 0, effectsEnabled: true, popupEnabled: false, audioEnabled: false, heroVideoEnabled: true, popupId: null, audioId: null, heroId: null, popupAlt: '', popupLink: '', audioVolume: .35, popup: null, audio: null, hero: null, galleryBaseUrl: '' }
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-TRN-Admin': '1' }, body: body === undefined ? undefined : JSON.stringify(body) })
  let data
  try { data = await response.json() } catch { throw new Error('The server could not be reached. Start the app with npm run dev, or check the Vercel API deployment.') }
  if (!response.ok) throw Object.assign(new Error(data.error || 'Something went wrong.'), { status: response.status })
  return data as T
}
export function useSiteSettings() {
  const [settings, setSettings] = useState(defaults)
  useEffect(() => {
    let active = true
    const update = () => { if (!document.hidden) void api<Settings>('site-settings').then(value => { if (active) setSettings(value) }).catch(() => {}) }
    update()
    const timer = window.setInterval(update, 30000)
    window.addEventListener('focus', update)
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', update) }
  }, [])
  return settings
}
