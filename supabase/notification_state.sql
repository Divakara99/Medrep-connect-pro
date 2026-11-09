-- Per-account notification state lives ONLINE with the account.
--
-- The app used to remember "which notices have I read" and "which alerts have I
-- already chimed" in the browser, so a new phone re-announced everything and a
-- cleared browser showed every old notice as unread. These three values now
-- follow the signed-in account instead.
--
--   read_since      ms timestamp: notices created after this are unread
--   seen_watermark  ms timestamp: already-alerted notices, so phones do not
--                   ring for the same backlog twice
--   sound_enabled   the user's chime preference, kept with the account
--
-- Rules: one row per auth user; RLS lets an account read and write only its own
-- row. Admins cannot read it — it says nothing about payments or jobs.

BEGIN;

CREATE TABLE IF NOT EXISTS public.notification_state (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  read_since bigint NOT NULL DEFAULT 0,
  seen_watermark bigint NOT NULL DEFAULT 0,
  sound_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_state_read_own ON public.notification_state;
CREATE POLICY notification_state_read_own ON public.notification_state
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS notification_state_insert_own ON public.notification_state;
CREATE POLICY notification_state_insert_own ON public.notification_state
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS notification_state_update_own ON public.notification_state;
CREATE POLICY notification_state_update_own ON public.notification_state
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

REVOKE ALL ON public.notification_state FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.notification_state TO authenticated;
GRANT ALL ON public.notification_state TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
