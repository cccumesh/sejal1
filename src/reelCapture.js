import { createReelAudioMix } from './reelAudioMix.js'
import { getMyraVoiceOutputPath, resumeSharedAudioContext } from './elevenLabsTts.js'

const REEL_BRAND_NAME = 'Richera'
const REEL_POWERED_BY = 'Powered by axerai'

export function pickReelMimeType() {
  if (typeof MediaRecorder === 'undefined') return ''
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ]
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return mime
  }
  return ''
}

function findCaptureLayers(root) {
  return {
    canvas: root.querySelector('canvas'),
    video: root.querySelector('video'),
    bgImg: root.querySelector('.myra-static-session__bg'),
  }
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + width - r, y)
  ctx.quadraticCurveTo(x + width, y, x + width, y + r)
  ctx.lineTo(x + width, y + height - r)
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
  ctx.lineTo(x + r, y + height)
  ctx.quadraticCurveTo(x, y + height, x, y + height - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

export function drawReelBrandWatermark(ctx, width, height) {
  const w = Number(width) || 0
  const h = Number(height) || 0
  if (!ctx || w <= 0 || h <= 0) return

  const pad = Math.max(10, Math.round(w * 0.028))
  const titleSize = Math.max(11, Math.round(w * 0.031))
  const subSize = Math.max(9, Math.round(w * 0.024))
  const gem = Math.max(8, Math.round(w * 0.022))

  const line1 = REEL_BRAND_NAME
  const line2 = REEL_POWERED_BY

  ctx.save()
  ctx.font = `700 ${titleSize}px Georgia, "Times New Roman", serif`
  const textW = Math.max(ctx.measureText(line1).width, ctx.measureText(line2).width)
  const blockW = textW + pad * 2.4 + gem
  const blockH = titleSize + subSize + pad * 1.35
  const x = pad
  const y = h - pad

  roundRect(ctx, x, y - blockH, blockW, blockH, 10)
  ctx.fillStyle = 'rgba(8, 12, 10, 0.62)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(245, 201, 138, 0.42)'
  ctx.lineWidth = 1
  ctx.stroke()

  ctx.fillStyle = 'rgba(245, 201, 138, 0.95)'
  ctx.beginPath()
  ctx.moveTo(x + pad * 0.75, y - blockH + pad * 0.85)
  ctx.lineTo(x + pad * 0.75 + gem * 0.55, y - blockH + pad * 0.85 + gem)
  ctx.lineTo(x + pad * 0.75 + gem * 1.1, y - blockH + pad * 0.85)
  ctx.lineTo(x + pad * 0.75 + gem * 0.82, y - blockH + pad * 0.85 + gem * 0.55)
  ctx.closePath()
  ctx.fill()

  const textX = x + pad * 0.75 + gem * 1.35
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = 'rgba(255, 244, 220, 0.96)'
  ctx.font = `700 ${titleSize}px Georgia, "Times New Roman", serif`
  ctx.fillText(line1, textX, y - subSize - pad * 0.45)

  ctx.fillStyle = 'rgba(245, 201, 138, 0.9)'
  ctx.font = `600 ${subSize}px system-ui, -apple-system, Segoe UI, sans-serif`
  ctx.fillText(line2, textX, y - pad * 0.35)
  ctx.restore()
}

export function createReelCapture() {
  let compositeCanvas = null
  let compositeCtx = null
  let rafId = null
  let recorder = null
  let chunks = []
  let startedAt = 0
  let running = false
  let mimeType = ''
  let captureRoot = null
  let audioMix = null
  let captureHadAudio = false

  function drawFrame() {
    if (!running || !compositeCtx || !captureRoot) return

    const { canvas, video, bgImg } = findCaptureLayers(captureRoot)
    const w = compositeCanvas.width
    const h = compositeCanvas.height

    compositeCtx.fillStyle = '#000'
    compositeCtx.fillRect(0, 0, w, h)

    if (bgImg?.complete && bgImg.naturalWidth > 0) {
      compositeCtx.drawImage(bgImg, 0, 0, w, h)
    } else if (video?.readyState >= 2 && video.videoWidth > 0) {
      compositeCtx.drawImage(video, 0, 0, w, h)
    }

    if (canvas?.width > 0) {
      compositeCtx.drawImage(canvas, 0, 0, w, h)
    }

    drawReelBrandWatermark(compositeCtx, w, h)

    rafId = window.requestAnimationFrame(drawFrame)
  }

  async function start(root) {
    if (!root) throw new Error('Capture area missing')
    if (typeof MediaRecorder === 'undefined') {
      throw new Error('Recording is not supported in this browser')
    }

    mimeType = pickReelMimeType()
    if (!mimeType) throw new Error('No supported video format on this device')

    captureRoot = root
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = Math.max(1, Math.round(root.clientWidth * dpr))
    const h = Math.max(1, Math.round(root.clientHeight * dpr))

    compositeCanvas = document.createElement('canvas')
    compositeCanvas.width = w
    compositeCanvas.height = h
    compositeCtx = compositeCanvas.getContext('2d', { alpha: false })
    if (!compositeCtx) throw new Error('Could not start canvas capture')
    compositeCtx.imageSmoothingEnabled = true
    compositeCtx.imageSmoothingQuality = 'high'

    await resumeSharedAudioContext()

    const stream = compositeCanvas.captureStream(30)
    audioMix = createReelAudioMix()
    const hasAudio = await audioMix.attachToVideoStream(stream, {
      captureTabAudio: getMyraVoiceOutputPath() === 'browser',
    })
    captureHadAudio = hasAudio

    chunks = []
    const recorderOptions = {
      mimeType,
      videoBitsPerSecond: 8_000_000,
    }
    if (hasAudio) {
      recorderOptions.audioBitsPerSecond = 192_000
    }
    recorder = new MediaRecorder(stream, recorderOptions)

    recorder.ondataavailable = (event) => {
      if (event.data?.size) chunks.push(event.data)
    }

    running = true
    drawFrame()
    recorder.start(250)
    startedAt = Date.now()
    return { hasAudio }
  }

  async function syncLiveMic(active, sharedStream = null) {
    if (!audioMix) return
    await audioMix.syncLiveMic(active, sharedStream)
  }

  function stop() {
    running = false
    if (rafId) {
      window.cancelAnimationFrame(rafId)
      rafId = null
    }

    const mix = audioMix
    audioMix = null

    return new Promise((resolve, reject) => {
      if (!recorder || recorder.state === 'inactive') {
        mix?.release()
        captureRoot = null
        compositeCanvas = null
        compositeCtx = null
        resolve({ blob: null, durationMs: 0, mimeType, hadAudio: captureHadAudio })
        return
      }

      const savedMime = mimeType || recorder.mimeType
      const durationMs = Math.max(0, Date.now() - startedAt)
      const hadAudio = captureHadAudio

      recorder.onstop = () => {
        mix?.release()
        const blob = chunks.length ? new Blob(chunks, { type: savedMime }) : null
        recorder = null
        chunks = []
        captureRoot = null
        compositeCanvas = null
        compositeCtx = null
        resolve({ blob, durationMs, mimeType: savedMime, hadAudio })
      }

      recorder.onerror = (event) => {
        mix?.release()
        reject(event.error ?? new Error('Recording failed'))
      }

      try {
        recorder.stop()
      } catch (error) {
        mix?.release()
        reject(error)
      }
    })
  }

  return { start, stop, syncLiveMic }
}

export function reelDownloadExtension(mimeType = '') {
  const type = String(mimeType ?? '').toLowerCase()
  if (type.includes('mp4')) return 'mp4'
  return 'webm'
}
