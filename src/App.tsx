import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, Pause, Play, X } from '@phosphor-icons/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import UpcomingEvents from './components/Events'
import SiteMedia from './components/SiteMedia'
import { useSiteSettings } from './settings'

gsap.registerPlugin(ScrollTrigger)

const socials = [
  { label: 'Instagram', href: 'https://www.instagram.com/trn_events_nepal/?hl=en' },
  { label: 'Facebook', href: 'https://www.facebook.com/profile.php?id=61573707875970' },
  { label: 'TikTok', href: 'https://www.tiktok.com/@trn_events_nepal' },
]
const photos = [
  { file: 'IMG_0675.JPG.jpeg', caption: 'The stage is yours.', alt: 'A performer in a red jacket at the end of a stage surrounded by fans' },
  { file: 'IMG_0665.JPEG', caption: 'Closer to the music.', alt: 'A singer leans towards the audience at the front of the stage' },
  { file: 'IMG_0662.JPEG', caption: 'Every voice in the room.', alt: 'The front rows sing along as a performer kneels beside the crowd' },
  { file: 'IMG_0661.JPEG', caption: 'A night turned all the way up.', alt: 'Flames rise above the stage as a performer faces the crowd' },
  { file: 'IMG_0666.JPEG', caption: 'A moment shared.', alt: 'Two performers on stage in front of a packed audience' },
  { file: 'IMG_0669.JPEG', caption: 'Under the stage lights.', alt: 'Performers and a camera operator lit by stage pyrotechnics' },
  { file: 'IMG_0673.JPEG', caption: 'Front-row energy.', alt: 'The crowd raises their hands beside a plume of stage fire' },
  { file: 'IMG_0674.JPG.jpeg', caption: 'One more song.', alt: 'A singer holds the microphone while facing a crowd of phone lights' },
  { file: 'IMG_0676.JPG.jpeg', caption: 'The whole crowd, together.', alt: 'A wide view of the concert stage and audience at night' },
]

function App() {
  const settings = useSiteSettings()
  const filmEnabled = settings.effectsEnabled && settings.heroVideoEnabled
  const filmSource = settings.hero?.url || '/media/hero-video.mp4'
  const photoSource = (file: string) => `${settings.galleryBaseUrl || '/media'}/${encodeURIComponent(file)}`
  const root = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const photoDialog = useRef<HTMLDialogElement>(null)
  const photoTrigger = useRef<HTMLElement | null>(null)
  const [selectedPhoto, setSelectedPhoto] = useState<number | null>(null)
  const [videoPlaying, setVideoPlaying] = useState(false)

  const openPhoto = (index: number) => { photoTrigger.current = document.activeElement as HTMLElement; setSelectedPhoto(index) }
  const closePhoto = () => { setSelectedPhoto(null); photoTrigger.current?.focus({ preventScroll: true }) }
  const changePhoto = (step: number) => setSelectedPhoto(current => current === null ? null : (current + step + photos.length) % photos.length)

  useEffect(() => {
    const media = gsap.matchMedia()
    const context = gsap.context(() => {
      media.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.from('.hero-title span', { y: 24, opacity: 0, stagger: .08, duration: .9, ease: 'power3.out', clearProps: 'opacity' })
        gsap.to('.hero-title', { scale: .96, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } })
        gsap.utils.toArray<HTMLElement>('[data-reveal]').forEach(element => {
          gsap.from(element, { y: 24, opacity: 0, duration: .7, ease: 'power3.out', clearProps: 'all', scrollTrigger: { trigger: element, start: 'top 94%', once: true } })
        })
        gsap.fromTo('.footer-wordmark', { scale: .96 }, { scale: 1, ease: 'none', scrollTrigger: { trigger: '.footer', start: 'top bottom', end: 'bottom bottom', scrub: true } })
      })
    }, root)
    void document.fonts.ready.then(() => ScrollTrigger.refresh())
    return () => { media.revert(); context.revert() }
  }, [])

  useEffect(() => {
    const player = video.current
    if (!player) return
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const updateMotion = () => { if (motion.matches || !filmEnabled) player.pause(); else void player.play().catch(() => setVideoPlaying(false)) }
    updateMotion()
    motion.addEventListener('change', updateMotion)
    return () => motion.removeEventListener('change', updateMotion)
  }, [filmEnabled, filmSource])

  useEffect(() => {
    const dialog = photoDialog.current
    if (selectedPhoto !== null && !dialog?.open) dialog?.showModal()
    if (selectedPhoto === null && dialog?.open) dialog.close()
  }, [selectedPhoto])
  useEffect(() => {
    const previous = document.body.style.overflow
    if (selectedPhoto !== null) document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [selectedPhoto])
  const activePhoto = selectedPhoto === null ? null : photos[selectedPhoto]

  return (
    <div className="site" ref={root}>
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="site-header">
        <nav aria-label="Main navigation"><a href="#upcoming">Events</a><a href="#projects">Gallery</a><a href="#about">About</a></nav>
      </header>
      <main id="main">
        <section className="hero" id="home" aria-labelledby="hero-title">
          <div className="hero-media">{filmEnabled ? <video ref={video} src={filmSource} poster={photoSource('hero-poster.jpg')} muted loop playsInline preload="metadata" onPlay={() => setVideoPlaying(true)} onPause={() => setVideoPlaying(false)} aria-label="TRN concert footage" /> : <img src={photoSource('hero-poster.jpg')} alt="TRN concert crowd under stage lights" />}</div>
          <div className="hero-shade" />
          <h1 className="hero-title" id="hero-title"><span>TRN EVENTS</span><span>NEPAL</span></h1>
          <div className="hero-copy"><p>Live music. Shared nights.<br />We bring the stage, the sound<br className="desktop-break" /> and the people together.</p><a className="button" href="#upcoming">Explore events <ArrowDown size={20} aria-hidden="true" /></a></div>
          {filmEnabled && <button className="video-control" onClick={() => {
            if (!video.current) return
            if (video.current.paused) void video.current.play().catch(() => setVideoPlaying(false))
            else video.current.pause()
          }} aria-label={videoPlaying ? 'Pause background video' : 'Play background video'} aria-pressed={videoPlaying}>
            {videoPlaying ? <Pause size={17} weight="fill" aria-hidden="true" /> : <Play size={17} weight="fill" aria-hidden="true" />}<span>{videoPlaying ? 'Pause film' : 'Play film'}</span>
          </button>}
        </section>
        <UpcomingEvents photoBaseUrl={settings.galleryBaseUrl || '/media'} />
        <section className="gallery section-pad" id="projects" aria-labelledby="gallery-title">
          <div className="section-heading"><h2 id="gallery-title" data-reveal>You had to be there.</h2><p data-reveal>From the front row <br />to the final encore.</p></div>
          <div className="gallery-grid">{photos.slice(0, 4).map((photo, index) => (
            <button className={`gallery-photo gallery-photo-${index}`} key={photo.file} onClick={() => openPhoto(index)} aria-label={`Open photo: ${photo.alt}`} data-reveal>
              <img src={photoSource(photo.file)} alt={photo.alt} width={index === 0 ? 1600 : 1000} height={index === 0 ? 1067 : 1000} loading="lazy" /><span className="photo-open" aria-hidden="true"><ArrowUpRight size={24} /></span>
            </button>
          ))}</div>
          <div className="gallery-bottom" data-reveal><p>On stage. In the crowd. All together.</p><button className="text-button" onClick={() => openPhoto(0)}>View all 9 photos <ArrowRight size={20} aria-hidden="true" /></button></div>
        </section>
        <section className="about section-pad" id="about" aria-labelledby="about-title">
          <div className="about-heading"><h2 id="about-title" data-reveal>The TRN way.</h2><p data-reveal>Live events, concerts and festivals.</p></div>
          <div className="about-copy"><p className="about-lead" data-reveal>You bring the people.<br />We bring it together.</p><p data-reveal>From the first idea to the final encore, our team brings together the stage, sound and production. We take care of the details that make a night worth remembering.</p></div>
        </section>
      </main>
      <footer className="footer section-pad" id="contact">
        <div className="footer-top">
          <div className="footer-invite" data-reveal><h2>Your next great night.</h2><a className="button footer-email" href="mailto:trneventsnepal3@gmail.com"><span>trneventsnepal3@gmail.com</span><ArrowUpRight size={20} aria-hidden="true" /></a></div>
          <div className="footer-socials" data-reveal>{socials.map(social => <a key={social.label} href={social.href} target="_blank" rel="noreferrer">{social.label}</a>)}</div>
          <div className="footer-partner" data-reveal><p>Our friends at</p><a href="https://mamagharentertainment.com" target="_blank" rel="noreferrer">Mamaghar<br />Entertainment</a></div>
        </div>
        <a className="footer-wordmark" href="#home" aria-label="TRN Nepal, back to top">TRN NEPAL</a>
        <div className="footer-bottom"><p>© {new Date().getFullYear()} TRN Events Nepal</p><a href="#home">Back to top ↑</a></div>
      </footer>
      <SiteMedia settings={settings} />
      <dialog ref={photoDialog} className="photo-dialog" aria-labelledby="photo-title" onCancel={closePhoto} onClose={() => { if (selectedPhoto !== null) closePhoto() }} onClick={event => {
        if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closePhoto() }
      }} onKeyDown={event => {
        if (event.key === 'ArrowRight') { event.preventDefault(); changePhoto(1) }
        if (event.key === 'ArrowLeft') { event.preventDefault(); changePhoto(-1) }
      }}>
        {activePhoto && <>
          <button className="photo-close icon-button" onClick={closePhoto} aria-label="Close photo viewer" autoFocus><X size={24} /></button>
          <img className="photo-dialog-image" src={photoSource(activePhoto.file)} alt={activePhoto.alt} />
          <div className="photo-dialog-bottom"><div aria-live="polite"><h2 id="photo-title">{activePhoto.caption}</h2><p>{(selectedPhoto ?? 0) + 1} of {photos.length}</p></div><div className="photo-controls"><button className="icon-button" onClick={() => changePhoto(-1)} aria-label="Previous photo"><ArrowLeft size={23} /></button><button className="icon-button" onClick={() => changePhoto(1)} aria-label="Next photo"><ArrowRight size={23} /></button></div></div>
        </>}
      </dialog>
    </div>
  )
}
export default App
