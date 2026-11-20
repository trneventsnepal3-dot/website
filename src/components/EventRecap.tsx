import { useState } from 'react'
import { ArrowUpRight, Play } from '@phosphor-icons/react'
import type { LiveEvent } from '../events'
import { openGalleryAlbum } from '../gallery'
import './recap.css'

type Embed = { kind: 'youtube' | 'vimeo' | 'video' | 'link'; id?: string }

function embedType(url: string): Embed {
  const youtube = /(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([\w-]{6,})/.exec(url)
  if (youtube) return { kind: 'youtube', id: youtube[1] }
  const vimeo = /vimeo\.com\/(\d+)/.exec(url)
  if (vimeo) return { kind: 'vimeo', id: vimeo[1] }
  if (/\.(?:mp4|webm|ogg|mov)(?:[?#]|$)/i.test(url)) return { kind: 'video' }
  return { kind: 'link' }
}

export default function EventRecap({ event, onNavigate }: { event: LiveEvent; onNavigate: () => void }) {
  const [playing, setPlaying] = useState(false)
  const album = event.album && event.album.count > 0 ? event.album : null
  const recap = event.recapUrl ? embedType(event.recapUrl) : null
  if (!album && !recap) return null

  const openAlbum = () => {
    if (!album) return
    onNavigate()
    window.setTimeout(() => openGalleryAlbum(album.id), 60)
  }

  return <section className="event-recap">
    {(album || recap) && <h3 className="event-recap-title">{album ? album.name : 'From the night'}</h3>}
    {recap && <div className="recap-video">
      {playing && recap.kind === 'youtube' && <iframe className="recap-video-frame" src={`https://www.youtube-nocookie.com/embed/${recap.id}?autoplay=1&rel=0`} title={`${event.name} aftermovie`} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />}
      {playing && recap.kind === 'vimeo' && <iframe className="recap-video-frame" src={`https://player.vimeo.com/video/${recap.id}?autoplay=1`} title={`${event.name} aftermovie`} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen />}
      {playing && recap.kind === 'video' && <video className="recap-video-frame" src={event.recapUrl!} controls autoPlay playsInline poster={event.imageUrl} />}
      {playing && recap.kind === 'link' && <a className="recap-video-link" href={event.recapUrl} target="_blank" rel="noreferrer">Watch the aftermovie <ArrowUpRight size={18} aria-hidden="true" /></a>}
      {!playing && <button type="button" className="recap-video-poster" onClick={() => setPlaying(true)} aria-label={`Play the ${event.name} aftermovie`}>
        <img src={event.imageUrl} alt="" />
        <span className="recap-video-play"><Play size={20} weight="fill" aria-hidden="true" />Watch the aftermovie</span>
      </button>}
    </div>}
    {album && <div className="recap-album">
      <div className="recap-album-head"><span>Photos from the night</span><span>{album.count} {album.count === 1 ? 'photo' : 'photos'}</span></div>
      <div className="recap-album-photos">
        {album.photos.map(photo => <img key={photo.id} src={photo.url} alt={photo.alt} loading="lazy" width="160" height="120" />)}
        {album.count > album.photos.length && <span className="recap-album-more">+{album.count - album.photos.length}</span>}
      </div>
      <button type="button" className="recap-album-link" onClick={openAlbum}>View all photos <ArrowUpRight size={18} aria-hidden="true" /></button>
    </div>}
  </section>
}
