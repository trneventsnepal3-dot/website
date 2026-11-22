import type { LiveEvent } from './events'
import { eventDateLabel } from './events'
import QRCode from 'qrcode'

export type StoryTemplateId = 'experimental' | 'cinematic' | 'luxury'

export type StoryTemplate = {
  id: StoryTemplateId
  name: string
  note: string
  accent: string
}

export const STORY_WIDTH = 1080
export const STORY_HEIGHT = 1920

export const STORY_TEMPLATES: StoryTemplate[] = [
  { id: 'experimental', name: 'EXPERIMENTAL', note: 'Festival graphics, oversized type', accent: '#e10618' },
  { id: 'cinematic', name: 'CINEMATIC', note: 'Premium concert film campaign', accent: '#c9122f' },
  { id: 'luxury', name: 'LUXURY EDITORIAL', note: 'Magazine-inspired composition', accent: '#c8a86a' },
]

export type StoryData = {
  name: string
  artist: string
  date: string
  venue: string
  city: string
  country: string
  category: string
  eventNumber: string
  organizer: string
  organizerType: 'org' | 'tour'
  host: string
  url: string
  isPast: boolean
  showCount: number
}

const clean = (value?: string | null) => (value || '').replace(/\s+/g, ' ').trim()
const sameText = (a: string, b: string) => clean(a).toLowerCase() === clean(b).toLowerCase()

/** The official public domain printed on every generated story. */
const STORY_WEBSITE = 'trneventsnepal.com.np'

/** Canonical event URL used by the QR code and shared links. */
export function storyEventUrl(event: LiveEvent) {
  return `https://${STORY_WEBSITE}/event/${event.id}`
}

function placeParts(value?: string) {
  return clean(value)
    .split(/\s*[·|,]\s*|\s+[–—-]\s+/)
    .map(part => part.trim())
    .filter(Boolean)
}

function countryFrom(value?: string) {
  const parts = placeParts(value)
  return parts.length > 1 ? parts[parts.length - 1] : ''
}

function cityFrom(value?: string) {
  const parts = placeParts(value)
  if (!parts.length) return ''
  return parts.length > 2 ? parts[parts.length - 2] : parts[0]
}

export function storyData(event: LiveEvent): StoryData {
  const stops = event.stops || []
  const cities = event.type === 'tour'
    ? stops.map(stop => cityFrom(stop.location))
    : [cityFrom(event.location)]
  const countries = event.type === 'tour'
    ? stops.map(stop => countryFrom(stop.location))
    : [countryFrom(event.location)]
  const tourPlaces = [...new Set(cities.filter(Boolean))].slice(0, 2)
  const venue = event.type === 'tour'
    ? [tourPlaces.join(' · '), stops.length > 2 ? `${stops.length} shows` : ''].filter(Boolean).join(' · ')
    : clean(event.location)

  return {
    name: clean(event.name) || 'Live event',
    artist: clean(event.artist),
    date: eventDateLabel(event),
    venue,
    city: [...new Set(cities.filter(Boolean))].slice(0, 2).join(' · '),
    country: [...new Set(countries.filter(Boolean))].slice(0, 2).join(' · '),
    category: event.type === 'tour' ? `TOUR${stops.length ? ` · ${stops.length} SHOWS` : ''}` : 'LIVE CONCERT',
    eventNumber: clean(event.eventNumber),
    organizer: clean(event.organizer),
    organizerType: event.organizerType,
    host: STORY_WEBSITE,
    url: storyEventUrl(event),
    isPast: Boolean(event.isPast),
    showCount: event.type === 'tour' ? stops.length : 1,
  }
}

export function storyFileName(event: LiveEvent) {
  const slug = clean(event.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `${slug || 'trn-event'}-story.png`
}

const imageCache = new Map<string, Promise<HTMLImageElement | null>>()

function imageFromBlob(blob: Blob) {
  return new Promise<HTMLImageElement | null>(resolve => {
    const objectUrl = URL.createObjectURL(blob)
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => { URL.revokeObjectURL(objectUrl); resolve(image) }
    image.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(null) }
    image.src = objectUrl
  })
}

export function loadStoryImage(src?: string | null) {
  if (!src) return Promise.resolve<HTMLImageElement | null>(null)
  const cached = imageCache.get(src)
  if (cached) return cached
  const request = (async () => {
    try {
      // Fetching into a blob avoids a canvas taint when a poster was first cached
      // by a plain <img> without CORS headers.
      const response = await fetch(src, { mode: 'cors', credentials: 'omit', cache: 'reload' })
      if (!response.ok) throw new Error(`Poster request failed (${response.status}).`)
      const blob = await response.blob()
      if (!blob.size) throw new Error('The poster was empty.')
      return await imageFromBlob(blob)
    } catch {
      return await new Promise<HTMLImageElement | null>(resolve => {
        const image = new Image()
        image.crossOrigin = 'anonymous'
        image.decoding = 'async'
        image.onload = () => resolve(image)
        image.onerror = () => resolve(null)
        image.src = `${src}${src.includes('?') ? '&' : '?'}trn_story=${Date.now()}`
      })
    }
  })()
  imageCache.set(src, request)
  return request
}

let fontsReady: Promise<void> | null = null

function waitForFonts() {
  if (!fontsReady) {
    fontsReady = (async () => {
      if (!document.fonts) return
      await Promise.allSettled([
        document.fonts.load('400 96px Koulen'),
        document.fonts.load('300 40px "Work Sans Variable"'),
        document.fonts.load('400 40px "Work Sans Variable"'),
        document.fonts.load('500 40px "Work Sans Variable"'),
        document.fonts.load('600 40px "Work Sans Variable"'),
        document.fonts.load('700 40px "Work Sans Variable"'),
      ])
      await document.fonts.ready
    })()
  }
  return fontsReady
}

const qrCache = new Map<string, Promise<HTMLCanvasElement>>()

function makeStoryQr(url: string) {
  const cached = qrCache.get(url)
  if (cached) return cached
  const request = (async () => {
    const canvas = document.createElement('canvas')
    await QRCode.toCanvas(canvas, url, {
      width: 256,
      margin: 4,
      errorCorrectionLevel: 'M',
      color: { dark: '#050505', light: '#ffffff' },
    })
    return canvas
  })()
  qrCache.set(url, request)
  return request
}

export async function buildStoryCanvas(event: LiveEvent, templateId: StoryTemplateId) {
  const [poster, logo, qr] = await Promise.all([
    loadStoryImage(event.imageUrl),
    loadStoryImage('/logo.png'),
    makeStoryQr(storyEventUrl(event)),
    waitForFonts(),
  ])
  const canvas = document.createElement('canvas')
  canvas.width = STORY_WIDTH
  canvas.height = STORY_HEIGHT
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('This browser cannot create the story image.')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  const template = STORY_TEMPLATES.find(item => item.id === templateId) || STORY_TEMPLATES[0]
  drawStory(context, storyData(event), template, poster, logo, qr)
  return canvas
}

export function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not generate the story image. Please try again.')), 'image/png')
  })
}

export async function buildStoryBlob(event: LiveEvent, templateId: StoryTemplateId) {
  return canvasBlob(await buildStoryCanvas(event, templateId))
}

/* ------------------------------------------------------------------ */
/* Composition dispatch                                                */
/* ------------------------------------------------------------------ */

const W = STORY_WIDTH
const H = STORY_HEIGHT
const WHITE = '#f7f4ef'
const MUTED = 'rgba(247, 244, 239, .62)'
const BG = '#070808'

type Align = 'left' | 'center' | 'right'
type Rect = { x: number; y: number; w: number; h: number }

function drawStory(
  ctx: CanvasRenderingContext2D,
  data: StoryData,
  template: StoryTemplate,
  poster: HTMLImageElement | null,
  logo: HTMLImageElement | null,
  qr: HTMLCanvasElement | null,
) {
  if (template.id === 'experimental') drawExperimental(ctx, data, template, poster, logo, qr)
  else if (template.id === 'luxury') drawLuxuryEditorial(ctx, data, template, poster, logo, qr)
  else drawCinematic(ctx, data, template, poster, logo, qr)
  drawGrain(ctx)
}

/* ------------------------------------------------------------------ */
/* Template A — Experimental                                           */
/* ------------------------------------------------------------------ */

function drawExperimental(
  ctx: CanvasRenderingContext2D,
  data: StoryData,
  template: StoryTemplate,
  poster: HTMLImageElement | null,
  logo: HTMLImageElement | null,
  qr: HTMLCanvasElement | null,
) {
  ctx.fillStyle = '#050505'
  ctx.fillRect(0, 0, W, H)
  radial(ctx, 920, 430, 760, hex(template.accent, .2), 'rgba(0, 0, 0, 0)')
  drawHalftone(ctx, 0, 250, 178, 930, 'rgba(247, 244, 239, .11)', 17)

  // Oversized initials sit behind the portrait and break the frame.
  ctx.save()
  ctx.globalAlpha = .13
  setFont(ctx, 310, 400)
  ctx.fillStyle = WHITE
  ctx.textAlign = 'left'
  ctx.fillText(overflowWord(data.artist || data.name), -88, 880)
  ctx.restore()

  const px = 196
  const py = 138
  const pw = 884
  const ph = 1060
  ctx.save()
  ctx.beginPath()
  ctx.rect(px, py, pw, ph)
  ctx.clip()
  drawPosterCover(ctx, poster, px, py, pw, ph, .24)
  ctx.fillStyle = hex(template.accent, .1)
  ctx.fillRect(px, py, pw, ph)
  const fade = ctx.createLinearGradient(0, 700, 0, py + ph)
  fade.addColorStop(0, 'rgba(4, 5, 5, 0)')
  fade.addColorStop(.6, 'rgba(4, 5, 5, .58)')
  fade.addColorStop(1, 'rgba(4, 5, 5, .96)')
  ctx.fillStyle = fade
  ctx.fillRect(px, 700, pw, ph - 560)
  ctx.restore()

  ctx.fillStyle = hex(template.accent, .94)
  ctx.fillRect(0, 306, 15, 930)
  ctx.save()
  ctx.strokeStyle = 'rgba(247, 244, 239, .52)'
  ctx.lineWidth = 2
  line(ctx, 64, 1120, 1016, 1004)
  ctx.strokeStyle = hex(template.accent, .88)
  ctx.lineWidth = 5
  line(ctx, 64, 1120, 250, 1104)
  ctx.restore()

  const name = clean(data.name)
  const artist = clean(data.artist) || name
  if (!sameText(name, artist)) {
    setFont(ctx, 11, 700, true)
    ctx.fillStyle = hex(template.accent, .98)
    drawTracked(ctx, fitTracked(ctx, name.toUpperCase(), 920, 2.6), 64, 184, 2.6)
  }

  const title = drawTitle(ctx, artist, 64, 928, 930, 112, 54, 3, 226, 'left')
  ctx.fillStyle = hex(template.accent, .9)
  ctx.fillRect(64, Math.min(title.bottom + 22, 1156), 140, 4)

  drawInfoLabel(ctx, `EVENT NO. ${data.eventNumber || 'TRN'}`, 64, 1252, template.accent)
  ctx.textAlign = 'right'
  setFont(ctx, 10, 700, true)
  ctx.fillStyle = MUTED
  ctx.fillText(data.category.toUpperCase(), 1016, 1252)
  ctx.textAlign = 'left'

  setFont(ctx, 62, 400)
  ctx.fillStyle = WHITE
  const dateLines = wrapText(ctx, (data.date || 'To be Announced').toUpperCase(), 730, 2).lines
  dateLines.forEach((value, index) => ctx.fillText(value, 64, 1352 + index * 68))

  const detailsTop = dateLines.length > 1 ? 1490 : 1430
  const place = placeLabel(data, data.venue)
  setFont(ctx, 27, 500, true)
  ctx.fillStyle = WHITE
  ctx.fillText(fitLine(ctx, data.venue || 'To be Announced', 920), 64, detailsTop)
  if (place) {
    setFont(ctx, 21, 500, true)
    ctx.fillStyle = MUTED
    ctx.fillText(fitLine(ctx, place, 920), 64, detailsTop + 38)
  }
  setFont(ctx, 15, 600, true)
  ctx.fillStyle = 'rgba(247, 244, 239, .52)'
  ctx.fillText(fitLine(ctx, organizerLabel(data), 920), 64, detailsTop + (place ? 72 : 38))

  drawBrandFooter(ctx, data, logo, qr, template.accent)
}

/* ------------------------------------------------------------------ */
/* Template B — Cinematic                                              */
/* ------------------------------------------------------------------ */

function drawCinematic(
  ctx: CanvasRenderingContext2D,
  data: StoryData,
  template: StoryTemplate,
  poster: HTMLImageElement | null,
  logo: HTMLImageElement | null,
  qr: HTMLCanvasElement | null,
) {
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, W, H)

  const imageBottom = 1360
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, W, imageBottom)
  ctx.clip()
  drawPosterCover(ctx, poster, 0, 0, W, imageBottom, .28)
  const topFade = ctx.createLinearGradient(0, 0, 0, 380)
  topFade.addColorStop(0, 'rgba(3, 4, 5, .84)')
  topFade.addColorStop(1, 'rgba(3, 4, 5, 0)')
  ctx.fillStyle = topFade
  ctx.fillRect(0, 0, W, 380)
  const bottomFade = ctx.createLinearGradient(0, 700, 0, imageBottom)
  bottomFade.addColorStop(0, 'rgba(3, 4, 5, 0)')
  bottomFade.addColorStop(.52, 'rgba(3, 4, 5, .62)')
  bottomFade.addColorStop(1, BG)
  ctx.fillStyle = bottomFade
  ctx.fillRect(0, 700, W, imageBottom - 700)
  ctx.restore()

  radial(ctx, 790, 590, 560, hex(template.accent, .17), 'rgba(0, 0, 0, 0)')
  const vignette = ctx.createRadialGradient(W / 2, 620, 320, W / 2, 680, 1080)
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)')
  vignette.addColorStop(1, 'rgba(0, 0, 0, .52)')
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, W, imageBottom)

  ctx.textAlign = 'right'
  setFont(ctx, 10, 700, true)
  ctx.fillStyle = 'rgba(247, 244, 239, .82)'
  ctx.fillText(`EVENT NO. ${data.eventNumber || 'TRN'}`, 1008, 150)
  ctx.fillStyle = hex(template.accent, .95)
  ctx.fillText(data.category.toUpperCase(), 1008, 174)
  ctx.textAlign = 'left'

  const name = clean(data.name)
  const artist = clean(data.artist) || name
  if (!sameText(name, artist)) {
    setFont(ctx, 11, 700, true)
    ctx.fillStyle = hex(template.accent, .98)
    drawTracked(ctx, fitTracked(ctx, name.toUpperCase(), 900, 2.6), 72, 930, 2.6)
  }

  drawTitle(ctx, artist, 72, 978, 936, 116, 54, 3, 236, 'left')
  ctx.save()
  ctx.strokeStyle = 'rgba(247, 244, 239, .3)'
  ctx.lineWidth = 1
  line(ctx, 72, 1320, 1008, 1320)
  ctx.strokeStyle = hex(template.accent, .9)
  ctx.lineWidth = 3
  line(ctx, 72, 1320, 190, 1320)
  ctx.restore()

  setFont(ctx, 50, 400)
  ctx.fillStyle = WHITE
  const dateLines = wrapText(ctx, (data.date || 'To be Announced').toUpperCase(), 540, 2).lines
  dateLines.forEach((value, index) => ctx.fillText(value, 72, 1420 + index * 54))

  ctx.textAlign = 'right'
  setFont(ctx, 10, 700, true)
  ctx.fillStyle = hex(template.accent, .95)
  drawTracked(ctx, 'PRESENTED BY', 1008, 1372, 2)
  setFont(ctx, 25, 500, true)
  ctx.fillStyle = WHITE
  ctx.fillText(fitLine(ctx, organizerLabel(data), 300), 1008, 1410)
  ctx.textAlign = 'left'

  const place = placeLabel(data, data.venue)
  setFont(ctx, 29, 500, true)
  ctx.fillStyle = WHITE
  ctx.fillText(fitLine(ctx, data.venue || 'To be Announced', 920), 72, dateLines.length > 1 ? 1538 : 1502)
  if (place) {
    setFont(ctx, 22, 500, true)
    ctx.fillStyle = MUTED
    ctx.fillText(fitLine(ctx, place, 920), 72, dateLines.length > 1 ? 1574 : 1540)
  }

  drawBrandFooter(ctx, data, logo, qr, template.accent)
}

/* ------------------------------------------------------------------ */
/* Template C — Luxury Editorial                                       */
/* ------------------------------------------------------------------ */

function drawLuxuryEditorial(
  ctx: CanvasRenderingContext2D,
  data: StoryData,
  template: StoryTemplate,
  poster: HTMLImageElement | null,
  logo: HTMLImageElement | null,
  qr: HTMLCanvasElement | null,
) {
  ctx.fillStyle = '#0b0a09'
  ctx.fillRect(0, 0, W, H)
  radial(ctx, 830, 360, 700, hex(template.accent, .1), 'rgba(0, 0, 0, 0)')

  setFont(ctx, 11, 700, true)
  ctx.fillStyle = hex(template.accent, .95)
  drawTracked(ctx, 'TRN EVENTS · NEPAL', 64, 150, 3)
  ctx.textAlign = 'right'
  ctx.fillStyle = 'rgba(247, 244, 239, .7)'
  ctx.fillText(`EVENT NO. ${data.eventNumber || 'TRN'}`, 1016, 150)
  ctx.textAlign = 'left'
  ctx.strokeStyle = hex(template.accent, .42)
  ctx.lineWidth = 1
  line(ctx, 64, 184, 1016, 184)

  const ix = 96
  const iy = 234
  const iw = 888
  const ih = 820
  ctx.save()
  ctx.shadowColor = 'rgba(0, 0, 0, .8)'
  ctx.shadowBlur = 42
  ctx.shadowOffsetY = 20
  ctx.fillStyle = '#080808'
  ctx.fillRect(ix, iy, iw, ih)
  ctx.restore()

  ctx.save()
  ctx.beginPath()
  ctx.rect(ix, iy, iw, ih)
  ctx.clip()
  drawPosterCover(ctx, poster, ix, iy, iw, ih, .3)
  const fade = ctx.createLinearGradient(0, iy + ih - 260, 0, iy + ih)
  fade.addColorStop(0, 'rgba(8, 8, 8, 0)')
  fade.addColorStop(1, 'rgba(8, 8, 8, .58)')
  ctx.fillStyle = fade
  ctx.fillRect(ix, iy + ih - 260, iw, 260)
  ctx.restore()

  ctx.strokeStyle = hex(template.accent, .56)
  ctx.lineWidth = 1
  ctx.strokeRect(ix + .5, iy + .5, iw - 1, ih - 1)
  ctx.strokeStyle = 'rgba(247, 244, 239, .14)'
  ctx.strokeRect(ix + 10.5, iy + 10.5, iw - 21, ih - 21)

  const name = clean(data.name)
  const artist = clean(data.artist) || name
  if (!sameText(name, artist)) {
    setFont(ctx, 10, 700, true)
    ctx.fillStyle = hex(template.accent, .96)
    drawTracked(ctx, fitTracked(ctx, name.toUpperCase(), 900, 2.8), 64, 1106, 2.8)
  }

  drawElegantTitle(ctx, artist, 64, 1212, 952, 84, 48, 3, 176, 1.5)

  const editorialRows = [
    ['DATE', (data.date || 'To be Announced').toUpperCase()],
    ['VENUE', data.venue || 'To be Announced'],
    ['CITY / COUNTRY', placeLabel(data, data.venue)],
    ['ORGANIZER', organizerLabel(data)],
  ].filter((row): row is [string, string] => Boolean(row[1]))
  editorialRows.forEach(([label, value], index) => {
    drawEditorialRow(ctx, label, value, 64, 1442 + index * 42, 178, template.accent)
  })

  drawBrandFooter(ctx, data, logo, qr, template.accent)
}

/* ------------------------------------------------------------------ */
/* Shared brand footer                                                 */
/* ------------------------------------------------------------------ */

function drawBrandFooter(
  ctx: CanvasRenderingContext2D,
  data: StoryData,
  logo: HTMLImageElement | null,
  qr: HTMLCanvasElement | null,
  accent: string,
) {
  const y = 1600
  const divider = ctx.createLinearGradient(64, y, 1016, y)
  divider.addColorStop(0, 'rgba(255, 255, 255, 0)')
  divider.addColorStop(.3, hex(accent, .72))
  divider.addColorStop(.72, 'rgba(215, 25, 63, .48)')
  divider.addColorStop(1, 'rgba(255, 255, 255, 0)')
  ctx.save()
  ctx.strokeStyle = divider
  ctx.lineWidth = 1.5
  line(ctx, 64, y, 1016, y)
  ctx.restore()

  if (logo) {
    const fit = contain(logo, 64, y + 18, 58, 58)
    ctx.save()
    ctx.globalAlpha = 1
    ctx.drawImage(logo, fit.x, fit.y, fit.w, fit.h)
    ctx.restore()
  } else {
    setFont(ctx, 24, 400)
    ctx.fillStyle = WHITE
    ctx.fillText('TRN', 64, y + 58)
  }

  ctx.textAlign = 'left'
  setFont(ctx, 25, 600, true)
  ctx.fillStyle = WHITE
  ctx.fillText(data.host, 136, y + 52)
  setFont(ctx, 10, 700, true)
  ctx.fillStyle = hex(accent, .96)
  drawTracked(ctx, 'DISCOVER MORE EVENTS ON TRN', 137, y + 80, 2)

  const size = 156
  const qx = 846
  const qy = y + 6
  ctx.save()
  roundRect(ctx, qx, qy, size, size, 10)
  ctx.fillStyle = '#ffffff'
  ctx.shadowColor = 'rgba(0, 0, 0, .58)'
  ctx.shadowBlur = 22
  ctx.shadowOffsetY = 8
  ctx.fill()
  ctx.restore()
  if (qr) ctx.drawImage(qr, qx + 12, qy + 12, size - 24, size - 24)

  ctx.textAlign = 'center'
  setFont(ctx, 9, 700, true)
  ctx.fillStyle = WHITE
  drawTrackedCentred(ctx, 'SCAN FOR EVENT DETAILS', qx + size / 2, qy + size + 26, 1.5)
  ctx.textAlign = 'left'
}

/* ------------------------------------------------------------------ */
/* Drawing helpers                                                     */
/* ------------------------------------------------------------------ */

function setFont(ctx: CanvasRenderingContext2D, size: number, weight = 400, text = false) {
  ctx.font = `${weight} ${size}px ${text ? '"Work Sans Variable", "Work Sans", sans-serif' : 'Koulen, Impact, sans-serif'}`
}

function overflowWord(value: string) {
  return (clean(value).split(' ').filter(Boolean)[0] || 'TRN').toUpperCase()
}

function placeLabel(data: StoryData, venue = '') {
  const city = clean(data.city)
  const country = clean(data.country)
  const label = [city, country && !city.toLowerCase().includes(country.toLowerCase()) ? country : ''].filter(Boolean).join(' · ')
  return sameText(label, venue) ? '' : label
}

function organizerLabel(data: StoryData) {
  return `${data.organizerType === 'tour' ? 'TOUR BY' : 'PRESENTED BY'} ${data.organizer || 'TRN Events Nepal'}`
}

function drawInfoLabel(ctx: CanvasRenderingContext2D, label: string, x: number, y: number, accent: string) {
  setFont(ctx, 10, 700, true)
  ctx.fillStyle = hex(accent, .96)
  drawTracked(ctx, label.toUpperCase(), x, y, 2.4)
}

function drawEditorialRow(
  ctx: CanvasRenderingContext2D,
  label: string,
  value: string,
  x: number,
  y: number,
  labelWidth: number,
  accent: string,
) {
  ctx.strokeStyle = hex(accent, .34)
  ctx.lineWidth = 1
  line(ctx, x, y + 9, x + labelWidth, y + 9)
  ctx.strokeStyle = 'rgba(247, 244, 239, .12)'
  line(ctx, x + labelWidth + 16, y + 9, 1016, y + 9)

  setFont(ctx, 9, 700, true)
  ctx.fillStyle = hex(accent, .92)
  drawTracked(ctx, label.toUpperCase(), x, y, 2.2)
  setFont(ctx, 22, 500, true)
  ctx.fillStyle = WHITE
  ctx.fillText(fitLine(ctx, value, 1016 - x - labelWidth - 28), x + labelWidth + 28, y + 2)
}

function drawHalftone(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  gap: number,
) {
  ctx.save()
  ctx.fillStyle = color
  for (let row = 0; y + row * gap < y + h; row += 1) {
    for (let column = 0; x + column * gap < x + w; column += 1) {
      const radius = 1.1 + ((row + column) % 4) * .32
      ctx.beginPath()
      ctx.arc(x + column * gap, y + row * gap, radius, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
}

function drawPosterCover(
  ctx: CanvasRenderingContext2D,
  poster: HTMLImageElement | null,
  x: number,
  y: number,
  w: number,
  h: number,
  anchorY: number,
) {
  if (poster) {
    drawCoverAnchored(ctx, poster, x, y, w, h, anchorY)
    return
  }
  const fallback = ctx.createLinearGradient(x, y, x + w, y + h)
  fallback.addColorStop(0, '#2a1013')
  fallback.addColorStop(.5, '#141313')
  fallback.addColorStop(1, '#08090a')
  ctx.fillStyle = fallback
  ctx.fillRect(x, y, w, h)
}

type TitleLayout = { bottom: number; size: number; lines: string[] }

function drawTitle(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  maxWidth: number,
  maxSize: number,
  minSize: number,
  maxLines: number,
  maxHeight: number,
  align: Align,
): TitleLayout {
  const text = value.toUpperCase()
  let size = maxSize
  let lines: string[] = []
  for (; size >= minSize; size -= 2) {
    setFont(ctx, size, 400)
    const result = wrapText(ctx, text, maxWidth, maxLines)
    if (!result.truncated && result.lines.length * size * .98 <= maxHeight) {
      lines = result.lines
      break
    }
    lines = result.lines
  }
  if (size < minSize) size = minSize
  setFont(ctx, size, 400)
  const lineHeight = size * .98
  const ascent = ctx.measureText('H').actualBoundingBoxAscent || size * .76
  const baseline = y + ascent
  ctx.textAlign = align
  const drawX = align === 'center' ? x + maxWidth / 2 : align === 'right' ? x + maxWidth : x
  ctx.fillStyle = WHITE
  ctx.shadowColor = 'rgba(0, 0, 0, .62)'
  ctx.shadowBlur = 26
  ctx.shadowOffsetY = 5
  lines.forEach((line, index) => ctx.fillText(line, drawX, baseline + index * lineHeight))
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.shadowOffsetY = 0
  ctx.textAlign = 'left'
  return { bottom: y + Math.max(lines.length, 1) * lineHeight, size, lines }
}

function drawElegantTitle(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  maxWidth: number,
  maxSize: number,
  minSize: number,
  maxLines: number,
  maxHeight: number,
  spacing: number,
): TitleLayout {
  const text = value.toUpperCase()
  let size = maxSize
  let lines: string[] = []
  for (; size >= minSize; size -= 2) {
    setFont(ctx, size, 300, true)
    const result = wrapTracked(ctx, text, maxWidth, spacing, maxLines)
    if (!result.truncated && result.lines.length * size * 1.12 <= maxHeight) {
      lines = result.lines
      break
    }
    lines = result.lines
  }
  if (size < minSize) size = minSize
  setFont(ctx, size, 300, true)
  ctx.fillStyle = WHITE
  lines.forEach((line, index) => drawTracked(ctx, line, x, y + index * size * 1.12, spacing))
  return { bottom: y + Math.max(lines.length, 1) * size * 1.12, size, lines }
}

function wrapText(ctx: CanvasRenderingContext2D, value: string, maxWidth: number, maxLines: number) {
  const words = value.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  const lines: string[] = []
  let current = ''
  let truncated = false

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate
      continue
    }
    if (current) {
      lines.push(current)
      current = ''
      if (lines.length >= maxLines) { truncated = true; break }
    }
    if (ctx.measureText(word).width > maxWidth) {
      let chunk = ''
      for (const character of word) {
        if (chunk && ctx.measureText(chunk + character).width > maxWidth) {
          lines.push(chunk)
          chunk = character
          if (lines.length >= maxLines) { truncated = true; break }
        } else chunk += character
      }
      if (truncated) break
      current = chunk
    } else current = word
  }
  if (!truncated && current) lines.push(current)
  if (lines.length > maxLines) { lines.length = maxLines; truncated = true }
  if (truncated && lines.length) {
    let last = lines[lines.length - 1]
    while (last.length && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1)
    lines[lines.length - 1] = `${last.trimEnd()}…`
  }
  return { lines: lines.length ? lines : [''], truncated }
}

function wrapTracked(
  ctx: CanvasRenderingContext2D,
  value: string,
  maxWidth: number,
  spacing: number,
  maxLines: number,
) {
  const words = value.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  const lines: string[] = []
  let current = ''
  let truncated = false
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (trackedWidth(ctx, candidate, spacing) <= maxWidth) {
      current = candidate
      continue
    }
    if (current) {
      lines.push(current)
      current = ''
      if (lines.length >= maxLines) { truncated = true; break }
    }
    if (trackedWidth(ctx, word, spacing) > maxWidth) {
      let chunk = ''
      for (const character of word) {
        if (chunk && trackedWidth(ctx, chunk + character, spacing) > maxWidth) {
          lines.push(chunk)
          chunk = character
          if (lines.length >= maxLines) { truncated = true; break }
        } else chunk += character
      }
      if (truncated) break
      current = chunk
    } else current = word
  }
  if (!truncated && current) lines.push(current)
  if (lines.length > maxLines) { lines.length = maxLines; truncated = true }
  if (truncated && lines.length) {
    let last = lines[lines.length - 1]
    while (last.length && trackedWidth(ctx, `${last}…`, spacing) > maxWidth) last = last.slice(0, -1)
    lines[lines.length - 1] = `${last.trimEnd()}…`
  }
  return { lines: lines.length ? lines : [''], truncated }
}

function fitLine(ctx: CanvasRenderingContext2D, value: string, maxWidth: number) {
  if (ctx.measureText(value).width <= maxWidth) return value
  let result = value
  while (result.length && ctx.measureText(`${result}…`).width > maxWidth) result = result.slice(0, -1)
  return `${result.trimEnd()}…`
}

function drawTracked(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, spacing: number) {
  ctx.textAlign = 'left'
  let cursor = x
  for (const character of text) {
    ctx.fillText(character, cursor, y)
    cursor += ctx.measureText(character).width + spacing
  }
}

function drawTrackedCentred(ctx: CanvasRenderingContext2D, text: string, centre: number, y: number, spacing: number) {
  drawTracked(ctx, text, centre - trackedWidth(ctx, text, spacing) / 2, y, spacing)
}

function trackedWidth(ctx: CanvasRenderingContext2D, text: string, spacing: number) {
  let width = 0
  for (const character of text) width += ctx.measureText(character).width + spacing
  return Math.max(0, width - spacing)
}

function fitTracked(ctx: CanvasRenderingContext2D, value: string, maxWidth: number, spacing: number) {
  let result = value
  while (result.length && trackedWidth(ctx, `${result}…`, spacing) > maxWidth) result = result.slice(0, -1)
  return `${result.trimEnd()}…`
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number) {
  const r = Math.min(radius, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
}

function radial(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, from: string, to: string) {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius)
  gradient.addColorStop(0, from)
  gradient.addColorStop(1, to)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, W, H)
}

function drawCoverAnchored(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  anchorY: number,
) {
  const source = imageSize(image)
  if (!source.width || !source.height) return
  const scale = Math.max(w / source.width, h / source.height)
  const drawW = source.width * scale
  const drawH = source.height * scale
  ctx.drawImage(image, x + (w - drawW) / 2, y + (h - drawH) * anchorY, drawW, drawH)
}

function contain(image: CanvasImageSource, x: number, y: number, w: number, h: number): Rect {
  const source = imageSize(image)
  if (!source.width || !source.height) return { x, y, w, h }
  const scale = Math.min(w / source.width, h / source.height)
  const drawW = source.width * scale
  const drawH = source.height * scale
  return { x: x + (w - drawW) / 2, y: y + (h - drawH) / 2, w: drawW, h: drawH }
}

function imageSize(image: CanvasImageSource) {
  if (image instanceof HTMLImageElement) return { width: image.naturalWidth, height: image.naturalHeight }
  if (image instanceof HTMLVideoElement) return { width: image.videoWidth, height: image.videoHeight }
  return { width: Number((image as { width?: number }).width) || 0, height: Number((image as { height?: number }).height) || 0 }
}

function hex(color: string, alpha: number) {
  const match = /^#([0-9a-f]{6})$/i.exec(color)
  if (!match) return color
  const value = parseInt(match[1], 16)
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`
}

let grainCanvas: HTMLCanvasElement | null = null

function drawGrain(ctx: CanvasRenderingContext2D) {
  if (!grainCanvas) {
    grainCanvas = document.createElement('canvas')
    grainCanvas.width = 220
    grainCanvas.height = 220
    const noiseContext = grainCanvas.getContext('2d')
    if (noiseContext) {
      const pixels = noiseContext.createImageData(220, 220)
      for (let index = 0; index < pixels.data.length; index += 4) {
        const value = Math.floor(Math.random() * 255)
        pixels.data[index] = value
        pixels.data[index + 1] = value
        pixels.data[index + 2] = value
        pixels.data[index + 3] = 14
      }
      noiseContext.putImageData(pixels, 0, 0)
    }
  }
  const pattern = grainCanvas ? ctx.createPattern(grainCanvas, 'repeat') : null
  if (!pattern) return
  ctx.save()
  ctx.fillStyle = pattern
  ctx.fillRect(0, 0, W, H)
  ctx.restore()
}
