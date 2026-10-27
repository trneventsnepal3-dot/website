import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createHandler } from '../server/runtime.mjs';
import { hashPassword } from '../server/password.mjs';

test('events: photo upload, full dates, auth, publication, editing, conflicts and removal', async () => {
  const database = new PGlite();
  const schema = await readFile(new URL('../server/schema.sql',import.meta.url),'utf8');
  await database.exec(schema);
  const env = { ADMIN_PASSWORD_HASH: await hashPassword('Test-only-events-password!') };
  const server = http.createServer(createHandler({ env, query: async (sql,values) => (await database.query(sql,values)).rows,
    storage: { configured: () => true, bucket: () => 'media', authorize: async () => ({ bucket: 'media', url: 'https://storage.example/upload', method: 'PUT', headers: {} }), head: async (_bucket,key) => ({ url:`https://storage.example/media/${key}`, contentType:'image/jpeg',size:4096 }) } }));
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  async function request(path, method='GET', body, headers={}) {
    const response = await fetch(`${origin}/api/${path}`,{ method, headers:{Origin:origin,'Content-Type':'application/json','X-TRN-Admin':'1',Cookie:cookie,...headers},body:body===undefined?undefined:JSON.stringify(body) });
    return { status:response.status,data:await response.json(),headers:response.headers };
  }
  try {
    const seed = (await request('events')).data[0]; assert.equal(seed.date,'2027-03-28'); assert.equal(seed.name,'Sushant KC Live');
    assert.equal((await request('admin/events')).status,401);
    assert.equal((await request('admin/events','POST',{})).status,401);
    const login = await request('admin/login','POST',{password:'Test-only-events-password!'});cookie=login.headers.get('set-cookie').split(';')[0];
    const ticket = await request('admin/uploads','POST',{kind:'event',name:'new-event.jpg',size:4096,contentType:'image/jpeg'}); assert.equal(ticket.status,200); assert.match(ticket.data.pathname,/^trn\/event\//);
    const photo = await request('admin/media','POST',{pathname:ticket.data.pathname}); assert.equal(photo.status,200); assert.equal(photo.data.kind,'event');
    const payload = {revision:0,name:'Nepal Live',location:'Kathmandu',date:'2028-05-12',imageId:photo.data.id,published:true};
    assert.equal((await request('admin/events','POST',{...payload,date:'2027-02-30'})).status,400);
    assert.equal((await request('admin/events','POST',{...payload,imageId:''})).status,400);
    assert.equal((await request('admin/events','POST',payload,{Origin:'https://other.example'})).status,403);
    const created = await request('admin/events','POST',payload); assert.equal(created.status,201); assert.equal(created.data.imageUrl,photo.data.url);
    const hidden = await request('admin/events','POST',{...payload,name:'Another concert',date:'2027-01-10',published:false}); assert.equal(hidden.status,201);
    assert.deepEqual((await request('events')).data.map(e=>e.date),['2027-03-28','2028-05-12']);
    assert.equal((await request('admin/events')).data.length,3);
    const edited = await request(`admin/events/${hidden.data.id}`,'PUT',{...payload,name:'Another concert',location:'London',date:'2027-01-10',published:true}); assert.equal(edited.status,200); assert.equal(edited.data.revision,1);
    assert.deepEqual((await request('events')).data.map(e=>e.date),['2027-01-10','2027-03-28','2028-05-12']);
    assert.equal((await request(`admin/events/${hidden.data.id}`,'PUT',payload)).status,409);
    assert.equal((await request(`admin/events/${hidden.data.id}`,'DELETE',{revision:0})).status,409);
    assert.equal((await request(`admin/events/${hidden.data.id}`,'DELETE',{revision:1})).status,200);
    assert.equal((await request(`admin/events/${seed.id}`,'DELETE',{revision:0})).status,200);
    await database.exec(schema);
    assert.equal((await request('events')).data.some(e=>e.id===seed.id),false,'Rerunning migrations must not restore a deleted event');
    assert.equal((await request(`admin/events/${created.data.id}`,'DELETE',{revision:0})).status,200);
    assert.deepEqual((await request('events')).data,[]);
  } finally { await new Promise(resolve => server.close(resolve)); await database.close(); }
});
