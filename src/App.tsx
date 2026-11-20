import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpRight, Pause, Play } from '@phosphor-icons/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import UpcomingEvents, { PastEvents } from './components/Events'
import NextShow from './components/NextShow'
import SiteMedia from './components/SiteMedia'
import Gallery from './components/Gallery'
import { useSiteSettings } from './settings'

gsap.registerPlugin(ScrollTrigger)

const socials = [
  { label: 'Instagram', href: 'https://www.instagram.com/trn_events_nepal/?hl=en' },
  { label: 'Facebook', href: 'https://www.facebook.com/profile.php?id=61573707875970' },
  { label: 'TikTok', href: 'https://www.tiktok.com/@trn_events_nepal' },
]

// TEMP photos pulled from the TRN gallery — to be replaced with the user's chosen shots
const wayBlocks = [
  { number: '01', title: 'Live performances', text: 'Bringing your favourite artists to the stage.', image: 'https://br-little-lab-b442l9qo.storage.c-6.us-east-2.aws.neon.tech/media/trn/original/IMG_0665.JPEG', alt: 'A singer in a red jacket performs into the microphone as the crowd raises their phones' },
  { number: '02', title: 'Artist experiences', text: 'Creating special moments between artists and audiences.', image: 'https://br-little-lab-b442l9qo.storage.c-6.us-east-2.aws.neon.tech/media/trn/original/IMG_0662.JPEG', alt: 'A performer kneels beside the crowd as the front rows sing along' },
  { number: '03', title: 'Unforgettable nights', text: 'Making every concert a memory worth keeping.', image: 'https://br-little-lab-b442l9qo.storage.c-6.us-east-2.aws.neon.tech/media/trn/original/IMG_0674.JPG.jpeg', alt: 'A singer faces a crowd of phone lights' },
]

function App() {
  const { settings } = useSiteSettings()
  const filmEnabled = settings.effectsEnabled && settings.heroVideoEnabled
  // Start the film on the first render. Cached settings (and the early preload in index.html) make
  // repeat visits instant; a first visit uses the bundled film until the published one is buffered.
  const wantedFilm = settings.hero?.url || '/media/hero-video.mp4'
  const [filmSource, setFilmSource] = useState(wantedFilm)
  const warmup = useRef<HTMLVideoElement | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const [videoPlaying, setVideoPlaying] = useState(false)
  const videoPaused = useRef(false)
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const scrollToTop = () => window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' })

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

  const playFilm = useCallback(() => {
    const player = video.current
    if (!player || !filmEnabled || videoPaused.current || player.paused === false) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    void player.play().catch(() => setVideoPlaying(false))
  }, [filmEnabled])

  const filmSourceRef = useRef(filmSource)
  filmSourceRef.current = filmSource

  useEffect(() => {
    if (!filmEnabled || wantedFilm === filmSourceRef.current) return
    const previous = warmup.current
    if (previous) { previous.pause(); previous.removeAttribute('src'); previous.load() }
    // Buffer the newly published film off-screen first, so the visible film never freezes on a
    // half-loaded video (the "stuck photo" effect).
    const candidate = document.createElement('video')
    candidate.muted = true; candidate.playsInline = true; candidate.preload = 'auto'
    candidate.setAttribute('aria-hidden', 'true'); candidate.tabIndex = -1
    candidate.style.cssText = 'position:fixed;left:-1px;top:0;width:1px;height:1px;opacity:0;pointer-events:none'
    candidate.src = wantedFilm
    let swapped = false
    const swap = () => {
      if (swapped) return
      swapped = true
      setFilmSource(wantedFilm)
    }
    candidate.addEventListener('loadeddata', swap)
    candidate.addEventListener('canplay', swap)
    candidate.load()
    document.documentElement.appendChild(candidate)
    warmup.current = candidate
    return () => {
      candidate.removeEventListener('loadeddata', swap)
      candidate.removeEventListener('canplay', swap)
      if (!swapped && warmup.current === candidate) {
        candidate.pause(); candidate.removeAttribute('src'); candidate.load(); candidate.remove(); warmup.current = null
      }
    }
  }, [wantedFilm, filmEnabled])

  useEffect(() => () => {
    const player = warmup.current
    if (player) { player.pause(); player.removeAttribute('src'); player.load(); player.remove(); warmup.current = null }
  }, [])

  useEffect(() => {
    const player = video.current
    if (!player) return
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    // These must be set before playback starts; the muted attribute alone can be lost on first mount.
    player.defaultMuted = true
    player.muted = true
    player.playsInline = true
    const start = () => {
      if (!motion.matches && filmEnabled && !videoPaused.current && player.paused) {
        void player.play().catch(() => setVideoPlaying(false))
      }
    }
    const updateMotion = () => {
      setReducedMotion(motion.matches)
      if (motion.matches || !filmEnabled) player.pause()
      else start()
    }
    const interact = (event: Event) => {
      if (event.target instanceof Element && event.target.closest('.video-control')) return
      start()
    }
    const resume = () => { if (!document.hidden) start() }
    updateMotion()
    for (const event of ['loadedmetadata', 'loadeddata', 'canplay', 'canplaythrough'] as const) player.addEventListener(event, start)
    document.addEventListener('click', interact)
    document.addEventListener('touchend', interact, { passive: true })
    document.addEventListener('keydown', interact)
    document.addEventListener('visibilitychange', resume)
    motion.addEventListener('change', updateMotion)
    return () => {
      for (const event of ['loadedmetadata', 'loadeddata', 'canplay', 'canplaythrough'] as const) player.removeEventListener(event, start)
      document.removeEventListener('click', interact)
      document.removeEventListener('touchend', interact)
      document.removeEventListener('keydown', interact)
      document.removeEventListener('visibilitychange', resume)
      motion.removeEventListener('change', updateMotion)
    }
  }, [filmEnabled, filmSource])


  return (
    <div className="site" ref={root}>
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="site-header">
        <a className="site-brand" href="#home" aria-label="TRN Events Nepal, back to top"><img src="/logo.png" alt="TRN Events Nepal logo" width="40" height="40" /></a>
        <nav aria-label="Main navigation"><a href="#upcoming">Events</a><a href="#projects">Gallery</a><a href="#about">About</a></nav>
      </header>
      <main id="main">
        <section className="hero" id="home" aria-labelledby="hero-title">
          <div className="hero-media">{filmEnabled && filmSource ? <video ref={video} src={filmSource} poster="/media/hero-poster.jpg" autoPlay={!reducedMotion} muted loop playsInline preload="auto" onLoadedData={playFilm} onCanPlay={playFilm} onPlay={() => { setVideoPlaying(true); window.__trnHeroPreload?.remove(); window.__trnHeroPreload = undefined; const w = warmup.current; if (w) { w.pause(); w.removeAttribute('src'); w.load(); w.remove(); warmup.current = null } }} onPause={() => setVideoPlaying(false)} aria-label="TRN concert footage" /> : <img src="/media/hero-poster.jpg" alt="TRN concert crowd under stage lights" />}</div>
          <div className="hero-shade" />
          <h1 className="hero-title" id="hero-title"><span>TRN EVENTS</span><span>NEPAL</span></h1>
          <div className="hero-copy"><p>Live music. Shared nights.<br />We bring the stage, the sound<br className="desktop-break" /> and the people together.</p><a className="button" href="#upcoming">Explore events <ArrowDown size={20} aria-hidden="true" /></a></div>
          {filmEnabled && <button className="video-control" onClick={() => {
            if (!video.current) return
            if (video.current.paused) {
              videoPaused.current = false
              playFilm()
            } else {
              videoPaused.current = true
              video.current.pause()
            }
          }} aria-label={videoPlaying ? 'Pause background video' : 'Play background video'} aria-pressed={videoPlaying}>
            {videoPlaying ? <Pause size={17} weight="fill" aria-hidden="true" /> : <Play size={17} weight="fill" aria-hidden="true" />}<span>{videoPlaying ? 'Pause film' : 'Play film'}</span>
          </button>}
          <NextShow />
        </section>
        <UpcomingEvents musicVolume={settings.audioVolume} />
        <PastEvents musicVolume={settings.audioVolume} />
        <Gallery />
        <section className="way section-pad" id="about" aria-labelledby="way-title">
          <div className="way-intro" data-reveal>
            <div>
              <p className="way-label">What we do</p>
              <h2 className="way-title" id="way-title">We bring <br /><span className="way-stroke">live music</span> to life.</h2>
            </div>
            <p className="way-desc">Bringing artists and audiences together through unforgettable live concerts, incredible performances and nights worth remembering.</p>
          </div>
          <div className="way-grid">
            {wayBlocks.map(block => (
              <figure className="way-block" key={block.number} data-reveal>
                <div className="way-photo"><img src={block.image} alt={block.alt} loading="lazy" /></div>
                <figcaption className="way-caption">
                  <span className="way-num" aria-hidden="true">{block.number}</span>
                  <div className="way-caption-copy"><h3>{block.title}</h3><p>{block.text}</p></div>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      </main>
      <footer className="footer" id="contact">
        <div className="footer-cta" data-reveal>
          <div className="footer-cta-copy">
            <h2 className="footer-cta-heading"><a className="footer-cta-link" href="mailto:trneventsnepal3@gmail.com">Let's make your <br />next event <span className="footer-stroke">unforgettable.</span></a></h2>
          </div>
          <a className="footer-cta-button" href="mailto:trneventsnepal3@gmail.com"><span>Plan your event</span><ArrowUpRight size={20} aria-hidden="true" /></a>
        </div>
        <div className="footer-grid">
          <nav className="footer-col" data-reveal aria-label="Explore">
            <h3 className="footer-heading">Explore</h3>
            <ul className="footer-links">
              <li><a href="#home">Home</a></li>
              <li><a href="#upcoming">Upcoming Events</a></li>
              <li><a href="#upcoming">Live Events</a></li>
              <li><a href="#past-events">Past Events</a></li>
            </ul>
          </nav>
          <div className="footer-col" data-reveal>
            <h3 className="footer-heading">Get in touch</h3>
            <ul className="footer-links">
              <li><a href="#contact">Contact Us</a></li>
              <li><a href="mailto:trneventsnepal3@gmail.com">trneventsnepal3@gmail.com</a></li>
            </ul>
          </div>
          <div className="footer-col" data-reveal>
            <h3 className="footer-heading">Follow us</h3>
            <ul className="footer-links">{socials.map(social => <li key={social.label}><a href={social.href} target="_blank" rel="noreferrer">{social.label}</a></li>)}</ul>
          </div>
        </div>
        <a className="footer-wordmark" href="#home" aria-label="TRN Events Nepal, back to top">TRN EVENTS NEPAL</a>
        <div className="footer-bottom">
          <p>© {new Date().getFullYear()} TRN Events Nepal. All Rights Reserved.</p>
          <div className="footer-legal"><span>Privacy Policy</span><span aria-hidden="true">|</span><span>Terms &amp; Conditions</span></div>
          <button className="footer-top-button" type="button" onClick={scrollToTop}>Back to top<ArrowUp size={16} aria-hidden="true" /></button>
        </div>
      </footer>
      <SiteMedia settings={settings} />

    </div>
  )
}
export default App
