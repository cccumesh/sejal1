import {
  getReelRecordingAudioStream,
  getSharedAudioContext,
  releaseReelRecordingAudioStream,
  resumeSharedAudioContext,
} from './elevenLabsTts.js'
import { isAppleMobileBrowser } from './mobileBrowser.js'
import { getTtsRecordingStream, releaseTtsRecordingStream } from './myraLipSync.js'

/** Mix Myra app audio + optional live-mic user voice for reel recording. */
export function createReelAudioMix() {
  let mixCtx = null
  let dest = null
  let tabStream = null
  let ownedUserMicStream = null
  let sharedUserMicStream = null
  let userMicSource = null
  let linked = false

  function connectStream(stream) {
    if (!mixCtx || !dest || !stream?.getAudioTracks().length) return
    try {
      mixCtx.createMediaStreamSource(stream).connect(dest)
      linked = true
    } catch (error) {
      console.warn('[Reel] audio mix connect failed:', error)
    }
  }

  async function tryTabAudioForBrowserTts() {
    if (isAppleMobileBrowser() || !navigator.mediaDevices?.getDisplayMedia) return false
    try {
      const capture = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          suppressLocalAudioPlayback: false,
        },
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
        monitorTypeSurfaces: 'include',
        systemAudio: 'include',
      })
      capture.getVideoTracks().forEach((track) => track.stop())
      if (capture.getAudioTracks().length) {
        tabStream = capture
        connectStream(capture)
        return true
      }
      capture.getTracks().forEach((track) => track.stop())
    } catch (error) {
      console.warn('[Reel] tab audio capture declined:', error)
    }
    return false
  }

  async function attachToVideoStream(videoStream, { captureTabAudio = false } = {}) {
    await resumeSharedAudioContext()
    mixCtx = getSharedAudioContext()
    if (!mixCtx) return false

    dest = mixCtx.createMediaStreamDestination()
    linked = false

    connectStream(getReelRecordingAudioStream())
    connectStream(getTtsRecordingStream())

    if (captureTabAudio) {
      await tryTabAudioForBrowserTts()
    }

    if (linked) {
      for (const track of dest.stream.getAudioTracks()) {
        videoStream.addTrack(track)
      }
      void mixCtx.resume()
    }

    return linked
  }

  function setUserMicStream(stream, { ownsStream = false } = {}) {
    if (!mixCtx || !dest) return

    if (userMicSource) {
      try {
        userMicSource.disconnect()
      } catch {
        /* ignore */
      }
      userMicSource = null
    }

    if (ownedUserMicStream) {
      ownedUserMicStream.getTracks().forEach((track) => track.stop())
      ownedUserMicStream = null
    }

    sharedUserMicStream = null

    if (!stream?.active) return

    try {
      userMicSource = mixCtx.createMediaStreamSource(stream)
      userMicSource.connect(dest)
      linked = true
      if (ownsStream) ownedUserMicStream = stream
      else sharedUserMicStream = stream
    } catch (error) {
      console.warn('[Reel] user mic mix failed:', error)
    }
  }

  async function syncLiveMic(active, sharedStream = null) {
    if (!mixCtx) return

    if (!active) {
      setUserMicStream(null)
      return
    }

    if (sharedStream?.active) {
      setUserMicStream(sharedStream, { ownsStream: false })
      return
    }

    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      setUserMicStream(mic, { ownsStream: true })
    } catch (error) {
      console.warn('[Reel] live mic for reel failed:', error)
    }
  }

  function release() {
    if (userMicSource) {
      try {
        userMicSource.disconnect()
      } catch {
        /* ignore */
      }
      userMicSource = null
    }

    if (ownedUserMicStream) {
      ownedUserMicStream.getTracks().forEach((track) => track.stop())
      ownedUserMicStream = null
    }
    sharedUserMicStream = null

    tabStream?.getTracks().forEach((track) => track.stop())
    tabStream = null

    releaseReelRecordingAudioStream()
    releaseTtsRecordingStream()

    dest = null
    mixCtx = null
    linked = false
  }

  return {
    attachToVideoStream,
    setUserMicStream,
    syncLiveMic,
    release,
  }
}
