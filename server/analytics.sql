-- TRN Events Nepal — anonymous website analytics.
-- Run this once in the Supabase SQL Editor (after server/schema.sql) or with
-- `npm run db:migrate` for a Neon database. It is safe to run again.
--
-- Privacy notes:
--   * No IP addresses, cookies, names, emails or raw user-agent strings are stored.
--   * Visitor ids are random and live in the browser's localStorage.
--   * Geolocation is resolved server-side and only country / region / city are kept.

CREATE TABLE IF NOT EXISTS analytics_visitors (
  id uuid PRIMARY KEY,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  first_path text NOT NULL DEFAULT '',
  last_path text NOT NULL DEFAULT '',
  referrer text NOT NULL DEFAULT '',
  referrer_source text NOT NULL DEFAULT 'direct',
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  country text,
  country_code text,
  region text,
  city text,
  device_type text NOT NULL DEFAULT 'unknown',
  browser text NOT NULL DEFAULT 'unknown',
  os text NOT NULL DEFAULT 'unknown',
  page_view_count integer NOT NULL DEFAULT 0,
  session_count integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS analytics_sessions (
  id uuid PRIMARY KEY,
  visitor_id uuid NOT NULL REFERENCES analytics_visitors(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  entry_path text NOT NULL DEFAULT '',
  exit_path text NOT NULL DEFAULT '',
  referrer text NOT NULL DEFAULT '',
  referrer_source text NOT NULL DEFAULT 'direct',
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  country text,
  country_code text,
  region text,
  city text,
  device_type text NOT NULL DEFAULT 'unknown',
  browser text NOT NULL DEFAULT 'unknown',
  os text NOT NULL DEFAULT 'unknown',
  page_view_count integer NOT NULL DEFAULT 0,
  duration_seconds integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS analytics_page_views (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  view_key text NOT NULL UNIQUE,
  visitor_id uuid NOT NULL REFERENCES analytics_visitors(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES analytics_sessions(id) ON DELETE CASCADE,
  path text NOT NULL,
  title text NOT NULL DEFAULT '',
  referrer text NOT NULL DEFAULT '',
  referrer_source text NOT NULL DEFAULT 'direct',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS analytics_visitors_first_seen_idx ON analytics_visitors(first_seen);
CREATE INDEX IF NOT EXISTS analytics_visitors_last_seen_idx ON analytics_visitors(last_seen);
CREATE INDEX IF NOT EXISTS analytics_sessions_started_idx ON analytics_sessions(started_at);
CREATE INDEX IF NOT EXISTS analytics_sessions_last_seen_idx ON analytics_sessions(last_seen);
CREATE INDEX IF NOT EXISTS analytics_sessions_visitor_idx ON analytics_sessions(visitor_id);
CREATE INDEX IF NOT EXISTS analytics_page_views_created_idx ON analytics_page_views(created_at);
CREATE INDEX IF NOT EXISTS analytics_page_views_visitor_idx ON analytics_page_views(visitor_id);
CREATE INDEX IF NOT EXISTS analytics_page_views_session_idx ON analytics_page_views(session_id);
CREATE INDEX IF NOT EXISTS analytics_page_views_path_idx ON analytics_page_views(path);

-- All access goes through the server's authenticated admin routes. Enabling RLS
-- with no policies means the public / publishable Supabase keys cannot read,
-- insert or update a single analytics row.
ALTER TABLE analytics_visitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_page_views ENABLE ROW LEVEL SECURITY;

-- Records one idempotent analytics event. The visitor and session upserts are
-- safe to retry; the unique view_key guarantees a page view is only counted once.
CREATE OR REPLACE FUNCTION analytics_track(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_visitor uuid := (payload->>'visitorId')::uuid;
  v_session uuid := (payload->>'sessionId')::uuid;
  v_kind text := COALESCE(NULLIF(payload->>'kind', ''), 'pageview');
  v_view_key text := NULLIF(payload->>'viewKey', '');
  v_path text := LEFT(COALESCE(NULLIF(payload->>'path', ''), '/'), 500);
  v_title text := LEFT(COALESCE(payload->>'title', ''), 300);
  v_referrer text := LEFT(COALESCE(payload->>'referrer', ''), 1000);
  v_source text := LEFT(COALESCE(NULLIF(payload->>'referrerSource', ''), 'direct'), 120);
  v_country text := NULLIF(payload->>'country', '');
  v_country_code text := UPPER(NULLIF(payload->>'countryCode', ''));
  v_region text := NULLIF(payload->>'region', '');
  v_city text := NULLIF(payload->>'city', '');
  v_device text := COALESCE(NULLIF(payload->>'deviceType', ''), 'unknown');
  v_browser text := COALESCE(NULLIF(payload->>'browser', ''), 'unknown');
  v_os text := COALESCE(NULLIF(payload->>'os', ''), 'unknown');
  v_utm_source text := NULLIF(payload->>'utmSource', '');
  v_utm_medium text := NULLIF(payload->>'utmMedium', '');
  v_utm_campaign text := NULLIF(payload->>'utmCampaign', '');
  v_utm_content text := NULLIF(payload->>'utmContent', '');
  v_utm_term text := NULLIF(payload->>'utmTerm', '');
  v_active integer := LEAST(GREATEST(COALESCE((payload->>'activeSeconds')::int, 0), 0), 43200);
  v_created boolean := false;
BEGIN
  IF v_visitor IS NULL OR v_session IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing-ids');
  END IF;

  INSERT INTO analytics_visitors (
    id, first_path, last_path, referrer, referrer_source,
    utm_source, utm_medium, utm_campaign, utm_content, utm_term,
    country, country_code, region, city, device_type, browser, os
  ) VALUES (
    v_visitor, v_path, v_path, v_referrer, v_source,
    v_utm_source, v_utm_medium, v_utm_campaign, v_utm_content, v_utm_term,
    v_country, v_country_code, v_region, v_city, v_device, v_browser, v_os
  ) ON CONFLICT (id) DO NOTHING;

  UPDATE analytics_visitors AS vi SET
    last_seen = now(),
    last_path = v_path,
    country = COALESCE(vi.country, v_country),
    country_code = COALESCE(vi.country_code, v_country_code),
    region = COALESCE(vi.region, v_region),
    city = COALESCE(vi.city, v_city),
    device_type = CASE WHEN vi.device_type = 'unknown' THEN v_device ELSE vi.device_type END,
    browser = CASE WHEN vi.browser = 'unknown' THEN v_browser ELSE vi.browser END,
    os = CASE WHEN vi.os = 'unknown' THEN v_os ELSE vi.os END,
    utm_source = COALESCE(v_utm_source, vi.utm_source),
    utm_medium = COALESCE(v_utm_medium, vi.utm_medium),
    utm_campaign = COALESCE(v_utm_campaign, vi.utm_campaign),
    utm_content = COALESCE(v_utm_content, vi.utm_content),
    utm_term = COALESCE(v_utm_term, vi.utm_term)
  WHERE vi.id = v_visitor;

  INSERT INTO analytics_sessions (
    id, visitor_id, entry_path, exit_path, referrer, referrer_source,
    utm_source, utm_medium, utm_campaign, utm_content, utm_term,
    country, country_code, region, city, device_type, browser, os, duration_seconds
  ) VALUES (
    v_session, v_visitor, v_path, v_path, v_referrer, v_source,
    v_utm_source, v_utm_medium, v_utm_campaign, v_utm_content, v_utm_term,
    v_country, v_country_code, v_region, v_city, v_device, v_browser, v_os, v_active
  ) ON CONFLICT (id) DO NOTHING;

  IF FOUND THEN
    UPDATE analytics_visitors SET session_count = session_count + 1 WHERE id = v_visitor;
  ELSE
    UPDATE analytics_sessions AS se SET
      last_seen = now(),
      exit_path = v_path,
      duration_seconds = GREATEST(se.duration_seconds, v_active),
      country = COALESCE(se.country, v_country),
      country_code = COALESCE(se.country_code, v_country_code),
      region = COALESCE(se.region, v_region),
      city = COALESCE(se.city, v_city),
      device_type = CASE WHEN se.device_type = 'unknown' THEN v_device ELSE se.device_type END,
      browser = CASE WHEN se.browser = 'unknown' THEN v_browser ELSE se.browser END,
      os = CASE WHEN se.os = 'unknown' THEN v_os ELSE se.os END,
      utm_source = COALESCE(v_utm_source, se.utm_source),
      utm_medium = COALESCE(v_utm_medium, se.utm_medium),
      utm_campaign = COALESCE(v_utm_campaign, se.utm_campaign),
      utm_content = COALESCE(v_utm_content, se.utm_content),
      utm_term = COALESCE(v_utm_term, se.utm_term)
    WHERE se.id = v_session;
  END IF;

  IF v_kind = 'pageview' AND v_view_key IS NOT NULL THEN
    INSERT INTO analytics_page_views (view_key, visitor_id, session_id, path, title, referrer, referrer_source)
    VALUES (v_view_key, v_visitor, v_session, v_path, v_title, v_referrer, v_source)
    ON CONFLICT (view_key) DO NOTHING;

    IF FOUND THEN
      UPDATE analytics_visitors SET page_view_count = page_view_count + 1 WHERE id = v_visitor;
      UPDATE analytics_sessions
        SET page_view_count = page_view_count + 1, exit_path = v_path, last_seen = now()
        WHERE id = v_session;
      v_created := true;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'recorded', v_created);
END;
$$;

-- Returns every figure the admin dashboard needs in one request.
-- p_from = NULL means "since the first recorded visit".
-- p_granularity = 'auto' chooses hour/day/week/month from the range width.
CREATE OR REPLACE FUNCTION analytics_dashboard(
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_tz text DEFAULT 'Asia/Kathmandu',
  p_granularity text DEFAULT 'day'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_to timestamptz := COALESCE(p_to, now());
  v_from timestamptz;
  v_tz text := COALESCE(NULLIF(p_tz, ''), 'Asia/Kathmandu');
  v_gran text := LOWER(COALESCE(NULLIF(p_granularity, ''), 'day'));
  v_today date;
  v_week_start timestamp;
  v_month_start timestamp;
  v_all jsonb;
  v_overview jsonb;
  v_series jsonb;
  v_countries jsonb;
  v_cities jsonb;
  v_pages jsonb;
  v_sources jsonb;
  v_devices jsonb;
  v_browsers jsonb;
  v_systems jsonb;
  v_recent jsonb;
BEGIN
  BEGIN
    PERFORM now() AT TIME ZONE v_tz;
  EXCEPTION WHEN others THEN
    v_tz := 'UTC';
  END;

  IF p_granularity = 'auto' THEN
    IF p_from IS NULL THEN
      SELECT COALESCE(MIN(first_seen), now() - interval '30 days') INTO v_from FROM analytics_visitors;
    ELSE
      v_from := p_from;
    END IF;
    v_gran := CASE
      WHEN v_to - v_from > interval '400 days' THEN 'month'
      WHEN v_to - v_from > interval '120 days' THEN 'week'
      ELSE 'day'
    END;
  ELSE
    v_from := COALESCE(p_from, now() - interval '7 days');
  END IF;

  IF v_from > v_to THEN v_from := v_to - interval '1 day'; END IF;
  IF v_gran NOT IN ('hour', 'day', 'week', 'month') THEN v_gran := 'day'; END IF;

  v_today := (now() AT TIME ZONE v_tz)::date;
  v_week_start := date_trunc('week', now() AT TIME ZONE v_tz);
  v_month_start := date_trunc('month', now() AT TIME ZONE v_tz);

  SELECT jsonb_build_object(
    'visitors', (SELECT count(*) FROM analytics_visitors),
    'pageViews', (SELECT count(*) FROM analytics_page_views),
    'sessions', (SELECT count(*) FROM analytics_sessions)
  ) INTO v_all;

  SELECT jsonb_build_object(
    'visitors', count(DISTINCT pv.visitor_id) FILTER (WHERE pv.created_at >= v_from AND pv.created_at < v_to),
    'pageViews', count(*) FILTER (WHERE pv.created_at >= v_from AND pv.created_at < v_to),
    'sessions', (SELECT count(*) FROM analytics_sessions WHERE started_at >= v_from AND started_at < v_to),
    'today', count(DISTINCT pv.visitor_id) FILTER (WHERE (pv.created_at AT TIME ZONE v_tz)::date = v_today),
    'yesterday', count(DISTINCT pv.visitor_id) FILTER (WHERE (pv.created_at AT TIME ZONE v_tz)::date = v_today - 1),
    'thisWeek', count(DISTINCT pv.visitor_id) FILTER (WHERE (pv.created_at AT TIME ZONE v_tz) >= v_week_start),
    'thisMonth', count(DISTINCT pv.visitor_id) FILTER (WHERE (pv.created_at AT TIME ZONE v_tz) >= v_month_start),
    'online', (SELECT count(DISTINCT visitor_id) FROM analytics_sessions WHERE last_seen >= now() - interval '5 minutes'),
    'avgSessionSeconds', COALESCE((
      SELECT round(avg(duration_seconds))::int
      FROM analytics_sessions
      WHERE started_at >= v_from AND started_at < v_to AND duration_seconds > 0
    ), 0),
    'newVisitors', count(DISTINCT pv.visitor_id) FILTER (
      WHERE pv.created_at >= v_from AND pv.created_at < v_to AND vi.first_seen >= v_from
    ),
    'returningVisitors', count(DISTINCT pv.visitor_id) FILTER (
      WHERE pv.created_at >= v_from AND pv.created_at < v_to AND vi.first_seen < v_from
    )
  ) INTO v_overview
  FROM analytics_page_views pv
  JOIN analytics_visitors vi ON vi.id = pv.visitor_id;

  WITH buckets AS (
    SELECT generate_series(
      date_trunc(v_gran, v_from AT TIME ZONE v_tz),
      date_trunc(v_gran, v_to AT TIME ZONE v_tz),
      ('1 ' || v_gran)::interval
    ) AS bucket
  ), counted AS (
    SELECT
      date_trunc(v_gran, created_at AT TIME ZONE v_tz) AS bucket,
      count(DISTINCT visitor_id) AS visitors,
      count(*) AS views
    FROM analytics_page_views
    WHERE created_at >= (date_trunc(v_gran, v_from AT TIME ZONE v_tz) AT TIME ZONE v_tz)
      AND created_at < v_to
    GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'bucket', to_char(b.bucket, 'YYYY-MM-DD"T"HH24:MI:SS'),
    'visitors', COALESCE(c.visitors, 0),
    'pageViews', COALESCE(c.views, 0)
  ) ORDER BY b.bucket), '[]'::jsonb)
  INTO v_series
  FROM buckets b
  LEFT JOIN counted c ON c.bucket = b.bucket;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.visitors DESC, t.country ASC), '[]'::jsonb)
  INTO v_countries
  FROM (
    SELECT
      country,
      COALESCE(country_code, '') AS "countryCode",
      count(DISTINCT visitor_id)::int AS visitors
    FROM analytics_sessions
    WHERE started_at >= v_from AND started_at < v_to
      AND country IS NOT NULL AND country <> ''
    GROUP BY country, country_code
    ORDER BY visitors DESC
    LIMIT 12
  ) t;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.visitors DESC, t.city ASC), '[]'::jsonb)
  INTO v_cities
  FROM (
    SELECT
      city,
      COALESCE(NULLIF(country, ''), 'Unknown') AS country,
      COALESCE(country_code, '') AS "countryCode",
      COALESCE(region, '') AS region,
      count(DISTINCT visitor_id)::int AS visitors
    FROM analytics_sessions
    WHERE started_at >= v_from AND started_at < v_to
      AND city IS NOT NULL AND city <> ''
    GROUP BY city, country, country_code, region
    ORDER BY visitors DESC
    LIMIT 15
  ) t;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.views DESC, t.path ASC), '[]'::jsonb)
  INTO v_pages
  FROM (
    SELECT
      path,
      COALESCE(NULLIF(max(title), ''), path) AS title,
      count(*)::int AS views,
      count(DISTINCT visitor_id)::int AS visitors
    FROM analytics_page_views
    WHERE created_at >= v_from AND created_at < v_to
    GROUP BY path
    ORDER BY views DESC, path ASC
    LIMIT 12
  ) t;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t."pageViews" DESC, t.source ASC), '[]'::jsonb)
  INTO v_sources
  FROM (
    SELECT
      COALESCE(NULLIF(referrer_source, ''), 'direct') AS source,
      count(DISTINCT visitor_id)::int AS visitors,
      count(*)::int AS "pageViews"
    FROM analytics_page_views
    WHERE created_at >= v_from AND created_at < v_to
    GROUP BY 1
    ORDER BY "pageViews" DESC
    LIMIT 12
  ) t;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.visitors DESC, t.name ASC), '[]'::jsonb)
  INTO v_devices
  FROM (
    SELECT device_type AS name, count(DISTINCT visitor_id)::int AS visitors, count(*)::int AS sessions
    FROM analytics_sessions
    WHERE started_at >= v_from AND started_at < v_to
    GROUP BY 1
    ORDER BY visitors DESC
  ) t;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.visitors DESC, t.name ASC), '[]'::jsonb)
  INTO v_browsers
  FROM (
    SELECT browser AS name, count(DISTINCT visitor_id)::int AS visitors, count(*)::int AS sessions
    FROM analytics_sessions
    WHERE started_at >= v_from AND started_at < v_to
    GROUP BY 1
    ORDER BY visitors DESC
    LIMIT 10
  ) t;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.visitors DESC, t.name ASC), '[]'::jsonb)
  INTO v_systems
  FROM (
    SELECT os AS name, count(DISTINCT visitor_id)::int AS visitors, count(*)::int AS sessions
    FROM analytics_sessions
    WHERE started_at >= v_from AND started_at < v_to
    GROUP BY 1
    ORDER BY visitors DESC
    LIMIT 10
  ) t;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t."createdAt" DESC), '[]'::jsonb)
  INTO v_recent
  FROM (
    SELECT
      pv.path,
      COALESCE(NULLIF(pv.title, ''), pv.path) AS title,
      s.country,
      COALESCE(s.country_code, '') AS "countryCode",
      s.city,
      s.device_type AS device,
      to_char(pv.created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS "createdAt"
    FROM analytics_page_views pv
    JOIN analytics_sessions s ON s.id = pv.session_id
    ORDER BY pv.created_at DESC
    LIMIT 12
  ) t;

  RETURN jsonb_build_object(
    'generatedAt', to_jsonb(now()),
    'range', jsonb_build_object(
      'from', to_jsonb(v_from),
      'to', to_jsonb(v_to),
      'timezone', v_tz,
      'granularity', v_gran
    ),
    'allTime', v_all,
    'overview', v_overview,
    'series', v_series,
    'countries', v_countries,
    'cities', v_cities,
    'pages', v_pages,
    'sources', v_sources,
    'devices', v_devices,
    'browsers', v_browsers,
    'systems', v_systems,
    'recent', v_recent
  );
END;
$$;

-- Tiny poll used by the "Live now" card.
CREATE OR REPLACE FUNCTION analytics_live(p_tz text DEFAULT 'Asia/Kathmandu')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz text := COALESCE(NULLIF(p_tz, ''), 'Asia/Kathmandu');
BEGIN
  BEGIN
    PERFORM now() AT TIME ZONE v_tz;
  EXCEPTION WHEN others THEN
    v_tz := 'UTC';
  END;
  RETURN jsonb_build_object(
    'online', (SELECT count(DISTINCT visitor_id) FROM analytics_sessions WHERE last_seen >= now() - interval '5 minutes'),
    'today', (
      SELECT count(DISTINCT visitor_id) FROM analytics_page_views
      WHERE (created_at AT TIME ZONE v_tz)::date = (now() AT TIME ZONE v_tz)::date
    ),
    'timestamp', to_jsonb(now())
  );
END;
$$;

CREATE OR REPLACE FUNCTION analytics_ready()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT to_regclass('public.analytics_visitors') IS NOT NULL
     AND to_regclass('public.analytics_sessions') IS NOT NULL
     AND to_regclass('public.analytics_page_views') IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION analytics_track(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION analytics_dashboard(timestamptz, timestamptz, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION analytics_live(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION analytics_ready() FROM PUBLIC;

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON TABLE analytics_visitors, analytics_sessions, analytics_page_views FROM %I', role_name);
      EXECUTE format(
        'REVOKE ALL ON FUNCTION analytics_track(jsonb), analytics_dashboard(timestamptz, timestamptz, text, text), analytics_live(text), analytics_ready() FROM %I',
        role_name
      );
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE analytics_visitors, analytics_sessions, analytics_page_views TO service_role';
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE analytics_page_views_id_seq TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION analytics_track(jsonb), analytics_dashboard(timestamptz, timestamptz, text, text), analytics_live(text), analytics_ready() TO service_role';
  END IF;
END
$$;

-- Ask PostgREST to pick up the new tables and functions immediately after a
-- SQL Editor paste, so the admin dashboard works on the next request.
NOTIFY pgrst, 'reload schema';
