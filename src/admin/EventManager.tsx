import { useEffect, useRef, useState } from 'react'
import { Image, Plus, UploadSimple } from '@phosphor-icons/react'
import { api } from '../settings'
import { formatEventDate, type LiveEvent } from '../events'
import { uploadMedia } from '../upload'

type Draft = Omit<LiveEvent, 'id'> & { id: string | null }
const empty = (): Draft => ({ id: null, revision: 0, name: '', location: '', date: '', imageId: '', imageUrl: '', published: true })
export default function EventManager({ uploadsAvailable }: { uploadsAvailable: boolean }) {
  const [events, setEvents] = useState<LiveEvent[]>([])
  const [draft, setDraft] = useState<Draft>(empty)
  const [saved, setSaved] = useState(JSON.stringify(empty()))
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [working, setWorking] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [removing, setRemoving] = useState<string | null>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  const dirty = JSON.stringify(draft) !== saved
  const busy = working || uploading
  const choose = (value: Draft) => { setDraft(value); setSaved(JSON.stringify(value)); setError(''); setNotice(''); setRemoving(null) }
  const load = async () => {
    setLoading(true); setLoadFailed(false)
    try { const value = await api<LiveEvent[]>('admin/events'); setEvents(value); choose(value[0] || empty()) }
    catch(e) { setLoadFailed(true); setError((e as Error).message) } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  const select = (value: Draft) => { if (!dirty || window.confirm('Discard unsaved event changes?')) { choose(value); nameInput.current?.focus() } }
  const change = <K extends keyof Draft>(key: K, value: Draft[K]) => { setDraft(current => ({ ...current, [key]: value })); setNotice('') }
  async function image(file?: File) {
    if (!file) return
    setError(''); setNotice('')
    if (!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type) || file.size > 10 * 1024 * 1024) { setError('Choose a JPG, PNG, WebP or GIF under 10 MB.'); return }
    setUploading(true); setProgress(0)
    try { const media = await uploadMedia('event', file, setProgress); setDraft(current => ({ ...current, imageId: media.id, imageUrl: media.url })); setNotice('Photo uploaded. Save the event to publish it.') }
    catch(e) { setError((e as Error).message) } finally { setUploading(false) }
  }
  async function save() {
    setError(''); setNotice('')
    if (!draft.imageId) { setError('Upload an event photo first.'); return }
    setWorking(true)
    try {
      const { id, imageUrl, ...payload } = draft; void imageUrl
      const value = await api<LiveEvent>(`admin/events${id ? `/${id}` : ''}`, id ? 'PUT' : 'POST', payload)
      setEvents(current => [...current.filter(event => event.id !== value.id), value].sort((a,b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name)))
      choose(value); setNotice(value.published ? 'Event is live on the website.' : 'Event saved and hidden from the website.')
    } catch(e) { setError((e as Error).message) } finally { setWorking(false) }
  }
  async function remove(event: LiveEvent) {
    setWorking(true); setError(''); setNotice('')
    try {
      await api(`admin/events/${event.id}`, 'DELETE', { revision: event.revision })
      setEvents(current => current.filter(item => item.id !== event.id))
      if (draft.id === event.id) choose(empty())
      setRemoving(null); setNotice('Event removed from the website.')
    } catch(e) { setError((e as Error).message) } finally { setWorking(false) }
  }
  return <section className="admin-events" aria-label="Manage live events">
    {error && <div className="admin-message admin-error" role="alert">{error}{(loadFailed || error.includes('Reload')) && <button onClick={() => { if (!dirty || window.confirm('Discard unsaved event changes and reload?')) void load() }} disabled={busy}>Reload events</button>}</div>}
    {notice && <p className="admin-message" role="status">{notice}</p>}
    {loading ? <p role="status">Loading events…</p> : !loadFailed && <div className="admin-event-grid">
      <section className="admin-panel admin-event-list"><div className="admin-event-list-heading"><h2>Events on the website</h2><button className="admin-upload" disabled={busy} onClick={() => select(empty())}><Plus size={16} />Add event</button></div>
        {!events.length && <p className="admin-description">No events yet. Add a photo and the details to publish your first event.</p>}
        {events.map(event => <div className="admin-event-item" key={event.id}>
          <button className="admin-event-select" aria-pressed={draft.id === event.id} disabled={busy} onClick={() => select(event)}><img src={event.imageUrl} alt="" /><span><strong>{event.name}</strong><span>{event.location}</span><time dateTime={event.date}>{formatEventDate(event.date)}</time><span className="admin-event-visibility">{event.published ? 'Visible on website' : 'Hidden'}</span></span></button>
          {removing === event.id ? <div className="admin-event-confirm"><p>Remove this event from the website?</p><button disabled={busy} onClick={() => void remove(event)}>Remove event</button><button disabled={busy} onClick={() => setRemoving(null)}>Keep event</button></div> : <button className="admin-remove" disabled={busy} onClick={() => setRemoving(event.id)} aria-label={`Remove ${event.name}`}>Remove</button>}
        </div>)}
        <p className="admin-file-help">Visible events appear in date order. Dates always include the year.</p>
      </section>
      <form className="admin-panel admin-event-form" onSubmit={event => { event.preventDefault(); void save() }}><fieldset className="admin-edit-fields" disabled={busy}><div className="admin-event-editor-heading"><h2>{draft.id ? 'Edit event' : 'Add event'}</h2><span>{dirty ? 'Unsaved changes' : draft.id ? 'Saved' : 'New event'}</span></div>
        <div className="admin-event-fields"><div className="admin-event-artwork"><div className="admin-event-photo">{draft.imageUrl ? <img src={draft.imageUrl} alt={draft.name ? `${draft.name} preview` : 'Event photo preview'} /> : <div><Image size={28} weight="light" /><p>Add the event artwork</p></div>}</div>
        <label className={`admin-upload ${!uploadsAvailable ? 'is-disabled' : ''}`}><UploadSimple size={17} />{uploading ? `Uploading ${progress}%` : draft.imageUrl ? 'Replace event photo' : 'Upload event photo'}<input aria-label="Event photo" type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={!uploadsAvailable || busy} onChange={event => { void image(event.target.files?.[0]); event.target.value = '' }} /></label><p className="admin-file-help">JPG, PNG, WebP or GIF · Up to 10 MB</p>
        </div><div className="admin-event-details">
        <label className="admin-field">Event name<input ref={nameInput} value={draft.name} required maxLength={160} onChange={event => change('name',event.target.value)} placeholder="Event or artist name" /></label>
        <label className="admin-field">Location<input value={draft.location} required maxLength={160} onChange={event => change('location',event.target.value)} placeholder="City, venue or country" /></label>
        <label className="admin-field">Event date<input type="date" value={draft.date} required min="1900-01-01" max="2200-12-31" onChange={event => change('date',event.target.value)} /></label><p className="admin-file-help">{draft.date ? `Shown as ${formatEventDate(draft.date)}` : 'Choose the day, month and year.'}</p>
        <label className="admin-event-publish"><input type="checkbox" checked={draft.published} onChange={event => change('published',event.target.checked)} />Visible on website</label>
        <div className="admin-event-actions"><button type="submit" className="admin-primary" disabled={!dirty || busy}>{working ? 'Saving…' : 'Save event'}</button>{dirty && <button type="button" className="admin-discard" disabled={busy} onClick={() => { setDraft(JSON.parse(saved) as Draft); setError(''); setNotice('') }}>Discard changes</button>}</div>
      </div></div></fieldset></form>
    </div>}
    <p className="admin-footer-note">Saved events appear on new visits immediately. Open pages update within 30 seconds.</p>
  </section>
}
