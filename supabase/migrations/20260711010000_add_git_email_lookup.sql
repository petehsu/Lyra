create or replace function public.lyra_git_email_exists(candidate_email text)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from auth.users
    where email is not null
      and lower(email) = lower(trim(candidate_email))
  );
$$;

revoke all on function public.lyra_git_email_exists(text) from public;
grant execute on function public.lyra_git_email_exists(text) to anon, authenticated;
