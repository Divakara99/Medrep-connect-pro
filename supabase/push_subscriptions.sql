-- Web Push subscriptions for PWA notifications (Chrome / Android / desktop).
-- Run AFTER schema.sql and admin_mfa.sql in the SAME Supabase project as the app.
-- Safe to re-run.
--
-- How it fits together
--   1. The app asks the browser for notification permission, creates a push
--      subscription and stores it here through save_push_subscription() — the
--      endpoint/keys are stamped with the caller's verified user id and email,
--      so a device can never be registered against somebody else's account.
--   2. An administrator sends an announcement (or a vacancy is posted) and the
--      send-push Edge Function fans the message out to every stored
--      subscription using the VAPID keys held as Supabase secrets.
--   3. The service worker shows the notification with sound/vibration, and
--      removes a subscription that the push service reports as gone (404/410).
--
-- Nothing here is browser-writable: RLS gives a signed-in user exactly two
-- things — reading and removing their OWN device rows — and every write goes
-- through a SECURITY DEFINER function that stamps identity from the token.

BEGIN;

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON public.push_subscriptions (user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS push_subscriptions_owner_select ON public.push_subscriptions;
CREATE POLICY push_subscriptions_owner_select ON public.push_subscriptions
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS push_subscriptions_owner_delete ON public.push_subscriptions;
CREATE POLICY push_subscriptions_owner_delete ON public.push_subscriptions
  FOR DELETE TO authenticated USING (user_id = auth.uid());
REVOKE ALL ON public.push_subscriptions FROM PUBLIC, anon;
GRANT SELECT, DELETE ON public.push_subscriptions TO authenticated;

-- One row per delivery attempt batch, so the admin console can show whether an
-- announcement really reached devices. Readable by administrators only; written
-- by the send-push function with the service role.
CREATE TABLE IF NOT EXISTS public.push_delivery_log (
  id bigserial PRIMARY KEY,
  notification_id text,
  title text,
  sent integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  removed integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.push_delivery_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_read_push_delivery_log ON public.push_delivery_log;
CREATE POLICY admin_read_push_delivery_log ON public.push_delivery_log
  FOR SELECT TO authenticated USING (public.is_app_admin());
REVOKE ALL ON public.push_delivery_log FROM PUBLIC, anon;
GRANT SELECT ON public.push_delivery_log TO authenticated;

-- Register (or refresh) the calling user's device. An endpoint belongs to one
-- row only: if the same browser later signs in as somebody else, ownership and
-- keys move to the new account instead of leaking notifications across accounts.
CREATE OR REPLACE FUNCTION public.save_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_endpoint text := btrim(coalesce(p_endpoint, ''));
  v_p256dh text := btrim(coalesce(p_p256dh, ''));
  v_auth text := btrim(coalesce(p_auth, ''));
BEGIN
  IF v_uid IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'Sign in to receive notifications.' USING ERRCODE = '28000';
  END IF;
  IF length(v_endpoint) < 10 OR length(v_endpoint) > 2048 THEN
    RAISE EXCEPTION 'This browser returned an unusable notification endpoint.' USING ERRCODE = '22023';
  END IF;
  IF length(v_p256dh) < 16 OR length(v_p256dh) > 400 OR length(v_auth) < 8 OR length(v_auth) > 200 THEN
    RAISE EXCEPTION 'This browser returned unusable notification keys.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.push_subscriptions (user_id, email, endpoint, p256dh, auth, user_agent)
  VALUES (v_uid, v_email, v_endpoint, v_p256dh, v_auth, left(coalesce(p_user_agent, ''), 300))
  ON CONFLICT (endpoint) DO UPDATE
    SET user_id = excluded.user_id,
        email = excluded.email,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_agent = excluded.user_agent,
        enabled = true,
        updated_at = now(),
        last_seen_at = now();

  RETURN jsonb_build_object('ok', true, 'endpoint', v_endpoint);
END;
$$;
REVOKE ALL ON FUNCTION public.save_push_subscription(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_push_subscription(text, text, text, text) TO authenticated;

-- Stop notifications for one device (used when the user turns them off here, or
-- when the browser subscription no longer exists).
CREATE OR REPLACE FUNCTION public.delete_push_subscription(p_endpoint text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_removed integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in to change notification settings.' USING ERRCODE = '28000';
  END IF;
  DELETE FROM public.push_subscriptions
   WHERE endpoint = btrim(coalesce(p_endpoint, ''))
     AND user_id = v_uid;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'removed', v_removed);
END;
$$;
REVOKE ALL ON FUNCTION public.delete_push_subscription(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_push_subscription(text) TO authenticated;

-- The caller's own notification devices, for the "notifications on this phone"
-- card. Endpoints are not returned — only a short label and timestamps.
CREATE OR REPLACE FUNCTION public.my_push_subscriptions()
RETURNS SETOF jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
    'id', s.id,
    'label', case
      when s.user_agent ilike '%android%' then 'Android phone'
      when s.user_agent ilike '%iphone%' or s.user_agent ilike '%ipad%' then 'iPhone / iPad'
      when s.user_agent ilike '%windows%' then 'Windows PC'
      when s.user_agent ilike '%mac%' then 'Mac'
      when s.user_agent ilike '%linux%' then 'Linux PC'
      else 'This device'
    end,
    'enabled', s.enabled,
    'createdAt', s.created_at,
    'lastSeenAt', s.last_seen_at
  )
  FROM public.push_subscriptions AS s
  WHERE s.user_id = auth.uid()
  ORDER BY s.created_at DESC
  LIMIT 20
$$;
REVOKE ALL ON FUNCTION public.my_push_subscriptions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_push_subscriptions() TO authenticated;

-- Admin console: how many devices can be reached right now, plus the last few
-- delivery batches. Administrators only (verified session, or the code switch
-- is OFF and this session's role is admin).
CREATE OR REPLACE FUNCTION public.push_subscription_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_app_admin() THEN
    RAISE EXCEPTION 'Only an administrator can read notification delivery.' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'devices', (SELECT count(*) FROM public.push_subscriptions WHERE enabled),
    'people', (SELECT count(DISTINCT user_id) FROM public.push_subscriptions WHERE enabled),
    'lastBatch', (
      SELECT jsonb_build_object('sent', l.sent, 'failed', l.failed, 'removed', l.removed, 'at', l.created_at)
        FROM public.push_delivery_log AS l
       ORDER BY l.id DESC
       LIMIT 1
    ),
    'recent', coalesce((
      SELECT jsonb_agg(jsonb_build_object('title', l.title, 'sent', l.sent, 'failed', l.failed, 'at', l.created_at) ORDER BY l.id DESC)
        FROM (SELECT * FROM public.push_delivery_log ORDER BY id DESC LIMIT 5) AS l
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.push_subscription_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.push_subscription_stats() TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
