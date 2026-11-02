import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createHandler } from '../server/runtime.mjs';
import { hashPassword } from '../server/password.mjs';

test('albums: authenticated creation, covers, isolated photos, moving, conflicts and safe migration', async () => {
  const db = new PGlite();
  const schema = await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8');
  await db.exec(schema);
  const server = http.createServer(createHandler({ env: { ADMIN_PASSWORD_HASH: await hashPassword('Album-test-password-only') }, query: async (sql, values) => (await db.query(sql, values)).rows, storage: { configured: () => false } }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const request = async (path, method = 'GET', body, extra = {}) => {
    const response = await fetch(`${origin}/api/${path}`, { method, headers: { Origin: origin, 'X-TRN-Admin': '1', 'Content-Type': 'application/json', Cookie: cookie, ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json(), headers: response.headers };
  };
  try {
    const archive = (await request('albums')).data[0];
    assert.equal(archive.name, 'Live archive'); assert.equal(archive.photos.length, 9);
    assert.ok(archive.photos.every(photo => photo.albumId === archive.id));
    assert.equal((await request('admin/albums')).status, 401);
    assert.equal((await request('admin/albums', 'POST', {})).status, 401);
    const login = await request('admin/login', 'POST', { password: 'Album-test-password-only' });
    cookie = login.headers.get('set-cookie').split(';')[0];
    const payload = { revision: 0, name: 'Sushant KC', coverId: archive.photos[0].mediaId };
    assert.equal((await request('admin/albums', 'POST', { ...payload, name: ' ' })).status, 400);
    assert.equal((await request('admin/albums', 'POST', { ...payload, coverId: archive.id })).status, 400);
    assert.equal((await request('admin/albums', 'POST', payload, { Origin: 'https://other.example' })).status, 403);
    const created = await request('admin/albums', 'POST', payload);
    assert.equal(created.status, 201); const album = created.data;
    assert.equal(album.coverUrl, archive.photos[0].url); assert.deepEqual(album.photos, []);
    assert.equal((await request('albums')).data.length, 1, 'Empty albums stay off the homepage');
    assert.equal((await request('admin/albums')).data.length, 2);
    const photo = archive.photos[1];
    assert.equal((await request(`admin/gallery/${photo.id}`, 'PUT', { revision: photo.revision, mediaId: photo.mediaId, albumId: '00000000-0000-4000-8000-000000000099' })).status, 400);
    const moved = await request(`admin/gallery/${photo.id}`, 'PUT', { revision: photo.revision, mediaId: photo.mediaId, albumId: album.id });
    assert.equal(moved.status, 200); assert.equal(moved.data.albumId, album.id);
    const publicAlbums = (await request('albums')).data;
    assert.equal(publicAlbums.find(item => item.id === archive.id).photos.length, 8);
    assert.deepEqual(publicAlbums.find(item => item.id === album.id).photos.map(p => p.id), [photo.id]);
    const renamed = await request(`admin/albums/${album.id}`, 'PUT', { ...payload, name: 'Sushant KC Live', coverId: photo.mediaId });
    assert.equal(renamed.status, 200); assert.equal(renamed.data.revision, 1); assert.equal(renamed.data.coverUrl, photo.url);
    assert.equal((await request(`admin/albums/${album.id}`, 'PUT', payload)).status, 409);
    assert.equal((await request(`admin/albums/${album.id}`, 'DELETE', { revision: 0 })).status, 409);
    await db.exec(schema);
    assert.equal((await request('albums')).data.find(a => a.id === album.id).photos.length, 1, 'Migration preserves album assignments');
    assert.equal((await request(`admin/albums/${album.id}`, 'DELETE', { revision: 1 })).status, 200);
    assert.equal((await db.query('SELECT id FROM trn_gallery WHERE id=$1', [photo.id])).rows.length, 0);
    assert.equal((await db.query('SELECT id FROM trn_media WHERE id=$1', [photo.mediaId])).rows.length, 1, 'Album deletion preserves original files');
    assert.equal((await request(`admin/albums/${archive.id}`, 'DELETE', { revision: 0 })).status, 200);
    await db.exec(schema);
    assert.deepEqual((await request('albums')).data, [], 'Migration must not restore deleted albums or photos');
  } finally { await new Promise(resolve => server.close(resolve)); await db.close(); }
});
