alter table public.facebook_pages
  add column if not exists drive_folder_id text,
  add column if not exists drive_folder_name text;