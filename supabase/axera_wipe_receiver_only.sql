-- =============================================================================
-- AXERA LEDGER — RECEIVER ONLY RESET (sender safe)
-- =============================================================================
-- Sirf receiver row saaf — product code R.
-- Sender row (conversation, summaries, scans) bilkul touch nahi.
-- richera_ledger_threads / ledger_threads / brand_accounts — touch nahi.
--
-- Supabase → SQL Editor → New query → poori file paste → Run
-- =============================================================================

delete from public.axera_ledger_threads
where verification_code = 'R'
  and role = 'receiver';

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
  ('R', '', 'receiver', 0, '', '', '', '');

-- Check: sender purana, receiver empty
-- select verification_code, role, scan_count,
--        length(conversation) as conv_len,
--        length(session_summaries) as sum_len
-- from public.axera_ledger_threads
-- where verification_code = 'R'
-- order by role;
