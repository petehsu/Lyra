create table if not exists public.product_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  preview text not null,
  body text,
  body_kind text not null default 'plain',
  page_url text,
  image_url text,
  level text not null default 'info',
  locale text,
  published_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  constraint product_announcements_title_check
    check (char_length(btrim(title)) > 0),
  constraint product_announcements_preview_check
    check (char_length(btrim(preview)) > 0),
  constraint product_announcements_body_kind_check
    check (body_kind in ('plain', 'markdown', 'image', 'page')),
  constraint product_announcements_level_check
    check (level in ('info', 'success', 'warning', 'error')),
  constraint product_announcements_page_url_check
    check (page_url is null or page_url ~* '^https://'),
  constraint product_announcements_image_url_check
    check (image_url is null or image_url ~* '^https://')
);

create index if not exists product_announcements_published_at_idx
  on public.product_announcements (published_at desc);

alter table public.product_announcements enable row level security;

revoke all on table public.product_announcements from public, anon, authenticated;
grant select on table public.product_announcements to anon, authenticated;

drop policy if exists product_announcements_select_published on public.product_announcements;
create policy product_announcements_select_published
on public.product_announcements
for select
to anon, authenticated
using (
  published_at is not null
  and published_at <= timezone('utc', now())
  and (expires_at is null or expires_at > timezone('utc', now()))
);

alter publication supabase_realtime add table public.product_announcements;

insert into public.product_announcements (
  title,
  preview,
  body,
  body_kind,
  published_at
) values (
  'Lyra can send official notices',
  'This message arrived from Supabase without signing in.',
  $md$You can receive **official notices** while using Lyra, even in local mode.

- Markdown lists and emphasis
- Links open in the workspace browser
- Images use `https://` URLs

Later rows in this table show up in the existing notification center.$md$,
  'markdown',
  timezone('utc', now())
);
