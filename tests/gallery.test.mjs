import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createHandler } from '../server/runtime.mjs';
import { hashPassword } from '../server/password.mjs';

test('gallery preserves originals and supports authenticated upload, edits, removal and conflict protection',async()=>{
  const db=new PGlite();const schema=await readFile(new URL('../server/schema.sql',import.meta.url),'utf8');await db.exec(schema);
  const handler=createHandler({env:{ADMIN_PASSWORD_HASH:await hashPassword('Gallery-test-password-only')},query:async(sql,values)=>(await db.query(sql,values)).rows,storage:{configured:()=>true,bucket:()=> 'media',authorize:async()=>({bucket:'media',url:'https://storage.example/put',method:'PUT',headers:{}}),head:async(_bucket,key)=>({url:`https://storage.example/media/${key}`,contentType:'image/jpeg',size:2048})}});
  const server=http.createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;let cookie='';
  const request=async(path,method='GET',body,extra={})=>{const r=await fetch(`${origin}/api/${path}`,{method,headers:{Origin:origin,'X-TRN-Admin':'1','Content-Type':'application/json',Cookie:cookie,...extra},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,data:await r.json(),headers:r.headers};};
  try{
    const originals=(await request('gallery')).data;assert.equal(originals.length,9);assert.equal(originals[0].name,'IMG_0675.JPG.jpeg');assert.equal(originals[8].name,'IMG_0676.JPG.jpeg');
    assert.equal((await request('admin/gallery','POST',{})).status,401);
    const login=await request('admin/login','POST',{password:'Gallery-test-password-only'});cookie=login.headers.get('set-cookie').split(';')[0];
    // The archive photo shared with the event remains editable in the gallery.
    const shared=originals.find(p=>p.name==='IMG_0674.JPG.jpeg');assert.equal((await request(`admin/gallery/${shared.id}`,'PUT',{revision:0,mediaId:shared.mediaId,caption:'One more song.',alt:shared.alt})).status,200);
    const ticket=await request('admin/uploads','POST',{kind:'gallery',name:'new-photo.jpg',contentType:'image/jpeg',size:2048});assert.equal(ticket.status,200);assert.match(ticket.data.pathname,/^trn\/gallery\//);
    const media=(await request('admin/media','POST',{pathname:ticket.data.pathname})).data;
    const payload={revision:0,mediaId:media.id};
    assert.equal((await request('admin/gallery','POST',{...payload,alt:'x'.repeat(501)})).status,400);
    assert.equal((await request('admin/gallery','POST',payload,{Origin:'https://other.example'})).status,403);
    const added=await request('admin/gallery','POST',payload);assert.equal(added.status,201);assert.equal(added.data.caption,'');assert.equal(added.data.alt,'TRN Events Nepal gallery photo');assert.equal((await request('gallery')).data.at(-1).id,added.data.id);
    assert.equal((await request('admin/gallery','POST',payload)).status,409);
    const edited=await request(`admin/gallery/${added.data.id}`,'PUT',{...payload,caption:'A night to remember.'});assert.equal(edited.status,200);assert.equal(edited.data.revision,1);
    assert.equal((await request(`admin/gallery/${added.data.id}`,'PUT',payload)).status,409);
    assert.equal((await request(`admin/gallery/${added.data.id}`,'DELETE',{revision:0})).status,409);
    assert.equal((await request(`admin/gallery/${added.data.id}`,'DELETE',{revision:1})).status,200);
    assert.equal((await request(`admin/gallery/${originals[0].id}`,'DELETE',{revision:0})).status,200);
    await db.exec(schema);assert.equal((await request('gallery')).data.length,8,'Migration does not restore removed gallery photos');
    assert.equal((await db.query('SELECT id FROM trn_media WHERE id=$1',[originals[0].mediaId])).rows.length,1,'Removing a photo keeps its stored asset');
  }finally{await new Promise(resolve=>server.close(resolve));await db.close();}
});
