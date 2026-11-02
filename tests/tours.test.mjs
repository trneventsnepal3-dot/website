import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createEvents } from '../server/events.mjs';

test('tours persist shared details and ordered stops, validate schedules, and convert to concerts', async () => {
  const database = new PGlite();
  try {
    const schema = await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8');
    await database.exec(schema);
    const events = createEvents(async (sql, values) => (await database.query(sql, values)).rows);
    const seed = (await events.list())[0];
    assert.equal(seed.type, 'concert');
    assert.deepEqual(seed.stops, [{ date: seed.date, location: seed.location }]);
    const payload = { revision: 0, type: 'tour', name: 'UK Tour', artist: 'Sushant KC', description: 'Doors at 7pm.\nLive with the band.', imageId: seed.imageId, published: true, stops: [{ date: '2028-04-12', location: 'London, O2' }, { date: '2028-04-02', location: 'Manchester, Academy' }] };
    const tour = await events.save(payload);
    assert.equal(tour.date, '2028-04-02');
    assert.equal(tour.location, 'Manchester, Academy');
    assert.equal(tour.artist, payload.artist);
    assert.equal(tour.description, payload.description);
    assert.deepEqual(tour.stops, [...payload.stops].reverse());
    await database.exec(schema);
    assert.deepEqual((await events.list()).find(e => e.id === tour.id), tour);
    for (const invalid of [ { stops: payload.stops.slice(0,1) }, { artist: '' }, { stops: [payload.stops[0], payload.stops[0]] }, { stops: [{ date: '2028-02-30', location: 'London' }, payload.stops[0]] }, { stops: [{ date: '2028-03-30', location: '' }, payload.stops[0]] } ]) {
      await assert.rejects(events.save({ ...payload, ...invalid }), { status: 400 });
    }
    const hidden = await events.save({ ...payload, stops: [...payload.stops, { date: '2028-04-20', location: 'Birmingham' }], published: false }, tour.id);
    assert.equal(hidden.stops.length, 3);
    assert.equal((await events.list()).some(e => e.id === tour.id), false);
    await assert.rejects(events.save(payload, tour.id), { status: 409 });
    const concert = await events.save({ ...payload, revision: 1, type: 'concert', date: '2028-05-01', location: 'London' }, tour.id);
    assert.equal(concert.type, 'concert');
    assert.deepEqual(concert.stops, [{ date: '2028-05-01', location: 'London' }]);
    await events.remove(tour.id, { revision: 2 });
    assert.equal((await events.list(true)).some(e => e.id === tour.id), false);
  } finally { await database.close(); }
});
