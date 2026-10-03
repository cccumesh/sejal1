-- =============================================================================
-- AXERA LEDGER — WIPE & FRESH START (sirf axera_ledger_threads)
-- =============================================================================
-- Saara purana data delete: conversations, summaries, scans, tokens.
-- richera_ledger_threads, ledger_threads, brand_accounts — TOUCH NAHI.
--
-- ⚠️ Destructive. Undo nahi hoga.
-- Supabase → SQL Editor → New query → poori file paste → Run
-- =============================================================================

delete from public.axera_ledger_threads;

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
  ('R', '', 'receiver', 0, '', '', '', '');

-- Check: 2 empty rows
-- select verification_code, role, scan_count,
--        length(conversation) as conv_len,
--        length(session_summaries) as sum_len
-- from public.axera_ledger_threads
-- order by role;
