import React, { useRef, useEffect, useState, useCallback } from 'react'
import { AmbientLight, DirectionalLight, Clock } from 'three'
import { MindARThree } from 'mind-ar/dist/mindar-image-three.prod.js'
import { askGeminiViaProxy, USE_API_PROXY } from './apiProxy.js'
import {
  classifyGeminiError,
  getMyraErrorTriggerNote,
  isOfflineMyraFallback,
  MYRA_ERROR_PHASE,
  MYRA_ERROR_SITUATIONS,
  pickMyraErrorLine,
  resetMyraErrorLineMemory,
  shouldSpeakMyraError,
} from './myraErrorFallback.js'
import {
  getMyraSystemPrompt,
  buildMyraUserPrompt,
  myraResponseShouldEndSession,
  clearMyraSession,
  getOpeningLiveContext,
  startLiveContextRefresh,
  getMyraChatTurnCount,
  incrementMyraChatTurn,
  markBootComplete,
  prepareMyraLedgerText,
  prepareMyraSpeechText,
  registerProductScan,
  resetMyraChatTurns,
  resolveMyraOpeningPromptType,
} from './myraPrompt.js'
import { MyraStaticSession } from './myraStaticSession.jsx'
import {
  geminiRetriesForModel,
  MYRA_CHAT_LITE_CHAIN,
  myraGenerationConfig,
  resolveMyraChatModels,
} from './geminiModels.js'
import {
  ensureMobileAudioUnlocked,
  isElevenLabsConfigured,
  isCloudTtsConfigured,
  isInworldTtsConfigured,
  shouldKeepMyraTtsAudioTags,
  getActiveTtsProvider,
  playQueuedTtsFromUserGesture,
  primeSafariSpeechSynthesis,
  prepareApplePlaybackAfterMic,
  pauseAppleUnlockLoop,
  speakBrowserTtsAuto,
  speakWithElevenLabs,
  unlockMobileSpeechAudio,
  stopElevenLabsSpeech,
  waitForMyraSpeechToFinish,
  setMyraVoiceOutputPath,
} from './elevenLabsTts.js'
import {
  isAndroidBrowser,
  isAppleMobileBrowser,
  isIOSChromeLike,
} from './mobileBrowser.js'
import { MyraModel, tickMyraMixer, MYRA_MODEL_PATH } from './myraModel.js'
import { mountTargetAnchorVideo } from './myraTargetVideo.js'
import { loadAxeraiExperienceAssets } from './axeraiAssets.js'
import {
  isGeminiVerifyConfigured,
  RICHERA_VERIFICATION_CODE,
  VERIFY_FAIL_REASON,
  verifyRicheraProduct,
} from './myraVerify.js'
import { startSpeechLipSync, stopSpeechLipSync } from './myraLipSync.js'
import { usageFromResponse } from './geminiUsage.js'
import {
  ReelRecordDockControl,
  ReelTrimSheet,
  useReelRecordUi,
} from './ReelRecordHud.jsx'
import {
  appendLedgerMessage,
  buildGeminiMemoryText,
  finishLedgerScan,
  getSessionRole,
  getLedgerWelcomeMode,
  getLedgerSessionInfo,
  isLedgerConfigured,
  isLedgerScanActive,
  recordLedgerInsight,
  ledgerNeedsSummaryBackfill,
  prefetchLedgerMemory,
  prepareBrowserMemoryForSession,
  probeLedgerHealth,
  recordGeminiUsage,
  startLedgerScan,
  syncLedgerMemoryAfterExit,
} from './myraLedger.js'
import { syncExperienceViewBucket } from './myraExperienceView.js'
import {
  createLiveMicTranscriber,
  createPttTranscriber,
  DEEPGRAM_TEMPORARILY_DISABLED,
  isDeepgramSttConfigured,
  isDeepgramSttSupported,
  sttAudioConstraints,
} from './deepgramStt.js'

const GEMINI_API_KEY = String(import.meta.env.VITE_GEMINI_API_KEY ?? '').trim()
let geminiClient = null

async function getGeminiClient() {
  if (USE_API_PROXY || !GEMINI_API_KEY) return null
  if (!geminiClient) {
    const { GoogleGenerativeAI } = await import('@google/generative-ai')
    geminiClient = new GoogleGenerativeAI(GEMINI_API_KEY)
  }
  return geminiClient
}

function isGeminiConfigured() {
  return USE_API_PROXY || Boolean(GEMINI_API_KEY)
}

function logAxeraiBuildConfig() {
  const geminiOk = isGeminiConfigured()
  const elevenOk = isElevenLabsConfigured()
  const deepgramOk = isDeepgramSttConfigured()
  const ledgerOk = isLedgerConfigured()
  console.info(
    `[Axerai] Runtime — Gemini: ${geminiOk ? (USE_API_PROXY ? 'proxy' : 'local key') : 'MISSING'}, STT: ${deepgramOk ? (USE_API_PROXY ? 'Deepgram live+batch' : 'Deepgram local') : 'Web Speech'}, ElevenLabs: ${elevenOk ? (USE_API_PROXY ? 'proxy' : 'local key') : 'browser TTS'}, Supabase: ${ledgerOk ? 'yes' : 'MISSING'}, host: ${window.location.hostname}`,
  )
  if (DEEPGRAM_TEMPORARILY_DISABLED) {
    console.info('[Axerai] Deepgram TEMP OFF — live mic + PTT use browser Web Speech (en-IN)')
  }
  if (ledgerOk) {
    void probeLedgerHealth()
  } else {
    console.warn('[Axerai] Ledger OFF — add VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY to .env and restart npm run dev.')
  }
  if (import.meta.env.PROD && USE_API_PROXY) {
    console.info('[Axerai] API keys are server-side via Netlify Functions — not exposed in browser bundle.')
  }
  if (!geminiOk) {
    console.warn(
      '[Axerai] Gemini missing — local: VITE_GEMINI_API_KEY in .env | Netlify: GEMINI_API_KEY (Functions scope), no VITE_GEMINI on Netlify.',
    )
  }
}
const MINDAR_TARGET = '/targets.mind'
const INTRO_LOADING_BG = '/images/richera-loading.png'
/** Roman Hinglish transcript — hi-IN returns Devanagari (अ आ) on most phones */
const SPEECH_RECO_LANG = 'en-IN'
/** After transcript text stops changing, offer send (user can tap text to fix first) */
const LIVE_MIC_SILENCE_MS = 2800
/** After Deepgram speech_final, send sooner (ms quiet). */
const LIVE_MIC_SPEECH_FINAL_QUIET_MS = 700
/** iPhone: delay mic reopen after Myra TTS so speaker session stays clean. */
const APPLE_MIC_RESUME_AFTER_TTS_MS = 450
/** Visual energy only — does not gate send */
const LIVE_MIC_VOICE_ENERGY = 20
/** If target video is stuck on Safari, still start Myra welcome after verify */
/** Never block mic/keyboard UI if TTS never fires ended on mobile Safari */
const MYRA_TTS_SAFETY_MS = 35000

function pickBackCameraId(devices) {
  const videos = devices.filter((device) => device.kind === 'videoinput')
  const back = videos.find(
    (device) =>
      /back|rear|environment/i.test(device.label) && !/front|user|face/i.test(device.label),
  )
  if (back) return back.deviceId
  const wide = videos.find(
    (device) => /wide|ultra|triple|dual/i.test(device.label) && !/front|user|face/i.test(device.label),
  )
  return wide?.deviceId ?? ''
}

function trackLooksLikeBackCamera(track) {
  if (!track) return false
  const facing = track.getSettings?.()?.facingMode
  if (facing === 'environment') return true
  if (facing === 'user') return false
  const label = track.label || ''
  return /back|rear|environment/i.test(label) && !/front|user|face/i.test(label)
}

/** After permission, switch front → back for AR scan (iPhone Chrome often opens selfie first). */
async function preferBackCameraStream(initialStream) {
  if (!(initialStream instanceof MediaStream)) return initialStream
  const track = initialStream.getVideoTracks()[0] ?? null
  if (trackLooksLikeBackCamera(track)) {
    return initialStream
  }

  const attempts = [
    { video: { facingMode: { exact: 'environment' } }, audio: false },
    { video: { facingMode: { ideal: 'environment' } }, audio: false },
  ]

  const devices = await navigator.mediaDevices.enumerateDevices()
  const backId = pickBackCameraId(devices)
  if (backId) {
    attempts.unshift({ video: { deviceId: { exact: backId } }, audio: false })
  }

  for (const constraints of attempts) {
    try {
      const backStream = await navigator.mediaDevices.getUserMedia(constraints)
      const backTrack = backStream.getVideoTracks()[0]
      if (!trackLooksLikeBackCamera(backTrack) && backTrack?.getSettings?.()?.facingMode === 'user') {
        backStream.getTracks().forEach((t) => t.stop())
        continue
      }
      initialStream.getTracks().forEach((t) => t.stop())
      return backStream
    } catch {
      // try next
    }
  }

  return initialStream
}

async function acquireCameraStream(selectedDeviceId, cameraFacing) {
  const attempts = []

  if (selectedDeviceId) {
    attempts.push({ video: { deviceId: { exact: selectedDeviceId } }, audio: false })
  }
  if (cameraFacing === 'environment') {
    attempts.push({ video: { facingMode: { exact: 'environment' } }, audio: false })
  }
  attempts.push({ video: { facingMode: { ideal: cameraFacing } }, audio: false })
  // Only fall back to the other side when explicitly flipping / last resort.
  if (cameraFacing === 'environment') {
    attempts.push({ video: true, audio: false })
  } else {
    attempts.push({ video: { facingMode: { ideal: 'environment' } }, audio: false })
    attempts.push({ video: true, audio: false })
  }

  let lastError = null
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints)
    } catch (error) {
      lastError = error
    }
  }

  throw lastError ?? new Error('Could not access camera')
}

const STARTUP_AUDIO_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
}

/** Camera preview must never carry mic audio — Safari can sidetone/echo if audio tracks stay live. */
function stripAudioTracksFromStream(stream) {
  if (!(stream instanceof MediaStream)) return stream
  stream.getAudioTracks().forEach((track) => track.stop())
  return stream
}

/**
 * Start getUserMedia in the same synchronous turn as the tap (iOS Chrome requires this).
 * Do not await anything before calling this.
 */
function beginCameraFromUserGesture() {
  if (!navigator.mediaDevices?.getUserMedia) {
    return Promise.reject(new Error('Camera API not available'))
  }
  // Prefer back camera on the gesture itself — { video: true } often opens front on iPhone Chrome.
  return navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' } },
    audio: false,
  })
}

/**
 * iPhone Chrome/Edge/Firefox: combined video+audio getUserMedia often fails even when
 * camera alone would work. Camera is required to enter AR; mic is best-effort (live mic
 * re-asks later). Safari keeps the one-shot combined prompt.
 */
async function acquireStartupStream(prefetchedStreamPromise = null) {
  if (prefetchedStreamPromise) {
    try {
      return await prefetchedStreamPromise
    } catch {
      // Prefetch failed (gesture lost / denied) — fall through to retries.
    }
  }

  const chromeLike = isIOSChromeLike()

  if (chromeLike) {
    let lastError = null
    const cameraAttempts = [
      { video: { facingMode: { exact: 'environment' } }, audio: false },
      { video: { facingMode: { ideal: 'environment' } }, audio: false },
      { video: true, audio: false },
    ]
    for (const constraints of cameraAttempts) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints)
      } catch (error) {
        lastError = error
      }
    }
    throw lastError ?? new Error('Could not access camera')
  }

  const attempts = [
    {
      video: { facingMode: { ideal: 'environment' } },
      audio: STARTUP_AUDIO_CONSTRAINTS,
    },
    {
      video: { facingMode: { ideal: 'user' } },
      audio: STARTUP_AUDIO_CONSTRAINTS,
    },
    { video: true, audio: STARTUP_AUDIO_CONSTRAINTS },
    { video: { facingMode: { ideal: 'environment' } }, audio: false },
    { video: true, audio: false },
  ]

  let lastError = null
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints)
    } catch (error) {
      lastError = error
    }
  }

  throw lastError ?? new Error('Could not access camera or microphone')
}

function requestGeolocationInBackground() {
  if (!navigator.geolocation) return
  navigator.geolocation.getCurrentPosition(
    () => {},
    () => {},
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
  )
}

async function permissionsLookGranted() {
  if (!navigator.permissions?.query) return false
  try {
    const [cam, mic] = await Promise.all([
      navigator.permissions.query({ name: 'camera' }),
      navigator.permissions.query({ name: 'microphone' }),
    ])
    return cam.state === 'granted' && mic.state === 'granted'
  } catch {
    return false
  }
}

async function inspectPermissionStates() {
  if (!navigator.permissions?.query) {
    return { camera: 'unknown', microphone: 'unknown' }
  }
  try {
    const [cam, mic] = await Promise.all([
      navigator.permissions.query({ name: 'camera' }),
      navigator.permissions.query({ name: 'microphone' }),
    ])
    return { camera: cam.state, microphone: mic.state }
  } catch {
    return { camera: 'unknown', microphone: 'unknown' }
  }
}

function isMediaNotAllowed(error) {
  const name = error?.name || ''
  return name === 'NotAllowedError' || name === 'PermissionDeniedError'
}

function permissionAccessHint(states, fromUserGesture, error = null, failCount = 0) {
  const chromeLike = isIOSChromeLike()
  const hardDenied = states.camera === 'denied' || states.microphone === 'denied'
  // iOS often throws NotAllowedError when the gesture was lost — not a real OS block.
  const maybeBlocked = hardDenied || (failCount >= 2 && isMediaNotAllowed(error))

  if (maybeBlocked && chromeLike) {
    return 'Allow camera in iPhone Settings, Chrome, then Camera. Come back and tap again.'
  }
  if (maybeBlocked) {
    return 'Camera blocked in site settings. Allow it, then tap again.'
  }
  if (chromeLike) {
    return fromUserGesture
      ? 'Tap the circle and press Allow for Camera.'
      : 'Tap the circle to allow Camera.'
  }
  if (fromUserGesture) {
    return 'Tap again and press Allow when the browser asks.'
  }
  return 'Tap the circle to allow camera and mic.'
}

async function applyTrackZoom(track, factor) {
  if (!track) return false
  try {
    const caps = track.getCapabilities?.()
    if (caps?.zoom) {
      const zoom = Math.min(caps.zoom.max, Math.max(caps.zoom.min, factor))
      await track.applyConstraints({ advanced: [{ zoom }] })
      return true
    }
  } catch (error) {
    console.warn('[Camera] zoom failed:', error)
  }
  return false
}

async function applyTrackTorch(track, enabled) {
  if (!track) return false
  try {
    const caps = track.getCapabilities?.()
    if (caps?.torch) {
      await track.applyConstraints({ advanced: [{ torch: enabled }] })
      return true
    }
    if (caps?.fillLightMode?.includes?.('flash')) {
      await track.applyConstraints({
        advanced: [{ fillLightMode: enabled ? 'flash' : 'off' }],
      })
      return true
    }
  } catch (error) {
    try {
      await track.applyConstraints({ torch: enabled })
      return true
    } catch {
      console.warn('[Camera] torch failed:', error)
    }
  }
  return false
}

function pickMyraVoice() {
  const voices = window.speechSynthesis?.getVoices() ?? []
  const preferred = [
    'Microsoft Swara Online (Natural)',
    'Microsoft Swara Online',
    'Microsoft Swara',
    'Google हिन्दी',
    'Microsoft Hemant',
    'Microsoft Zira Online (Natural)',
    'Microsoft Zira',
  ]
  for (const name of preferred) {
    const match = voices.find((voice) => voice.name.includes(name))
    if (match) return match
  }
  return (
    voices.find((voice) => voice.lang.startsWith('hi')) ||
    voices.find((voice) => voice.lang.startsWith('en-IN')) ||
    voices[0] ||
    null
  )
}

function applyMyraVoice(utterance, voiceRef) {
  const voice = voiceRef.current || pickMyraVoice()
  if (voice) {
    utterance.voice = voice
    utterance.lang = voice.lang
  } else {
    utterance.lang = 'hi-IN'
  }
}

function IntroLoadingScreen({
  handoff,
  startupAccess,
  startupAccessHint,
  onAssetsReady,
  onAutoRequestAccess,
  onGrantAccess,
}) {
  const [loadProgress, setLoadProgress] = useState(10)
  const assetsReadyRef = useRef(false)
  const autoRequestedRef = useRef(false)

  useEffect(() => {
    let cancelled = false

    loadAxeraiExperienceAssets({
      onProgress: (pct) => {
        if (!cancelled) setLoadProgress(pct)
      },
    })
      .then(() => {
        if (cancelled || assetsReadyRef.current) return
        assetsReadyRef.current = true
        setLoadProgress(100)
        onAssetsReady?.()
      })
      .catch((error) => {
        console.error('[Axerai] asset preload failed', error)
        if (cancelled || assetsReadyRef.current) return
        assetsReadyRef.current = true
        setLoadProgress(100)
        onAssetsReady?.()
      })

    return () => {
      cancelled = true
    }
  }, [onAssetsReady])

  useEffect(() => {
    if (loadProgress < 80 || autoRequestedRef.current) return
    autoRequestedRef.current = true
    onAutoRequestAccess?.()
  }, [loadProgress, onAutoRequestAccess])

  const needsManualAccess =
    startupAccess === 'prompt' ||
    startupAccess === 'denied' ||
    startupAccess === 'blocked'

  return (
    <div
      className={`intro-loading${handoff ? ' intro-loading--handoff' : ''}${loadProgress >= 100 ? ' intro-loading--complete' : ''}${needsManualAccess ? ' intro-loading--access' : ''}`}
      role="status"
      aria-live="polite"
      aria-label="Loading Richera experience"
    >
      <div className="intro-loading__stage">
        <img src={INTRO_LOADING_BG} alt="" className="intro-loading__bg" aria-hidden />
        <div className="intro-loading__shade" aria-hidden />
        <div className="intro-loading__content">
          <h1 className="intro-loading__brand">Richera</h1>
          <p className="intro-loading__credit">powered by akxerai</p>
          <div className="intro-loading__bar" aria-hidden>
            <div className="intro-loading__bar-track">
              <div className="intro-loading__bar-fill" style={{ width: `${loadProgress}%` }} />
            </div>
          </div>
        </div>

        {needsManualAccess ? (
          <>
            {startupAccessHint ? (
              <p className="intro-access-hint" role="status">
                {startupAccessHint}
              </p>
            ) : null}
            <span className="intro-access-tap-ring" aria-hidden />
            <button
              type="button"
              className={`intro-access-tap${startupAccess === 'denied' || startupAccess === 'blocked' ? ' intro-access-tap--retry' : ''}`}
              aria-label="Allow camera"
              disabled={startupAccess === 'granting'}
              onPointerDown={(event) => {
                // Must call getUserMedia in this same turn — before any audio unlock.
                if (event.pointerType === 'mouse' && event.button !== 0) return
                if (startupAccess === 'granting') return
                event.preventDefault()
                const streamPromise = beginCameraFromUserGesture()
                onGrantAccess(streamPromise)
              }}
            />
          </>
        ) : null}
      </div>
    </div>
  )
}

function IntroShell({
  onExitStart,
  onExitComplete,
  readyToEnter,
  startupAccess,
  startupAccessHint,
  onAssetsReady,
  onAutoRequestAccess,
  onGrantAccess,
}) {
  const [handoff, setHandoff] = useState(false)

  useEffect(() => {
    // Choocha-style: first real gesture unlocks Safari speechSynthesis (empty speak).
    // Later touches only refresh AudioContext — repeating speak('') interrupts Myra.
    let speechPrimed = false
    const prime = () => {
      unlockMobileSpeechAudio({ force: true, speechPing: !speechPrimed })
      speechPrimed = true
    }
    document.addEventListener('touchstart', prime, { passive: true })
    document.addEventListener('click', prime, { passive: true })
    return () => {
      document.removeEventListener('touchstart', prime)
      document.removeEventListener('click', prime)
    }
  }, [])

  useEffect(() => {
    if (!readyToEnter || handoff) return
    setHandoff(true)
    onExitStart?.()
    window.setTimeout(() => onExitComplete?.(), 480)
  }, [readyToEnter, handoff, onExitStart, onExitComplete])

  return (
    <div className="intro-shell">
      <IntroLoadingScreen
        handoff={handoff}
        startupAccess={startupAccess}
        startupAccessHint={startupAccessHint}
        onAssetsReady={onAssetsReady}
        onAutoRequestAccess={onAutoRequestAccess}
        onGrantAccess={onGrantAccess}
      />
    </div>
  )
}

async function waitForVideoFrames(video, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (video.videoWidth > 0 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      try {
        await video.play()
      } catch {
        // muted inline video usually still plays
      }
      return
    }
    await new Promise((resolve) => requestAnimationFrame(resolve))
  }

  throw new Error('MindAR camera feed timed out')
}

function isMindARFeedGlitch(message) {
  return /timed out|not ready|camera feed/i.test(String(message ?? ''))
}

function resolveMindARCameraFromStream(stream, fallbackFacing = 'environment') {
  const track = stream?.getVideoTracks()?.[0]
  const settings = track?.getSettings?.() ?? {}
  const deviceId = settings.deviceId || ''
  const facingMode = settings.facingMode

  let shouldFaceUser
  if (facingMode === 'user') shouldFaceUser = true
  else if (facingMode === 'environment') shouldFaceUser = false
  else shouldFaceUser = fallbackFacing === 'user' || Boolean(deviceId)

  return {
    shouldFaceUser,
    userDeviceId: shouldFaceUser ? deviceId || undefined : undefined,
    environmentDeviceId: !shouldFaceUser ? deviceId || undefined : undefined,
  }
}

function safeMindARResize(mindarThree) {
  if (!mindarThree?.controller) return
  try {
    mindarThree.resize()
  } catch (error) {
    console.warn('[MindAR] resize skipped:', error)
  }
}

async function startMindARWithPreviewStream(mindarThree, container, stream) {
  const video = document.createElement('video')
  video.setAttribute('autoplay', '')
  video.setAttribute('muted', '')
  video.setAttribute('playsinline', '')
  video.style.position = 'absolute'
  video.style.top = '0px'
  video.style.left = '0px'
  video.style.zIndex = '-2'
  container.appendChild(video)

  mindarThree.video = video
  mindarThree.stream = stream
  video.srcObject = stream

  await waitForVideoFrames(video)
  video.setAttribute('width', String(video.videoWidth))
  video.setAttribute('height', String(video.videoHeight))

  await mindarThree._startAR()
  safeMindARResize(mindarThree)
}

function softTeardownMindAR(mindarThree, keepCameraAlive) {
  if (!mindarThree) return

  try {
    mindarThree.renderer?.setAnimationLoop(null)
    mindarThree.controller?.stopProcessVideo?.()
  } catch {
    // ignore partial init
  }

  if (keepCameraAlive) {
    const videoEl = mindarThree.video
    if (videoEl) {
      videoEl.srcObject = null
      videoEl.remove()
    }
    mindarThree.video = null
    return
  }

  try {
    mindarThree.stop()
  } catch {
    // ignore
  }
}

function MindARSession({
  previewStream,
  cameraProfile,
  onReleasePreview,
  onError,
  onSessionReady,
  onTargetVideoEnded,
  onCardTracked,
  playTargetVideo = true,
  showMyra,
  isTalking,
  showThinkingRing = false,
}) {
  const containerRef = useRef(null)
  const [anchorGroup, setAnchorGroup] = useState(null)
  const [targetVideoPlaying, setTargetVideoPlaying] = useState(false)
  const [myraSlotActive, setMyraSlotActive] = useState(false)
  const showMyraRef = useRef(showMyra)
  const playTargetVideoRef = useRef(playTargetVideo)
  const mindarVideoRef = useRef(null)

  useEffect(() => {
    showMyraRef.current = showMyra
    if (showMyra) setMyraSlotActive(true)
  }, [showMyra])
  const videoPhaseActiveRef = useRef(true)
  const cardTrackHandlerRef = useRef(onCardTracked)
  const onTargetVideoEndedRef = useRef(onTargetVideoEnded)
  const onReleasePreviewRef = useRef(onReleasePreview)
  const onErrorRef = useRef(onError)
  const onSessionReadyRef = useRef(onSessionReady)

  useEffect(() => {
    cardTrackHandlerRef.current = onCardTracked
  }, [onCardTracked])

  useEffect(() => {
    onTargetVideoEndedRef.current = onTargetVideoEnded
  }, [onTargetVideoEnded])

  useEffect(() => {
    onReleasePreviewRef.current = onReleasePreview
  }, [onReleasePreview])

  useEffect(() => {
    onErrorRef.current = onError
  }, [onError])

  useEffect(() => {
    onSessionReadyRef.current = onSessionReady
  }, [onSessionReady])

  const getMindarVideo = useCallback(() => {
    const video = mindarVideoRef.current
    if (video && video.videoWidth > 0) return video
    const host = containerRef.current
    const fallback = host?.querySelector('video')
    if (fallback && fallback.videoWidth > 0) return fallback
    return null
  }, [])

  const notifyCardTracked = useCallback((phase) => {
    cardTrackHandlerRef.current?.(phase, getMindarVideo)
  }, [getMindarVideo])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let active = true
    let mindarThree = null
    let disposeTargetVideo = null
    let keepCameraAlive = Boolean(previewStream?.active)
    const sessionGen = { id: 0 }
    sessionGen.id = Math.random()
    const enableTargetVideo = playTargetVideoRef.current

    async function startMindAR() {
      const mySession = sessionGen.id
      try {
        console.log('[MindAR] boot — reusing scan camera stream')

        mindarThree = new MindARThree({
          container,
          imageTargetSrc: MINDAR_TARGET,
          uiLoading: 'no',
          uiScanning: 'no',
          uiError: 'no',
          userDeviceId: cameraProfile?.userDeviceId,
          environmentDeviceId: cameraProfile?.environmentDeviceId,
        })
        if (cameraProfile) {
          mindarThree.shouldFaceUser = cameraProfile.shouldFaceUser
        }

        const { renderer, scene, camera } = mindarThree
        const anchor = mindarThree.addAnchor(0)

        const attachCardTrackHandler = () => {
          const previous = anchor.onTargetFound
          anchor.onTargetFound = () => {
            previous?.()
            if (!active || sessionGen.id !== mySession) return
            const phase = videoPhaseActiveRef.current ? 'video' : 'card'
            notifyCardTracked(phase)
          }
        }

        if (enableTargetVideo) {
          videoPhaseActiveRef.current = true
          disposeTargetVideo = mountTargetAnchorVideo({
            anchor,
            anchorGroup: anchor.group,
            onCardTracked: () => {
              if (!active || sessionGen.id !== mySession) return
              setMyraSlotActive(true)
              setTargetVideoPlaying(true)
              notifyCardTracked('video')
            },
            onEnded: () => {
              if (!active || sessionGen.id !== mySession) return
              videoPhaseActiveRef.current = false
              setMyraSlotActive(true)
              setTargetVideoPlaying(false)
              // After card video, always show Myra (verify pass/fail does not matter).
              const wrapper = anchor.group?.userData?.wrapper
              if (wrapper) wrapper.visible = true
              // Keep dispose for unmount only — finish() already fades + cleans the mesh.
              disposeTargetVideo = null
              attachCardTrackHandler()
              onTargetVideoEndedRef.current?.()
            },
          })
        } else {
          videoPhaseActiveRef.current = false
          attachCardTrackHandler()
        }

        if (!active) return
        setAnchorGroup(anchor.group)

        scene.add(new AmbientLight(0xffffff, 1.4))
        const directional = new DirectionalLight(0xffffff, 2.5)
        directional.position.set(5, 5, 5)
        scene.add(directional)
        const fill = new DirectionalLight(0xffffff, 1.2)
        fill.position.set(-4, 2, 4)
        scene.add(fill)

        if (previewStream?.active) {
          await startMindARWithPreviewStream(mindarThree, container, previewStream)
        } else {
          console.warn('[MindAR] scan stream inactive — opening camera directly')
          onReleasePreviewRef.current?.()
          await mindarThree.start()
          safeMindARResize(mindarThree)
          const mindarVideo = container.querySelector('video')
          if (mindarVideo) await waitForVideoFrames(mindarVideo)
          keepCameraAlive = false
        }

        if (!active || sessionGen.id !== mySession) return

        const mindarVideo = mindarThree.video || container.querySelector('video')
        mindarVideoRef.current = mindarVideo
        if (!mindarVideo || mindarVideo.videoWidth === 0) {
          throw new Error('MindAR camera feed is not ready')
        }

        console.log(
          '[MindAR] ready',
          `${mindarVideo.videoWidth}x${mindarVideo.videoHeight}`,
          'streamActive=',
          mindarVideo.srcObject instanceof MediaStream
            ? mindarVideo.srcObject.active
            : false,
        )

        if (sessionGen.id === mySession) {
          onSessionReadyRef.current?.()
        }

        if (!active || sessionGen.id !== mySession) {
          softTeardownMindAR(mindarThree, keepCameraAlive)
          return
        }

        const clock = new Clock()

        renderer.setAnimationLoop(() => {
          const delta = clock.getDelta()
          tickMyraMixer(anchor.group, delta)
          renderer.render(scene, camera)
        })
      } catch (error) {
        if (!active || sessionGen.id !== mySession) return
        console.error('[MindAR] session failed', error)
        onErrorRef.current?.(
          error instanceof Error
            ? error.message
            : 'AR initialization failed',
        )
        softTeardownMindAR(mindarThree, keepCameraAlive)
      }
    }

    startMindAR()

    return () => {
      sessionGen.id = 0
      active = false
      setTargetVideoPlaying(false)
      setMyraSlotActive(false)
      disposeTargetVideo?.()
      disposeTargetVideo = null
      setAnchorGroup(null)
      mindarVideoRef.current = null
      softTeardownMindAR(mindarThree, keepCameraAlive)
      if (container) container.replaceChildren()
    }
    // Only remount when the camera stream/profile changes — not when chat/welcome callbacks update.
  }, [previewStream, cameraProfile, notifyCardTracked])

  return (
    <div
      className="absolute inset-0 z-10 w-full h-full overflow-hidden"
      style={{ width: '100%', height: '100%' }}
    >
      <div
        ref={containerRef}
        className="mindar-host absolute inset-0 h-full w-full overflow-hidden"
      />

      {anchorGroup && (myraSlotActive || showMyra || targetVideoPlaying) ? (
        <MyraModel
          key={MYRA_MODEL_PATH}
          anchorGroup={anchorGroup}
          isTalking={isTalking}
          revealed={!targetVideoPlaying && (showMyra || myraSlotActive)}
          showThinkingRing={showThinkingRing}
        />
      ) : null}
    </div>
  )
}

function drawVideoFrameToCanvas(video, { centerCropFactor = 1 } = {}) {
  const vw = video.videoWidth
  const vh = video.videoHeight
  const canvas = document.createElement('canvas')
  canvas.width = vw
  canvas.height = vh

  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas

  if (centerCropFactor > 1) {
    const cropW = vw / centerCropFactor
    const cropH = vh / centerCropFactor
    const sx = (vw - cropW) / 2
    const sy = (vh - cropH) / 2
    ctx.drawImage(video, sx, sy, cropW, cropH, 0, 0, vw, vh)
  } else {
    ctx.drawImage(video, 0, 0, vw, vh)
  }

  return canvas
}

async function recognizeProductFromFrame(sourceCanvas) {
  const imageDataUrl = sourceCanvas.toDataURL('image/jpeg', 0.85)
  const result = await verifyRicheraProduct(imageDataUrl)

  if (result.usage) {
    void recordGeminiUsage({
      callType: 'verify',
      model: result.model,
      promptTokens: result.usage.promptTokens,
      outputTokens: result.usage.outputTokens,
      totalTokens: result.usage.totalTokens,
      verificationCode: result.verificationCode ?? 'R',
    })
  }

  if (result.verified) {
    console.info('[Scan] 3-layer verify: REAL →', result.verificationCode)
  } else {
    console.warn('[Scan] 3-layer verify fail:', result.failReason)
  }
  return result
}

function verifyFailSituation(failReason) {
  if (failReason === VERIFY_FAIL_REASON.PHOTO_SPOOF) {
    return MYRA_ERROR_SITUATIONS.SCAN_PHOTO_SPOOF
  }
  if (failReason === VERIFY_FAIL_REASON.BAD_FRAME) {
    return MYRA_ERROR_SITUATIONS.SCAN_BAD_FRAME
  }
  return MYRA_ERROR_SITUATIONS.SCAN_CARD_NOT_FOUND
}

/** Short on-screen note after one-shot verify fails (session locked). */
function verifyFailUserNote(situation) {
  switch (situation) {
    case MYRA_ERROR_SITUATIONS.SCAN_PHOTO_SPOOF:
      return 'Looks like a photo or screen — real RICHERA card needed. Scan locked this session.'
    case MYRA_ERROR_SITUATIONS.SCAN_BAD_FRAME:
      return 'Card wasn’t clear enough to verify. Scan locked this session.'
    case MYRA_ERROR_SITUATIONS.SCAN_CARD_NOT_FOUND:
      return 'RICHERA card not recognized. Scan locked this session.'
    case MYRA_ERROR_SITUATIONS.SCAN_GLITCH:
      return 'Verify glitched once. Scan locked this session — no more retries.'
    case MYRA_ERROR_SITUATIONS.SCAN_MAGIC_ASLEEP:
      return 'Verify unavailable right now. Scan locked this session.'
    case MYRA_ERROR_SITUATIONS.SCAN_PAIR_FULL:
      return 'This card is already linked to two phones.'
    default:
      return 'Verification didn’t pass. Scan locked this session.'
  }
}

async function persistHistoryEntry(role, text) {
  if (!isLedgerConfigured()) return
  let body =
    role === 'myra' ? prepareMyraLedgerText(text) : String(text ?? '').trim()
  if (!body) return

  if (role === 'myra' && isOfflineMyraFallback(body)) {
    return
  }

  await appendLedgerMessage(role, body)
}

function queuePersistHistoryEntry(role, text) {
  void persistHistoryEntry(role, text).catch((error) => {
    console.warn('[Ledger] persist queue failed:', error)
  })
}

function geminiErrorText(error) {
  return String(error?.message ?? error).toLowerCase()
}

function isGeminiFatalError(error) {
  const msg = geminiErrorText(error)
  return (
    msg.includes('401') ||
    msg.includes('403') ||
    msg.includes('api key') ||
    msg.includes('account_state_invalid') ||
    msg.includes('permission denied')
  )
}

function isGeminiModelUnavailable(error) {
  const msg = geminiErrorText(error)
  return msg.includes('404') || msg.includes('not found') || msg.includes('not supported')
}

function isGeminiRetryableError(error) {
  const msg = geminiErrorText(error)
  return (
    msg.includes('503') ||
    msg.includes('429') ||
    msg.includes('500') ||
    msg.includes('502') ||
    msg.includes('504') ||
    msg.includes('high demand') ||
    msg.includes('overloaded') ||
    msg.includes('unavailable') ||
    msg.includes('failed to parse stream') ||
    msg.includes('fetch failed') ||
    msg.includes('network')
  )
}

function geminiRetryDelayMs(attempt) {
  return 500 * attempt
}

function App() {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const spokeForScanRef = useRef(false)
  const welcomeInFlightRef = useRef(false)
  const welcomeDelayTimerRef = useRef(null)
  const mindarDelayRef = useRef(null)
  const arStreamRef = useRef(null)
  const mindarReadyRef = useRef(false)
  const jarvisRecognitionRef = useRef(null)
  const jarvisActiveRef = useRef(false)
  const jarvisBusyRef = useRef(false)
  const jarvisMicCycleRef = useRef(0)
  const jarvisSpeechTimerRef = useRef(null)
  const aiSpeakingRef = useRef(false)
  const myraVoiceRef = useRef(null)
  const liveContextRef = useRef(null)
  const scanSnapshotRef = useRef(null)
  const verifyGenerationRef = useRef(0)
  const verifyFailCountRef = useRef(0)
  const scanSnapInFlightRef = useRef(false)
  /** One Gemini verify per AR session — pass or fail, no token-burning retries. */
  const verifyLockedRef = useRef(false)
  const isVerifiedRef = useRef(false)
  const targetVideoDoneRef = useRef(false)
  const cameraFlipInFlightRef = useRef(false)
  const endExperienceRef = useRef(null)
  const restartingScanRef = useRef(false)
  const scheduleMindARRef = useRef(() => {})
  const micStreamRef = useRef(null)
  const startupPermissionsDoneRef = useRef(false)
  const assetsReadyRef = useRef(false)
  const autoAccessAttemptedRef = useRef(false)
  const startupGrantInFlightRef = useRef(false)
  const startupGrantFailCountRef = useRef(0)
  const liveMicRecognitionRef = useRef(null)
  const liveMicDeepgramRef = useRef(null)
  const pttDeepgramRef = useRef(null)
  const liveMicAnalyserRef = useRef(null)
  const liveMicAudioCtxRef = useRef(null)
  const liveMicRafRef = useRef(null)
  const liveMicStreamRef = useRef(null)
  const liveMicFinalRef = useRef('')
  const liveMicDisplayRef = useRef('')
  const liveMicSilenceTimerRef = useRef(null)
  const liveMicLastSpeechAtRef = useRef(0)
  const liveMicLastVoiceAtRef = useRef(0)
  const liveMicPendingInterimRef = useRef(false)
  const composeModeRef = useRef(null)
  const torchOnRef = useRef(false)
  const viewportTapRef = useRef(0)
  const sendMyraUserMessageRef = useRef(() => {})
  const startLiveMicModeRef = useRef(async () => false)

  const [introVisible, setIntroVisible] = useState(true)
  const [mainRevealed, setMainRevealed] = useState(false)
  const [startupAccess, setStartupAccess] = useState('loading')
  const [startupAccessHint, setStartupAccessHint] = useState(null)
  const [introReadyToEnter, setIntroReadyToEnter] = useState(false)
  const [selectedDeviceId, setSelectedDeviceId] = useState('')
  const [cameraFacing, setCameraFacing] = useState('environment')
  const [cameraInitReady, setCameraInitReady] = useState(false)
  const [cameraError, setCameraError] = useState(null)
  const [isVerified, setIsVerified] = useState(false)
  const [showMindAR, setShowMindAR] = useState(false)
  const [videoReady, setVideoReady] = useState(false)
  const [isAiThinking, setIsAiThinking] = useState(false)
  const [userTurnThinking, setUserTurnThinking] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [isMyraTalking, setisMyraTalking] = useState(false)
  const [mindarReady, setMindarReady] = useState(false)
  const [showScanGuide, setShowScanGuide] = useState(false)
  const [verifyLocked, setVerifyLocked] = useState(false)
  const [verifyFailNote, setVerifyFailNote] = useState('')
  const [forceShowMyra, setForceShowMyra] = useState(false)
  const [experienceViewMode, setExperienceViewMode] = useState('ar')
  const [targetVideoDone, setTargetVideoDone] = useState(false)
  const [arPreviewStream, setArPreviewStream] = useState(null)
  const [arCameraProfile, setArCameraProfile] = useState(null)
  const [jarvisUiReady, setJarvisUiReady] = useState(false)
  const [composeText, setComposeText] = useState('')
  const [composeMode, setComposeMode] = useState(null)
  const [torchOn, setTorchOn] = useState(false)
  const [torchSupported, setTorchSupported] = useState(false)
  const [liveTranscript, setLiveTranscript] = useState('')
  const [liveMicEditing, setLiveMicEditing] = useState(false)
  const [liveMicEditDraft, setLiveMicEditDraft] = useState('')
  const liveMicEditingRef = useRef(false)
  const [voiceLevels, setVoiceLevels] = useState(() => Array(12).fill(0.15))
  const [needsAudioTap, setNeedsAudioTap] = useState(false)
  const [exitClosing, setExitClosing] = useState(false)
  const exitClosingRef = useRef(false)
  const [sideDockOpen, setSideDockOpen] = useState(false)
  const reelCaptureRef = useRef(null)
  const reelToastTimerRef = useRef(null)
  const [reelToast, setReelToast] = useState('')
  const composeInputRef = useRef(null)
  const liveTranscriptScrollRef = useRef(null)
  const pttHoldingRef = useRef(false)
  const pttTranscriptRef = useRef('')
  const pttStartInFlightRef = useRef(false)
  const pttCommittedRef = useRef(false)
  const pttEndListenerRef = useRef(null)
  const endPushToTalkRef = useRef(() => {})

  const showReelToast = useCallback((message) => {
    const text = String(message ?? '').trim()
    if (!text) return
    if (reelToastTimerRef.current) {
      window.clearTimeout(reelToastTimerRef.current)
    }
    setReelToast(text)
    reelToastTimerRef.current = window.setTimeout(() => setReelToast(''), 4200)
  }, [])

  const reelRecord = useReelRecordUi({
    enabled: isVerified && jarvisUiReady,
    captureRootRef: reelCaptureRef,
    composeModeRef,
    liveMicStreamRef,
    onSaved: (method) => {
      showReelToast(method === 'share' ? 'Reel saved — share sheet open' : 'Reel saved to device')
    },
    onError: (error, opts = {}) => {
      const message = error instanceof Error ? error.message : 'Recording failed'
      if (opts.severity === 'info') {
        showReelToast(message)
        return
      }
      console.warn('[Reel]', error)
      showReelToast(message)
    },
  })

  const handleIntroExitStart = useCallback(() => {
    window.setTimeout(() => setMainRevealed(true), 420)
  }, [])

  const handleIntroExitComplete = useCallback(() => {
    setIntroVisible(false)
  }, [])

  const loadDevices = useCallback(async () => {
    const all = await navigator.mediaDevices.enumerateDevices()
    return all.filter((device) => device.kind === 'videoinput')
  }, [])

  const grantStartupAccess = useCallback(async (prefetchedStreamPromise = null) => {
    // Camera FIRST — never unlock audio / geo before getUserMedia on iOS Chrome.
    let stream = await acquireStartupStream(prefetchedStreamPromise)
    stream = await preferBackCameraStream(stream)
    stripAudioTracksFromStream(stream)
    streamRef.current = stream

    requestGeolocationInBackground()
    void ensureMobileAudioUnlocked({ force: true })
    unlockMobileSpeechAudio({ force: true, speechPing: true })

    // Best-effort mic warm-up after camera (does not block AR entry).
    if (isIOSChromeLike()) {
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({
          audio: STARTUP_AUDIO_CONSTRAINTS,
          video: false,
        })
        micStream.getTracks().forEach((track) => track.stop())
      } catch (micError) {
        console.warn('[Axerai] iOS Chrome: camera OK, mic later:', micError?.name || micError)
      }
    }

    const videoInputs = await loadDevices()
    const backId = pickBackCameraId(videoInputs)
    // Always prefer environment for product scan — never default to front when labels are empty.
    setCameraFacing('environment')
    setSelectedDeviceId(backId || '')

    startupPermissionsDoneRef.current = true
    startupGrantFailCountRef.current = 0
    setCameraError(null)
    setCameraInitReady(true)
    return true
  }, [loadDevices])

  const beginIntroExit = useCallback(() => {
    setIntroReadyToEnter(true)
  }, [])

  const maybeEnterExperience = useCallback(() => {
    if (!assetsReadyRef.current || !startupPermissionsDoneRef.current) return
    setStartupAccess('ready')
    beginIntroExit()
  }, [beginIntroExit])

  const requestStartupPermissions = useCallback(
    async ({ fromUserGesture = false, prefetchedStreamPromise = null } = {}) => {
      if (startupPermissionsDoneRef.current) {
        maybeEnterExperience()
        return true
      }
      if (startupGrantInFlightRef.current) return false
      startupGrantInFlightRef.current = true

      setStartupAccess('granting')
      setStartupAccessHint(null)
      try {
        await grantStartupAccess(prefetchedStreamPromise)
        setStartupAccess('ready')
        setStartupAccessHint(null)
        maybeEnterExperience()
        return true
      } catch (error) {
        if (fromUserGesture) startupGrantFailCountRef.current += 1
        const failCount = startupGrantFailCountRef.current
        const states = await inspectPermissionStates()
        const hardDenied = states.camera === 'denied' || states.microphone === 'denied'
        const blocked = hardDenied || (fromUserGesture && failCount >= 2 && isMediaNotAllowed(error))
        if (blocked) {
          setStartupAccess('blocked')
        } else if (fromUserGesture) {
          setStartupAccess('denied')
        } else {
          setStartupAccess('prompt')
        }
        setStartupAccessHint(permissionAccessHint(states, fromUserGesture, error, failCount))
        if (fromUserGesture || blocked) {
          console.warn('[Axerai] Startup permissions failed:', error)
        } else {
          console.debug('[Axerai] Auto permission needs tap — browser requires user gesture.')
        }
        return false
      } finally {
        startupGrantInFlightRef.current = false
      }
    },
    [grantStartupAccess, maybeEnterExperience],
  )

  const handleAutoRequestAccess = useCallback(async () => {
    if (autoAccessAttemptedRef.current || startupPermissionsDoneRef.current) return
    autoAccessAttemptedRef.current = true

    // iPhone Chrome: silent auto getUserMedia almost always fails and leaves users on
    // "Tap again". Skip straight to a clear tap prompt; real grant runs on gesture.
    if (isIOSChromeLike()) {
      setStartupAccess('prompt')
      setStartupAccessHint(permissionAccessHint({ camera: 'unknown', microphone: 'unknown' }, false))
      return
    }

    if (await permissionsLookGranted()) {
      await requestStartupPermissions({ fromUserGesture: false })
      return
    }

    await requestStartupPermissions({ fromUserGesture: false })
  }, [requestStartupPermissions])

  const handleAssetsReady = useCallback(async () => {
    if (assetsReadyRef.current) return
    assetsReadyRef.current = true

    startLiveContextRefresh((ctx) => {
      liveContextRef.current = ctx
    })

    if (startupPermissionsDoneRef.current) {
      maybeEnterExperience()
      return
    }

    if (!autoAccessAttemptedRef.current) {
      await handleAutoRequestAccess()
    }

    maybeEnterExperience()
  }, [handleAutoRequestAccess, maybeEnterExperience])

  const handleGrantAccess = useCallback(async (prefetchedStreamPromise = null) => {
    await requestStartupPermissions({
      fromUserGesture: true,
      prefetchedStreamPromise,
    })
  }, [requestStartupPermissions])

  // --- GEMINI MYRA AI LOGIC ---
  const clearJarvisSpeechTimer = useCallback(() => {
    if (jarvisSpeechTimerRef.current) {
      clearTimeout(jarvisSpeechTimerRef.current)
      jarvisSpeechTimerRef.current = null
    }
  }, [])

  const stopMicStream = useCallback(() => {
    micStreamRef.current?.getTracks().forEach((track) => track.stop())
    micStreamRef.current = null
  }, [])

  /**
   * Fully release live mic while Myra thinks/speaks.
   * track.enabled=false is NOT enough on iPhone — play-and-record still ducks TTS volume.
   */
  const releaseMicForTts = useCallback(() => {
    if (liveMicSilenceTimerRef.current) {
      clearTimeout(liveMicSilenceTimerRef.current)
      liveMicSilenceTimerRef.current = null
    }
    try {
      liveMicRecognitionRef.current?.abort()
    } catch {
      // ignore
    }
    liveMicRecognitionRef.current = null
    liveMicDeepgramRef.current?.abort()
    liveMicDeepgramRef.current = null

    if (liveMicRafRef.current) {
      cancelAnimationFrame(liveMicRafRef.current)
      liveMicRafRef.current = null
    }
    liveMicAnalyserRef.current = null
    if (liveMicAudioCtxRef.current) {
      liveMicAudioCtxRef.current.close().catch(() => {})
      liveMicAudioCtxRef.current = null
    }
    liveMicStreamRef.current?.getTracks().forEach((track) => track.stop())
    liveMicStreamRef.current = null
    if (isAppleMobileBrowser()) {
      pauseAppleUnlockLoop()
    }
    setIsListening(false)
    setVoiceLevels(Array(12).fill(0.15))
  }, [])

  const ensureMicPermission = useCallback(async () => {
    if (startupPermissionsDoneRef.current) return true
    try {
      if (micStreamRef.current?.active) {
        micStreamRef.current.getTracks().forEach((track) => track.stop())
        micStreamRef.current = null
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      })
      stream.getTracks().forEach((track) => track.stop())
      return true
    } catch (error) {
      console.error('[Jarvis] Microphone permission failed:', error)
      return false
    }
  }, [])

  const stopLiveMicMode = useCallback(() => {
    if (liveMicSilenceTimerRef.current) {
      clearTimeout(liveMicSilenceTimerRef.current)
      liveMicSilenceTimerRef.current = null
    }
    if (liveMicRafRef.current) {
      cancelAnimationFrame(liveMicRafRef.current)
      liveMicRafRef.current = null
    }
    liveMicAnalyserRef.current = null
    if (liveMicAudioCtxRef.current) {
      liveMicAudioCtxRef.current.close().catch(() => {})
      liveMicAudioCtxRef.current = null
    }
    liveMicStreamRef.current?.getTracks().forEach((track) => track.stop())
    liveMicStreamRef.current = null
    try {
      liveMicRecognitionRef.current?.abort()
    } catch {
      // ignore
    }
    liveMicRecognitionRef.current = null
    liveMicDeepgramRef.current?.abort()
    liveMicDeepgramRef.current = null
    liveMicFinalRef.current = ''
    liveMicDisplayRef.current = ''
    liveMicLastSpeechAtRef.current = 0
    liveMicLastVoiceAtRef.current = 0
    liveMicPendingInterimRef.current = false
    setLiveTranscript('')
    setLiveMicEditDraft('')
    liveMicEditingRef.current = false
    setLiveMicEditing(false)
    setVoiceLevels(Array(12).fill(0.15))
    setIsListening(false)
  }, [])

  const stopJarvisMode = useCallback(() => {
    jarvisActiveRef.current = false
    jarvisBusyRef.current = false
    aiSpeakingRef.current = false
    pttHoldingRef.current = false
    pttTranscriptRef.current = ''
    pttCommittedRef.current = false
    if (pttEndListenerRef.current) {
      window.removeEventListener('pointerup', pttEndListenerRef.current)
      window.removeEventListener('pointercancel', pttEndListenerRef.current)
      pttEndListenerRef.current = null
    }
    jarvisMicCycleRef.current += 1
    window.speechSynthesis.cancel()
    stopElevenLabsSpeech()
    stopSpeechLipSync()
    stopMicStream()
    stopLiveMicMode()
    clearJarvisSpeechTimer()
    setIsListening(false)
    setIsAiThinking(false)
    setUserTurnThinking(false)
    setisMyraTalking(false)
    setJarvisUiReady(false)
    setComposeText('')
    setComposeMode(null)
    setLiveTranscript('')
    setTorchOn(false)
    const track = streamRef.current?.getVideoTracks()[0] ?? null
    applyTrackTorch(track, false).catch(() => {})
    try {
      jarvisRecognitionRef.current?.abort()
    } catch {
      // ignore abort errors during teardown
    }
    jarvisRecognitionRef.current = null
  }, [clearJarvisSpeechTimer, stopLiveMicMode, stopMicStream])

  const speakWithBrowserTts = useCallback((fullResponse, onDone, onAudioStart) => {
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      void (async () => {
        await waitForMyraSpeechToFinish({ tailMs: 200 })
        stopSpeechLipSync()
        aiSpeakingRef.current = false
        setisMyraTalking(false)
        setIsAiThinking(false)
        onDone?.()
      })()
    }

    let spoke = false
    const speak = () => {
      if (spoke) return
      spoke = true

      const synth = window.speechSynthesis
      if (!synth) {
        finish()
        return
      }

      try {
        synth.resume?.()
      } catch {
        // ignore
      }

      const utterance = new SpeechSynthesisUtterance(fullResponse)
      applyMyraVoice(utterance, myraVoiceRef)
      utterance.rate = 1.06
      utterance.pitch = 1
      utterance.onstart = () => {
        setMyraVoiceOutputPath('browser')
        startSpeechLipSync()
        onAudioStart?.()
      }
      utterance.onend = finish
      utterance.onerror = finish
      synth.speak(utterance)
    }

    unlockMobileSpeechAudio({ force: true })

    const voices = window.speechSynthesis?.getVoices() ?? []
    if (voices.length === 0 && window.speechSynthesis) {
      window.speechSynthesis.addEventListener('voiceschanged', speak, { once: true })
      window.setTimeout(speak, 280)
      return
    }
    speak()
  }, [])

  const speakMyraReply = useCallback(async (fullResponse, onDone, { onSpeakStart } = {}) => {
    const useCloudTts = isCloudTtsConfigured()
    const keepAudioTags = shouldKeepMyraTtsAudioTags()
    const speechText = prepareMyraSpeechText(fullResponse, { keepAudioTags })
    if (!speechText) {
      onDone?.()
      return
    }

    if (keepAudioTags && /\[(laugh|sigh|happy|sad|surprised|laughing|whispering|breathe)/i.test(speechText)) {
      console.info('[Myra TTS] Inworld tags →', speechText.match(/\[[^\]]+\]/g)?.join(' '))
    }

    window.speechSynthesis.cancel()
    stopElevenLabsSpeech()
    // Kill mic + keep live-mic UI hidden while audio loads.
    // Do NOT set isMyraTalking yet — talking anim must wait for real speaker audio (onStart).
    aiSpeakingRef.current = true
    setIsAiThinking(true)
    setIsListening(false)
    releaseMicForTts()
    if (isAppleMobileBrowser()) {
      await prepareApplePlaybackAfterMic()
    }
    void ensureMobileAudioUnlocked({ force: false })

    let speechFinished = false
    let safetyTimer = null

    const finish = () => {
      if (speechFinished) return
      speechFinished = true
      if (safetyTimer) {
        clearTimeout(safetyTimer)
        safetyTimer = null
      }
      void (async () => {
        // Keep talk animation + lip sync until speaker truly idle (onEnd can fire early).
        await waitForMyraSpeechToFinish({ tailMs: 220 })
        stopSpeechLipSync()
        aiSpeakingRef.current = false
        setisMyraTalking(false)
        setIsAiThinking(false)
        onDone?.()
      })()
    }

    safetyTimer = window.setTimeout(() => {
      console.warn('[Myra] TTS safety timeout — continuing flow')
      finish()
    }, MYRA_TTS_SAFETY_MS)

    // Only when sound actually starts leaving the speaker.
    const startTalkingAnimation = () => {
      onSpeakStart?.()
      startSpeechLipSync()
      setisMyraTalking(true)
      setIsAiThinking(false)
      setUserTurnThinking(false)
    }

    if (useCloudTts) {
      try {
        // iPhone: first voice uses Meet Myra gate (gesture unlock).
        if (isAppleMobileBrowser()) {
          setJarvisUiReady(true)
        }
        await speakWithElevenLabs(speechText, {
          onStart: startTalkingAnimation,
          onEnd: finish,
        })
        return
      } catch (error) {
        console.error('[ElevenLabs] TTS failed, using browser voice:', error)
        setIsAiThinking(false)
      }
    }

    // Cloud failed or browser-only — never read [laugh]/[sigh] aloud.
    const browserSpeech = keepAudioTags
      ? prepareMyraSpeechText(fullResponse, { keepAudioTags: false })
      : speechText

    // iPhone: first voice = Meet Myra gate; later lines speak directly.
    if (isAppleMobileBrowser()) {
      setJarvisUiReady(true)
      await speakBrowserTtsAuto(browserSpeech, {
        onStart: startTalkingAnimation,
        onEnd: finish,
        voice: myraVoiceRef.current,
        lang: myraVoiceRef.current?.lang || 'hi-IN',
        rate: 1.06,
        pitch: 1,
      })
      return
    }

    speakWithBrowserTts(browserSpeech, finish, startTalkingAnimation)
  }, [releaseMicForTts, speakWithBrowserTts])

  /** Scripted error lines — Myra speaks unless situation is in MYRA_ERROR_SILENT. */
  const speakMyraErrorLine = useCallback(
    (situation, onDone) => {
      if (!shouldSpeakMyraError(situation)) {
        console.info('[Myra] offline silent:', situation, '—', getMyraErrorTriggerNote(situation))
        setIsAiThinking(false)
        onDone?.()
        return
      }
      const line = pickMyraErrorLine(situation)
      console.info('[Myra] offline:', situation, '—', getMyraErrorTriggerNote(situation))
      setIsAiThinking(true)
      speakMyraReply(line, onDone)
    },
    [speakMyraReply],
  )

function mapGeminiCallType(reason) {
  const text = String(reason ?? '').toLowerCase()
  if (text.includes('welcome') || text.includes('boot') || text.includes('resume')) {
    return 'welcome'
  }
  return 'chat'
}

  const askGemini = useCallback(async (userPrompt, options = {}) => {
    const { models = MYRA_CHAT_LITE_CHAIN, tier = 'lite', reason = '' } = options

    const generationConfig = myraGenerationConfig(tier)
    const systemInstruction = getMyraSystemPrompt({
      ttsAudioTags: isInworldTtsConfigured(),
    })

    console.info(
      `[Gemini] Myra chat tier=${tier} reason=${reason || 'default'} chain=${models.join(' → ')}`,
    )

    if (USE_API_PROXY) {
      const payload = await askGeminiViaProxy({
        userPrompt,
        systemInstruction,
        models,
        generationConfig,
      })

      void recordGeminiUsage({
        callType: mapGeminiCallType(reason),
        model: payload.model,
        promptTokens: payload.usage.promptTokens,
        outputTokens: payload.usage.outputTokens,
        totalTokens: payload.usage.totalTokens,
      })

      return payload.text
    }

    const parts = [{ text: userPrompt }]

    const client = await getGeminiClient()
    if (!client) {
      throw new Error('Gemini not configured — local: VITE_GEMINI_API_KEY | Netlify: GEMINI_API_KEY on server')
    }

    let lastError = null

    for (let modelIndex = 0; modelIndex < models.length; modelIndex += 1) {
      const modelName = models[modelIndex]
      const isFallback = modelIndex > 0
      const maxAttempts = geminiRetriesForModel(modelName)

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          const model = client.getGenerativeModel({
            model: modelName,
            systemInstruction,
            generationConfig,
          })

          let fullResponse = ''
          let usage = { promptTokens: 0, outputTokens: 0, totalTokens: 0 }

          const result = await model.generateContent({ contents: [{ role: 'user', parts }] })
          fullResponse = result.response.text()
          usage = usageFromResponse(result.response)

          void recordGeminiUsage({
            callType: mapGeminiCallType(reason),
            model: modelName,
            promptTokens: usage.promptTokens,
            outputTokens: usage.outputTokens,
            totalTokens: usage.totalTokens,
          })

          if (isFallback || attempt > 1) {
            console.log(`[Gemini] OK — ${modelName}${attempt > 1 ? ` (retry ${attempt})` : ''}`)
          } else {
            console.log(`[Gemini] OK — ${modelName}`)
          }

          return fullResponse
        } catch (error) {
          lastError = error
          const msg = error?.message ?? String(error)
          const retryable = isGeminiRetryableError(error)
          const canRetry = retryable && attempt < maxAttempts

          if (canRetry) {
            console.info(
              `[Gemini] ${modelName} busy (${msg.slice(0, 80)}…) — retry ${attempt + 1}/${maxAttempts}`,
            )
          } else if (isFallback || modelIndex < models.length - 1) {
            console.info(`[Gemini] ${modelName} unavailable — trying next model`)
          } else {
            console.warn(`[Gemini] ${modelName} attempt ${attempt}/${maxAttempts} failed:`, msg)
          }

          if (isGeminiFatalError(error)) throw error

          if (isGeminiModelUnavailable(error)) break

          if (canRetry) {
            await new Promise((resolve) => {
              window.setTimeout(resolve, geminiRetryDelayMs(attempt))
            })
            continue
          }

          break
        }
      }
    }

    throw lastError ?? new Error('Gemini request failed after retries and fallbacks')
  }, [])

  const pauseMicForGemini = useCallback(() => {
    jarvisBusyRef.current = true
    pttHoldingRef.current = false
    pttTranscriptRef.current = ''
    pttCommittedRef.current = false
    setIsListening(false)
    setIsAiThinking(true)
    // Full release (not just mute) — keeps Myra volume stable on Safari/Chrome iPhone.
    releaseMicForTts()
    try {
      jarvisRecognitionRef.current?.abort()
    } catch {
      // ignore
    }
    jarvisRecognitionRef.current = null
  }, [releaseMicForTts])

  const resumeMicAfterGemini = useCallback(async () => {
    if (!jarvisActiveRef.current) return
    jarvisBusyRef.current = false
    setIsAiThinking(false)
    setUserTurnThinking(false)
    if (composeModeRef.current !== 'liveMic') {
      setIsListening(false)
      return
    }

    if (aiSpeakingRef.current) return

    if (isAppleMobileBrowser()) {
      await new Promise((resolve) => {
        window.setTimeout(resolve, APPLE_MIC_RESUME_AFTER_TTS_MS)
      })
    }

    unlockMobileSpeechAudio({ force: false })
    // Stream was fully stopped — always recreate analyser + recognition.
    let ok = await startLiveMicModeRef.current({ softRestart: true })
    if (!ok) {
      await new Promise((resolve) => {
        window.setTimeout(resolve, 280)
      })
      ok = await startLiveMicModeRef.current({ softRestart: false })
    }
    if (!ok) {
      console.warn('[Jarvis] Live mic could not resume after Myra reply')
      setIsListening(false)
    }
  }, [])

  const deliverMyraGeminiResponse = useCallback(
    (fullResponse, afterSpeech, { persistMyra = true, skipSpeech = false } = {}) => {
      const onSpeechDone = async () => {
        setJarvisUiReady(true)
        await afterSpeech?.()
      }

      if (skipSpeech) {
        if (persistMyra) queuePersistHistoryEntry('myra', fullResponse)
        jarvisBusyRef.current = false
        setIsAiThinking(false)
        setUserTurnThinking(false)
        setJarvisUiReady(true)
        console.info('[Axerai DEV META-TEST] Audit report — read on screen (TTS skipped)')
        void afterSpeech?.()
        return
      }

      // Save as soon as Gemini returns — iPhone may defer TTS until Meet Myra tap.
      if (persistMyra) queuePersistHistoryEntry('myra', fullResponse)

      if (myraResponseShouldEndSession(fullResponse)) {
        speakMyraReply(
          fullResponse,
          async () => {
            await waitForMyraSpeechToFinish()
            endExperienceRef.current?.()
          },
        )
        return
      }

      speakMyraReply(fullResponse, onSpeechDone)
    },
    [speakMyraReply],
  )

  const sendMyraUserMessage = useCallback(
    async (userText, { cycleId } = {}) => {
      if (!isGeminiConfigured()) {
        speakMyraErrorLine(MYRA_ERROR_SITUATIONS.CHAT_CONNECTION_WEAK, resumeMicAfterGemini)
        return
      }
      const trimmed = String(userText).trim()
      if (!trimmed) return
      if (cycleId != null && jarvisMicCycleRef.current !== cycleId) return

      window.speechSynthesis.cancel()
      stopElevenLabsSpeech()
      jarvisMicCycleRef.current += 1
      clearJarvisSpeechTimer()

      try {
        jarvisRecognitionRef.current?.abort()
      } catch {
        // ignore
      }

      if (!jarvisActiveRef.current) {
        jarvisActiveRef.current = true
        jarvisBusyRef.current = false
      }

      pauseMicForGemini()
      setUserTurnThinking(true)

      try {
        queuePersistHistoryEntry('user', trimmed)

        const prompt = buildMyraUserPrompt({
          type: 'reply',
          userText: trimmed,
          liveContext: liveContextRef.current,
          memoryText: buildGeminiMemoryText({ userText: trimmed }),
          sessionRole: getSessionRole(),
        })

        const route = resolveMyraChatModels({
          sessionRole: getSessionRole(),
        })

        const fullResponse = await askGemini(prompt, {
          models: route.models,
          tier: route.tier,
          reason: route.reason,
        })
        incrementMyraChatTurn()
        const cleanResponse = prepareMyraSpeechText(fullResponse, {
          keepAudioTags: shouldKeepMyraTtsAudioTags(),
        })

        console.log('[Jarvis] Myra says:', cleanResponse)
        deliverMyraGeminiResponse(fullResponse, resumeMicAfterGemini)
      } catch (error) {
        console.error('[Jarvis] Gemini AI error:', error)
        speakMyraErrorLine(
          classifyGeminiError(error, MYRA_ERROR_PHASE.CHAT),
          resumeMicAfterGemini,
        )
      }
    },
    [
      askGemini,
      pauseMicForGemini,
      speakMyraErrorLine,
      resumeMicAfterGemini,
      deliverMyraGeminiResponse,
      clearJarvisSpeechTimer,
    ],
  )

  const handleSendCompose = useCallback(() => {
    if (isAiThinking || isMyraTalking) return
    unlockMobileSpeechAudio({ force: true })
    const text = composeText.trim()
    if (!text) return

    sendMyraUserMessage(text)
    setComposeText('')
  }, [composeText, isAiThinking, isMyraTalking, sendMyraUserMessage])

  const handleComposeKeyDown = useCallback(
    (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        handleSendCompose()
      }
    },
    [handleSendCompose],
  )

  const prepareJarvisMode = useCallback(async () => {
    const useDeepgram = isDeepgramSttConfigured()
    if (useDeepgram) {
      if (!isDeepgramSttSupported()) {
        console.error('[Jarvis] Deepgram STT enabled but MediaRecorder is not supported')
        return false
      }
    } else {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
      if (!SpeechRecognition) {
        console.error('[Jarvis] Speech Recognition is not supported in this browser')
        return false
      }
    }
    if (!isGeminiConfigured()) {
      console.error(
        '[Jarvis] Gemini missing — local: VITE_GEMINI_API_KEY | Netlify: GEMINI_API_KEY (Functions scope).',
      )
      return false
    }

    const micReady = await ensureMicPermission()
    if (!micReady) {
      console.error('[Jarvis] Allow microphone access in the browser to talk to Myra')
      return false
    }

    jarvisActiveRef.current = true
    jarvisBusyRef.current = false
    return true
  }, [ensureMicPermission])

  const clearLiveMicSilenceTimer = useCallback(() => {
    if (liveMicSilenceTimerRef.current) {
      clearTimeout(liveMicSilenceTimerRef.current)
      liveMicSilenceTimerRef.current = null
    }
  }, [])

  const rescheduleLiveMicSend = useCallback(() => {
    clearLiveMicSilenceTimer()
    liveMicSilenceTimerRef.current = setTimeout(() => {
      liveMicSilenceTimerRef.current = null
      flushLiveMicUtteranceRef.current?.()
    }, LIVE_MIC_SILENCE_MS)
  }, [clearLiveMicSilenceTimer])

  const flushLiveMicUtteranceRef = useRef(null)

  const flushLiveMicUtterance = useCallback(() => {
    // User is fixing STT text — never auto-send over their edit.
    if (liveMicEditingRef.current) {
      clearLiveMicSilenceTimer()
      return
    }

    const text = liveMicDisplayRef.current.trim()
    if (
      !text ||
      composeModeRef.current !== 'liveMic' ||
      jarvisBusyRef.current ||
      aiSpeakingRef.current
    ) {
      clearLiveMicSilenceTimer()
      return
    }

    // Send when transcript text is unchanged for LIVE_MIC_SILENCE_MS.
    const quietFor = Date.now() - liveMicLastSpeechAtRef.current
    if (quietFor < LIVE_MIC_SILENCE_MS) {
      rescheduleLiveMicSend()
      return
    }

    clearLiveMicSilenceTimer()
    liveMicDisplayRef.current = ''
    liveMicFinalRef.current = ''
    liveMicPendingInterimRef.current = false
    liveMicLastSpeechAtRef.current = 0
    liveMicLastVoiceAtRef.current = 0
    liveMicEditingRef.current = false
    setLiveMicEditing(false)
    setLiveMicEditDraft('')
    setLiveTranscript('')

    liveMicDeepgramRef.current?.resetSegment()
    sendMyraUserMessageRef.current(text)
  }, [clearLiveMicSilenceTimer, rescheduleLiveMicSend])

  useEffect(() => {
    flushLiveMicUtteranceRef.current = flushLiveMicUtterance
  }, [flushLiveMicUtterance])

  const scheduleLiveMicSend = useCallback(() => {
    if (liveMicEditingRef.current) return
    rescheduleLiveMicSend()
  }, [rescheduleLiveMicSend])

  const applyLiveMicTranscript = useCallback(
    (display, { hasInterim = false, speechFinal = false } = {}) => {
      if (liveMicEditingRef.current) return
      const trimmed = String(display ?? '').trim()
      if (!trimmed) return

      const previous = liveMicDisplayRef.current
      if (!hasInterim) {
        liveMicFinalRef.current = trimmed
      }
      liveMicDisplayRef.current = trimmed
      liveMicPendingInterimRef.current = hasInterim
      if (trimmed !== previous) {
        liveMicLastSpeechAtRef.current = Date.now()
      }
      setLiveTranscript(trimmed)
      setIsListening(true)
      if (speechFinal && !hasInterim) {
        liveMicLastSpeechAtRef.current =
          Date.now() - LIVE_MIC_SILENCE_MS + LIVE_MIC_SPEECH_FINAL_QUIET_MS
      }
      scheduleLiveMicSend()
    },
    [scheduleLiveMicSend],
  )

  const beginLiveMicEdit = useCallback(() => {
    const text = (liveMicDisplayRef.current || liveTranscript).trim()
    if (!text) return
    clearLiveMicSilenceTimer()
    liveMicEditingRef.current = true
    setLiveMicEditing(true)
    setLiveMicEditDraft(text)
  }, [clearLiveMicSilenceTimer, liveTranscript])

  const cancelLiveMicEdit = useCallback(() => {
    liveMicEditingRef.current = false
    setLiveMicEditing(false)
    setLiveMicEditDraft('')
    // Recognition may have ended while editing — restart listening.
    if (
      composeModeRef.current === 'liveMic' &&
      !jarvisBusyRef.current &&
      !aiSpeakingRef.current &&
      !liveMicRecognitionRef.current &&
      !liveMicDeepgramRef.current
    ) {
      void startLiveMicModeRef.current({ softRestart: true })
      return
    }
    if (liveMicDisplayRef.current.trim()) {
      liveMicLastSpeechAtRef.current = Date.now()
      rescheduleLiveMicSend()
    }
  }, [rescheduleLiveMicSend])

  const sendLiveMicEdited = useCallback(() => {
    const text = liveMicEditDraft.trim()
    if (!text) return
    clearLiveMicSilenceTimer()
    liveMicEditingRef.current = false
    setLiveMicEditing(false)
    setLiveMicEditDraft('')
    liveMicDisplayRef.current = ''
    liveMicFinalRef.current = ''
    liveMicPendingInterimRef.current = false
    liveMicLastSpeechAtRef.current = 0
    liveMicLastVoiceAtRef.current = 0
    setLiveTranscript('')
    liveMicDeepgramRef.current?.resetSegment()
    sendMyraUserMessageRef.current(text)
  }, [clearLiveMicSilenceTimer, liveMicEditDraft])

  /** Heart visual only — never hold getUserMedia on Android (steals mic from SpeechRecognition). */
  const startProceduralLiveMicLevels = useCallback(() => {
    if (liveMicRafRef.current) {
      cancelAnimationFrame(liveMicRafRef.current)
      liveMicRafRef.current = null
    }
    let phase = 0
    const tick = () => {
      if (composeModeRef.current !== 'liveMic') return
      phase += 0.18
      const base = 0.18 + (Math.sin(phase) * 0.5 + 0.5) * 0.35
      setVoiceLevels(Array.from({ length: 12 }, (_, index) => Math.min(1, base + (index % 3) * 0.04)))
      liveMicRafRef.current = requestAnimationFrame(tick)
    }
    tick()
  }, [])

  const startLiveMicAnalyser = useCallback(async () => {
    // Android Chrome: getUserMedia + webkitSpeechRecognition cannot share the mic.
    // Keyboard/PTT works because it does not keep an analyser stream open.
    if (isAndroidBrowser()) {
      startProceduralLiveMicLevels()
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: sttAudioConstraints(),
        video: false,
      })
      liveMicStreamRef.current = stream
      const audioCtx = new AudioContext()
      liveMicAudioCtxRef.current = audioCtx
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume().catch(() => {})
      }
      const source = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 64
      source.connect(analyser)
      liveMicAnalyserRef.current = analyser

      const tick = () => {
        const node = liveMicAnalyserRef.current
        if (!node) return
        const bins = new Uint8Array(node.frequencyBinCount)
        node.getByteFrequencyData(bins)
        const avg = bins.reduce((sum, value) => sum + value, 0) / Math.max(1, bins.length)
        const chunk = Math.max(1, Math.floor(bins.length / 12))
        const levels = Array.from({ length: 12 }, (_, index) => {
          const slice = bins.slice(index * chunk, (index + 1) * chunk)
          const sliceAvg = slice.reduce((sum, value) => sum + value, 0) / slice.length
          return Math.max(0.12, Math.min(1, sliceAvg / 90))
        })
        setVoiceLevels(levels)

        // Voice energy drives the heart visual only — never resets the send timer.
        if (avg > LIVE_MIC_VOICE_ENERGY) {
          liveMicLastVoiceAtRef.current = Date.now()
        }

        liveMicRafRef.current = requestAnimationFrame(tick)
      }
      tick()
    } catch (error) {
      console.warn('[Jarvis] Live mic analyser failed:', error)
      startProceduralLiveMicLevels()
    }
  }, [startProceduralLiveMicLevels])

  const startLiveMicMode = useCallback(async ({ softRestart = false } = {}) => {
    if (aiSpeakingRef.current || jarvisBusyRef.current) {
      return false
    }

    if (isAppleMobileBrowser()) {
      pauseAppleUnlockLoop()
    }

    const useDeepgram = isDeepgramSttConfigured()
    if (!useDeepgram) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
      if (!SpeechRecognition) {
        console.error('[Jarvis] Speech Recognition is not supported in this browser')
        return false
      }
    } else if (!isDeepgramSttSupported()) {
      console.error('[Jarvis] Deepgram STT enabled but MediaRecorder is not supported')
      return false
    }

    const micReady = await ensureMicPermission()
    if (!micReady) return false

    const android = isAndroidBrowser()
    const deepgramAndroid = useDeepgram && android

    if (!softRestart) {
      stopLiveMicMode()
      stopMicStream()
      try {
        jarvisRecognitionRef.current?.abort()
      } catch {
        // ignore
      }
      jarvisRecognitionRef.current = null
      if (deepgramAndroid || !android) {
        await startLiveMicAnalyser()
      } else {
        stopMicStream()
        startProceduralLiveMicLevels()
      }
    } else {
      clearLiveMicSilenceTimer()
      liveMicDisplayRef.current = ''
      liveMicFinalRef.current = ''
      liveMicPendingInterimRef.current = false
      liveMicLastSpeechAtRef.current = 0
      liveMicLastVoiceAtRef.current = 0
      liveMicEditingRef.current = false
      setLiveMicEditing(false)
      setLiveMicEditDraft('')
      setLiveTranscript('')

      try {
        liveMicRecognitionRef.current?.abort()
      } catch {
        // ignore
      }
      liveMicRecognitionRef.current = null
      liveMicDeepgramRef.current?.abort()
      liveMicDeepgramRef.current = null

      if (deepgramAndroid || !android) {
        const streamAlive = liveMicStreamRef.current?.active
        const analyserAlive = Boolean(liveMicAnalyserRef.current)
        if (!streamAlive || !analyserAlive) {
          await startLiveMicAnalyser()
        } else if (liveMicAudioCtxRef.current?.state === 'suspended') {
          await liveMicAudioCtxRef.current.resume().catch(() => {})
        }
      } else {
        stopMicStream()
        startProceduralLiveMicLevels()
      }
    }

    if (useDeepgram) {
      try {
        if (android) {
          stopMicStream()
        }
        const transcriber = createLiveMicTranscriber({
          onTranscript: ({ transcript, isFinal, speechFinal }) => {
            applyLiveMicTranscript(transcript, {
              hasInterim: !isFinal,
              speechFinal: Boolean(speechFinal),
            })
          },
          onError: (error) => {
            console.warn('[Jarvis] Deepgram live mic error:', error)
          },
        })
        liveMicDeepgramRef.current = transcriber
        await transcriber.start(liveMicStreamRef.current)
        setIsListening(true)
        jarvisActiveRef.current = true
        console.info('[Jarvis] Live mic — Deepgram', transcriber.getMode?.() ?? 'stream')
        return true
      } catch (error) {
        console.error('[Jarvis] Deepgram live mic start failed:', error)
        stopLiveMicMode()
        return false
      }
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    const recognition = new SpeechRecognition()
    liveMicRecognitionRef.current = recognition
    // Android Chrome: continuous:true is flaky; one-shot + restart is more reliable.
    recognition.continuous = !android
    recognition.interimResults = true
    recognition.lang = SPEECH_RECO_LANG
    recognition.maxAlternatives = 1

    recognition.onresult = (speechEvent) => {
      // User is fixing the line — ignore new STT until they Send / Cancel edit.
      if (liveMicEditingRef.current) return

      let committed = ''
      let interim = ''
      let hasInterim = false

      for (let i = 0; i < speechEvent.results.length; i += 1) {
        const result = speechEvent.results[i]
        const piece = result[0]?.transcript ?? ''
        if (result.isFinal) {
          committed += piece
        } else {
          interim += piece
          hasInterim = true
        }
      }

      const display = `${committed}${interim}`.trim()
      applyLiveMicTranscript(display, { hasInterim })
    }

    recognition.onerror = (errorEvent) => {
      const err = errorEvent.error
      // no-speech / aborted: let onend restart quietly (do not softRestart — clears text + beeps).
      if (err === 'aborted' || err === 'no-speech') return
      if (err === 'not-allowed') {
        console.warn('[Jarvis] Live mic blocked:', err)
        return
      }
      console.warn('[Jarvis] Live mic error:', err)
      if (
        composeModeRef.current === 'liveMic' &&
        !jarvisBusyRef.current &&
        !aiSpeakingRef.current &&
        (err === 'network' || err === 'service-not-allowed' || err === 'bad-grammar')
      ) {
        window.setTimeout(() => {
          if (composeModeRef.current !== 'liveMic' || jarvisBusyRef.current || aiSpeakingRef.current) {
            return
          }
          startLiveMicModeRef.current({ softRestart: true })
        }, 600)
      }
    }

    recognition.onend = () => {
      if (
        composeModeRef.current !== 'liveMic' ||
        jarvisBusyRef.current ||
        aiSpeakingRef.current ||
        liveMicEditingRef.current
      ) {
        return
      }
      if (liveMicDisplayRef.current.trim()) {
        scheduleLiveMicSend()
      }
      window.setTimeout(() => {
        if (
          composeModeRef.current !== 'liveMic' ||
          jarvisBusyRef.current ||
          aiSpeakingRef.current
        ) {
          return
        }
        // Same instance restart; if Android rejects it, recreate without wiping transcript.
        try {
          liveMicRecognitionRef.current?.start()
        } catch {
          if (!android) return
          try {
            const next = new SpeechRecognition()
            liveMicRecognitionRef.current = next
            next.continuous = false
            next.interimResults = true
            next.lang = SPEECH_RECO_LANG
            next.maxAlternatives = 1
            next.onresult = recognition.onresult
            next.onerror = recognition.onerror
            next.onend = recognition.onend
            next.start()
          } catch (restartError) {
            console.warn('[Jarvis] Android live mic restart failed:', restartError)
          }
        }
      }, android ? 180 : 280)
    }

    try {
      // Ensure no leftover getUserMedia holds the mic on Android before STT starts.
      if (android) {
        stopMicStream()
      }
      recognition.start()
      setIsListening(true)
      jarvisActiveRef.current = true
      return true
    } catch (error) {
      console.error('[Jarvis] Live mic start failed:', error)
      stopLiveMicMode()
      return false
    }
  }, [
    applyLiveMicTranscript,
    ensureMicPermission,
    scheduleLiveMicSend,
    startLiveMicAnalyser,
    startProceduralLiveMicLevels,
    stopLiveMicMode,
    stopMicStream,
  ])

  const toggleComposeMode = useCallback(
    (mode) => {
      unlockMobileSpeechAudio({ force: true })
      if (composeMode === mode) {
        if (mode === 'keyboard') {
          setComposeMode('liveMic')
          composeModeRef.current = 'liveMic'
          startLiveMicMode()
          return
        }
        setComposeMode(null)
        composeModeRef.current = null
        stopLiveMicMode()
        return
      }

      setComposeMode(mode)
      composeModeRef.current = mode
      if (mode === 'keyboard') {
        stopLiveMicMode()
        window.setTimeout(() => composeInputRef.current?.focus(), 80)
        return
      }

      if (mode === 'liveMic') {
        setComposeText('')
        startLiveMicMode()
      }
    },
    [composeMode, startLiveMicMode, stopLiveMicMode],
  )

  useEffect(() => {
    composeModeRef.current = composeMode
  }, [composeMode])

  useEffect(() => {
    if (reelRecord.isRecording) {
      void reelRecord.syncLiveMicToCapture()
    }
  }, [composeMode, reelRecord.isRecording, reelRecord.syncLiveMicToCapture])

  useEffect(() => {
    sendMyraUserMessageRef.current = sendMyraUserMessage
    startLiveMicModeRef.current = startLiveMicMode
  }, [sendMyraUserMessage, startLiveMicMode])

  useEffect(() => {
    const el = liveTranscriptScrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [liveTranscript])

  const commitPttTranscript = useCallback(() => {
    if (pttCommittedRef.current) return
    pttCommittedRef.current = true

    if (pttEndListenerRef.current) {
      window.removeEventListener('pointerup', pttEndListenerRef.current)
      window.removeEventListener('pointercancel', pttEndListenerRef.current)
      pttEndListenerRef.current = null
    }

    const text = pttTranscriptRef.current.trim()
    pttTranscriptRef.current = ''
    pttHoldingRef.current = false
    setIsListening(false)

    try {
      jarvisRecognitionRef.current?.abort()
    } catch {
      // ignore
    }
    jarvisRecognitionRef.current = null

    if (text) {
      console.log('[Jarvis] Push-to-talk:', text)
      sendMyraUserMessage(text)
      return
    }

    console.warn('[Jarvis] PTT: no speech detected')
    speakMyraErrorLine(MYRA_ERROR_SITUATIONS.NO_SPEECH)
  }, [sendMyraUserMessage, speakMyraErrorLine])

  const attachPttReleaseListeners = useCallback(() => {
    if (pttEndListenerRef.current) return

    const onRelease = () => {
      endPushToTalkRef.current()
    }

    pttEndListenerRef.current = onRelease
    window.addEventListener('pointerup', onRelease)
    window.addEventListener('pointercancel', onRelease)
  }, [])

  const detachPttReleaseListeners = useCallback(() => {
    if (!pttEndListenerRef.current) return
    window.removeEventListener('pointerup', pttEndListenerRef.current)
    window.removeEventListener('pointercancel', pttEndListenerRef.current)
    pttEndListenerRef.current = null
  }, [])

  const startPushToTalkRecognition = useCallback(() => {
    if (isDeepgramSttConfigured()) {
      stopMicStream()
      pttCommittedRef.current = false

      try {
        jarvisRecognitionRef.current?.abort()
      } catch {
        // ignore
      }
      jarvisRecognitionRef.current = null
      pttDeepgramRef.current?.abort()
      pttDeepgramRef.current = createPttTranscriber()

      void (async () => {
        try {
          await pttDeepgramRef.current.start()
          console.log('[Jarvis] PTT listening started — Deepgram')
        } catch (error) {
          console.error('[Jarvis] Deepgram PTT start failed:', error)
          pttDeepgramRef.current = null
          if (pttHoldingRef.current) {
            pttHoldingRef.current = false
            setIsListening(false)
            detachPttReleaseListeners()
            speakMyraErrorLine(MYRA_ERROR_SITUATIONS.MIC_BLOCKED)
          }
        }
      })()

      return true
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) return false

    stopMicStream()
    pttCommittedRef.current = false

    try {
      jarvisRecognitionRef.current?.abort()
    } catch {
      // ignore
    }

    const recognition = new SpeechRecognition()
    jarvisRecognitionRef.current = recognition
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = SPEECH_RECO_LANG
    recognition.maxAlternatives = 1

    recognition.onresult = (speechEvent) => {
      let text = ''
      for (let i = 0; i < speechEvent.results.length; i += 1) {
        text += speechEvent.results[i][0]?.transcript ?? ''
      }
      const trimmed = text.trim()
      if (trimmed) {
        pttTranscriptRef.current = trimmed
        console.log('[Jarvis] PTT hearing:', trimmed)
      }
    }

    recognition.onerror = (errorEvent) => {
      console.warn('[Jarvis] PTT mic error:', errorEvent.error)
      if (errorEvent.error === 'not-allowed' || errorEvent.error === 'service-not-allowed') {
        pttHoldingRef.current = false
        commitPttTranscript()
      }
    }

    recognition.onend = () => {
      if (pttHoldingRef.current) {
        try {
          recognition.start()
        } catch (error) {
          console.warn('[Jarvis] PTT restart failed:', error)
          pttHoldingRef.current = false
          commitPttTranscript()
        }
        return
      }

      const text = pttTranscriptRef.current.trim()
      if (text) {
        commitPttTranscript()
      } else {
        pttCommittedRef.current = true
        detachPttReleaseListeners()
        pttHoldingRef.current = false
        setIsListening(false)
        jarvisRecognitionRef.current = null
      }
    }

    try {
      recognition.start()
      console.log('[Jarvis] PTT listening started')
      return true
    } catch (error) {
      console.error('[Jarvis] Push-to-talk start failed:', error)
      jarvisRecognitionRef.current = null
      return false
    }
  }, [commitPttTranscript, detachPttReleaseListeners, speakMyraErrorLine, stopMicStream])

  const startPushToTalk = useCallback(
    async (event) => {
      if (event?.button != null && event.button !== 0) return
      event?.preventDefault()
      if (isAiThinking || isMyraTalking || pttHoldingRef.current) return
      unlockMobileSpeechAudio({ force: true })

      const button = event?.currentTarget
      if (button?.setPointerCapture && event.pointerId != null) {
        try {
          button.setPointerCapture(event.pointerId)
        } catch {
          // ignore
        }
      }

      pttHoldingRef.current = true
      pttTranscriptRef.current = ''
      pttCommittedRef.current = false
      setIsListening(true)
      attachPttReleaseListeners()

      if (!jarvisActiveRef.current) {
        pttStartInFlightRef.current = true
        const ready = await prepareJarvisMode()
        pttStartInFlightRef.current = false

        if (!ready || !pttHoldingRef.current) {
          pttHoldingRef.current = false
          setIsListening(false)
          detachPttReleaseListeners()
          return
        }
      }

      if (!startPushToTalkRecognition()) {
        pttHoldingRef.current = false
        setIsListening(false)
        detachPttReleaseListeners()
        speakMyraErrorLine(MYRA_ERROR_SITUATIONS.MIC_BLOCKED)
      }
    },
    [
      isAiThinking,
      isMyraTalking,
      prepareJarvisMode,
      speakMyraErrorLine,
      startPushToTalkRecognition,
      attachPttReleaseListeners,
      detachPttReleaseListeners,
    ],
  )

  const endPushToTalk = useCallback(
    (event) => {
      if (!pttHoldingRef.current && !pttStartInFlightRef.current) return

      const button = event?.currentTarget
      if (button?.releasePointerCapture && event?.pointerId != null) {
        try {
          button.releasePointerCapture(event.pointerId)
        } catch {
          // ignore
        }
      }

      pttHoldingRef.current = false
      setIsListening(false)
      detachPttReleaseListeners()

      if (pttStartInFlightRef.current) return

      const pttDeepgram = pttDeepgramRef.current
      if (pttDeepgram) {
        void (async () => {
          try {
            const transcript = await pttDeepgram.stopAndTranscribe()
            pttDeepgramRef.current = null
            if (transcript) {
              pttTranscriptRef.current = transcript
            }
          } catch (error) {
            console.warn('[Jarvis] Deepgram PTT transcribe failed:', error)
            pttDeepgramRef.current = null
          }
          commitPttTranscript()
        })()
        return
      }

      const recognition = jarvisRecognitionRef.current
      if (!recognition) {
        if (!pttCommittedRef.current) commitPttTranscript()
        return
      }

      recognition.onend = () => {
        commitPttTranscript()
      }

      try {
        recognition.stop()
      } catch {
        commitPttTranscript()
      }
    },
    [commitPttTranscript, detachPttReleaseListeners],
  )

  useEffect(() => {
    endPushToTalkRef.current = endPushToTalk
  }, [endPushToTalk])

  const clearWelcomeDelayTimer = useCallback(() => {
    if (welcomeDelayTimerRef.current) {
      clearTimeout(welcomeDelayTimerRef.current)
      welcomeDelayTimerRef.current = null
    }
  }, [])

  const speakMyraWelcome = useCallback(async () => {
    window.speechSynthesis.cancel()
    stopElevenLabsSpeech()
    unlockMobileSpeechAudio({ force: true })
    setIsAiThinking(true)

    const afterWelcomeSpeech = async () => {
      spokeForScanRef.current = true
      unlockMobileSpeechAudio({ force: true })
      if (isGeminiConfigured()) {
        jarvisActiveRef.current = true
        jarvisBusyRef.current = false
      }
      setComposeMode('keyboard')
      composeModeRef.current = 'keyboard'
      window.setTimeout(() => composeInputRef.current?.focus(), 120)
    }

    const finishWelcome = (text) => {
      markBootComplete()
      deliverMyraGeminiResponse(text, afterWelcomeSpeech)
    }

    const finishWelcomeError = (situation) => {
      markBootComplete()
      const line = pickMyraErrorLine(situation)
      deliverMyraGeminiResponse(line, afterWelcomeSpeech)
    }

    if (!isGeminiConfigured()) {
      finishWelcomeError(MYRA_ERROR_SITUATIONS.WELCOME_MAGIC_OFF)
      return
    }

    try {
      registerProductScan()
      liveContextRef.current = getOpeningLiveContext()
      startLiveContextRefresh((ctx) => {
        liveContextRef.current = ctx
      })
      const liveContext = liveContextRef.current

      const welcomeMode = getLedgerWelcomeMode()

      const { mode: memoryMode } = prepareBrowserMemoryForSession({
        verificationCode: getLedgerSessionInfo().code,
        scheduleBackfill: ledgerNeedsSummaryBackfill(),
      })
      if (memoryMode === 'conversation-first') {
        console.info('[Jarvis] conversation-first welcome — summaries building in background')
      }

      const memoryText = buildGeminiMemoryText()
      const openingType = resolveMyraOpeningPromptType({
        type: 'welcome',
        memoryText,
        welcomeMode,
      })

      const prompt = buildMyraUserPrompt({
        type: openingType,
        liveContext,
        memoryText,
        sessionRole: getSessionRole(),
        welcomeMode,
      })

      const welcomeRoute = resolveMyraChatModels({
        isOpeningAfterVerify: true,
        sessionRole: getSessionRole(),
      })

      const fullResponse = await askGemini(prompt, {
        models: welcomeRoute.models,
        tier: welcomeRoute.tier,
        reason: 'opening-after-verify-lite',
      })
      const cleanResponse = prepareMyraSpeechText(fullResponse, {
        keepAudioTags: shouldKeepMyraTtsAudioTags(),
      })
      console.log(`[Jarvis] Myra ${openingType}:`, cleanResponse)
      finishWelcome(fullResponse)
    } catch (error) {
      console.error('[Jarvis] Welcome Gemini error:', error)
      setIsAiThinking(false)
      finishWelcomeError(classifyGeminiError(error, MYRA_ERROR_PHASE.WELCOME))
    }
  }, [askGemini, deliverMyraGeminiResponse])

  const ensureMyraWelcome = useCallback(
    ({ delayMs = 0, reason = '' } = {}) => {
      if (spokeForScanRef.current || welcomeInFlightRef.current) return

      const run = () => {
        welcomeDelayTimerRef.current = null
        if (spokeForScanRef.current || welcomeInFlightRef.current) return
        welcomeInFlightRef.current = true
        console.info('[Jarvis] Myra welcome start:', reason || 'scan')
        void speakMyraWelcome().finally(() => {
          welcomeInFlightRef.current = false
        })
      }

      clearWelcomeDelayTimer()
      if (delayMs > 0) {
        welcomeDelayTimerRef.current = window.setTimeout(run, delayMs)
        return
      }
      run()
    },
    [clearWelcomeDelayTimer, speakMyraWelcome],
  )

  // --- END GEMINI LOGIC ---

  function releasePreviewCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null

    const videoStream = videoRef.current?.srcObject
    if (videoStream instanceof MediaStream) {
      videoStream.getTracks().forEach((track) => track.stop())
    }
  }

  function stopStandardVideo() {
    releasePreviewCamera()

    if (videoRef.current) {
      videoRef.current.srcObject = null
      videoRef.current.load()
    }

    setVideoReady(false)
  }

  function stopAllCameraStreams() {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    arStreamRef.current?.getTracks().forEach((track) => track.stop())
    arStreamRef.current = null
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setVideoReady(false)
    setTorchOn(false)
  }

  function clearMindARDelay() {
    if (mindarDelayRef.current) {
      clearTimeout(mindarDelayRef.current)
      mindarDelayRef.current = null
    }
  }

  function scheduleMindAR(force = false) {
    if (!force && experienceViewMode !== 'ar') return
    clearMindARDelay()
    const stream = streamRef.current
    if (!stream?.active) return

    stripAudioTracksFromStream(stream)

    mindarReadyRef.current = false
    setMindarReady(false)
    arStreamRef.current = stream
    setArPreviewStream(stream)
    setArCameraProfile(resolveMindARCameraFromStream(stream, cameraFacing))
    setShowMindAR(true)
  }

  scheduleMindARRef.current = scheduleMindAR

  const releasePreviewForMindAR = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    releasePreviewCamera()
  }, [])

  const handleMindARReady = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setVideoReady(false)
    mindarReadyRef.current = true
    setMindarReady(true)
    if (!isVerifiedRef.current) {
      setShowScanGuide(true)
    }
  }, [])

  const handleMindARError = useCallback((message) => {
    if (mindarReadyRef.current) {
      console.warn('[MindAR] ignoring stale session error:', message)
      return
    }

    const msg = String(message ?? '')

    if (isMindARFeedGlitch(msg)) {
      console.warn('[MindAR] camera feed slow — retrying quietly:', msg)
      setShowMindAR(false)
      setMindarReady(false)
      mindarReadyRef.current = false
      arStreamRef.current = null
      setArPreviewStream(null)
      setArCameraProfile(null)
      window.setTimeout(() => {
        if (!restartingScanRef.current && !exitClosingRef.current) {
          scheduleMindARRef.current(true)
        }
      }, 600)
      return
    }

    console.error('[MindAR] session error:', msg)
    setShowMindAR(false)
    setMindarReady(false)
    mindarReadyRef.current = false
    arStreamRef.current = null
    setArPreviewStream(null)
    setArCameraProfile(null)
  }, [])

  const handleTargetVideoEnded = useCallback(() => {
    // Always mark video done so Myra can appear even if verify failed / still running.
    setTargetVideoDone(true)
    targetVideoDoneRef.current = true
    if (!isVerifiedRef.current) return
    ensureMyraWelcome({ reason: 'target-video-ended' })
  }, [ensureMyraWelcome])

  const completeVerification = useCallback(
    async (verificationCode) => {
      if (isLedgerConfigured()) {
        const access = await prefetchLedgerMemory(verificationCode)
        if (access?.allowed === false) {
          // Card is real, but this phone is a 3rd device — reject with Myra dialogue.
          setShowScanGuide(false)
          setForceShowMyra(true)
          setVerifyFailNote(verifyFailUserNote(MYRA_ERROR_SITUATIONS.SCAN_PAIR_FULL))
          speakMyraErrorLine(MYRA_ERROR_SITUATIONS.SCAN_PAIR_FULL)
          return
        }

        const ledgerScan = await startLedgerScan(verificationCode)
        if (ledgerScan?.rejected) {
          setShowScanGuide(false)
          setForceShowMyra(true)
          setVerifyFailNote(verifyFailUserNote(MYRA_ERROR_SITUATIONS.SCAN_PAIR_FULL))
          speakMyraErrorLine(MYRA_ERROR_SITUATIONS.SCAN_PAIR_FULL)
          return
        }
        if (!ledgerScan) {
          speakMyraErrorLine(MYRA_ERROR_SITUATIONS.LEDGER_SAVE_FAIL)
        } else {
          console.info('[Ledger] session', getLedgerSessionInfo())
        }
        prepareBrowserMemoryForSession({
          verificationCode,
          scheduleBackfill: false,
        })
      } else {
        console.warn('[Ledger] Keys missing — this scan will not be saved.')
      }

      resetMyraChatTurns()
      resetMyraErrorLineMemory()
      scanSnapshotRef.current = null

      setIsVerified(true)
      isVerifiedRef.current = true
      setShowScanGuide(false)

      // Start welcome ASAP after verify
      ensureMyraWelcome({
        delayMs: targetVideoDoneRef.current ? 0 : 400,
        reason: targetVideoDoneRef.current ? 'verify-video-done' : 'verify-early',
      })
    },
    [ensureMyraWelcome, speakMyraErrorLine],
  )

  const runAnchorVerify = useCallback(
    async (phase, videoEl) => {
      // One Gemini verify per session — locks on first attempt (pass or fail).
      if (isVerifiedRef.current || verifyLockedRef.current || scanSnapInFlightRef.current) return
      if (!videoEl || videoEl.readyState < 2 || videoEl.videoWidth === 0) return

      const lockVerifySession = (situation) => {
        verifyLockedRef.current = true
        setVerifyLocked(true)
        setShowScanGuide(false)
        setForceShowMyra(true)
        if (situation) {
          setVerifyFailNote(verifyFailUserNote(situation))
          speakMyraErrorLine(situation)
        }
      }

      if (!isGeminiVerifyConfigured()) {
        lockVerifySession(MYRA_ERROR_SITUATIONS.SCAN_MAGIC_ASLEEP)
        return
      }

      // Lock BEFORE the network call so MindAR re-tracks cannot burn more tokens.
      verifyLockedRef.current = true
      setVerifyLocked(true)
      setShowScanGuide(false)

      const gen = ++verifyGenerationRef.current
      scanSnapInFlightRef.current = true
      unlockMobileSpeechAudio({ force: true, speechPing: true })
      primeSafariSpeechSynthesis()

      const canvas = drawVideoFrameToCanvas(videoEl)
      scanSnapshotRef.current = null

      try {
        const { verified, verificationCode, failReason } = await recognizeProductFromFrame(canvas)
        if (gen !== verifyGenerationRef.current) return

        if (verified && verificationCode) {
          verifyFailCountRef.current = 0
          setVerifyFailNote('')
          setForceShowMyra(true)
          await completeVerification(verificationCode)
        } else {
          verifyFailCountRef.current += 1
          scanSnapshotRef.current = null
          const situation = verifyFailSituation(failReason)
          void recordLedgerInsight(
            verificationCode || RICHERA_VERIFICATION_CODE,
            'verify_fail',
            String(failReason || 'UNKNOWN'),
          )
          setForceShowMyra(true)
          setVerifyFailNote(verifyFailUserNote(situation))
          speakMyraErrorLine(situation)
          console.info('[Verify] locked after fail — no more Gemini scans this session')
        }
      } catch (err) {
        if (gen !== verifyGenerationRef.current) return
        console.warn('[Verify] anchor snap failed:', err)
        void recordLedgerInsight(RICHERA_VERIFICATION_CODE, 'verify_glitch', 'anchor_snap')
        setForceShowMyra(true)
        setVerifyFailNote(verifyFailUserNote(MYRA_ERROR_SITUATIONS.SCAN_GLITCH))
        speakMyraErrorLine(MYRA_ERROR_SITUATIONS.SCAN_GLITCH)
        console.info('[Verify] locked after glitch — no more Gemini scans this session')
      } finally {
        if (gen === verifyGenerationRef.current) {
          scanSnapInFlightRef.current = false
        }
      }
    },
    [completeVerification, speakMyraErrorLine],
  )

  const handleCardTracked = useCallback(
    (phase, getVideo) => {
      const video = typeof getVideo === 'function' ? getVideo() : null
      if (!video) return
      void runAnchorVerify(phase, video)
    },
    [runAnchorVerify],
  )

  const endExperience = useCallback(async () => {
    if (exitClosingRef.current || restartingScanRef.current) return
    exitClosingRef.current = true
    restartingScanRef.current = true

    // Goodbye / SYSTEM_SLEEP lines must finish on speaker before we cut audio or show exit UI.
    await waitForMyraSpeechToFinish()

    setExitClosing(true)

    window.speechSynthesis.cancel()
    stopElevenLabsSpeech()
    stopJarvisMode()

    try {
      await finishLedgerScan()
      syncLedgerMemoryAfterExit()
      clearMindARDelay()
      setIsVerified(false)
      isVerifiedRef.current = false
      verifyGenerationRef.current += 1
      verifyFailCountRef.current = 0
      verifyLockedRef.current = false
      setVerifyLocked(false)
      setVerifyFailNote('')
      setForceShowMyra(false)
      spokeForScanRef.current = false
      welcomeInFlightRef.current = false
      clearWelcomeDelayTimer()
      setTargetVideoDone(false)
      targetVideoDoneRef.current = false
      setMindarReady(false)
      mindarReadyRef.current = false
      setShowMindAR(false)
      setArPreviewStream(null)
      setArCameraProfile(null)
      setisMyraTalking(false)
      clearMyraSession()
      liveContextRef.current = null
      scanSnapshotRef.current = null
      setComposeText('')
      setSideDockOpen(false)
      reelRecord.resetReelRecord()
      setJarvisUiReady(false)
      setExperienceViewMode('ar')
      stopAllCameraStreams()

      try {
        await grantStartupAccess()
        setCameraError(null)
        scheduleMindAR(true)
        setShowScanGuide(true)
      } catch (error) {
        setShowScanGuide(false)
        setCameraError(
          error instanceof Error ? error.message : 'Could not access camera',
        )
      }
    } finally {
      exitClosingRef.current = false
      setExitClosing(false)
      restartingScanRef.current = false
    }
  }, [clearWelcomeDelayTimer, grantStartupAccess, stopJarvisMode])

  useEffect(() => {
    endExperienceRef.current = endExperience
  }, [endExperience])

  useEffect(() => {
    const onAudioNeedsTap = (event) => {
      const needs = Boolean(event?.detail?.needsTap)
      setNeedsAudioTap(needs)
      if (needs) setJarvisUiReady(true)
    }
    window.addEventListener('axerai-audio-needs-tap', onAudioNeedsTap)
    return () => window.removeEventListener('axerai-audio-needs-tap', onAudioNeedsTap)
  }, [])

  useEffect(() => {
    const saveLedgerOnPageHide = () => {
      if (!isLedgerScanActive()) return
      void finishLedgerScan({ fastExit: true })
    }
    window.addEventListener('pagehide', saveLedgerOnPageHide)
    return () => window.removeEventListener('pagehide', saveLedgerOnPageHide)
  }, [])

  useEffect(() => {
    if (introVisible || exitClosing) {
      syncExperienceViewBucket(null)
      return () => syncExperienceViewBucket(null)
    }

    let bucket = null
    if (isVerified) {
      if (!targetVideoDone) bucket = 'overview'
      else if (experienceViewMode === 'vr') bucket = 'vr'
      else bucket = 'ar'
    } else if (showMindAR && experienceViewMode === 'ar') {
      bucket = 'ar'
    }

    syncExperienceViewBucket(bucket)
    return () => syncExperienceViewBucket(null)
  }, [
    introVisible,
    exitClosing,
    isVerified,
    targetVideoDone,
    experienceViewMode,
    showMindAR,
  ])

  useEffect(() => {
    if (introVisible || !cameraInitReady) return
    if (showMindAR || restartingScanRef.current) return
    scheduleMindAR()
  }, [introVisible, cameraInitReady, showMindAR])

  useEffect(() => {
    if (verifyLocked || isVerified) {
      setShowScanGuide(false)
      return
    }
    if (experienceViewMode === 'ar' && showMindAR && !scanSnapInFlightRef.current) {
      setShowScanGuide(true)
    }
  }, [experienceViewMode, showMindAR, isVerified, mindarReady, verifyLocked])

  const attachCameraToVideo = useCallback(async () => {
    const video = videoRef.current
    const stream = streamRef.current
    if (!video || !stream) return false

    if (video.srcObject !== stream) {
      video.srcObject = stream
    }

    try {
      await video.play()
      setVideoReady(true)
      return true
    } catch {
      return false
    }
  }, [])

  const retryCamera = useCallback(() => {
    setCameraError(null)
    setCameraInitReady(false)
    startupPermissionsDoneRef.current = false
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    void grantStartupAccess().catch((error) => {
      setCameraError(
        error instanceof Error ? error.message : 'Could not access camera',
      )
    })
  }, [grantStartupAccess])

  const restartCameraForAr = useCallback(async () => {
    stopAllCameraStreams()
    setArPreviewStream(null)
    setArCameraProfile(null)
    setShowMindAR(false)
    setMindarReady(false)
    mindarReadyRef.current = false

    try {
      const stream = await acquireCameraStream(selectedDeviceId, cameraFacing)

      streamRef.current = stream
      setCameraError(null)
      await attachCameraToVideo()
      scheduleMindAR(true)
    } catch (err) {
      setVideoReady(false)
      setCameraError(
        err instanceof Error ? err.message : 'Could not access camera',
      )
    }
  }, [attachCameraToVideo, cameraFacing, selectedDeviceId])

  const toggleExperienceViewMode = useCallback(() => {
    if (!isVerified) return

    if (experienceViewMode === 'ar') {
      clearMindARDelay()
      setShowMindAR(false)
      setMindarReady(false)
      mindarReadyRef.current = false
      setArPreviewStream(null)
      setArCameraProfile(null)
      stopAllCameraStreams()
      setExperienceViewMode('vr')
      return
    }

    setExperienceViewMode('ar')
    void restartCameraForAr()
  }, [experienceViewMode, isVerified, restartCameraForAr])

  const bindCameraVideo = useCallback(
    (node) => {
      videoRef.current = node
      if (node) attachCameraToVideo()
    },
    [attachCameraToVideo],
  )

  useEffect(() => {
    if (!introVisible) return undefined

    const handleDeviceChange = () => {
      void loadDevices()
    }
    navigator.mediaDevices?.addEventListener('devicechange', handleDeviceChange)
    return () => {
      navigator.mediaDevices?.removeEventListener('devicechange', handleDeviceChange)
    }
  }, [introVisible, loadDevices])

  useEffect(() => {
    if (introVisible || !cameraInitReady) return

    let cancelled = false

    async function startStream() {
      const activeId =
        streamRef.current?.getVideoTracks()[0]?.getSettings().deviceId
      if (
        selectedDeviceId &&
        activeId === selectedDeviceId &&
        streamRef.current?.active
      ) {
        await attachCameraToVideo()
        return
      }

      const needsMindARRestart =
        mindarReadyRef.current || Boolean(arStreamRef.current?.active)

      if (needsMindARRestart) {
        setShowMindAR(false)
        setMindarReady(false)
        mindarReadyRef.current = false
        setArPreviewStream(null)
        setArCameraProfile(null)
        arStreamRef.current?.getTracks().forEach((track) => track.stop())
        arStreamRef.current = null
      }

      streamRef.current?.getTracks().forEach((track) => track.stop())

      try {
        const stream = await acquireCameraStream(selectedDeviceId, cameraFacing)

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }

        streamRef.current = stream
        setCameraError(null)
        const attached = await attachCameraToVideo()
        if (!attached && !cancelled) {
          window.setTimeout(() => {
            if (!cancelled) void attachCameraToVideo()
          }, 120)
        }
        if (needsMindARRestart && experienceViewMode === 'ar' && !cancelled) {
          scheduleMindAR(true)
        }
      } catch (err) {
        if (cancelled) return
        setVideoReady(false)
        setCameraError(
          err instanceof Error ? err.message : 'Could not access camera',
        )
      }
    }

    startStream()

    return () => {
      cancelled = true
    }
  }, [selectedDeviceId, cameraFacing, introVisible, attachCameraToVideo, cameraInitReady, experienceViewMode])

  useEffect(() => {
    if (isVerified) {
      const track = streamRef.current?.getVideoTracks()[0] ?? null
      applyTrackZoom(track, 1).catch(() => {})
    }
  }, [isVerified, videoReady, selectedDeviceId, cameraFacing])

  const flipCamera = useCallback(async () => {
    if (cameraFlipInFlightRef.current) return
    cameraFlipInFlightRef.current = true
    try {
      const track =
        streamRef.current?.getVideoTracks()[0] ?? arStreamRef.current?.getVideoTracks()[0] ?? null
      await applyTrackTorch(track, false).catch(() => {})
      setTorchOn(false)
      setSelectedDeviceId('')
      setCameraFacing((facing) => (facing === 'environment' ? 'user' : 'environment'))
    } finally {
      window.setTimeout(() => {
        cameraFlipInFlightRef.current = false
      }, 900)
    }
  }, [])

  const getCameraTrack = useCallback(
    () => streamRef.current?.getVideoTracks()[0] ?? arStreamRef.current?.getVideoTracks()[0] ?? null,
    [],
  )

  const toggleTorch = useCallback(async () => {
    const track = getCameraTrack()
    if (!track) return
    const next = !torchOnRef.current
    const ok = await applyTrackTorch(track, next)
    if (ok) setTorchOn(next)
  }, [getCameraTrack])

  const handleViewportDoubleTap = useCallback(() => {
    const now = Date.now()
    if (now - viewportTapRef.current < 340) {
      viewportTapRef.current = 0
      flipCamera()
      return
    }
    viewportTapRef.current = now
  }, [flipCamera])

  useEffect(() => {
    torchOnRef.current = torchOn
  }, [torchOn])

  useEffect(() => {
    const track = getCameraTrack()
    if (!track) {
      setTorchSupported(false)
      return
    }
    const caps = track.getCapabilities?.()
    const supported = Boolean(caps?.torch || caps?.fillLightMode?.includes?.('flash'))
    setTorchSupported(supported)
    if (!supported) {
      setTorchOn(false)
      return
    }
    if (torchOnRef.current) {
      applyTrackTorch(track, true).catch(() => setTorchOn(false))
    }
  }, [videoReady, selectedDeviceId, cameraFacing, isVerified, getCameraTrack])

  useEffect(() => {
    const turnOffTorch = () => {
      const track = streamRef.current?.getVideoTracks()[0] ?? arStreamRef.current?.getVideoTracks()[0] ?? null
      applyTrackTorch(track, false).catch(() => {})
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') turnOffTorch()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  useEffect(() => {
    if (!mainRevealed) return
    attachCameraToVideo()
  }, [mainRevealed, attachCameraToVideo])

  useEffect(() => {
    if (!mainRevealed) return undefined

    const primeOnGesture = () => {
      unlockMobileSpeechAudio({ force: true })
    }

    document.addEventListener('touchstart', primeOnGesture, { passive: true })
    document.addEventListener('click', primeOnGesture, { passive: true })

    return () => {
      document.removeEventListener('touchstart', primeOnGesture)
      document.removeEventListener('click', primeOnGesture)
    }
  }, [mainRevealed])

  useEffect(() => {
    logAxeraiBuildConfig()
  }, [])

  useEffect(() => {
    return () => {
      clearMindARDelay()
      window.speechSynthesis.cancel()
      stopElevenLabsSpeech()
      stopJarvisMode()
      stopMicStream()
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [stopJarvisMode])

  useEffect(() => {
    const syncVoice = () => {
      myraVoiceRef.current = pickMyraVoice()
    }
    syncVoice()
    window.speechSynthesis?.addEventListener('voiceschanged', syncVoice)
    return () => window.speechSynthesis?.removeEventListener('voiceschanged', syncVoice)
  }, [])

  const dockIconClass = 'hud-icon-btn hud-icon-btn--sm flex items-center justify-center rounded-full'

  const sideDockToggleButton = (
    <button
      type="button"
      onClick={() => setSideDockOpen((open) => !open)}
      aria-label={sideDockOpen ? 'Hide controls' : 'Show controls'}
      aria-expanded={sideDockOpen}
      className={dockIconClass}
    >
      <svg viewBox="0 0 24 24" className="hud-icon-btn__glyph" fill="none" stroke="currentColor" strokeWidth="2.2">
        {sideDockOpen ? (
          <path strokeLinecap="round" strokeLinejoin="round" d="M18 15l-6-6-6 6" />
        ) : (
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
        )}
      </svg>
    </button>
  )

  const myraPttButton = (
    <button
      type="button"
      className={`myra-ptt-fingerprint myra-ptt-fingerprint--compact${isListening ? ' myra-ptt-fingerprint--active' : ''}`}
      aria-label={isListening ? 'Listening' : 'Hold to speak'}
      onPointerDown={startPushToTalk}
      onPointerUp={endPushToTalk}
      onPointerCancel={endPushToTalk}
      onLostPointerCapture={endPushToTalk}
      onContextMenu={(event) => event.preventDefault()}
    >
      <span className="myra-ptt-fingerprint__pulse" aria-hidden />
      <span className="myra-ptt-fingerprint__ring myra-ptt-fingerprint__ring--1" aria-hidden />
      <span className="myra-ptt-fingerprint__ring myra-ptt-fingerprint__ring--2" aria-hidden />
      <span className="myra-ptt-fingerprint__ring myra-ptt-fingerprint__ring--3" aria-hidden />
      <svg className="myra-ptt-fingerprint__fp" viewBox="0 0 100 100" fill="none" aria-hidden>
        <path
          d="M50 18c-8 0-14 6-14 14 0 4 2 8 5 10-6 2-10 8-10 14 0 9 7 16 16 16"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <path
          d="M62 24c6 3 10 9 10 16 0 5-2 9-5 12"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <path
          d="M38 30c-5 4-8 10-8 17 0 4 1 7 3 10"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <path
          d="M50 52c5 0 9 4 9 9s-4 9-9 9"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <path
          d="M68 42c4 5 6 11 6 18 0 12-10 22-22 22"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <path
          d="M32 48c-3 5-5 11-5 17 0 14 11 25 25 25"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      </svg>
      <span className="myra-ptt-fingerprint__core" aria-hidden>
        <svg viewBox="0 0 24 24" className="myra-ptt-fingerprint__mic" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" d="M12 14a3 3 0 003-3V6a3 3 0 10-6 0v5a3 3 0 003 3z" />
          <path strokeLinecap="round" d="M19 11v1a7 7 0 01-14 0v-1" />
          <path strokeLinecap="round" d="M12 19v3" />
        </svg>
      </span>
    </button>
  )

  const keyboardButton = (
    <button
      type="button"
      onClick={() => toggleComposeMode('keyboard')}
      aria-label="Keyboard"
      aria-pressed={composeMode === 'keyboard'}
      className={`${dockIconClass}${composeMode === 'keyboard' ? ' hud-icon-btn--active' : ''}`}
    >
      <svg viewBox="0 0 24 24" className="hud-icon-btn__glyph" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="6" width="18" height="12" rx="2" />
        <path strokeLinecap="round" d="M7 10h.01M11 10h.01M15 10h.01M7 14h10" />
      </svg>
    </button>
  )

  const liveMicDockButton = (
    <button
      type="button"
      onClick={() => toggleComposeMode('liveMic')}
      aria-label="Live microphone"
      aria-pressed={composeMode === 'liveMic'}
      className={`${dockIconClass}${composeMode === 'liveMic' ? ' hud-icon-btn--active' : ''}`}
    >
      <svg viewBox="0 0 24 24" className="hud-icon-btn__glyph" fill="none" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" d="M12 14a3 3 0 003-3V6a3 3 0 10-6 0v5a3 3 0 003 3z" />
        <path strokeLinecap="round" d="M19 11v1a7 7 0 01-14 0v-1" />
        <path strokeLinecap="round" d="M12 19v3" />
        <path strokeLinecap="round" d="M8 21h8" />
      </svg>
    </button>
  )

  const arVrToggleButton = isVerified ? (
    <button
      type="button"
      onClick={toggleExperienceViewMode}
      aria-label={experienceViewMode === 'ar' ? 'Switch to VR mode' : 'Switch to AR mode'}
      className={`${dockIconClass} hud-arvr-toggle${experienceViewMode === 'vr' ? ' hud-arvr-toggle--vr' : ''}`}
    >
      {experienceViewMode === 'ar' ? 'VR' : 'AR'}
    </button>
  ) : null

  const flashButton = (
    <button
      type="button"
      onClick={toggleTorch}
      disabled={!torchSupported || cameraFacing === 'user'}
      aria-label={torchOn ? 'Turn flash off' : 'Turn flash on'}
      aria-pressed={torchOn}
      className={`${dockIconClass}${torchOn ? ' hud-icon-btn--active' : ''}`}
    >
      <svg viewBox="0 0 24 24" className="hud-icon-btn__glyph" fill="none" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 2L5 14h6l-1 8 8-12h-6l1-8z" />
      </svg>
    </button>
  )

  const cameraFlipButton = (
    <button
      type="button"
      onClick={flipCamera}
      aria-label="Flip camera"
      className={`${dockIconClass} hud-camera-flip`}
    >
      <svg viewBox="0 0 24 24" className="hud-icon-btn__glyph" fill="none" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" d="M11 7H7a2 2 0 00-2 2v2M7 17h4M13 7h4a2 2 0 012 2v2M17 17h-4" />
        <path strokeLinecap="round" d="M8 4L5 7l3 3M16 20l3-3-3-3" />
      </svg>
    </button>
  )

  return (
    <>
      {introVisible ? (
        <IntroShell
          onExitStart={handleIntroExitStart}
          onExitComplete={handleIntroExitComplete}
          readyToEnter={introReadyToEnter}
          startupAccess={startupAccess}
          startupAccessHint={startupAccessHint}
          onAssetsReady={handleAssetsReady}
          onAutoRequestAccess={handleAutoRequestAccess}
          onGrantAccess={handleGrantAccess}
        />
      ) : null}

      <div className={`axerai-app relative flex h-[100dvh] h-[100svh] w-full flex-col overflow-hidden text-white${mainRevealed ? ' main-reveal--active' : ''}${introVisible ? ' axerai-app--during-intro' : ''}`}>
        <div className="axerai-bg pointer-events-none absolute inset-0" />
        <div className="axerai-grid pointer-events-none absolute inset-0" />
        <div className="axerai-orb axerai-orb--1 pointer-events-none absolute" aria-hidden />
        <div className="axerai-orb axerai-orb--2 pointer-events-none absolute" aria-hidden />
        <div className="axerai-scanlines pointer-events-none absolute inset-0" aria-hidden />

        <div className="relative z-10 flex h-full min-h-0 w-full flex-col">
          {cameraError ? (
            <div className="axerai-stage-error mx-4 mt-4 flex flex-col items-center gap-3 rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-center text-sm text-red-200 backdrop-blur-md">
              <p>{cameraError}</p>
              <button
                type="button"
                onClick={retryCamera}
                className="rounded-full border border-red-300/35 bg-red-950/50 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-red-100"
              >
                Retry camera
              </button>
            </div>
          ) : null}

          <div className="axerai-stage-shell">
            <div className="main-reveal-item main-reveal-item--2 hud-viewport hud-viewport--stage relative h-full min-h-0 w-full flex-1">
              <div ref={reelCaptureRef} className="hud-reel-capture-stage absolute inset-0 overflow-hidden">
              {experienceViewMode === 'ar' && !isVerified ? (
                <button
                  type="button"
                  className="hud-viewport-tap absolute inset-0 z-[3] cursor-default border-0 bg-transparent p-0"
                  aria-label="Double-tap to flip camera"
                  onClick={handleViewportDoubleTap}
                  onContextMenu={(event) => event.preventDefault()}
                />
              ) : null}
              {experienceViewMode === 'ar' && showMindAR && !mindarReady && (
                <video
                  ref={bindCameraVideo}
                  autoPlay
                  playsInline
                  muted
                  onLoadedData={() => setVideoReady(true)}
                  onEmptied={() => setVideoReady(false)}
                  className="absolute inset-0 z-[1] h-full w-full bg-black object-cover transition-transform duration-200"
                />
              )}
              {isVerified && experienceViewMode === 'vr' && (
                <MyraStaticSession
                  backgroundSrc={INTRO_LOADING_BG}
                  showMyra
                  isTalking={isMyraTalking}
                  showThinkingRing={
                    userTurnThinking && isAiThinking && !isMyraTalking
                  }
                  playTargetVideo={!targetVideoDone}
                  onTargetVideoEnded={handleTargetVideoEnded}
                />
              )}
              {experienceViewMode === 'ar' && showMindAR && arPreviewStream && arCameraProfile && (
                <div
                  className={`absolute inset-0 z-[2] ${mindarReady ? 'opacity-100' : 'opacity-0'}`}
                >
                  <MindARSession
                    key={arPreviewStream.id}
                    previewStream={arPreviewStream}
                    cameraProfile={arCameraProfile}
                    onReleasePreview={releasePreviewForMindAR}
                    onError={handleMindARError}
                    onSessionReady={handleMindARReady}
                    onTargetVideoEnded={handleTargetVideoEnded}
                    onCardTracked={handleCardTracked}
                    playTargetVideo
                    showMyra={mindarReady && (isVerified || targetVideoDone || forceShowMyra)}
                    isTalking={isMyraTalking}
                    showThinkingRing={
                      userTurnThinking && isAiThinking && !isMyraTalking
                    }
                  />
                </div>
              )}

              </div>

              {isVerified && jarvisUiReady && !reelRecord.isTrimming ? (
                <div className="hud-reel-dot-layer absolute z-[100] hud-inset-top hud-inset-left">
                  <ReelRecordDockControl
                    recording={reelRecord.isRecording}
                    showStop={reelRecord.showStopMenu}
                    disabled={exitClosing}
                    onDotClick={reelRecord.handleDotClick}
                    onStop={reelRecord.stopRecording}
                  />
                </div>
              ) : null}

              {reelRecord.isTrimming && reelRecord.clipUrl ? (
                <ReelTrimSheet
                  clipUrl={reelRecord.clipUrl}
                  clipDuration={reelRecord.clipDuration}
                  onSave={reelRecord.saveTrimmedClip}
                  onDiscard={reelRecord.finishTrim}
                />
              ) : null}

              {reelToast ? (
                <div
                  className="hud-reel-toast absolute z-[101] left-1/2 bottom-0 -translate-x-1/2"
                  role="status"
                >
                  {reelToast}
                </div>
              ) : null}

              {showScanGuide && experienceViewMode === 'ar' && showMindAR && !isVerified && !verifyLocked ? (
                <div className="hud-scan-guide pointer-events-none absolute inset-x-0 bottom-0 z-[5] flex justify-center pb-8">
                  <div className="hud-scan-guide__card" role="status">
                    <p className="hud-scan-guide__title">Center the RICHERA card</p>
                    <p className="hud-scan-guide__copy">Hold it steady in the middle — we&apos;ll scan automatically</p>
                  </div>
                </div>
              ) : null}

              {verifyFailNote && !isVerified ? (
                <div className="hud-verify-note pointer-events-none absolute inset-x-0 bottom-0 z-[6] flex justify-center pb-8">
                  <div className="hud-verify-note__card" role="status">
                    <p className="hud-verify-note__title">Scan locked</p>
                    <p className="hud-verify-note__copy">{verifyFailNote}</p>
                  </div>
                </div>
              ) : null}

              {exitClosing ? (
                <div className="hud-exit-close absolute inset-0 z-[85] flex items-center justify-center">
                  <div className="hud-exit-close__card" role="status" aria-live="polite">
                    <p className="hud-exit-close__title">Path closing</p>
                    <div className="hud-exit-close__bar" aria-hidden="true">
                      <div className="hud-exit-close__bar-track">
                        <div className="hud-exit-close__bar-fill" />
                      </div>
                    </div>
                    <p className="hud-exit-close__copy">Saving your session…</p>
                  </div>
                </div>
              ) : null}

              <div className="hud-side-dock absolute z-50 hud-inset-top hud-inset-right">
                {arVrToggleButton}
                {sideDockToggleButton}
                {sideDockOpen ? (
                  <>
                    {isVerified ? (
                      <button
                        type="button"
                        onClick={endExperience}
                        disabled={exitClosing}
                        aria-label="Exit experience"
                        aria-busy={exitClosing}
                        className={`${dockIconClass} disabled:opacity-40`}
                      >
                        <svg viewBox="0 0 24 24" className="hud-icon-btn__glyph" fill="none" stroke="currentColor" strokeWidth="2.2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M7 17L17 7M7 7h10v10" />
                        </svg>
                      </button>
                    ) : null}
                    {experienceViewMode === 'ar' ? cameraFlipButton : null}
                    {experienceViewMode === 'ar' ? flashButton : null}
                    {isVerified && jarvisUiReady
                      ? composeMode === 'keyboard'
                        ? liveMicDockButton
                        : keyboardButton
                      : null}
                  </>
                ) : null}
              </div>

              {isVerified && jarvisUiReady && composeMode === 'keyboard' && !reelRecord.isTrimming && (
                <div className="myra-compose-wrap myra-compose-wrap--dock-clear absolute z-50 hud-inset-bottom">
                  <div className="myra-compose-bar">
                    <input
                      ref={composeInputRef}
                      type="text"
                      enterKeyHint="send"
                      value={composeText}
                      onChange={(e) => setComposeText(e.target.value)}
                      onKeyDown={handleComposeKeyDown}
                      disabled={isAiThinking || isMyraTalking}
                      placeholder="Message"
                      className="myra-compose-bar__input"
                    />
                    <button
                      type="button"
                      onClick={handleSendCompose}
                      disabled={isAiThinking || isMyraTalking || !composeText.trim()}
                      className="myra-compose-bar__send"
                      aria-label="Send message"
                    >
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
                      </svg>
                    </button>
                    <div className="myra-compose-bar__mic">{myraPttButton}</div>
                  </div>
                </div>
              )}

              {needsAudioTap ? (
                <button
                  type="button"
                  className="axerai-audio-tap"
                  aria-label="Meet Myra"
                  onPointerDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    // speak()/play() must start in this gesture — do not await anything first.
                    const played = playQueuedTtsFromUserGesture()
                    if (!played) {
                      unlockMobileSpeechAudio({ force: true, speechPing: true })
                      return
                    }
                    setNeedsAudioTap(false)
                  }}
                >
                  <span className="axerai-audio-tap__glow" aria-hidden />
                  <p className="axerai-audio-tap__title">Meet Myra</p>
                  <p className="axerai-audio-tap__sub">Your card found her. Tap to begin.</p>
                  <span className="axerai-audio-tap__pill">Begin</span>
                </button>
              ) : null}

              {isVerified &&
                jarvisUiReady &&
                composeMode === 'liveMic' &&
                !reelRecord.isTrimming &&
                !isMyraTalking &&
                !isAiThinking && (
                <div className="myra-live-mic-panel myra-compose-wrap--dock-clear absolute z-50 hud-inset-bottom">
                  <div
                    ref={liveTranscriptScrollRef}
                    className="myra-live-mic-panel__transcript-wrap"
                    aria-live="polite"
                  >
                    {liveMicEditing ? (
                      <div className="myra-live-mic-edit">
                        <textarea
                          className="myra-live-mic-edit__input"
                          value={liveMicEditDraft}
                          rows={2}
                          enterKeyHint="send"
                          aria-label="Fix what Myra heard"
                          onChange={(event) => setLiveMicEditDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.shiftKey) {
                              event.preventDefault()
                              sendLiveMicEdited()
                            }
                          }}
                        />
                        <div className="myra-live-mic-edit__actions">
                          <button
                            type="button"
                            className="myra-live-mic-edit__btn myra-live-mic-edit__btn--ghost"
                            onClick={cancelLiveMicEdit}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="myra-live-mic-edit__btn myra-live-mic-edit__btn--send"
                            onClick={sendLiveMicEdited}
                            disabled={!liveMicEditDraft.trim()}
                          >
                            Send
                          </button>
                        </div>
                      </div>
                    ) : liveTranscript ? (
                      <button
                        type="button"
                        className="myra-live-mic-panel__text myra-live-mic-panel__text--tappable"
                        onClick={beginLiveMicEdit}
                      >
                        {liveTranscript}
                        <span className="myra-live-mic-panel__fix-hint">Tap to fix</span>
                      </button>
                    ) : null}
                  </div>
                  <div
                    className={`myra-live-mic-capsule${isListening && !liveMicEditing ? ' myra-live-mic-capsule--active' : ''}`}
                    style={{
                      '--voice-energy': (
                        voiceLevels.reduce((sum, level) => sum + level, 0) / voiceLevels.length
                      ).toFixed(2),
                    }}
                    aria-hidden
                  >
                    <span className="myra-live-mic-capsule__liquid" />
                    <span className="myra-live-mic-capsule__blob myra-live-mic-capsule__blob--1" />
                    <span className="myra-live-mic-capsule__blob myra-live-mic-capsule__blob--2" />
                  </div>
                </div>
              )}
            </div>
            </div>
        </div>
      </div>
    </>
  )
}

export default App
