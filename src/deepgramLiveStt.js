import { USE_API_PROXY } from './apiProxy.js'
import {
  appendDeepgramKeyterms,
  pickRecorderMimeType,
  readDeepgramLanguage,
  readDeepgramModel,
} from './deepgramConfig.js'
import { isAppleMobileBrowser } from './mobileBrowser.js'

const GRANT_PROXY_PATH = '/.netlify/functions/deepgram-grant'
const GRANT_DEV_PATH = '/api/deepgram-grant'
const WS_OPEN_MS = 10000
const RECORDER_SLICE_MS = 250

export function isDeepgramLiveSttSupported() {
  return typeof WebSocket !== 'undefined' && typeof MediaRecorder !== 'undefined'
}

/** iPhone: disable autoGainControl — reduces speaker/mic session ducking during STT. */
export function sttAudioConstraints() {
  const apple = isAppleMobileBrowser()
  return {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: !apple,
  }
}

async function fetchListenGrant() {
  const url = USE_API_PROXY ? GRANT_PROXY_PATH : GRANT_DEV_PATH
  const response = await fetch(url, { method: 'POST' })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload.error ?? `Deepgram grant HTTP ${response.status}`)
  }
  if (!payload.token) {
    throw new Error('Deepgram grant missing token')
  }
  return payload
}

function buildListenUrl({ model, language, keyterms }) {
  const params = new URLSearchParams({
    model: model || readDeepgramModel(),
    language: language || readDeepgramLanguage(),
    smart_format: 'true',
    punctuate: 'true',
    interim_results: 'true',
    utterance_end_ms: '1200',
    endpointing: '450',
    vad_events: 'true',
  })
  appendDeepgramKeyterms(params, keyterms)
  return `wss://api.deepgram.com/v1/listen?${params}`
}

function waitForSocketOpen(ws, timeoutMs = WS_OPEN_MS) {
  if (ws.readyState === WebSocket.OPEN) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('Deepgram live socket open timeout'))
    }, timeoutMs)

    const onOpen = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error('Deepgram live socket error'))
    }
    const cleanup = () => {
      clearTimeout(timer)
      ws.removeEventListener('open', onOpen)
      ws.removeEventListener('error', onError)
    }

    ws.addEventListener('open', onOpen)
    ws.addEventListener('error', onError)
  })
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

function closeListenSocket(ws) {
  if (!ws) return
  try {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'CloseStream' }))
    }
  } catch {
    // ignore
  }
  try {
    ws.close()
  } catch {
    // ignore
  }
}

/**
 * Deepgram Nova live WebSocket — low-latency Hinglish vs batch blob polling.
 * Same surface as batch createLiveMicTranscriber for App.jsx.
 */
export function createLiveStreamingTranscriber({ onTranscript, onError, onListening }) {
  let stream = null
  let ownsStream = false
  let recorder = null
  let mimeType = ''
  let ws = null
  let stopped = false
  let finalizedText = ''
  let latestInterim = ''
  let grant = null

  function emitTranscript({ speechFinal = false } = {}) {
    if (stopped) return
    const display = `${finalizedText}${finalizedText && latestInterim ? ' ' : ''}${latestInterim}`
      .replace(/\s+/g, ' ')
      .trim()
    if (!display) return
    const isFinal = !latestInterim
    onTranscript?.({
      transcript: display,
      isFinal: isFinal || speechFinal,
      speechFinal: Boolean(speechFinal),
    })
  }

  function handleSocketMessage(event) {
    if (stopped) return
    let payload
    try {
      payload = JSON.parse(String(event.data ?? ''))
    } catch {
      return
    }

    if (payload.type === 'UtteranceEnd') {
      latestInterim = ''
      emitTranscript({ speechFinal: true })
      return
    }

    if (payload.type !== 'Results') return

    const alt = payload.channel?.alternatives?.[0]
    const piece = String(alt?.transcript ?? '').trim()
    if (!piece) return

    if (payload.is_final) {
      finalizedText = `${finalizedText} ${piece}`.replace(/\s+/g, ' ').trim()
      latestInterim = ''
      emitTranscript({ speechFinal: Boolean(payload.speech_final) })
    } else {
      latestInterim = piece
      emitTranscript()
    }
  }

  async function openListenSocket() {
    if (!grant) {
      grant = await fetchListenGrant()
    }

    const socket = new WebSocket(
      buildListenUrl({
        model: grant.model,
        language: grant.language,
        keyterms: grant.keyterms,
      }),
      ['token', grant.token],
    )

    socket.addEventListener('message', handleSocketMessage)
    socket.addEventListener('error', () => {
      onError?.(new Error('Deepgram live socket error'))
    })

    await waitForSocketOpen(socket)
    ws = socket
  }

  function startRecorder() {
    if (!stream?.active || stopped) return
    mimeType = pickRecorderMimeType()
    recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
    recorder.ondataavailable = (event) => {
      if (stopped || !event.data?.size) return
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(event.data)
      }
    }
    recorder.onerror = (event) => {
      onError?.(event.error ?? new Error('MediaRecorder error'))
    }
    recorder.start(RECORDER_SLICE_MS)
    onListening?.(true)
  }

  return {
    async start(existingStream = null) {
      stopped = false
      finalizedText = ''

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

      await openListenSocket()
      startRecorder()
    },

    resetSegment() {
      finalizedText = ''
      latestInterim = ''
      void (async () => {
        await stopRecorder(recorder)
        recorder = null
        closeListenSocket(ws)
        ws = null
        if (stopped || !stream?.active) return
        try {
          await openListenSocket()
          startRecorder()
        } catch (error) {
          onError?.(error)
        }
      })()
    },

    async finalize() {
      closeListenSocket(ws)
      ws = null
      await stopRecorder(recorder)
      recorder = null
      return { transcript: finalizedText.trim(), confidence: 0, duration: 0 }
    },

    abort() {
      stopped = true
      void stopRecorder(recorder)
      recorder = null
      closeListenSocket(ws)
      ws = null
      finalizedText = ''
      onListening?.(false)
    },

    stop() {
      this.abort()
      if (ownsStream) {
        stream?.getTracks().forEach((track) => track.stop())
      }
      stream = null
      ownsStream = false
      grant = null
    },
  }
}
