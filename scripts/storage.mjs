import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { GetBucketCorsCommand, PutBucketCorsCommand, HeadBucketCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { createStorage } from '../server/storage.mjs';

const storage = createStorage();
const command = process.argv[2];
async function main() {
  if (!storage.configured()) throw new Error('Add AWS_ENDPOINT_URL_S3, AWS_REGION, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY to .env first.');
  const client = storage.getClient();
  const buckets = [...new Set(['popup', 'audio', 'hero'].map(storage.bucket))];
  if (command === 'check') {
    for (const Bucket of buckets) { await client.send(new HeadBucketCommand({ Bucket })); console.log(`${Bucket}: connected`); }
    return;
  }
  if (command === 'cors') {
    const origins = process.argv.slice(3).map(value => {
      const url = new URL(value);
      if (!['https:', 'http:'].includes(url.protocol) || url.origin !== value.replace(/\/$/, '')) throw new Error('Pass website origins only, such as https://example.com or http://localhost:5190.');
      return url.origin;
    });
    if (!origins.length) throw new Error('Usage: npm run storage:cors -- https://your-site.vercel.app http://localhost:5190');
    for (const Bucket of buckets) {
      let existing = [];
      try { existing = (await client.send(new GetBucketCorsCommand({ Bucket }))).CORSRules || []; } catch (error) { if (error.name !== 'NoSuchCORSConfiguration' && error.$metadata?.httpStatusCode !== 404) throw error; }
      const previous = existing.find(rule => rule.ID === 'trn-website-uploads');
      const rule = { ID: 'trn-website-uploads', AllowedOrigins: [...new Set([...(previous?.AllowedOrigins || []), ...origins])], AllowedMethods: ['GET', 'HEAD', 'PUT'], AllowedHeaders: ['*'], ExposeHeaders: ['ETag'], MaxAgeSeconds: 3600 };
      await client.send(new PutBucketCorsCommand({ Bucket, CORSConfiguration: { CORSRules: [...existing.filter(item => item.ID !== rule.ID), rule] } }));
      console.log(`${Bucket}: website upload origins configured`);
    }
    return;
  }
  if (command !== 'sync') throw new Error('Choose check, cors or sync.');
  if (!process.env.DATABASE_URL) throw new Error('Add DATABASE_URL before syncing website media.');
  const sql = neon(process.env.DATABASE_URL);
  const [current] = await sql.query('SELECT hero_id,revision FROM trn_settings WHERE id=1');
  if (!current) throw new Error('Run npm run db:migrate first.');
  const photos = ['IMG_0661.JPEG', 'IMG_0662.JPEG', 'IMG_0665.JPEG', 'IMG_0666.JPEG', 'IMG_0669.JPEG', 'IMG_0673.JPEG', 'IMG_0674.JPG.jpeg', 'IMG_0675.JPG.jpeg', 'IMG_0676.JPG.jpeg', 'hero-poster.jpg'];
  // Read all files first; a missing source must not leave a half-started upload run.
  const files = await Promise.all([...photos, 'hero-video.mp4'].map(async name => ({ name, bytes: await readFile(new URL(`../public/media/${name}`, import.meta.url)) })));
  for (const file of files) {
    const kind = file.name.endsWith('.mp4') ? 'hero' : 'popup';
    const Bucket = storage.bucket(kind);
    const Key = `trn/original/${file.name}`;
    const ContentType = kind === 'hero' ? 'video/mp4' : 'image/jpeg';
    let exists = false;
    try { await client.send(new HeadObjectCommand({ Bucket, Key })); exists = true; } catch (error) { if (error.$metadata?.httpStatusCode !== 404 && error.name !== 'NotFound' && error.name !== 'NoSuchKey') throw error; }
    if (!exists) await client.send(new PutObjectCommand({ Bucket, Key, Body: file.bytes, ContentLength: file.bytes.length, ContentType, CacheControl: 'public, max-age=31536000, immutable' }));
    const visible = await fetch(storage.publicUrl(Bucket, Key), { method: 'HEAD' });
    if (!visible.ok) throw new Error(`${Bucket} must allow public reads before publishing website media.`);
    console.log(`${file.name}: ${exists ? 'already in Neon' : 'uploaded to Neon'}`);
  }
  const heroFile = files.find(file => file.name === 'hero-video.mp4');
  const heroId = randomUUID();
  const heroBucket = storage.bucket('hero');
  const heroKey = 'trn/original/hero-video.mp4';
  await sql.transaction([
    sql.query('INSERT INTO trn_media(id,kind,pathname,owner,name,url,content_type,size,storage_bucket) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(pathname) DO UPDATE SET url=EXCLUDED.url,storage_bucket=EXCLUDED.storage_bucket', [heroId,'hero',heroKey,'storage-sync','hero-video.mp4',storage.publicUrl(heroBucket,heroKey),'video/mp4',heroFile.bytes.length,heroBucket]),
    sql.query('UPDATE trn_settings SET gallery_base_url=$1,hero_id=COALESCE(hero_id,(SELECT id FROM trn_media WHERE pathname=$2)),revision=revision+1 WHERE id=1 AND revision=$3', [storage.publicUrl(storage.bucket('popup'),'trn/original'),heroKey,current.revision]),
  ]);
  const [published] = await sql.query('SELECT gallery_base_url FROM trn_settings WHERE id=1');
  if (published.gallery_base_url !== storage.publicUrl(storage.bucket('popup'),'trn/original')) throw new Error('Settings changed during sync. Files are safe in storage; rerun sync to publish the gallery.');
  console.log('Gallery and original hero film now use Neon. Existing custom hero selections are preserved.');
}
try { await main(); } catch (error) {
  console.error(error.$metadata ? `Neon storage request failed (${error.name}, HTTP ${error.$metadata.httpStatusCode}). Check credentials, bucket names and permissions.` : error.code ? `Storage setup failed (${error.code}). Check the database connection and run db:migrate.` : error.message);
  process.exitCode = 1;
}
