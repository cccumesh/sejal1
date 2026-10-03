const DEFAULT_MODEL = 'nova-3'
const DEFAULT_LANGUAGE = 'multi'

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Short-lived listen token for browser WebSocket (server key — listen scope only on Deepgram dashboard). */
export default async (request) => {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const apiKey = String(process.env.DEEPGRAM_API_KEY ?? '').trim()
  if (!apiKey) {
    return jsonResponse(500, { error: 'DEEPGRAM_API_KEY missing on server' })
  }

  const model = String(process.env.DEEPGRAM_MODEL ?? DEFAULT_MODEL).trim() || DEFAULT_MODEL
  const language = String(process.env.DEEPGRAM_LANGUAGE ?? DEFAULT_LANGUAGE).trim() || DEFAULT_LANGUAGE

  return jsonResponse(200, {
    token: apiKey,
    model,
    language,
    keyterms: String(process.env.DEEPGRAM_KEYTERMS ?? '').trim(),
    expires_in: 300,
  })
}
