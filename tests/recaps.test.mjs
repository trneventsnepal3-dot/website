import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createHandler } from '../server/runtime.mjs';
import { hashPassword } from '../server/password.mjs';

test('event recaps link albums, preview photos, validate links and clear on album removal', async () => {
  const database = new PGlite();
  const schema = await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8');
  await database.exec(schema);
  const env = { ADMIN_PASSWORD_HASH: await hashPassword('Recap-test-password-only') };
  const server = http.createServer(createHandler({ env, query: async (sql, values) => (await database.query(sql, values)).rows, storage: { configured: () => true, bucket: () => 'media', authorize: async () => ({ bucket: 'media', url: 'https://storage.example/upload', method: 'PUT', headers: {} }), head: async (_bucket, key) => ({ url: `https://storage.example/media/${key}`, contentType: 'image/jpeg', size: 4096 }) } }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  async function request(path, method = 'GET', body, headers = {}) {
    const response = await fetch(`${origin}/api/${path}`, { method, headers: { Origin: origin, 'Content-Type': 'application/json', 'X-TRN-Admin': '1', Cookie: cookie, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json(), headers: response.headers };
  }
  const upload = async (kind, name) => {
    const ticket = await request('admin/uploads', 'POST', { kind, name, size: 4096, contentType: 'image/jpeg' });
    assert.equal(ticket.status, 200);
    const media = await request('admin/media', 'POST', { pathname: ticket.data.pathname });
    assert.equal(media.status, 200);
    return media.data;
  };
  try {
    const login = await request('admin/login', 'POST', { password: 'Recap-test-password-only' });
    cookie = login.headers.get('set-cookie').split(';')[0];

    const poster = await upload('event', 'event-poster.jpg');
    const photos = [await upload('gallery', 'recap-one.jpg'), await upload('gallery', 'recap-two.jpg'), await upload('gallery', 'recap-three.jpg')];
    const album = await request('admin/albums', 'POST', { revision: 0, name: 'Sushant KC Live', coverId: photos[0].id });
    assert.equal(album.status, 201);
    const galleryIds = [];
    for (const photo of photos) {
      const added = await request('admin/gallery', 'POST', { revision: 0, mediaId: photo.id, albumId: album.data.id });
      assert.equal(added.status, 201);
      galleryIds.push(added.data.id);
    }

    const payload = { revision: 0, name: 'Recap night', location: 'Kathmandu', date: '2027-05-05', imageId: poster.id, published: true, albumId: album.data.id, recapUrl: 'https://www.youtube.com/watch?v=recap123' };
    assert.equal((await request('admin/events', 'POST', { ...payload, albumId: '00000000-0000-4000-8000-0000000000aa' })).status, 400);
    assert.equal((await request('admin/events', 'POST', { ...payload, recapUrl: 'http://example.com/recap.mp4' })).status, 400);
    const created = await request('admin/events', 'POST', payload);
    assert.equal(created.status, 201);
    assert.equal(created.data.album.id, album.data.id);
    assert.equal(created.data.album.name, 'Sushant KC Live');
    assert.equal(created.data.album.count, 3);
    assert.deepEqual(created.data.album.photos.map(photo => photo.id), galleryIds);
    assert.equal(created.data.recapUrl, payload.recapUrl);

    const listed = (await request('events')).data.find(event => event.id === created.data.id);
    assert.ok(listed, 'the recap event is public');
    assert.equal(listed.album.count, 3);
    assert.equal((await request('events')).data.filter(event => event.album).length, 1);

    const vimeo = await request(`admin/events/${created.data.id}`, 'PUT', { ...payload, revision: created.data.revision, recapUrl: 'https://vimeo.com/987654' });
    assert.equal(vimeo.status, 200);
    assert.equal(vimeo.data.recapUrl, 'https://vimeo.com/987654');

    assert.equal((await request(`admin/albums/${album.data.id}`, 'DELETE', { revision: 0 })).status, 200);
    const afterRemoval = (await request('admin/events')).data.find(event => event.id === created.data.id);
    assert.ok(afterRemoval);
    assert.equal(afterRemoval.album, null, 'removing the album clears the event link');
    assert.equal(afterRemoval.albumId, null);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await database.close();
  }
});
