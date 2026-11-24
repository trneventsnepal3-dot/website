/**
 * Anonymous, first-party website analytics.
 *
 * - A random visitor id is kept in localStorage.
 * - A session id rotates after 30 minutes of inactivity and lives in sessionStorage.
 * - Page views are deduplicated with a unique view key generated per navigation.
 * - Only accumulated visible/active time is sent, so "average session duration"
 *   is not inflated by tabs left open in the background.
 * - The admin dashboard never loads this module.
 */

const VISITOR_KEY = 'trn-analytics-visitor-v1';
const SESSION_KEY = 'trn-analytics-session-v1';
const ENDPOINT = '/api/analytics/track';
const IDLE_MS = 30 * 60 * 1000;
const HEARTBEAT_MS = 60 * 1000;
const ACTIVE_WINDOW_MS = 5 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type StoredSession = {
  id: string;
  startedAt: number;
  lastActiveAt: number;
  activeSeconds: number;
};

type Utm = {
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
  term?: string;
};

type Payload = {
  kind: 'pageview' | 'heartbeat';
  viewKey?: string;
  path: string;
  title: string;
  referrer: string;
  utm?: Utm;
  activeSeconds: number;
};

function memoryStorage(kind: 'local' | 'session'): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function read<T>(storage: Storage | null, key: string): T | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(storage: Storage | null, key: string, value: unknown) {
  if (!storage) return;
  try { storage.setItem(key, JSON.stringify(value)); } catch { /* storage may be full or blocked */ }
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function currentPath(): string {
  const { pathname, search, hash } = window.location;
  return `${pathname}${search}${hash}` || '/';
}

function pageTitle(path: string): string {
  const at = path.indexOf('#');
  if (at >= 0) {
    try {
      const target = document.querySelector(path.slice(at));
      const heading = target?.querySelector('h1, h2, h3');
      const text = heading?.textContent?.replace(/\s+/g, ' ').trim();
      if (text) return text.slice(0, 300);
    } catch { /* an invalid selector should not stop tracking */ }
  }
  return (document.title || 'TRN Events Nepal').replace(/\s+/g, ' ').trim().slice(0, 300);
}

function utmParams(): Utm | undefined {  const search = new URLSearchParams(window.location.search);
  const value = (name: string) => search.get(`utm_${name}`)?.trim().slice(0, 120) || undefined;
  const utm: Utm = {
    source: value('source'),
    medium: value('medium'),
    campaign: value('campaign'),
    content: value('content'),
    term: value('term'),
  };
  return Object.values(utm).some(Boolean) ? utm : undefined;
}

export function startAnalytics() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (/^\/admin(?:[/?#]|$)/i.test(window.location.pathname)) return;
  if ((window as unknown as { __trnAnalyticsStarted?: boolean }).__trnAnalyticsStarted) return;
  (window as unknown as { __trnAnalyticsStarted?: boolean }).__trnAnalyticsStarted = true;

  const local = memoryStorage('local');
  const sessionStorage = memoryStorage('session');
  const storedVisitor = read<string>(local, VISITOR_KEY);
  let visitorId = storedVisitor && UUID.test(storedVisitor) ? storedVisitor : '';
  let freshVisitor = false;
  if (!visitorId) {
    visitorId = uuid();
    freshVisitor = true;
    write(local, VISITOR_KEY, visitorId);
  }

  let lastActivity = Date.now();
  let lastTick = Date.now();
  let lastView = { path: '', at: 0 };
  let session = ensureSession(freshVisitor);

  function ensureSession(force = false): StoredSession {
    const now = Date.now();
    const saved = read<StoredSession>(sessionStorage, SESSION_KEY);
    if (!force && saved && UUID.test(String(saved.id)) && now - Number(saved.lastActiveAt || 0) < IDLE_MS) {
      return {
        id: saved.id,
        startedAt: Number(saved.startedAt) || now,
        lastActiveAt: now,
        activeSeconds: Math.max(0, Number(saved.activeSeconds) || 0),
      };
    }
    const next: StoredSession = { id: uuid(), startedAt: now, lastActiveAt: now, activeSeconds: 0 };
    write(sessionStorage, SESSION_KEY, next);
    return next;
  }

  function saveSession() {
    write(sessionStorage, SESSION_KEY, session);
  }

  function accumulate(now: number) {
    if (document.visibilityState === 'visible' && now - lastActivity <= ACTIVE_WINDOW_MS) {
      session.activeSeconds += Math.min(Math.max(now - lastTick, 0), 90_000) / 1000;
    }
    lastTick = now;
    session.lastActiveAt = now;
    saveSession();
  }

  function body(payload: Payload) {
    return JSON.stringify({ ...payload, visitorId, sessionId: session.id });
  }

  async function send(payload: Payload, retry = false) {
    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body(payload),
        credentials: 'omit',
        keepalive: true,
      });
      if (retry && !response.ok && response.status !== 202 && response.status !== 429) {
        window.setTimeout(() => { void send(payload, false); }, 2500);
      }
    } catch {
      if (retry) window.setTimeout(() => { void send(payload, false); }, 2500);
    }
  }

  function beacon(payload: Payload) {
    const data = body(payload);
    if (typeof navigator.sendBeacon === 'function') {
      try {
        if (navigator.sendBeacon(ENDPOINT, new Blob([data], { type: 'application/json' }))) return;
      } catch { /* fall back to fetch */ }
    }
    void send(payload);
  }

  function recordPageView() {
    const path = currentPath();
    if (/^\/admin(?:[/?#]|$)/i.test(path)) return;
    const now = Date.now();
    if (path === lastView.path && now - lastView.at < 1200) return;
    lastView = { path, at: now };
    session = ensureSession();
    accumulate(now);
    lastActivity = now;
    void send({
      kind: 'pageview',
      viewKey: uuid(),
      path,
      title: pageTitle(path),
      referrer: document.referrer || '',
      utm: utmParams(),
      activeSeconds: Math.round(session.activeSeconds),
    }, true);
  }

  function heartbeat(final = false) {
    session = ensureSession();
    accumulate(Date.now());
    const payload: Payload = {
      kind: 'heartbeat',
      path: currentPath(),
      title: pageTitle(currentPath()),
      referrer: document.referrer || '',
      activeSeconds: Math.round(session.activeSeconds),
    };
    if (final) beacon(payload);
    else void send(payload);
  }

  const touch = () => { lastActivity = Date.now(); };
  for (const event of ['pointerdown', 'keydown', 'touchstart', 'scroll'] as const) {
    window.addEventListener(event, touch, { passive: true, capture: true });
  }

  const historyMethods = history as unknown as Record<'pushState' | 'replaceState', (...args: unknown[]) => unknown>;
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = historyMethods[method];
    historyMethods[method] = function (this: History, ...args: unknown[]) {
      const result = original.apply(this, args);
      window.setTimeout(recordPageView, 0);
      return result;
    };
  }

  window.addEventListener('popstate', recordPageView);
  window.addEventListener('hashchange', recordPageView);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      lastActivity = Date.now();
      lastTick = Date.now();
      session = ensureSession();
      return;
    }
    accumulate(Date.now());
    heartbeat(true);
  });

  window.addEventListener('pagehide', () => {
    accumulate(Date.now());
    heartbeat(true);
  });

  window.setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    heartbeat();
  }, HEARTBEAT_MS);

  window.setTimeout(recordPageView, 0);
}
