const MODEL_ID = 'inworld-tts-2'

function resolveSpeakingRate(raw) {
  const n = Number(raw ?? 1.2)
  return Number.isFinite(n) ? Math.min(1.5, Math.max(0.5, n)) : 1.2
}

export default async (request) => {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const apiKey = String(process.env.INWORLD_API_KEY ?? '').trim()
  const defaultVoiceId = String(process.env.INWORLD_VOICE_ID ?? '').trim()

  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'INWORLD_API_KEY missing on server' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const text = String(body?.text ?? '').trim()
  const voiceId = String(body?.voiceId ?? defaultVoiceId).trim()

  if (!text) {
    return new Response(JSON.stringify({ error: 'text is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (!voiceId) {
    return new Response(JSON.stringify({ error: 'INWORLD_VOICE_ID missing on server' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const speakingRate = resolveSpeakingRate(process.env.INWORLD_SPEAKING_RATE)

  const response = await fetch('https://api.inworld.ai/tts/v1/voice', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      voiceId,
      modelId: MODEL_ID,
      audioConfig: { audioEncoding: 'MP3', speakingRate },
    }),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    return new Response(
      JSON.stringify({ error: `Inworld ${response.status}: ${detail.slice(0, 240)}` }),
      { status: response.status, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const payload = await response.json().catch(() => ({}))
  const audioContent = String(payload?.audioContent ?? '').trim()
  if (!audioContent) {
    return new Response(JSON.stringify({ error: 'Inworld returned empty audio' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const audio = Uint8Array.from(atob(audioContent), (char) => char.charCodeAt(0))
  const charCount = Number(payload?.usage?.processedCharactersCount ?? Array.from(text).length)

  return new Response(audio, {
    status: 200,
    headers: {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-store',
      'X-Axerai-Characters': String(charCount),
      'Access-Control-Expose-Headers': 'X-Axerai-Characters',
    },
  })
}
