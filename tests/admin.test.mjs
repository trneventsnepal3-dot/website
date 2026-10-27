import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createHandler } from '../server/runtime.mjs';
import { hashPassword } from '../server/password.mjs';
let database, server, origin, cookie, env, lastUpload;
const objects = new Map();
const buckets = { popup: 'media', audio: 'song', hero: 'herosectionvideo' };
const password = 'Test-only-password-123!';
async function request(path, method = 'GET', body, options = {}) {
  const response = await fetch(`${origin}/api/${path}`, { method, headers: { Origin: origin, 'X-TRN-Admin': '1', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...options.headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, data: await response.json(), headers: response.headers };
}
before(async () => {
  database = new PGlite(); await database.exec(await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8'));
  env = { ADMIN_PASSWORD_HASH: await hashPassword(password) };
  const handler = createHandler({ env, query: async (sql, values) => (await database.query(sql, values)).rows,
    storage: { configured: () => true, bucket: kind => buckets[kind],
      authorize: async data => { lastUpload = data; return { bucket: buckets[data.kind], url: 'https://storage.example/signed-put', method: 'PUT', headers: { 'Content-Type': data.contentType } }; },
      head: async (bucket, pathname) => ({ url: `https://storage.example/${bucket}/${pathname}`, ...objects.get(pathname) }) } });
  server = http.createServer(handler); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise(resolve => server.close(resolve)); await database.close(); });
test('protected admin, media publication, conflict handling and session revocation', async () => {
  assert.equal((await request('admin/settings')).status, 401);
  assert.equal((await request('admin/login', 'POST', { password }, { headers: { Origin: 'https://elsewhere.example' } })).status, 403);
  assert.equal((await request('admin/login', 'POST', { password: 'wrong' })).status, 401);
  const login = await request('admin/login', 'POST', { password }); assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/); cookie = login.headers.get('set-cookie').split(';')[0];
  const initial = (await request('admin/settings')).data;
  const { popup, audio, hero, galleryBaseUrl, uploadsAvailable, ...draft } = initial;
  assert.equal(initial.heroVideoEnabled, true);
  assert.equal((await request('admin/settings', 'PUT', { ...draft, popupEnabled: true })).status, 400);
  assert.equal((await request('admin/settings', 'PUT', { ...draft, popupLink: 'javascript:alert(1)' })).status, 400);
  assert.equal((await request('admin/settings', 'PUT', draft, { headers: { 'X-TRN-Admin': '0' } })).status, 403);
  assert.equal((await request('admin/uploads', 'POST', { kind: 'popup', name: 'unsafe.svg', contentType: 'image/svg+xml', size: 2048 })).status, 400);
  assert.equal((await request('admin/uploads', 'POST', { kind: 'audio', name: 'large.mp3', contentType: 'audio/mpeg', size: 31 * 1024 * 1024 })).status, 400);
  const authorized = await request('admin/uploads', 'POST', { kind: 'popup', name: 'event-poster.png', contentType: 'image/png', size: 2048 });
  assert.equal(authorized.status, 200); const { pathname } = authorized.data;
  assert.match(pathname, /^trn\/popup\/[a-f0-9-]+\.png$/); assert.equal(lastUpload.contentType, 'image/png'); assert.equal(lastUpload.size, 2048);
  objects.set(pathname, { contentType: 'image/png', size: 5000 });
  assert.equal((await request('admin/media', 'POST', { pathname })).status, 400);
  objects.set(pathname, { contentType: 'image/png', size: 2048 });
  assert.equal((await request('admin/media', 'POST', { pathname: 'other-store/file.png' })).status, 404);
  const media = await request('admin/media', 'POST', { pathname }); assert.equal(media.status, 200);
  const publish = await request('admin/settings', 'PUT', { ...draft, popupId: media.data.id, popupEnabled: true, popupAlt: 'Event poster', popupLink: 'https://example.com/event', audioVolume: .5 });
  assert.equal(publish.status, 200); assert.equal(publish.data.revision, 1);
  const publicSettings = await request('site-settings'); assert.equal(publicSettings.data.popup.url, media.data.url); assert.equal(publicSettings.data.popup.owner, undefined);
  assert.equal((await request('admin/settings', 'PUT', draft)).status, 409);
  const { popup: p, audio: a, hero: h, galleryBaseUrl: g, uploadsAvailable: u, ...current } = publish.data;
  for (const [kind, contentType, bucket] of [['audio', 'audio/mpeg', 'song'], ['hero', 'video/mp4', 'herosectionvideo']]) {
    const ticket = await request('admin/uploads', 'POST', { kind, name: kind === 'audio' ? 'music.mp3' : 'hero.mp4', contentType, size: 2048 });
    assert.equal(ticket.status, 200);
    objects.set(ticket.data.pathname, { contentType, size: 2048 });
    const registered = await request('admin/media', 'POST', { pathname: ticket.data.pathname }); assert.equal(registered.status, 200);
    assert.equal(new URL(registered.data.url).pathname.split('/')[1], bucket);
    current[`${kind}Id`] = registered.data.id;
  }
  current.audioEnabled = true;
  assert.equal((await request('admin/settings', 'PUT', { ...current, effectsEnabled: false })).status, 200);
  assert.equal((await request('site-settings')).data.effectsEnabled, false);
  const published = (await request('site-settings')).data;
  assert.ok(published.hero.url.includes('/herosectionvideo/')); assert.ok(published.audio.url.includes('/song/'));
  assert.equal((await request('admin/logout', 'POST')).status, 200);
  assert.equal((await request('admin/settings')).status, 401);
  cookie = undefined;
  const again = await request('admin/login', 'POST', { password }); cookie = again.headers.get('set-cookie').split(';')[0];
  env.ADMIN_PASSWORD_HASH = await hashPassword('Changed-test-password!');
  assert.equal((await request('admin/session')).status, 401);
});
test('login throttling persists in the database', async () => {
  await database.exec('DELETE FROM trn_login_limits'); cookie = undefined;
  for (let i = 0; i < 8; i++) assert.equal((await request('admin/login', 'POST', { password: 'incorrect' })).status, 401);
  assert.equal((await request('admin/login', 'POST', { password: 'incorrect' })).status, 429);
});
