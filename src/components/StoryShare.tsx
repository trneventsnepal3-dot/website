import { useEffect, useRef, useState } from 'react'
import {
  ArrowUpRight,
  CheckCircle,
  CopySimple,
  DownloadSimple,
  FacebookLogo,
  Info,
  InstagramLogo,
  LinkSimple,
  ShareNetwork,
  SpinnerGap,
  WarningCircle,
  X,
} from '@phosphor-icons/react'
import type { LiveEvent } from '../events'
import { eventDateLabel, eventVenueLabel } from '../events'
import {
  STORY_TEMPLATES,
  buildStoryCanvas,
  canvasBlob,
  storyData,
  storyEventUrl,
  storyFileName,
  type StoryTemplateId,
} from '../story'
import './story-share.css'

type ShareStatus = { tone: 'ok' | 'info' | 'error'; text: string } | null
type Busy = 'instagram' | 'facebook' | 'download' | 'copy' | 'more' | null
type Platform = 'instagram' | 'facebook'

type Props = {
  event: LiveEvent
  onClose: () => void
}

type CachedStory = { canvas: HTMLCanvasElement; file?: File }

function supportsFileSharing() {
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false
  try {
    return navigator.canShare({ files: [new File([''], 'story.png', { type: 'image/png' })] })
  } catch {
    return false
  }
}

function canShareFile(file: File) {
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false
  try {
    return navigator.canShare({ files: [file] })
  } catch {
    return false
  }
}

function downloadFile(file: File) {
  const url = URL.createObjectURL(file)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = file.name
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1500)
}

function copyFallback(text: string) {
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0'
  document.body.appendChild(area)
  area.select()
  let copied = false
  try { copied = document.execCommand('copy') } catch { copied = false }
  area.remove()
  if (!copied) throw new Error('Could not copy the link.')
}

export default function StoryShareDialog({ event, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const preview = useRef<HTMLCanvasElement>(null)
  const eventRef = useRef(event)
  const templateRef = useRef<StoryTemplateId>('experimental')
  const cache = useRef<Partial<Record<StoryTemplateId, CachedStory>>>({})
  const buildToken = useRef(0)
  const closed = useRef(false)
  const [template, setTemplate] = useState<StoryTemplateId>('experimental')
  const [thumbnails, setThumbnails] = useState<Partial<Record<StoryTemplateId, string>>>({})
  const [preparing, setPreparing] = useState(true)
  const [busy, setBusy] = useState<Busy>(null)
  const [status, setStatus] = useState<ShareStatus>(null)
  const [fallback, setFallback] = useState<Platform | null>(null)
  const [canShareImages] = useState(() => supportsFileSharing())

  eventRef.current = event
  templateRef.current = template
  const summary = storyData(event)
  const link = storyEventUrl(event)

  const paintPreview = (canvas: HTMLCanvasElement) => {
    const target = preview.current
    if (!target) return
    if (target.width !== canvas.width) target.width = canvas.width
    if (target.height !== canvas.height) target.height = canvas.height
    target.getContext('2d')?.drawImage(canvas, 0, 0)
  }

  const finish = () => {
    if (closed.current) return
    closed.current = true
    onClose()
  }

  const close = () => {
    const node = dialog.current
    if (node?.open) node.close()
    else finish()
  }

  useEffect(() => {
    const node = dialog.current
    if (node && !node.open) {
      try { node.showModal() } catch { node.setAttribute('open', '') }
    }
    closeButton.current?.focus({ preventScroll: true })
  }, [])

  // Render each direction once. The same canvases drive thumbnails, the live
  // preview and downloads, so switching templates is instant and exports match.
  useEffect(() => {
    const token = ++buildToken.current
    let cancelled = false
    cache.current = {}
    setThumbnails({})
    setPreparing(true)
    setStatus(null)

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const results = await Promise.all(STORY_TEMPLATES.map(async item => {
            const canvas = await buildStoryCanvas(eventRef.current, item.id)
            const thumbnail = document.createElement('canvas')
            thumbnail.width = 108
            thumbnail.height = 192
            const context = thumbnail.getContext('2d')
            if (context) {
              context.imageSmoothingEnabled = true
              context.imageSmoothingQuality = 'high'
              context.drawImage(canvas, 0, 0, thumbnail.width, thumbnail.height)
            }
            return { id: item.id, canvas, url: thumbnail.toDataURL('image/png') }
          }))
          if (cancelled || token !== buildToken.current) return

          const nextCache: Partial<Record<StoryTemplateId, CachedStory>> = {}
          const nextThumbnails: Partial<Record<StoryTemplateId, string>> = {}
          results.forEach(result => {
            nextCache[result.id] = { canvas: result.canvas }
            nextThumbnails[result.id] = result.url
          })
          cache.current = nextCache
          setThumbnails(nextThumbnails)
          const active = nextCache[templateRef.current]
          if (active) paintPreview(active.canvas)
          setPreparing(false)
        } catch (error) {
          if (cancelled || token !== buildToken.current) return
          setPreparing(false)
          setStatus({ tone: 'error', text: error instanceof Error ? error.message : 'Could not prepare the story images.' })
        }
      })()
    }, 20)

    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [event.id, event.revision])

  useEffect(() => {
    const active = cache.current[template]
    if (active) paintPreview(active.canvas)
  }, [template, preparing])

  const ensureFile = async () => {
    const cached = cache.current[template]
    if (cached?.file) return cached.file
    const canvas = cached?.canvas || await buildStoryCanvas(eventRef.current, template)
    const blob = await canvasBlob(canvas)
    const generated = new File([blob], storyFileName(eventRef.current), { type: 'image/png' })
    cache.current[template] = { canvas, file: generated }
    return generated
  }

  const copyUrl = async (value: string, announce = true) => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value)
      else copyFallback(value)
    } catch {
      try { copyFallback(value) } catch {
        if (announce) setStatus({ tone: 'error', text: 'Could not copy the event link. Please select it manually.' })
        return false
      }
    }
    if (announce) setStatus({ tone: 'ok', text: 'Event link copied. Paste it into the Story link sticker or message.' })
    return true
  }

  const copyEventLink = (announce = true) => copyUrl(storyEventUrl(eventRef.current), announce)

  const shareText = () => {
    const current = storyData(eventRef.current)
    return [current.name, [current.date, current.venue].filter(Boolean).join(' · '), storyEventUrl(eventRef.current)]
      .filter(Boolean)
      .join('\n')
  }

  const shareToStory = async (platform: Platform) => {
    setBusy(platform)
    setStatus(null)
    setFallback(null)
    const instagram = platform === 'instagram'
    let urlCopied = false
    try {
      const target = await ensureFile()
      if (instagram) urlCopied = await copyUrl(storyEventUrl(eventRef.current), false)
      if (canShareFile(target)) {
        try {
          await navigator.share({
            files: [target],
            title: eventRef.current.name,
            text: shareText(),
          })
          setStatus({
            tone: 'ok',
            text: instagram
              ? urlCopied
                ? `Story image ready. Add Instagram's Link sticker with the copied URL.`
                : `Story image ready. Add the event URL with Instagram's Link sticker.`
              : 'Share sheet finished. Your Story is ready to publish in the app.',
          })
          return
        } catch (error) {
          if ((error as Error).name === 'AbortError') {
            setStatus({
              tone: 'info',
              text: instagram
                ? `Sharing cancelled. The image is ready to download and the URL is copied for Instagram's Link sticker.`
                : 'Sharing cancelled. The story image is still ready to download.',
            })
            return
          }
        }
      }
      downloadFile(target)
      const copied = urlCopied || await copyUrl(storyEventUrl(eventRef.current), false)
      setFallback(platform)
      setStatus({
        tone: 'info',
        text: instagram
          ? copied
            ? `Story saved and URL copied. Add Instagram's Link sticker with the copied URL.`
            : `Story saved. Add the event URL with Instagram's Link sticker.`
          : copied
            ? 'Story saved and event link copied. Finish it in the app — the link is ready for the Link sticker.'
            : 'Story saved. Finish it in the app and add the event link with the Link sticker.',
      })
    } catch (error) {
      setStatus({ tone: 'error', text: error instanceof Error ? error.message : 'Could not share the story image.' })
    } finally {
      setBusy(null)
    }
  }

  const download = async () => {
    setBusy('download')
    setStatus(null)
    try {
      downloadFile(await ensureFile())
      setStatus({ tone: 'ok', text: 'Story image downloaded.' })
    } catch (error) {
      setStatus({ tone: 'error', text: error instanceof Error ? error.message : 'Could not download the story image.' })
    } finally {
      setBusy(null)
    }
  }

  const copy = async () => {
    setBusy('copy')
    setStatus(null)
    try { await copyEventLink() } finally { setBusy(null) }
  }

  const shareMore = async () => {
    setBusy('more')
    setStatus(null)
    try {
      if (typeof navigator.share === 'function') {
        if (canShareImages) {
          const target = await ensureFile()
          if (canShareFile(target)) {
            await navigator.share({ files: [target], title: eventRef.current.name, text: shareText() })
            setStatus({ tone: 'ok', text: 'Share sheet finished. Nothing was published automatically.' })
            return
          }
        }
        await navigator.share({ title: eventRef.current.name, text: shareText(), url: link })
        setStatus({ tone: 'ok', text: 'Share sheet finished. Nothing was published automatically.' })
        return
      }
      const copied = await copyEventLink(false)
      setStatus({
        tone: copied ? 'ok' : 'error',
        text: copied ? 'Event link copied. Paste it into any app.' : 'Sharing is not available in this browser.',
      })
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        setStatus({ tone: 'info', text: 'Sharing cancelled.' })
      } else {
        setStatus({ tone: 'error', text: 'Could not open the share sheet. You can still download the image.' })
      }
    } finally {
      setBusy(null)
    }
  }

  const disabled = busy !== null || preparing
  const appName = fallback === 'instagram' ? 'Instagram' : 'Facebook'
  const appUrl = fallback === 'instagram' ? 'https://www.instagram.com/' : 'https://www.facebook.com/'

  return (
    <dialog
      ref={dialog}
      className="story-share-dialog"
      aria-labelledby="story-share-title"
      onCancel={event => { event.preventDefault(); close() }}
      onClose={finish}
      onClick={event => {
        if (event.target === event.currentTarget) {
          const rect = event.currentTarget.getBoundingClientRect()
          if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close()
        }
      }}
    >
      <div className="share-shell">
        <header className="share-head">
          <div className="share-head-copy">
            <span className="share-eyebrow">Campaign directions</span>
            <h2 id="story-share-title">Create a story</h2>
          </div>
          <button ref={closeButton} type="button" className="share-close" onClick={close} aria-label="Close share dialog">
            <X size={21} aria-hidden="true" />
          </button>
        </header>

        <div className="share-body">
          <section className="share-preview-panel" aria-label="Story preview">
            <div className="share-phone">
              <canvas
                ref={preview}
                width={1080}
                height={1920}
                role="img"
                aria-label={`Story preview for ${event.name}`}
              >
                Story preview for {event.name}
              </canvas>
              <span className="share-phone-notch" aria-hidden="true" />
              <span className="share-phone-home" aria-hidden="true" />
              {preparing && <div className="share-preparing" role="status"><SpinnerGap size={20} className="share-spin" aria-hidden="true" />Preparing designs</div>}
            </div>

            <div className="share-templates" role="group" aria-label="Choose a story design">
              {STORY_TEMPLATES.map(item => (
                <button
                  key={item.id}
                  type="button"
                  className={`share-template-card${template === item.id ? ' is-active' : ''}`}
                  onClick={() => setTemplate(item.id)}
                  aria-pressed={template === item.id}
                  title={item.note}
                >
                  <span className="share-template-thumb">
                    {thumbnails[item.id]
                      ? <img src={thumbnails[item.id]} alt="" />
                      : <span className="share-template-loading" aria-hidden="true" />}
                  </span>
                  <span className="share-template-name">{item.name}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="share-actions" aria-label="Sharing options">
            <div className="share-event">
              {event.imageUrl && <img src={event.imageUrl} alt="" />}
              <div>
                <span className="share-event-category">{summary.category}</span>
                <strong>{event.name}</strong>
                <small>{[eventDateLabel(event), summary.venue || eventVenueLabel(event)].filter(Boolean).join(' · ')}</small>
              </div>
            </div>

            <div className="share-option-list">
              <button type="button" className="share-option is-instagram" onClick={() => void shareToStory('instagram')} disabled={disabled} aria-busy={busy === 'instagram'}>
                <span className="share-option-icon"><InstagramLogo size={23} weight="fill" aria-hidden="true" /></span>
                <span className="share-option-copy"><strong>Instagram Story</strong><small>{canShareImages ? 'Open the share sheet and choose Instagram' : 'Save the image and finish it in Instagram'}</small></span>
                {busy === 'instagram' ? <SpinnerGap size={18} className="share-spin" aria-hidden="true" /> : <ArrowUpRight size={18} aria-hidden="true" />}
              </button>

              <button type="button" className="share-option is-facebook" onClick={() => void shareToStory('facebook')} disabled={disabled} aria-busy={busy === 'facebook'}>
                <span className="share-option-icon"><FacebookLogo size={23} weight="fill" aria-hidden="true" /></span>
                <span className="share-option-copy"><strong>Facebook Story</strong><small>{canShareImages ? 'Open the share sheet and choose Facebook' : 'Save the image and finish it in Facebook'}</small></span>
                {busy === 'facebook' ? <SpinnerGap size={18} className="share-spin" aria-hidden="true" /> : <ArrowUpRight size={18} aria-hidden="true" />}
              </button>

              <button type="button" className="share-option" onClick={() => void download()} disabled={disabled} aria-busy={busy === 'download'}>
                <span className="share-option-icon is-download"><DownloadSimple size={22} aria-hidden="true" /></span>
                <span className="share-option-copy"><strong>Download story image</strong><small>Save the finished story image</small></span>
                {busy === 'download' ? <SpinnerGap size={18} className="share-spin" aria-hidden="true" /> : <ArrowUpRight size={18} aria-hidden="true" />}
              </button>

              <button type="button" className="share-option" onClick={() => void copy()} disabled={disabled} aria-busy={busy === 'copy'}>
                <span className="share-option-icon is-link"><LinkSimple size={22} aria-hidden="true" /></span>
                <span className="share-option-copy"><strong>Copy event link</strong><small>{link.replace(/^https?:\/\//, '')}</small></span>
                {busy === 'copy' ? <SpinnerGap size={18} className="share-spin" aria-hidden="true" /> : <CopySimple size={18} aria-hidden="true" />}
              </button>

              <button type="button" className="share-option" onClick={() => void shareMore()} disabled={disabled} aria-busy={busy === 'more'}>
                <span className="share-option-icon is-more"><ShareNetwork size={22} aria-hidden="true" /></span>
                <span className="share-option-copy"><strong>More sharing options</strong><small>Use your device's share sheet</small></span>
                {busy === 'more' ? <SpinnerGap size={18} className="share-spin" aria-hidden="true" /> : <ArrowUpRight size={18} aria-hidden="true" />}
              </button>
            </div>

            {status && (
              <p className={`share-status is-${status.tone}`} role="status" aria-live="polite">
                {status.tone === 'ok' && <CheckCircle size={17} weight="fill" aria-hidden="true" />}
                {status.tone === 'info' && <Info size={17} weight="fill" aria-hidden="true" />}
                {status.tone === 'error' && <WarningCircle size={17} weight="fill" aria-hidden="true" />}
                {status.text}
              </p>
            )}

            {fallback && (
              <div className="share-fallback" aria-label={`Finish in ${appName}`}>
                <div className="share-fallback-head">
                  <strong>Finish in {appName}</strong>
                  <span>3 quick steps</span>
                </div>
                <ol>
                  <li>Open {appName} and start a new Story.</li>
                  <li>Add the story image you just downloaded.</li>
                  <li>Paste the copied event link with the Link sticker.</li>
                </ol>
                <div className="share-fallback-actions">
                  <a className="share-fallback-primary" href={appUrl} target="_blank" rel="noreferrer">
                    Open {appName}<ArrowUpRight size={15} aria-hidden="true" />
                  </a>
                  <button type="button" onClick={() => void download()}>Download again</button>
                  <button type="button" onClick={() => void copy()}>Copy link</button>
                </div>
              </div>
            )}

            <p className="share-fineprint">
              Nothing is posted automatically. Instagram and Facebook do not let a website publish a Story for you, so you always finish the final post in the app.
            </p>
          </section>
        </div>
      </div>
    </dialog>
  )
}
