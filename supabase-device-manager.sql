-- Device manager support (§7). Run once in Supabase → SQL Editor → Run.
-- Adds a "release_device" RPC so a user can remove a sensor from their account
-- (returns it to the unclaimed pool). Renaming and (un)assigning a plant already
-- work through normal RLS-guarded updates, so no extra grants are needed there.

create or replace function public.release_device(p_device uuid)
returns json
language plpgsql security definer set search_path = '' as $$
declare v_owner uuid;
begin
  if auth.uid() is null then raise exception 'must be signed in'; end if;

  select user_id into v_owner from public.devices where id = p_device;
  if v_owner is null then
    raise exception 'unknown device';
  elsif v_owner <> auth.uid() then
    raise exception 'not your device';
  end if;

  -- Release the claim: clear the owner and any plant assignment.
  update public.devices set user_id = null, plant_key = null where id = p_device;
  return json_build_object('ok', true);
end; $$;

revoke all on function public.release_device(uuid) from public, anon;
grant execute on function public.release_device(uuid) to authenticated;
