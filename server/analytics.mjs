import { createHash } from 'node:crypto';
import { z } from 'zod';

export const TIMEZONE = 'Asia/Kathmandu';
const LIVE_WINDOW_MINUTES = 5;
const GEO_CACHE_MS = 6 * 60 * 60 * 1000;
const GEO_CACHE_LIMIT = 2000;
const READY_CACHE_MS = 30_000;

const BOT_UA = /bot|crawler|spider|crawling|slurp|bingpreview|facebookexternalhit|whatsapp|telegrambot|discordbot|linkedinbot|pinterestbot|embedly|outbrain|w3c_validator|lighthouse|pagespeed|gtmetrix|pingdom|uptime|headlesschrome|phantomjs|python-requests|python-urllib|curl\/|wget\/|go-http-client|node-fetch|axios\//i;
const PRIVATE_IP = /^(?:::1|f[cd][0-9a-f]{2}:|fe80:)/i;
const MISSING_TABLE = /does not exist|could not find|PGRST20[25]|relation .* does not exist|function .* does not exist/i;

const SEARCH_HOSTS = [
  ['google.', 'Google'],
  ['bing.', 'Bing'],
  ['search.yahoo', 'Yahoo'],
  ['duckduckgo.', 'DuckDuckGo'],
  ['yandex.', 'Yandex'],
  ['baidu.', 'Baidu'],
  ['ecosia.', 'Ecosia'],
  ['brave.com', 'Brave Search'],
  ['qwant.', 'Qwant'],
];
const SOCIAL_HOSTS = [
  ['instagram.', 'Instagram'],
  ['facebook.', 'Facebook'],
  ['fb.me', 'Facebook'],
  ['tiktok.', 'TikTok'],
  ['twitter.', 'X (Twitter)'],
  ['x.com', 'X (Twitter)'],
  ['t.co', 'X (Twitter)'],
  ['linkedin.', 'LinkedIn'],
  ['youtube.', 'YouTube'],
  ['youtu.be', 'YouTube'],
  ['pinterest.', 'Pinterest'],
  ['reddit.', 'Reddit'],
  ['snapchat.', 'Snapchat'],
  ['threads.', 'Threads'],
];
const UTM_LABELS = {
  ig: 'Instagram', instagram: 'Instagram',
  fb: 'Facebook', facebook: 'Facebook', meta: 'Facebook',
  tiktok: 'TikTok',
  google: 'Google',
  youtube: 'YouTube',
  twitter: 'X (Twitter)', x: 'X (Twitter)',
  linkedin: 'LinkedIn',
  newsletter: 'Newsletter', email: 'Email',
  whatsapp: 'WhatsApp',
};

const trackSchema = z.object({
  kind: z.enum(['pageview', 'heartbeat']).default('pageview'),
  visitorId: z.uuid(),
  sessionId: z.uuid(),
  viewKey: z.uuid().nullish(),
  path: z.string().trim().min(1).max(500),
  title: z.string().trim().max(300).default(''),
  referrer: z.string().trim().max(1000).default(''),
  utm: z.object({
    source: z.string().trim().max(120).optional(),
    medium: z.string().trim().max(120).optional(),
    campaign: z.string().trim().max(120).optional(),
    content: z.string().trim().max(120).optional(),
    term: z.string().trim().max(120).optional(),
  }).optional(),
  activeSeconds: z.number().int().min(0).max(43_200).default(0),
});

const geoCache = new Map();
const rateHits = new Map();

const httpError = (status, message, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
const notInstalled = () => httpError(
  503,
  'Website analytics is not installed in this database yet. Run server/analytics.sql in the Supabase SQL Editor, then reload this page.',
  'analytics_not_installed',
);

function clean(value, limit = 120) {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/\s+/g, ' ');
  return text ? text.slice(0, limit) : null;
}

function countryName(code) {
  if (!code) return null;
  try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || code; } catch { return code; }
}

function normalizeGeo(value) {
  if (!value) return null;
  const code = clean(value.countryCode, 8);
  const upper = code && /^[A-Za-z]{2}$/.test(code) ? code.toUpperCase() : null;
  const geo = {
    country: clean(value.country) || (upper ? countryName(upper) : null),
    countryCode: upper,
    region: clean(value.region),
    city: clean(value.city),
  };
  return geo.country || geo.countryCode || geo.city ? geo : null;
}

export function isBot(userAgent) {
  return !userAgent || BOT_UA.test(userAgent);
}

export function parseUserAgent(userAgent) {
  const ua = String(userAgent || '');
  const device = /iPad|Tablet|PlayBook|Silk|Android(?!.*Mobile)/i.test(ua)
    ? 'tablet'
    : /Mobi|Android|iPhone|iPod|Windows Phone|BlackBerry|Opera Mini|IEMobile/i.test(ua)
      ? 'mobile'
      : 'desktop';
  let browser = 'Other';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera';
  else if (/SamsungBrowser/i.test(ua)) browser = 'Samsung Internet';
  else if (/Firefox\/|FxiOS/i.test(ua)) browser = 'Firefox';
  else if (/CriOS|Chrome\//i.test(ua)) browser = 'Chrome';
  else if (/Safari\//i.test(ua)) browser = 'Safari';
  else if (/MSIE|Trident/i.test(ua)) browser = 'Internet Explorer';
  let os = 'Other';
  if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/CrOS/i.test(ua)) os = 'ChromeOS';
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS';
  else if (/Linux/i.test(ua)) os = 'Linux';
  return { device, browser, os };
}

export function referrerSource(referrer, utmSource, ownHost = '') {
  const utm = clean(utmSource, 120);
  if (utm) {
    const key = utm.toLowerCase();
    return UTM_LABELS[key] || key.replace(/[-_]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase()).slice(0, 120);
  }
  if (!referrer) return 'Direct';
  let url;
  try { url = new URL(referrer); } catch { return 'Other referral'; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'Direct';
  const host = url.hostname.replace(/^www\./i, '').toLowerCase();
  const own = String(ownHost || '').split(':')[0].replace(/^www\./i, '').toLowerCase();
  if (own && (host === own || host.endsWith(`.${own}`) || own.endsWith(`.${host}`))) return 'Direct';
  for (const [needle, label] of SEARCH_HOSTS) if (host.includes(needle)) return label;
  for (const [needle, label] of SOCIAL_HOSTS) if (host.includes(needle)) return label;
  return host.slice(0, 120) || 'Other referral';
}

export function cleanReferrer(value) {
  const raw = String(value || '').slice(0, 1000);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    // Keep only the origin and path: referral queries can contain search terms
    // or identifiers that nobody needs for traffic-source reporting.
    return `${url.origin}${url.pathname}`.slice(0, 1000);
  } catch {
    return '';
  }
}

export function cleanPath(value) {
  const raw = String(value || '/').slice(0, 500);
  try {
    const url = new URL(raw, 'https://analytics.local');
    for (const key of [...url.searchParams.keys()]) {
      if (/pass|token|secret|email|auth|key/i.test(key)) url.searchParams.delete(key);
    }
    const search = url.searchParams.toString();
    return `${url.pathname}${search ? `?${search}` : ''}${url.hash}`.slice(0, 500) || '/';
  } catch {
    return raw || '/';
  }
}

function clientIp(req) {
  const raw = String(
    req.headers['x-vercel-forwarded-for']
    || req.headers['x-forwarded-for']
    || req.headers['x-real-ip']
    || req.socket?.remoteAddress
    || '',
  ).split(',')[0].trim();
  return raw.replace(/^::ffff:/i, '');
}

function privateIp(ip) {
  if (!ip || PRIVATE_IP.test(ip) || !ip.includes('.')) return true;
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  return parts[0] === 0
    || parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
}

const geoHeaders = { accept: 'application/json', 'user-agent': 'TRN-Events-Analytics/1.0' };

async function fetchJson(url, env, fetcher) {
  const timeout = Math.max(500, Math.min(Number(env.ANALYTICS_GEO_TIMEOUT_MS || 2000), 8000));
  const response = await fetcher(url, {
    signal: AbortSignal.timeout(timeout),
    headers: geoHeaders,
  });
  if (!response.ok) return null;
  try { return await response.json(); } catch { return null; }
}

async function lookupGeo(ip, env = process.env, fetcher = fetch) {
  if (privateIp(ip)) return null;
  const preferred = String(env.ANALYTICS_GEO_PROVIDER || '').toLowerCase();
  const providers = [];
  if (env.IPINFO_TOKEN) providers.push('ipinfo');
  if (preferred === 'ipapi') providers.push('ipapi');
  if (!providers.includes('ipwhois')) providers.push('ipwhois');

  for (const provider of providers) {
    try {
      if (provider === 'ipinfo') {
        const data = await fetchJson(`https://ipinfo.io/${encodeURIComponent(ip)}/json?token=${encodeURIComponent(env.IPINFO_TOKEN)}`, env, fetcher);
        if (data && !data.bogon && (data.country || data.city)) {
          return normalizeGeo({
            country: data.country_name || countryName(data.country),
            countryCode: data.country,
            region: data.region,
            city: data.city,
          });
        }
      } else if (provider === 'ipapi') {
        const data = await fetchJson(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, env, fetcher);
        if (data && !data.error && (data.country_code || data.city)) {
          return normalizeGeo({
            country: data.country_name,
            countryCode: data.country_code,
            region: data.region,
            city: data.city,
          });
        }
      } else {
        const data = await fetchJson(`https://ipwho.is/${encodeURIComponent(ip)}`, env, fetcher);
        if (data && data.success !== false && (data.country_code || data.city)) {
          return normalizeGeo({
            country: data.country,
            countryCode: data.country_code,
            region: data.region,
            city: data.city,
          });
        }
      }
    } catch { /* Try the next provider without logging the visitor's IP. */ }
  }
  return null;
}

async function cachedGeo(ip, env, fetcher) {
  if (privateIp(ip)) return null;
  const key = createHash('sha256').update(ip).digest('hex');
  const hit = geoCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await lookupGeo(ip, env, fetcher);
  if (geoCache.size >= GEO_CACHE_LIMIT) geoCache.delete(geoCache.keys().next().value);
  geoCache.set(key, { value, expires: Date.now() + GEO_CACHE_MS });
  return value;
}

function rateLimited(key, limit) {
  const now = Date.now();
  const hit = rateHits.get(key);
  if (!hit || hit.reset <= now) {
    if (rateHits.size > 5000) rateHits.clear();
    rateHits.set(key, { count: 1, reset: now + 60_000 });
    return false;
  }
  hit.count += 1;
  return hit.count > limit;
}

export function resolveRange(params, now = Date.now(), timezone = TIMEZONE) {
  const preset = String(params.get('range') || '7d').toLowerCase();
  const to = new Date(now).toISOString();
  if (preset === 'all') {
    return { preset, label: 'All time', from: null, to, timezone, granularity: 'auto' };
  }
  if (preset === 'custom') {
    const fromText = String(params.get('from') || '');
    const toText = String(params.get('to') || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromText) || !/^\d{4}-\d{2}-\d{2}$/.test(toText)) {
      throw httpError(400, 'Choose a valid start and end date.');
    }
    const from = Date.parse(`${fromText}T00:00:00.000Z`);
    const end = Date.parse(`${toText}T23:59:59.999Z`);
    if (!Number.isFinite(from) || !Number.isFinite(end)) throw httpError(400, 'Choose a valid start and end date.');
    if (from > end) throw httpError(400, 'The start date must be before the end date.');
    return {
      preset,
      label: `${fromText} to ${toText}`,
      from: new Date(from).toISOString(),
      to: new Date(end).toISOString(),
      timezone,
      granularity: 'auto',
    };
  }
  const hours = { '24h': 24, '7d': 24 * 7, '30d': 24 * 30, '90d': 24 * 90 }[preset] || 24 * 7;
  const labels = { '24h': 'Last 24 hours', '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days' };
  return {
    preset: labels[preset] ? preset : '7d',
    label: labels[preset] || labels['7d'],
    from: new Date(now - hours * 3_600_000).toISOString(),
    to,
    timezone,
    granularity: preset === '24h' ? 'hour' : preset === '90d' ? 'week' : 'day',
  };
}

export function createAnalytics(db, env = process.env, options = {}) {
  const geolocate = options.geolocate || ((ip) => cachedGeo(ip, env, options.fetch || fetch));
  const timezone = env.ANALYTICS_TIMEZONE || TIMEZONE;
  let ready = { value: null, at: 0 };

  async function isReady(force = false) {
    if (!force && ready.value !== null && Date.now() - ready.at < READY_CACHE_MS) return ready.value;
    try {
      const [row] = await db('SELECT analytics_ready() AS ready');
      ready = { value: Boolean(row?.ready), at: Date.now() };
    } catch (error) {
      if (!MISSING_TABLE.test(error.message || '')) throw error;
      ready = { value: false, at: Date.now() };
    }
    return ready.value;
  }

  async function track(req, body) {
    const userAgent = String(req.headers['user-agent'] || '');
    if (isBot(userAgent)) return { ignored: true, reason: 'bot', onlineWindowMinutes: LIVE_WINDOW_MINUTES };

    const parsed = trackSchema.safeParse(body);
    if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message || 'Invalid analytics event.');
    const event = parsed.data;
    if (/^\/admin(?:[/?#]|$)/i.test(event.path)) return { ignored: true, reason: 'admin', onlineWindowMinutes: LIVE_WINDOW_MINUTES };
    if (event.kind === 'pageview' && !event.viewKey) throw httpError(400, 'A page view needs a unique view key.');
    if (!(await isReady())) throw notInstalled();

    const ip = clientIp(req);
    const ipKey = ip ? createHash('sha256').update(ip).digest('hex') : 'unknown';
    if (rateLimited(`v:${event.visitorId}`, 90) || rateLimited(`i:${ipKey}`, 300)) {
      return { ignored: true, reason: 'rate', onlineWindowMinutes: LIVE_WINDOW_MINUTES };
    }

    const location = await geolocate(ip);
    const device = parseUserAgent(userAgent);
    const payload = {
      kind: event.kind,
      visitorId: event.visitorId,
      sessionId: event.sessionId,
      viewKey: event.viewKey || null,
      path: cleanPath(event.path),
      title: event.title,
      referrer: cleanReferrer(event.referrer),
      referrerSource: referrerSource(event.referrer, event.utm?.source, req.headers.host),
      utmSource: event.utm?.source || null,
      utmMedium: event.utm?.medium || null,
      utmCampaign: event.utm?.campaign || null,
      utmContent: event.utm?.content || null,
      utmTerm: event.utm?.term || null,
      country: location?.country || null,
      countryCode: location?.countryCode || null,
      region: location?.region || null,
      city: location?.city || null,
      deviceType: device.device,
      browser: device.browser,
      os: device.os,
      activeSeconds: event.activeSeconds,
    };

    const [row] = await db('SELECT analytics_track($1::jsonb) AS result', [JSON.stringify(payload)]);
    return row?.result?.ok
      ? { ok: true, recorded: Boolean(row.result.recorded), onlineWindowMinutes: LIVE_WINDOW_MINUTES }
      : { ok: false, onlineWindowMinutes: LIVE_WINDOW_MINUTES };
  }

  async function dashboard(params) {
    if (!(await isReady(params.get('refresh') === '1'))) throw notInstalled();
    const range = resolveRange(params, Date.now(), timezone);
    const [row] = await db(
      'SELECT analytics_dashboard($1,$2,$3,$4) AS data',
      [range.from, range.to, range.timezone, range.granularity],
    );
    if (!row?.data || typeof row.data !== 'object') throw httpError(503, 'The analytics query returned no data.');
    return {
      ...row.data,
      range: {
        ...(row.data.range || {}),
        preset: range.preset,
        label: range.label,
        granularity: row.data.range?.granularity || range.granularity,
        timezone: row.data.range?.timezone || range.timezone,
      },
      onlineWindowMinutes: LIVE_WINDOW_MINUTES,
    };
  }

  async function live() {
    if (!(await isReady())) throw notInstalled();
    const [row] = await db('SELECT analytics_live($1) AS data', [timezone]);
    if (!row?.data || typeof row.data !== 'object') throw httpError(503, 'The live analytics query returned no data.');
    return { ...row.data, onlineWindowMinutes: LIVE_WINDOW_MINUTES };
  }

  return { track, dashboard, live, isReady, timezone };
}
