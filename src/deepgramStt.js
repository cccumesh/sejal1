import { USE_API_PROXY } from './apiProxy.js'
import {
  appendDeepgramKeyterms,
  pickRecorderMimeType,
  readDeepgramLanguage,
  readDeepgramModel,
} from './deepgramConfig.js'
import {
  createLiveStreamingTranscriber,
  isDeepgramLiveSttSupported,
  sttAudioConstraints,
} from './deepgramLiveStt.js'

const DEEPGRAM_PROXY_PATH = '/.netlify/functions/deepgram-stt'
const DEEPGRAM_DEV_PROXY_PATH = '/api/deepgram-stt'
/** Batch fallback only — live stream preferred when WebSocket available. */
const BATCH_INTERIM_MS = 2400
const MIN_BLOB_BYTES = 900

export { isDeepgramLiveSttSupported, sttAudioConstraints }

/** TEMPORARY: false = Deepgram on. true = browser Web Speech only (en-IN live mic). */
export const DEEPGRAM_TEMPORARILY_DISABLED = true

export function isDeepgramSttConfigured() {
  if (DEEPGRAM_TEMPORARILY_DISABLED) return false
  const enabled = String(import.meta.env.VITE_DEEPGRAM_ENABLED ?? '').trim().toLowerCase() === 'true'
  if (!enabled) return false
  if (USE_API_PROXY) return true
  return Boolean(String(import.meta.env.VITE_DEEPGRAM_API_KEY ?? '').trim())
}

export function isDeepgramSttSupported() {
  return typeof MediaRecorder !== 'undefined' && typeof fetch !== 'undefined'
}

export async function transcribeAudioBlob(blob, { signal } = {}) {
  if (!blob || blob.size < MIN_BLOB_BYTES) {
    return { transcript: '', confidence: 0, duration: 0 }
  }

  const url = USE_API_PROXY ? DEEPGRAM_PROXY_PATH : DEEPGRAM_DEV_PROXY_PATH
  const mimeType = blob.type || 'application/octet-stream'

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': mimeType },
    body: blob,
    signal,
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload.error ?? `Deepgram STT HTTP ${response.status}`)
  }

  return {
    transcript: String(payload.transcript ?? '').trim(),
    confidence: Number(payload.confidence ?? 0),
    duration: Number(payload.duration ?? 0),
  }
}

function stopRecorder(recorder) {
  if (!recorder || recorder.state === 'inactive') return Promise.resolve()
  return new Promise((resolve) => {
    recorder.addEventListener('stop', resolve, { once: true })
    try {
      recorder.stop()
    } catch {
      resolve()
    }
  })
}

/** Batch live mic — fallback when WebSocket live stream unavailable. */
function createBatchLiveMicTranscriber({ onTranscript, onError, onListening }) {
  let stream = null
  let ownsStream = false
  let recorder = null
  let chunks = []
  let mimeType = ''
  let interimTimer = null
  let inFlight = false
  let stopped = false
  let lastTranscript = ''

  function clearInterimTimer() {
    if (interimTimer) {
      clearInterval(interimTimer)
      interimTimer = null
    }
  }

  async function runTranscription(finalPass = false) {
    if (inFlight || stopped || chunks.length === 0) return null
    const blob = new Blob(chunks, { type: mimeType || 'audio/webm' })
    if (blob.size < MIN_BLOB_BYTES) return null

    inFlight = true
    try {
      const result = await transcribeAudioBlob(blob)
      const transcript = result.transcript
      if (transcript && (finalPass || transcript !== lastTranscript)) {
        lastTranscript = transcript
        onTranscript?.({ transcript, isFinal: finalPass, speechFinal: finalPass })
      }
      return result
    } catch (error) {
      onError?.(error)
      return null
    } finally {
      inFlight = false
    }
  }

  function startRecorder() {
    if (!stream?.active || stopped) return
    chunks = []
    lastTranscript = ''
    mimeType = pickRecorderMimeType()
    recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
    recorder.ondataavailable = (event) => {
      if (event.data?.size) chunks.push(event.data)
    }
    recorder.onerror = (event) => {
      onError?.(event.error ?? new Error('MediaRecorder error'))
    }
    recorder.start(300)
    onListening?.(true)
    clearInterimTimer()
    interimTimer = setInterval(() => {
      void runTranscription(false)
    }, BATCH_INTERIM_MS)
  }

  return {
    async start(existingStream = null) {
      stopped = false
      if (existingStream?.active) {
        stream = existingStream
        ownsStream = false
      } else {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: sttAudioConstraints(),
          video: false,
        })
        ownsStream = true
      }
      if (!isDeepgramSttSupported()) {
        throw new Error('MediaRecorder not supported in this browser')
      }
      startRecorder()
    },

    resetSegment() {
      void (async () => {
        await stopRecorder(recorder)
        recorder = null
        if (!stopped && stream?.active) startRecorder()
      })()
    },

    async finalize() {
      clearInterimTimer()
      await stopRecorder(recorder)
      recorder = null
      return runTranscription(true)
    },

    abort() {
      stopped = true
      clearInterimTimer()
      void stopRecorder(recorder)
      recorder = null
      chunks = []
      lastTranscript = ''
      onListening?.(false)
    },

    stop() {
      this.abort()
      if (ownsStream) {
        stream?.getTracks().forEach((track) => track.stop())
      }
      stream = null
      ownsStream = false
    },
  }
}

/**
 * Live mic STT — prefers Deepgram WebSocket stream; batch blob polling as fallback.
 */
export function createLiveMicTranscriber(options) {
  if (!isDeepgramLiveSttSupported()) {
    return createBatchLiveMicTranscriber(options)
  }

  const live = createLiveStreamingTranscriber(options)
  const batch = createBatchLiveMicTranscriber(options)
  let active = live
  let mode = 'live'

  const wrap = (method) => (...args) => active[method](...args)

  return {
    async start(existingStream) {
      try {
        await live.start(existingStream)
        active = live
        mode = 'live'
        console.info('[Deepgram] Live mic — WebSocket stream')
      } catch (error) {
        console.warn('[Deepgram] Live stream failed, using batch fallback:', error)
        await batch.start(existingStream)
        active = batch
        mode = 'batch'
        console.info('[Deepgram] Live mic — batch fallback')
      }
    },
    resetSegment: wrap('resetSegment'),
    finalize: wrap('finalize'),
    abort: wrap('abort'),
    stop: wrap('stop'),
    getMode: () => mode,
  }
}

/** Hold-to-talk — record while pressed, transcribe on release. */
export function createPttTranscriber() {
  let recorder = null
  let chunks = []
  let stream = null
  let mimeType = ''

  return {
    async start() {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: sttAudioConstraints(),
        video: false,
      })
      mimeType = pickRecorderMimeType()
      chunks = []
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      recorder.ondataavailable = (event) => {
        if (event.data?.size) chunks.push(event.data)
      }
      recorder.start(200)
    },

    async stopAndTranscribe() {
      await stopRecorder(recorder)
      recorder = null
      stream?.getTracks().forEach((track) => track.stop())
      stream = null
      const blob = new Blob(chunks, { type: mimeType || 'audio/webm' })
      chunks = []
      if (blob.size < MIN_BLOB_BYTES) return ''
      const { transcript } = await transcribeAudioBlob(blob)
      return transcript
    },

    abort() {
      void stopRecorder(recorder)
      recorder = null
      stream?.getTracks().forEach((track) => track.stop())
      stream = null
      chunks = []
    },
  }
}

export function buildDeepgramListenParams() {
  const params = new URLSearchParams({
    model: readDeepgramModel(),
    language: readDeepgramLanguage(),
    smart_format: 'true',
    punctuate: 'true',
  })
  appendDeepgramKeyterms(params, import.meta.env.VITE_DEEPGRAM_KEYTERMS)
  return params
}
