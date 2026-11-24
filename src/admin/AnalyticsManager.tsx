import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ArrowClockwise,
  ChartLineUp,
  Clock,
  CopySimple,
  Desktop,
  DeviceMobile,
  DeviceTablet,
  Eye,
  FacebookLogo,
  GlobeHemisphereWest,
  GoogleLogo,
  InstagramLogo,
  LinkSimple,
  TiktokLogo,
  UsersThree,
  WifiHigh,
} from '@phosphor-icons/react'
import { api } from '../settings'
import setupSql from '../../server/analytics.sql?raw'
import './analytics.css'

type RangeKey = '24h' | '7d' | '30d' | '90d' | 'all' | 'custom'
type Granularity = 'hour' | 'day' | 'week' | 'month'
type RangeInfo = { from: string; to: string; timezone: string; granularity: Granularity; preset: RangeKey; label: string }
type SeriesPoint = { bucket: string; visitors: number; pageViews: number }
type CountryRow = { country: string; countryCode: string; visitors: number }
type CityRow = { city: string; country: string; countryCode: string; region: string; visitors: number }
type PageRow = { path: string; title: string; views: number; visitors: number }
type SourceRow = { source: string; visitors: number; pageViews: number }
type DeviceRow = { name: string; visitors: number; sessions: number }
type RecentRow = { path: string; title: string; country: string | null; countryCode: string; city: string | null; device: string; createdAt: string }
type AnalyticsData = {
  generatedAt: string
  range: RangeInfo
  allTime: { visitors: number; pageViews: number; sessions: number }
  overview: {
    visitors: number
    pageViews: number
    sessions: number
    today: number
    yesterday: number
    thisWeek: number
    thisMonth: number
    online: number
    avgSessionSeconds: number
    newVisitors: number
    returningVisitors: number
  }
  series: SeriesPoint[]
  countries: CountryRow[]
  cities: CityRow[]
  pages: PageRow[]
  sources: SourceRow[]
  devices: DeviceRow[]
  browsers: DeviceRow[]
  systems: DeviceRow[]
  recent: RecentRow[]
  onlineWindowMinutes?: number
}

const NUMBER = new Intl.NumberFormat('en-US')
const RANGES: { key: RangeKey; label: string }[] = [
  { key: '24h', label: '24 hours' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' },
  { key: 'all', label: 'All time' },
  { key: 'custom', label: 'Custom' },
]

const format = (value: number | undefined) => NUMBER.format(Math.max(0, Math.round(Number(value) || 0)))

function duration(seconds: number) {
  const total = Math.max(0, Math.round(Number(seconds) || 0))
  if (!total) return '0s'
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remaining = minutes % 60
  return remaining ? `${hours}h ${remaining}m` : `${hours}h`
}

function flag(code?: string) {
  const value = String(code || '').toUpperCase()
  if (!/^[A-Z]{2}$/.test(value)) return '🌐'
  return String.fromCodePoint(...[...value].map(character => 0x1f1e6 + character.charCodeAt(0) - 65))
}

function bucketParts(bucket: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(bucket || '')
  if (!match) return null
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), hour: Number(match[4]), minute: Number(match[5]) }
}

function bucketDate(bucket: string) {
  const parts = bucketParts(bucket)
  if (!parts) return null
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute))
}

function bucketLabel(bucket: string, granularity: Granularity) {
  const date = bucketDate(bucket)
  if (!date) return bucket
  if (granularity === 'hour') return date.toLocaleTimeString('en-US', { hour: 'numeric', timeZone: 'UTC' })
  if (granularity === 'month') return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' })
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function bucketFull(bucket: string, granularity: Granularity) {
  const date = bucketDate(bucket)
  if (!date) return bucket
  if (granularity === 'hour') {
    return date.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })
  }
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function ago(value: string) {
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return ''
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

const percent = (value: number, total: number) => (total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0);
const localDate = (date: Date) => {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

function DeviceGlyph({ name, size = 16 }: { name: string; size?: number }) {
  const key = String(name || '').toLowerCase()
  if (key.includes('mobile') || key.includes('phone')) return <DeviceMobile size={size} aria-hidden="true" />
  if (key.includes('tablet') || key.includes('ipad')) return <DeviceTablet size={size} aria-hidden="true" />
  return <Desktop size={size} aria-hidden="true" />
}

function SourceGlyph({ source, size = 16 }: { source: string; size?: number }) {
  const key = String(source || '').toLowerCase()
  if (key.includes('instagram')) return <InstagramLogo size={size} aria-hidden="true" />
  if (key.includes('facebook')) return <FacebookLogo size={size} aria-hidden="true" />
  if (key.includes('tiktok')) return <TiktokLogo size={size} aria-hidden="true" />
  if (key.includes('google')) return <GoogleLogo size={size} aria-hidden="true" />
  if (key === 'direct') return <LinkSimple size={size} aria-hidden="true" />
  return <GlobeHemisphereWest size={size} aria-hidden="true" />
}

function Stat({ label, value, hint, icon, live = false }: { label: string; value: string; hint?: string; icon: ReactNode; live?: boolean }) {
  return (
    <div className={`analytics-stat${live ? ' is-live' : ''}`}>
      <div className="analytics-stat-top"><span>{label}</span>{icon}</div>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  )
}

type BarRow = { key: string; label: string; value: number; meta?: string; icon?: ReactNode; flag?: string }

function BarList({ rows, empty, muted = false }: { rows: BarRow[]; empty: string; muted?: boolean }) {
  const max = Math.max(1, ...rows.map(row => row.value))
  if (!rows.length) return <p className="analytics-empty">{empty}</p>
  return (
    <ul className={`analytics-bars${muted ? ' is-muted' : ''}`}>
      {rows.map(row => (
        <li key={row.key}>
          <div className="analytics-bar-head">
            <span className="analytics-bar-name">
              {row.flag && <span className="analytics-flag" aria-hidden="true">{row.flag}</span>}
              {row.icon}
              <span>{row.label}</span>
            </span>
            <span className="analytics-bar-value">{format(row.value)}</span>
          </div>
          <div className="analytics-bar-track"><span style={{ width: `${percent(row.value, max)}%` }} /></div>
          {row.meta && <span className="analytics-bar-meta">{row.meta}</span>}
        </li>
      ))}
    </ul>
  )
}

function TrendChart({ points, granularity }: { points: SeriesPoint[]; granularity: Granularity }) {
  const [hover, setHover] = useState<number | null>(null)
  const width = 760
  const height = 300
  const pad = { top: 24, right: 18, bottom: 36, left: 44 }
  const innerWidth = width - pad.left - pad.right
  const innerHeight = height - pad.top - pad.bottom
  const max = Math.max(1, ...points.map(point => Math.max(point.visitors, point.pageViews)))
  const ceiling = Math.max(4, Math.ceil(max / 4) * 4)
  const x = (index: number) => pad.left + (points.length <= 1 ? innerWidth / 2 : (index / (points.length - 1)) * innerWidth)
  const y = (value: number) => pad.top + innerHeight - (value / ceiling) * innerHeight
  const visitorPath = points.map((point, index) => `${index ? 'L' : 'M'}${x(index).toFixed(2)},${y(point.visitors).toFixed(2)}`).join(' ')
  const viewPath = points.map((point, index) => `${index ? 'L' : 'M'}${x(index).toFixed(2)},${y(point.pageViews).toFixed(2)}`).join(' ')
  const areaPath = points.length
    ? `${visitorPath} L${x(points.length - 1).toFixed(2)},${y(0).toFixed(2)} L${x(0).toFixed(2)},${y(0).toFixed(2)} Z`
    : ''
  const labelIndices = useMemo(() => {
    if (points.length <= 6) return points.map((_point, index) => index)
    return [...new Set(Array.from({ length: 6 }, (_value, index) => Math.round((index * (points.length - 1)) / 5)))]
  }, [points])
  const active = hover !== null ? points[hover] : null
  const totalVisitors = points.reduce((sum, point) => sum + point.visitors, 0)
  const totalViews = points.reduce((sum, point) => sum + point.pageViews, 0)
  const empty = totalVisitors === 0 && totalViews === 0

  if (!points.length) return <p className="analytics-empty">No chart data for this range yet.</p>

  return (
    <div className="analytics-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Visitors and page views chart. ${format(totalVisitors)} visitor points and ${format(totalViews)} page views across ${points.length} buckets.`}
        onPointerMove={event => {
          const rect = event.currentTarget.getBoundingClientRect()
          if (!rect.width) return
          const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
          setHover(Math.round(ratio * (points.length - 1)))
        }}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="analytics-visitor-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#d7193f" stopOpacity="0.34" />
            <stop offset="100%" stopColor="#d7193f" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map(tick => {
          const value = Math.round(ceiling * tick)
          const lineY = y(value)
          return (
            <g key={tick}>
              <line x1={pad.left} x2={width - pad.right} y1={lineY} y2={lineY} stroke="#2b2b2b" strokeDasharray={tick === 0 ? undefined : '3 5'} />
              <text x={pad.left - 10} y={lineY + 4} textAnchor="end" fill="#7d7d7d" fontSize="11">{format(value)}</text>
            </g>
          )
        })}
        {areaPath && <path d={areaPath} fill="url(#analytics-visitor-fill)" />}
        <path d={viewPath} fill="none" stroke="#b9b9b9" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" strokeDasharray="5 5" />
        <path d={visitorPath} fill="none" stroke="#d7193f" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
        {labelIndices.map(index => {
          const anchor = index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'
          return (
            <text key={index} x={x(index)} y={height - 12} textAnchor={anchor} fill="#7d7d7d" fontSize="11">
              {bucketLabel(points[index]?.bucket || '', granularity)}
            </text>
          )
        })}
        {hover !== null && points[hover] && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + innerHeight} stroke="#5c5c5c" strokeDasharray="3 4" />
            <circle cx={x(hover)} cy={y(points[hover].visitors)} r="4" fill="#d7193f" stroke="#171717" strokeWidth="2" />
            <circle cx={x(hover)} cy={y(points[hover].pageViews)} r="3.5" fill="#b9b9b9" stroke="#171717" strokeWidth="2" />
          </g>
        )}
      </svg>
      {active && (
        <div
          className="analytics-chart-tooltip"
          style={{ left: `${Math.min(88, Math.max(12, (x(hover || 0) / width) * 100))}%` }}
          role="status"
        >
          <strong>{bucketFull(active.bucket, granularity)}</strong>
          <span><i className="is-visitors" />Visitors <b>{format(active.visitors)}</b></span>
          <span><i className="is-views" />Page views <b>{format(active.pageViews)}</b></span>
        </div>
      )}
      {empty && <p className="analytics-chart-empty">No visits recorded in this range.</p>}
    </div>
  )
}

function SetupNotice({ onRetry }: { onRetry: () => void }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(setupSql)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2200)
    } catch {
      setCopied(false)
    }
  }
  return (
    <section className="analytics-setup" aria-labelledby="analytics-setup-title">
      <p className="admin-eyebrow">One database step is required</p>
      <h2 id="analytics-setup-title">The analytics tables are not installed yet</h2>
      <p>
        The tracker is already wired into the public website, but this database has no analytics tables.
        Nothing is being recorded until the migration is run, and no numbers are shown here until then.
      </p>
      <ol>
        <li>Open your Supabase project → <strong>SQL Editor</strong>.</li>
        <li>Paste and run the migration SQL below (it is safe to run more than once).</li>
        <li>Return here and select <strong>Check again</strong>.</li>
      </ol>
      <div className="analytics-setup-actions">
        <button type="button" onClick={() => void copy()}>
          <CopySimple size={16} /> {copied ? 'Copied' : 'Copy migration SQL'}
        </button>
        <button type="button" onClick={onRetry}>
          <ArrowClockwise size={16} /> Check again
        </button>
      </div>
      <details>
        <summary>View the SQL migration</summary>
        <pre>{setupSql}</pre>
      </details>
    </section>
  )
}

export default function AnalyticsManager() {
  const today = localDate(new Date())
  const weekAgo = localDate(new Date(Date.now() - 6 * 86_400_000))
  const [range, setRange] = useState<RangeKey>('7d')
  const [customFrom, setCustomFrom] = useState(weekAgo)
  const [customTo, setCustomTo] = useState(today)
  const [appliedCustom, setAppliedCustom] = useState({ from: weekAgo, to: today })
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<{ message: string; code?: string } | null>(null)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const request = useRef(0)

  const query = useMemo(() => {
    const params = new URLSearchParams({ range })
    if (range === 'custom') {
      params.set('from', appliedCustom.from)
      params.set('to', appliedCustom.to)
    }
    return params.toString()
  }, [range, appliedCustom])

  const load = useCallback(async (quiet = false, force = false) => {
    const id = ++request.current
    if (quiet) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const value = await api<AnalyticsData>(`admin/analytics?${query}${force ? '&refresh=1' : ''}`)
      if (id !== request.current) return
      setData(value)
      setUpdatedAt(new Date())
    } catch (reason) {
      if (id !== request.current) return
      const failure = reason as Error & { code?: string }
      setError({ message: failure.message, code: failure.code })
      if (failure.code === 'analytics_not_installed') setData(null)
    } finally {
      if (id === request.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [query])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.hidden) return
      void api<{ online: number; today: number }>('admin/analytics/live')
        .then(value => {
          setData(current => current
            ? { ...current, overview: { ...current.overview, online: value.online, today: value.today } }
            : current)
        })
        .catch(() => { /* the full refresh will report a persistent problem */ })
    }, 20_000)
    return () => window.clearInterval(timer)
  }, [])

  if (loading && !data) {
    return <div className="analytics-loading" role="status"><ChartLineUp size={20} /> Loading real analytics data…</div>
  }

  if (error?.code === 'analytics_not_installed') {
    return <div className="admin-analytics"><SetupNotice onRetry={() => void load(false, true)} /></div>
  }

  const overview = data?.overview
  const newCount = overview?.newVisitors || 0
  const returningCount = overview?.returningVisitors || 0
  const newPercent = percent(newCount, newCount + returningCount)
  const totalRangeVisitors = overview?.visitors || 0

  return (
    <div className="admin-analytics">
      <header className="analytics-head">
        <div>
          <p className="admin-eyebrow">First-party · anonymous</p>
          <h2>Your audience, in real numbers.</h2>
          <p className="analytics-sub">
            Every figure below is read live from this website&apos;s database. Bots are filtered, admin visits are excluded,
            and no location is invented when geolocation is unavailable.
          </p>
        </div>
        <div className="analytics-head-actions">
          <span className={`analytics-live-pill${overview?.online ? ' is-on' : ''}`} aria-live="polite">
            <i aria-hidden="true" />
            {format(overview?.online)} online now
          </span>
          <button type="button" className="analytics-refresh" onClick={() => void load(true)} disabled={refreshing}>
            <ArrowClockwise size={15} /> {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      <div className="analytics-toolbar">
        <div className="analytics-range" role="group" aria-label="Analytics date range">
          {RANGES.map(item => (
            <button
              key={item.key}
              type="button"
              aria-pressed={range === item.key}
              onClick={() => setRange(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {range === 'custom' && (
          <div className="analytics-custom">
            <label>From<input type="date" value={customFrom} max={customTo} onChange={event => setCustomFrom(event.target.value)} /></label>
            <label>To<input type="date" value={customTo} min={customFrom} max={today} onChange={event => setCustomTo(event.target.value)} /></label>
            <button type="button" onClick={() => setAppliedCustom({ from: customFrom, to: customTo })}>Apply</button>
          </div>
        )}
        <span className="analytics-updated">
          {updatedAt ? `Updated ${updatedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : 'Waiting for data'}
        </span>
      </div>

      {error && (
        <div className="admin-message admin-error" role="alert">
          {error.message}
          <button type="button" onClick={() => void load()}>Try again</button>
        </div>
      )}

      {data && data.allTime.pageViews === 0 && (
        <div className="analytics-empty-banner">
          <WifiHigh size={22} />
          <div>
            <strong>Tracking is connected. No visits have been recorded yet.</strong>
            <p>Open the public website in another tab. This dashboard will show the real visit as soon as it arrives — no sample rows are generated.</p>
          </div>
        </div>
      )}

      {data && (
        <>
          <section className="analytics-stats" aria-label="Website analytics overview">
            <Stat label="Unique visitors" value={format(data.allTime.visitors)} hint="All time" icon={<UsersThree size={18} />} />
            <Stat label="Visitors today" value={format(overview?.today)} hint={data.range.timezone.replace(/_/g, ' ')} icon={<Eye size={18} />} />
            <Stat label="Yesterday" value={format(overview?.yesterday)} hint="Full previous day" icon={<Eye size={18} />} />
            <Stat label="This week" value={format(overview?.thisWeek)} hint="Since Monday" icon={<UsersThree size={18} />} />
            <Stat label="This month" value={format(overview?.thisMonth)} hint="Since the 1st" icon={<UsersThree size={18} />} />
            <Stat label="Page views" value={format(data.allTime.pageViews)} hint={`${format(overview?.pageViews)} in selected range`} icon={<ChartLineUp size={18} />} />
            <Stat label="Live now" value={format(overview?.online)} hint={`Active in the last ${data.onlineWindowMinutes || 5} minutes`} icon={<WifiHigh size={18} />} live />
            <Stat label="Avg. session" value={duration(overview?.avgSessionSeconds || 0)} hint="Active time, selected range" icon={<Clock size={18} />} />
            <div className="analytics-stat analytics-stat-split">
              <div className="analytics-stat-top"><span>New vs returning</span><UsersThree size={18} /></div>
              <div className="analytics-split-values">
                <div><strong>{format(newCount)}</strong><span>New</span></div>
                <div><strong>{format(returningCount)}</strong><span>Returning</span></div>
              </div>
              <div className="analytics-split-bar" aria-hidden="true">
                <span className="is-new" style={{ width: `${newPercent}%` }} />
                <span className="is-returning" style={{ width: `${100 - newPercent}%` }} />
              </div>
              <small>{format(totalRangeVisitors)} visitors in this range</small>
            </div>
          </section>

          <section className="analytics-grid">
            <section className="analytics-panel analytics-chart-panel" aria-labelledby="analytics-trend-title">
              <header className="analytics-panel-head">
                <div>
                  <h3 id="analytics-trend-title">Visitors &amp; page views</h3>
                  <p>{data.range.label} · {data.range.granularity} buckets · {data.range.timezone.replace(/_/g, ' ')}</p>
                </div>
                <div className="analytics-legend" aria-hidden="true">
                  <span><i className="is-visitors" />Visitors</span>
                  <span><i className="is-views" />Page views</span>
                </div>
              </header>
              <TrendChart points={data.series} granularity={data.range.granularity} />
            </section>

            <section className="analytics-panel" aria-labelledby="analytics-countries-title">
              <header className="analytics-panel-head">
                <div><h3 id="analytics-countries-title">Top countries</h3><p>Unique visitors by country</p></div>
                <GlobeHemisphereWest size={18} />
              </header>
              <BarList
                empty="Country data appears once a public visitor arrives. Local requests have no country to report."
                rows={data.countries.map(row => ({
                  key: `${row.countryCode}-${row.country}`,
                  label: row.country || 'Unknown',
                  value: row.visitors,
                  flag: flag(row.countryCode),
                }))}
              />
            </section>

            <section className="analytics-panel" aria-labelledby="analytics-cities-title">
              <header className="analytics-panel-head">
                <div><h3 id="analytics-cities-title">Top cities</h3><p>Shown when the provider returns a city</p></div>
                <GlobeHemisphereWest size={18} />
              </header>
              <BarList
                empty="No city has been reported yet. The dashboard shows the country or region instead when a city is unavailable."
                rows={data.cities.map(row => ({
                  key: `${row.city}-${row.countryCode}-${row.visitors}`,
                  label: row.city,
                  value: row.visitors,
                  meta: [row.region, row.country].filter(Boolean).join(' · '),
                  flag: flag(row.countryCode),
                }))}
              />
            </section>

            <section className="analytics-panel" aria-labelledby="analytics-sources-title">
              <header className="analytics-panel-head">
                <div><h3 id="analytics-sources-title">Traffic sources</h3><p>Referrers and UTM campaigns</p></div>
                <LinkSimple size={18} />
              </header>
              <BarList
                empty="No traffic sources yet."
                rows={data.sources.map(row => ({
                  key: row.source,
                  label: row.source,
                  value: row.visitors,
                  meta: `${format(row.pageViews)} page views`,
                  icon: <SourceGlyph source={row.source} />,
                }))}
              />
            </section>

            <section className="analytics-panel" aria-labelledby="analytics-devices-title">
              <header className="analytics-panel-head">
                <div><h3 id="analytics-devices-title">Devices</h3><p>Unique visitors by device type</p></div>
                <Desktop size={18} />
              </header>
              <BarList
                empty="No device data yet."
                muted
                rows={data.devices.map(row => ({
                  key: row.name,
                  label: row.name.charAt(0).toUpperCase() + row.name.slice(1),
                  value: row.visitors,
                  meta: `${format(row.sessions)} sessions`,
                  icon: <DeviceGlyph name={row.name} />,
                }))}
              />
            </section>

            <section className="analytics-panel" aria-labelledby="analytics-browsers-title">
              <header className="analytics-panel-head">
                <div><h3 id="analytics-browsers-title">Browsers</h3><p>Parsed from the user agent, which is not stored</p></div>
                <GlobeHemisphereWest size={18} />
              </header>
              <BarList
                empty="No browser data yet."
                muted
                rows={data.browsers.map(row => ({ key: row.name, label: row.name, value: row.visitors }))}
              />
            </section>

            <section className="analytics-panel" aria-labelledby="analytics-systems-title">
              <header className="analytics-panel-head">
                <div><h3 id="analytics-systems-title">Operating systems</h3><p>Visitor operating system breakdown</p></div>
                <GlobeHemisphereWest size={18} />
              </header>
              <BarList
                empty="No operating system data yet."
                muted
                rows={data.systems.map(row => ({ key: row.name, label: row.name, value: row.visitors }))}
              />
            </section>

            <section className="analytics-panel analytics-panel-wide" aria-labelledby="analytics-pages-title">
              <header className="analytics-panel-head">
                <div><h3 id="analytics-pages-title">Most visited pages</h3><p>Paths, titles and unique visitors in this range</p></div>
                <Eye size={18} />
              </header>
              {data.pages.length ? (
                <div className="analytics-table-wrap">
                  <table className="analytics-table">
                    <thead><tr><th scope="col">Page</th><th scope="col">Views</th><th scope="col">Visitors</th></tr></thead>
                    <tbody>
                      {data.pages.map(row => (
                        <tr key={row.path}>
                          <td>
                            <span className="analytics-page-title">{row.title || row.path}</span>
                            <code>{row.path}</code>
                          </td>
                          <td>{format(row.views)}</td>
                          <td>{format(row.visitors)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="analytics-empty">No page views in this range.</p>}
            </section>

            <section className="analytics-panel analytics-panel-wide" aria-labelledby="analytics-recent-title">
              <header className="analytics-panel-head">
                <div><h3 id="analytics-recent-title">Recent visitor activity</h3><p>The latest page views, not a simulated feed</p></div>
                <Clock size={18} />
              </header>
              {data.recent.length ? (
                <ul className="analytics-recent">
                  {data.recent.map((row, index) => (
                    <li key={`${row.createdAt}-${row.path}-${index}`}>
                      <span className="analytics-recent-flag" aria-hidden="true">{flag(row.countryCode)}</span>
                      <div>
                        <strong>{row.title || row.path}</strong>
                        <span>{row.path}{row.city ? ` · ${row.city}` : ''}{row.country ? `, ${row.country}` : ''}</span>
                      </div>
                      <span className="analytics-recent-device"><DeviceGlyph name={row.device} size={15} /></span>
                      <time dateTime={row.createdAt}>{ago(row.createdAt)}</time>
                    </li>
                  ))}
                </ul>
              ) : <p className="analytics-empty">No visitor activity in this range.</p>}
            </section>
          </section>
        </>
      )}
    </div>
  )
}
