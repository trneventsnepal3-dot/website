import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { decodeTombstone, tombstoneName, upsertNeonRows } from '../server/sync.mjs';

test('Neon sync upserts bulk rows, revisions, identity positions and JSON stops', async () => {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE trn_migrations (name text PRIMARY KEY);
    CREATE TABLE trn_albums (id text PRIMARY KEY, revision integer NOT NULL, name text NOT NULL, position bigint GENERATED ALWAYS AS IDENTITY);
    CREATE TABLE trn_events (id text PRIMARY KEY, revision integer NOT NULL, stops jsonb NOT NULL DEFAULT '[]');
  `);
  const sql = { query: async (statement, values) => (await db.query(statement, values)).rows };

  await upsertNeonRows(sql, 'trn_migrations', [{ name: 'one' }, { name: 'two' }], { name: 'trn_migrations', pk: ['name'] });
  await upsertNeonRows(sql, 'trn_migrations', [{ name: 'two' }, { name: 'three' }], { name: 'trn_migrations', pk: ['name'] });
  await upsertNeonRows(sql, 'trn_albums', [{ id: 'a', revision: 1, name: 'Album A', position: 7 }], { name: 'trn_albums', pk: ['id'], identity: true });
  await upsertNeonRows(sql, 'trn_albums', [{ id: 'a', revision: 2, name: 'Album A updated', position: 7 }], { name: 'trn_albums', pk: ['id'], identity: true });
  await upsertNeonRows(sql, 'trn_events', [{ id: 'e', revision: 1, stops: [{ date: '2027-01-01', location: 'Kathmandu' }] }], { name: 'trn_events', pk: ['id'] });

  const migrations = await db.query('SELECT name FROM trn_migrations ORDER BY name');
  const albums = await db.query('SELECT id,revision,name,position FROM trn_albums');
  const events = await db.query('SELECT id,revision,stops FROM trn_events');
  assert.deepEqual(migrations.rows.map(row => row.name), ['one', 'three', 'two']);
  assert.deepEqual(albums.rows, [{ id: 'a', revision: 2, name: 'Album A updated', position: 7 }]);
  assert.equal(events.rows[0].revision, 1);
  assert.deepEqual(events.rows[0].stops, [{ date: '2027-01-01', location: 'Kathmandu' }]);
  await db.close();
});

test('sync tombstones round-trip only for known tables', () => {
  const deletion = { table: 'trn_events', pk: 'id', value: '00000000-0000-4000-8000-000000000099' };
  const marker = tombstoneName('supabase', deletion);
  assert.deepEqual(decodeTombstone('supabase', marker), deletion);
  assert.equal(decodeTombstone('neon', marker), null);
  assert.equal(decodeTombstone('supabase', tombstoneName('supabase', { table: 'unknown', pk: 'id', value: 'x' })), null);
});
