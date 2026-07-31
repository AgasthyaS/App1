-- Greenr: move a sensor to a different account. Run once in Supabase → SQL Editor.
--
-- WHY THIS EXISTS
-- register_device() deliberately refuses a sensor that belongs to someone else,
-- so a device set up under an old/test account could never be moved without
-- signing back into that account. This adds the standard consumer-IoT escape
-- hatch: PROOF OF PHYSICAL POSSESSION. The secret is printed on the device (in
-- its QR code), so whoever is holding the sensor can take ownership of it —
-- the same model as factory-resetting a Ring or Nest and re-adding it.
--
-- PRIVACY: the previous owner's readings are deleted during the transfer. The
-- new owner must not inherit someone else's plant history, and the old owner's
-- data must not follow the hardware to a stranger.
--
-- SECURITY NOTE: anyone who can read the QR code can take the device over. That
-- is intentional (possession = ownership) but it means the code should be
-- treated like a key. For a retail product, pair this with purchase records or
-- a physical button press to prove possession more strongly.

create or replace function public.transfer_device(p_device uuid, p_secret text)
returns json
language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_key text; v_deleted int := 0;
begin
  if auth.uid() is null then raise exception 'must be signed in'; end if;

  select user_id, secret into v_owner, v_key
  from public.devices where id = p_device;

  if v_key is null then
    raise exception 'unknown device — not provisioned';
  elsif v_key <> p_secret then
    raise exception 'bad device code';
  end if;

  -- Already yours: nothing to do, succeed quietly (keeps the flow idempotent).
  if v_owner = auth.uid() then
    return json_build_object('ok', true, 'transferred', false, 'readings_cleared', 0);
  end if;

  -- Wipe the previous owner's history before handing the hardware over.
  if v_owner is not null then
    delete from public.readings where device_id = p_device;
    get diagnostics v_deleted = row_count;
  end if;

  update public.devices
     set user_id   = auth.uid(),
         plant_key = null,        -- it belongs to no plant in the new garden yet
         label     = null
   where id = p_device;

  return json_build_object('ok', true, 'transferred', true, 'readings_cleared', v_deleted);
end; $$;

revoke all on function public.transfer_device(uuid, text) from public, anon;
grant execute on function public.transfer_device(uuid, text) to authenticated;
