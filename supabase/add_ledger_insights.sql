-- Optional: verify-fail + PAIR_FULL counters for dashboard (sender row per code).
-- Supabase → SQL Editor → Run once on your project.

alter table public.axera_ledger_threads
  add column if not exists ledger_insights text not null default '';

comment on column public.axera_ledger_threads.ledger_insights is
  'One line per event: insight:kind|detail|ISO8601 (verify_fail, verify_glitch, pair_full).';
