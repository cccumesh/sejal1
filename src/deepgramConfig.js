/** Shared Deepgram STT settings (batch + live WebSocket). */

export const DEFAULT_DEEPGRAM_MODEL = 'nova-3'
export const DEFAULT_DEEPGRAM_LANGUAGE = 'multi'

export const DEFAULT_DEEPGRAM_KEYTERMS = [
  'Chetan',
  'Sejal',
  'Myra',
  'Richera',
  'Axerai',
  'naam',
  'mera',
  'meri',
  'girlfriend',
  'bracelet',
  'birthday',
  'occasion',
  'Jalgaon',
  'Mohadi',
  'Shirsoli',
  'Mehfil',
  'sunflower',
  'Hinglish',
  'Sejal ke liye',
  'gift',
].join(',')

export function parseKeytermList(raw = '') {
  const source = String(raw ?? '').trim() || DEFAULT_DEEPGRAM_KEYTERMS
  return source
    .split(/[,;\n]+/)
    .map((term) => term.trim())
    .filter(Boolean)
}

export function appendDeepgramKeyterms(params, rawKeyterms) {
  for (const term of parseKeytermList(rawKeyterms)) {
    params.append('keyterm', term)
  }
}

export function readDeepgramModel() {
  return String(import.meta.env.VITE_DEEPGRAM_MODEL ?? DEFAULT_DEEPGRAM_MODEL).trim() || DEFAULT_DEEPGRAM_MODEL
}

export function readDeepgramLanguage() {
  return (
    String(import.meta.env.VITE_DEEPGRAM_LANGUAGE ?? DEFAULT_DEEPGRAM_LANGUAGE).trim() ||
    DEFAULT_DEEPGRAM_LANGUAGE
  )
}

export function pickRecorderMimeType() {
  if (typeof MediaRecorder === 'undefined') return ''
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/aac',
    'audio/ogg;codecs=opus',
  ]
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return mime
  }
  return ''
}
