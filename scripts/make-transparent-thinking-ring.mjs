import sharp from 'sharp'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const input = join(root, 'public/images/myra-thinking-ring.png')
const output = join(root, 'public/images/myra-thinking-ring.png')

const { data, info } = await sharp(readFileSync(input))
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true })

const { width, height, channels } = info
const out = Buffer.from(data)

for (let i = 0; i < out.length; i += channels) {
  const r = out[i]
  const g = out[i + 1]
  const b = out[i + 2]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)

  // Key out near-black background; keep glowing greens/golds.
  if (max < 22) {
    out[i + 3] = 0
  } else if (max < 55 && min < 40) {
    out[i + 3] = Math.round(((max - 22) / 33) * 180)
  } else {
    out[i + 3] = 255
  }
}

const png = await sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer()
writeFileSync(output, png)

const check = readFileSync(output)
console.log('[thinking-ring] wrote', output, `${width}x${height}`, 'bytes', check.length)
console.log('[thinking-ring] PNG sig', check.slice(0, 8).toString('hex'))
