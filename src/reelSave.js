import { reelDownloadExtension } from './reelCapture.js'

/** Save reel without re-encoding — share sheet (mobile gallery) or download (desktop). */
export async function saveReelInBackground(blob, mimeType = '') {
  if (!blob?.size) throw new Error('Empty clip')

  const ext = reelDownloadExtension(mimeType || blob.type)
  const name = `myra-reel-${Date.now()}.${ext}`
  const type = mimeType || blob.type || 'video/webm'
  const file = new File([blob], name, { type })

  if (navigator.share) {
    try {
      if (!navigator.canShare?.({ files: [file] })) {
        throw new Error('share unsupported')
      }
      await navigator.share({ files: [file], title: 'Myra reel' })
      return { method: 'share' }
    } catch (error) {
      if (error?.name === 'AbortError') {
        return { method: 'cancelled' }
      }
    }
  }

  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
  return { method: 'download' }
}
