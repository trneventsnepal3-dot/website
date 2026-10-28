import { useEffect, useState } from 'react'
import { Plus } from '@phosphor-icons/react'
import { api } from '../settings'
import { type GalleryPhoto } from '../gallery'
import { uploadMedia } from '../upload'

type Draft=Omit<GalleryPhoto,'id'> & {id:string | null}
const empty=():Draft=>({id:null,revision:0,mediaId:'',url:'',name:'',caption:'',alt:''})
export default function GalleryManager({uploadsAvailable,disabled=false}:{uploadsAvailable:boolean;disabled?:boolean}) {
  const [photos,setPhotos]=useState<GalleryPhoto[]>([])
  const [draft,setDraft]=useState<Draft>(empty)
  const [saved,setSaved]=useState(JSON.stringify(empty()))
  const [loading,setLoading]=useState(true)
  const [busy,setBusy]=useState(false)
  const [uploading,setUploading]=useState(false)
  const [progress,setProgress]=useState(0)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [removing,setRemoving]=useState(false)
  const dirty=JSON.stringify(draft)!==saved
  const blocked=busy||uploading||disabled
  const choose=(photo:Draft)=>{setDraft(photo);setSaved(JSON.stringify(photo));setRemoving(false);setNotice('');setError('')}
  async function load(){setLoading(true);try{const value=await api<GalleryPhoto[]>('admin/gallery');setPhotos(value);choose(value[0]||empty())}catch(e){setError((e as Error).message)}finally{setLoading(false)}}
  useEffect(()=>{void load()},[])
  useEffect(()=>{const warn=(e:BeforeUnloadEvent)=>{if(dirty){e.preventDefault();e.returnValue=''}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)},[dirty])
  async function add(file?:File){
    if(!file)return
    if(dirty&&!window.confirm('Discard unsaved photo changes?'))return
    setError('');setNotice('')
    if(!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)||file.size>10*1024*1024){setError('Choose a JPG, PNG, WebP or GIF under 10 MB.');return}
    setUploading(true);setProgress(0)
    try{const media=await uploadMedia('gallery',file,setProgress);choose(empty());setDraft({...empty(),mediaId:media.id,url:media.url,name:media.name});setNotice('Photo uploaded. Save to publish it.')}
    catch(e){setError((e as Error).message)}finally{setUploading(false)}
  }
  async function save(){
    if(!draft.mediaId){setError('Upload a photo first.');return}
    setBusy(true);setError('');setNotice('')
    try{const photo=await api<GalleryPhoto>(`admin/gallery${draft.id?`/${draft.id}`:''}`,draft.id?'PUT':'POST',{revision:draft.revision,mediaId:draft.mediaId});setPhotos(current=>draft.id?current.map(p=>p.id===photo.id?photo:p):[...current,photo]);choose(photo);setNotice('Photo is live in the gallery.')}
    catch(e){setError((e as Error).message)}finally{setBusy(false)}
  }
  async function remove(){
    setBusy(true);setError('');setNotice('')
    try{await api(`admin/gallery/${draft.id}`,'DELETE',{revision:draft.revision});const remaining=photos.filter(p=>p.id!==draft.id);setPhotos(remaining);choose(remaining[0]||empty());setNotice('Photo removed from the gallery.')}
    catch(e){setError((e as Error).message)}finally{setBusy(false)}
  }
  return <section className="admin-panel admin-gallery" aria-labelledby="admin-gallery-title">
    <div className="admin-gallery-heading"><div><h2 id="admin-gallery-title">Gallery photos</h2><p>The photos in “You had to be there.” New photos appear at the end.</p></div><label className={`admin-upload ${!uploadsAvailable||blocked?'is-disabled':''}`}><Plus size={17} />{uploading?`Uploading ${progress}%`:'Add photo'}<input aria-label="Gallery photo file" type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={!uploadsAvailable||blocked} onChange={e=>{void add(e.target.files?.[0]);e.target.value=''}} /></label></div>
    {error&&<div className="admin-message admin-error" role="alert">{error}<button disabled={blocked} onClick={()=>{if(!dirty||window.confirm('Discard photo changes and reload?'))void load()}}>Reload photos</button></div>}
    {notice&&<p className="admin-message" role="status">{notice}</p>}
    {loading?<p role="status">Loading gallery photos…</p>:<>
      {!!photos.length&&<div className="admin-gallery-list" aria-label="Gallery photo selection">{photos.map(photo=><button className="admin-gallery-thumb" key={photo.id} aria-pressed={draft.id===photo.id} aria-label={`Select photo: ${photo.name}`} disabled={blocked} onClick={()=>{if(!dirty||window.confirm('Discard unsaved photo changes?'))choose(photo)}}><img src={photo.url} alt="" loading="lazy" /><span>{photo.name}</span></button>)}</div>}
      {draft.mediaId?<form onSubmit={e=>{e.preventDefault();void save()}}><fieldset className="admin-edit-fields admin-gallery-editor" disabled={blocked}><div className="admin-gallery-current"><img src={draft.url} alt={draft.alt||'New gallery photo preview'} /><p className="admin-file-help">{draft.name}</p></div><div><div className="admin-gallery-actions">{!draft.id&&<button type="submit" className="admin-primary" disabled={!dirty||blocked}>{busy?'Saving…':'Save photo'}</button>}{draft.id&&<button type="button" className="admin-discard" onClick={()=>setRemoving(true)} disabled={blocked}>Remove photo</button>}{dirty&&<button type="button" className="admin-discard" onClick={()=>{setDraft(JSON.parse(saved) as Draft);setNotice('');setError('')}} disabled={blocked}>Discard changes</button>}</div>{removing&&<div className="admin-event-confirm"><p>Remove this photo from the website gallery?</p><button type="button" onClick={()=>void remove()} disabled={blocked}>Remove from gallery</button><button type="button" onClick={()=>setRemoving(false)} disabled={blocked}>Keep photo</button></div>}</div></fieldset></form>:<p className="admin-description">Add a photo to start your gallery. JPG, PNG, WebP or GIF, up to 10 MB each.</p>}
    </>}
    <p className="admin-file-help">Gallery photos save separately from the media switches. Removing a photo keeps the original file in storage.</p>
  </section>
}
