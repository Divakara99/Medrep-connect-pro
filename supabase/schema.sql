-- MedRep Connect Pro: localStorage write-mirror schema.
-- Run this file in the Supabase SQL Editor before deploying the app.

CREATE TABLE IF NOT EXISTS public.users (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  synced_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.profiles (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  synced_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vacancies (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  synced_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.plans (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  synced_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payments (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  synced_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.support_tickets (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  synced_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.applications (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  synced_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  synced_at timestamptz DEFAULT now()
);

-- Index commonly filtered data fields stored in the JSON document.
CREATE INDEX IF NOT EXISTS payments_user_status_idx
  ON public.payments ((data ->> 'userId'), (data ->> 'status'));
CREATE INDEX IF NOT EXISTS applications_job_applicant_idx
  ON public.applications ((data ->> 'jobId'), (data ->> 'applicantEmail'));
CREATE INDEX IF NOT EXISTS support_tickets_status_idx
  ON public.support_tickets ((data ->> 'status'));
CREATE INDEX IF NOT EXISTS users_email_idx
  ON public.users ((data ->> 'email'));
CREATE INDEX IF NOT EXISTS vacancies_category_idx
  ON public.vacancies ((data ->> 'category'));

-- These intentionally permissive policies let the browser's anon/publishable
-- key upsert mirror rows. Tighten them before using this mirror for private,
-- production data; the anon key is public in a client-side bundle.
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'users',
    'profiles',
    'vacancies',
    'plans',
    'payments',
    'support_tickets',
    'applications',
    'notifications'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS mirror_all ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY mirror_all ON public.%I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)',
      table_name
    );
  END LOOP;
END
$$;

-- Convenience projections for common dashboard queries. The canonical payload
-- remains available in `data` on every view.
CREATE OR REPLACE VIEW public.users_view AS
SELECT
  id,
  data ->> 'email' AS email,
  data ->> 'name' AS name,
  data ->> 'phone' AS phone,
  data ->> 'createdAt' AS created_at,
  data ->> 'subscribedUntil' AS subscribed_until,
  data ->> 'isAdmin' AS is_admin,
  data,
  synced_at
FROM public.users;

CREATE OR REPLACE VIEW public.payments_view AS
SELECT
  id,
  data ->> 'userId' AS user_id,
  data ->> 'planId' AS plan_id,
  data ->> 'amount' AS amount,
  data ->> 'status' AS status,
  data ->> 'createdAt' AS created_at,
  data ->> 'txRef' AS tx_ref,
  data ->> 'refundStatus' AS refund_status,
  data,
  synced_at
FROM public.payments;

CREATE OR REPLACE VIEW public.vacancies_view AS
SELECT
  id,
  data ->> 'title' AS title,
  data ->> 'company' AS company,
  data ->> 'category' AS category,
  data ->> 'location' AS location,
  data ->> 'postedAt' AS posted_at,
  data ->> 'deleted' AS deleted,
  data ->> 'deletedAt' AS deleted_at,
  data,
  synced_at
FROM public.vacancies;

CREATE OR REPLACE VIEW public.applications_view AS
SELECT
  id,
  data ->> 'jobId' AS job_id,
  data ->> 'jobTitle' AS job_title,
  data ->> 'applicantName' AS applicant_name,
  data ->> 'applicantEmail' AS applicant_email,
  data ->> 'channel' AS channel,
  data ->> 'sentAt' AS sent_at,
  data,
  synced_at
FROM public.applications;
