import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, ArrowUpRight, X } from '@phosphor-icons/react'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useAlbums } from '../gallery'
import './gallery.css'

export default function Gallery() {
  const albums = useAlbums()
  const albumDialog = useRef<HTMLDialogElement>(null)
  const photoDialog = useRef<HTMLDialogElement>(null)
  const carousel = useRef<HTMLDivElement>(null)
  const albumTrigger = useRef<HTMLElement | null>(null)
  const photoTrigger = useRef<HTMLElement | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [index, setIndex] = useState(0)
  const [fullscreen, setFullscreen] = useState<string | null>(null)
  const album = albums?.find(item => item.id === selected)
  const photos = album?.photos || []
  const fullIndex = photos.findIndex(photo => photo.id === fullscreen)
  const fullPhoto = photos[fullIndex]
  const closePhoto = () => { setFullscreen(null); photoTrigger.current?.focus({ preventScroll: true }) }
  const closeAlbum = () => { setFullscreen(null); setSelected(null); albumTrigger.current?.focus({ preventScroll: true }) }
  const goTo = (next: number) => {
    const el = carousel.current
    if (el) el.scrollTo({ left: next * el.clientWidth, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
  }
  const moveFull = (step: number) => { if (photos.length) setFullscreen(photos[(fullIndex + step + photos.length) % photos.length].id) }
  useEffect(() => { ScrollTrigger.refresh() }, [albums])
  useEffect(() => {
    if (album && !albumDialog.current?.open) { albumDialog.current?.showModal(); if (carousel.current) carousel.current.scrollLeft = 0; setIndex(0) }
    if (!album && albumDialog.current?.open) albumDialog.current.close()
  }, [album?.id])
  useEffect(() => {
    if (fullPhoto && !photoDialog.current?.open) photoDialog.current?.showModal()
    if (!fullPhoto && photoDialog.current?.open) photoDialog.current.close()
  }, [fullPhoto?.id])
  useEffect(() => {
    if (!album) return
    const previous = document.body.style.overflow; document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [Boolean(album)])
  useEffect(() => {
    const el = carousel.current
    if (!el || !album) return
    let width = el.clientWidth
    const observer = new ResizeObserver(() => {
      if (el.clientWidth !== width) {
        const current = Math.round(el.scrollLeft / width)
        width = el.clientWidth; el.scrollLeft = current * width
      }
    })
    observer.observe(el); return () => observer.disconnect()
  }, [album?.id])
  const backdropClick = (event: React.MouseEvent<HTMLDialogElement>, close: () => void) => {
    if (event.target !== event.currentTarget) return
    const rect = event.currentTarget.getBoundingClientRect()
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close()
  }
  if (!albums?.length) return null
  return <>
    <section className="gallery section-pad" id="projects" aria-labelledby="gallery-title">
      <div className="section-heading"><h2 id="gallery-title">You had to be there.</h2><p>From the front row <br />to the final encore.</p></div>
      <div className="album-cards">{albums.map(item => <button className="album-card" key={item.id} aria-label={`Open album: ${item.name}`} aria-haspopup="dialog" onClick={event => { albumTrigger.current = event.currentTarget; setSelected(item.id) }}>
        <img src={item.coverUrl} alt="" loading="lazy" width="1000" height="750" /><span className="album-card-shade" /><span className="album-card-name">{item.name}<span>{item.photos.length} {item.photos.length === 1 ? 'photo' : 'photos'}</span></span><span className="album-card-open" aria-hidden="true"><ArrowUpRight size={24} /></span>
      </button>)}</div>
      <div className="gallery-bottom"><p>On stage. In the crowd. All together.</p></div>
    </section>
    <dialog ref={albumDialog} className="album-dialog" aria-labelledby="album-title" onCancel={event => { event.preventDefault(); closeAlbum() }} onClose={() => { if (selected) closeAlbum() }} onClick={event => backdropClick(event, closeAlbum)} onKeyDown={event => {
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); goTo(Math.max(0, Math.min(photos.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1)))) }
    }}>
      {album && <><div className="album-dialog-heading"><h2 id="album-title">{album.name}</h2><button className="icon-button" onClick={closeAlbum} aria-label="Close album" autoFocus><X size={24} /></button></div>
        <div ref={carousel} className="album-carousel" role="region" aria-roledescription="carousel" aria-label={`${album.name} photos`} onScroll={event => { const el = event.currentTarget; setIndex(Math.round(el.scrollLeft / el.clientWidth)) }}>
          {photos.map((photo, i) => <div className="album-slide" role="group" aria-roledescription="slide" aria-label={`${i + 1} of ${photos.length}`} key={photo.id}><button aria-label={`View photo ${i + 1} full screen`} tabIndex={i === index ? 0 : -1} onClick={event => { photoTrigger.current = event.currentTarget; setFullscreen(photo.id) }}><img src={photo.url} alt={photo.alt} loading={i ? 'lazy' : 'eager'} width="1200" height="800" /><span className="album-expand">View full screen <ArrowUpRight size={20} /></span></button></div>)}
        </div>
        <div className="album-carousel-bottom"><div aria-live="polite"><p>{Math.min(index + 1, photos.length)} of {photos.length}</p><p>Click a photo to view full screen.</p></div><div className="photo-controls"><button className="icon-button" aria-label="Previous album photo" disabled={index <= 0} onClick={() => goTo(index - 1)}><ArrowLeft size={23} /></button><button className="icon-button" aria-label="Next album photo" disabled={index >= photos.length - 1} onClick={() => goTo(index + 1)}><ArrowRight size={23} /></button></div></div>
      </>}
    </dialog>
    <dialog ref={photoDialog} className="album-fullscreen" aria-label={album ? `${album.name} full screen photo viewer` : 'Full screen photo viewer'} onCancel={event => { event.preventDefault(); closePhoto() }} onClose={() => { if (fullscreen) closePhoto() }} onKeyDown={event => {
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); moveFull(event.key === 'ArrowRight' ? 1 : -1) }
    }}>
      {fullPhoto && <><button className="photo-close icon-button" onClick={closePhoto} aria-label="Close full screen photo" autoFocus><X size={24} /></button><img className="album-fullscreen-image" src={fullPhoto.url} alt={fullPhoto.alt} /><div className="album-fullscreen-bottom"><p aria-live="polite">{album?.name} / {fullIndex + 1} of {photos.length}</p><div className="photo-controls"><button className="icon-button" aria-label="Previous full screen photo" onClick={() => moveFull(-1)} disabled={photos.length < 2}><ArrowLeft size={23} /></button><button className="icon-button" aria-label="Next full screen photo" onClick={() => moveFull(1)} disabled={photos.length < 2}><ArrowRight size={23} /></button></div></div></>}
    </dialog>
  </>
}
