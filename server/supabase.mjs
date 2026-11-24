const encoder = value => encodeURIComponent(String(value));

function configured(env) {
  return Boolean(env.SUPABASE_URL && (env.SUPABASE_SECRET_KEY || env.SUPABASE_PUBLISHABLE_KEY));
}

function secret(env) {
  return env.SUPABASE_SECRET_KEY || env.SUPABASE_PUBLISHABLE_KEY;
}

function headers(env, extra = {}) {
  const key = secret(env);
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'x-client-info': 'trn-server',
    ...extra,
  };
}

async function request(env, path, { method = 'GET', query = {}, body, prefer, } = {}) {
  const url = new URL(path, env.SUPABASE_URL.replace(/\/$/, '') + '/');
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  const extra = {};
  if (body !== undefined) extra['Content-Type'] = 'application/json';
  if (prefer) extra.Prefer = prefer;
  const response = await fetch(url, {
    method,
    headers: headers(env, extra),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    const error = new Error(`Supabase ${method} ${path} failed (${response.status}): ${text}`);
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return [];
  const text = await response.text();
  return text ? JSON.parse(text) : [];
}

const table = (env, name, options) => request(env, `rest/v1/${name}`, options);
const iso = milliseconds => new Date(milliseconds).toISOString();
const dateOnly = value => value ? String(value).slice(0, 10) : '';

async function rowsByIds(env, name, ids, select = 'id') {
  if (!ids.length) return [];
  return table(env, name, { query: { select, id: `in.(${ids.join(',')})` } });
}

async function allMedia(env, select = 'id,name,url,kind') {
  return table(env, 'trn_media', { query: { select, order: 'created_at.asc,id.asc' } });
}

function eventRow(event, media, albums) {
  const picture = media.get(event.image_id);
  const music = event.music_id ? media.get(event.music_id) : null;
  return {
    id: event.id,
    revision: event.revision,
    name: event.name,
    location: event.location,
    date: dateOnly(event.event_date),
    dateTba: Boolean(event.date_tba),
    imageId: event.image_id,
    imageUrl: picture?.url || null,
    published: event.published,
    type: event.event_type || 'concert',
    artist: event.artist || '',
    description: event.description || '',
    stops: Array.isArray(event.stops) ? event.stops : [],
    isPast: Boolean(event.is_past),
    organizer: event.organizer || '',
    organizerType: event.organizer_type || 'org',
    organizerMessage: event.organizer_message || '',
    eventNumber: event.event_number || '',
    musicId: event.music_id || null,
    musicUrl: music?.url || null,
    musicName: music?.name || null,
    startTime: event.start_time || '',
    endDate: dateOnly(event.end_date),
    endTime: event.end_time || '',
    timezone: event.timezone || 'Asia/Kathmandu',
    albumId: event.album_id || null,
    albumName: event.album_id ? albums.get(event.album_id) || null : null,
    recapUrl: event.recap_url || '',
  };
}

const eventColumns = values => ({
  name: values[0],
  location: values[1],
  event_date: values[2] || null,
  date_tba: values[3],
  image_id: values[4],
  published: values[5],
  event_type: values[6],
  artist: values[7],
  description: values[8],
  stops: typeof values[9] === 'string' ? JSON.parse(values[9]) : values[9],
  is_past: values[10],
  organizer: values[11],
  organizer_type: values[12],
  organizer_message: values[13],
  event_number: values[14],
  music_id: values[15] || null,
  start_time: values[16] || null,
  end_date: values[17] || null,
  end_time: values[18] || null,
  timezone: values[19] || 'Asia/Kathmandu',
  album_id: values[20] || null,
  recap_url: values[21] || null,
});

async function listEvents(env, admin) {
  const [events, mediaRows, albumsRows] = await Promise.all([
    table(env, 'trn_events', { query: { select: '*', ...(admin ? {} : { published: 'eq.true' }) } }),
    allMedia(env),
    table(env, 'trn_albums', { query: { select: 'id,name' } }),
  ]);
  const media = new Map(mediaRows.map(row => [row.id, row]));
  const albums = new Map(albumsRows.map(row => [row.id, row.name]));
  return events.map(event => eventRow(event, media, albums));
}

export function createSupabaseQuery(env = process.env) {
  return async function supabaseQuery(statement, values = []) {
    const sql = String(statement).replace(/\s+/g, ' ').trim();
    const missing = error => {
      if (error.status === 404 && /trn_/.test(sql)) {
        throw new Error('Supabase tables are missing. Paste server/schema.sql into the Supabase SQL Editor, then run npm run supabase:setup.');
      }
      throw error;
    };
    try {
      if (sql === 'SELECT analytics_ready() AS ready') {
        try {
          const value = await request(env, 'rest/v1/rpc/analytics_ready', { method: 'POST', body: {} });
          return [{ ready: value === true }];
        } catch (error) {
          if (error.status === 404) return [{ ready: false }];
          throw error;
        }
      }
      if (sql.startsWith('SELECT analytics_track($1::jsonb) AS result')) {
        const payload = typeof values[0] === 'string' ? JSON.parse(values[0]) : values[0];
        const result = await request(env, 'rest/v1/rpc/analytics_track', { method: 'POST', body: { payload } });
        return [{ result }];
      }
      if (sql.startsWith('SELECT analytics_dashboard($1,$2,$3,$4) AS data')) {
        const [p_from, p_to, p_tz, p_granularity] = values;
        const result = await request(env, 'rest/v1/rpc/analytics_dashboard', {
          method: 'POST',
          body: { p_from, p_to, p_tz, p_granularity },
        });
        return [{ data: result }];
      }
      if (sql.startsWith('SELECT analytics_live($1) AS data')) {
        const result = await request(env, 'rest/v1/rpc/analytics_live', { method: 'POST', body: { p_tz: values[0] } });
        return [{ data: result }];
      }
      if (sql === 'SELECT token FROM trn_sessions WHERE token=$1 AND credential=$2 AND expires_at > now()') {
        return await table(env, 'trn_sessions', { query: { select: 'token', token: `eq.${values[0]}`, credential: `eq.${values[1]}`, expires_at: `gt.${iso(Date.now())}` } });
      }
      if (sql === 'SELECT * FROM trn_settings WHERE id=1') {
        return await table(env, 'trn_settings', { query: { select: '*', id: 'eq.1' } });
      }
      if (sql.startsWith('SELECT id, kind, url, name, content_type, size FROM trn_media WHERE id=$1 OR id=$2 OR id=$3')) {
        return await rowsByIds(env, 'trn_media', values.filter(Boolean), 'id,kind,url,name,content_type,size');
      }
      if (sql.startsWith('INSERT INTO trn_login_limits')) {
        const key = values[0];
        const [current] = await table(env, 'trn_login_limits', { query: { select: 'attempts,resets_at', key: `eq.${key}` } });
        const now = Date.now();
        const attempts = current && new Date(current.resets_at).getTime() > now ? current.attempts + 1 : 1;
        const resets_at = iso(now + 15 * 60 * 1000);
        return await table(env, 'trn_login_limits', {
          method: 'POST',
          query: { on_conflict: 'key' },
          body: { key, attempts, resets_at },
          prefer: 'resolution=merge-duplicates,return=representation',
        });
      }
      if (sql === 'DELETE FROM trn_sessions WHERE expires_at < now()') {
        return await table(env, 'trn_sessions', { method: 'DELETE', query: { expires_at: `lt.${iso(Date.now())}` }, prefer: 'return=representation' });
      }
      if (sql.startsWith('INSERT INTO trn_sessions')) {
        await table(env, 'trn_sessions', {
          method: 'POST',
          body: { token: values[0], credential: values[1], expires_at: iso(Date.now() + 12 * 60 * 60 * 1000) },
        });
        return [];
      }
      if (sql === 'DELETE FROM trn_sessions WHERE token=$1') {
        return await table(env, 'trn_sessions', { method: 'DELETE', query: { token: `eq.${values[0]}` }, prefer: 'return=representation' });
      }
      if (sql.startsWith('INSERT INTO trn_media(') && sql.includes('storage_bucket')) {
        const [id, kind, pathname, owner, name, storage_bucket, content_type, size] = values;
        return await table(env, 'trn_media', {
          method: 'POST',
          body: { id, kind, pathname, owner, name, storage_bucket, content_type, size },
        });
      }
      if (sql.startsWith('SELECT * FROM trn_media WHERE pathname=$1 AND owner=$2')) {
        return await table(env, 'trn_media', { query: { select: '*', pathname: `eq.${values[0]}`, owner: `eq.${values[1]}` } });
      }
      if (sql.startsWith('UPDATE trn_media SET url=')) {
        return await table(env, 'trn_media', {
          method: 'PATCH',
          query: { id: `eq.${values[3]}`, select: 'id,kind,url,name,content_type,size' },
          body: { url: values[0], content_type: values[1], size: values[2] },
          prefer: 'return=representation',
        });
      }
      if (sql.startsWith('UPDATE trn_settings SET revision=revision+1')) {
        const [effects, popup, audio, heroVideo, popupId, audioId, popupAlt, popupLink, volume, heroId, revision] = values;
        return await table(env, 'trn_settings', {
          method: 'PATCH',
          query: { id: 'eq.1', revision: `eq.${revision}`, select: 'revision' },
          body: {
            revision: revision + 1,
            effects_enabled: effects,
            popup_enabled: popup,
            audio_enabled: audio,
            hero_video_enabled: heroVideo,
            popup_id: popupId || null,
            audio_id: audioId || null,
            popup_alt: popupAlt,
            popup_link: popupLink,
            audio_volume: volume,
            hero_id: heroId || null,
          },
          prefer: 'return=representation',
        });
      }
      if (sql.includes('FROM trn_events e JOIN trn_media m ON m.id=e.image_id')) {
        return await listEvents(env, Boolean(values[0]));
      }
      if (sql.startsWith('SELECT g.album_id AS "albumId"')) {
        if (!values.length) return [];
        const [photos, mediaRows] = await Promise.all([
          table(env, 'trn_gallery', { query: { select: 'id,album_id,media_id,alt', album_id: `in.(${values.join(',')})`, order: 'position.asc,id.asc' } }),
          allMedia(env, 'id,url'),
        ]);
        const media = new Map(mediaRows.map(row => [row.id, row.url]));
        return photos.map(photo => ({ albumId: photo.album_id, id: photo.id, url: media.get(photo.media_id) || null, alt: photo.alt }));
      }
      if (sql === 'SELECT id FROM trn_media WHERE id=$1 AND kind=$2 AND url IS NOT NULL') {
        return await table(env, 'trn_media', { query: { select: 'id', id: `eq.${values[0]}`, kind: `eq.${values[1]}`, url: 'not.is.null' } });
      }
      const mediaKind = /^SELECT id FROM trn_media WHERE id=\$1 AND kind='([^']+)' AND url IS NOT NULL/.exec(sql);
      if (mediaKind) {
        return await table(env, 'trn_media', { query: { select: 'id', id: `eq.${values[0]}`, kind: `eq.${mediaKind[1]}`, url: 'not.is.null' } });
      }
      if (sql.startsWith("SELECT id FROM trn_media WHERE id=$1 AND kind IN ('gallery','event') AND url IS NOT NULL")) {
        return await table(env, 'trn_media', { query: { select: 'id', id: `eq.${values[0]}`, kind: 'in.(gallery,event)', url: 'not.is.null' } });
      }
      if (sql === 'SELECT id FROM trn_albums WHERE id=$1') {
        return await table(env, 'trn_albums', { query: { select: 'id', id: `eq.${values[0]}` } });
      }
      if (sql.startsWith('SELECT id FROM trn_gallery WHERE media_id=$1')) {
        return await table(env, 'trn_gallery', { query: { select: 'id', media_id: `eq.${values[0]}` } });
      }
      if (sql.startsWith('UPDATE trn_events SET name=')) {
        return await table(env, 'trn_events', {
          method: 'PATCH',
          query: { id: `eq.${values[22]}`, revision: `eq.${values[23]}`, select: 'id' },
          body: { ...eventColumns(values), revision: values[23] + 1 },
          prefer: 'return=representation',
        });
      }
      if (sql.startsWith('INSERT INTO trn_events(')) {
        return await table(env, 'trn_events', {
          method: 'POST',
          query: { select: 'id' },
          body: { id: values[22], revision: 0, ...eventColumns(values) },
          prefer: 'return=representation',
        });
      }
      if (sql.startsWith('DELETE FROM trn_events WHERE id=$1 AND revision=$2')) {
        return await table(env, 'trn_events', { method: 'DELETE', query: { id: `eq.${values[0]}`, revision: `eq.${values[1]}`, select: 'id' }, prefer: 'return=representation' });
      }
      if (sql.startsWith('SELECT g.id,g.revision,g.media_id')) {
        const [photos, mediaRows] = await Promise.all([
          table(env, 'trn_gallery', { query: { select: 'id,revision,media_id,album_id,caption,alt', order: 'position.asc,id.asc' } }),
          allMedia(env, 'id,url,name'),
        ]);
        const media = new Map(mediaRows.map(row => [row.id, row]));
        return photos.map(photo => ({
          id: photo.id,
          revision: photo.revision,
          mediaId: photo.media_id,
          albumId: photo.album_id || null,
          caption: photo.caption || '',
          alt: photo.alt || '',
          url: media.get(photo.media_id)?.url || null,
          name: media.get(photo.media_id)?.name || '',
        }));
      }
      if (sql.startsWith('UPDATE trn_gallery SET caption=')) {
        const [caption, altInput, mediaId, id, revision, fallbackAlt, albumId] = values;
        const [current] = await table(env, 'trn_gallery', { query: { select: 'caption,alt,album_id', id: `eq.${id}`, revision: `eq.${revision}` } });
        if (!current) return [];
        const currentAlt = current.alt || '';
        const body = {
          caption: caption === null || caption === undefined ? current.caption || '' : caption,
          alt: altInput ? altInput : (currentAlt || fallbackAlt),
          media_id: mediaId,
          album_id: albumId === null || albumId === undefined ? current.album_id || null : albumId,
          revision: revision + 1,
        };
        return await table(env, 'trn_gallery', {
          method: 'PATCH',
          query: { id: `eq.${id}`, revision: `eq.${revision}`, select: 'id' },
          body,
          prefer: 'return=representation',
        });
      }
      if (sql.startsWith('INSERT INTO trn_gallery(')) {
        return await table(env, 'trn_gallery', {
          method: 'POST',
          query: { select: 'id' },
          body: { media_id: values[0], caption: values[1] || '', alt: values[2], album_id: values[3] || null },
          prefer: 'return=representation',
        });
      }
      if (sql.startsWith('DELETE FROM trn_gallery WHERE id=$1 AND revision=$2')) {
        return await table(env, 'trn_gallery', { method: 'DELETE', query: { id: `eq.${values[0]}`, revision: `eq.${values[1]}`, select: 'id' }, prefer: 'return=representation' });
      }
      if (sql.startsWith('SELECT a.id,a.revision,a.name,a.cover_id')) {
        const [albums, mediaRows] = await Promise.all([
          table(env, 'trn_albums', { query: { select: 'id,revision,name,cover_id', order: 'position.asc,id.asc' } }),
          allMedia(env, 'id,url'),
        ]);
        const media = new Map(mediaRows.map(row => [row.id, row.url]));
        return albums.map(album => ({ id: album.id, revision: album.revision, name: album.name, coverId: album.cover_id, coverUrl: media.get(album.cover_id) || null }));
      }
      if (sql.startsWith('UPDATE trn_albums SET name=')) {
        return await table(env, 'trn_albums', {
          method: 'PATCH',
          query: { id: `eq.${values[2]}`, revision: `eq.${values[3]}`, select: 'id' },
          body: { name: values[0], cover_id: values[1], revision: values[3] + 1 },
          prefer: 'return=representation',
        });
      }
      if (sql.startsWith('INSERT INTO trn_albums(')) {
        return await table(env, 'trn_albums', {
          method: 'POST',
          query: { select: 'id' },
          body: { name: values[0], cover_id: values[1] },
          prefer: 'return=representation',
        });
      }
      if (sql.startsWith('DELETE FROM trn_albums WHERE id=$1 AND revision=$2')) {
        return await table(env, 'trn_albums', { method: 'DELETE', query: { id: `eq.${values[0]}`, revision: `eq.${values[1]}`, select: 'id' }, prefer: 'return=representation' });
      }
      throw new Error(`Unsupported Supabase query: ${sql.slice(0, 120)}`);
    } catch (error) {
      missing(error);
    }
  };
}

export function createSupabaseStorage(env = process.env) {
  const bucket = kind => ({
    popup: env.SUPABASE_MEDIA_BUCKET || 'media',
    event: env.SUPABASE_MEDIA_BUCKET || 'media',
    gallery: env.SUPABASE_MEDIA_BUCKET || 'media',
    audio: env.SUPABASE_SONG_BUCKET || 'song',
    hero: env.SUPABASE_HERO_BUCKET || 'herosectionvideo',
  })[kind];
  const publicUrl = (bucketName, key) => `${env.SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/${bucketName}/${key.split('/').map(encoder).join('/')}`;
  return {
    configured: () => configured(env),
    bucket,
    publicUrl,
    async authorize({ kind, pathname, contentType }) {
      const bucketName = bucket(kind);
      const key = `${bucketName}/${pathname.split('/').map(encoder).join('/')}`;
      const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/upload/sign/${key}`, {
        method: 'POST',
        headers: headers(env, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ expiresIn: 600 }),
      });
      if (!response.ok) throw new Error(`Supabase upload authorization failed (${response.status}): ${await response.text()}`);
      const data = await response.json();
      const signed = data.url.startsWith('http') ? data.url : `${env.SUPABASE_URL.replace(/\/$/, '')}/storage/v1${data.url}`;
      return { url: signed, method: 'PUT', headers: { 'Content-Type': contentType }, bucket: bucketName };
    },
    async head(bucketName, key) {
      const object = `${bucketName}/${key.split('/').map(encoder).join('/')}`;
      const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/info/${object}`, { headers: headers(env) });
      if (!response.ok) throw new Error(`Supabase storage lookup failed (${response.status}): ${await response.text()}`);
      const info = await response.json();
      return { url: publicUrl(bucketName, key), contentType: info.content_type, size: info.size };
    },
  };
}
