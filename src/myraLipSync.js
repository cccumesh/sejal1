import { isAppleMobileBrowser } from './mobileBrowser.js'

let audioCtx = null
let analyser = null
let sourceNode = null
let sourceElement = null
let dataArray = null
let rafId = null
let mouthLevel = 0
let speechActive = false
let syntheticPhase = 0

let playbackGainNode = null
let ttsOutputGain = 1
let recordDestination = null
let recordDestinationLinked = false

function linkRecordDestination() {
  if (!playbackGainNode || !recordDestination || recordDestinationLinked) return
  playbackGainNode.connect(recordDestination)
  recordDestinationLinked = true
}

function unlinkRecordDestination() {
  if (!playbackGainNode || !recordDestination || !recordDestinationLinked) return
  try {
    playbackGainNode.disconnect(recordDestination)
  } catch {
    /* ignore */
  }
  recordDestinationLinked = false
}

/** Tap Myra TTS output for reel recording (non-iOS Web Audio path). */
export function getTtsRecordingStream() {
  if (!ensureAudioGraph()) return null
  if (!recordDestination) {
    recordDestination = audioCtx.createMediaStreamDestination()
  }
  linkRecordDestination()
  audioCtx.resume().catch(() => {})
  return recordDestination.stream
}

export function releaseTtsRecordingStream() {
  unlinkRecordDestination()
}

function ensureAudioGraph() {
  if (audioCtx) return true
  const Ctx = window.AudioContext || window.webkitAudioContext
  if (!Ctx) return false

  audioCtx = new Ctx()
  analyser = audioCtx.createAnalyser()
  analyser.fftSize = 512
  analyser.smoothingTimeConstant = 0.45
  playbackGainNode = audioCtx.createGain()
  playbackGainNode.gain.value = ttsOutputGain
  analyser.connect(playbackGainNode)
  playbackGainNode.connect(audioCtx.destination)
  dataArray = new Uint8Array(analyser.frequencyBinCount)
  return true
}

/** TTS playback gain — 1.0 = normal. HTML audio caps at 1.0; Web Audio boost only when > 1. */
export function setTtsPlaybackGain(value) {
  const next = Number(value)
  ttsOutputGain = Number.isFinite(next) ? Math.min(3, Math.max(1, next)) : 1
  if (playbackGainNode) playbackGainNode.gain.value = ttsOutputGain
}

function measureAudioLevel() {
  if (!analyser || !dataArray) return 0

  // Prefer mid speech frequencies for mouth open amount (0 silent → 1 loud).
  analyser.getByteFrequencyData(dataArray)
  const n = dataArray.length
  const start = Math.floor(n * 0.08)
  const end = Math.floor(n * 0.55)
  let sum = 0
  let count = 0
  for (let i = start; i < end; i += 1) {
    sum += dataArray[i]
    count += 1
  }
  const avg = count ? sum / count / 255 : 0
  // Map voice energy to 0..1 shape-key influence.
  return Math.min(1, Math.max(0, (avg - 0.04) * 1.55))
}

function proceduralMouthLevel() {
  syntheticPhase += 0.24
  return 0.12 + Math.abs(Math.sin(syntheticPhase)) * 0.68
}

function tickLipSync() {
  if (speechActive) {
    const audioLevel = measureAudioLevel()
    const target = audioLevel > 0.06 ? audioLevel : proceduralMouthLevel()
    mouthLevel += (target - mouthLevel) * 0.38
  } else {
    mouthLevel += (0 - mouthLevel) * 0.22
  }

  rafId = window.requestAnimationFrame(tickLipSync)
}

function startTicker() {
  if (rafId != null) return
  rafId = window.requestAnimationFrame(tickLipSync)
}

function stopTicker() {
  if (rafId == null) return
  window.cancelAnimationFrame(rafId)
  rafId = null
}

export function getMyraMouthLevel() {
  return mouthLevel
}

export function startSpeechLipSync() {
  speechActive = true
  syntheticPhase = 0
  // iOS: skip Web Audio graph — it can steal the audio session from TTS playback.
  if (!isAppleMobileBrowser()) {
    ensureAudioGraph()
    audioCtx?.resume().catch(() => {})
  }
  startTicker()
}

export function stopSpeechLipSync() {
  speechActive = false
  syntheticPhase = 0
  mouthLevel = 0
  stopTicker()
}

export function connectTtsAudio(audioEl) {
  if (!audioEl) return

  // Safari/iOS: play through <audio> only — Web Audio routing can cause echo on some devices.
  if (isAppleMobileBrowser()) {
    startSpeechLipSync()
    return
  }

  if (!ensureAudioGraph()) return

  audioCtx.resume().catch(() => {})

  if (sourceElement !== audioEl) {
    if (sourceNode) {
      try {
        sourceNode.disconnect()
      } catch {
        // ignore
      }
      sourceNode = null
    }
    sourceElement = audioEl
    try {
      sourceNode = audioCtx.createMediaElementSource(audioEl)
      sourceNode.connect(analyser)
    } catch (error) {
      console.warn('[Myra] TTS audio hook failed — using procedural lip sync', error)
    }
  }

  startSpeechLipSync()
}

export function disconnectTtsAudio() {
  if (sourceNode) {
    try {
      sourceNode.disconnect()
    } catch {
      // ignore
    }
    sourceNode = null
  }
  sourceElement = null
}

/** @deprecated use startSpeechLipSync */
export function startSyntheticLipSync() {
  startSpeechLipSync()
}

/** @deprecated use stopSpeechLipSync */
export function stopSyntheticLipSync() {
  stopSpeechLipSync()
}
