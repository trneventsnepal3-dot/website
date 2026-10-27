import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, access } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createHandler } from '../server/runtime.mjs';
import { withVercelRouting } from '../server/vercel.mjs';
import { hashPassword } from '../server/password.mjs';

test('Vercel rewrite serves nested admin routes through the flat API function', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
  const rule = config.rewrites.find(rule => rule.source === '/api/:path*');
  assert.equal(rule.destination,'/api/router?__trn_path=:path*');
  await access(new URL('../api/router.js',import.meta.url));
  const database = new PGlite();
  await database.exec(await readFile(new URL('../server/schema.sql',import.meta.url),'utf8'));
  const handler = withVercelRouting(createHandler({ env:{ ADMIN_PASSWORD_HASH:await hashPassword('Vercel-routing-test-only') },query:async(sql,values)=>(await database.query(sql,values)).rows }));
  const server = http.createServer((req,res) => {
    // Emulate the deployed rewrite, rather than calling the runtime with the original URL.
    const original = new URL(req.url,'http://localhost');
    req.url = rule.destination.replace(':path*',encodeURIComponent(original.pathname.slice('/api/'.length)));
    return handler(req,res);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const headers={Origin:origin,'X-TRN-Admin':'1','Content-Type':'application/json'};
  try {
    let r=await fetch(`${origin}/api/site-settings`);assert.equal(r.status,200);assert.equal(typeof (await r.json()).revision,'number');
    r=await fetch(`${origin}/api/admin/settings`);assert.equal(r.status,401);assert.equal((await r.json()).error,'Please sign in.');
    r=await fetch(`${origin}/api/admin/login`,{method:'POST',headers,body:JSON.stringify({password:'Vercel-routing-test-only'})});assert.equal(r.status,200);const cookie=r.headers.get('set-cookie').split(';')[0];
    r=await fetch(`${origin}/api/admin/events`,{headers:{Cookie:cookie}});assert.equal(r.status,200);const [event]=await r.json();assert.equal(event.date,'2027-03-28');
    r=await fetch(`${origin}/api/admin/events/${event.id}`,{method:'PUT',headers:{...headers,Cookie:cookie},body:JSON.stringify({revision:event.revision,name:event.name,location:'United Kingdom',date:'2027-03-28',imageId:event.imageId,published:true})});assert.equal(r.status,200);assert.equal((await r.json()).revision,1);
  } finally { await new Promise(resolve=>server.close(resolve));await database.close(); }
});
test('adapter also accepts Vercel query parameters with an original request URL', async()=>{
  let called='';
  const handler=withVercelRouting(req=>{called=req.url;});
  handler({url:'/api/admin/session',query:{__trn_path:'admin/session'}},{});
  assert.equal(called,'/api/admin/session');
});
