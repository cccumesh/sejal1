-- =============================================================================
-- AXERAI RICHERA — WIPE & FRESH START (sirf richera table)
-- =============================================================================
-- Yeh SIRF richera_ledger_threads saaf karti hai.
-- ledger_threads aur brand_accounts ko TOUCH NAHI karti.
--
-- Supabase → SQL Editor → New query → poori file paste → Run
-- =============================================================================

-- Saara purana data delete (conversations, summaries, scans — sab)
delete from public.richera_ledger_threads;

-- Fresh empty rows — code R ke liye sender + receiver
insert into public.richera_ledger_threads (
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

-- Check: 2 rows, sab empty
-- select verification_code, role, scan_count, conversation, session_summaries
-- from public.richera_ledger_threads
-- order by role;
