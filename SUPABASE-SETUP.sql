-- The Baddies: eenmalige Supabase-instelling
-- Voer dit uit in Supabase -> SQL Editor nadat je een gratis project hebt gemaakt.

create table if not exists public.site_settings (
  id integer primary key check (id = 1),
  config jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id text primary key,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Publieke afbeeldingsbucket voor de foto's die jij via "Website aanpassen" uploadt.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-assets', 'site-assets', true, 5242880, array['image/*'])
on conflict (id) do update set public = true, file_size_limit = 5242880, allowed_mime_types = array['image/*'];

-- De Node-server gebruikt de geheime server key, dus bezoekers hoeven geen schrijfrechten te krijgen.
-- Publiek lezen van afbeeldingen is wel toegestaan omdat de bucket public is.
