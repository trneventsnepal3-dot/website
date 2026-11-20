import { randomUUID } from 'node:crypto';
import { z } from 'zod';
const clean = value => value === '' || value === null ? undefined : value;
const date = z.preprocess(clean, z.iso.date('Enter a valid date including the year.').refine(value => value >= '1900-01-01' && value <= '2200-12-31', 'Choose a year between 1900 and 2200.').optional());
const location = z.preprocess(clean, z.string().trim().min(1,'Enter a location.').max(160));
const clock = z.preprocess(clean, z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Enter a valid time as HH:MM.').optional());
const validTimeZone = value => { try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return true; } catch { return false; } };
const optionalTimeZone = z.string().trim().max(64).refine(validTimeZone, 'Choose a valid time zone.');
const recapUrl = z.preprocess(clean, z.url('Enter a valid recap link.').refine(value => value.startsWith('https://'), 'Use an https:// link.').optional());
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com']);
const youtubeVideoId = value => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] || '';
    if (YOUTUBE_HOSTS.has(host)) return url.searchParams.get('v') || /^\/(?:embed|shorts|live|v)\/([^/?#]+)/.exec(url.pathname)?.[1] || '';
  } catch { /* Accept a bare video ID below. */ }
  return YOUTUBE_ID.test(raw) ? raw : '';
};
const aftermovieUrl = z.preprocess(clean, z.string().trim().max(400).refine(value => YOUTUBE_ID.test(youtubeVideoId(value)), 'Enter a valid YouTube link for this show.').optional());
const stop = z.object({ date, dateTba: z.boolean().default(false), location, startTime: clock, endDate: date, endTime: clock, timezone: z.preprocess(clean, optionalTimeZone.optional()), completed: z.boolean().default(false), aftermovieUrl });
export const schema = z.object({ revision: z.number().int().nonnegative(), name: z.string().trim().min(1,'Enter an event name.').max(160), location: location.optional(), date: date, dateTba: z.boolean().default(false), imageId: z.uuid('Upload an event photo.'), published: z.boolean(), type: z.enum(['concert','tour']).default('concert'), artist: z.string().trim().max(160).default(''), description: z.string().trim().max(5000).default(''), stops: z.array(stop).max(100).default([]), isPast: z.boolean().default(false), organizer: z.string().trim().max(160).default(''), organizerType: z.enum(['org','tour']).default('org'), organizerMessage: z.string().trim().max(2000).default(''), eventNumber: z.string().trim().max(20).default(''), musicId: z.preprocess(clean, z.uuid('Choose a valid music track.').nullable().default(null)), startTime: clock, endDate: date, endTime: clock, timezone: z.preprocess(clean, optionalTimeZone.default('Asia/Kathmandu')), albumId: z.preprocess(clean, z.uuid('Choose a valid album.').optional()), recapUrl }).superRefine((event,ctx) => {
  const issue = message => ctx.addIssue({ code: 'custom', message });
  if (event.type === 'tour') {
    if (!event.artist) issue('Enter the artist for this tour.');
    if (event.stops.length < 2) issue('Add at least two tour dates and locations.');
    if (event.stops.some(stop => !stop.dateTba && !event.dateTba && !stop.date)) issue('Enter a date for every show, or mark that show as to be announced.');
    if (event.stops.some((stop, index) => stop.endDate && stop.date && stop.endDate < stop.date)) issue('A show end date cannot be before its start date.');
  } else if (!event.location) issue('Enter the concert location.');
  else if (!event.dateTba && !event.date) issue('Enter the concert date, or mark it as to be announced.');
  if (event.endDate && event.date && event.endDate < event.date) issue('The event end date cannot be before the event date.');
});
const orderStops = stops => [...stops].sort((a,b) => {
  const tbaA = a.dateTba || !a.date, tbaB = b.dateTba || !b.date;
  if (tbaA !== tbaB) return tbaA ? 1 : -1;
  return tbaA ? 0 : a.date.localeCompare(b.date) || a.location.localeCompare(b.location);
});
const persistStop = stop => ({
  date: stop.dateTba ? '' : (stop.date || ''),
  dateTba: Boolean(stop.dateTba),
  location: stop.location,
  ...(stop.startTime ? { startTime: stop.startTime } : {}),
  ...(stop.endDate ? { endDate: stop.endDate } : {}),
  ...(stop.endTime ? { endTime: stop.endTime } : {}),
  ...(stop.timezone ? { timezone: stop.timezone } : {}),
  ...(stop.completed ? { completed: true } : {}),
  ...(stop.aftermovieUrl ? { aftermovieUrl: stop.aftermovieUrl } : {})
});
const normalizeStop = stop => {
  const dateTba = Boolean(stop.dateTba) || !stop.date;
  return {
    ...stop,
    date: dateTba ? '' : (stop.date || ''),
    dateTba,
    ...(stop.completed ? { completed: true } : {})
  };
};
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const dateParts = value => {
  const match = DATE_PATTERN.exec(value || '');
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day ? { year, month, day } : null;
};
const clockParts = value => TIME_PATTERN.test(value || '') ? { hour: Number(value.slice(0, 2)), minute: Number(value.slice(3, 5)) } : { hour: 0, minute: 0 };
const safeTimeZone = value => {
  if (!value) return 'Asia/Kathmandu';
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0); return value; } catch { return 'Asia/Kathmandu'; }
};
const timeZoneOffset = (milliseconds, timeZone) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(milliseconds));
  const value = type => Number(parts.find(part => part.type === type)?.value || 0);
  return Date.UTC(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'), value('second')) - milliseconds;
};
const wallTimeToEpoch = (date, time, timeZone) => {
  const wallTime = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute, 0);
  const firstOffset = timeZoneOffset(wallTime, timeZone);
  let epoch = wallTime - firstOffset;
  const secondOffset = timeZoneOffset(epoch, timeZone);
  if (secondOffset !== firstOffset) epoch = wallTime - secondOffset;
  return epoch;
};
const scheduleEnd = schedule => {
  const startDate = dateParts(schedule.date);
  if (schedule.dateTba || !startDate) return null;
  const timeZone = safeTimeZone(schedule.timezone);
  const start = wallTimeToEpoch(startDate, clockParts(schedule.startTime), timeZone);
  const configuredEnd = dateParts(schedule.endDate);
  const endDate = configuredEnd && schedule.endDate >= schedule.date ? configuredEnd : startDate;
  const end = wallTimeToEpoch(endDate, TIME_PATTERN.test(schedule.endTime || '') ? clockParts(schedule.endTime) : { hour: 23, minute: 59 }, timeZone);
  return end < start ? wallTimeToEpoch(startDate, { hour: 23, minute: 59 }, timeZone) : end;
};
const stopIsPast = (stop, now) => {
  if (stop.completed) return true;
  const end = scheduleEnd(stop);
  return end !== null && now > end;
};
const eventIsPast = (event, now) => {
  if (event.isPast) return true;
  if (event.type === 'tour') return event.stops.length > 0 && event.stops.every(stop => stopIsPast(stop, now));
  const end = scheduleEnd(event);
  return end !== null && now > end;
};
const byName = (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
const upcomingOrder = (a, b) => {
  if (!a.date !== !b.date) return a.date ? -1 : 1;
  return (a.date || '').localeCompare(b.date || '') || byName(a, b);
};
const pastOrder = (a, b) => {
  if (!a.date !== !b.date) return a.date ? -1 : 1;
  return (b.date || '').localeCompare(a.date || '') || byName(a, b);
};
const reject = (status, message) => { throw Object.assign(new Error(message), { status }); };
export function createEvents(db) {
  async function list(admin = false, past = false) {
    const rows = await db(`SELECT e.id,e.revision,e.name,e.location,COALESCE(to_char(e.event_date,'YYYY-MM-DD'),'') AS date,e.date_tba AS "dateTba",e.image_id AS "imageId",m.url AS "imageUrl",e.published,e.event_type AS type,e.artist,e.description,e.stops,e.is_past AS "isPast",e.organizer,e.organizer_type AS "organizerType",e.organizer_message AS "organizerMessage",e.event_number AS "eventNumber",e.music_id AS "musicId",mm.url AS "musicUrl",mm.name AS "musicName",COALESCE(e.start_time,'') AS "startTime",COALESCE(to_char(e.end_date,'YYYY-MM-DD'),'') AS "endDate",COALESCE(e.end_time,'') AS "endTime",COALESCE(e.timezone,'Asia/Kathmandu') AS timezone,e.album_id AS "albumId",a.name AS "albumName",COALESCE(e.recap_url,'') AS "recapUrl" FROM trn_events e JOIN trn_media m ON m.id=e.image_id LEFT JOIN trn_media mm ON mm.id=e.music_id LEFT JOIN trn_albums a ON a.id=e.album_id WHERE ($1 OR e.published)`, [admin]);
    const albumIds = [...new Set(rows.map(event => event.albumId).filter(Boolean))];
    const albumPhotos = new Map();
    if (albumIds.length) {
      const photos = await db(`SELECT g.album_id AS "albumId",g.id,m.url,g.alt FROM trn_gallery g JOIN trn_media m ON m.id=g.media_id WHERE g.album_id IN (${albumIds.map((_,index) => `$${index + 1}`).join(',')}) ORDER BY g.position,g.id`, albumIds);
      for (const photo of photos) {
        const list = albumPhotos.get(photo.albumId) || [];
        list.push({ id: photo.id, url: photo.url, alt: photo.alt });
        albumPhotos.set(photo.albumId, list);
      }
    }
    const events = rows.map(event => {
      const concertStop = {
        date: event.date,
        dateTba: event.dateTba,
        location: event.location,
        ...(event.startTime ? { startTime: event.startTime } : {}),
        ...(event.endDate ? { endDate: event.endDate } : {}),
        ...(event.endTime ? { endTime: event.endTime } : {})
      };
      const stops = (event.type === 'tour' ? (Array.isArray(event.stops) ? event.stops : []) : [concertStop])
        .map(normalizeStop);
      const photos = event.albumId ? (albumPhotos.get(event.albumId) || []) : [];
      return {
        ...event,
        stops,
        album: event.albumId ? { id: event.albumId, name: event.albumName || '', count: photos.length, photos: photos.slice(0, 4) } : null
      };
    });
    if (admin) return events.sort(upcomingOrder);
    const now = Date.now();
    return events.filter(event => past ? eventIsPast(event, now) : !eventIsPast(event, now)).sort(past ? pastOrder : upcomingOrder);
  }
  return {
    list,
    async save(body, id) {
      const parsed = schema.safeParse(body);
      if (!parsed.success) reject(400, parsed.error.issues[0]?.message || 'Check the event details.');
      const e = parsed.data;
      const scheduledStops = e.type === 'tour'
        ? orderStops(e.stops.map(stop => ({ ...stop, dateTba: e.dateTba || stop.dateTba || !stop.date })))
        : [{ date: e.date, dateTba: e.dateTba || !e.date, location: e.location, startTime: e.startTime, endDate: e.endDate, endTime: e.endTime, completed: false }];
      const stops = scheduledStops.map(persistStop);
      const dateTba = stops.every(stop => stop.dateTba);
      if (!(await db("SELECT id FROM trn_media WHERE id=$1 AND kind='event' AND url IS NOT NULL",[e.imageId])).length) reject(400,'Upload a valid event photo.');
      if (e.musicId && !(await db("SELECT id FROM trn_media WHERE id=$1 AND kind='audio' AND url IS NOT NULL",[e.musicId])).length) reject(400,'Choose a valid music track. Re-upload it if the problem continues.');
      if (e.albumId && !(await db('SELECT id FROM trn_albums WHERE id=$1',[e.albumId])).length) reject(400,'This recap album no longer exists. Reload albums.');
      const values = [e.name,stops[0].location,dateTba ? null : (stops[0].date || null),dateTba,e.imageId,e.published,e.type,e.artist,e.description,JSON.stringify(stops),e.isPast,e.organizer,e.organizerType,e.organizerMessage,e.eventNumber,e.musicId || null,e.startTime || null,e.endDate || null,e.endTime || null,e.timezone || 'Asia/Kathmandu',e.albumId || null,e.recapUrl || null];
      if (id) {
        const rows = await db('UPDATE trn_events SET name=$1,location=$2,event_date=$3,date_tba=$4,image_id=$5,published=$6,event_type=$7,artist=$8,description=$9,stops=$10::jsonb,is_past=$11,organizer=$12,organizer_type=$13,organizer_message=$14,event_number=$15,music_id=$16,start_time=$17,end_date=$18,end_time=$19,timezone=$20,album_id=$21,recap_url=$22,revision=revision+1 WHERE id=$23 AND revision=$24 RETURNING id',[...values,id,e.revision]);
        if (!rows.length) reject(409,'This event changed in another session. Reload events before saving.');
      } else {
        id = randomUUID();
        await db('INSERT INTO trn_events(name,location,event_date,date_tba,image_id,published,event_type,artist,description,stops,is_past,organizer,organizer_type,organizer_message,event_number,music_id,start_time,end_date,end_time,timezone,album_id,recap_url,id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)',[...values,id]);
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
