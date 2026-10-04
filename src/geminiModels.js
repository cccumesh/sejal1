/** Shared Gemini model routing — one API key, task-specific chains with retry/fallback. */

export const GEMINI_LITE_PRIMARY = 'gemini-3.5-flash-lite'
export const GEMINI_LITE_FALLBACK = 'gemini-3.1-flash-lite'
export const GEMINI_FLASH_PRIMARY = 'gemini-3.6-flash'

/** Full Flash (3.6) — one attempt, then fall through to flash-lite chain. */
export const GEMINI_RETRIES_FULL_FLASH = 1
export const GEMINI_RETRIES_LITE = 2

export function geminiRetriesForModel(modelName) {
  if (String(modelName ?? '').trim() === GEMINI_FLASH_PRIMARY) {
    return GEMINI_RETRIES_FULL_FLASH
  }
  return GEMINI_RETRIES_LITE
}

/** Lite chain — verify, post-verify opening, sender chat, summary, receiver fallback. */
export const GEMINI_LITE_CHAIN = [GEMINI_LITE_PRIMARY, GEMINI_LITE_FALLBACK]

/** Every scan after verify — scan 1, 2, 3… sender OR receiver welcome/resume opening. */
export const OPENING_AFTER_VERIFY_MODEL_CHAIN = GEMINI_LITE_CHAIN

export const VERIFY_MODEL_CHAIN = GEMINI_LITE_CHAIN
export const WELCOME_MODEL_CHAIN = OPENING_AFTER_VERIFY_MODEL_CHAIN
export const SENDER_CHAT_MODEL_CHAIN = GEMINI_LITE_CHAIN
export const SUMMARY_MODEL_CHAIN = GEMINI_LITE_CHAIN

/** Receiver mid-chat (turn 2+ after opening) — 3.6 Flash → lite on quota/limit. */
export const RECEIVER_CHAT_MODEL_CHAIN = [GEMINI_FLASH_PRIMARY, ...GEMINI_LITE_CHAIN]

/** @deprecated aliases */
export const GEMINI_CHAT_PRIMARY = GEMINI_LITE_PRIMARY
export const GEMINI_CHAT_FALLBACK = GEMINI_LITE_FALLBACK
export const MYRA_CHAT_LITE_CHAIN = GEMINI_LITE_CHAIN
export const MYRA_CHAT_FLASH_CHAIN = RECEIVER_CHAT_MODEL_CHAIN

export const MYRA_FLASH_GENERATION = { temperature: 0.95, topP: 0.95, topK: 40 }
export const MYRA_LITE_GENERATION = { temperature: 0.85, topP: 0.88, topK: 32 }

export function myraGenerationConfig(tier = 'lite') {
  return tier === 'flash' ? MYRA_FLASH_GENERATION : MYRA_LITE_GENERATION
}

/** Receiver mid-chat length buckets — models + prompt hints (sender untouched). */
export const RECEIVER_TURN_SHORT = 'short'
export const RECEIVER_TURN_NORMAL = 'normal'
export const RECEIVER_TURN_DEEP = 'deep'

const SHORT_ACK_PATTERN =
  /^(ha+h?a?|haan|han|ji+h?|yes|yep|yeah|yup|no|na+h?i?|nope|nah|ok(ay)?|k+|hmm+|hm+|achha|accha|theek|thik|sahi|ya+|arre|oye|hii+|hi+|hello|bye|thanks|thank you)$/i

/** Classify recipient reply — short ha/na vs normal vs deep (conversation-aware, not keyword-only). */
export function classifyReceiverTurnBucket(userText = '') {
  const text = String(userText ?? '').trim()
  if (!text) return RECEIVER_TURN_SHORT

  const words = text.split(/\s+/).filter(Boolean)
  const wordCount = words.length
  const normalized = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (wordCount <= 4) {
    if (SHORT_ACK_PATTERN.test(normalized)) return RECEIVER_TURN_SHORT
    if (wordCount <= 2 && text.length <= 22) return RECEIVER_TURN_SHORT
    if (/^(ha+\s*(na|nahi)?|na+\s*(hi)?|nahi+\s*(yaar|re)?)$/i.test(normalized)) {
      return RECEIVER_TURN_SHORT
    }
  }

  const deepByLength = wordCount >= 26
  const deepByIntent =
    /aur bata|detail me|poori kahani|suna(oo)? mujhe|samjha(o)?|matlab kya|kyu |kyon |please|ro rahi|ro raha|bahut|itna sab/i.test(
      text,
    )
  if (deepByLength || deepByIntent || (wordCount >= 14 && text.includes('?'))) {
    return RECEIVER_TURN_DEEP
  }

  return RECEIVER_TURN_NORMAL
}

const RECEIVER_MAX_OUTPUT_TOKENS = {
  [RECEIVER_TURN_SHORT]: 130,
  [RECEIVER_TURN_NORMAL]: 380,
  [RECEIVER_TURN_DEEP]: 650,
}

export function myraChatGenerationConfig(tier = 'lite', { receiverTurnBucket } = {}) {
  const base = myraGenerationConfig(tier)
  const bucket = String(receiverTurnBucket ?? '').trim()
  const cap = RECEIVER_MAX_OUTPUT_TOKENS[bucket]
  if (!cap) return base
  return { ...base, maxOutputTokens: cap }
}

/**
 * Chat model pick:
 * - isOpeningAfterVerify → lite always (sender/receiver, scan 1 or return scan N)
 * - sender mid-chat → lite only
 * - receiver mid-chat short (ha/na) → lite only
 * - receiver mid-chat normal/deep → 3.6 Flash → lite fallback
 */
export function resolveMyraChatModels({
  sessionRole = '',
  isWelcome = false,
  isOpeningAfterVerify = false,
  userText = '',
} = {}) {
  const role = String(sessionRole ?? '')
    .trim()
    .toUpperCase()

  if (isOpeningAfterVerify || isWelcome) {
    return {
      models: OPENING_AFTER_VERIFY_MODEL_CHAIN,
      tier: 'lite',
      reason: 'opening-after-verify-lite',
    }
  }

  if (role === 'SENDER') {
    return {
      models: SENDER_CHAT_MODEL_CHAIN,
      tier: 'lite',
      reason: 'sender-lite',
    }
  }

  if (role === 'RECEIVER') {
    const bucket = classifyReceiverTurnBucket(userText)
    if (bucket === RECEIVER_TURN_SHORT) {
      return {
        models: GEMINI_LITE_CHAIN,
        tier: 'lite',
        reason: 'receiver-short-lite',
        receiverTurnBucket: bucket,
      }
    }
    return {
      models: RECEIVER_CHAT_MODEL_CHAIN,
      tier: 'flash',
      reason: bucket === RECEIVER_TURN_DEEP ? 'receiver-deep-flash' : 'receiver-3.6-flash',
      receiverTurnBucket: bucket,
    }
  }

  return {
    models: GEMINI_LITE_CHAIN,
    tier: 'lite',
    reason: 'lite-default',
  }
}
