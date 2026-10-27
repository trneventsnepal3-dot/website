import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStorage } from '../server/storage.mjs';

const env = { AWS_ENDPOINT_URL_S3: 'https://branch.storage.example', AWS_REGION: 'us-east-2', AWS_ACCESS_KEY_ID: 'test-key-id', AWS_SECRET_ACCESS_KEY: 'test-secret' };
test('Neon uses path-style URLs and signs the exact upload size and content type', async () => {
  const storage = createStorage(env);
  assert.equal(storage.configured(), true);
  assert.equal(storage.bucket('popup'), 'media'); assert.equal(storage.bucket('audio'), 'song'); assert.equal(storage.bucket('hero'), 'herosectionvideo'); assert.equal(storage.bucket('event'), 'media');
  const ticket = await storage.authorize({ kind: 'hero', pathname: 'trn/hero/test.mp4', contentType: 'video/mp4', size: 12345 });
  const url = new URL(ticket.url);
  assert.equal(url.hostname, 'branch.storage.example');
  assert.equal(url.pathname, '/herosectionvideo/trn/hero/test.mp4');
  const headers = url.searchParams.get('X-Amz-SignedHeaders').split(';');
  assert.ok(headers.includes('content-length')); assert.ok(headers.includes('content-type')); assert.ok(headers.includes('cache-control'));
  assert.equal(url.searchParams.get('X-Amz-Expires'), '600');
  assert.equal(url.searchParams.has('x-amz-checksum-crc32'), false);
  assert.equal(ticket.headers['Content-Type'], 'video/mp4'); assert.equal(ticket.headers['Cache-Control'], 'public, max-age=31536000, immutable');
  assert.equal(ticket.headers['Content-Length'], undefined); // Browser supplies the File body's real length.
  assert.equal(storage.publicUrl('media', 'trn/photo with spaces#.jpg'), 'https://branch.storage.example/media/trn/photo%20with%20spaces%23.jpg');
  storage.getClient().destroy();
});
test('missing credentials never fall back to an unrelated AWS account', async () => {
  const storage = createStorage({}); assert.equal(storage.configured(), false);
  assert.throws(() => storage.getClient(), /credentials are missing/);
});
