import https from 'node:https'
import { appendDeepgramKeyterms, DEFAULT_DEEPGRAM_KEYTERMS } from './src/deepgramConfig.js'

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function postDeepgramListen(audioBuffer, contentType, deepgramKey, model, language, keyterms) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      model,
      language,
      smart_format: 'true',
      punctuate: 'true',
    })
    appendDeepgramKeyterms(params, keyterms)

    const req = https.request(
      {
        hostname: 'api.deepgram.com',
        path: `/v1/listen?${params}`,
        method: 'POST',
        headers: {
          Authorization: `Token ${deepgramKey}`,
          'Content-Type': contentType,
          'Content-Length': audioBuffer.length,
        },
        rejectUnauthorized: false,
      },
      (upstream) => {
        const chunks = []
        upstream.on('data', (chunk) => chunks.push(chunk))
        upstream.on('end', () => {
          resolve({
            status: upstream.statusCode || 502,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        })
      },
    )

    req.on('error', reject)
    req.write(audioBuffer)
    req.end()
  })
}

/** Local dev: forward /api/deepgram-stt + grant token for live WebSocket. */
export function deepgramDevProxyPlugin(deepgramKey, options = {}) {
  const model = String(options.model ?? 'nova-3').trim() || 'nova-3'
  const language = String(options.language ?? 'multi').trim() || 'multi'
  const keyterms = String(options.keyterms ?? DEFAULT_DEEPGRAM_KEYTERMS).trim()

  return {
    name: 'axerai-deepgram-dev-proxy',
    configureServer(server) {
      if (deepgramKey) {
        console.info('[vite] Deepgram dev proxy ready → POST /api/deepgram-stt, /api/deepgram-grant')
      } else {
        console.warn('[vite] Deepgram dev proxy OFF — set VITE_DEEPGRAM_API_KEY in .env')
      }

      server.middlewares.use(async (req, res, next) => {
        const isStt = req.url?.startsWith('/api/deepgram-stt')
        const isGrant = req.url?.startsWith('/api/deepgram-grant')
        if (!isStt && !isGrant) {
          next()
          return
        }

        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method not allowed')
          return
        }

        if (!deepgramKey) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'VITE_DEEPGRAM_API_KEY missing in .env' }))
          return
        }

        if (isGrant) {
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(
            JSON.stringify({
              token: deepgramKey,
              model,
              language,
              keyterms,
              expires_in: 300,
            }),
          )
          return
        }

        try {
          const audioBuffer = await readRequestBody(req)
          const contentType = String(req.headers['content-type'] ?? 'application/octet-stream')
          const upstream = await postDeepgramListen(
            audioBuffer,
            contentType,
            deepgramKey,
            model,
            language,
            keyterms,
          )
          res.statusCode = upstream.status
          res.setHeader('Content-Type', 'application/json')
          res.end(upstream.body)
        } catch (error) {
          res.statusCode = 502
          res.setHeader('Content-Type', 'application/json')
          res.end(
            JSON.stringify({
              error: error instanceof Error ? error.message : String(error),
              hint: 'Stop old dev servers and run npm run dev once.',
            }),
          )
        }
      })
    },
  }
}
