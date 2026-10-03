import { pickReelMimeType } from './reelCapture.js'

export async function getVideoDurationFromBlob(blob) {
  const url = URL.createObjectURL(blob)
  const video = document.createElement('video')
  video.preload = 'metadata'
  video.src = url

  try {
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = () => resolve()
      video.onerror = () => reject(new Error('Could not read clip duration'))
    })
    return Number.isFinite(video.duration) ? video.duration : 0
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function trimReelBlob(blob, startSec, endSec, mimeType = '') {
  const start = Math.max(0, Number(startSec) || 0)
  const end = Math.max(start + 0.15, Number(endSec) || 0)
  const outMime = mimeType || pickReelMimeType()

  const url = URL.createObjectURL(blob)
  const video = document.createElement('video')
  video.src = url
  video.playsInline = true
  video.muted = false

  await new Promise((resolve, reject) => {
    video.onloadedmetadata = () => resolve()
    video.onerror = () => reject(new Error('Could not load clip for trim'))
  })

  const slice = Math.min(end, video.duration || end) - start
  if (slice < 0.15) {
    URL.revokeObjectURL(url)
    throw new Error('Selected clip is too short')
  }

  if (typeof video.captureStream !== 'function') {
    URL.revokeObjectURL(url)
    return blob
  }

  const stream = video.captureStream()
  const chunks = []
  const recorder = new MediaRecorder(stream, { mimeType: outMime })

  return new Promise((resolve, reject) => {
    recorder.ondataavailable = (event) => {
      if (event.data?.size) chunks.push(event.data)
    }
    recorder.onerror = (event) => {
      URL.revokeObjectURL(url)
      reject(event.error ?? new Error('Trim export failed'))
    }
    recorder.onstop = () => {
      URL.revokeObjectURL(url)
      resolve(chunks.length ? new Blob(chunks, { type: outMime }) : blob)
    }

    video.currentTime = start
    video.onseeked = async () => {
      try {
        recorder.start(120)
        await video.play()
      } catch (error) {
        reject(error)
        return
      }

      window.setTimeout(() => {
        try {
          video.pause()
        } catch {
          /* ignore */
        }
        if (recorder.state !== 'inactive') recorder.stop()
      }, Math.ceil(slice * 1000) + 120)
    }
  })
}
