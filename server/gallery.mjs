import { z } from 'zod';
const schema = z.object({ revision:z.number().int().nonnegative(), mediaId:z.uuid('Upload a photo first.'), albumId:z.uuid('Choose an album.').optional(), caption:z.string().trim().max(200).optional(), alt:z.string().trim().max(500).optional() }).strict();
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
export function createGallery(db) {
  const list=()=>db('SELECT g.id,g.revision,g.media_id AS "mediaId",g.album_id AS "albumId",g.caption,g.alt,m.url,m.name FROM trn_gallery g JOIN trn_media m ON m.id=g.media_id ORDER BY g.position,g.id');
  return { list,
    async save(body,id) {
      const parsed=schema.safeParse(body);if(!parsed.success)fail(400,parsed.error.issues[0]?.message || 'Check the photo details.');const p=parsed.data;
      if(p.albumId && !(await db('SELECT id FROM trn_albums WHERE id=$1',[p.albumId])).length)fail(400,'This album no longer exists. Reload albums.');
      if(!(await db("SELECT id FROM trn_media WHERE id=$1 AND kind IN ('gallery','event') AND url IS NOT NULL",[p.mediaId])).length)fail(400,'Upload a valid gallery photo.');
      const alt=p.alt||p.caption||'TRN Events Nepal gallery photo';
      let rows;
      if(id){rows=await db("UPDATE trn_gallery SET caption=COALESCE($1,caption),alt=COALESCE(NULLIF($2,''),NULLIF(alt,''),$6),media_id=$3,album_id=COALESCE($7,album_id),revision=revision+1 WHERE id=$4 AND revision=$5 RETURNING id",[p.caption??null,p.alt||'',p.mediaId,id,p.revision,alt,p.albumId??null]);if(!rows.length)fail(409,'This photo changed in another session. Reload photos before saving.');}
      else { if((await db('SELECT id FROM trn_gallery WHERE media_id=$1',[p.mediaId])).length)fail(409,'This photo is already in the gallery.');rows=await db('INSERT INTO trn_gallery(media_id,caption,alt,album_id) VALUES($1,$2,$3,$4) RETURNING id',[p.mediaId,p.caption||'',alt,p.albumId??null]); }
      return (await list()).find(photo=>photo.id===rows[0].id);
    },
    async remove(id,body) {
      if(!Number.isInteger(body?.revision)||body.revision<0)fail(400,'Missing photo revision.');
      if(!(await db('DELETE FROM trn_gallery WHERE id=$1 AND revision=$2 RETURNING id',[id,body.revision])).length)fail(409,'This photo changed in another session. Reload photos before removing it.');
      return {ok:true};
    },
  };
}
