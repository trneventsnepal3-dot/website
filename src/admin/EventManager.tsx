import { useEffect, useRef, useState } from 'react'
import { Image, Plus, UploadSimple, X } from '@phosphor-icons/react'
import { api } from '../settings'
import { DEFAULT_TIME_ZONE, TIME_ZONE_OPTIONS, eventDateLabel, eventLocationLabel, TBA_LABEL, type LiveEvent } from '../events'
import { uploadMedia } from '../upload'

type Draft = Omit<LiveEvent, 'id'> & { id: string | null }
type AlbumOption = { id: string; name: string }
const empty = (): Draft => ({ id: null, revision: 0, name: '', location: '', date: '', dateTba: false, imageId: '', imageUrl: '', published: true, type: 'concert', artist: '', description: '', stops: [], isPast: false, organizer: '', organizerType: 'org', organizerMessage: '', eventNumber: '', musicId: null, musicUrl: null, musicName: null, startTime: '', endDate: '', endTime: '', timezone: DEFAULT_TIME_ZONE, albumId: null, albumName: null, album: null, recapUrl: '' })
export default function EventManager({ uploadsAvailable }: { uploadsAvailable: boolean }) {
  const [events, setEvents] = useState<LiveEvent[]>([])
  const [albums, setAlbums] = useState<AlbumOption[]>([])
  const [draft, setDraft] = useState<Draft>(empty)
  const [saved, setSaved] = useState(JSON.stringify(empty()))
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [working, setWorking] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [musicUploading, setMusicUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [musicProgress, setMusicProgress] = useState(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [removing, setRemoving] = useState<string | null>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  const dirty = JSON.stringify(draft) !== saved
  const busy = working || uploading || musicUploading
  const choose = (value: Draft) => { setDraft(value); setSaved(JSON.stringify(value)); setError(''); setNotice(''); setRemoving(null) }
  const load = async () => {
    setLoading(true); setLoadFailed(false)
    try { const value = await api<LiveEvent[]>('admin/events'); setEvents(value); choose(value[0] || empty()) }
    catch(e) { setLoadFailed(true); setError((e as Error).message) } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])
  useEffect(() => { void api<AlbumOption[]>('admin/albums').then(value => setAlbums(value.map(({ id, name }) => ({ id, name })))).catch(() => {}) }, [])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  const select = (value: Draft) => { if (!dirty || window.confirm('Discard unsaved event changes?')) { choose(value); nameInput.current?.focus() } }
  const change = <K extends keyof Draft>(key: K, value: Draft[K]) => { setDraft(current => ({ ...current, [key]: value })); setNotice('') }
  const setTba = (value: boolean) => {
    setDraft(current => current.type === 'tour'
      ? { ...current, dateTba: value, stops: current.stops.map(stop => ({ ...stop, dateTba: value })) }
      : { ...current, dateTba: value })
    setNotice('')
  }
  const setStopTba = (index: number, value: boolean) => {
    setDraft(current => {
      const stops = current.stops.map((stop, i) => i === index ? { ...stop, dateTba: value } : stop)
      return { ...current, stops, dateTba: stops.every(stop => stop.dateTba) }
    })
    setNotice('')
  }
  const setStopCompleted = (index: number, value: boolean) => {
    setDraft(current => ({ ...current, stops: current.stops.map((stop, i) => i === index ? { ...stop, completed: value } : stop) }))
    setNotice('')
  }
  const changeStop = (index: number, key: 'date' | 'location' | 'startTime' | 'endDate' | 'endTime' | 'timezone', value: string) => change('stops', draft.stops.map((stop, i) => i === index ? { ...stop, [key]: value } : stop))
  const changeType = (type: Draft['type']) => {
    setDraft(current => {
      const stops = type === 'tour' && current.stops.length === 0 ? [{ date: current.date, dateTba: current.dateTba, location: current.location, startTime: current.startTime, endDate: current.endDate, endTime: current.endTime, timezone: current.timezone || DEFAULT_TIME_ZONE, completed: false }] : current.stops
      const first = stops[0]
      return { ...current, type, stops, date: type === 'concert' ? first?.date || current.date : current.date, startTime: type === 'concert' ? first?.startTime || current.startTime : current.startTime, endDate: type === 'concert' ? first?.endDate || current.endDate : current.endDate, endTime: type === 'concert' ? first?.endTime || current.endTime : current.endTime, timezone: type === 'concert' ? first?.timezone || current.timezone : current.timezone, location: type === 'concert' ? first?.location || current.location : current.location, dateTba: type === 'tour' ? stops.every(stop => stop.dateTba) : first ? first.dateTba : current.dateTba }
    })
    setNotice('')
  }
  async function image(file?: File) {
    if (!file) return
    setError(''); setNotice('')
    if (!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)) { setError('Choose a JPG, PNG, WebP or GIF.'); return }
    setUploading(true); setProgress(0)
    try { const media = await uploadMedia('event', file, setProgress); setDraft(current => ({ ...current, imageId: media.id, imageUrl: media.url })); setNotice('Photo uploaded. Save the event to publish it.') }
    catch(e) { setError((e as Error).message) } finally { setUploading(false) }
  }
  async function music(file?: File) {
    if (!file) return
    setError(''); setNotice('')
    if (!file.type.startsWith('audio/')) { setError('Choose an audio file (MP3, WAV, OGG, M4A or AAC).'); return }
    setMusicUploading(true); setMusicProgress(0)
    try { const media = await uploadMedia('audio', file, setMusicProgress); setDraft(current => ({ ...current, musicId: media.id, musicUrl: media.url, musicName: media.name })); setNotice('Music uploaded. Save the event to publish it.') }
    catch(e) { setError((e as Error).message) } finally { setMusicUploading(false) }
  }
  async function save() {
    setError(''); setNotice('')
    if (!draft.imageId) { setError('Upload an event photo first.'); return }
    setWorking(true)
    try {
      const { id, imageUrl, musicUrl, musicName, ...fields } = draft; void imageUrl; void musicUrl; void musicName
      const stops = draft.type === 'tour' ? fields.stops.map(stop => ({ ...stop, date: stop.dateTba || !stop.date ? undefined : stop.date, endDate: stop.dateTba || !stop.date || !stop.endDate ? undefined : stop.endDate })) : fields.stops
      const payload = { ...fields, date: draft.type === 'tour' || draft.dateTba || !fields.date ? undefined : fields.date, location: draft.type === 'tour' || !fields.location ? undefined : fields.location, stops }
      const route = `admin/events${id ? `/${id}` : ''}`
      const method = id ? 'PUT' : 'POST'
      let value: LiveEvent
      let partial = false
      try {
        value = await api<LiveEvent>(route, method, payload)
      } catch (first) {
        // Older server versions reject fields they do not know about. Retry without them so saving always works.
        const message = (first as Error).message || ''
        const keys = [...message.matchAll(/"([^"]+)"/g)].map(match => match[1]).filter(key => key in payload)
        if (!message.includes('Unrecognized key') || !keys.length) throw first
        const retry = { ...payload } as Record<string, unknown>
        for (const key of keys) delete retry[key]
        value = await api<LiveEvent>(route, method, retry)
        partial = true
      }
      setEvents(current => [...current.filter(event => event.id !== value.id), value].sort((a,b) => Number(a.isPast) - Number(b.isPast) || Number(a.dateTba) - Number(b.dateTba) || a.date.localeCompare(b.date) || a.name.localeCompare(b.name)))
      choose(value)
      if (partial) setNotice('Event saved, but the connected server is an older version and ignored some fields (like the event number). Restart or redeploy the server to save them.')
      else setNotice(value.published ? 'Event is live on the website.' : 'Event saved and hidden from the website.')
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
          <button className="admin-event-select" aria-pressed={draft.id === event.id} disabled={busy} onClick={() => select(event)}><img src={event.imageUrl} alt="" /><span><strong>{event.name}</strong><span>{eventLocationLabel(event)}</span><time dateTime={event.date || undefined}>{eventDateLabel(event)}</time><span className="admin-event-visibility">{event.isPast ? 'Past event' : event.published ? 'Visible on website' : 'Hidden'}</span></span></button>
          {removing === event.id ? <div className="admin-event-confirm"><p>Remove this event from the website?</p><button disabled={busy} onClick={() => void remove(event)}>Remove event</button><button disabled={busy} onClick={() => setRemoving(null)}>Keep event</button></div> : <button className="admin-remove" disabled={busy} onClick={() => setRemoving(event.id)} aria-label={`Remove ${event.name}`}>Remove</button>}
        </div>)}
        <p className="admin-file-help">Visible events appear in date order. Dates always include the year. Events whose date is to be announced appear last.</p>
      </section>
      <form className="admin-panel admin-event-form" onSubmit={event => { event.preventDefault(); void save() }}><fieldset className="admin-edit-fields" disabled={busy}><div className="admin-event-editor-heading"><h2>{draft.id ? 'Edit event' : 'Add event'}</h2><span>{dirty ? 'Unsaved changes' : draft.id ? 'Saved' : 'New event'}</span></div>
        <label className="admin-field admin-event-format">Event format<select value={draft.type} onChange={event => changeType(event.target.value as Draft['type'])}><option value="concert">Single</option><option value="tour">Tour</option></select></label>
        <div className="admin-event-fields"><div className="admin-event-artwork"><div className="admin-event-photo">{draft.imageUrl ? <img src={draft.imageUrl} alt={draft.name ? `${draft.name} preview` : 'Event photo preview'} /> : <div><Image size={28} weight="light" /><p>Add the event artwork</p></div>}</div>
        <label className={`admin-upload ${!uploadsAvailable ? 'is-disabled' : ''}`}><UploadSimple size={17} />{uploading ? `Uploading ${progress}%` : draft.imageUrl ? 'Replace event photo' : 'Upload event photo'}<input aria-label="Event photo" type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={!uploadsAvailable || busy} onChange={event => { void image(event.target.files?.[0]); event.target.value = '' }} /></label><p className="admin-file-help">JPG, PNG, WebP or GIF · Up to 10 MB</p>
        </div>
        <div className="admin-event-music">
          <div className="admin-event-music-head"><strong>Event music</strong><span>Plays when visitors open this event. Different track for every event.</span></div>
          <label className={`admin-upload ${!uploadsAvailable ? 'is-disabled' : ''}`}><UploadSimple size={17} />{musicUploading ? `Uploading ${musicProgress}%` : draft.musicUrl ? 'Replace event music' : 'Upload event music'}<input aria-label="Event music" type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/ogg,audio/mp4,audio/aac,audio/*" disabled={!uploadsAvailable || busy} onChange={event => { void music(event.target.files?.[0]); event.target.value = '' }} /></label>
          {draft.musicUrl && <div className="admin-event-music-track"><span>{draft.musicName || 'Event music track'}</span><button type="button" disabled={busy} onClick={() => { change('musicId', null); change('musicUrl', null); change('musicName', null) }} aria-label="Remove event music">Remove</button></div>}
          <p className="admin-file-help">MP3, WAV, OGG, M4A or AAC · Up to 30 MB · Optional</p>
        </div><div className="admin-event-details">
        <label className="admin-field">Event name<input ref={nameInput} value={draft.name} required maxLength={160} onChange={event => change('name',event.target.value)} placeholder="Event or artist name" /></label>
        <label className="admin-field">Artist{draft.type === 'concert' && ' (optional)'}<input value={draft.artist} required={draft.type === 'tour'} maxLength={160} onChange={event => change('artist', event.target.value)} placeholder="Artist performing at every show" /></label>
        <label className="admin-field">Details<textarea value={draft.description} maxLength={5000} rows={4} onChange={event => change('description', event.target.value)} placeholder="About the event, doors, age restrictions and other details" /></label>
        <label className="admin-field">Event number<input value={draft.eventNumber} maxLength={20} onChange={event => change('eventNumber', event.target.value)} placeholder="001" /></label>
        <label className="admin-field">Organizer by<select value={draft.organizerType || 'org'} onChange={event => change('organizerType', event.target.value as LiveEvent['organizerType'])}><option value="org">Org by</option><option value="tour">Tour by</option></select></label>
        <label className="admin-field">Organizer name<input value={draft.organizer} maxLength={160} onChange={event => change('organizer', event.target.value)} placeholder="Who organized this event" /></label>
        <label className="admin-field">Message to fans<textarea value={draft.organizerMessage} maxLength={2000} rows={3} onChange={event => change('organizerMessage', event.target.value)} placeholder="A short thank-you or note from the organizer to the people who came" /></label>
        <div className="admin-event-schedule admin-recap-fields">
          <label className="admin-field">Recap album<select value={draft.albumId || ''} onChange={event => change('albumId', event.target.value || null)}><option value="">No linked album</option>{albums.map(album => <option key={album.id} value={album.id}>{album.name}</option>)}</select></label>
          <label className="admin-field">Recap video<input type="url" value={draft.recapUrl || ''} maxLength={400} onChange={event => change('recapUrl', event.target.value)} placeholder="https://youtube.com/watch?v=…" /></label>
        </div>
        <p className="admin-file-help">Link a gallery album or aftermovie so the past event popup can show photos and the recap video.</p>
        {draft.type === 'concert' ? <>
          <label className="admin-field">Location<input value={draft.location} required maxLength={160} onChange={event => change('location',event.target.value)} placeholder="City, venue or country" /></label>
          {draft.dateTba ? <div className="admin-field">Event date<span className="admin-date-announced">{TBA_LABEL}</span></div> : <label className="admin-field">Event date<input type="date" value={draft.date} required min="1900-01-01" max="2200-12-31" onChange={event => change('date',event.target.value)} /></label>}
          <div className="admin-event-schedule">
            <label className="admin-field">Start time<input type="time" value={draft.startTime || ''} onChange={event => change('startTime', event.target.value)} /></label>
            <label className="admin-field">End date<input type="date" value={draft.endDate || ''} min={draft.date || '1900-01-01'} max="2200-12-31" onChange={event => change('endDate', event.target.value)} /></label>
            <label className="admin-field">End time<input type="time" value={draft.endTime || ''} onChange={event => change('endTime', event.target.value)} /></label>
            <label className="admin-field">Time zone<input list="trn-timezones" value={draft.timezone || DEFAULT_TIME_ZONE} maxLength={64} onChange={event => change('timezone', event.target.value)} placeholder={DEFAULT_TIME_ZONE} /></label>
          </div>
          <p className="admin-file-help">Add the local start and end time for an exact countdown. Times are shown in the event time zone.</p>
        </> : <section className="admin-tour-dates" aria-labelledby="admin-tour-title"><h3 id="admin-tour-title">Tour dates and locations</h3><p className="admin-file-help">Add at least two shows. Dated shows are saved in chronological order; shows marked as to be announced appear last.</p>
          {draft.stops.map((stop,index) => <fieldset className="admin-tour-stop" key={index}><legend>Show {index + 1}</legend>
            <label className="admin-field">Location<input aria-label={`Show ${index + 1} location`} required maxLength={160} value={stop.location} placeholder="City and venue" onChange={event => changeStop(index, 'location', event.target.value)} /></label>
            <div className="admin-field">Date{stop.dateTba ? <span className="admin-date-announced">{TBA_LABEL}</span> : <input aria-label={`Show ${index + 1} date`} type="date" required min="1900-01-01" max="2200-12-31" value={stop.date} onChange={event => changeStop(index, 'date', event.target.value)} />}
              <label className="admin-stop-tba"><input type="checkbox" checked={stop.dateTba} onChange={event => setStopTba(index, event.target.checked)} />Date to be announced</label>
              <label className="admin-stop-tba"><input type="checkbox" checked={Boolean(stop.completed)} onChange={event => setStopCompleted(index, event.target.checked)} />Show completed</label>
            </div>
            <button type="button" className="admin-tour-remove" disabled={draft.stops.length <= 1} onClick={() => change('stops', draft.stops.filter((_,i) => i !== index))} aria-label={`Remove show ${index + 1}`}><X size={18} /></button>
            <div className="admin-tour-stop-schedule">
              <label className="admin-field">Start time<input aria-label={`Show ${index + 1} start time`} type="time" value={stop.startTime || ''} onChange={event => changeStop(index, 'startTime', event.target.value)} /></label>
              <label className="admin-field">End date<input aria-label={`Show ${index + 1} end date`} type="date" value={stop.endDate || ''} min={stop.date || '1900-01-01'} max="2200-12-31" onChange={event => changeStop(index, 'endDate', event.target.value)} /></label>
              <label className="admin-field">End time<input aria-label={`Show ${index + 1} end time`} type="time" value={stop.endTime || ''} onChange={event => changeStop(index, 'endTime', event.target.value)} /></label>
              <label className="admin-field">Time zone<input aria-label={`Show ${index + 1} time zone`} list="trn-timezones" value={stop.timezone || DEFAULT_TIME_ZONE} maxLength={64} onChange={event => changeStop(index, 'timezone', event.target.value)} placeholder={DEFAULT_TIME_ZONE} /></label>
            </div>
          </fieldset>)}
          <button type="button" className="admin-upload admin-tour-add" disabled={draft.stops.length >= 100} onClick={() => change('stops', [...draft.stops, { date: '', dateTba: draft.dateTba, location: '', startTime: '', endTime: '', timezone: draft.timezone || DEFAULT_TIME_ZONE, completed: false }])}><Plus size={20} aria-hidden="true" />Add show</button>
        </section>}
        <div className="admin-event-toggles">
          <label className="admin-event-publish"><input type="checkbox" checked={draft.published} onChange={event => change('published',event.target.checked)} />Visible on website</label>
          <label className="admin-event-publish"><input type="checkbox" checked={draft.isPast} onChange={event => change('isPast',event.target.checked)} />Past event</label>
          <label className="admin-event-publish"><input type="checkbox" checked={draft.type === 'tour' ? draft.stops.length > 0 && draft.stops.every(stop => stop.dateTba) : draft.dateTba} onChange={event => setTba(event.target.checked)} />{draft.type === 'tour' ? 'All dates to be announced' : 'Date to be announced'}</label>
        </div>
        <div className="admin-event-actions"><button type="submit" className="admin-primary" disabled={!dirty || busy}>{working ? 'Saving…' : 'Save event'}</button>{dirty && <button type="button" className="admin-discard" disabled={busy} onClick={() => { setDraft(JSON.parse(saved) as Draft); setError(''); setNotice('') }}>Discard changes</button>}</div>
      </div></div>
      <datalist id="trn-timezones">{TIME_ZONE_OPTIONS.map(zone => <option key={zone} value={zone} />)}</datalist>
      </fieldset></form>
    </div>}
    <p className="admin-footer-note">Saved events appear on new visits immediately. Open pages update within 30 seconds.</p>
  </section>
}
