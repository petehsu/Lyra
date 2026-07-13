create or replace function public.lyra_git_identity_lookup(candidate_email text)
returns table(registered boolean, display_name text)
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    true,
    coalesce(
      nullif(p.display_name, ''),
      nullif(u.raw_user_meta_data->>'full_name', ''),
      nullif(u.raw_user_meta_data->>'name', '')
    )
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.email is not null
    and lower(u.email) = lower(trim(candidate_email))
  limit 1;
$$;

revoke all on function public.lyra_git_identity_lookup(text) from public;
grant execute on function public.lyra_git_identity_lookup(text) to anon, authenticated;
