import { neon } from '@neondatabase/serverless';
import { createStorage, mediaTypes as types, mediaLimits as limits, mediaExtension } from './storage.mjs';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { digest, verifyPassword } from './password.mjs';
import { createEvents } from './events.mjs';
import { createGallery } from './gallery.mjs';

const settingSchema = z.object({ revision: z.number().int().nonnegative(), effectsEnabled: z.boolean(), popupEnabled: z.boolean(), audioEnabled: z.boolean(), heroVideoEnabled: z.boolean(), popupId: z.uuid().nullable(), audioId: z.uuid().nullable(), heroId: z.uuid().nullable(), popupAlt: z.string().trim().max(240), popupLink: z.union([z.literal(''), z.url().refine(v => v.startsWith('https://'), 'Use an https:// link')]), audioVolume: z.number().min(0).max(1) }).strict();
const uploadSchema = z.object({ kind: z.enum(['popup', 'audio', 'hero', 'event', 'gallery']), name: z.string().trim().min(1).max(200), contentType: z.string(), size: z.number().int().positive() }).strict();
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };
async function readBody(req) {
  if (req.body !== undefined) { const value = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; if (JSON.stringify(value).length > 65536) fail(413, 'Request too large.'); return value; }
  let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 65536) fail(413, 'Request too large.'); }
  try { return JSON.parse(raw || '{}'); } catch { fail(400, 'Invalid request.'); }
}
export function createHandler({ env = process.env, query, storage = createStorage(env) } = {}) {
  let sql;
  const db = async (statement, values = []) => {
    if (query) return query(statement, values);
    if (!env.DATABASE_URL) fail(503, 'Add DATABASE_URL and run the database migration.');
    sql ||= neon(env.DATABASE_URL);
    return sql.query(statement, values);
  };
  const credential = () => digest(env.ADMIN_PASSWORD_HASH || '');
  const events = createEvents(db);
  const gallery = createGallery(db);
  const configured = () => { if (!env.ADMIN_PASSWORD_HASH) fail(503, 'Set ADMIN_PASSWORD_HASH using npm run admin:password.'); };
  const tokenOf = req => /(?:^|;\s*)trn_admin=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || '')?.[1];
  async function authenticate(req) {
    configured();
    const token = tokenOf(req);
    if (!token) fail(401, 'Please sign in.');
    const rows = await db('SELECT token FROM trn_sessions WHERE token=$1 AND credential=$2 AND expires_at > now()', [digest(token), credential()]);
    if (!rows.length) fail(401, 'Your session has expired. Please sign in.');
    return digest(token);
  }
  function csrf(req) {
    let origin; try { origin = new URL(req.headers.origin); } catch { fail(403, 'Invalid request origin.'); }
    if (origin.host !== req.headers.host || req.headers['x-trn-admin'] !== '1') fail(403, 'Invalid request origin.');
  }
  async function settings() {
    const [s] = await db('SELECT * FROM trn_settings WHERE id=1');
    if (!s) fail(503, 'Run npm run db:migrate to initialize the database.');
    const assets = await db('SELECT id, kind, url, name, content_type, size FROM trn_media WHERE id=$1 OR id=$2 OR id=$3', [s.popup_id, s.audio_id, s.hero_id]);
    const media = id => assets.find(a => a.id === id && a.url) || null;
    return { revision: s.revision, effectsEnabled: s.effects_enabled, popupEnabled: s.popup_enabled, audioEnabled: s.audio_enabled, heroVideoEnabled: s.hero_video_enabled, popupId: s.popup_id, audioId: s.audio_id, heroId: s.hero_id, popupAlt: s.popup_alt, popupLink: s.popup_link, audioVolume: s.audio_volume, popup: media(s.popup_id), audio: media(s.audio_id), hero: media(s.hero_id), galleryBaseUrl: s.gallery_base_url };
  }
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status, data) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
    const cookie = (token, age) => res.setHeader('Set-Cookie', `trn_admin=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${env.VERCEL || env.NODE_ENV === 'production' ? '; Secure' : ''}`);
    try {
      const path = new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '');
      const method = req.method;
      if (path === '/api/site-settings' && method === 'GET') return send(200, await settings());
      if (path === '/api/events' && method === 'GET') return send(200, await events.list());
      if (path === '/api/gallery' && method === 'GET') return send(200, await gallery.list());
      if (!path.startsWith('/api/admin/')) fail(404, 'Not found.');
      if (path === '/api/admin/login' && method === 'POST') {
        csrf(req); configured();
        const body = await readBody(req);
        if (typeof body.password !== 'string' || body.password.length > 128) fail(400, 'Enter a valid password.');
        const ip = env.VERCEL ? req.headers['x-vercel-forwarded-for'] || 'unknown' : req.socket.remoteAddress || 'local';
        const [rate] = await db(`INSERT INTO trn_login_limits(key,attempts,resets_at) VALUES($1,1,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN trn_login_limits.resets_at < now() THEN 1 ELSE trn_login_limits.attempts+1 END, resets_at=CASE WHEN trn_login_limits.resets_at < now() THEN now()+interval '15 minutes' ELSE trn_login_limits.resets_at END RETURNING attempts`, [digest(String(ip))]);
        if (rate.attempts > 8) fail(429, 'Too many attempts. Try again in 15 minutes.');
        if (!await verifyPassword(body.password, env.ADMIN_PASSWORD_HASH)) fail(401, 'Incorrect password.');
        const token = randomBytes(32).toString('base64url');
        await db('DELETE FROM trn_sessions WHERE expires_at < now()');
        await db("INSERT INTO trn_sessions(token,credential,expires_at) VALUES($1,$2,now()+interval '12 hours')", [digest(token), credential()]);
        cookie(token, 43200); return send(200, { authenticated: true });
      }
      if (path === '/api/admin/uploads' && method === 'POST') {
        csrf(req); const owner = await authenticate(req);
        if (!storage.configured()) fail(503, 'Add the Neon object storage credentials to enable uploads.');
        const parsed = uploadSchema.safeParse(await readBody(req));
        if (!parsed.success) fail(400, 'Invalid upload details.');
        const { kind, name, contentType, size } = parsed.data;
        if (!types[kind].includes(contentType) || size > limits[kind]) fail(400, 'Unsupported file type or size.');
        const id = randomUUID();
        const pathname = `trn/${kind}/${id}.${mediaExtension(contentType)}`;
        const signed = await storage.authorize({ kind, pathname, contentType, size });
        await db('INSERT INTO trn_media(id,kind,pathname,owner,name,storage_bucket,content_type,size) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [id, kind, pathname, owner, name, signed.bucket, contentType, size]);
        return send(200, { id, pathname, url: signed.url, method: signed.method, headers: signed.headers });
      }
      const owner = await authenticate(req);
      if (method !== 'GET') csrf(req);
      if (path === '/api/admin/gallery' && method === 'GET') return send(200, await gallery.list());
      if (path === '/api/admin/gallery' && method === 'POST') return send(201, await gallery.save(await readBody(req)));
      const galleryPath = /^\/api\/admin\/gallery\/([a-f0-9-]+)$/.exec(path);
      if (galleryPath) {
        if (!z.uuid().safeParse(galleryPath[1]).success) fail(400, 'Invalid photo.');
        if (method === 'PUT') return send(200, await gallery.save(await readBody(req),galleryPath[1]));
        if (method === 'DELETE') return send(200, await gallery.remove(galleryPath[1],await readBody(req)));
      }
      if (path === '/api/admin/events' && method === 'GET') return send(200, await events.list(true));
      if (path === '/api/admin/events' && method === 'POST') return send(201, await events.save(await readBody(req)));
      const eventPath = /^\/api\/admin\/events\/([a-f0-9-]+)$/.exec(path);
      if (eventPath) {
        if (!z.uuid().safeParse(eventPath[1]).success) fail(400, 'Invalid event.');
        if (method === 'PUT') return send(200, await events.save(await readBody(req),eventPath[1]));
        if (method === 'DELETE') return send(200, await events.remove(eventPath[1],await readBody(req)));
      }
      if (path === '/api/admin/session' && method === 'GET') return send(200, { authenticated: true });
      if (path === '/api/admin/logout' && method === 'POST') { await db('DELETE FROM trn_sessions WHERE token=$1', [owner]); cookie('', 0); return send(200, { ok: true }); }
      if (path === '/api/admin/settings' && method === 'GET') return send(200, { ...await settings(), uploadsAvailable: storage.configured() });
      if (path === '/api/admin/media' && method === 'POST') {
        const body = await readBody(req);
        if (typeof body.pathname !== 'string') fail(400, 'Missing upload path.');
        const [media] = await db('SELECT * FROM trn_media WHERE pathname=$1 AND owner=$2', [body.pathname, owner]);
        if (!media) fail(404, 'Upload not found.');
        if (!media.storage_bucket || media.storage_bucket !== storage.bucket(media.kind)) fail(400, 'Upload is not in the expected Neon bucket.');
        const info = await storage.head(media.storage_bucket, media.pathname);
        if (!types[media.kind].includes(info.contentType) || info.size !== media.size || info.contentType !== media.content_type || info.size > limits[media.kind]) fail(400, 'Uploaded file does not match the authorized type and size.');
        const [saved] = await db('UPDATE trn_media SET url=$1,content_type=$2,size=$3 WHERE id=$4 RETURNING id,kind,url,name,content_type,size', [info.url, info.contentType, info.size, media.id]);
        return send(200, saved);
      }
      if (path === '/api/admin/settings' && method === 'PUT') {
        const parsed = settingSchema.safeParse(await readBody(req));
        if (!parsed.success) fail(400, parsed.error.issues[0]?.message || 'Invalid settings.');
        const s = parsed.data;
        for (const [kind, id, enabled] of [['popup', s.popupId, s.popupEnabled], ['audio', s.audioId, s.audioEnabled], ['hero', s.heroId, false]]) {
          if (enabled && !id) fail(400, `Upload a ${kind === 'popup' ? 'popup image' : 'soundtrack'} before enabling it.`);
          if (id && !(await db('SELECT id FROM trn_media WHERE id=$1 AND kind=$2 AND url IS NOT NULL', [id, kind])).length) fail(400, 'Selected media is unavailable.');
        }
        if (s.popupEnabled && !s.popupAlt) fail(400, 'Add a description of the popup image.');
        const rows = await db('UPDATE trn_settings SET revision=revision+1,effects_enabled=$1,popup_enabled=$2,audio_enabled=$3,hero_video_enabled=$4,popup_id=$5,audio_id=$6,popup_alt=$7,popup_link=$8,audio_volume=$9,hero_id=$10 WHERE id=1 AND revision=$11 RETURNING revision', [s.effectsEnabled,s.popupEnabled,s.audioEnabled,s.heroVideoEnabled,s.popupId,s.audioId,s.popupAlt,s.popupLink,s.audioVolume,s.heroId,s.revision]);
        if (!rows.length) fail(409, 'Settings changed in another session. Reload before saving.');
        return send(200, { ...await settings(), uploadsAvailable: storage.configured() });
      }
      fail(404, 'Not found.');
    } catch (error) {
      if (!error.status) console.error('TRN API failure:', error.name, error.code || '');
      send(error.status || 503, { error: error.status ? error.message : 'Service unavailable. Check the Neon connection and storage configuration, then try again.' });
    }
  };
}
export default createHandler();
