-- Private refund notices. Run after supabase/user_notifications.sql in the
-- same Supabase project. This replacement keeps the existing broadcast RPC,
-- adds the account-scoped audience needed by the client cache, and suppresses
-- legacy refund rows that were incorrectly stored with target = 'all'.

BEGIN;

CREATE OR REPLACE FUNCTION public.list_visible_notifications()
RETURNS SETOF jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  viewer_email text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to see notifications.' USING ERRCODE = '28000';
  END IF;

  viewer_email := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
  IF viewer_email = '' THEN
    RAISE EXCEPTION 'Your account email is unavailable.' USING ERRCODE = '28000';
  END IF;

  RETURN QUERY
  SELECT jsonb_build_object(
    'id', n.id,
    'title', n.data ->> 'title',
    'body', n.data ->> 'body',
    'type', coalesce(n.data ->> 'type', 'update'),
    'createdAt', coalesce((n.data ->> 'createdAt')::bigint, 0),
    'from', coalesce(n.data ->> 'from', 'MedRep Connect Pro'),
    -- Never disclose the full recipient list; a private row is marked as
    -- addressed only to the authenticated viewer.
    'target', CASE
      WHEN coalesce(n.data ->> 'target', 'all') = 'all' THEN to_jsonb('all'::text)
      ELSE jsonb_build_array(viewer_email)
    END
  )
  FROM public.notifications AS n
  WHERE (
    coalesce(n.data ->> 'target', 'all') = 'all'
    OR (
      jsonb_typeof(n.data -> 'target') = 'array'
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(n.data -> 'target') AS recipient(email)
        WHERE lower(btrim(recipient.email)) = viewer_email
      )
    )
  )
  -- Do not keep exposing refund records from older clients which accidentally
  -- marked them as broadcasts. Correctly targeted refund rows remain visible to
  -- their recipient through the array-target branch above.
  AND NOT (
    coalesce(n.data ->> 'target', 'all') = 'all'
    AND (
      coalesce((n.data -> 'meta') ? 'paymentId', false)
      OR lower(coalesce(n.data ->> 'title', '')) LIKE 'refund %'
    )
  )
  -- Defense in depth: even an accidental multi-email refund audience is denied.
  AND (
    NOT (
      coalesce((n.data -> 'meta') ? 'paymentId', false)
      OR lower(coalesce(n.data ->> 'title', '')) LIKE 'refund %'
    )
    OR jsonb_array_length(CASE
      WHEN jsonb_typeof(n.data -> 'target') = 'array' THEN n.data -> 'target'
      ELSE '[]'::jsonb
    END) = 1
  )
  ORDER BY coalesce((n.data ->> 'createdAt')::bigint, 0) DESC
  LIMIT 200;
END;
$$;

REVOKE ALL ON FUNCTION public.list_visible_notifications() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_visible_notifications() TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
