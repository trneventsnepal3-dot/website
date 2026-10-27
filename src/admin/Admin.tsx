import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Check, Image, MusicNote, UploadSimple, X } from '@phosphor-icons/react'
import { api, type Media, type Settings } from '../settings'
import { uploadMedia } from '../upload'
import './admin.css'
import EventManager from './EventManager'

function Switch({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="admin-switch" disabled={disabled} onClick={() => onChange(!checked)}><span /></button>
}
export default function Admin() {
  const [session, setSession] = useState<'loading' | 'signed-out' | 'signed-in'>('loading')
  const [tab, setTab] = useState<'media' | 'events'>('media')
  const [settings, setSettings] = useState<Settings | null>(null)
  const [saved, setSaved] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState<Exclude<Media['kind'], 'event'> | null>(null)
  const [progress, setProgress] = useState(0)
  const [preview, setPreview] = useState(false)
  const previewDialog = useRef<HTMLDialogElement>(null)
  const previewAudio = useRef<HTMLAudioElement>(null)
  const dirty = settings !== null && JSON.stringify(settings) !== saved
  const load = async () => {
    const value = await api<Settings>('admin/settings'); setSettings(value); setSaved(JSON.stringify(value)); setSession('signed-in')
  }
  useEffect(() => { document.title = 'Site controls — TRN Events'; void load().catch((e: Error & { status?: number }) => { setSession('signed-out'); if (e.status !== 401) setError(e.message) }) }, [])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  useEffect(() => { if (preview) previewDialog.current?.showModal(); else previewDialog.current?.close() }, [preview])
  useEffect(() => { if (previewAudio.current && settings) previewAudio.current.volume = settings.audioVolume }, [settings?.audioVolume, settings?.audio?.url])
  function update<K extends keyof Settings>(key: K, value: Settings[K]) { setSettings(current => current ? { ...current, [key]: value } : current); setNotice('') }
  async function uploadFile(kind: Exclude<Media['kind'], 'event'>, file?: File) {
    if (!file || !settings) return
    setError(''); setNotice('')
    const accepted = { popup: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], audio: ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/mp4', 'audio/aac'], hero: ['video/mp4', 'video/webm'] }[kind]
    if (!accepted.includes(file.type) || file.size > { popup: 10, audio: 30, hero: 100 }[kind] * 1024 * 1024) { setError({ popup: 'Choose a JPG, PNG, WebP or GIF under 10 MB.', audio: 'Choose an MP3, WAV, OGG, M4A or AAC under 30 MB.', hero: 'Choose an MP4 or WebM under 100 MB.' }[kind]); return }
    setUploading(kind); setProgress(0)
    try {
      const media = await uploadMedia(kind, file, setProgress)
      setSettings(current => current ? { ...current, [kind]: media, [`${kind}Id`]: media.id } : current)
      setNotice('Upload ready. Save changes to publish it.')
    } catch (e) { setError((e as Error).message) } finally { setUploading(null) }
  }
  async function save() {
    if (!settings) return
    setBusy(true); setError(''); setNotice('')
    try {
      const { popup, audio, hero, galleryBaseUrl, uploadsAvailable, ...payload } = settings
      void popup; void audio; void hero; void galleryBaseUrl; void uploadsAvailable
      const value = await api<Settings>('admin/settings', 'PUT', payload)
      setSettings(value); setSaved(JSON.stringify(value)); setNotice('Changes are live.')
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return <div className="admin-app">
    <header className="admin-header"><a href="/" className="admin-identity">TRN Events <span>Site controls</span></a><div><a href="/" target="_blank" rel="noreferrer">View website <ArrowUpRight size={16} /></a>{session === 'signed-in' && <button disabled={busy || !!uploading} onClick={async () => { setBusy(true); try { await api('admin/logout', 'POST'); setSettings(null); setSession('signed-out'); setPassword(''); setError(''); setNotice('') } catch(e) { setError((e as Error).message) } finally { setBusy(false) } }}>Sign out</button>}</div></header>
    {session === 'loading' ? <main className="admin-loading" role="status">Loading site controls…</main> : session === 'signed-out' ? <main className="admin-login"><h1>Admin sign in</h1><p>Sign in to manage what’s playing<br />and what’s on show.</p><form onSubmit={async event => { event.preventDefault(); setBusy(true); setError(''); try { await api('admin/login', 'POST', { password }); setPassword(''); await load() } catch(e) { setError((e as Error).message) } finally { setBusy(false) } }}><label htmlFor="admin-password">Admin password</label><input id="admin-password" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" maxLength={128} required autoFocus /><button className="admin-primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button></form>{error && <p className="admin-error" role="alert">{error}</p>}</main> : settings && <main className="admin-main">
      <div className="admin-title"><div><h1>{tab === 'media' ? 'Site settings' : 'Live events'}</h1><p>{tab === 'media' ? 'A poster to announce it. A soundtrack to set the mood.' : 'The photo, the place and the date for your next live event.'}</p></div>{tab === 'media' && <div className="admin-save"><span role="status">{dirty ? 'Unsaved changes' : 'All changes saved'}</span><button className="admin-primary" onClick={() => void save()} disabled={!dirty || busy || !!uploading}>{busy ? 'Saving…' : 'Save changes'}{!busy && <Check size={18} />}</button></div>}</div>
      <nav className="admin-tabs" aria-label="Admin sections"><button aria-pressed={tab === 'media'} onClick={() => setTab('media')} disabled={busy || !!uploading}>Site media{dirty ? ' · Unsaved' : ''}</button><button aria-pressed={tab === 'events'} onClick={() => setTab('events')} disabled={busy || !!uploading}>Live events</button></nav>
      <div hidden={tab !== 'events'}><EventManager uploadsAvailable={Boolean(settings.uploadsAvailable)} /></div>
      <div hidden={tab !== 'media'}>
      {error && <div className="admin-message admin-error" role="alert">{error}{error.includes('Reload') && <button onClick={() => { void load().then(() => setError('')).catch(e => setError(e.message)) }}>Reload settings</button>}</div>}
      {notice && <p className="admin-message" role="status">{notice}</p>}
      <fieldset className="admin-edit-fields" disabled={busy}>
      <section className="admin-master"><div><h2>Site media</h2><p>Switch off all media at once. Your individual settings stay saved.</p></div><div className="admin-toggle-label"><span>{settings.effectsEnabled ? 'On' : 'Off'}</span><Switch label="Enable all site media" checked={settings.effectsEnabled} onChange={v => update('effectsEnabled', v)} disabled={busy} /></div></section>
      {!settings.effectsEnabled && <p className="admin-off-note">Media is paused across the website. Turn site media on to use the settings below.</p>}
      <div className="admin-media-grid">
        <section className="admin-panel"><div className="admin-panel-heading"><div><Image size={20} /><h2>Announcement popup</h2></div><Switch label="Enable announcement popup" checked={settings.popupEnabled} onChange={v => update('popupEnabled', v)} disabled={busy} /></div><p className="admin-description">Shown once per browser tab. Visitors can close it at any time.</p>
          <div className="admin-image-preview">{settings.popup ? <img src={settings.popup.url} alt={settings.popupAlt || 'Popup preview'} /> : <div><Image size={32} weight="light" /><p>Your announcement goes here</p><span>Use a poster or event artwork</span></div>}</div>
          <div className="admin-file-row"><label className={`admin-upload ${!settings.uploadsAvailable || uploading ? 'is-disabled' : ''}`}><UploadSimple size={17} />{uploading === 'popup' ? `Uploading ${progress}%` : settings.popup ? 'Replace image' : 'Upload image'}<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={!settings.uploadsAvailable || !!uploading || busy} onChange={e => { void uploadFile('popup', e.target.files?.[0]); e.target.value = '' }} /></label><button disabled={!settings.popup} onClick={() => setPreview(true)}>Preview</button></div>
          <p className="admin-file-help">{settings.popup ? settings.popup.name : 'JPG, PNG, WebP or GIF · Up to 10 MB'}</p>
          <label className="admin-field">Image description<input value={settings.popupAlt} maxLength={240} onChange={e => update('popupAlt', e.target.value)} placeholder="Describe the poster and its key details" /></label>
          <label className="admin-field">Link <span>(optional)</span><input type="url" value={settings.popupLink} onChange={e => update('popupLink', e.target.value)} placeholder="https://" /></label>
          {settings.popup && <button className="admin-remove" onClick={() => { setSettings(s => s ? { ...s, popup: null, popupId: null, popupEnabled: false } : s); setNotice('') }}>Remove from website</button>}
        </section>
        <div className="admin-right-stack"><section className="admin-panel"><div className="admin-panel-heading"><div><MusicNote size={20} /><h2>Looping soundtrack</h2></div><Switch label="Enable looping audio" checked={settings.audioEnabled} onChange={v => update('audioEnabled', v)} disabled={busy} /></div><p className="admin-description">Plays on repeat. Visitors have their own play and pause control.</p>
          <div className="admin-audio-preview">{settings.audio ? <><p>{settings.audio.name}</p><audio ref={previewAudio} controls preload="metadata" src={settings.audio.url} /></> : <><MusicNote size={30} weight="light" /><p>No soundtrack uploaded</p></>}</div>
          <label className={`admin-upload ${!settings.uploadsAvailable || uploading ? 'is-disabled' : ''}`}><UploadSimple size={17} />{uploading === 'audio' ? `Uploading ${progress}%` : settings.audio ? 'Replace audio' : 'Upload audio'}<input type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/ogg,audio/mp4,audio/aac" disabled={!settings.uploadsAvailable || !!uploading || busy} onChange={e => { void uploadFile('audio', e.target.files?.[0]); e.target.value = '' }} /></label><p className="admin-file-help">MP3, WAV, OGG, M4A or AAC · Up to 30 MB</p>
          <label className="admin-volume">Starting volume <output>{Math.round(settings.audioVolume * 100)}%</output><input aria-label="Starting volume" type="range" min="0" max="1" step="0.05" value={settings.audioVolume} onChange={e => update('audioVolume', Number(e.target.value))} /></label><p className="admin-file-help">Some browsers require a visitor to press play first.</p>
          {settings.audio && <button className="admin-remove" onClick={() => { setSettings(s => s ? { ...s, audio: null, audioId: null, audioEnabled: false } : s); setNotice('') }}>Remove from website</button>}
        </section><section className="admin-panel admin-film"><div className="admin-panel-heading"><h2>Hero film</h2><Switch label="Enable hero video" checked={settings.heroVideoEnabled} onChange={v => update('heroVideoEnabled', v)} disabled={busy} /></div><p className="admin-description">Opening concert footage. The still poster stays visible when switched off.</p><div className="admin-file-row"><label className={`admin-upload ${!settings.uploadsAvailable || uploading ? 'is-disabled' : ''}`}><UploadSimple size={17} />{uploading === 'hero' ? `Uploading ${progress}%` : settings.hero ? 'Replace video' : 'Upload video'}<input aria-label="Hero video file" type="file" accept="video/mp4,video/webm" disabled={!settings.uploadsAvailable || !!uploading || busy} onChange={e => { void uploadFile('hero', e.target.files?.[0]); e.target.value = '' }} /></label><a href={settings.hero?.url || '/media/hero-video.mp4'} target="_blank" rel="noreferrer">Preview film <ArrowUpRight size={14} /></a></div><p className="admin-file-help">{settings.hero ? settings.hero.name : 'MP4 or WebM · Up to 100 MB'}</p>{settings.hero && <button className="admin-remove" onClick={() => { setSettings(s => s ? { ...s, hero: null, heroId: null } : s); setNotice('') }}>Use original film</button>}</section></div>
      </div>
      </fieldset>
      {!settings.uploadsAvailable && <p className="admin-setup-note">Add your Neon object storage credentials to enable uploads.</p>}
      <p className="admin-footer-note">Saved changes appear on new visits immediately and on open pages within 30 seconds.</p>
      </div>
    </main>}
    <dialog ref={previewDialog} className="admin-preview-dialog" aria-label="Announcement preview" onCancel={() => setPreview(false)}><button aria-label="Close preview" onClick={() => setPreview(false)}><X size={24} /></button>{settings?.popup && <img src={settings.popup.url} alt={settings.popupAlt || 'Popup preview'} />}</dialog>
  </div>
}
