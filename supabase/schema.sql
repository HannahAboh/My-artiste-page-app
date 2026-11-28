-- My Artiste Page: paid accounts.
-- Paste this whole file into Supabase > SQL Editor > New query, then press Run. Running it again is safe.

-- One row per paying artist (or podcaster).
create table if not exists public.accounts (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid unique references auth.users (id) on delete set null,
  email                 text not null unique,
  full_name             text,
  artist_name           text,
  slug                  text unique,
  plan                  text not null check (plan in ('monthly', 'yearly')),
  -- active: paid up. past_due: a renewal failed, page still live during the grace period.
  -- locked: grace period over or plan ended, page shows "coming back soon" and the dashboard is locked.
  status                text not null default 'active' check (status in ('active', 'past_due', 'locked')),
  paid_until            timestamptz,
  grace_until           timestamptz,
  reminders_sent        int not null default 0,
  last_reminder_at      timestamptz,
  cancel_at_period_end  boolean not null default false,
  paystack_customer     text,
  subscription_code     text,
  subscription_token    text,
  spotify_url           text,
  spotify_type          text check (spotify_type in ('artist', 'show')),
  spotify_id            text,
  spotify_name          text,
  spotify_image         text,
  onboarded             boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists accounts_status_idx on public.accounts (status);
create index if not exists accounts_subscription_idx on public.accounts (subscription_code);

-- Every subscription payment Paystack confirms. The reference makes each payment count only once,
-- even when Paystack sends the same news twice.
create table if not exists public.payments (
  reference   text primary key,
  account_id  uuid references public.accounts (id) on delete set null,
  email       text not null,
  plan        text,
  amount      bigint not null,
  currency    text not null,
  paid_at     timestamptz not null,
  created_at  timestamptz not null default now()
);

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists accounts_touch on public.accounts;
create trigger accounts_touch before update on public.accounts
  for each row execute function public.touch_updated_at();

-- Safety: the website's server (with the secret service key) does all writing.
-- A signed-in artist can only read their own account row, nothing else.
alter table public.accounts enable row level security;
alter table public.payments enable row level security;

drop policy if exists "artists read their own account" on public.accounts;
create policy "artists read their own account" on public.accounts
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "artists read their own payments" on public.payments;
create policy "artists read their own payments" on public.payments
  for select to authenticated using (
    account_id in (select id from public.accounts where user_id = auth.uid())
  );
