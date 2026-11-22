import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createHandler } from '../server/runtime.mjs';
import { hashPassword } from '../server/password.mjs';

test('event pages expose canonical Open Graph metadata without leaking unpublished events', async () => {
  const database = new PGlite();
  await database.exec(await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8'));
  const env = { ADMIN_PASSWORD_HASH: await hashPassword('Event-page-test-only!') };
  const handler = createHandler({
    env,
    query: async (sql, values) => (await database.query(sql, values)).rows,
  });
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${origin}/api/events`);
    const [event] = await response.json();
    assert.ok(event?.id, 'The seeded event should be public.');

    const page = await fetch(`${origin}/event/${event.id}`, { headers: { 'x-forwarded-host': 'events.example', 'x-forwarded-proto': 'https' } });
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type') || '', /text\/html/);
    const html = await page.text();
    assert.equal((html.match(/property="og:image"/g) || []).length, 1, 'Only the event poster should be used for og:image.');
    assert.match(html, new RegExp(`<title>${escapeRegExp(event.name)} \\| TRN Events Nepal</title>`));
    assert.match(html, /property="og:title"/);
    assert.match(html, /property="og:description"/);
    assert.match(html, /name="twitter:card" content="summary_large_image"/);
    assert.match(html, /rel="canonical" href="https:\/\/events\.example\/event\//);
    assert.match(html, /property="og:url" content="https:\/\/events\.example\/event\//);
    assert.match(html, /application\/ld\+json/);
    assert.ok(html.includes(event.imageUrl), 'The event poster URL should be in the metadata.');
    assert.ok(html.includes('<div id="root"></div>'), 'The page should still boot the React app.');

    const nested = await fetch(`${origin}/api/event/${event.id}`);
    assert.equal(nested.status, 200);
    assert.match(await nested.text(), /property="og:title"/);

    const missing = await fetch(`${origin}/event/00000000-0000-4000-8000-000000000999`);
    assert.equal(missing.status, 404);
    const missingHtml = await missing.text();
    assert.match(missingHtml, /no longer available/i);
    assert.doesNotMatch(missingHtml, /property="og:image"/);

    const invalid = await fetch(`${origin}/event/not-a-real-event`);
    assert.equal(invalid.status, 404);
    assert.match(invalid.headers.get('content-type') || '', /text\/html/);
    assert.match(await invalid.text(), /no longer available/i);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await database.close();
  }
});

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
