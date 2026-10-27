import { useEffect, useRef, useState } from 'react'
import { Pause, Play, X } from '@phosphor-icons/react'
import type { Settings } from '../settings'

export default function SiteMedia({ settings }: { settings: Settings }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [audioError, setAudioError] = useState(false)
  const popup = settings.effectsEnabled && settings.popupEnabled ? settings.popup : null
  const soundtrack = settings.effectsEnabled && settings.audioEnabled ? settings.audio : null
  const dismiss = () => { dialog.current?.close(); if (popup) sessionStorage.setItem(`trn-popup-${popup.id}`, 'seen') }
  useEffect(() => {
    if (!popup || sessionStorage.getItem(`trn-popup-${popup.id}`)) { dialog.current?.close(); return }
    dialog.current?.showModal()
    return () => dialog.current?.close()
  }, [popup?.id])
  useEffect(() => {
    const player = audio.current
    setAudioError(false)
    if (!player || !soundtrack) return
    if (sessionStorage.getItem('trn-music-paused') !== 'yes') void player.play().catch(() => setPlaying(false))
    return () => player.pause()
  }, [soundtrack?.id])
  useEffect(() => { if (audio.current) audio.current.volume = settings.audioVolume }, [settings.audioVolume, soundtrack?.id])
  return <>
    <dialog ref={dialog} className="promo-dialog" aria-label="Event announcement" onCancel={dismiss} onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dismiss() } }}>
      <button className="promo-close" aria-label="Close announcement" onClick={dismiss} autoFocus><X size={24} /></button>
      {popup && (settings.popupLink ? <a href={settings.popupLink} target="_blank" rel="noreferrer"><img src={popup.url} alt={settings.popupAlt} /></a> : <img src={popup.url} alt={settings.popupAlt} />)}
    </dialog>
    {soundtrack && <>
      <audio ref={audio} src={soundtrack.url} loop preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onError={() => setAudioError(true)} />
      <button className="music-control" disabled={audioError} aria-pressed={playing} onClick={() => {
        const player = audio.current; if (!player) return
        if (player.paused) { sessionStorage.removeItem('trn-music-paused'); void player.play().catch(() => setAudioError(true)) }
        else { sessionStorage.setItem('trn-music-paused', 'yes'); player.pause() }
      }}>{playing ? <Pause size={17} weight="fill" /> : <Play size={17} weight="fill" />}<span>{audioError ? 'Music unavailable' : playing ? 'Pause music' : 'Play music'}</span></button>
    </>}
  </>
}
