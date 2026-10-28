import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUpRight, Pause, Play } from '@phosphor-icons/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import UpcomingEvents from './components/Events'
import SiteMedia from './components/SiteMedia'
import Gallery from './components/Gallery'
import { useSiteSettings } from './settings'

gsap.registerPlugin(ScrollTrigger)

const socials = [
  { label: 'Instagram', href: 'https://www.instagram.com/trn_events_nepal/?hl=en' },
  { label: 'Facebook', href: 'https://www.facebook.com/profile.php?id=61573707875970' },
  { label: 'TikTok', href: 'https://www.tiktok.com/@trn_events_nepal' },
]

function App() {
  const settings = useSiteSettings()
  const filmEnabled = settings.effectsEnabled && settings.heroVideoEnabled
  const filmSource = settings.hero?.url || '/media/hero-video.mp4'
  const photoSource = (file: string) => `${settings.galleryBaseUrl || '/media'}/${encodeURIComponent(file)}`
  const root = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const [videoPlaying, setVideoPlaying] = useState(false)

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
        <UpcomingEvents />
        <Gallery />
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

    </div>
  )
}
export default App
