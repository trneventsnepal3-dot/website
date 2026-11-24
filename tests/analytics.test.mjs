import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createHandler } from '../server/runtime.mjs';
import { hashPassword } from '../server/password.mjs';
import { isBot, parseUserAgent, referrerSource, resolveRange, cleanPath } from '../server/analytics.mjs';

const password = 'Test-only-analytics-123!';
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const visitorA = '11111111-1111-4111-8111-111111111111';
const visitorB = '44444444-4444-4444-8444-444444444444';
const sessionA = '22222222-2222-4222-8222-222222222222';
const sessionB = '55555555-5555-4555-8555-555555555555';

let database, server, origin, cookie, env, geoLookups, handler;
const geo = {
  '8.8.8.8': { country: 'United States', countryCode: 'US', region: 'California', city: 'Mountain View' },
  '203.0.113.9': { country: 'Nepal', countryCode: 'NP', region: 'Bagmati', city: 'Kathmandu' },
};

async function request(path, method = 'GET', body, options = {}) {
  const response = await fetch(`${origin}/api/${path}`, {
    method,
    headers: {
      Origin: origin,
      'X-TRN-Admin': '1',
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...options.headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json(), headers: response.headers };
}

function pageView(overrides = {}) {
  return {
    kind: 'pageview',
    visitorId: visitorA,
    sessionId: sessionA,
    viewKey: crypto.randomUUID(),
    path: '/',
    title: 'TRN Events Nepal',
    referrer: 'https://www.google.com/search?q=trn+events',
    activeSeconds: 12,
    ...overrides,
  };
}

before(async () => {
  database = new PGlite();
  await database.exec(await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8'));
  await database.exec(await readFile(new URL('../server/analytics.sql', import.meta.url), 'utf8'));
  env = { ADMIN_PASSWORD_HASH: await hashPassword(password), ANALYTICS_TIMEZONE: 'Asia/Kathmandu' };
  geoLookups = [];
  handler = createHandler({
    env,
    query: async (sql, values) => (await database.query(sql, values)).rows,
    analyticsOptions: {
      geolocate: async ip => { geoLookups.push(ip); return geo[ip] || null; },
    },
  });
  server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  await database.close();
});

test('user-agent, referrer and path helpers classify real traffic', () => {
  assert.equal(isBot('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'), true);
  assert.equal(isBot('Mozilla/5.0 (compatible; bingbot/2.0)'), true);
  assert.equal(isBot(''), true);
  assert.equal(isBot(DESKTOP_UA), false);

  assert.deepEqual(parseUserAgent(DESKTOP_UA), { device: 'desktop', browser: 'Chrome', os: 'Windows' });
  assert.deepEqual(parseUserAgent(MOBILE_UA), { device: 'mobile', browser: 'Safari', os: 'iOS' });
  assert.equal(parseUserAgent('Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15').device, 'tablet');

  assert.equal(referrerSource('', ''), 'Direct');
  assert.equal(referrerSource('https://www.google.com/search?q=trn', ''), 'Google');
  assert.equal(referrerSource('https://l.instagram.com/?u=https%3A%2F%2Ftrn.example', ''), 'Instagram');
  assert.equal(referrerSource('https://www.tiktok.com/@trn', ''), 'TikTok');
  assert.equal(referrerSource('https://example.com/blog', ''), 'example.com');
  assert.equal(referrerSource('', 'ig'), 'Instagram');
  assert.equal(referrerSource('https://trn.example/', '', 'trn.example'), 'Direct');
  assert.equal(referrerSource('https://www.trn.example/page', '', 'www.trn.example'), 'Direct');

  assert.equal(cleanPath('/?utm_source=instagram&token=secret#tickets'), '/?utm_source=instagram#tickets');
  assert.equal(cleanPath('/events?email=a%40b.com&sort=date'), '/events?sort=date');
});

test('range presets resolve to deterministic windows', () => {
  const now = Date.UTC(2026, 4, 20, 12, 0, 0);
  const week = resolveRange(new URLSearchParams('range=7d'), now);
  assert.equal(week.preset, '7d');
  assert.equal(week.label, 'Last 7 days');
  assert.equal(week.from, new Date(now - 7 * 86_400_000).toISOString());
  assert.equal(resolveRange(new URLSearchParams('range=24h'), now).granularity, 'hour');
  assert.equal(resolveRange(new URLSearchParams('range=90d'), now).granularity, 'week');
  assert.equal(resolveRange(new URLSearchParams('range=all'), now).from, null);
  assert.equal(resolveRange(new URLSearchParams('range=all'), now).granularity, 'auto');
  const custom = resolveRange(new URLSearchParams('range=custom&from=2026-05-01&to=2026-05-10'), now);
  assert.equal(custom.from, '2026-05-01T00:00:00.000Z');
  assert.equal(custom.to, '2026-05-10T23:59:59.999Z');
  assert.throws(() => resolveRange(new URLSearchParams('range=custom&from=2026-05-10&to=2026-05-01'), now));
});

test('analytics tables are protected by RLS', async () => {
  const { rows } = await database.query(`
    SELECT relname, relrowsecurity FROM pg_class
    WHERE relname IN ('analytics_visitors', 'analytics_sessions', 'analytics_page_views')`);
  assert.equal(rows.length, 3);
  for (const row of rows) assert.equal(row.relrowsecurity, true, `${row.relname} should have RLS`);
});

test('the public tracking endpoint records real, deduplicated page views', async () => {
  const first = await request('analytics/track', 'POST', pageView(), {
    headers: { 'User-Agent': DESKTOP_UA, 'X-Forwarded-For': '8.8.8.8' },
  });
  assert.equal(first.status, 200);
  assert.equal(first.data.ok, true);
  assert.equal(first.data.recorded, true);
  assert.equal(first.data.onlineWindowMinutes, 5);

  // Retrying the same view key must never double-count the page view.
  const duplicate = await request('analytics/track', 'POST', pageView({
    viewKey: (await database.query('SELECT view_key FROM analytics_page_views LIMIT 1')).rows[0].view_key,
  }), { headers: { 'User-Agent': DESKTOP_UA, 'X-Forwarded-For': '8.8.8.8' } });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.data.recorded, false);

  const counts = (await database.query(`
    SELECT (SELECT count(*)::int FROM analytics_visitors) AS visitors,
           (SELECT count(*)::int FROM analytics_sessions) AS sessions,
           (SELECT count(*)::int FROM analytics_page_views) AS views`)).rows[0];
  assert.deepEqual(counts, { visitors: 1, sessions: 1, views: 1 });

  const stored = (await database.query('SELECT * FROM analytics_page_views')).rows[0];
  assert.equal(stored.path, '/');
  assert.equal(stored.referrer_source, 'Google');

  const visitor = (await database.query('SELECT * FROM analytics_visitors')).rows[0];
  assert.equal(visitor.country, 'United States');
  assert.equal(visitor.country_code, 'US');
  assert.equal(visitor.city, 'Mountain View');
  assert.equal(visitor.device_type, 'desktop');
  assert.equal(visitor.browser, 'Chrome');
  assert.equal(visitor.os, 'Windows');
  assert.equal(visitor.page_view_count, 1);
});

test('bots, admin traffic and invalid events are rejected without writing', async () => {
  const before = (await database.query('SELECT count(*)::int AS n FROM analytics_page_views')).rows[0].n;

  const bot = await request('analytics/track', 'POST', pageView({ visitorId: visitorB, sessionId: sessionB }), {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'X-Forwarded-For': '203.0.113.9' },
  });
  assert.equal(bot.status, 202);
  assert.equal(bot.data.ignored, true);
  assert.equal(bot.data.reason, 'bot');

  const admin = await request('analytics/track', 'POST', pageView({ path: '/admin/settings' }), {
    headers: { 'User-Agent': DESKTOP_UA, 'X-Forwarded-For': '8.8.8.8' },
  });
  assert.equal(admin.status, 202);
  assert.equal(admin.data.reason, 'admin');

  const invalid = await request('analytics/track', 'POST', { kind: 'pageview', visitorId: 'not-a-uuid' }, {
    headers: { 'User-Agent': DESKTOP_UA },
  });
  assert.equal(invalid.status, 400);

  assert.equal((await database.query('SELECT count(*)::int AS n FROM analytics_page_views')).rows[0].n, before);
});

test('heartbeats keep real visitors online and accumulate session time', async () => {
  const heartbeat = await request('analytics/track', 'POST', {
    kind: 'heartbeat',
    visitorId: visitorA,
    sessionId: sessionA,
    path: '/#tickets',
    title: 'Tickets',
    referrer: '',
    activeSeconds: 75,
  }, { headers: { 'User-Agent': DESKTOP_UA, 'X-Forwarded-For': '8.8.8.8' } });
  assert.equal(heartbeat.status, 200);
  assert.equal(heartbeat.data.recorded, false);

  const session = (await database.query('SELECT * FROM analytics_sessions WHERE id=$1', [sessionA])).rows[0];
  assert.equal(session.duration_seconds, 75);
  assert.equal(session.exit_path, '/#tickets');

  const mobile = await request('analytics/track', 'POST', pageView({
    visitorId: visitorB,
    sessionId: sessionB,
    viewKey: crypto.randomUUID(),
    path: '/#events',
    title: 'Events',
    referrer: 'https://l.instagram.com/?u=https%3A%2F%2Ftrn.example',
  }), { headers: { 'User-Agent': MOBILE_UA, 'X-Forwarded-For': '203.0.113.9' } });
  assert.equal(mobile.status, 200);

  const live = (await database.query('SELECT analytics_live($1) AS data', ['Asia/Kathmandu'])).rows[0].data;
  assert.equal(live.online, 2);
  assert.ok(live.today >= 2);

  const second = (await database.query('SELECT * FROM analytics_sessions WHERE id=$1', [sessionB])).rows[0];
  assert.equal(second.device_type, 'mobile');
  assert.equal(second.browser, 'Safari');
  assert.equal(second.country_code, 'NP');
  assert.equal(second.city, 'Kathmandu');
  assert.equal(second.referrer_source, 'Instagram');
});

test('UTM campaigns override the referrer source', async () => {
  const response = await request('analytics/track', 'POST', pageView({
    visitorId: visitorB,
    sessionId: sessionB,
    viewKey: crypto.randomUUID(),
    path: '/?utm_source=tiktok&utm_campaign=uk-tour',
    referrer: '',
    utm: { source: 'tiktok', medium: 'social', campaign: 'uk-tour' },
  }), { headers: { 'User-Agent': MOBILE_UA, 'X-Forwarded-For': '203.0.113.9' } });
  assert.equal(response.status, 200);
  const view = (await database.query("SELECT * FROM analytics_page_views WHERE path LIKE '/?utm_source=tiktok%'")).rows[0];
  assert.equal(view.referrer_source, 'TikTok');
  const visitor = (await database.query('SELECT * FROM analytics_visitors WHERE id=$1', [visitorB])).rows[0];
  assert.equal(visitor.utm_source, 'tiktok');
  assert.equal(visitor.utm_campaign, 'uk-tour');
  const session = (await database.query('SELECT * FROM analytics_sessions WHERE id=$1', [sessionB])).rows[0];
  assert.equal(session.utm_source, 'tiktok');
});

test('admin analytics endpoints require a signed-in session and return real aggregates', async () => {
  assert.equal((await request('admin/analytics')).status, 401);
  assert.equal((await request('admin/analytics/live')).status, 401);

  const login = await request('admin/login', 'POST', { password });
  assert.equal(login.status, 200);
  cookie = login.headers.get('set-cookie').split(';')[0];

  const dashboard = await request('admin/analytics?range=all');
  assert.equal(dashboard.status, 200);
  const data = dashboard.data;
  assert.equal(data.range.preset, 'all');
  assert.equal(data.range.timezone, 'Asia/Kathmandu');
  assert.deepEqual(data.allTime, { visitors: 2, sessions: 2, pageViews: 3 });
  assert.equal(data.overview.online, 2);
  assert.equal(data.overview.newVisitors, 2);
  assert.equal(data.overview.returningVisitors, 0);
  assert.equal(data.onlineWindowMinutes, 5);

  assert.deepEqual(data.countries.map(row => row.countryCode).sort(), ['NP', 'US']);
  assert.deepEqual(data.cities.map(row => row.city).sort(), ['Kathmandu', 'Mountain View']);
  assert.equal(data.pages[0].path, '/');
  assert.equal(data.pages[0].views, 1);

  const sources = Object.fromEntries(data.sources.map(row => [row.source, row.pageViews]));
  assert.equal(sources.Google, 1);
  assert.equal(sources.Instagram, 1);
  assert.equal(sources.TikTok, 1);

  const devices = Object.fromEntries(data.devices.map(row => [row.name, row.visitors]));
  assert.equal(devices.desktop, 1);
  assert.equal(devices.mobile, 1);

  assert.ok(data.series.length >= 1);
  assert.ok(data.recent.length >= 3);
  assert.equal(data.recent[0].city, 'Kathmandu');

  const live = await request('admin/analytics/live');
  assert.equal(live.status, 200);
  assert.equal(live.data.online, 2);
  assert.ok(live.data.today >= 2);

  const seven = await request('admin/analytics?range=7d');
  assert.equal(seven.status, 200);
  assert.equal(seven.data.range.preset, '7d');
  assert.equal(seven.data.overview.pageViews, 3);

  const custom = await request('admin/analytics?range=custom&from=2020-01-01&to=2020-01-02');
  assert.equal(custom.status, 200);
  assert.equal(custom.data.overview.pageViews, 0);
  assert.ok(custom.data.series.length >= 1);
  assert.equal(custom.data.series.reduce((sum, point) => sum + point.pageViews, 0), 0);

  assert.equal((await request('admin/analytics?range=custom&from=2020-01-02&to=2020-01-01')).status, 400);
});

test('a database without the analytics migration reports a clear setup error', async () => {
  const bare = new PGlite();
  await bare.exec(await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8'));
  const bareHandler = createHandler({ env, query: async (sql, values) => (await bare.query(sql, values)).rows });
  const bareServer = http.createServer(bareHandler);
  await new Promise(resolve => bareServer.listen(0, '127.0.0.1', resolve));
  const bareOrigin = `http://127.0.0.1:${bareServer.address().port}`;
  try {
    const login = await fetch(`${bareOrigin}/api/admin/login`, {
      method: 'POST',
      headers: { Origin: bareOrigin, 'X-TRN-Admin': '1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    assert.equal(login.status, 200);
    const bareCookie = login.headers.get('set-cookie').split(';')[0];
    const response = await fetch(`${bareOrigin}/api/admin/analytics`, { headers: { Cookie: bareCookie } });
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.code, 'analytics_not_installed');
    assert.match(body.error, /analytics\.sql/);

    const track = await fetch(`${bareOrigin}/api/analytics/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': DESKTOP_UA },
      body: JSON.stringify(pageView({ visitorId: visitorB, sessionId: sessionB })),
    });
    assert.equal(track.status, 503);
    assert.equal((await track.json()).code, 'analytics_not_installed');
  } finally {
    await new Promise(resolve => bareServer.close(resolve));
    await bare.close();
  }
});
