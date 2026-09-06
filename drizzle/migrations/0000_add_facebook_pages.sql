CREATE TABLE public.facebook_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  page_id text NOT NULL UNIQUE,
  access_token text NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.facebook_pages TO authenticated;
GRANT ALL ON public.facebook_pages TO service_role;

ALTER TABLE public.facebook_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated full access"
ON public.facebook_pages
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

ALTER TABLE public.app_settings
ADD COLUMN IF NOT EXISTS facebook_page_id text;

ALTER TABLE public.upload_jobs
ADD COLUMN IF NOT EXISTS facebook_page_id text;