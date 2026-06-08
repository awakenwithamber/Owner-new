-- Amber's Alchemy Apothecary — Supabase schema
-- Run in Supabase: SQL Editor → paste → Run (or via the Supabase CLI).
-- Safe to re-run: uses IF NOT EXISTS.

-- ── Herbal Ally Quiz submissions ─────────────────────────────
create table if not exists public.quiz_submissions (
  id            uuid primary key default gen_random_uuid(),
  name          text,
  email         text not null,
  phone         text,
  herbal_allies jsonb not null default '[]'::jsonb,
  symptoms      jsonb,
  quiz_answers  jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists quiz_submissions_email_idx on public.quiz_submissions (email);
create index if not exists quiz_submissions_created_idx on public.quiz_submissions (created_at desc);

-- ── Grimoire ($7.77/mo) subscribers ──────────────────────────
create table if not exists public.grimoire_subscribers (
  id                     uuid primary key default gen_random_uuid(),
  email                  text not null unique,
  status                 text not null default 'active',   -- 'active' | 'inactive'
  stripe_customer_id     text,
  stripe_subscription_id text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists grimoire_subscribers_email_idx on public.grimoire_subscribers (lower(email));
create index if not exists grimoire_subscribers_status_idx on public.grimoire_subscribers (status);

-- Keep updated_at fresh on changes.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_grimoire_updated_at on public.grimoire_subscribers;
create trigger trg_grimoire_updated_at
  before update on public.grimoire_subscribers
  for each row execute function public.set_updated_at();

-- These tables are written ONLY by Netlify functions using the service-role key
-- (which bypasses RLS). Enable RLS with no public policies so the anon key cannot read them.
alter table public.quiz_submissions    enable row level security;
alter table public.grimoire_subscribers enable row level security;
