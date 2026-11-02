import { useEffect, useState } from 'react'
import { Plus, Trash, UploadSimple } from '@phosphor-icons/react'
import { api } from '../settings'
import { type GalleryAlbum, type GalleryPhoto } from '../gallery'
import { uploadMedia } from '../upload'

type Draft = { id: string | null; revision: number; name: string; coverId: string; coverUrl: string }
const empty = (): Draft => ({ id: null, revision: 0, name: '', coverId: '', coverUrl: '' })
const fields = (album: Draft): Draft => ({ id: album.id, revision: album.revision, name: album.name, coverId: album.coverId, coverUrl: album.coverUrl })
export default function GalleryManager({ uploadsAvailable, disabled = false }: { uploadsAvailable: boolean; disabled?: boolean }) {
  const [albums, setAlbums] = useState<GalleryAlbum[]>([])
  const [draft, setDraft] = useState<Draft>(empty)
  const [saved, setSaved] = useState(JSON.stringify(empty()))
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [removing, setRemoving] = useState<string | null>(null)
  const [moving, setMoving] = useState<{ photo: GalleryPhoto; albumId: string } | null>(null)
  const dirty = JSON.stringify(draft) !== saved
  const blocked = busy || disabled
  const active = albums.find(album => album.id === draft.id)
  const choose = (value: Draft) => { const next = fields(value); setDraft(next); setSaved(JSON.stringify(next)); setRemoving(null); setMoving(null); setError(''); setNotice('') }
  const select = (value: Draft) => { if (!dirty || window.confirm('Discard unsaved album changes?')) choose(value) }
  async function load() {
    setLoading(true); setError('')
    try { const value = await api<GalleryAlbum[]>('admin/albums'); setAlbums(value); choose(value.find(album => album.id === draft.id) || value[0] || empty()) }
    catch (e) { setError((e as Error).message) } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  function validate(file: File) {
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error('Choose JPG, PNG, WebP or GIF images under 10 MB each.')
  }
  async function cover(file?: File) {
    if (!file) return
    setBusy(true); setError(''); setNotice('')
    try {
      validate(file)
      const media = await uploadMedia('gallery', file, value => setProgress(`Uploading cover ${value}%`))
      setDraft(current => ({ ...current, coverId: media.id, coverUrl: media.url }))
      setNotice('Cover uploaded. Save the album to publish it.')
    } catch (e) { setError((e as Error).message) } finally { setBusy(false); setProgress('') }
  }
  async function save() {
    if (!draft.coverId) { setError('Upload an album cover first.'); return }
    setBusy(true); setError(''); setNotice('')
    try {
      const album = await api<GalleryAlbum>(`admin/albums${draft.id ? `/${draft.id}` : ''}`, draft.id ? 'PUT' : 'POST', { revision: draft.revision, name: draft.name, coverId: draft.coverId })
      setAlbums(current => draft.id ? current.map(item => item.id === album.id ? album : item) : [...current, album])
      choose(album); setNotice(album.photos.length ? 'Album saved and live on the website.' : 'Album created. Add photos to show it on the website.')
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  async function addPhotos(files: File[]) {
    if (!draft.id || !files.length) return
    setBusy(true); setError(''); setNotice('')
    let completed = 0
    try {
      files.forEach(validate)
      for (const file of files) {
        const media = await uploadMedia('gallery', file, value => setProgress(`Photo ${completed + 1} of ${files.length}: ${value}%`))
        const photo = await api<GalleryPhoto>('admin/gallery', 'POST', { revision: 0, albumId: draft.id, mediaId: media.id })
        setAlbums(current => current.map(album => album.id === draft.id ? { ...album, photos: [...album.photos, photo] } : album))
        completed++
      }
      setNotice(`${completed} ${completed === 1 ? 'photo added' : 'photos added'} to this album.`)
    } catch (e) { setError(`${completed ? `${completed} photos added. ` : ''}${(e as Error).message}`) } finally { setBusy(false); setProgress('') }
  }
  async function removePhoto(photo: GalleryPhoto) {
    setBusy(true); setError(''); setNotice('')
    try {
      await api(`admin/gallery/${photo.id}`, 'DELETE', { revision: photo.revision })
      setAlbums(current => current.map(album => ({ ...album, photos: album.photos.filter(item => item.id !== photo.id) })))
      setRemoving(null); setNotice('Photo removed from this album. The original file remains in storage.')
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  async function movePhoto() {
    if (!moving?.albumId) return
    setBusy(true); setError(''); setNotice('')
    try {
      const photo = await api<GalleryPhoto>(`admin/gallery/${moving.photo.id}`, 'PUT', { revision: moving.photo.revision, mediaId: moving.photo.mediaId, albumId: moving.albumId })
      setAlbums(current => current.map(album => ({ ...album, photos: album.id === photo.albumId ? [...album.photos, photo] : album.photos.filter(item => item.id !== photo.id) })))
      setMoving(null); setNotice('Photo moved to the selected album.')
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  async function removeAlbum() {
    setBusy(true); setError(''); setNotice('')
    try {
      await api(`admin/albums/${draft.id}`, 'DELETE', { revision: draft.revision })
      const remaining = albums.filter(album => album.id !== draft.id)
      setAlbums(remaining); choose(remaining[0] || empty()); setNotice('Album removed from the website. Original files remain in storage.')
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return <section className="admin-panel admin-gallery" aria-labelledby="admin-gallery-title">
    <div className="admin-gallery-heading"><div><h2 id="admin-gallery-title">Gallery albums</h2><p>Group the photos in &ldquo;You had to be there.&rdquo; by event.</p></div><button className="admin-upload" disabled={blocked} onClick={() => select(empty())}><Plus size={17} />Create album</button></div>
    {error && <div className="admin-message admin-error" role="alert">{error}<button disabled={blocked} onClick={() => { if (!dirty || window.confirm('Discard album changes and reload?')) void load() }}>Reload albums</button></div>}
    {notice && <p className="admin-message" role="status">{notice}</p>}
    {progress && <p role="status" className="admin-message">{progress}</p>}
    {loading ? <p role="status">Loading albums...</p> : <>
      {!!albums.length && <div className="admin-gallery-list" aria-label="Album selection">{albums.map(album => <button className="admin-gallery-thumb" key={album.id} aria-pressed={draft.id === album.id} aria-label={`Edit album: ${album.name}`} disabled={blocked} onClick={() => select(album)}><img src={album.coverUrl} alt="" loading="lazy" /><span>{album.name}</span><span>{album.photos.length} photos</span></button>)}</div>}
      <form onSubmit={event => { event.preventDefault(); void save() }}><fieldset className="admin-edit-fields admin-album-editor" disabled={blocked}>
        <div><div className="admin-album-cover">{draft.coverUrl ? <img src={draft.coverUrl} alt="Album cover preview" /> : <p>Add an album cover</p>}</div>
          <label className={`admin-upload ${!uploadsAvailable || blocked ? 'is-disabled' : ''}`}><UploadSimple size={17} />{draft.coverUrl ? 'Replace cover' : 'Upload cover'}<input aria-label="Album cover file" type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={!uploadsAvailable || blocked} onChange={event => { void cover(event.target.files?.[0]); event.target.value = '' }} /></label>
        </div>
        <div><label className="admin-field">Album name<input value={draft.name} required maxLength={160} onChange={event => { setDraft(current => ({ ...current, name: event.target.value })); setNotice('') }} placeholder="e.g. Sushant KC" /></label><p className="admin-file-help">The album name appears over its cover on the homepage.</p>
          <div className="admin-gallery-actions"><button type="submit" className="admin-primary" disabled={!dirty || blocked}>{draft.id ? 'Save album' : 'Create album'}</button>{dirty && <button type="button" className="admin-discard" onClick={() => choose(JSON.parse(saved) as Draft)}>Discard changes</button>}{draft.id && <button type="button" className="admin-remove-photo" onClick={() => setRemoving('album')}><Trash size={16} />Remove album</button>}</div>
          {removing === 'album' && <div className="admin-event-confirm"><p>Remove this album and its {active?.photos.length || 0} photos from the website? Original files stay in storage.</p><button type="button" onClick={() => void removeAlbum()}>Remove album and photos</button><button type="button" onClick={() => setRemoving(null)}>Keep album</button></div>}
        </div>
      </fieldset></form>
      {draft.id && <section className="admin-album-photos" aria-labelledby="album-photos-title"><div className="admin-gallery-heading"><div><h3 id="album-photos-title">Photos in {active?.name}</h3><p>Photos save immediately in the order you add them.</p></div><label className={`admin-upload ${!uploadsAvailable || blocked ? 'is-disabled' : ''}`}><Plus size={17} />Add photos<input aria-label="Album photo files" type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif" disabled={!uploadsAvailable || blocked} onChange={event => { void addPhotos(Array.from(event.target.files || [])); event.target.value = '' }} /></label></div>
        {!active?.photos.length && <p className="admin-description">Add the event photos to publish this album. Empty albums stay hidden on the homepage.</p>}
        <div className="admin-album-photo-grid">{active?.photos.map(photo => <div className="admin-album-photo" key={photo.id}><img src={photo.url} alt={photo.alt} loading="lazy" /><p>{photo.name}</p><div className="admin-gallery-actions"><button disabled={blocked} onClick={() => { setDraft(current => ({ ...current, coverId: photo.mediaId, coverUrl: photo.url })); setNotice('Cover selected. Save the album to publish it.') }}>Use as cover</button>{albums.length > 1 && <button disabled={blocked} onClick={() => { setMoving({ photo, albumId: '' }); setRemoving(null) }}>Move</button>}<button disabled={blocked} onClick={() => { setRemoving(photo.id); setMoving(null) }} aria-label={`Remove photo: ${photo.name}`}>Remove</button></div>
          {removing === photo.id && <div className="admin-event-confirm"><p>Remove this photo from the album?</p><button disabled={blocked} onClick={() => void removePhoto(photo)}>Remove photo</button><button disabled={blocked} onClick={() => setRemoving(null)}>Keep photo</button></div>}
          {moving?.photo.id === photo.id && <div><label className="admin-field">Move to album<select aria-label="Move to album" value={moving.albumId} onChange={event => setMoving({ photo, albumId: event.target.value })} disabled={blocked}><option value="">Choose album</option>{albums.filter(album => album.id !== draft.id).map(album => <option key={album.id} value={album.id}>{album.name}</option>)}</select></label><div className="admin-gallery-actions"><button disabled={blocked || !moving.albumId} onClick={() => void movePhoto()}>Move photo</button><button disabled={blocked} onClick={() => setMoving(null)}>Cancel</button></div></div>}
        </div>)}</div>
      </section>}
      {!draft.id && <p className="admin-file-help">Create the album with a name and cover, then add its photos.</p>}
    </>}
    <p className="admin-file-help">JPG, PNG, WebP or GIF, up to 10 MB each. Albums save separately from the media switches.</p>
  </section>
}
