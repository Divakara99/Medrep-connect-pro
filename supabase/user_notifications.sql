-- User notification delivery for broadcast alerts (new job posts, job updates,
-- plan/payment news). Run AFTER schema.sql in the SAME Supabase project.
-- The notifications mirror table stays admin-only; this explicitly shaped RPC
-- is the ONLY way an ordinary signed-in user can read broadcast notices.

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

  viewer_email := coalesce(auth.jwt() ->> 'email', '');

  RETURN QUERY
  SELECT jsonb_build_object(
    'id', n.id,
    'title', n.data ->> 'title',
    'body', n.data ->> 'body',
    'type', coalesce(n.data ->> 'type', 'update'),
    'createdAt', coalesce((n.data ->> 'createdAt')::bigint, 0),
    'from', coalesce(n.data ->> 'from', 'MedRep Connect Pro')
  )
  FROM public.notifications AS n
  WHERE coalesce(n.data ->> 'target', 'all') = 'all'
     OR (
       jsonb_typeof(n.data -> 'target') = 'array'
       AND (n.data -> 'target') ? viewer_email
     )
  ORDER BY coalesce((n.data ->> 'createdAt')::bigint, 0) DESC
  LIMIT 200;
END;
$$;

REVOKE ALL ON FUNCTION public.list_visible_notifications() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_visible_notifications() TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
