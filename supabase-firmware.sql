-- Greenr OTA firmware — lets sensors update themselves over the air.
-- Run once in Supabase → SQL Editor. Safe to re-run.
--
-- How it works: each sensor knows its own FW_VERSION (an integer in the .ino).
-- On Wi-Fi, about once a day, it reads the newest row here for its channel; if
-- the published version is higher, it downloads the .bin at `url` and flashes
-- itself, then reboots into the new firmware. No cables, no re-flash by hand —
-- this is the single biggest thing separating a hobby build from a product.

create table if not exists public.firmware (
  id bigint generated always as identity primary key,
  channel text not null default 'stable',   -- stable | beta
  version int not null,                      -- integer, e.g. 31 for v3.1
  url text not null,                         -- public HTTPS URL to the compiled .bin
  notes text,
  min_version int default 0,                 -- refuse to skip past a required step
  created_at timestamptz not null default now()
);
alter table public.firmware enable row level security;

-- Devices read this with the anon key, so allow anon SELECT (read-only).
drop policy if exists "anyone can read firmware" on public.firmware;
create policy "anyone can read firmware" on public.firmware
  for select using (true);

create index if not exists firmware_channel_ver on public.firmware (channel, version desc);

-- ── Publishing a new build (do this after you host the compiled .bin) ──
-- 1. Compile in Arduino IDE → Sketch → "Export Compiled Binary" → get the .bin.
-- 2. Upload the .bin somewhere public over HTTPS (a Supabase Storage public
--    bucket works: Storage → new public bucket "firmware" → upload → copy URL).
-- 3. Insert a row with the NEW integer version:
--
--    insert into public.firmware (channel, version, url, notes)
--    values ('stable', 32, 'https://<ref>.supabase.co/storage/v1/object/public/firmware/greenr-v3.2.bin', 'Fixes X');
--
-- Every sensor on 'stable' below version 32 will pick it up on its next daily
-- check and update itself.
