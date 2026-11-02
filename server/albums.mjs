import { z } from 'zod';
const schema = z.object({ revision:z.number().int().nonnegative(), name:z.string().trim().min(1,'Enter an album name.').max(160), coverId:z.uuid('Upload an album cover.') }).strict();
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
export function createAlbums(db, gallery) {
  async function list(admin=false) {
    const albums=await db('SELECT a.id,a.revision,a.name,a.cover_id AS "coverId",m.url AS "coverUrl" FROM trn_albums a JOIN trn_media m ON m.id=a.cover_id ORDER BY a.position,a.id');
    const photos=await gallery.list();
    const result=albums.map(album=>({...album,photos:photos.filter(photo=>photo.albumId===album.id)}));
    return admin?result:result.filter(album=>album.photos.length);
  }
  return { list,
    async save(body,id) {
      const parsed=schema.safeParse(body);
      if(!parsed.success)fail(400,parsed.error.issues[0]?.message||'Check the album details.');
      const album=parsed.data;
      if(!(await db("SELECT id FROM trn_media WHERE id=$1 AND kind IN ('gallery','event') AND url IS NOT NULL",[album.coverId])).length)fail(400,'Upload a valid album cover.');
      const rows=id
        ?await db('UPDATE trn_albums SET name=$1,cover_id=$2,revision=revision+1 WHERE id=$3 AND revision=$4 RETURNING id',[album.name,album.coverId,id,album.revision])
        :await db('INSERT INTO trn_albums(name,cover_id) VALUES($1,$2) RETURNING id',[album.name,album.coverId]);
      if(!rows.length)fail(409,'This album changed in another session. Reload albums before saving.');
      return (await list(true)).find(a=>a.id===rows[0].id);
    },
    async remove(id,body) {
      if(!Number.isInteger(body?.revision)||body.revision<0)fail(400,'Missing album revision.');
      if(!(await db('DELETE FROM trn_albums WHERE id=$1 AND revision=$2 RETURNING id',[id,body.revision])).length)fail(409,'This album changed in another session. Reload albums before removing it.');
      return {ok:true};
    },
  };
}
