-- Product-grade pairing upgrade. Run once in Supabase → SQL Editor → Run.
-- Makes device registration "claim-only": a device must already exist (created
-- by your provisioning tool) and the scanned QR code must match its secret.
-- This stops anyone from registering random device IDs to grab data.

-- Unclaimed devices exist (created at provisioning) before a user pairs them.
alter table public.devices alter column user_id drop not null;

-- Replace the old create-on-register function with a claim-only version.
drop function if exists public.register_device(uuid, text, text);

create or replace function public.register_device(p_device uuid, p_secret text)
returns json
language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_key text;
begin
  if auth.uid() is null then raise exception 'must be signed in'; end if;

  select user_id, secret into v_owner, v_key
  from public.devices where id = p_device;

  if v_key is null then
    raise exception 'unknown device — not provisioned';
  elsif v_key <> p_secret then
    raise exception 'bad device code';
  elsif v_owner is not null and v_owner <> auth.uid() then
    raise exception 'device already registered to another account';
  end if;

  update public.devices set user_id = auth.uid() where id = p_device;
  return json_build_object('ok', true);
end; $$;

revoke all on function public.register_device(uuid, text) from public, anon;
grant execute on function public.register_device(uuid, text) to authenticated;
