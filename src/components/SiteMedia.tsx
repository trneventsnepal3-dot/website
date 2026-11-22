import { useEffect, useRef } from 'react'
import { X } from '@phosphor-icons/react'
import { eventMusicActive } from '../siteMusic'
import type { Settings } from '../settings'

export default function SiteMedia({ settings }: { settings: Settings }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const audio = useRef<HTMLAudioElement>(null)
  const popup = settings.effectsEnabled && settings.popupEnabled ? settings.popup : null
  const soundtrack = settings.effectsEnabled && settings.audioEnabled ? settings.audio : null
  const soundtrackUrl = soundtrack?.url || null
  const startRef = useRef<() => void>(() => {})
  const dismiss = () => { dialog.current?.close(); if (popup) sessionStorage.setItem(`trn-popup-${popup.id}`, 'seen'); window.dispatchEvent(new Event('trn-site-music-start')) }
  useEffect(() => {
    if (!popup || sessionStorage.getItem(`trn-popup-${popup.id}`)) { dialog.current?.close(); return }
    const timer = window.setTimeout(() => {
      // A shared event link opens the event dialog immediately. Never cover it
      // with the announcement popup.
      if (document.querySelector('.past-event-dialog[open], .story-share-dialog[open]')) return
      dialog.current?.showModal()
    }, 1400)
    return () => { window.clearTimeout(timer); dialog.current?.close() }
  }, [popup?.id])
  useEffect(() => {
    const player = audio.current
    if (!player || !soundtrackUrl) return
    const start = () => { if (eventMusicActive()) return; if (player.paused) void player.play().catch(() => {}) }
    startRef.current = start
    // Try straight away in case the browser already trusts this tab, and honour a click that landed
    // before the settings request finished.
    start()
    for (const event of ['loadedmetadata', 'loadeddata', 'canplay'] as const) player.addEventListener(event, start)
    const pause = () => player.pause()
    const resume = () => start()
    window.addEventListener('trn-site-music-pause', pause)
    window.addEventListener('trn-site-music-start', resume)
    return () => {
      for (const event of ['loadedmetadata', 'loadeddata', 'canplay'] as const) player.removeEventListener(event, start)
      window.removeEventListener('trn-site-music-pause', pause)
      window.removeEventListener('trn-site-music-start', resume)
      player.pause()
    }
  }, [soundtrackUrl])
  useEffect(() => {
    // Keep these listeners from the first paint so a click is never lost while settings load.
    const interact = () => startRef.current()
    document.addEventListener('click', interact)
    document.addEventListener('touchend', interact, { passive: true })
    document.addEventListener('keydown', interact)
    return () => {
      document.removeEventListener('click', interact)
      document.removeEventListener('touchend', interact)
      document.removeEventListener('keydown', interact)
    }
  }, [])
  useEffect(() => { if (audio.current) audio.current.volume = settings.audioVolume }, [settings.audioVolume, soundtrackUrl])
  return <>
    <dialog ref={dialog} className="promo-dialog" aria-label="Event announcement" onCancel={dismiss} onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dismiss() } }}>
      <button className="promo-close" aria-label="Close announcement" onClick={dismiss} autoFocus><X size={24} /></button>
      {popup && (settings.popupLink ? <a href={settings.popupLink} target="_blank" rel="noreferrer"><img src={popup.url} alt={settings.popupAlt} /></a> : <img src={popup.url} alt={settings.popupAlt} />)}
    </dialog>
    <audio ref={audio} src={soundtrackUrl || undefined} loop preload="auto" />
  </>
}
