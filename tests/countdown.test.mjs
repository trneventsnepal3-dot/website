import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createEvents } from '../server/events.mjs';

test('timed events and tour stops persist countdown schedules and completion independently', async () => {
  const database = new PGlite();
  try {
    const schema = await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8');
    await database.exec(schema);
    const events = createEvents(async (sql, values) => (await database.query(sql, values)).rows);
    const seed = (await events.list())[0];

    const concert = await events.save({
      revision: 0,
      name: 'Timed Show',
      location: 'Kathmandu',
      date: '2099-12-15',
      startTime: '19:30',
      endDate: '2099-12-15',
      endTime: '22:30',
      timezone: 'Asia/Kathmandu',
      imageId: seed.imageId,
      published: true,
    });
    assert.equal(concert.startTime, '19:30');
    assert.equal(concert.endDate, '2099-12-15');
    assert.equal(concert.endTime, '22:30');
    assert.equal(concert.timezone, 'Asia/Kathmandu');
    assert.equal(concert.stops[0].startTime, '19:30');
    assert.equal(concert.stops[0].endTime, '22:30');

    const tour = await events.save({
      revision: 0,
      type: 'tour',
      name: 'World Tour',
      artist: 'Sushant KC',
      imageId: seed.imageId,
      published: true,
      stops: [
        { date: '2099-01-10', location: 'Kathmandu', startTime: '18:00', endTime: '21:00', timezone: 'Asia/Kathmandu', completed: true },
        { date: '2099-02-10', location: 'London', startTime: '19:00', endTime: '22:00', timezone: 'Europe/London' },
        { location: 'Sydney', dateTba: true, timezone: 'Australia/Sydney' },
      ],
    });
    assert.deepEqual(tour.stops.map(stop => stop.location), ['Kathmandu', 'London', 'Sydney']);
    assert.equal(tour.stops[0].completed, true);
    assert.equal(tour.stops[1].timezone, 'Europe/London');
    assert.equal(tour.stops[2].dateTba, true);
    assert.equal(tour.stops[2].date, '');
    assert.ok((await events.list()).some(event => event.id === tour.id), 'one completed stop must not hide the rest of the tour');

    const completed = await events.save({
      ...tour,
      stops: tour.stops.map(stop => ({ ...stop, completed: true })),
    }, tour.id);
    assert.equal(completed.revision, 1);
    assert.ok((await events.list()).every(event => event.id !== tour.id), 'an entirely completed tour belongs in past events');
    assert.ok((await events.list(false, true)).some(event => event.id === tour.id));

    const day = new Date().toISOString().slice(0, 10);
    const endedToday = await events.save({
      revision: 0,
      name: 'Ended earlier today',
      location: 'London',
      date: day,
      startTime: '00:00',
      endDate: day,
      endTime: '00:00',
      timezone: 'UTC',
      imageId: seed.imageId,
      published: true,
    });
    assert.ok((await events.list()).every(event => event.id !== endedToday.id), 'an event must leave upcoming when its end time passes');
    assert.ok((await events.list(false, true)).some(event => event.id === endedToday.id));

    const laterToday = await events.save({
      revision: 0,
      name: 'Later today',
      location: 'London',
      date: day,
      startTime: '00:00',
      endDate: day,
      endTime: '23:59',
      timezone: 'UTC',
      imageId: seed.imageId,
      published: true,
    });
    assert.ok((await events.list()).some(event => event.id === laterToday.id), 'an event that has not ended must stay upcoming');

    await assert.rejects(events.save({ ...concert, revision: 2, startTime: '25:00' }, concert.id), { status: 400 });
    await assert.rejects(events.save({ ...concert, revision: 2, timezone: 'Mars/Olympus' }, concert.id), { status: 400 });
    await assert.rejects(events.save({ ...concert, revision: 2, endDate: '2099-12-14' }, concert.id), { status: 400 });
  } finally {
    await database.close();
  }
});
