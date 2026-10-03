import { appendDeepgramKeyterms, DEFAULT_DEEPGRAM_KEYTERMS } from './_deepgramKeyterms.mjs'

const DEFAULT_MODEL = 'nova-3'
const DEFAULT_LANGUAGE = 'multi'

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export default async (request) => {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const apiKey = String(process.env.DEEPGRAM_API_KEY ?? '').trim()
  if (!apiKey) {
    return jsonResponse(500, { error: 'DEEPGRAM_API_KEY missing on server' })
  }

  const contentType = String(request.headers.get('content-type') ?? 'application/octet-stream').trim()
  const model = String(process.env.DEEPGRAM_MODEL ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL
  const language = String(process.env.DEEPGRAM_LANGUAGE ?? DEFAULT_LANGUAGE).trim() || DEFAULT_LANGUAGE

  const audioBuffer = await request.arrayBuffer()
  if (!audioBuffer.byteLength) {
    return jsonResponse(400, { error: 'Empty audio body' })
  }

  const params = new URLSearchParams({
    model,
    language,
    smart_format: 'true',
    punctuate: 'true',
  })
  appendDeepgramKeyterms(params, process.env.DEEPGRAM_KEYTERMS ?? DEFAULT_DEEPGRAM_KEYTERMS)

  const upstream = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': contentType,
    },
    body: audioBuffer,
  })

  const payload = await upstream.json().catch(() => ({}))
  if (!upstream.ok) {
    const detail =
      payload?.err_msg ||
      payload?.error ||
      payload?.message ||
      JSON.stringify(payload).slice(0, 240)
    return jsonResponse(upstream.status, {
      error: `Deepgram ${upstream.status}: ${detail}`,
    })
  }

  const alternative = payload?.results?.channels?.[0]?.alternatives?.[0] ?? {}
  const transcript = String(alternative?.transcript ?? '').trim()
  const confidence = Number(alternative?.confidence ?? 0)
  const duration = Number(payload?.metadata?.duration ?? 0)

  return jsonResponse(200, {
    transcript,
    confidence,
    duration,
    model,
    language,
  })
}
