-- Lets a signed-in user delete their OWN account (the auth.users row).
-- Deleting the user cascades to their gardens row via the foreign key.
-- Run once in Supabase → SQL Editor → New query → Run.
--
-- SECURITY DEFINER means the function runs with elevated rights, but it only
-- ever deletes auth.uid() — the caller themselves — so a user can never delete
-- anyone else. Only authenticated users may call it.

create or replace function public.delete_user()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_user() from public, anon;
grant execute on function public.delete_user() to authenticated;
