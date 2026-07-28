drop function if exists public.lyra_git_email_exists(text);
drop function if exists public.lyra_git_identity_lookup(text);

alter function public.set_profiles_updated_at()
  set search_path = '';
alter function public.handle_lyra_new_user()
  set search_path = '';

revoke all on function public.set_profiles_updated_at()
  from public, anon, authenticated;
revoke all on function public.handle_lyra_new_user()
  from public, anon, authenticated;

revoke all on table public.profiles from public, anon, authenticated;
grant select, insert, update on table public.profiles to authenticated;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles for select
to authenticated
using ((select auth.uid()) = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles for insert
to authenticated
with check ((select auth.uid()) = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated;
