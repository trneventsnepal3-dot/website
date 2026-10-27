import { randomUUID } from 'node:crypto';
import { z } from 'zod';
const schema = z.object({ revision: z.number().int().nonnegative(), name: z.string().trim().min(1,'Enter an event name.').max(160), location: z.string().trim().min(1,'Enter a location.').max(160), date: z.iso.date('Enter a valid date including the year.').refine(value => value >= '1900-01-01' && value <= '2200-12-31', 'Choose a year between 1900 and 2200.'), imageId: z.uuid('Upload an event photo.'), published: z.boolean() }).strict();
const reject = (status, message) => { throw Object.assign(new Error(message), { status }); };
export function createEvents(db) {
  async function list(admin = false) {
    return db(`SELECT e.id,e.revision,e.name,e.location,to_char(e.event_date,'YYYY-MM-DD') AS date,e.image_id AS "imageId",m.url AS "imageUrl",e.published FROM trn_events e JOIN trn_media m ON m.id=e.image_id WHERE ($1 OR e.published) ORDER BY e.event_date,e.name,e.id`, [admin]);
  }
  return {
    list,
    async save(body, id) {
      const parsed = schema.safeParse(body);
      if (!parsed.success) reject(400, parsed.error.issues[0]?.message || 'Check the event details.');
      const e = parsed.data;
      if (!(await db("SELECT id FROM trn_media WHERE id=$1 AND kind='event' AND url IS NOT NULL",[e.imageId])).length) reject(400,'Upload a valid event photo.');
      if (id) {
        const rows = await db('UPDATE trn_events SET name=$1,location=$2,event_date=$3,image_id=$4,published=$5,revision=revision+1 WHERE id=$6 AND revision=$7 RETURNING id',[e.name,e.location,e.date,e.imageId,e.published,id,e.revision]);
        if (!rows.length) reject(409,'This event changed in another session. Reload events before saving.');
      } else {
        id = randomUUID();
        await db('INSERT INTO trn_events(id,name,location,event_date,image_id,published) VALUES($1,$2,$3,$4,$5,$6)',[id,e.name,e.location,e.date,e.imageId,e.published]);
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
