-- =============================================================================
-- AXERA LEDGER — safe setup (shared Supabase: axerai-love)
-- =============================================================================
-- Table: public.axera_ledger_threads
-- Yeh file sirf axera ledger banati / lock karti hai.
-- richera_ledger_threads, ledger_threads, brand_accounts — TOUCH NAHI.
--
-- Supabase → SQL Editor → New query → poori file paste → Run
-- =============================================================================

create table if not exists public.axera_ledger_threads (
  id uuid primary key default gen_random_uuid(),
  verification_code text not null,
  device_id text not null default '',
  role text not null check (role in ('sender', 'receiver')),
  scan_count int not null default 0,
  conversation text not null default '',
  session_summaries text not null default '',
  axerai_ai_usage text not null default '',
  axerai_voice_usage text not null default '',
  unique (verification_code, role)
);

comment on table public.axera_ledger_threads is
  'Axera / Richera app ledger — max 2 rows per product code (sender + receiver).';

create index if not exists idx_axera_ledger_threads_code
  on public.axera_ledger_threads (verification_code);

alter table public.axera_ledger_threads enable row level security;

drop policy if exists "anon insert axera_ledger_threads" on public.axera_ledger_threads;
drop policy if exists "anon select axera_ledger_threads" on public.axera_ledger_threads;
drop policy if exists "anon update axera_ledger_threads" on public.axera_ledger_threads;

create policy "anon insert axera_ledger_threads"
  on public.axera_ledger_threads for insert to anon with check (true);

create policy "anon select axera_ledger_threads"
  on public.axera_ledger_threads for select to anon using (true);

create policy "anon update axera_ledger_threads"
  on public.axera_ledger_threads for update to anon using (true) with check (true);

insert into public.axera_ledger_threads (
  verification_code,
  device_id,
  role,
  scan_count,
  conversation,
  session_summaries,
  axerai_ai_usage,
  axerai_voice_usage
)
values
  ('R', '', 'sender', 0, '', '', '', ''),
  ('R', '', 'receiver', 0, '', '', '', '')
on conflict (verification_code, role) do nothing;

-- Verify:
-- select verification_code, role, scan_count
-- from public.axera_ledger_threads
-- order by verification_code, role;
