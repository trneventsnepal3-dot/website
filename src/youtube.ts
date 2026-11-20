const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/
const YOUTUBE_HOSTS = new Set(['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com'])

/** Extracts a YouTube video ID from the common share/watch/embed URL formats. */
export function youtubeVideoId(value?: string | null): string | null {
  const raw = value?.trim()
  if (!raw) return null

  try {
    const url = new URL(raw)
    const host = url.hostname.replace(/^www\./, '').toLowerCase()
    let candidate: string | null = null

    if (host === 'youtu.be') candidate = url.pathname.split('/').filter(Boolean)[0] || null
    else if (YOUTUBE_HOSTS.has(host)) {
      candidate = url.searchParams.get('v')
        || /^\/(?:embed|shorts|live|v)\/([^/?#]+)/.exec(url.pathname)?.[1]
        || null
    }

    return candidate && YOUTUBE_ID.test(candidate) ? candidate : null
  } catch {
    // Also accept a bare 11-character video ID, which admins may paste directly.
    return YOUTUBE_ID.test(raw) ? raw : null
  }
}

export function youtubeThumbnail(id: string): string {
  return `https://i.ytimg.com/vi/${id}/mqdefault.jpg`
}

export function youtubeEmbed(id: string): string {
  return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&modestbranding=1&playsinline=1`
}
