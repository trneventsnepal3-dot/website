import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const base = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
if (!base || !key) throw new Error('Add SUPABASE_URL and SUPABASE_SECRET_KEY before running this setup.');

const headers = extra => ({
  apikey: key,
  Authorization: `Bearer ${key}`,
  'x-client-info': 'trn-server',
  ...extra,
});

async function call(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text();
    if (text.includes('PGRST205') || /Could not find the table/i.test(text)) {
      throw new Error('Supabase tables are missing. Paste server/schema.sql into the Supabase SQL Editor first, then rerun this command.');
    }
    throw new Error(`Supabase request failed (${response.status}): ${text}`);
  }
  return response.text();
}

const stableUuid = name => {
  const hash = createHash('sha1').update(name).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4000-8000-${hash.slice(12, 24)}`;
};
const publicUrl = (bucket, name) => `${base}/storage/v1/object/public/${bucket}/${encodeURIComponent(name)}`;
const localFile = name => new URL(`../public/media/${name}`, import.meta.url);

async function main() {
  for (const name of ['media', 'song', 'herosectionvideo']) {
    const response = await fetch(`${base}/storage/v1/bucket`, {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name, public: true }),
    });
    const text = await response.text();
    if (!response.ok && !text.includes('BucketAlreadyExists')) throw new Error(`Supabase bucket setup failed (${response.status}): ${text}`);
    console.log(`${name}: storage bucket ready`);
  }

  const gallery = [
    ['IMG_0675.JPG.jpeg', 'The stage is yours.', 'A performer in a red jacket at the end of a stage surrounded by fans'],
    ['IMG_0665.JPEG', 'Closer to the music.', 'A singer leans towards the audience at the front of the stage'],
    ['IMG_0662.JPEG', 'Every voice in the room.', 'The front rows sing along as a performer kneels beside the crowd'],
    ['IMG_0661.JPEG', 'A night turned all the way up.', 'Flames rise above the stage as a performer faces the crowd'],
    ['IMG_0666.JPEG', 'A moment shared.', 'Two performers on stage in front of a packed audience'],
    ['IMG_0669.JPEG', 'Under the stage lights.', 'Performers and a camera operator lit by stage pyrotechnics'],
    ['IMG_0673.JPEG', 'Front-row energy.', 'The crowd raises their hands beside a plume of stage fire'],
    ['IMG_0674.JPG.jpeg', 'One more song.', 'A singer holds the microphone while facing a crowd of phone lights'],
    ['IMG_0676.JPG.jpeg', 'The whole crowd, together.', 'A wide view of the concert stage and audience at night'],
  ];
  const uploads = [
    ...gallery.map(([name]) => ({ bucket: 'media', name, contentType: 'image/jpeg' })),
    { bucket: 'herosectionvideo', name: 'hero-video.mp4', contentType: 'video/mp4' },
    { bucket: 'herosectionvideo', name: 'hero-poster.jpg', contentType: 'image/jpeg' },
  ];
  for (const upload of uploads) {
    const bytes = await readFile(localFile(upload.name));
    await call(`${base}/storage/v1/object/${upload.bucket}/${encodeURIComponent(upload.name)}`, {
      method: 'PUT',
      headers: headers({ 'Content-Type': upload.contentType, 'x-upsert': 'true' }),
      body: bytes,
    });
    console.log(`${upload.name}: uploaded`);
  }

  const upsert = async (table, rows, onConflict = 'id') => call(`${base}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' }),
    body: JSON.stringify(rows),
  });

  const sizeOf = async name => (await stat(localFile(name))).size;
  const findBy = async (table, column, value, select = 'id') => JSON.parse(
    `${await call(`${base}/rest/v1/${table}?${column}=eq.${encodeURIComponent(value)}&select=${select}`, { headers: headers() })}` || '[]'
  );
  const patch = (table, id, body) => call(`${base}/rest/v1/${table}?id=eq.${id}`, {
    method: 'PATCH',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  const insert = async (table, row) => JSON.parse(await call(`${base}/rest/v1/${table}?select=id`, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify(row),
  }))[0].id;
  async function ensureRow(table, row) {
    const [existing] = await findBy(table, 'id', row.id);
    return existing ? existing.id : insert(table, row);
  }
  async function ensureMedia(row, { setKind = true } = {}) {
    const [existing] = await findBy('trn_media', 'pathname', row.pathname, 'id,kind');
    if (existing) {
      await patch('trn_media', existing.id, {
        ...(setKind ? { kind: row.kind } : {}),
        owner: row.owner, name: row.name, url: row.url,
        content_type: row.content_type, size: row.size, storage_bucket: row.storage_bucket,
      });
      return existing.id;
    }
    return insert('trn_media', row);
  }
  async function ensureGallery(row) {
    const [existing] = await findBy('trn_gallery', 'media_id', row.media_id, 'id,album_id');
    if (existing) {
      if (!existing.album_id && row.album_id) await patch('trn_gallery', existing.id, { album_id: row.album_id });
      return existing.id;
    }
    return insert('trn_gallery', row);
  }

  const albumId = '00000000-0000-4000-8000-000000000003';
  const eventImageId = await ensureMedia({
    id: '00000000-0000-4000-8000-000000000002', kind: 'event', pathname: 'trn/original/IMG_0674.JPG.jpeg', owner: 'setup',
    name: 'IMG_0674.JPG.jpeg', url: publicUrl('media', 'IMG_0674.JPG.jpeg'),
    content_type: 'image/jpeg', size: await sizeOf('IMG_0674.JPG.jpeg'), storage_bucket: 'media',
  });
  const heroId = await ensureMedia({
    id: stableUuid('media:hero-video.mp4'), kind: 'hero', pathname: 'trn/original/hero-video.mp4', owner: 'setup',
    name: 'hero-video.mp4', url: publicUrl('herosectionvideo', 'hero-video.mp4'),
    content_type: 'video/mp4', size: await sizeOf('hero-video.mp4'), storage_bucket: 'herosectionvideo',
  });
  const galleryMediaIds = await Promise.all(gallery.map(async ([name]) => ensureMedia({
    id: stableUuid(`media:${name}`), kind: 'gallery', pathname: `trn/original/${name}`, owner: 'setup',
    name, url: publicUrl('media', name), content_type: 'image/jpeg', size: await sizeOf(name), storage_bucket: 'media',
  }, { setKind: false })));

  const galleryBase = `${base}/storage/v1/object/public/media`;
  const [existingSettings] = await findBy('trn_settings', 'id', 1, 'id,hero_id,gallery_base_url');
  if (existingSettings) {
    const changes = {};
    if (!existingSettings.hero_id) changes.hero_id = heroId;
    if (!existingSettings.gallery_base_url) changes.gallery_base_url = galleryBase;
    if (Object.keys(changes).length) await patch('trn_settings', 1, changes);
  } else {
    await upsert('trn_settings', [{
      id: 1, revision: 1, effects_enabled: true, popup_enabled: false, audio_enabled: false,
      hero_video_enabled: true, popup_id: null, audio_id: null, hero_id: heroId, popup_alt: '',
      popup_link: '', audio_volume: 0.35, gallery_base_url: galleryBase,
    }]);
  }

  await ensureRow('trn_albums', { id: albumId, revision: 0, name: 'Live archive', cover_id: galleryMediaIds[0] });

  await Promise.all(gallery.map(([name, caption, alt], index) => ensureGallery({
    id: stableUuid(`gallery:${name}`), media_id: galleryMediaIds[index], album_id: albumId, caption, alt,
  })));

  await ensureRow('trn_events', {
    id: '00000000-0000-4000-8000-000000000001', revision: 0, name: 'Sushant KC Live',
    location: 'United Kingdom', event_date: '2027-03-28', date_tba: false, image_id: eventImageId,
    published: true, event_type: 'concert', artist: '', description: '', stops: [], is_past: false,
    organizer: '', organizer_type: 'org', organizer_message: '', event_number: '', music_id: null,
    start_time: null, end_date: null, end_time: null, timezone: 'Asia/Kathmandu',
    album_id: null, recap_url: null,
  });

  await upsert('trn_migrations', [
    { name: 'seed-live-events-2027' }, { name: 'seed-gallery-photos' }, { name: 'gallery-albums' },
  ], 'name');

  console.log('Supabase is seeded and active. Remove DB_PRIMARY=supabase to return to Neon-first mode.');
}

await main();
