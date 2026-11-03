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
    assert.deepEqual(seed.stops, [{ date: seed.date, dateTba: false, location: seed.location }]);
    const payload = { revision: 0, type: 'tour', name: 'UK Tour', artist: 'Sushant KC', description: 'Doors at 7pm.\nLive with the band.', imageId: seed.imageId, published: true, stops: [{ date: '2028-04-12', location: 'London, O2' }, { date: '2028-04-02', location: 'Manchester, Academy' }] };
    const tour = await events.save(payload);
    assert.equal(tour.date, '2028-04-02');
    assert.equal(tour.location, 'Manchester, Academy');
    assert.equal(tour.artist, payload.artist);
    assert.equal(tour.description, payload.description);
    assert.deepEqual(tour.stops, [...payload.stops].reverse().map(stop => ({ ...stop, dateTba: false })));
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
    assert.deepEqual(concert.stops, [{ date: '2028-05-01', dateTba: false, location: 'London' }]);
    const tba = await events.save({ revision: 0, name: 'Secret Show', location: 'Kathmandu', imageId: seed.imageId, published: true, dateTba: true });
    assert.equal(tba.date, '');
    assert.equal(tba.dateTba, true);
    assert.deepEqual(tba.stops, [{ date: '', dateTba: true, location: 'Kathmandu' }]);
    assert.equal((await events.list()).at(-1).id, tba.id);
    const tbaTour = await events.save({ ...payload, dateTba: true, stops: [{ location: 'London' }, { location: 'Manchester' }] });
    assert.equal(tbaTour.date, '');
    assert.equal(tbaTour.dateTba, true);
    assert.deepEqual(tbaTour.stops, [{ date: '', dateTba: true, location: 'London' }, { date: '', dateTba: true, location: 'Manchester' }]);
    const mixedTour = await events.save({ ...payload, stops: [{ date: '2028-04-12', location: 'London' }, { location: 'Manchester', dateTba: true }] });
    assert.equal(mixedTour.date, '2028-04-12');
    assert.equal(mixedTour.dateTba, false);
    assert.deepEqual(mixedTour.stops, [{ date: '2028-04-12', dateTba: false, location: 'London' }, { date: '', dateTba: true, location: 'Manchester' }]);
    await assert.rejects(events.save({ ...payload, dateTba: false, stops: [{ date: '2028-04-12', location: 'London' }, { location: 'Manchester' }] }), { status: 400 });
    await assert.rejects(events.save({ ...payload, type: 'concert', date: undefined, location: 'London' }), { status: 400 });
    await events.remove(tour.id, { revision: 2 });
    assert.equal((await events.list(true)).some(e => e.id === tour.id), false);
  } finally { await database.close(); }
});
