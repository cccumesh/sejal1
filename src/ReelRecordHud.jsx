import { useCallback, useEffect, useRef, useState } from 'react'
import { createReelCapture } from './reelCapture.js'
import { saveReelInBackground } from './reelSave.js'
import { getVideoDurationFromBlob, trimReelBlob } from './reelTrim.js'
import { getMyraVoiceOutputPath } from './elevenLabsTts.js'

export const REEL_RECORD_PHASE = {
  OFF: 'off',
  RECORDING: 'recording',
  SAVING: 'saving',
  TRIM: 'trim',
}

const THUMB_COUNT = 14
const TRIM_EDGE_SEC = 0.2

function rangeNeedsTrim(start, end, duration) {
  const total = Math.max(0.5, Number(duration) || 0)
  return start > TRIM_EDGE_SEC || end < total - TRIM_EDGE_SEC
}

async function buildFilmstripThumbs(clipUrl, duration, count = THUMB_COUNT) {
  const video = document.createElement('video')
  video.src = clipUrl
  video.muted = true
  video.playsInline = true

  await new Promise((resolve, reject) => {
    video.onloadedmetadata = () => resolve()
    video.onerror = () => reject(new Error('Could not load clip'))
  })

  const total = Math.max(0.5, duration || video.duration || 1)
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  canvas.width = 48
  canvas.height = 86
  const thumbs = []

  for (let i = 0; i < count; i += 1) {
    const t = (total / count) * i
    video.currentTime = Math.min(t, total - 0.05)
    await new Promise((resolve) => {
      video.onseeked = () => resolve()
    })
    ctx.fillStyle = '#111'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    thumbs.push(canvas.toDataURL('image/jpeg', 0.55))
  }

  return thumbs
}

export function ReelRecordDockControl({
  recording = false,
  showStop = false,
  disabled = false,
  onDotClick,
  onStop,
}) {
  return (
    <div className="hud-reel-dot-anchor">
      <button
        type="button"
        onClick={onDotClick}
        disabled={disabled}
        aria-label={recording ? 'Recording on — tap for stop' : 'Start reel recording'}
        aria-pressed={recording}
        className={`hud-reel-dot${recording ? ' hud-reel-dot--live' : ''}`}
      >
        <span className="hud-reel-dot__core" aria-hidden />
      </button>
      {showStop ? (
        <button type="button" className="hud-reel-dot__stop" onClick={onStop}>
          Stop
        </button>
      ) : null}
    </div>
  )
}

export function ReelTrimSheet({ clipUrl, clipDuration, onSave, onDiscard }) {
  const videoRef = useRef(null)
  const trackRef = useRef(null)
  const [startPct, setStartPct] = useState(0)
  const [endPct, setEndPct] = useState(100)
  const [thumbs, setThumbs] = useState([])
  const [playing, setPlaying] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const dragRef = useRef(null)

  const duration = Math.max(0.5, clipDuration || 1)
  const start = (startPct / 100) * duration
  const end = (endPct / 100) * duration

  useEffect(() => {
    setStartPct(0)
    setEndPct(100)
    setThumbs([])
    let cancelled = false

    void buildFilmstripThumbs(clipUrl, duration)
      .then((frames) => {
        if (!cancelled) setThumbs(frames)
      })
      .catch(() => {
        if (!cancelled) setThumbs([])
      })

    return () => {
      cancelled = true
    }
  }, [clipUrl, duration])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return undefined

    const onTimeUpdate = () => {
      if (video.currentTime >= end - 0.05) {
        video.pause()
        video.currentTime = start
        setPlaying(false)
      }
    }

    video.addEventListener('timeupdate', onTimeUpdate)
    return () => video.removeEventListener('timeupdate', onTimeUpdate)
  }, [start, end])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = start
    if (playing) void video.play().catch(() => setPlaying(false))
    else video.pause()
  }, [start, end, playing, clipUrl])

  const togglePlay = () => {
    const video = videoRef.current
    if (!video) return
    if (playing) {
      video.pause()
      setPlaying(false)
      return
    }
    if (video.currentTime >= end - 0.05) video.currentTime = start
    void video.play().catch(() => {})
    setPlaying(true)
  }

  const bindDrag = (handle) => (event) => {
    event.preventDefault()
    dragRef.current = handle
  }

  useEffect(() => {
    const onMove = (event) => {
      if (!dragRef.current || !trackRef.current) return
      const rect = trackRef.current.getBoundingClientRect()
      const clientX = 'touches' in event ? event.touches[0]?.clientX : event.clientX
      if (clientX == null) return
      const pct = Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100))

      if (dragRef.current === 'start') {
        setStartPct(Math.min(pct, endPct - 4))
      } else {
        setEndPct(Math.max(pct, startPct + 4))
      }
    }

    const onUp = () => {
      dragRef.current = null
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onUp)
    }
  }, [endPct, startPct])

  const handleSave = async () => {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      videoRef.current?.pause()
      setPlaying(false)
      await onSave({ start, end })
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Save failed')
      setSaving(false)
    }
  }

  return (
    <div className="hud-reel-trim-full absolute inset-0 z-[110] bg-black">
      <button type="button" className="hud-reel-trim-full__close" aria-label="Discard" onClick={onDiscard}>
        ×
      </button>

      <div className="hud-reel-trim-full__preview">
        <video ref={videoRef} src={clipUrl} playsInline className="hud-reel-trim-full__video" />
      </div>

      <div className="hud-reel-trim-full__controls">
        <button type="button" className="hud-reel-trim-full__play" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? '❚❚' : '▶'}
        </button>

        <div className="hud-reel-trim-full__track-wrap" ref={trackRef}>
          <div className="hud-reel-trim-full__thumbs">
            {(thumbs.length ? thumbs : Array.from({ length: THUMB_COUNT }, () => '')).map((src, index) => (
              <div
                key={`${src || 'empty'}-${index}`}
                className="hud-reel-trim-full__thumb"
                style={src ? { backgroundImage: `url(${src})` } : undefined}
              />
            ))}
          </div>
          <div className="hud-reel-trim-full__shade hud-reel-trim-full__shade--left" style={{ width: `${startPct}%` }} />
          <div
            className="hud-reel-trim-full__shade hud-reel-trim-full__shade--right"
            style={{ width: `${100 - endPct}%` }}
          />
          <div
            className="hud-reel-trim-full__select"
            style={{ left: `${startPct}%`, width: `${endPct - startPct}%` }}
          />
          <button
            type="button"
            className="hud-reel-trim-full__handle hud-reel-trim-full__handle--start"
            style={{ left: `${startPct}%` }}
            onPointerDown={bindDrag('start')}
            aria-label="Trim start"
          />
          <button
            type="button"
            className="hud-reel-trim-full__handle hud-reel-trim-full__handle--end"
            style={{ left: `${endPct}%` }}
            onPointerDown={bindDrag('end')}
            aria-label="Trim end"
          />
          <div className="hud-reel-trim-full__scrub" style={{ left: `${startPct}%` }} />
        </div>

        <button
          type="button"
          className="hud-reel-trim-full__save"
          onClick={handleSave}
          disabled={saving}
          aria-label="Save clip"
        >
          {saving ? '…' : '✓'}
        </button>
      </div>

      {error ? <p className="hud-reel-trim-full__error">{error}</p> : null}
    </div>
  )
}

export function useReelRecordUi({
  enabled = true,
  captureRootRef,
  composeModeRef,
  liveMicStreamRef,
  onError,
  onSaved,
} = {}) {
  const [phase, setPhase] = useState(REEL_RECORD_PHASE.OFF)
  const [seconds, setSeconds] = useState(0)
  const [showStopMenu, setShowStopMenu] = useState(false)
  const [clipUrl, setClipUrl] = useState('')
  const [clipDuration, setClipDuration] = useState(0)
  const [clipMimeType, setClipMimeType] = useState('')
  const captureSessionRef = useRef(null)
  const clipUrlRef = useRef('')
  const clipBlobRef = useRef(null)

  const revokeClipUrl = useCallback(() => {
    if (clipUrlRef.current) {
      URL.revokeObjectURL(clipUrlRef.current)
      clipUrlRef.current = ''
    }
    clipBlobRef.current = null
    setClipUrl('')
  }, [])

  const syncLiveMicToCapture = useCallback(async () => {
    const session = captureSessionRef.current
    if (!session?.syncLiveMic) return
    const liveMic = composeModeRef?.current === 'liveMic'
    await session.syncLiveMic(liveMic, liveMic ? liveMicStreamRef?.current : null)
  }, [composeModeRef, liveMicStreamRef])

  useEffect(() => {
    if (enabled) return
    revokeClipUrl()
    captureSessionRef.current = null
    setShowStopMenu(false)
    setPhase(REEL_RECORD_PHASE.OFF)
    setSeconds(0)
  }, [enabled, revokeClipUrl])

  useEffect(() => {
    if (phase !== REEL_RECORD_PHASE.RECORDING && phase !== REEL_RECORD_PHASE.SAVING) {
      return undefined
    }
    const id = window.setInterval(() => {
      setSeconds((prev) => prev + 1)
    }, 1000)
    return () => window.clearInterval(id)
  }, [phase])

  useEffect(() => {
    if (phase !== REEL_RECORD_PHASE.RECORDING) return undefined
    void syncLiveMicToCapture()
    return undefined
  }, [phase, syncLiveMicToCapture])

  useEffect(
    () => () => {
      revokeClipUrl()
    },
    [revokeClipUrl],
  )

  const startRecording = async () => {
    if (!enabled) return
    const root = captureRootRef?.current
    if (!root) {
      onError?.(new Error('Capture area not ready'))
      return
    }

    revokeClipUrl()
    setShowStopMenu(false)
    setSeconds(0)

    try {
      const session = createReelCapture()
      captureSessionRef.current = session
      const { hasAudio } = await session.start(root)
      await session.syncLiveMic(
        composeModeRef?.current === 'liveMic',
        composeModeRef?.current === 'liveMic' ? liveMicStreamRef?.current : null,
      )
      setPhase(REEL_RECORD_PHASE.RECORDING)

      if (getMyraVoiceOutputPath() === 'browser' && !hasAudio) {
        onError?.(
          new Error('Tab audio allow karo — warna Myra ki awaaz clip mein nahi aayegi.'),
          { severity: 'info' },
        )
      }
    } catch (error) {
      captureSessionRef.current = null
      onError?.(error)
    }
  }

  const stopRecording = async () => {
    const session = captureSessionRef.current
    setShowStopMenu(false)
    if (!session) {
      setPhase(REEL_RECORD_PHASE.OFF)
      return
    }

    setPhase(REEL_RECORD_PHASE.SAVING)

    try {
      const { blob, mimeType, hadAudio } = await session.stop()
      captureSessionRef.current = null
      revokeClipUrl()

      if (!blob) {
        setPhase(REEL_RECORD_PHASE.OFF)
        return
      }

      if (!hadAudio && getMyraVoiceOutputPath() === 'browser') {
        onError?.(
          new Error('Clip mein Myra ki awaaz nahi aayi — next time tab audio allow karo.'),
          { severity: 'info' },
        )
      }

      const url = URL.createObjectURL(blob)
      clipUrlRef.current = url
      clipBlobRef.current = blob
      setClipUrl(url)
      setClipMimeType(mimeType)
      const duration = await getVideoDurationFromBlob(blob)
      setClipDuration(Math.max(0.5, duration || seconds))
      setPhase(REEL_RECORD_PHASE.TRIM)
    } catch (error) {
      captureSessionRef.current = null
      onError?.(error)
      setPhase(REEL_RECORD_PHASE.OFF)
    }
  }

  const handleDotClick = () => {
    if (phase === REEL_RECORD_PHASE.RECORDING) {
      setShowStopMenu((prev) => !prev)
      return
    }
    if (phase === REEL_RECORD_PHASE.OFF) {
      void startRecording()
    }
  }

  const finishTrim = useCallback(() => {
    revokeClipUrl()
    setClipDuration(0)
    setClipMimeType('')
    setSeconds(0)
    setPhase(REEL_RECORD_PHASE.OFF)
  }, [revokeClipUrl])

  const saveTrimmedClip = useCallback(
    async ({ start, end } = {}) => {
      const blob = clipBlobRef.current
      if (!blob) throw new Error('Empty clip')

      const duration = Math.max(0.5, clipDuration || 1)
      const from = Math.max(0, Number(start) || 0)
      const to = Math.max(from + 0.15, Number(end) || duration)
      const outBlob = rangeNeedsTrim(from, to, duration)
        ? await trimReelBlob(blob, from, to, clipMimeType)
        : blob

      const result = await saveReelInBackground(outBlob, clipMimeType)
      if (result.method !== 'cancelled') {
        onSaved?.(result.method)
      }
      finishTrim()
    },
    [clipDuration, clipMimeType, finishTrim, onSaved],
  )

  const resetReelRecord = () => {
    revokeClipUrl()
    captureSessionRef.current = null
    setShowStopMenu(false)
    setPhase(REEL_RECORD_PHASE.OFF)
    setSeconds(0)
    setClipDuration(0)
    setClipMimeType('')
  }

  return {
    phase,
    showStopMenu,
    isRecording: phase === REEL_RECORD_PHASE.RECORDING,
    isSaving: phase === REEL_RECORD_PHASE.SAVING,
    isTrimming: phase === REEL_RECORD_PHASE.TRIM,
    clipUrl,
    clipDuration,
    clipMimeType,
    handleDotClick,
    stopRecording,
    saveTrimmedClip,
    finishTrim,
    resetReelRecord,
    syncLiveMicToCapture,
  }
}
