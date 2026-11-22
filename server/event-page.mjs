const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ENTITIES[character])
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim()
const absolute = (value, origin) => {
  if (!value) return ''
  try { return new URL(value, origin).toString() } catch { return '' }
}

function shorten(value, limit = 200) {
  const text = clean(value)
  if (text.length <= limit) return text
  const cut = text.slice(0, limit)
  const space = cut.lastIndexOf(' ')
  return `${(space > limit * .55 ? cut.slice(0, space) : cut).replace(/[.,;:!?-]+$/, '')}…`
}

export function eventPageData(event, origin) {
  const image = absolute(event.imageUrl, origin)
  const url = `${origin}/event/${event.id}`
  const location = event.type === 'tour'
    ? [...new Set((event.stops || []).map(stop => clean(stop.location)).filter(Boolean))].slice(0, 3).join(' · ')
    : clean(event.location)
  const source = clean(event.description) || clean(event.organizerMessage)
  const fallback = `${event.name}${event.artist ? ` with ${event.artist}` : ''} live${location ? ` at ${location}` : ''}. Event details, dates and story sharing from TRN Events Nepal.`
  // Short notes such as a booking URL do not make a useful social preview.
  const description = shorten(source.length >= 80 ? source : fallback)
  return {
    title: `${clean(event.name) || 'Live event'} | TRN Events Nepal`,
    description,
    image,
    url,
    location,
    artist: clean(event.artist),
    date: clean(event.date) || clean((event.stops || []).find(stop => stop.date)?.date),
  }
}

export function applyEventMeta(html, { event, origin }) {
  const data = eventPageData(event, origin)
  const tags = [
    `<title>${escapeHtml(data.title)}</title>`,
    `<meta name="description" content="${escapeHtml(data.description)}" />`,
    `<link rel="canonical" href="${escapeHtml(data.url)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="TRN Events Nepal" />`,
    `<meta property="og:title" content="${escapeHtml(data.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(data.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(data.url)}" />`,
    data.image ? `<meta property="og:image" content="${escapeHtml(data.image)}" />` : '',
    data.image ? `<meta property="og:image:alt" content="${escapeHtml(`${event.name} event poster`)}" />` : '',
    `<meta name="twitter:card" content="${data.image ? 'summary_large_image' : 'summary'}" />`,
    `<meta name="twitter:title" content="${escapeHtml(data.title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(data.description)}" />`,
    data.image ? `<meta name="twitter:image" content="${escapeHtml(data.image)}" />` : '',
    eventJsonLd(event, origin, data),
  ].filter(Boolean).join('\n    ')

  return html
    .replace(/<title>[\s\S]*?<\/title>/gi, '')
    .replace(/<meta\s+name=["']description["'][^>]*>/gi, '')
    .replace(/<link\s+rel=["']canonical["'][^>]*>/gi, '')
    .replace(/<meta\s+property=["']og:[^"']+["'][^>]*>/gi, '')
    .replace(/<meta\s+name=["']twitter:[^"']+["'][^>]*>/gi, '')
    .replace('</head>', `  ${tags}\n  </head>`)
}

function eventJsonLd(event, origin, data) {
  const payload = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: clean(event.name),
    description: data.description,
    url: data.url,
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    eventStatus: 'https://schema.org/EventScheduled',
    ...(data.date ? { startDate: data.date } : {}),
    ...(data.image ? { image: [data.image] } : {}),
    location: {
      '@type': 'Place',
      name: data.location || 'TRN Events Nepal',
    },
    organizer: {
      '@type': 'Organization',
      name: clean(event.organizer) || 'TRN Events Nepal',
      url: origin,
    },
  }
  const json = JSON.stringify(payload).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
  return `<script type="application/ld+json">${json}</script>`
}

export function renderEventNotFound(origin) {
  const home = escapeHtml(`${origin}/`)
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex" />
    <meta name="theme-color" content="#171717" />
    <title>Event not found | TRN Events Nepal</title>
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100svh; display: grid; place-items: center; padding: 24px; background: #0b0c0b; color: #f4f4f4; font-family: "Work Sans", ui-sans-serif, system-ui, sans-serif; }
      main { width: min(520px, 100%); padding: 38px 30px; border: 1px solid rgb(255 255 255 / 12%); border-radius: 20px; background: #141514; text-align: center; }
      img { width: 88px; height: 88px; object-fit: contain; margin: 0 auto 20px; }
      p { color: rgb(244 244 244 / 62%); line-height: 1.6; }
      a { display: inline-flex; margin-top: 18px; padding: 13px 20px; border-radius: 999px; background: #d7193f; color: #fff; font-weight: 600; text-decoration: none; }
    </style>
  </head>
  <body>
    <main>
      <img src="/logo.png" alt="TRN Events Nepal" />
      <h1>This event is no longer available.</h1>
      <p>It may have been removed, unpublished, or the link may be incomplete. Explore the latest TRN events instead.</p>
      <a href="${home}">Back to events</a>
    </main>
  </body>
</html>`
}
