/** The single canonical public site identity used by links, stories and calendars. */
export const SITE_ORIGIN = 'https://trneventsnepal.com.np'
export const SITE_DOMAIN = 'trneventsnepal.com.np'

export function siteEventUrl(event: { id: string }) {
  return `${SITE_ORIGIN}/event/${event.id}`
}
