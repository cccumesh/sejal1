import {
  parseExperienceViewSecondsFromFooter,
  resetExperienceViewTotals,
  takeExperienceViewTotals,
} from './myraExperienceView.js'
import { isSupabaseConfigured, supabase, LEDGER_TABLE } from './supabaseClient.js'
import { isOfflineMyraFallback } from './myraErrorFallback.js'
import { parseBrandProductPraise, parseAxeraiPraiseFromSummary, parseDiscoveryFromSummary, summarizeSessionDialogue, buildLocalStorySummary, extractStoryFromSummary, extractDashboardQuoteFromSummary, enrichSessionSummary, repairSessionSummaryFromDialogue, sanitizeSummaryForMemory, shouldSkipSessionSummary, hasUserSpeechInDialogue, extractSenderQuotesFromSummary, extractSenderLinesFromDialogue, extractReceiverQuotesFromSummary, buildEnglishQuotePreserveHint, MYRA_LEDGER_READING_GUIDE, RECIPIENT_DELIVERY_CONCEPT } from './myraSummarize.js'

/** Offline Myra lines (myraErrorFallback.js) are never appended — only live Gemini text. */

const DEVICE_ID_KEY = 'axerai_device_id'
const DEVICE_COOKIE = 'axerai_device_id'
let activeThreadId = null
let activeScanNumber = 0
let activeVerificationCode = ''
let activeStartedAt = 0
let ledgerMemoryText = ''
let sessionRole = 'SENDER'
let ledgerWelcomeMode = 'SENDER_FIRST'
let cachedSenderThread = null
let cachedReceiverThread = null
let cachedVerificationCode = ''
let ledgerFinishPromise = null
let summaryBackfillPromise = null

/** Frozen at scan open — summaries + conversation for Gemini; not mutated during session. */
let sessionMemorySnapshot = null

export function isLedgerScanActive() {
  return activeThreadId != null
}

function logLedger(message, detail) {
  if (detail !== undefined) console.info(`[Ledger] ${message}`, detail)
  else console.info(`[Ledger] ${message}`)
}

function roleKeyFromSession() {
  return sessionRole === 'RECEIVER' ? 'receiver' : 'sender'
}

function speakerLabelForRole(role) {
  if (role === 'myra') return 'myra'
  return sessionRole === 'RECEIVER' ? 'receiver' : 'sender'
}

export function isLedgerConfigured() {
  return isSupabaseConfigured()
}

function getCachedLedgerThread(roleKey) {
  return roleKey === 'receiver' ? cachedReceiverThread : cachedSenderThread
}

/** Snapshot sender/receiver summaries + conversation at scan open (session-scoped read cache). */
export function captureSessionMemorySnapshot() {
  const code = String(cachedVerificationCode || activeVerificationCode || '').trim()
  if (!code) return false

  const senderFallback = threadNeedsConversationFallback(cachedSenderThread, 'sender')
  const receiverFallback = threadNeedsConversationFallback(cachedReceiverThread, 'receiver')

  sessionMemorySnapshot = {
    code,
    scanNumber: activeScanNumber,
    senderSummaries: normalizeLedgerText(cachedSenderThread?.session_summaries),
    receiverSummaries: normalizeLedgerText(cachedReceiverThread?.session_summaries),
    senderConversation: normalizeLedgerText(cachedSenderThread?.conversation),
    receiverConversation: normalizeLedgerText(cachedReceiverThread?.conversation),
    senderConversationFallback: senderFallback,
    receiverConversationFallback: receiverFallback,
  }

  const activeThread = sessionRole === 'RECEIVER' ? cachedReceiverThread : cachedSenderThread
  const activeRoleKey = sessionRole === 'RECEIVER' ? 'receiver' : 'sender'
  const missingScans = listScansMissingSummary(activeThread, activeRoleKey)

  logLedger('session memory snapshot captured', {
    code,
    scan: activeScanNumber,
    memoryMode: missingScans.length ? 'conversation-first' : 'summary-ready',
    missingSummaryScans: missingScans,
    senderSummaryChars: sessionMemorySnapshot.senderSummaries.length,
    receiverSummaryChars: sessionMemorySnapshot.receiverSummaries.length,
    senderConversationFallback: senderFallback,
    receiverConversationFallback: receiverFallback,
  })
  return true
}

/** After background summary backfill — refresh frozen summaries + fallback flags. */
export function applyBackfillToSessionSnapshot() {
  if (!sessionMemorySnapshot) return false

  sessionMemorySnapshot.senderSummaries = normalizeLedgerText(cachedSenderThread?.session_summaries)
  sessionMemorySnapshot.receiverSummaries = normalizeLedgerText(cachedReceiverThread?.session_summaries)
  sessionMemorySnapshot.senderConversationFallback = threadNeedsConversationFallback(
    cachedSenderThread,
    'sender',
  )
  sessionMemorySnapshot.receiverConversationFallback = threadNeedsConversationFallback(
    cachedReceiverThread,
    'receiver',
  )

  logLedger('session snapshot updated after backfill', {
    senderFallback: sessionMemorySnapshot.senderConversationFallback,
    receiverFallback: sessionMemorySnapshot.receiverConversationFallback,
    memoryMode: getLedgerMemoryMode(),
  })
  rebuildLedgerMemoryText()
  return true
}

export function ledgerNeedsSummaryBackfill() {
  const roleKey = roleKeyFromSession()
  const active = getCachedLedgerThread(roleKey)
  if (threadNeedsSummaryBackfill(active, roleKey)) return true
  if (sessionRole === 'RECEIVER' && threadNeedsSummaryBackfill(cachedSenderThread, 'sender')) {
    return true
  }
  return false
}

export function clearSessionMemorySnapshot() {
  sessionMemorySnapshot = null
}

export function hasSessionMemorySnapshot() {
  return sessionMemorySnapshot != null
}

/** conversation-first = missing digests → read raw chat; summary-ready = digest blocks available. */
export function getLedgerMemoryMode() {
  const roleKey = roleKeyFromSession()
  if (shouldUseConversationFallback(roleKey)) return 'conversation-first'
  if (sessionRole === 'RECEIVER' && shouldUseConversationFallback('sender')) {
    return 'conversation-first'
  }
  return 'summary-ready'
}

/** Ensure scan-scoped browser snapshot exists — no Supabase read for Gemini memory. */
export function ensureBrowserMemoryForPrompt() {
  if (!sessionMemorySnapshot && (cachedSenderThread || cachedReceiverThread || cachedVerificationCode)) {
    captureSessionMemorySnapshot()
  }
}

/**
 * Freeze memory in browser once per scan (after bootstrap/prefetch + session start).
 * Optionally kick off Archivist backfill without blocking welcome/chat.
 */
export function prepareBrowserMemoryForSession({
  verificationCode = '',
  scheduleBackfill = false,
} = {}) {
  ensureBrowserMemoryForPrompt()
  if (!sessionMemorySnapshot) {
    captureSessionMemorySnapshot()
  }
  rebuildLedgerMemoryText()

  const code = String(verificationCode || cachedVerificationCode || activeVerificationCode || '').trim()
  const mode = getLedgerMemoryMode()
  const needsBackfill = ledgerNeedsSummaryBackfill()

  logLedger('browser memory primed', {
    code,
    mode,
    needsSummaryBackfill: needsBackfill,
    snapshot: hasSessionMemorySnapshot(),
  })

  if (scheduleBackfill && needsBackfill && code) {
    void scheduleSummaryBackfillInBackground(code)
  }

  return { mode, needsSummaryBackfill: needsBackfill, memoryText: ledgerMemoryText }
}

function threadWithFrozenSummaries(thread, roleKey) {
  if (!thread) return null
  if (!sessionMemorySnapshot) return thread

  const summaries =
    roleKey === 'receiver'
      ? sessionMemorySnapshot.receiverSummaries
      : sessionMemorySnapshot.senderSummaries

  return { ...thread, session_summaries: summaries }
}

function frozenConversationForRole(roleKey) {
  if (!sessionMemorySnapshot) return ''
  return roleKey === 'receiver'
    ? sessionMemorySnapshot.receiverConversation
    : sessionMemorySnapshot.senderConversation
}

function shouldUseConversationFallback(roleKey) {
  if (sessionMemorySnapshot) {
    return roleKey === 'receiver'
      ? sessionMemorySnapshot.receiverConversationFallback
      : sessionMemorySnapshot.senderConversationFallback
  }
  const thread = getCachedLedgerThread(roleKey)
  return threadNeedsConversationFallback(thread, roleKey)
}

function listScansMissingSummary(thread, roleKey) {
  if (!thread) return []
  const conversation = normalizeLedgerText(thread.conversation)
  const endedScans = listEndedScanNumbers(conversation)
  if (!endedScans.length) return []

  const parsed = parseSessionSummaryEntries(normalizeLedgerText(thread.session_summaries))
  const missing = []
  for (const scanNum of endedScans) {
    const dialogue = extractSessionDialogueByNumber(conversation, scanNum)
    if (!hasUserSpeechInDialogue(dialogue)) continue
    const existing = parsed.find((entry) => entry.scanNumber === scanNum)
    if (!existing || summaryEntryNeedsRebuild(existing.summary, roleKey)) {
      missing.push(scanNum)
    }
  }
  return missing
}

function threadNeedsConversationFallback(thread, roleKey) {
  return listScansMissingSummary(thread, roleKey).length > 0
}

function buildConversationFallbackBlock(thread, roleKey, label) {
  if (!thread) return ''
  const conversation = normalizeLedgerText(thread.conversation)
  const missingScans = listScansMissingSummary(thread, roleKey)
  if (!missingScans.length) return ''

  const scansToInclude = listEndedScanNumbers(conversation).filter((scanNum) => {
    const dialogue = extractSessionDialogueByNumber(conversation, scanNum)
    return hasUserSpeechInDialogue(dialogue)
  })

  const sections = []
  for (const scanNum of scansToInclude) {
    const dialogue = extractSessionDialogueByNumber(conversation, scanNum)
    if (!hasDialogueLines(dialogue)) continue
    const pending = missingScans.includes(scanNum)
      ? 'summary pending'
      : 'summary exists — use dialogue until backfill completes'
    sections.push(`--- PAST CHAT SCAN ${scanNum} (${pending}) ---\n${dialogue}`)
  }
  if (!sections.length) return ''

  return [
    `${label} — CONVERSATION MEMORY (summary incomplete — full past chat below, no summary column yet):`,
    sections.join('\n\n'),
    'RULE: Continue naturally from this dialogue — reunion tone, no amnesia. Speak in your own Hinglish voice — facts from chat, no quote read-aloud.',
  ].join('\n\n')
}

function buildConversationFallbackBlockForPrompt(roleKey) {
  if (!shouldUseConversationFallback(roleKey)) return ''
  const liveThread = getCachedLedgerThread(roleKey)
  if (!liveThread) return ''

  const frozenConv = frozenConversationForRole(roleKey)
  const threadForFallback = frozenConv ? { ...liveThread, conversation: frozenConv } : liveThread
  const label = roleKey === 'receiver' ? 'RECEIVER THREAD' : 'SENDER THREAD'
  return buildConversationFallbackBlock(threadForFallback, roleKey, label)
}

export function threadNeedsSummaryBackfill(thread, roleKey = 'sender') {
  if (!thread) return false
  const conversation = normalizeLedgerText(thread.conversation)
  const endedScans = listEndedScanNumbers(conversation)
  if (!endedScans.length) return false

  const parsed = parseSessionSummaryEntries(normalizeLedgerText(thread.session_summaries))
  for (const scanNum of endedScans) {
    const dialogue = extractSessionDialogueByNumber(conversation, scanNum)
    if (!hasUserSpeechInDialogue(dialogue)) continue
    const existing = parsed.find((entry) => entry.scanNumber === scanNum)
    if (!existing || summaryEntryNeedsRebuild(existing.summary, roleKey)) return true
  }
  return false
}

/** Build missing/broken summaries in background — do not block welcome TTS. */
export function scheduleSummaryBackfillInBackground(verificationCode) {
  const code = String(verificationCode ?? '').trim()
  if (!code) return Promise.resolve()
  if (summaryBackfillPromise) return summaryBackfillPromise

  logLedger('summary backfill scheduled (background)', { code })
  summaryBackfillPromise = runSummaryBackfill(code)
    .then(() => {
      applyBackfillToSessionSnapshot()
    })
    .catch((error) => {
      console.warn('[Ledger] background summary backfill failed:', error)
    })
    .finally(() => {
      summaryBackfillPromise = null
    })
  return summaryBackfillPromise
}

async function runSummaryBackfill(verificationCode) {
  if (!supabase || !verificationCode) return
  await reloadAndBackfillThreads(verificationCode)
}

async function reloadThreadsFromDb(verificationCode) {
  if (!supabase || !verificationCode) return

  const { data: threads, error } = await supabase
    .from(LEDGER_TABLE)
    .select('id, verification_code, device_id, role, scan_count, conversation, session_summaries')
    .eq('verification_code', verificationCode)
    .order('role', { ascending: true })

  if (error) {
    console.warn('[Ledger] reload threads failed:', error.message)
    return
  }

  cachedSenderThread = (threads ?? []).find((row) => row.role === 'sender') ?? null
  cachedReceiverThread = (threads ?? []).find((row) => row.role === 'receiver') ?? null
  refreshLedgerWelcomeMode()
  rebuildLedgerMemoryText()
}

export function buildFastResumeOpenerFromConversation(thread, roleKey = 'sender') {
  const conversation = normalizeLedgerText(thread?.conversation)
  if (!conversation) return ''

  let firstUserLine = ''
  for (const scanNum of listEndedScanNumbers(conversation)) {
    const dialogue = extractSessionDialogueByNumber(conversation, scanNum)
    for (const line of extractUserLinesFromDialogue(dialogue, roleKey)) {
      if (!firstUserLine) firstUserLine = line
    }
    if (firstUserLine) break
  }
  if (!firstUserLine) return ''

  if (roleKey === 'receiver') {
    return `[laugh] Arre wapas! Pehli baat yaad hai — "${firstUserLine}". Chalo jahan chhoda tha wahi se.`
  }

  const name = guessSenderNameFromIntro(firstUserLine)
  if (name) {
    return `[laugh] Arre ${name}, wapas aa gaye! Tumne shuru mein kaha tha "${firstUserLine}" — chalo wahi thread pakadte hain.`
  }
  return `[laugh] Arre wapas aa gaye! Tumhari pehli line yaad hai — "${firstUserLine}". Chalo continue karte hain.`
}

function guessSenderNameFromIntro(line) {
  const hit = String(line ?? '').match(/\b(?:me|main|mera naam|naam)\s+([a-zA-Z]{2,24})\b/i)
  if (!hit?.[1]) return ''
  const raw = hit[1]
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase()
}

function digestHasSenderLines(summary) {
  const text = String(summary ?? '')
  return (
    /^(?:\d+\.\s*)?sender:/im.test(text) ||
    /(?:^|\n)(?:\d+\.\s*)?sender:/im.test(text)
  )
}

function summaryLooksTruncated(summary) {
  const text = String(summary ?? '').trim()
  if (!text || /reason:\s*empty/i.test(text)) return false
  if (/DIALOGUE DIGEST:/i.test(text)) {
    return !digestHasSenderLines(text)
  }
  return /^THREAD:\s*(Sender|Receiver)\b/im.test(text) && text.split('\n').filter(Boolean).length <= 4
}

function summaryEntryNeedsRebuild(summary, roleKey) {
  const text = String(summary ?? '').trim()
  if (!text || /reason:\s*empty/i.test(text)) return true
  if (roleKey === 'receiver') return false
  if (!/DIALOGUE DIGEST:/i.test(text)) return true
  if (!digestHasSenderLines(text)) return true
  return summaryLooksTruncated(text)
}

function replaceSummaryEntryForScan(summariesText, scanNumber, newEntry) {
  const text = normalizeLedgerText(summariesText)
  const block = String(newEntry ?? '').trim()
  if (!block) return text
  const regex = new RegExp(
    `--- session ${Number(scanNumber)} summary \\([^)]+\\) ---[\\s\\S]*?(?=\\n--- session \\d+ summary|$)`,
    'i',
  )
  if (regex.test(text)) return text.replace(regex, block)
  return text ? `${text}\n\n${block}` : block
}

/** Call on app start — logs whether Supabase tables are reachable. */
export async function probeLedgerHealth() {
  if (!supabase) {
    console.warn('[Ledger] Supabase keys missing — scan history will NOT save.')
    return false
  }

  const { error } = await supabase
    .from(LEDGER_TABLE)
    .select('id', { count: 'exact', head: true })
    .limit(1)

  if (error) {
    console.error('[Ledger] Database unreachable or tables missing:', error.message)
    console.error(`[Ledger] Fix: Supabase → SQL Editor → run supabase/axera_fresh_start.sql (table: ${LEDGER_TABLE})`)
    return false
  }

  console.info(`[Ledger] Supabase OK — ${LEDGER_TABLE} will save (2 rows per code max).`)
  return true
}

function readDeviceCookie() {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(/(?:^|; )axerai_device_id=([^;]*)/)
  return match ? decodeURIComponent(match[1]) : null
}

function writeDeviceCookie(id) {
  if (typeof document === 'undefined') return
  document.cookie = `${DEVICE_COOKIE}=${encodeURIComponent(id)}; path=/; max-age=${60 * 60 * 24 * 365 * 5}; SameSite=Lax`
}

export function getDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY) || readDeviceCookie()
    if (!id) {
      id = crypto.randomUUID()
      console.info('[Ledger] New device ID created for this browser URL:', id.slice(0, 8) + '…')
      console.info('[Ledger] Same laptop par hamesha ye URL use karo taaki ID same rahe:', window.location.origin)
    }
    localStorage.setItem(DEVICE_ID_KEY, id)
    writeDeviceCookie(id)
    return id
  } catch {
    const cookieId = readDeviceCookie()
    if (cookieId) return cookieId
    return 'unknown-device'
  }
}

export function getLedgerSessionInfo() {
  return {
    role: sessionRole,
    deviceId: getDeviceId(),
    threadId: activeThreadId,
    scanNumber: activeScanNumber,
    code: activeVerificationCode,
  }
}

/** SENDER = first scanner device or same device returning. RECEIVER = new device on same code. */
export function getSessionRole() {
  return sessionRole
}

export function getLedgerWelcomeMode() {
  return ledgerWelcomeMode
}

/** Return scan only when real dialogue or non-empty summaries exist — session markers alone ≠ memory. */
function threadHasPriorConversation(thread) {
  if (!thread) return false

  const summaries = parseSessionSummaryEntries(String(thread?.session_summaries ?? ''))
  const hasRealSummaries = summaries.some(
    (entry) => entry.summary?.trim() && !/reason:\s*empty_scan/i.test(entry.summary),
  )
  if (hasRealSummaries) return true

  const conversation = String(thread?.conversation ?? '').trim()
  if (!conversation) return false

  return hasDialogueLines(sanitizeSessionDialogue(conversation))
}

function refreshLedgerWelcomeMode() {
  ledgerWelcomeMode = resolveWelcomeMode(sessionRole, cachedSenderThread, cachedReceiverThread)
}

function resolveWelcomeMode(role, senderThread, receiverThread) {
  if (role === 'RECEIVER') {
    return threadHasPriorConversation(receiverThread) ? 'RECEIVER_RETURN' : 'RECEIVER_FIRST'
  }
  return threadHasPriorConversation(senderThread) ? 'SENDER_RETURN' : 'SENDER_FIRST'
}

function buildBackendScanSignal(mode) {
  switch (mode) {
    case 'SENDER_FIRST':
      return `Axerai backend: gift-giver FIRST scan — BOOT STEP A only. Target ~100 words (boot only). Richera keepsake soul wakes; natkhat bestie comedy + light roast; ask name ONLY — no lover shayari boot. Flirt/tease after name. NO gift-for/occasion yet.`
    case 'SENDER_RETURN':
      return [
        'Axerai backend: SENDER return scan. Reunion feel scaled to RECENCY gap. Read DIALOGUE DIGEST sender lines — do not re-ask what user already shared. One forward beat only. No boot intro.',
        shouldUseConversationFallback('sender')
          ? ' SUMMARY PENDING for ended scan(s) — read CONVERSATION FALLBACK below; dynamic reunion welcome from that chat (where did you go, unfinished thread).'
          : '',
      ].join('')
    case 'RECEIVER_FIRST':
      return [
        `Axerai backend: RECIPIENT first scan — welcome concept. Personal greet, scan arrival, Myra intro, bracelet feel; story drip turn 2+.`,
        shouldUseConversationFallback('sender')
          ? ' Sender summary pending — read SENDER CONVERSATION FALLBACK; deliver naturally from that chat until digest exists.'
          : '',
      ].join('')
    case 'RECEIVER_RETURN':
      return [
        `Axerai backend: RECIPIENT return scan — DELIVER mode. Apply RECIPIENT LEDGER JUMP RECIPE — read receiver SCAN CONVERSATION + CURRENT SESSION; trace hook→response→reply yourself. ONE beat + ONE hook.`,
        shouldUseConversationFallback('receiver')
          ? ' RECEIVER summary pending — read RECEIVER CONVERSATION FALLBACK below.'
          : '',
      ].join('')
    default:
      return ''
  }
}

function buildPreviousConversationBlock(role, senderThread, receiverThread) {
  const senderFallback = buildConversationFallbackBlockForPrompt('sender')
  const receiverFallback =
    role === 'RECEIVER' ? buildConversationFallbackBlockForPrompt('receiver') : ''
  const senderBlock = buildCompactThreadBlock('SENDER CONVERSATION (Myra ↔ Sender)', senderThread)
  const receiverBlock = buildCompactThreadBlock('RECEIVER CONVERSATION (Myra ↔ Receiver)', receiverThread)

  if (role === 'RECEIVER') {
    return [
      receiverFallback,
      receiverBlock || 'RECEIVER CONVERSATION (Myra ↔ Receiver): (empty)',
      shouldUseConversationFallback('sender') ? senderFallback : '',
      senderBlock || 'SENDER CONVERSATION (Myra ↔ Sender): (empty)',
    ]
      .filter(Boolean)
      .join('\n\n')
  }

  return [senderFallback, senderBlock || 'No previous conversation saved for this product code yet.']
    .filter(Boolean)
    .join('\n\n')
}

/**
 * Max 2 devices per product code:
 * 1st = SENDER, 2nd = RECEIVER, 3rd+ = rejected.
 */
function resolveSessionAccess(senderThread, receiverThread, currentDeviceId) {
  const senderDeviceId = String(senderThread?.device_id ?? '').trim()
  const receiverDeviceId = String(receiverThread?.device_id ?? '').trim()
  const hasSender = hasActiveSenderThread(senderThread)

  if (!hasSender || !senderDeviceId) {
    return { allowed: true, role: 'SENDER' }
  }
  if (currentDeviceId === senderDeviceId) {
    return { allowed: true, role: 'SENDER' }
  }
  // Receiver seat free, or same receiver device returning
  if (!receiverDeviceId || currentDeviceId === receiverDeviceId) {
    return { allowed: true, role: 'RECEIVER' }
  }
  return { allowed: false, role: null, reason: 'PAIR_FULL' }
}

function parseConversationLines(conversation) {
  if (!conversation?.trim()) return []
  return conversation
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (/^--- session \d+ end ---$/i.test(line)) {
        return { speaker: 'session-end', text: line }
      }
      if (/^--- session \d+ start ---$/i.test(line)) {
        return { speaker: 'session-start', text: line }
      }
      const metaMatch = line.match(
        /^(session-started|session-ended|session-duration|session-praise):\s*(.+)$/i,
      )
      if (metaMatch) {
        return { speaker: metaMatch[1].toLowerCase(), text: metaMatch[2].trim() }
      }
      const match = line.match(/^(myra|sender|receiver):\s*(.+)$/i)
      if (!match) return { speaker: 'unknown', text: line }
      return { speaker: match[1].toLowerCase(), text: match[2].trim() }
    })
}

function formatLedgerWhen(ts) {
  try {
    return new Date(ts).toLocaleString('en-IN', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    })
  } catch {
    return new Date(ts).toISOString()
  }
}

function formatSessionDuration(seconds) {
  if (seconds < 60) return `${seconds} seconds`
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return secs > 0 ? `${mins} min ${secs}s` : `${mins} min`
}

/** Estimate voice-chat duration when session footer timestamps are missing or zero. */
function estimateSessionDurationFromDialogue(sessionDialogue) {
  const lines = (String(sessionDialogue ?? '').match(/^(myra|sender|receiver):/gim) || []).length
  return Math.max(30, lines * 18)
}

function resolveSessionTiming(conversation, scanNum, sessionDialogue, endedAtFallback = Date.now()) {
  const startedAt =
    readSessionMetaAfterEnd(conversation, scanNum, 'session-started') ??
    endedAtFallback - estimateSessionDurationFromDialogue(sessionDialogue) * 1000
  const endedAt =
    readSessionMetaAfterEnd(conversation, scanNum, 'session-ended') ?? endedAtFallback
  let durationSeconds = Math.max(1, Math.round((endedAt - startedAt) / 1000))
  if (durationSeconds <= 1 && sessionDialogue) {
    durationSeconds = estimateSessionDurationFromDialogue(sessionDialogue)
  }
  return { startedAt, endedAt, durationSeconds }
}

function extractCurrentSessionConversation(conversation) {
  const text = String(conversation ?? '').trim()
  if (!text) return ''

  const segments = text.split(/\n--- session \d+ end ---\n/i)
  let lastSegment = (segments[segments.length - 1] ?? '').trim()
  if (!lastSegment) return ''

  const startParts = lastSegment.split(/\n--- session \d+ start ---\n/i)
  lastSegment = (startParts[startParts.length - 1] ?? '').trim()

  return lastSegment
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false
      if (/^--- session \d+ (end|start) ---$/i.test(line)) return false
      if (/^session-(started|ended|duration|praise):/i.test(line)) return false
      return true
    })
    .join('\n')
    .trim()
}

/** Drop offline fallback lines from memory/summaries; dedupe back-to-back identical lines. */
function sanitizeSessionDialogue(dialogue) {
  const lines = parseConversationLines(dialogue)
  const cleaned = []

  for (const line of lines) {
    if (line.speaker !== 'myra' && line.speaker !== 'sender' && line.speaker !== 'receiver') {
      continue
    }

    if (line.speaker === 'myra' && isOfflineMyraFallback(line.text)) {
      continue
    }

    const prev = cleaned[cleaned.length - 1]
    if (prev && prev.speaker === line.speaker && prev.text === line.text) continue

    cleaned.push(line)
  }

  return cleaned.map((line) => `${line.speaker}: ${line.text}`).join('\n').trim()
}

/** Times only in conversation — summaries go in session_summaries column. */
function buildSessionConversationFooter({
  scanNumber,
  startedAt,
  endedAt,
  durationSeconds,
  praise,
  viewTimes,
}) {
  const lines = [
    `--- session ${scanNumber} end ---`,
    `session-started: ${formatLedgerWhen(startedAt)}`,
    `session-ended: ${formatLedgerWhen(endedAt)}`,
    `session-duration: ${formatSessionDuration(durationSeconds)}`,
  ]
  if (viewTimes?.arSeconds > 0) lines.push(`session-view-ar-seconds: ${viewTimes.arSeconds}`)
  if (viewTimes?.vrSeconds > 0) lines.push(`session-view-vr-seconds: ${viewTimes.vrSeconds}`)
  if (viewTimes?.overviewSeconds > 0) {
    lines.push(`session-view-overview-seconds: ${viewTimes.overviewSeconds}`)
  }
  if (praise?.detected && praise.quote) {
    lines.push(`session-praise: "${praise.quote}"`)
  }
  return lines.join('\n')
}

function formatTimeOfDayLabel(ts) {
  const h = new Date(ts).getHours()
  if (h >= 5 && h < 12) return 'morning'
  if (h >= 12 && h < 17) return 'afternoon'
  if (h >= 17 && h < 21) return 'evening'
  return 'night'
}

function getLastEndedTimeFromSummaries(previousSummaries) {
  const ends = [...String(previousSummaries ?? '').matchAll(/^ended:\s*(.+)$/gim)].map((m) => m[1].trim())
  const last = ends[ends.length - 1]
  if (!last) return null
  const parsed = new Date(last)
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime()
}

/** Scan 2+ — how long since last session ended + time-of-day for Myra reunion feel. */
function buildReturnGapMessage({ roleKey, scanNumber, startedAt, previousSummaries = '' }) {
  if (!scanNumber || scanNumber <= 1) return ''
  const prevEnded = getLastEndedTimeFromSummaries(previousSummaries)
  if (!prevEnded || !startedAt) return ''

  const gapMs = startedAt - prevEnded
  if (gapMs < 0) return ''

  const totalHours = gapMs / 3600000
  const days = Math.floor(totalHours / 24)
  const remHours = Math.round(totalHours % 24)
  let gapText = ''
  if (days > 0) {
    gapText = remHours > 0 ? `${days} day${days > 1 ? 's' : ''} ${remHours}h` : `${days} day${days > 1 ? 's' : ''}`
  } else if (totalHours >= 1) {
    gapText = `${Math.round(totalHours)}h`
  } else {
    gapText = `${Math.max(1, Math.round(gapMs / 60000))} min`
  }

  const role = roleKey === 'receiver' ? 'Receiver' : 'Sender'
  const timeOfDay = formatTimeOfDayLabel(startedAt)
  const clock = formatLedgerWhen(startedAt)
  return `${role} came again after ${gapText} (${timeOfDay}, started ${clock})`
}

function wrapSummaryWithReturnContext(summary, returnGap) {
  const body = String(summary ?? '').trim()
  if (!returnGap) return body
  if (/^RETURN CONTEXT:/im.test(body)) return body
  return `RETURN CONTEXT:\n${returnGap}\n\n${body}`
}

function buildSessionSummaryEntry({
  scanNumber,
  startedAt,
  endedAt,
  durationSeconds,
  roleKey,
  summary,
  praise,
  axeraiPraise,
  returnGap,
}) {
  const roleLabel = roleKey === 'receiver' ? 'Receiver' : 'Sender'
  const lines = [
    `--- session ${scanNumber} summary (${roleLabel}) ---`,
    `date: ${formatLedgerWhen(endedAt)}`,
    `started: ${formatLedgerWhen(startedAt)}`,
    `ended: ${formatLedgerWhen(endedAt)}`,
    `duration: ${formatSessionDuration(durationSeconds)}`,
  ]
  if (returnGap) lines.push(`return_gap: ${returnGap}`)
  lines.push('summary:', wrapSummaryWithReturnContext(summary, returnGap))
  if (praise?.detected && praise.quote) {
    lines.push(`brand_praise: "${praise.quote}"`)
    lines.push(`praise: "${praise.quote}"`)
  }
  if (axeraiPraise?.detected && axeraiPraise.quote) {
    lines.push(`axerai_praise: "${axeraiPraise.quote}"`)
  }
  return lines.join('\n')
}

function buildSummaryFromConversation(
  conversation,
  roleKey = 'sender',
  sessionDialogueOverride = null,
  previousSummaries = '',
) {
  const sessionOnly = sanitizeSessionDialogue(
    sessionDialogueOverride ?? extractCurrentSessionConversation(conversation),
  )
  const lines = parseConversationLines(sessionOnly)
  const userSpeaker = roleKey === 'receiver' ? 'receiver' : 'sender'
  const userLines = lines.filter((line) => line.speaker === userSpeaker).map((line) => line.text)
  const myraLines = lines.filter((line) => line.speaker === 'myra').map((line) => line.text)
  const rawSummary = buildLocalStorySummary({ roleKey, userLines, myraLines })
  const skip = shouldSkipSessionSummary(sessionOnly)
  const enriched = skip ? '' : enrichSessionSummary(rawSummary, previousSummaries)
  return {
    summary: enriched,
    praise: skip ? { detected: false, quote: '' } : parseBrandProductPraise(enriched),
    axeraiPraise: skip ? { detected: false, quote: '' } : parseAxeraiPraiseFromSummary(enriched),
  }
}

function parseSessionDialogueSpeakers(sessionDialogue, roleKey) {
  const lines = parseConversationLines(sanitizeSessionDialogue(sessionDialogue))
  const userSpeaker = roleKey === 'receiver' ? 'receiver' : 'sender'
  return {
    userLines: lines.filter((line) => line.speaker === userSpeaker).map((line) => line.text),
    myraLines: lines.filter((line) => line.speaker === 'myra').map((line) => line.text),
  }
}

async function buildSessionSummaryAndPraise({
  sessionDialogue,
  roleKey,
  scanNumber,
  previousSummaries = '',
}) {
  if (shouldSkipSessionSummary(sessionDialogue)) {
    logLedger('summary skipped — no user speech', { scanNumber, role: roleKey })
    return {
      summary: '',
      praise: { detected: false, quote: '' },
      axeraiPraise: { detected: false, quote: '' },
      source: 'skip-empty',
    }
  }

  if (!hasDialogueLines(sessionDialogue)) {
    return buildSummaryFromConversation('', roleKey, sessionDialogue, previousSummaries)
  }

  const { userLines, myraLines } = parseSessionDialogueSpeakers(sessionDialogue, roleKey)

  try {
    const geminiSummary = await summarizeSessionDialogue({
      dialogue: sessionDialogue,
      roleKey,
      scanNumber,
      priorSummaries: previousSummaries,
    })

    if (geminiSummary?.text) {
      void recordGeminiUsage({
        callType: 'summary',
        model: geminiSummary.model,
        promptTokens: geminiSummary.usage?.promptTokens,
        outputTokens: geminiSummary.usage?.outputTokens,
        totalTokens: geminiSummary.usage?.totalTokens,
        scanNumber,
      })

      const enriched = repairSessionSummaryFromDialogue({
        geminiText: geminiSummary.text,
        roleKey,
        userLines,
        myraLines,
        priorSummariesText: previousSummaries,
      })
      const usedFallback =
        enriched.includes('sender: "') &&
        !String(geminiSummary.text).includes('sender: "') &&
        userLines.length > 0

      return {
        summary: enriched,
        praise: parseBrandProductPraise(enriched),
        axeraiPraise: parseAxeraiPraiseFromSummary(enriched),
        source: usedFallback ? 'gemini-repaired' : 'gemini',
      }
    }
  } catch (error) {
    console.warn('[Ledger] Gemini summary failed:', error?.message ?? error)
  }

  logLedger('local fallback summary — brand praise requires Gemini')
  return {
    ...buildSummaryFromConversation('', roleKey, sessionDialogue, previousSummaries),
    source: 'fallback',
  }
}

function hasDialogueLines(dialogue) {
  return /^(myra|sender|receiver):/im.test(String(dialogue ?? ''))
}

function hasSummaryForScan(sessionSummaries, scanNumber) {
  return new RegExp(`--- session ${Number(scanNumber)} summary\\b`, 'i').test(
    String(sessionSummaries ?? ''),
  )
}

function hasEndFooterForScan(conversation, scanNumber) {
  return new RegExp(`--- session ${Number(scanNumber)} end ---`, 'i').test(
    String(conversation ?? ''),
  )
}

/** Last session that started but never got an end footer (tab kill / pagehide race). */
function findOpenSessionNumber(conversation) {
  const starts = [...String(conversation ?? '').matchAll(/--- session (\d+) start ---/gi)]
  if (!starts.length) return null
  const scanNumber = Number(starts[starts.length - 1][1])
  if (!Number.isFinite(scanNumber) || scanNumber < 1) return null
  if (hasEndFooterForScan(conversation, scanNumber)) return null
  return scanNumber
}

/** Dialogue for one ended scan (between start/end markers). */
function extractSessionDialogueByNumber(conversation, scanNumber) {
  const text = String(conversation ?? '')
  const n = Number(scanNumber)
  if (!Number.isFinite(n) || n < 1) return ''

  const startRe = new RegExp(`--- session ${n} start ---\\s*\\n`, 'i')
  const startMatch = startRe.exec(text)
  if (!startMatch) return ''

  const afterStart = text.slice(startMatch.index + startMatch[0].length)
  const endRe = new RegExp(`\\n--- session ${n} end ---`, 'i')
  const endMatch = endRe.exec(afterStart)
  const segment = (endMatch ? afterStart.slice(0, endMatch.index) : afterStart).trim()
  return sanitizeSessionDialogue(segment)
}

const MAX_DYNAMIC_MEMORY_CHARS = 14000

function trimDynamicMemoryBlock(text) {
  const t = String(text ?? '').trim()
  if (t.length <= MAX_DYNAMIC_MEMORY_CHARS) return t
  return `${t.slice(0, MAX_DYNAMIC_MEMORY_CHARS)}\n...(memory search truncated — answer from visible lines only)`
}

/** User asked recall — decide quotes-only vs full past chat transcript. */
export function classifyMemorySearchIntent(userText) {
  const u = String(userText ?? '').trim()
  if (!u) return 'none'

  if (
    /\b(tumne kya bola|tumne kya kaha|tumne kya bole|myra ne kya|kal kya bola|kal kya bole|jab mene|jab maine|jab me ne|us waqt tumne|tab tumne|tab kya bola|poori baat|puri baat|exactly kya bola tha tumne|us time kya)\b/i.test(
      u,
    )
  ) {
    return 'full_transcript'
  }

  if (
    /\b(mene kya bola|maine kya bola|me ne kya bola|kya bataya|pehle bola|pehle bataya|mene bola|maine bola|tumhe bataya|yaad hai|yaad karo|yad hai|sun liya|kya kaha tha|kab liya|kab liye|kya bole the|bataya tha|bataya to hai|pata hai kya|story sunai|story suna|sunai thi|kya suna|kya sunai|pehle ek bar)\b/i.test(
      u,
    )
  ) {
    return 'sender_quotes'
  }

  return 'none'
}

function resolveMemorySearchScans(userText, conversation) {
  const all = listEndedScanNumbers(conversation)
  if (!all.length) return all

  const u = String(userText ?? '').toLowerCase()
  if (/\b(pehli bar|pehle scan|first scan|session 1|scan 1|pehli bar scan)\b/i.test(u)) {
    return all.includes(1) ? [1] : [all[0]]
  }
  if (/\b(dusri bar|second scan|session 2|scan 2)\b/i.test(u)) {
    return all.includes(2) ? [2] : [all[all.length - 1]]
  }
  if (/\b(kal|last time|last scan|aakhri bar|pichli bar|pichle scan)\b/i.test(u)) {
    return [all[all.length - 1]]
  }
  if (/\b(sari|saari|poori|puri|sab chat|saari baat)\b/i.test(u)) {
    return all
  }
  return all
}

function extractUserLinesFromDialogue(dialogue, userSpeaker = 'sender') {
  const speaker = String(userSpeaker ?? 'sender').toLowerCase()
  const lines = []
  for (const line of String(dialogue ?? '').split('\n')) {
    const match = line.match(new RegExp(`^${speaker}:\\s*(.+)$`, 'i'))
    if (match?.[1]?.trim()) lines.push(match[1].trim())
  }
  return lines
}

function collectAllUserLinesFromThread(thread, roleKey = 'sender') {
  const userSpeaker = roleKey === 'receiver' ? 'receiver' : 'sender'
  const conversation = normalizeLedgerText(thread?.conversation)
  const quotes = new Set()

  for (const scanNum of listEndedScanNumbers(conversation)) {
    for (const line of extractUserLinesFromDialogue(
      extractSessionDialogueByNumber(conversation, scanNum),
      userSpeaker,
    )) {
      quotes.add(line)
    }
  }

  const current = sanitizeSessionDialogue(extractCurrentSessionConversation(conversation))
  for (const line of extractUserLinesFromDialogue(current, userSpeaker)) {
    quotes.add(line)
  }

  for (const entry of resolvePastSummaryEntries(thread)) {
    if (roleKey === 'receiver') {
      for (const q of extractReceiverQuotesFromSummary(entry.summary)) {
        if (q) quotes.add(q)
      }
    } else {
      for (const q of extractSenderQuotesFromSummary(entry.summary)) {
        if (q) quotes.add(q)
      }
    }
  }

  return [...quotes]
}

function collectAllSenderLinesFromThread(thread) {
  return collectAllUserLinesFromThread(thread, 'sender')
}

function buildUserQuotesSearchBlock(thread, roleKey = 'sender') {
  const quotes = collectAllUserLinesFromThread(thread, roleKey)
  if (!quotes.length) return ''

  const userLabel = roleKey === 'receiver' ? 'RECIPIENT SAID' : 'SENDER SAID'
  return trimDynamicMemoryBlock(
    [
      'MEMORY SEARCH (Axerai — user asked what THEY said; answer ONLY from lines below):',
      `${userLabel} (exact saved chat + summary quotes — truth; never claim amnesia):`,
      ...quotes.map((q) => `- "${q}"`),
      'SEARCH RULE: Repeat their exact words warmly in Hinglish. Do NOT invent lines not listed above.',
    ].join('\n'),
  )
}

function buildSenderQuotesSearchBlock(thread) {
  return buildUserQuotesSearchBlock(thread, 'sender')
}

function buildFullTranscriptSearchBlock(thread, userText) {
  const conversation = normalizeLedgerText(thread?.conversation)
  const scanNumbers = resolveMemorySearchScans(userText, conversation)
  if (!scanNumbers.length) return ''

  const sections = []
  for (const scanNum of scanNumbers) {
    const dialogue = extractSessionDialogueByNumber(conversation, scanNum)
    if (!hasDialogueLines(dialogue)) continue
    sections.push(`--- FULL CHAT SCAN ${scanNum} (exact myra + sender lines) ---\n${dialogue}`)
  }

  if (!sections.length) return ''

  return trimDynamicMemoryBlock(
    [
      'MEMORY SEARCH (Axerai — user asked what was said WHEN; read FULL CHAT below):',
      'FULL PAST CONVERSATION (exact lines — myra: and sender: are both truth):',
      sections.join('\n\n'),
      'SEARCH RULE: Quote exact myra + sender lines from FULL CHAT. Never invent. Never claim amnesia when chat is below.',
    ].join('\n\n'),
  )
}

function getActiveThreadForMemorySearch(role) {
  if (role === 'RECEIVER') {
    return { primary: cachedReceiverThread, cross: cachedSenderThread }
  }
  return { primary: cachedSenderThread, cross: null }
}

function buildDynamicMemorySearchBlock(userText, intent, role) {
  const { primary, cross } = getActiveThreadForMemorySearch(role)
  const blocks = []

  if (intent === 'sender_quotes') {
    const primaryRole = role === 'RECEIVER' ? 'receiver' : 'sender'
    const main = buildUserQuotesSearchBlock(primary, primaryRole)
    if (main) blocks.push(main)
    if (cross) {
      const senderQuotes = buildUserQuotesSearchBlock(cross, 'sender')
      if (senderQuotes) {
        blocks.push(
          senderQuotes.replace(
            'MEMORY SEARCH (Axerai — user asked what THEY said',
            'MEMORY SEARCH — SENDER THREAD (gift-giver said',
          ),
        )
      }
    }
  }

  if (intent === 'full_transcript') {
    const main = buildFullTranscriptSearchBlock(primary, userText)
    if (main) blocks.push(main)
    if (cross) {
      const senderChat = buildFullTranscriptSearchBlock(cross, userText)
      if (senderChat) {
        blocks.push(
          senderChat.replace(
            'MEMORY SEARCH (Axerai — user asked what was said WHEN',
            'MEMORY SEARCH — SENDER THREAD (what Myra + sender said before receiver scan',
          ),
        )
      }
    }
  }

  return blocks.filter(Boolean).join('\n\n')
}

function readSessionMetaAfterEnd(conversation, scanNumber, key) {
  const text = String(conversation ?? '')
  const endMarker = `--- session ${Number(scanNumber)} end ---`
  const endIdx = text.toLowerCase().indexOf(endMarker.toLowerCase())
  if (endIdx < 0) return null

  const tail = text.slice(endIdx + endMarker.length, endIdx + endMarker.length + 800)
  const re = new RegExp(`^${key}:\\s*(.+)$`, 'im')
  const match = tail.match(re)
  if (!match?.[1]) return null
  const parsed = new Date(match[1].trim())
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime()
}

/**
 * End footer exists but session_summaries missing — rebuild digest from saved chat.
 * Fixes return scans where conversation saved but summary column did not land.
 */
async function backfillMissingSummariesForThread(thread, roleKey) {
  if (!thread?.id) return thread

  const conversation = normalizeLedgerText(thread.conversation)
  if (!conversation) return thread

  let previousSummaries = normalizeLedgerText(thread.session_summaries)
  const endedScans = listEndedScanNumbers(conversation)
  const parsedEntries = parseSessionSummaryEntries(previousSummaries)

  let changed = false
  for (const scanNum of endedScans) {
    const sessionDialogue = extractSessionDialogueByNumber(conversation, scanNum)
    if (!hasDialogueLines(sessionDialogue) || !hasUserSpeechInDialogue(sessionDialogue)) continue

    const existing = parsedEntries.find((entry) => entry.scanNumber === scanNum)
    if (existing && !summaryEntryNeedsRebuild(existing.summary, roleKey)) continue

    const built = await buildSessionSummaryAndPraise({
      sessionDialogue,
      roleKey,
      scanNumber: scanNum,
      previousSummaries,
    })
    if (!built.summary?.trim()) continue

    const { startedAt, endedAt, durationSeconds } = resolveSessionTiming(
      conversation,
      scanNum,
      sessionDialogue,
    )

    const summaryEntry = buildSessionSummaryEntry({
      scanNumber: scanNum,
      startedAt,
      endedAt,
      durationSeconds,
      roleKey,
      summary: built.summary,
      praise: built.praise,
      axeraiPraise: built.axeraiPraise,
      returnGap: buildReturnGapMessage({
        roleKey,
        scanNumber: scanNum,
        startedAt,
        previousSummaries,
      }),
    })

    if (existing) {
      previousSummaries = replaceSummaryEntryForScan(previousSummaries, scanNum, summaryEntry)
      logLedger('rebuilt bad/missing summary from conversation', { scanNum, role: roleKey })
    } else {
      previousSummaries = previousSummaries ? `${previousSummaries}\n\n${summaryEntry}` : summaryEntry
      logLedger('backfilled missing summary from conversation', { scanNum, role: roleKey })
    }
    changed = true
  }

  if (!changed) return thread

  if (supabase) {
    const { error } = await supabase
      .from(LEDGER_TABLE)
      .update({ session_summaries: previousSummaries })
      .eq('id', thread.id)

    if (error) {
      console.warn('[Ledger] backfill save failed:', error.message)
    }
  }

  return { ...thread, session_summaries: previousSummaries }
}

/**
 * If previous scan never finished (common when user closes tab and rescans),
 * write a LOCAL summary + end footer BEFORE the next session starts.
 * Gemini async summary on pagehide is too slow / often lost.
 */
async function sealOpenThreadSession(thread, roleKey) {
  if (!supabase || !thread?.id) return thread

  const conversation = String(thread.conversation ?? '').trim()
  const previousSummaries = String(thread.session_summaries ?? '').trim()
  const openScan = findOpenSessionNumber(conversation)
  if (openScan == null) return thread

  const sessionDialogue = sanitizeSessionDialogue(extractCurrentSessionConversation(conversation))
  const endedAt = Date.now()
  const { startedAt, durationSeconds } = resolveSessionTiming(
    conversation,
    openScan,
    sessionDialogue,
    endedAt,
  )

  let summary = ''
  let praise = { detected: false, quote: '' }
  let axeraiPraise = { detected: false, quote: '' }
  let source = 'already'

  if (!hasSummaryForScan(previousSummaries, openScan)) {
    const local = buildSummaryFromConversation('', roleKey, sessionDialogue, previousSummaries)
    summary = local.summary
    praise = local.praise
    axeraiPraise = local.axeraiPraise
    source = 'seal-local'
  }

  const footer = hasEndFooterForScan(conversation, openScan)
    ? ''
    : buildSessionConversationFooter({
        scanNumber: openScan,
        startedAt,
        endedAt,
        durationSeconds,
        praise,
      })

  const conversationWithFooter = footer
    ? conversation
      ? `${conversation}\n${footer}`
      : footer
    : conversation

  let nextSummaries = previousSummaries
  if (summary) {
    const summaryEntry = buildSessionSummaryEntry({
      scanNumber: openScan,
      startedAt,
      endedAt,
      durationSeconds,
      roleKey,
      summary,
      praise,
      axeraiPraise,
      returnGap: buildReturnGapMessage({
        roleKey,
        scanNumber: openScan,
        startedAt,
        previousSummaries,
      }),
    })
    nextSummaries = previousSummaries ? `${previousSummaries}\n\n${summaryEntry}` : summaryEntry
  }

  if (conversationWithFooter === conversation && nextSummaries === previousSummaries) {
    return thread
  }

  const { error } = await supabase
    .from(LEDGER_TABLE)
    .update({
      conversation: conversationWithFooter,
      session_summaries: nextSummaries,
    })
    .eq('id', thread.id)

  if (error) {
    console.warn('[Ledger] seal open session failed:', error.message)
    return thread
  }

  logLedger('sealed open session before next scan', {
    scanNumber: openScan,
    role: roleKey,
    source,
    hadDialogue: hasDialogueLines(sessionDialogue),
  })

  return {
    ...thread,
    conversation: conversationWithFooter,
    session_summaries: nextSummaries,
  }
}

function normalizeLedgerText(text) {
  return String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
}

function listEndedScanNumbers(conversation) {
  return [
    ...new Set(
      [...normalizeLedgerText(conversation).matchAll(/--- session (\d+) end ---/gi)]
        .map((m) => Number(m[1]))
        .filter((n) => Number.isFinite(n) && n >= 1),
    ),
  ].sort((a, b) => a - b)
}

function buildInlineDigestEntriesFromConversation(conversation, roleKey = 'sender') {
  const entries = []
  for (const scanNum of listEndedScanNumbers(conversation)) {
    const dialogue = extractSessionDialogueByNumber(conversation, scanNum)
    if (!hasDialogueLines(dialogue)) continue
    const local = buildSummaryFromConversation('', roleKey, dialogue, '')
    if (!local.summary?.trim()) continue
    entries.push({
      scanNumber: scanNum,
      role: roleKey === 'receiver' ? 'Receiver' : 'Sender',
      started: '',
      ended: '',
      summary: local.summary,
    })
  }
  return entries
}

/** Multiline summary body — avoid `$` in regex (m flag stops at first line). */
function extractSummaryBodyFromSessionBlock(block) {
  const text = String(block ?? '')
  const multilineMarker = text.match(/^summary:\s*\n/im)
  if (multilineMarker) {
    const rest = text.slice(multilineMarker.index + multilineMarker[0].length)
    const cut = rest.match(/^([\s\S]*?)(?=\r?\n(?:brand_praise|axerai_praise|praise):\s*")/i)
    let body = (cut?.[1] ?? rest).trim()
    const nestedSession = body.search(/\r?\n--- session \d+ summary\b/i)
    if (nestedSession > 0) body = body.slice(0, nestedSession).trim()
    const junkMarker = body.search(/\r?\n\*{2,}|\r?\nTHREAD:\s*(?:Sender|Receiver)\s*\n[\s\S]*$/i)
    if (junkMarker > 0) body = body.slice(0, junkMarker).trim()
    return body
  }
  const singleLine = text.match(/^summary:\s*(.+)$/im)?.[1]?.trim()
  if (singleLine) return singleLine
  return text.replace(/^summary:\s*/im, '').trim()
}

function parseSessionSummaryEntries(sessionSummaries) {
  const text = normalizeLedgerText(sessionSummaries)
  if (!text) return []

  const entries = []
  const regex =
    /--- session (\d+) summary \(([^)]+)\) ---\r?\n([\s\S]*?)(?=\r?\n--- session \d+ summary|$)/gi
  let match
  while ((match = regex.exec(text))) {
    const scanNumber = Number(match[1])
    const role = match[2].trim()
    const block = match[3].trim()
    entries.push({
      scanNumber,
      role,
      started: block.match(/^started:\s*(.+)$/im)?.[1]?.trim() || '',
      ended: block.match(/^ended:\s*(.+)$/im)?.[1]?.trim() || '',
      duration: block.match(/^duration:\s*(.+)$/im)?.[1]?.trim() || '',
      returnGap: block.match(/^return_gap:\s*(.+)$/im)?.[1]?.trim() || '',
      summary: extractSummaryBodyFromSessionBlock(block),
    })
  }
  return entries.sort((a, b) => a.scanNumber - b.scanNumber)
}

function resolvePastSummaryEntries(thread) {
  const summariesText = normalizeLedgerText(thread?.session_summaries)
  const roleKey = thread?.role === 'receiver' ? 'receiver' : 'sender'

  let entries = parseSessionSummaryEntries(summariesText)
  if (!entries.length && summariesText) {
    logLedger('summary parse retry — column present but no entries parsed', {
      chars: summariesText.length,
      role: roleKey,
    })
  }
  if (!entries.length && thread && !shouldUseConversationFallback(roleKey)) {
    const conversation = normalizeLedgerText(thread.conversation)
    if (conversation) {
      entries = buildInlineDigestEntriesFromConversation(conversation, roleKey)
      if (entries.length) {
        logLedger('inline digests built from ended conversation', {
          scans: entries.map((e) => e.scanNumber),
          role: roleKey,
        })
      }
    }
  }
  return entries
}

const BACKEND_DIGEST_NOTE = MYRA_LEDGER_READING_GUIDE

const MYRA_LORE_REFERENCE = `LORE: MYRA CONCEPT LIBRARY + LORE INTENT (RULE 25) live in system instruction — YOU decide from USER_JUST_SAID; backend does not keyword-route.`

function collectSenderQuotesFromEntries(entries) {
  const quotes = []
  for (const entry of entries) {
    quotes.push(...extractSenderQuotesFromSummary(entry.summary))
  }
  return [...new Set(quotes.map((q) => q.trim()).filter(Boolean))]
}

/** English note/card lines only — slim delivery hint for receiver (no full quote preview). */
function buildEnglishNotesPreviewBlock(senderThread) {
  if (!senderThread) return ''

  const entries = resolvePastSummaryEntries(senderThread).filter(
    (entry) => !/reason:\s*empty_scan/i.test(entry.summary),
  )
  let quotes = collectSenderQuotesFromEntries(entries)

  if (!quotes.length) {
    const conversation = normalizeLedgerText(senderThread?.conversation)
    for (const scanNum of listEndedScanNumbers(conversation)) {
      quotes.push(
        ...extractSenderLinesFromDialogue(extractSessionDialogueByNumber(conversation, scanNum)),
      )
    }
    quotes.push(
      ...extractSenderLinesFromDialogue(
        sanitizeSessionDialogue(extractCurrentSessionConversation(conversation)),
      ),
    )
  }

  quotes = [...new Set(quotes.map((q) => q.trim()).filter(Boolean))]
  const hint = buildEnglishQuotePreserveHint(quotes)
  return hint || ''
}

function formatPastSessionDigestLine(entry) {
  const timing = [
    entry.started ? `started ${entry.started}` : null,
    entry.ended ? `ended ${entry.ended}` : null,
    entry.duration ? `duration ${entry.duration}` : null,
  ]
    .filter(Boolean)
    .join(' — ')
  const gapNote = entry.returnGap ? `\nRETURN GAP (since previous scan): ${entry.returnGap}` : ''
  const header = timing
    ? `SCAN ${entry.scanNumber} — ${entry.role} — ${timing}`
    : `SCAN ${entry.scanNumber} — ${entry.role}`
  return `${header}${gapNote}\n${sanitizeSummaryForMemory(entry.summary)}`
}

/** Gemini memory: past scans = summaries only (or conversation fallback); current scan = live dialogue. */
function buildCompactThreadBlock(label, thread) {
  const conversation = normalizeLedgerText(thread?.conversation)
  const roleKey = thread?.role === 'receiver' ? 'receiver' : 'sender'
  const summaryEntries = resolvePastSummaryEntries(thread)
  const currentDialogue = sanitizeSessionDialogue(extractCurrentSessionConversation(conversation))

  if (!summaryEntries.length && !(currentDialogue && hasDialogueLines(currentDialogue))) return ''

  const lines = [`${label} (ended scans on this thread: ${thread?.scan_count ?? 0}):`]
  const useConversationOnly = shouldUseConversationFallback(roleKey)
  const pastEntries = useConversationOnly
    ? []
    : summaryEntries.filter((entry) => !/reason:\s*empty_scan/i.test(entry.summary))

  if (pastEntries.length) {
    lines.push('')
    lines.push('PAST SCAN SUMMARIES (read using SOUL LEDGER protocol — priority: DIALOGUE DIGEST sender lines):')
    if (roleKey !== 'sender') {
      lines.push('')
      lines.push(BACKEND_DIGEST_NOTE)
    }
    for (const entry of pastEntries) {
      lines.push('')
      lines.push(formatPastSessionDigestLine(entry))
    }
  }

  if (currentDialogue && hasDialogueLines(currentDialogue)) {
    lines.push('')
    lines.push('CURRENT SESSION (full live dialogue this scan only — not yet summarized):')
    lines.push(currentDialogue)
  } else if (!pastEntries.length) {
    lines.push('')
    lines.push('(no chat yet this session)')
  }

  return lines.join('\n')
}

function hasActiveSenderThread(senderThread) {
  if (!senderThread) return false
  return isActiveLedgerThread(senderThread)
}

/** Dashboard / pair logic — row exists ≠ device joined. */
export function isActiveLedgerThread(thread) {
  if (!thread) return false
  return (
    Boolean(String(thread.device_id ?? '').trim()) ||
    (thread.scan_count ?? 0) > 0 ||
    Boolean(String(thread.conversation ?? '').trim())
  )
}

export function countActiveLedgerThreads(threads = []) {
  return threads.filter(isActiveLedgerThread).length
}

async function ensureThreadRows(verificationCode) {
  if (!supabase || !verificationCode) return

  for (const role of ['sender', 'receiver']) {
    const { data: existing, error: readError } = await supabase
      .from(LEDGER_TABLE)
      .select('id')
      .eq('verification_code', verificationCode)
      .eq('role', role)
      .maybeSingle()

    if (readError) {
      console.warn('[Ledger] ensureThreadRows read failed:', readError.message)
      continue
    }

    if (existing) continue

    const { error } = await supabase.from(LEDGER_TABLE).insert({
      verification_code: verificationCode,
      device_id: '',
      role,
      scan_count: 0,
      conversation: '',
      session_summaries: '',
      axerai_ai_usage: '',
      axerai_voice_usage: '',
    })

    if (error) console.warn(`[Ledger] ensureThreadRows insert ${role} failed:`, error.message)
    else logLedger(`Empty ${role} row ready`, { code: verificationCode })
  }
}

function rebuildLedgerMemoryText() {
  const promptSender = threadWithFrozenSummaries(cachedSenderThread, 'sender')
  const promptReceiver = threadWithFrozenSummaries(cachedReceiverThread, 'receiver')
  const previousBlock = buildPreviousConversationBlock(sessionRole, promptSender, promptReceiver)
  const backendSignal = buildBackendScanSignal(ledgerWelcomeMode)
  const code = cachedVerificationCode || 'unknown'
  const activeThread = sessionRole === 'RECEIVER' ? promptReceiver : promptSender
  const recencyLine = buildLastScanRecencyLine(activeThread)

  const englishNotesBlock =
    sessionRole === 'RECEIVER' ? buildEnglishNotesPreviewBlock(promptSender) : ''

  ledgerMemoryText = [
    `Product code: ${code}. Role: ${sessionRole}.`,
    backendSignal,
    recencyLine,
    sessionRole === 'SENDER' ? `\nSOUL LEDGER PROTOCOL (sender collect — scan channel recipe inside):\n${BACKEND_DIGEST_NOTE}` : '',
    '',
    englishNotesBlock,
    previousBlock || '(empty — first conversation on this product code)',
    '',
    MYRA_LORE_REFERENCE,
  ]
    .filter(Boolean)
    .join('\n')

  const pastScans = resolvePastSummaryEntries(
    sessionRole === 'RECEIVER' ? promptReceiver : promptSender,
  ).length
  const senderQuoteCount =
    sessionRole === 'RECEIVER'
      ? collectSenderQuotesFromEntries(
          resolvePastSummaryEntries(cachedSenderThread ?? {}).filter(
            (entry) => !/reason:\s*empty_scan/i.test(entry.summary),
          ),
        ).length
      : collectSenderQuotesFromEntries(
          resolvePastSummaryEntries(cachedSenderThread ?? {}),
        ).length
  logLedger('memory ready', {
    role: sessionRole,
    welcomeMode: ledgerWelcomeMode,
    memoryMode: getLedgerMemoryMode(),
    pastScans,
    senderQuoteCount,
    hasSenderName: /(?:mera\s+naam?|naam\s+\w+\s+hai)/i.test(ledgerMemoryText),
    hasStoryQuotes: senderQuoteCount > 0,
  })
}

/** How long since last ended scan — stops "kiti divas" when user scanned yesterday. */
function buildLastScanRecencyLine(thread) {
  const text = String(thread?.session_summaries ?? '').trim()
  if (!text) return ''

  const ends = [...text.matchAll(/^ended:\s*(.+)$/gim)].map((m) => m[1].trim())
  const last = ends[ends.length - 1]
  if (!last) return ''

  const ended = new Date(last)
  if (Number.isNaN(ended.getTime())) {
    return `LAST SCAN ENDED: ${last}`
  }

  const hours = (Date.now() - ended.getTime()) / 3600000
  if (hours < 0) return `LAST SCAN ENDED: ${last}`

  if (hours < 6) {
    return `RECENCY: same_day (~${Math.max(1, Math.round(hours))}h since last scan) — reunion tone: lightly playful, recently-parted friend energy. No long-absence drama. Invent fresh words.`
  }
  if (hours < 48) {
    return `RECENCY: recent (~${Math.max(1, Math.round(hours))}h since last scan) — reunion tone: warm, familiar, short-gap warmth. Invent fresh words.`
  }
  if (hours < 168) {
    return `RECENCY: within_week (~${Math.max(1, Math.round(hours / 24))}d since last scan) — reunion tone: missed-you warmth, still light. Invent fresh words.`
  }
  return `RECENCY: long_gap (~${Math.max(1, Math.round(hours / 24))}d since last scan) — reunion tone: warmer reconnection, emotional but not heavy. Invent fresh words.`
}

function updateCachedThreadConversation(roleKey, conversation) {
  const trimmed = normalizeLedgerText(conversation)
  if (roleKey === 'sender') {
    cachedSenderThread = cachedSenderThread
      ? { ...cachedSenderThread, conversation: trimmed }
      : {
          conversation: trimmed,
          device_id: getDeviceId(),
          scan_count: activeScanNumber,
        }
  } else {
    cachedReceiverThread = cachedReceiverThread
      ? { ...cachedReceiverThread, conversation: trimmed }
      : {
          conversation: trimmed,
          device_id: getDeviceId(),
          scan_count: activeScanNumber,
        }
  }
  rebuildLedgerMemoryText()
}

async function reloadAndBackfillThreads(verificationCode) {
  if (!supabase || !verificationCode) return

  const { data: threads, error } = await supabase
    .from(LEDGER_TABLE)
    .select('id, verification_code, device_id, role, scan_count, conversation, session_summaries')
    .eq('verification_code', verificationCode)
    .order('role', { ascending: true })

  if (error) {
    console.warn('[Ledger] reload threads failed:', error.message)
    return
  }

  const senderRow = (threads ?? []).find((row) => row.role === 'sender') ?? null
  const receiverRow = (threads ?? []).find((row) => row.role === 'receiver') ?? null

  cachedSenderThread = senderRow ? await backfillMissingSummariesForThread(senderRow, 'sender') : null
  cachedReceiverThread = receiverRow
    ? await backfillMissingSummariesForThread(receiverRow, 'receiver')
    : null
  refreshLedgerWelcomeMode()
  rebuildLedgerMemoryText()
}

export async function prefetchLedgerMemory(verificationCode) {
  sessionRole = 'SENDER'
  ledgerMemoryText = ''
  ledgerWelcomeMode = 'SENDER_FIRST'
  cachedSenderThread = null
  cachedReceiverThread = null
  cachedVerificationCode = verificationCode || ''
  clearSessionMemorySnapshot()

  if (!supabase || !verificationCode) {
    return { allowed: true, role: 'SENDER' }
  }

  const deviceId = getDeviceId()
  await ensureThreadRows(verificationCode)

  const { data: threads, error } = await supabase
    .from(LEDGER_TABLE)
    .select('id, verification_code, device_id, role, scan_count, conversation, session_summaries')
    .eq('verification_code', verificationCode)
    .order('role', { ascending: true })

  if (error) {
    console.warn('[Ledger] prefetch failed:', error.message)
    ledgerMemoryText = `Product code: ${verificationCode}.`
    return { allowed: true, role: 'SENDER', degraded: true }
  }

  const senderThread = (threads ?? []).find((row) => row.role === 'sender') ?? null
  const receiverThread = (threads ?? []).find((row) => row.role === 'receiver') ?? null
  const access = resolveSessionAccess(senderThread, receiverThread, deviceId)

  if (!access.allowed) {
    cachedSenderThread = senderThread
    cachedReceiverThread = receiverThread
    logLedger('PAIR FULL — third device rejected', {
      code: verificationCode,
      device: deviceId.slice(0, 8) + '…',
      sender: String(senderThread?.device_id ?? '').slice(0, 8) + '…',
      receiver: String(receiverThread?.device_id ?? '').slice(0, 8) + '…',
    })
    void recordLedgerInsight(verificationCode, 'pair_full', deviceId.slice(0, 16))
    return { allowed: false, reason: 'PAIR_FULL' }
  }

  sessionRole = access.role

  if (sessionRole === 'RECEIVER') {
    logLedger('RECEIVER device', {
      yourDevice: deviceId.slice(0, 8) + '…',
      senderDevice: String(senderThread?.device_id ?? '').slice(0, 8) + '…',
    })
  } else {
    logLedger('SENDER device', { device: deviceId.slice(0, 8) + '…' })
  }

  const sealedSender = await sealOpenThreadSession(senderThread, 'sender')
  const sealedReceiver = await sealOpenThreadSession(receiverThread, 'receiver')

  cachedSenderThread = sealedSender
  cachedReceiverThread = sealedReceiver
  refreshLedgerWelcomeMode()
  rebuildLedgerMemoryText()

  const activeThread = sessionRole === 'RECEIVER' ? sealedReceiver : sealedSender
  const activeRoleKey = sessionRole === 'RECEIVER' ? 'receiver' : 'sender'

  logLedger('prefetch OK', {
    code: verificationCode,
    role: sessionRole,
    scanNumber: activeThread?.scan_count ?? 0,
    welcomeMode: ledgerWelcomeMode,
    needsSummaryBackfill: threadNeedsSummaryBackfill(activeThread, activeRoleKey),
    missingSummaryScans: listScansMissingSummary(activeThread, activeRoleKey),
    memoryMode: threadNeedsSummaryBackfill(activeThread, activeRoleKey)
      ? 'conversation-first'
      : 'summary-ready',
    senderLines: parseConversationLines(sealedSender?.conversation).length,
    receiverLines: parseConversationLines(sealedReceiver?.conversation).length,
    senderPastSummaries: parseSessionSummaryEntries(sealedSender?.session_summaries).length,
    receiverPastSummaries: parseSessionSummaryEntries(sealedReceiver?.session_summaries).length,
  })

  return { allowed: true, role: sessionRole }
}

async function appendSessionMarker(markerLine) {
  if (!supabase || !activeThreadId) return false

  const roleKey = roleKeyFromSession()
  const cached = getCachedLedgerThread(roleKey)
  let previous = String(cached?.conversation ?? '').trim()

  if (!previous) {
    const { data: row, error: readError } = await supabase
      .from(LEDGER_TABLE)
      .select('conversation')
      .eq('id', activeThreadId)
      .single()
    if (readError) return false
    previous = String(row?.conversation ?? '').trim()
  }

  if (previous.endsWith(markerLine)) return true

  const next = previous ? `${previous}\n${markerLine}` : markerLine
  const { error } = await supabase
    .from(LEDGER_TABLE)
    .update({ conversation: next })
    .eq('id', activeThreadId)

  if (error) return false
  updateCachedThreadConversation(roleKey, next)
  return true
}

export async function startLedgerScan(verificationCode) {
  if (!supabase || !verificationCode) return null

  // Wait for in-flight pagehide finish so we don't open session 2 on half-saved session 1.
  if (ledgerFinishPromise) {
    try {
      await ledgerFinishPromise
    } catch {
      // ignore — seal below still covers orphan sessions
    }
  }

  const deviceId = getDeviceId()
  const roleKey = roleKeyFromSession()
  activeStartedAt = Date.now()
  activeVerificationCode = verificationCode

  const { data: existing, error: readError } = await supabase
    .from(LEDGER_TABLE)
    .select('id, scan_count, device_id, conversation, session_summaries')
    .eq('verification_code', verificationCode)
    .eq('role', roleKey)
    .maybeSingle()

  if (readError) {
    console.warn('[Ledger] thread read failed:', readError.message)
    return null
  }

  if (existing) {
    const claimedDevice = String(existing.device_id ?? '').trim()
    // Race guard: receiver/sender seat already taken by another phone
    if (claimedDevice && claimedDevice !== deviceId) {
      logLedger('PAIR FULL — seat already claimed', {
        code: verificationCode,
        role: roleKey,
        claimed: claimedDevice.slice(0, 8) + '…',
        you: deviceId.slice(0, 8) + '…',
      })
      void recordLedgerInsight(verificationCode, 'pair_full', deviceId.slice(0, 16))
      return { rejected: true, reason: 'PAIR_FULL' }
    }

    // Seal orphan session before writing the next start marker.
    const sealed = await sealOpenThreadSession(existing, roleKey)
    if (roleKey === 'sender') cachedSenderThread = { ...(cachedSenderThread ?? {}), ...sealed }
    else cachedReceiverThread = { ...(cachedReceiverThread ?? {}), ...sealed }
    refreshLedgerWelcomeMode()
    rebuildLedgerMemoryText()

    const scanNumber = (sealed.scan_count ?? existing.scan_count ?? 0) + 1
  activeScanNumber = scanNumber

    const { error } = await supabase
      .from(LEDGER_TABLE)
      .update({
        scan_count: scanNumber,
        device_id: deviceId,
      })
      .eq('id', existing.id)

    if (error) {
      console.error('[Ledger] thread update failed:', error.message, error)
      activeThreadId = null
      return null
    }

    activeThreadId = existing.id
    resetExperienceViewTotals()
    await appendSessionMarker(`--- session ${scanNumber} start ---`)
    rebuildLedgerMemoryText()
    logLedger(`Scan ${scanNumber} resumed`, { code: verificationCode, threadId: activeThreadId, role: roleKey })
    return { scanId: activeThreadId, scanNumber }
  }

  const { data, error } = await supabase
    .from(LEDGER_TABLE)
    .insert({
      verification_code: verificationCode,
      device_id: deviceId,
      role: roleKey,
      scan_count: 1,
      conversation: '',
      session_summaries: '',
      axerai_ai_usage: '',
      axerai_voice_usage: '',
    })
    .select('id')
    .single()

  if (error) {
    console.error('[Ledger] thread create failed:', error.message, error)
    activeThreadId = null
    return null
  }

  activeThreadId = data.id
  activeScanNumber = 1
  resetExperienceViewTotals()
  await appendSessionMarker('--- session 1 start ---')
  logLedger('Thread created', { code: verificationCode, threadId: activeThreadId, role: roleKey })
  return { scanId: activeThreadId, scanNumber: 1 }
}

export async function appendLedgerMessage(role, text) {
  if (!supabase) {
    console.warn('[Ledger] message skipped — Supabase not configured')
    return false
  }
  if (!activeThreadId) {
    console.warn('[Ledger] message skipped — no active thread (startLedgerScan failed?)')
    return false
  }

  const body = String(text ?? '').trim()
  if (!body) return false

  const speaker = speakerLabelForRole(role)
  const line = `${speaker}: ${body.slice(0, 4000)}`

  const roleKey = roleKeyFromSession()
  const cached = getCachedLedgerThread(roleKey)
  let previous = String(cached?.conversation ?? '').trim()

  if (!previous) {
    const { data: row, error: readError } = await supabase
      .from(LEDGER_TABLE)
      .select('conversation')
      .eq('id', activeThreadId)
      .single()

    if (readError) {
      console.error('[Ledger] read conversation failed:', readError.message)
      return false
    }
    previous = String(row?.conversation ?? '').trim()
  }

  if (speaker === 'myra' && isOfflineMyraFallback(body)) {
    logLedger('offline fallback skipped — not saved to ledger')
    return true
  }

  const next = previous ? `${previous}\n${line}` : line

  const { error } = await supabase
    .from(LEDGER_TABLE)
    .update({
      conversation: next,
    })
    .eq('id', activeThreadId)

  if (error) {
    console.error('[Ledger] append failed:', error.message, error)
    return false
  }

  updateCachedThreadConversation(roleKeyFromSession(), next)
  logLedger('line appended', { speaker, threadId: activeThreadId, chars: body.length })
  return true
}

export async function finishLedgerScan(options = {}) {
  if (!supabase || !activeThreadId) return
  if (ledgerFinishPromise) return ledgerFinishPromise

  const fastExit = options.fastExit === true

  ledgerFinishPromise = (async () => {
    const threadId = activeThreadId
    const endedAt = Date.now()
    const durationSeconds = Math.max(1, Math.round((endedAt - activeStartedAt) / 1000))
    const roleKey = roleKeyFromSession()
    const scanNumber = activeScanNumber

    const { data: row, error: readError } = await supabase
      .from(LEDGER_TABLE)
      .select('conversation, session_summaries')
      .eq('id', threadId)
      .single()

    if (readError) {
      console.warn('[Ledger] finish read failed:', readError.message)
      return
    }

    const conversationBeforeFooter = String(row?.conversation ?? '').trim()
    const previousSummaries = String(row?.session_summaries ?? '').trim()

    // Already sealed by next-scan prefetch (or prior finish) — don't duplicate.
    if (
      hasEndFooterForScan(conversationBeforeFooter, scanNumber) &&
      hasSummaryForScan(previousSummaries, scanNumber)
    ) {
      logLedger('finish skipped — session already sealed', { scanNumber, role: roleKey, fastExit })
      activeThreadId = null
      activeScanNumber = 0
      activeVerificationCode = ''
      activeStartedAt = 0
      clearSessionMemorySnapshot()
      return
    }

    const sessionDialogue = sanitizeSessionDialogue(
      extractCurrentSessionConversation(conversationBeforeFooter),
    )

    // pagehide/tab close: local summary only (Gemini is too slow and often never saves).
    let summary
    let praise
    let axeraiPraise = { detected: false, quote: '' }
    let source
    if (fastExit || hasSummaryForScan(previousSummaries, scanNumber)) {
      const local = buildSummaryFromConversation(
        '',
        roleKey,
        sessionDialogue,
        previousSummaries,
      )
      summary = hasSummaryForScan(previousSummaries, scanNumber) ? '' : local.summary
      praise = local.praise
      axeraiPraise = local.axeraiPraise
      source = hasSummaryForScan(previousSummaries, scanNumber) ? 'already' : 'fast-local'
    } else {
      ;({ summary, praise, axeraiPraise, source } = await buildSessionSummaryAndPraise({
        sessionDialogue,
        roleKey,
        scanNumber,
        previousSummaries,
      }))
    }

    if (summary) {
      logLedger('session summary saved', {
        scanNumber,
        role: roleKey,
        chars: summary.length,
        brandPraise: praise.detected,
        axeraiPraise: axeraiPraise.detected,
        source,
        fastExit,
      })
    }

    const returnGap = buildReturnGapMessage({
      roleKey,
      scanNumber,
      startedAt: activeStartedAt || endedAt,
      previousSummaries,
    })

    const footer = hasEndFooterForScan(conversationBeforeFooter, scanNumber)
      ? ''
      : buildSessionConversationFooter({
          scanNumber,
          startedAt: activeStartedAt || endedAt,
          endedAt,
          durationSeconds,
          praise,
          viewTimes: takeExperienceViewTotals(),
        })

    const conversationWithFooter = footer
      ? conversationBeforeFooter
        ? `${conversationBeforeFooter}\n${footer}`
        : footer
      : conversationBeforeFooter

    let nextSummaries = previousSummaries
    if (summary && !hasSummaryForScan(previousSummaries, scanNumber)) {
      const summaryEntry = buildSessionSummaryEntry({
        scanNumber,
        startedAt: activeStartedAt || endedAt,
        endedAt,
        durationSeconds,
        roleKey,
        summary,
        praise,
        axeraiPraise,
        returnGap,
      })
      nextSummaries = previousSummaries ? `${previousSummaries}\n\n${summaryEntry}` : summaryEntry
    }

    const { error } = await supabase
      .from(LEDGER_TABLE)
      .update({
        conversation: conversationWithFooter,
        session_summaries: nextSummaries,
      })
      .eq('id', threadId)

    if (error) console.warn('[Ledger] finish thread failed:', error.message)
    else {
      logLedger(`Thread saved`, { scanNumber, durationSeconds, praise: praise.detected, fastExit })
      const roleKeyCache = roleKey
      if (roleKeyCache === 'sender' && cachedSenderThread) {
        cachedSenderThread = {
          ...cachedSenderThread,
          conversation: conversationWithFooter,
          session_summaries: nextSummaries,
        }
      } else if (roleKeyCache === 'receiver' && cachedReceiverThread) {
        cachedReceiverThread = {
          ...cachedReceiverThread,
          conversation: conversationWithFooter,
          session_summaries: nextSummaries,
        }
      }
      rebuildLedgerMemoryText()
    }

    activeThreadId = null
    activeScanNumber = 0
    activeVerificationCode = ''
    activeStartedAt = 0
    clearSessionMemorySnapshot()
  })()

  try {
    await ledgerFinishPromise
  } finally {
    ledgerFinishPromise = null
  }
}

export function getActiveScanNumber() {
  return activeScanNumber
}

/** Full context for Gemini — browser snapshot first; no per-turn Supabase reload. */
export function buildGeminiMemoryText(_options = {}) {
  ensureBrowserMemoryForPrompt()
  rebuildLedgerMemoryText()
  return ledgerMemoryText
}

/** Reload from DB only when forced — default uses frozen browser snapshot. */
export async function refreshLedgerMemoryForPrompt(options = {}) {
  const forceNetwork = options.forceNetwork === true
  if (!forceNetwork && sessionMemorySnapshot) {
    rebuildLedgerMemoryText()
    return ledgerMemoryText
  }

  const syncBackfill = options.syncBackfill !== false
  const code = cachedVerificationCode || activeVerificationCode
  if (!code) {
    rebuildLedgerMemoryText()
    return ledgerMemoryText
  }

  if (summaryBackfillPromise) {
    try {
      await summaryBackfillPromise
    } catch {
      /* background backfill failure — chat may still proceed on conversation-only memory */
    }
  }

  if (syncBackfill) {
    await reloadAndBackfillThreads(code)
  } else {
    await reloadThreadsFromDb(code)
  }

  if (options.captureSnapshot === true) {
    captureSessionMemorySnapshot()
  }
  return ledgerMemoryText
}

/** After exit/finish — keep in-memory ledger aligned with DB for next scan. */
export function syncLedgerMemoryAfterExit() {
  clearSessionMemorySnapshot()
  refreshLedgerWelcomeMode()
  rebuildLedgerMemoryText()
}

/** Append one Axerai AI token usage row to the active (or matching) ledger thread. */
export async function recordGeminiUsage({
  callType,
  model = 'unknown',
  promptTokens = 0,
  outputTokens = 0,
  totalTokens = 0,
  scanNumber = null,
  verificationCode = null,
}) {
  if (!supabase) return false

  const prompt = Math.max(0, Math.round(Number(promptTokens) || 0))
  const output = Math.max(0, Math.round(Number(outputTokens) || 0))
  const total = Math.max(0, Math.round(Number(totalTokens) || 0)) || prompt + output
  if (total <= 0 && prompt <= 0 && output <= 0) return false

  const code = String(verificationCode ?? activeVerificationCode ?? cachedVerificationCode ?? 'R').trim()
  const roleKey = roleKeyFromSession()
  const scan = scanNumber ?? (activeScanNumber > 0 ? activeScanNumber : null)

  const entry = JSON.stringify({
    at: new Date().toISOString(),
    call: String(callType ?? 'unknown').slice(0, 24),
    scan,
    model: String(model).slice(0, 80),
    prompt,
    output,
    total,
  })

  let threadId = activeThreadId

  if (!threadId) {
    const { data: row, error: lookupError } = await supabase
      .from(LEDGER_TABLE)
      .select('id, axerai_ai_usage')
      .eq('verification_code', code)
      .eq('role', roleKey)
      .maybeSingle()

    if (lookupError || !row?.id) {
      logLedger('axerai ai usage skipped — thread row missing', { code, role: roleKey, call: callType })
      return false
    }

    const previous = String(row.axerai_ai_usage ?? '').trim()
    const next = previous ? `${previous}\n${entry}` : entry
    const { error } = await supabase
      .from(LEDGER_TABLE)
      .update({ axerai_ai_usage: next })
      .eq('id', row.id)

    if (error) {
      console.warn('[Ledger] axerai ai usage save failed:', error.message)
      return false
    }

    logLedger('axerai ai usage saved', { call: callType, total, model, scan, code })
    return true
  }

  const { data: row, error: readError } = await supabase
    .from(LEDGER_TABLE)
    .select('axerai_ai_usage')
    .eq('id', threadId)
    .single()

  if (readError) {
    console.warn('[Ledger] axerai ai usage read failed:', readError.message)
    return false
  }

  const previous = String(row?.axerai_ai_usage ?? '').trim()
  const next = previous ? `${previous}\n${entry}` : entry
  const { error } = await supabase
    .from(LEDGER_TABLE)
    .update({ axerai_ai_usage: next })
    .eq('id', threadId)

  if (error) {
    console.warn('[Ledger] axerai ai usage save failed:', error.message)
    return false
  }

  logLedger('axerai ai usage saved', { call: callType, total, model, scan, code })
  return true
}

/** Append one Axerai voice token usage row (TTS characters) to the active ledger thread. */
export async function recordElevenLabsUsage({
  characters = 0,
  model = 'eleven_v3',
  voiceId = '',
  callType = 'tts',
  scanNumber = null,
  verificationCode = null,
}) {
  if (!supabase) return false

  const chars = Math.max(0, Math.round(Number(characters) || 0))
  if (chars <= 0) return false

  const code = String(verificationCode ?? activeVerificationCode ?? cachedVerificationCode ?? 'R').trim()
  const roleKey = roleKeyFromSession()
  const scan = scanNumber ?? (activeScanNumber > 0 ? activeScanNumber : null)

  const entry = JSON.stringify({
    at: new Date().toISOString(),
    call: String(callType ?? 'tts').slice(0, 24),
    scan,
    model: String(model).slice(0, 80),
    voice: String(voiceId || '').slice(0, 64),
    chars,
    total: chars,
  })

  let threadId = activeThreadId

  if (!threadId) {
    const { data: row, error: lookupError } = await supabase
      .from(LEDGER_TABLE)
      .select('id, axerai_voice_usage')
      .eq('verification_code', code)
      .eq('role', roleKey)
      .maybeSingle()

    if (lookupError || !row?.id) {
      logLedger('axerai voice usage skipped — thread row missing', { code, role: roleKey, call: callType })
      return false
    }

    const previous = String(row.axerai_voice_usage ?? '').trim()
    const next = previous ? `${previous}\n${entry}` : entry
    const { error } = await supabase
      .from(LEDGER_TABLE)
      .update({ axerai_voice_usage: next })
      .eq('id', row.id)

    if (error) {
      console.warn('[Ledger] axerai voice usage save failed:', error.message)
      return false
    }

    logLedger('axerai voice usage saved', { call: callType, chars, model, scan, code })
    return true
  }

  const { data: row, error: readError } = await supabase
    .from(LEDGER_TABLE)
    .select('axerai_voice_usage')
    .eq('id', threadId)
    .single()

  if (readError) {
    console.warn('[Ledger] axerai voice usage read failed:', readError.message)
    return false
  }

  const previous = String(row?.axerai_voice_usage ?? '').trim()
  const next = previous ? `${previous}\n${entry}` : entry
  const { error } = await supabase
    .from(LEDGER_TABLE)
    .update({ axerai_voice_usage: next })
    .eq('id', threadId)

  if (error) {
    console.warn('[Ledger] axerai voice usage save failed:', error.message)
    return false
  }

  logLedger('axerai voice usage saved', { call: callType, chars, model, scan, code })
  return true
}

export function parseElevenLabsUsageEntries(elevenUsageText) {
  const lines = String(elevenUsageText ?? '')
    .trim()
    .split('\n')
    .filter(Boolean)
  const entries = []

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line)
      const chars = Number(parsed.chars ?? parsed.total ?? 0) || 0
      entries.push({
        at: parsed.at ?? '',
        call: parsed.call ?? 'tts',
        scan: parsed.scan ?? null,
        model: parsed.model ?? 'eleven_v3',
        voice: parsed.voice ?? '',
        characters: chars,
        totalTokens: chars,
        threadRole: parsed.threadRole ?? null,
      })
    } catch {
      // skip malformed lines
    }
  }

  return entries
}

/** Sum Axerai voice tokens across sender + receiver threads for dashboard. */
export function buildElevenLabsUsageAnalytics(threads = []) {
  const entries = []
  let totalCharacters = 0

  for (const thread of threads) {
    for (const entry of parseElevenLabsUsageEntries(thread.axerai_voice_usage)) {
      const row = { ...entry, threadRole: thread.role }
      entries.push(row)
      totalCharacters += entry.characters
    }
  }

  entries.sort((a, b) => Date.parse(a.at || '') - Date.parse(b.at || ''))

  return {
    totalCharacters,
    totalTokens: totalCharacters,
    entries,
    callCount: entries.length,
  }
}

export function parseGeminiUsageEntries(geminiUsageText) {
  const lines = String(geminiUsageText ?? '')
    .trim()
    .split('\n')
    .filter(Boolean)
  const entries = []

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line)
      entries.push({
        at: parsed.at ?? '',
        call: parsed.call ?? 'unknown',
        scan: parsed.scan ?? null,
        model: parsed.model ?? 'unknown',
        promptTokens: Number(parsed.prompt ?? 0) || 0,
        outputTokens: Number(parsed.output ?? 0) || 0,
        totalTokens: Number(parsed.total ?? 0) || 0,
        threadRole: parsed.threadRole ?? null,
      })
    } catch {
      // skip malformed lines
    }
  }

  return entries
}

/** Sum Axerai AI tokens across sender + receiver threads for dashboard. */
export function buildGeminiUsageAnalytics(threads = []) {
  const entries = []
  let totalTokens = 0
  let promptTokens = 0
  let outputTokens = 0
  const byCall = {
    verify: 0,
    chat: 0,
    welcome: 0,
    summary: 0,
    other: 0,
  }

  for (const thread of threads) {
    for (const entry of parseGeminiUsageEntries(thread.axerai_ai_usage)) {
      const row = { ...entry, threadRole: thread.role }
      entries.push(row)
      totalTokens += entry.totalTokens
      promptTokens += entry.promptTokens
      outputTokens += entry.outputTokens

      const callKey = String(entry.call ?? '').toLowerCase()
      if (callKey in byCall) byCall[callKey] += entry.totalTokens
      else byCall.other += entry.totalTokens
    }
  }

  entries.sort((a, b) => Date.parse(a.at || '') - Date.parse(b.at || ''))

  return {
    totalTokens,
    promptTokens,
    outputTokens,
    byCall,
    entries,
    callCount: entries.length,
  }
}

const LEDGER_INSIGHTS_SELECT =
  'id, verification_code, device_id, role, scan_count, conversation, session_summaries, axerai_ai_usage, axerai_voice_usage, ledger_insights'

const LEDGER_INSIGHTS_SELECT_FALLBACK =
  'id, verification_code, device_id, role, scan_count, conversation, session_summaries, axerai_ai_usage, axerai_voice_usage'

export function emptyLedgerInsightCounts() {
  return {
    verify_fail_photo_spoof: 0,
    verify_fail_bad_frame: 0,
    verify_fail_no_richera: 0,
    verify_fail_other: 0,
    verify_fail_glitch: 0,
    pair_full_attempt: 0,
  }
}

/** Parse `ledger_insights` lines written by recordLedgerInsight. */
export function parseLedgerInsights(raw) {
  const counts = emptyLedgerInsightCounts()
  for (const line of String(raw ?? '').split('\n')) {
    const trimmed = line.trim()
    const match = trimmed.match(/^insight:([^|]+)\|([^|]*)\|/)
    if (!match) continue
    const kind = match[1].trim()
    const detail = match[2].trim()
    if (kind === 'verify_fail') {
      if (detail === 'PHOTO_SPOOF') counts.verify_fail_photo_spoof += 1
      else if (detail === 'BAD_FRAME') counts.verify_fail_bad_frame += 1
      else if (detail === 'NO_RICHERA') counts.verify_fail_no_richera += 1
      else counts.verify_fail_other += 1
    } else if (kind === 'verify_glitch') {
      counts.verify_fail_glitch += 1
    } else if (kind === 'pair_full') {
      counts.pair_full_attempt += 1
    }
  }
  return counts
}

function mergeLedgerInsightCounts(into, from) {
  for (const key of Object.keys(into)) {
    into[key] += Number(from[key] ?? 0)
  }
}

/** Security / verify metrics — stored on sender row for the product code. */
export async function recordLedgerInsight(verificationCode, kind, detail = '') {
  if (!supabase || !verificationCode || !kind) return false

  const code = String(verificationCode).trim()
  const insightKind = String(kind).trim()
  const insightDetail = String(detail ?? '').trim().slice(0, 120)
  const line = `insight:${insightKind}|${insightDetail}|${new Date().toISOString()}`

  await ensureThreadRows(code)

  const { data: sender, error: readError } = await supabase
    .from(LEDGER_TABLE)
    .select('id, ledger_insights')
    .eq('verification_code', code)
    .eq('role', 'sender')
    .maybeSingle()

  if (readError) {
    if (!/ledger_insights/i.test(readError.message)) {
      console.warn('[Ledger] insight read failed:', readError.message)
    }
    return false
  }

  if (!sender?.id) return false

  const previous = String(sender.ledger_insights ?? '').trim()
  const next = previous ? `${previous}\n${line}` : line

  const { error: updateError } = await supabase
    .from(LEDGER_TABLE)
    .update({ ledger_insights: next })
    .eq('id', sender.id)

  if (updateError) {
    if (!/ledger_insights/i.test(updateError.message)) {
      console.warn('[Ledger] insight save failed:', updateError.message)
    }
    return false
  }

  if (cachedSenderThread?.id === sender.id) {
    cachedSenderThread = { ...cachedSenderThread, ledger_insights: next }
  }

  logLedger('insight recorded', { code, kind: insightKind, detail: insightDetail })
  return true
}

export async function fetchDashboardThreads(verificationCode = 'R') {
  if (!supabase) return []

  let { data, error } = await supabase
    .from(LEDGER_TABLE)
    .select(LEDGER_INSIGHTS_SELECT)
    .eq('verification_code', verificationCode)
    .order('role', { ascending: true })

  if (error && /ledger_insights/i.test(error.message)) {
    ;({ data, error } = await supabase
      .from(LEDGER_TABLE)
      .select(LEDGER_INSIGHTS_SELECT_FALLBACK)
      .eq('verification_code', verificationCode)
      .order('role', { ascending: true }))
  }

  if (error) {
    console.warn('[Ledger] dashboard fetch failed:', error.message)
    return []
  }

  return (data ?? []).map((row) => ({
    ...row,
    ledger_insights: row.ledger_insights ?? '',
  }))
}

/** Parse conversation text into bubble rows for dashboard UI. */
export function parseConversationForDashboard(conversation) {
  return parseConversationLines(conversation).map((line, index) => ({
    speaker: line.speaker,
    text: line.text,
    key: `${line.speaker}-${index}`,
  }))
}

function parseDurationToSeconds(durationText) {
  const text = String(durationText ?? '').trim().toLowerCase()
  if (!text) return 0

  let total = 0
  const minMatch = text.match(/(\d+)\s*min/)
  if (minMatch) total += Number(minMatch[1]) * 60

  const secMatch = text.match(/(\d+)\s*(?:s|sec|seconds?)\b/)
  if (secMatch) total += Number(secMatch[1])

  if (!minMatch && /^\d+\s*seconds?$/.test(text)) {
    total = Number(text.match(/(\d+)/)[1])
  }

  return total
}

export function formatDashboardDuration(totalSeconds) {
  const seconds = Math.max(0, Math.round(Number(totalSeconds) || 0))
  if (seconds < 60) return `${seconds}s`
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`
}

/** Rich per-scan rows from session_summaries column. */
export function parseSessionSummaryDetails(sessionSummaries) {
  const text = String(sessionSummaries ?? '').trim()
  if (!text) return []

  const entries = []
  const regex = /--- session (\d+) summary \(([^)]+)\) ---\n([\s\S]*?)(?=\n--- session \d+ summary|$)/gi
  let match
  while ((match = regex.exec(text))) {
    const scanNumber = Number(match[1])
    const role = match[2].trim()
    const block = match[3].trim()
    const date = block.match(/^date:\s*(.+)$/m)?.[1]?.trim() ?? ''
    const durationText = block.match(/^duration:\s*(.+)$/m)?.[1]?.trim() ?? ''
    const returnGap = block.match(/^return_gap:\s*(.+)$/m)?.[1]?.trim() ?? ''
    const brandPraiseMatch =
      block.match(/^brand_praise:\s*"(.*)"\s*$/m) || block.match(/^praise:\s*"(.*)"\s*$/m)
    const axeraiPraiseMatch = block.match(/^axerai_praise:\s*"(.*)"\s*$/m)
    const summary = extractSummaryBodyFromSessionBlock(block)
    const brandPraise = parseBrandProductPraise(summary)
    const axeraiPraise = parseAxeraiPraiseFromSummary(summary)
    const discovery = parseDiscoveryFromSummary(summary)
    const brandPraiseQuote = brandPraiseMatch?.[1]?.trim() || brandPraise.quote || ''
    const axeraiPraiseQuote = axeraiPraiseMatch?.[1]?.trim() || axeraiPraise.quote || ''
    const storyBody = extractStoryFromSummary(summary)
    const dashboardQuote = extractDashboardQuoteFromSummary(summary)
    const userSaidMatch = summary.match(
      /USER SAID:\s*\n([\s\S]*?)(?=\n\nMYRA SAID:|\n\nBRAND PRODUCT PRAISE:|$)/i,
    )
    const legacyUserMatch = !userSaidMatch
      ? summary.match(
          /(?:SENDER|RECEIVER) SAID:\s*\n([\s\S]*?)(?=\n\nMYRA SAID:|\n\nBRAND PRODUCT PRAISE:|\n\nFACTS TO REMEMBER:|$)/i,
        )
      : null
    const legacyUserSaid = (userSaidMatch?.[1] ?? legacyUserMatch?.[1] ?? '')
      .split('\n')
      .map((line) => line.replace(/^(sender|receiver):\s*/i, '').replace(/^\d+\.\s*/, '').trim())
      .filter(Boolean)
      .join(' | ')
    // Prefer sender quotes / praise / discovery for dashboard; fall back to legacy STORY.
    const userSaid = dashboardQuote || storyBody || legacyUserSaid

    entries.push({
      scanNumber,
      role,
      date,
      durationText,
      durationSeconds: parseDurationToSeconds(durationText),
      returnGap,
      praiseDetected: Boolean(brandPraiseQuote) || brandPraise.detected,
      praiseQuote: brandPraiseQuote,
      brandPraiseQuote,
      axeraiPraiseDetected: Boolean(axeraiPraiseQuote) || axeraiPraise.detected,
      axeraiPraiseQuote,
      discoveryDetected: discovery.detected,
      discoveryQuote: discovery.quote || '',
      userSaid,
      summary,
    })
  }

  return entries.sort((a, b) => a.scanNumber - b.scanNumber)
}

/** Per-scan rows parsed from conversation footers (fallback / merge). */
export function parseSessionRecordsFromConversation(conversation, roleKey = 'sender') {
  const text = String(conversation ?? '')
  if (!text.trim()) return []

  const userSpeaker = roleKey === 'receiver' ? 'receiver' : 'sender'
  const records = []
  const blockRegex =
    /--- session (\d+) start ---\n([\s\S]*?)--- session \1 end ---\n([\s\S]*?)(?=--- session \d+ start ---|$)/gi
  let match
  while ((match = blockRegex.exec(text))) {
    const scanNumber = Number(match[1])
    const dialogue = match[2]
    const footer = match[3]
    const started = footer.match(/^session-started:\s*(.+)$/m)?.[1]?.trim() ?? ''
    const ended = footer.match(/^session-ended:\s*(.+)$/m)?.[1]?.trim() ?? ''
    const durationText = footer.match(/^session-duration:\s*(.+)$/m)?.[1]?.trim() ?? ''
    const praiseMatch = footer.match(/^session-praise:\s*"(.*)"\s*$/m)
    const praiseQuote = praiseMatch?.[1]?.trim() ?? ''
    const viewTimes = parseExperienceViewSecondsFromFooter(footer)
    const userLines = parseConversationLines(dialogue)
      .filter((line) => line.speaker === userSpeaker)
      .map((line) => line.text)

    records.push({
      scanNumber,
      role: roleKey === 'receiver' ? 'Receiver' : 'Sender',
      date: ended || started,
      started,
      ended,
      durationText,
      durationSeconds: parseDurationToSeconds(durationText),
      praiseDetected: Boolean(praiseQuote),
      praiseQuote,
      arViewSeconds: viewTimes.arSeconds,
      vrViewSeconds: viewTimes.vrSeconds,
      overviewViewSeconds: viewTimes.overviewSeconds,
      userSaid: userLines.join(' | '),
    })
  }

  return records.sort((a, b) => a.scanNumber - b.scanNumber)
}

/** Aggregate stats + merged per-scan table rows for dashboard. */
export function buildDashboardAnalytics(threads = []) {
  const sessions = []

  for (const thread of threads) {
    const roleKey = thread.role === 'receiver' ? 'receiver' : 'sender'
    const fromConversation = parseSessionRecordsFromConversation(thread.conversation, roleKey)
    const fromSummaries = parseSessionSummaryDetails(thread.session_summaries)
    const byScan = new Map()

    for (const row of fromConversation) {
      byScan.set(row.scanNumber, {
        ...row,
        threadRole: roleKey,
        threadId: thread.id,
      })
    }

    for (const row of fromSummaries) {
      const existing = byScan.get(row.scanNumber) ?? {}
      byScan.set(row.scanNumber, {
        ...existing,
        ...row,
        threadRole: roleKey,
        threadId: thread.id,
        userSaid: row.userSaid || existing.userSaid || '',
        returnGap: row.returnGap || existing.returnGap || '',
        praiseDetected: row.praiseDetected || existing.praiseDetected,
        praiseQuote: row.brandPraiseQuote || row.praiseQuote || existing.praiseQuote || '',
        brandPraiseQuote:
          row.brandPraiseQuote || row.praiseQuote || existing.brandPraiseQuote || existing.praiseQuote || '',
        axeraiPraiseDetected: row.axeraiPraiseDetected || existing.axeraiPraiseDetected,
        axeraiPraiseQuote: row.axeraiPraiseQuote || existing.axeraiPraiseQuote || '',
        discoveryDetected: row.discoveryDetected || existing.discoveryDetected,
        discoveryQuote: row.discoveryQuote || existing.discoveryQuote || '',
        durationSeconds: row.durationSeconds || existing.durationSeconds || 0,
        arViewSeconds: row.arViewSeconds || existing.arViewSeconds || 0,
        vrViewSeconds: row.vrViewSeconds || existing.vrViewSeconds || 0,
        overviewViewSeconds: row.overviewViewSeconds || existing.overviewViewSeconds || 0,
        date: row.date || existing.date || existing.ended || '',
      })
    }

    for (const row of byScan.values()) sessions.push(row)
  }

  sessions.sort((a, b) => {
    const aTime = Date.parse(a.date || a.ended || '') || 0
    const bTime = Date.parse(b.date || b.ended || '') || 0
    if (aTime !== bTime) return aTime - bTime
    return a.scanNumber - b.scanNumber
  })

  const totalScans = threads.reduce((sum, thread) => sum + (thread.scan_count ?? 0), 0)
  const totalTalkTimeSeconds = sessions.reduce((sum, row) => sum + (row.durationSeconds ?? 0), 0)
  const senderTalkTimeSeconds = sessions
    .filter((row) => row.threadRole === 'sender')
    .reduce((sum, row) => sum + (row.durationSeconds ?? 0), 0)
  const receiverTalkTimeSeconds = sessions
    .filter((row) => row.threadRole === 'receiver')
    .reduce((sum, row) => sum + (row.durationSeconds ?? 0), 0)
  const senderScanCount =
    threads.find((thread) => thread.role === 'sender')?.scan_count ?? 0
  const receiverScanCount =
    threads.find((thread) => thread.role === 'receiver')?.scan_count ?? 0
  const totalArViewSeconds = sessions.reduce((sum, row) => sum + (row.arViewSeconds ?? 0), 0)
  const totalVrViewSeconds = sessions.reduce((sum, row) => sum + (row.vrViewSeconds ?? 0), 0)
  const totalOverviewViewSeconds = sessions.reduce(
    (sum, row) => sum + (row.overviewViewSeconds ?? 0),
    0,
  )
  const positiveCount = sessions.filter((row) => row.brandPraiseQuote || row.praiseQuote).length
  const axeraiPraiseCount = sessions.filter((row) => row.axeraiPraiseQuote).length
  const brandPraiseQuotes = sessions
    .filter((row) => row.brandPraiseQuote || row.praiseQuote)
    .map((row) => ({
      scanNumber: row.scanNumber,
      role: row.threadRole,
      quote: row.brandPraiseQuote || row.praiseQuote,
    }))

  const axeraiPraiseQuotes = sessions
    .filter((row) => row.axeraiPraiseQuote)
    .map((row) => ({
      scanNumber: row.scanNumber,
      role: row.threadRole,
      quote: row.axeraiPraiseQuote,
    }))

  const praiseQuotes = brandPraiseQuotes

  const discoveryQuotes = sessions
    .filter((row) => row.discoveryQuote)
    .map((row) => ({
      scanNumber: row.scanNumber,
      role: row.threadRole,
      quote: row.discoveryQuote,
    }))

  const lastSession = sessions[sessions.length - 1]
  const lastScanDate = lastSession?.date || lastSession?.ended || ''

  const insightTotals = emptyLedgerInsightCounts()
  for (const thread of threads) {
    if (thread.role !== 'sender') continue
    mergeLedgerInsightCounts(insightTotals, parseLedgerInsights(thread.ledger_insights))
  }

  const verifyFailPhotoSpoof = insightTotals.verify_fail_photo_spoof
  const verifyFailOther =
    insightTotals.verify_fail_bad_frame +
    insightTotals.verify_fail_no_richera +
    insightTotals.verify_fail_other +
    insightTotals.verify_fail_glitch
  const pairFullAttempts = insightTotals.pair_full_attempt

  return {
    totalScans,
    totalTalkTimeSeconds,
    senderTalkTimeSeconds,
    receiverTalkTimeSeconds,
    senderScanCount,
    receiverScanCount,
    totalArViewSeconds,
    totalVrViewSeconds,
    totalOverviewViewSeconds,
    positiveCount,
    axeraiPraiseCount,
    praiseQuotes,
    brandPraiseQuotes,
    axeraiPraiseQuotes,
    discoveryQuotes,
    lastScanDate,
    sessions,
    insightTotals,
    verifyFailPhotoSpoof,
    verifyFailOther,
    pairFullAttempts,
  }
}

/**
 * @temporary FORENSIC DEBUG ONLY — seed module state for RECEIVER_FIRST payload dump.
 * Used by scripts/dump-receiver-first-gemini-payload.mjs — safe to remove after inspection.
 */
export function debugSeedAndBuildReceiverFirstMemory({
  verificationCode = 'R',
  senderSessionSummaries = '',
} = {}) {
  sessionRole = 'RECEIVER'
  ledgerWelcomeMode = 'RECEIVER_FIRST'
  cachedVerificationCode = verificationCode
  activeVerificationCode = verificationCode
  activeScanNumber = 1
  cachedSenderThread = {
    id: 'debug-sender-thread',
    role: 'sender',
    verification_code: verificationCode,
    device_id: 'debug-sender-device-id',
    scan_count: 1,
    conversation: '--- session 1 start ---\n--- session 1 end ---',
    session_summaries: senderSessionSummaries,
  }
  cachedReceiverThread = {
    id: 'debug-receiver-thread',
    role: 'receiver',
    verification_code: verificationCode,
    device_id: '',
    scan_count: 0,
    conversation: '',
    session_summaries: '',
  }
  sessionMemorySnapshot = null
  captureSessionMemorySnapshot()
  rebuildLedgerMemoryText()
  return ledgerMemoryText
}

/** @deprecated Use fetchDashboardThreads — kept for compatibility */
export async function fetchDashboardScans(verificationCode = 'R') {
  const threads = await fetchDashboardThreads(verificationCode)
  return threads.map((thread) => ({
    id: thread.id,
    verification_code: thread.verification_code,
    device_id: thread.device_id,
    scan_number: thread.scan_count,
    session_role: thread.role?.toUpperCase(),
    conversation: thread.conversation,
    session_summaries: thread.session_summaries,
  }))
}
