import { randomUUID } from 'node:crypto';
import { z } from 'zod';
const date = z.iso.date('Enter a valid date including the year.').refine(value => value >= '1900-01-01' && value <= '2200-12-31', 'Choose a year between 1900 and 2200.');
const location = z.string().trim().min(1,'Enter a location.').max(160);
const stop = z.object({ date, location }).strict();
const schema = z.object({ revision: z.number().int().nonnegative(), name: z.string().trim().min(1,'Enter an event name.').max(160), location: location.optional(), date: date.optional(), imageId: z.uuid('Upload an event photo.'), published: z.boolean(), type: z.enum(['concert','tour']).default('concert'), artist: z.string().trim().max(160).default(''), description: z.string().trim().max(5000).default(''), stops: z.array(stop).max(100).default([]) }).strict().superRefine((event,ctx) => {
  const issue = message => ctx.addIssue({ code: 'custom', message });
  if (event.type === 'tour') {
    if (!event.artist) issue('Enter the artist for this tour.');
    if (event.stops.length < 2) issue('Add at least two tour dates and locations.');
    const keys = event.stops.map(s => `${s.date}|${s.location.toLowerCase()}`);
    if (new Set(keys).size !== keys.length) issue('Remove duplicate tour dates at the same location.');
  } else if (!event.date || !event.location) issue('Enter the concert date and location.');
});
const reject = (status, message) => { throw Object.assign(new Error(message), { status }); };
export function createEvents(db) {
  async function list(admin = false) {
    const rows = await db(`SELECT e.id,e.revision,e.name,e.location,to_char(e.event_date,'YYYY-MM-DD') AS date,e.image_id AS "imageId",m.url AS "imageUrl",e.published,e.event_type AS type,e.artist,e.description,e.stops FROM trn_events e JOIN trn_media m ON m.id=e.image_id WHERE ($1 OR e.published) ORDER BY e.event_date,e.name,e.id`, [admin]);
    return rows.map(event => ({ ...event, stops: event.type === 'tour' ? event.stops : [{date:event.date,location:event.location}] }));
  }
  return {
    list,
    async save(body, id) {
      const parsed = schema.safeParse(body);
      if (!parsed.success) reject(400, parsed.error.issues[0]?.message || 'Check the event details.');
      const e = parsed.data;
      const stops = e.type === 'tour' ? [...e.stops].sort((a,b) => a.date.localeCompare(b.date) || a.location.localeCompare(b.location)) : [{ date:e.date, location:e.location }];
      if (!(await db("SELECT id FROM trn_media WHERE id=$1 AND kind='event' AND url IS NOT NULL",[e.imageId])).length) reject(400,'Upload a valid event photo.');
      const values = [e.name,stops[0].location,stops[0].date,e.imageId,e.published,e.type,e.artist,e.description,JSON.stringify(stops)];
      if (id) {
        const rows = await db('UPDATE trn_events SET name=$1,location=$2,event_date=$3,image_id=$4,published=$5,event_type=$6,artist=$7,description=$8,stops=$9::jsonb,revision=revision+1 WHERE id=$10 AND revision=$11 RETURNING id',[...values,id,e.revision]);
        if (!rows.length) reject(409,'This event changed in another session. Reload events before saving.');
      } else {
        id = randomUUID();
        await db('INSERT INTO trn_events(name,location,event_date,image_id,published,event_type,artist,description,stops,id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)',[...values,id]);
      }
      return (await list(true)).find(event => event.id === id);
    },
    async remove(id, body) {
      if (!Number.isInteger(body?.revision) || body.revision < 0) reject(400,'Missing event revision.');
      const rows = await db('DELETE FROM trn_events WHERE id=$1 AND revision=$2 RETURNING id',[id,body.revision]);
      if (!rows.length) reject(409,'This event changed in another session. Reload events before removing it.');
      return { ok: true };
    },
  };
}
