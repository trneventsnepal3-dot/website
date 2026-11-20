import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Play, X } from '@phosphor-icons/react'
import { youtubeEmbed, youtubeThumbnail, youtubeVideoId } from '../youtube'
import './stop-aftermovie.css'

export default function StopAftermovie({ url, title, variant = 'panel', onOpen, onClose }: {
  url?: string
  title: string
  variant?: 'panel' | 'list'
  onOpen?: () => void
  onClose?: () => void
}) {
  const id = youtubeVideoId(url)
  const [open, setOpen] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    if (open && dialogRef.current && !dialogRef.current.open) dialogRef.current.showModal()
  }, [open])

  if (!id) return null

  const stopVideo = () => {
    setOpen(false)
    onClose?.()
  }

  return <>
    <button
      type="button"
      className={`stop-aftermovie is-${variant}`}
      onClick={() => { setOpen(true); onOpen?.() }}
      aria-label={`Play the ${title} aftermovie`}
    >
      <img src={youtubeThumbnail(id)} alt="" loading="lazy" />
      <span className="stop-aftermovie-play"><Play size={14} weight="fill" aria-hidden="true" /></span>
      <span className="stop-aftermovie-label">Aftermovie</span>
    </button>
    {open && createPortal(<dialog
      ref={dialogRef}
      className="stop-aftermovie-dialog"
      aria-label={`${title} aftermovie`}
      onCancel={stopVideo}
      onClick={event => {
        const rect = event.currentTarget.getBoundingClientRect()
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) stopVideo()
      }}
    >
      <div className="stop-aftermovie-dialog-head">
        <strong>{title} aftermovie</strong>
        <button type="button" className="stop-aftermovie-close" onClick={stopVideo} aria-label="Close aftermovie"><X size={20} aria-hidden="true" /></button>
      </div>
      <div className="stop-aftermovie-frame">
        <iframe
          src={youtubeEmbed(id)}
          title={`${title} aftermovie`}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    </dialog>, document.body)}
  </>
}
