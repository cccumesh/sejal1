import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL ?? '').trim()
const SUPABASE_ANON_KEY = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim()
const LEDGER_TABLE_RAW = String(import.meta.env.VITE_SUPABASE_LEDGER_TABLE ?? 'axera_ledger_threads').trim()

export const LEDGER_TABLE = LEDGER_TABLE_RAW || 'axera_ledger_threads'

export const isSupabaseConfigured = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)

export const supabase = isSupabaseConfigured()
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null
