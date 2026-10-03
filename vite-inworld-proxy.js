import https from 'node:https'

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** Node fetch often fails on Windows with UNABLE_TO_VERIFY_LEAF_SIGNATURE — use https directly. */
function postInworldTts(body, inworldKey) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(body, 'utf8')
    const req = https.request(
      {
        hostname: 'api.inworld.ai',
        path: '/tts/v1/voice',
        method: 'POST',
        headers: {
          Authorization: `Basic ${inworldKey}`,
          'Content-Type': 'application/json',
          'Content-Length': payload.length,
        },
        // Local dev only — Windows corporate SSL / OneDrive paths often break Node CA trust.
        rejectUnauthorized: false,
      },
      (upstream) => {
        const chunks = []
        upstream.on('data', (chunk) => chunks.push(chunk))
        upstream.on('end', () => {
          resolve({
            status: upstream.statusCode || 502,
            body: Buffer.concat(chunks).toString('utf8'),
            contentType: upstream.headers['content-type'] || 'application/json',
          })
        })
      },
    )

    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

/** Local dev: forward /api/inworld-tts to Inworld with server-side API key. */
export function inworldDevProxyPlugin(inworldKey) {
  return {
    name: 'axerai-inworld-dev-proxy',
    configureServer(server) {
      if (inworldKey) {
        console.info('[vite] Inworld dev proxy ready → POST /api/inworld-tts')
      } else {
        console.warn('[vite] Inworld dev proxy OFF — set VITE_INWORLD_API_KEY in .env')
      }

      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/inworld-tts')) {
          next()
          return
        }

        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method not allowed')
          return
        }

        if (!inworldKey) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'VITE_INWORLD_API_KEY missing in .env' }))
          return
        }

        try {
          const body = await readRequestBody(req)
          const upstream = await postInworldTts(body, inworldKey)
          res.statusCode = upstream.status
          res.setHeader('Content-Type', upstream.contentType)
          res.end(upstream.body)
        } catch (error) {
          res.statusCode = 502
          res.setHeader('Content-Type', 'application/json')
          res.end(
            JSON.stringify({
              error: error instanceof Error ? error.message : String(error),
              hint: 'Stop old dev servers (5173/5174) and run npm run dev once.',
            }),
          )
        }
      })
    },
  }
}
