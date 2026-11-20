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
    for (const invalid of [ { stops: payload.stops.slice(0,1) }, { artist: '' }, { stops: [{ date: '2028-02-30', location: 'London' }, payload.stops[0]] }, { stops: [{ date: '2028-03-30', location: '' }, payload.stops[0]] } ]) {
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
    const tbaTour = await events.save({ ...payload, dateTba: true, stops: [{ location: 'Texas, USA' }, { location: 'Texas, USA' }] });
    assert.equal(tbaTour.date, '');
    assert.equal(tbaTour.dateTba, true);
    assert.deepEqual(tbaTour.stops, [{ date: '', dateTba: true, location: 'Texas, USA' }, { date: '', dateTba: true, location: 'Texas, USA' }]);
    const sameVenue = await events.save({ ...payload, name: 'Texas Tour', stops: [{ date: '2028-06-01', location: 'Texas, USA' }, { date: '2028-06-02', location: 'Texas, USA' }] });
    assert.equal(sameVenue.date, '2028-06-01');
    assert.deepEqual(sameVenue.stops, [{ date: '2028-06-01', dateTba: false, location: 'Texas, USA' }, { date: '2028-06-02', dateTba: false, location: 'Texas, USA' }]);
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

test('tour stops keep independent optional YouTube aftermovie links', async () => {
  const database = new PGlite();
  try {
    const schema = await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8');
    await database.exec(schema);
    const events = createEvents(async (sql, values) => (await database.query(sql, values)).rows);
    const seed = (await events.list())[0];
    const sydneyVideo = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    const payload = {
      revision: 0,
      type: 'tour',
      name: 'City Tour',
      artist: 'Sushant KC',
      imageId: seed.imageId,
      published: true,
      stops: [
        { date: '2028-07-02', location: 'Sydney, Opera House', aftermovieUrl: sydneyVideo },
        { date: '2028-07-01', location: 'Melbourne, Forum' },
      ],
    };
    await assert.rejects(events.save({ ...payload, stops: [{ ...payload.stops[0], aftermovieUrl: 'https://vimeo.com/12345' }, payload.stops[1]] }), { status: 400 });
    await assert.rejects(events.save({ ...payload, stops: [{ ...payload.stops[0], aftermovieUrl: 'https://www.youtube.com/watch?v=short' }, payload.stops[1]] }), { status: 400 });
    const tour = await events.save(payload);
    const byLocation = location => tour.stops.find(stop => stop.location.startsWith(location));
    assert.equal(byLocation('Sydney').aftermovieUrl, sydneyVideo);
    assert.equal(byLocation('Melbourne').aftermovieUrl, undefined);
    assert.equal((await events.list(true)).find(event => event.id === tour.id).stops.find(stop => stop.location.startsWith('Sydney')).aftermovieUrl, sydneyVideo);

    const melbourneVideo = 'https://youtu.be/9bZkp7q19f0';
    const edited = await events.save({ ...payload, revision: tour.revision, stops: [
      { ...payload.stops[0], aftermovieUrl: '9bZkp7q19f0' },
      { ...payload.stops[1], aftermovieUrl: melbourneVideo },
    ] });
    assert.equal(edited.stops.find(stop => stop.location.startsWith('Sydney')).aftermovieUrl, '9bZkp7q19f0');
    assert.equal(edited.stops.find(stop => stop.location.startsWith('Melbourne')).aftermovieUrl, melbourneVideo);

    const removed = await events.save({ ...payload, revision: edited.revision, stops: [
      { ...payload.stops[0], aftermovieUrl: '' },
      { ...payload.stops[1] },
    ] });
    assert.equal(removed.stops.find(stop => stop.location.startsWith('Sydney')).aftermovieUrl, undefined);
    assert.equal(removed.stops.find(stop => stop.location.startsWith('Melbourne')).aftermovieUrl, undefined);
  } finally { await database.close(); }
});
