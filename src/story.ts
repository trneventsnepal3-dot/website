import type { LiveEvent } from './events'
import { eventDateLabel } from './events'

export type StoryTemplateId = 'cinema' | 'spotlight' | 'editorial'

export type StoryTemplate = {
  id: StoryTemplateId
  name: string
  note: string
  accent: string
}

export const STORY_WIDTH = 1080
export const STORY_HEIGHT = 1920

export const STORY_TEMPLATES: StoryTemplate[] = [
  { id: 'cinema', name: 'Cinema', note: 'Framed poster, dramatic light', accent: '#d7193f' },
  { id: 'spotlight', name: 'Spotlight', note: 'Full-bleed poster, bold type', accent: '#ff5c6c' },
  { id: 'editorial', name: 'Editorial', note: 'Centred, warm and minimal', accent: '#e8c28a' },
]

export type StoryData = {
  name: string
  artist: string
  date: string
  venue: string
  category: string
  eventNumber: string
  host: string
  isPast: boolean
  showCount: number
}

const clean = (value?: string | null) => (value || '').replace(/\s+/g, ' ').trim()

/** The official public domain printed on every generated story. */
const STORY_WEBSITE = 'trneventsnepal.com.np'

export function storyData(event: LiveEvent): StoryData {
  const stops = event.stops || []
  // Tour stops often include the venue after a dash. A story reads better with
  // the city first and the full venue list left to the event page.
  const city = (value?: string) => clean(value).split(/\s+[–-]\s+|,\s*/)[0].trim()
  const places = [...new Set(stops.map(stop => city(stop.location)).filter(Boolean))]
  const venue = event.type === 'tour'
    ? [places.slice(0, 2).join(' · '), stops.length > 2 ? `${stops.length} shows` : ''].filter(Boolean).join(' · ')
    : clean(event.location)
  return {
    name: clean(event.name) || 'Live event',
    artist: clean(event.artist),
    date: eventDateLabel(event),
    venue,
    category: event.type === 'tour' ? `TOUR${stops.length ? ` · ${stops.length} SHOWS` : ''}` : 'LIVE CONCERT',
    eventNumber: clean(event.eventNumber),
    host: STORY_WEBSITE,
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
      // by a plain <img> without CORS headers. `reload` asks storage for a fresh
      // response that includes its Access-Control-Allow-Origin header.
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

export async function buildStoryCanvas(event: LiveEvent, templateId: StoryTemplateId) {
  const [poster, logo] = await Promise.all([
    loadStoryImage(event.imageUrl),
    loadStoryImage('/logo.png'),
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
  drawStory(context, storyData(event), template, poster, logo)
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
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

const W = STORY_WIDTH
const H = STORY_HEIGHT
const LEFT = 88
const RIGHT = 992
const WIDTH = RIGHT - LEFT
const TOP = 150
const WHITE = '#f7f4ef'
const MUTED = 'rgba(247, 244, 239, .62)'
const FAINT = 'rgba(247, 244, 239, .16)'
const BG = '#070808'

type Rect = { x: number; y: number; w: number; h: number }
type Align = 'left' | 'center' | 'right'

function drawStory(
  ctx: CanvasRenderingContext2D,
  data: StoryData,
  template: StoryTemplate,
  poster: HTMLImageElement | null,
  logo: HTMLImageElement | null,
) {
  if (template.id === 'spotlight') drawSpotlight(ctx, data, template, poster, logo)
  else if (template.id === 'editorial') drawEditorial(ctx, data, template, poster, logo)
  else drawCinema(ctx, data, template, poster, logo)
  drawGrain(ctx)
}

function drawCinema(
  ctx: CanvasRenderingContext2D,
  data: StoryData,
  template: StoryTemplate,
  poster: HTMLImageElement | null,
  logo: HTMLImageElement | null,
) {
  paintBackdrop(ctx, poster, template.accent, 0.32)
  drawBrand(ctx, logo)
  drawPosterCard(ctx, poster, LEFT, 294, WIDTH, 820, 30, template.accent, 'rgba(255,255,255,.15)')

  let titleTop = 1158
  if (data.eventNumber) {
    setFont(ctx, 11, 700)
    ctx.fillStyle = MUTED
    drawTracked(ctx, `EVENT NO. ${data.eventNumber}`.toUpperCase(), LEFT, 1162, 2.4)
    titleTop = 1188
  }
  const title = drawTitle(ctx, data.name, LEFT, titleTop, WIDTH, 94, 54, 3, data.eventNumber ? 184 : 216, 'left')
  let next = title.bottom
  if (data.artist) {
    drawArtist(ctx, data.artist, LEFT, next + 40, template.accent)
    next += 40
  }
  const divider = Math.min(next + 36, 1478)
  ctx.strokeStyle = FAINT
  ctx.lineWidth = 1
  line(ctx, LEFT, divider, RIGHT, divider)

  const detailTop = divider + 42
  const dateText = /\s+[–-]\s+/.test(data.date) && data.date.length > 24
    ? data.date.replace(/\s+[–-]\s+/, '\n')
    : data.date
  drawDetailBlock(ctx, 'DATE', dateText, LEFT, detailTop, 408, template.accent, 36, 'Koulen')
  drawDetailBlock(ctx, 'WHERE', data.venue, 552, detailTop, 440, template.accent, 23, 'text')
  drawFooter(ctx, data.host, template.accent, 'left')
}

function drawSpotlight(
  ctx: CanvasRenderingContext2D,
  data: StoryData,
  template: StoryTemplate,
  poster: HTMLImageElement | null,
  logo: HTMLImageElement | null,
) {
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, W, H)
  if (poster) {
    drawCover(ctx, poster, 0, 0, W, H)
    ctx.fillStyle = 'rgba(4, 5, 6, .22)'
    ctx.fillRect(0, 0, W, H)
  } else {
    const fallback = ctx.createLinearGradient(0, 0, W, H)
    fallback.addColorStop(0, '#211016')
    fallback.addColorStop(.55, '#0c0b0c')
    fallback.addColorStop(1, '#1b1210')
    ctx.fillStyle = fallback
    ctx.fillRect(0, 0, W, H)
  }

  const top = ctx.createLinearGradient(0, 0, 0, 640)
  top.addColorStop(0, 'rgba(0,0,0,.86)')
  top.addColorStop(.55, 'rgba(0,0,0,.34)')
  top.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = top
  ctx.fillRect(0, 0, W, 640)

  const bottom = ctx.createLinearGradient(0, 860, 0, H)
  bottom.addColorStop(0, 'rgba(0,0,0,0)')
  bottom.addColorStop(.42, 'rgba(3,3,4,.72)')
  bottom.addColorStop(.72, 'rgba(3,3,4,.95)')
  bottom.addColorStop(1, 'rgba(3,3,4,.99)')
  ctx.fillStyle = bottom
  ctx.fillRect(0, 860, W, H - 860)

  const vignette = ctx.createRadialGradient(W / 2, H * .46, W * .28, W / 2, H * .52, H * .72)
  vignette.addColorStop(0, 'rgba(0,0,0,0)')
  vignette.addColorStop(1, 'rgba(0,0,0,.48)')
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, W, H)

  drawBrand(ctx, logo)

  const barTop = 1138
  ctx.fillStyle = template.accent
  ctx.fillRect(LEFT, barTop, 4, 6)
  ctx.fillRect(LEFT, barTop + 6, 4, 44)

  const titleTop = 1190
  const title = drawTitle(ctx, data.name, LEFT + 26, titleTop, WIDTH - 26, 112, 58, 3, 208, 'left')
  let next = title.bottom
  if (data.artist) {
    drawArtist(ctx, data.artist, LEFT + 26, next + 40, template.accent)
    next += 40
  }

  const metaTop = Math.min(next + 48, 1478)
  ctx.fillStyle = template.accent
  ctx.beginPath()
  ctx.arc(LEFT + 32, metaTop - 11, 5, 0, Math.PI * 2)
  ctx.fill()
  setFont(ctx, 34, 400)
  ctx.fillStyle = WHITE
  ctx.fillText(data.date.toUpperCase(), LEFT + 52, metaTop)

  if (data.venue) {
    setFont(ctx, 23, 500, true)
    ctx.fillStyle = MUTED
    const wrapped = wrapText(ctx, data.venue, WIDTH - 84, 2)
    wrapped.lines.forEach((value, index) => ctx.fillText(value, LEFT + 52, metaTop + 44 + index * 30))
  }
  drawFooter(ctx, data.host, template.accent, 'left')
}

function drawEditorial(
  ctx: CanvasRenderingContext2D,
  data: StoryData,
  template: StoryTemplate,
  poster: HTMLImageElement | null,
  logo: HTMLImageElement | null,
) {
  ctx.fillStyle = '#0b0a09'
  ctx.fillRect(0, 0, W, H)

  radial(ctx, W / 2, 720, 690, 'rgba(232, 194, 138, .12)', 'rgba(232, 194, 138, 0)')
  radial(ctx, W / 2, 1580, 620, 'rgba(215, 25, 63, .08)', 'rgba(215, 25, 63, 0)')

  ctx.save()
  ctx.strokeStyle = 'rgba(247, 244, 239, .035)'
  ctx.lineWidth = 1
  for (let y = 260; y < H; y += 76) line(ctx, LEFT, y, RIGHT, y)
  ctx.restore()

  drawBrand(ctx, logo)

  drawPosterCard(ctx, poster, 140, 292, 800, 772, 22, template.accent, 'rgba(232, 194, 138, .46)')

  let titleTop = 1124
  if (data.eventNumber) {
    setFont(ctx, 11, 700)
    ctx.fillStyle = template.accent
    ctx.textAlign = 'center'
    drawTracked(ctx, `EVENT NO. ${data.eventNumber}`.toUpperCase(), W / 2, 1116, 2.7)
    titleTop = 1150
  }

  const title = drawTitle(ctx, data.name, LEFT, titleTop, WIDTH, 88, 50, 3, 204, 'center')
  const ruleY = title.bottom + 38
  ctx.strokeStyle = 'rgba(232, 194, 138, .45)'
  ctx.lineWidth = 1
  line(ctx, W / 2 - 132, ruleY, W / 2 - 24, ruleY)
  line(ctx, W / 2 + 24, ruleY, W / 2 + 132, ruleY)
  ctx.save()
  ctx.translate(W / 2, ruleY)
  ctx.rotate(Math.PI / 4)
  ctx.fillStyle = template.accent
  ctx.fillRect(-4, -4, 8, 8)
  ctx.restore()

  ctx.textAlign = 'center'
  setFont(ctx, 38, 400)
  ctx.fillStyle = WHITE
  ctx.fillText(data.date.toUpperCase(), W / 2, ruleY + 58)

  let metaY = ruleY + 104
  if (data.artist) {
    setFont(ctx, 25, 500, true)
    ctx.fillStyle = 'rgba(247, 244, 239, .78)'
    ctx.fillText(fitLine(ctx, data.artist, WIDTH), W / 2, metaY)
    metaY += 38
  }
  if (data.venue) {
    setFont(ctx, 20, 500, true)
    ctx.fillStyle = MUTED
    const venue = wrapText(ctx, data.venue, WIDTH - 120, 2)
    venue.lines.forEach((value, index) => ctx.fillText(value, W / 2, metaY + index * 27))
  }

  drawFooter(ctx, data.host, template.accent, 'center')
}

/* ------------------------------------------------------------------ */
/* Shared drawing helpers                                              */
/* ------------------------------------------------------------------ */

function setFont(ctx: CanvasRenderingContext2D, size: number, weight = 400, text = false) {
  ctx.font = `${weight} ${size}px ${text ? '"Work Sans Variable", "Work Sans", sans-serif' : 'Koulen, Impact, sans-serif'}`
}

function paintBackdrop(ctx: CanvasRenderingContext2D, poster: HTMLImageElement | null, accent: string, opacity: number) {
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, W, H)
  if (poster) {
    const small = document.createElement('canvas')
    small.width = 270
    small.height = 480
    const smallContext = small.getContext('2d')
    if (smallContext) {
      drawCover(smallContext, poster, 0, 0, 270, 480)
      ctx.save()
      ctx.globalAlpha = opacity
      ctx.drawImage(small, -40, -50, W + 80, H + 100)
      ctx.restore()
    }
    ctx.fillStyle = 'rgba(4, 5, 5, .68)'
    ctx.fillRect(0, 0, W, H)
  }
  radial(ctx, W * .5, 640, 720, hex(accent, .22), hex(accent, 0))
  radial(ctx, W * .84, 1330, 620, 'rgba(255, 166, 95, .10)', 'rgba(255, 166, 95, 0)')

  const bottom = ctx.createLinearGradient(0, 780, 0, H)
  bottom.addColorStop(0, 'rgba(3, 3, 4, 0)')
  bottom.addColorStop(.55, 'rgba(3, 3, 4, .58)')
  bottom.addColorStop(1, 'rgba(3, 3, 4, .94)')
  ctx.fillStyle = bottom
  ctx.fillRect(0, 780, W, H - 780)

  const vignette = ctx.createRadialGradient(W / 2, H * .45, W * .25, W / 2, H * .5, H * .72)
  vignette.addColorStop(0, 'rgba(0,0,0,0)')
  vignette.addColorStop(1, 'rgba(0,0,0,.5)')
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, W, H)
}

function drawBrand(ctx: CanvasRenderingContext2D, logo: HTMLImageElement | null) {
  if (!logo) return
  // Keep the source artwork's proportions and transparency intact.
  const fit = contain(logo, LEFT, TOP, 104, 104)
  ctx.save()
  ctx.globalAlpha = 1
  ctx.drawImage(logo, fit.x, fit.y, fit.w, fit.h)
  ctx.restore()
}

function drawPosterCard(
  ctx: CanvasRenderingContext2D,
  poster: HTMLImageElement | null,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  accent: string,
  border: string,
) {
  ctx.save()
  roundRect(ctx, x, y, w, h, radius)
  ctx.clip()
  if (poster) {
    ctx.save()
    ctx.globalAlpha = .92
    drawCover(ctx, poster, x, y, w, h)
    ctx.restore()
    ctx.fillStyle = 'rgba(5, 5, 6, .54)'
    ctx.fillRect(x, y, w, h)

    const fit = contain(poster, x, y, w, h)
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,.7)'
    ctx.shadowBlur = 54
    ctx.shadowOffsetY = 20
    ctx.drawImage(poster, fit.x, fit.y, fit.w, fit.h)
    ctx.restore()
  } else {
    const fallback = ctx.createLinearGradient(x, y, x + w, y + h)
    fallback.addColorStop(0, hex(accent, .38))
    fallback.addColorStop(.52, '#191715')
    fallback.addColorStop(1, '#08090a')
    ctx.fillStyle = fallback
    ctx.fillRect(x, y, w, h)
    setFont(ctx, 56, 400)
    ctx.fillStyle = 'rgba(255,255,255,.2)'
    ctx.textAlign = 'center'
    ctx.fillText('TRN', x + w / 2, y + h / 2)
    ctx.textAlign = 'left'
  }

  const fade = ctx.createLinearGradient(0, y + h * .66, 0, y + h)
  fade.addColorStop(0, 'rgba(0,0,0,0)')
  fade.addColorStop(1, 'rgba(0,0,0,.3)')
  ctx.fillStyle = fade
  ctx.fillRect(x, y + h * .66, w, h * .34)
  ctx.restore()

  ctx.save()
  roundRect(ctx, x + .75, y + .75, w - 1.5, h - 1.5, radius)
  ctx.strokeStyle = border
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.restore()
}

function drawArtist(ctx: CanvasRenderingContext2D, artist: string, x: number, y: number, accent: string) {
  ctx.fillStyle = accent
  ctx.beginPath()
  ctx.arc(x + 4, y - 10, 4, 0, Math.PI * 2)
  ctx.fill()
  setFont(ctx, 28, 500, true)
  ctx.fillStyle = 'rgba(247, 244, 239, .8)'
  ctx.textAlign = 'left'
  ctx.fillText(fitLine(ctx, artist, WIDTH - 24), x + 20, y)
}

function drawDetailBlock(
  ctx: CanvasRenderingContext2D,
  label: string,
  value: string,
  x: number,
  y: number,
  width: number,
  accent: string,
  size: number,
  family: 'Koulen' | 'text',
) {
  if (!value) return
  setFont(ctx, 10, 700, true)
  ctx.fillStyle = accent
  drawTracked(ctx, label, x, y, 2.6)
  const text = family === 'Koulen' ? value.toUpperCase() : value
  setFont(ctx, size, family === 'Koulen' ? 400 : 500, family === 'text')
  ctx.fillStyle = family === 'Koulen' ? WHITE : MUTED
  const paragraphs = text.split(/\n+/).map(part => part.trim()).filter(Boolean)
  const lines = (paragraphs.length > 1
    ? paragraphs.flatMap(part => wrapText(ctx, part, width, 1).lines)
    : wrapText(ctx, text, width, 2).lines
  ).slice(0, 2)
  lines.forEach((line, index) => {
    ctx.textAlign = 'left'
    ctx.fillText(line, x, y + 36 + index * (family === 'Koulen' ? size * .96 : size * 1.28))
  })
}

function drawFooter(ctx: CanvasRenderingContext2D, host: string, accent: string, align: Align) {
  // Keep the call to action above the platform's bottom Story controls.
  const y = 1610
  ctx.textAlign = align
  const x = align === 'center' ? W / 2 : align === 'right' ? RIGHT : LEFT
  if (align === 'center') {
    ctx.fillStyle = accent
    ctx.fillRect(W / 2 - 22, y - 34, 44, 3)
  } else {
    ctx.fillStyle = accent
    ctx.fillRect(LEFT, y - 32, 36, 3)
  }
  setFont(ctx, 28, 600, true)
  ctx.fillStyle = WHITE
  ctx.fillText(host, x, y)
  setFont(ctx, 11, 700, true)
  ctx.fillStyle = MUTED
  if (align === 'center') {
    drawTrackedCentred(ctx, 'TAP TO EXPLORE EVENT', W / 2, y + 28, 2.3)
  } else {
    drawTracked(ctx, 'TAP TO EXPLORE EVENT', x, y + 28, 2.3)
  }
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
  ctx.shadowColor = 'rgba(0,0,0,.4)'
  ctx.shadowBlur = 24
  ctx.shadowOffsetY = 4
  lines.forEach((line, index) => ctx.fillText(line, drawX, baseline + index * lineHeight))
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.shadowOffsetY = 0
  ctx.textAlign = 'left'
  return { bottom: y + Math.max(lines.length, 1) * lineHeight, size, lines }
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
  const width = trackedWidth(ctx, text, spacing)
  drawTracked(ctx, text, centre - width / 2, y, spacing)
}

function trackedWidth(ctx: CanvasRenderingContext2D, text: string, spacing: number) {
  let width = 0
  for (const character of text) width += ctx.measureText(character).width + spacing
  return Math.max(0, width - spacing)
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

function drawCover(ctx: CanvasRenderingContext2D, image: CanvasImageSource, x: number, y: number, w: number, h: number) {
  const source = imageSize(image)
  if (!source.width || !source.height) return
  const scale = Math.max(w / source.width, h / source.height)
  const drawW = source.width * scale
  const drawH = source.height * scale
  ctx.drawImage(image, x + (w - drawW) / 2, y + (h - drawH) / 2, drawW, drawH)
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
        pixels.data[index + 3] = 16
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
