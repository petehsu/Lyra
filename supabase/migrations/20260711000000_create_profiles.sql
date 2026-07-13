create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  locale_preference jsonb not null default '{"mode":"system"}'::jsonb,
  theme_preference text not null default 'lyra-system',
  onboarding_completed boolean not null default false,
  onboarding_version integer not null default 1,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint profiles_theme_preference_check
    check (theme_preference in ('lyra-system', 'lyra-light', 'lyra-dark')),
  constraint profiles_locale_preference_check
    check (
      jsonb_typeof(locale_preference) = 'object'
      and locale_preference->>'mode' in ('system', 'explicit')
      and (
        locale_preference->>'mode' = 'system'
        or nullif(locale_preference->>'locale', '') is not null
      )
    )
);

create or replace function public.set_profiles_updated_at()
returns trigger
language plpgsql
security invoker
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
before update on public.profiles
for each row execute function public.set_profiles_updated_at();

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles for select
to authenticated
using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles for insert
to authenticated
with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);
