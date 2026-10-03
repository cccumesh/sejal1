/**
 * forensic txt → print-ready HTML → PDF (via Edge headless if available)
 * Run: node scripts/forensic-txt-to-pdf.mjs
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const inputPath = join(root, 'docs', 'forensic-gemini-receiver-first-payload.txt')
const htmlPath = join(root, 'docs', 'forensic-gemini-receiver-first-payload.html')
const pdfPath = join(root, 'docs', 'forensic-gemini-receiver-first-payload.pdf')

if (!existsSync(inputPath)) {
  console.error('Missing:', inputPath)
  console.error('Run first: npm run dump-receiver-payload')
  process.exit(1)
}

const text = readFileSync(inputPath, 'utf8')
const escaped = text
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Gemini Receiver First Scan — Exact Payload</title>
  <style>
    @page { size: A4; margin: 12mm 10mm; }
    * { box-sizing: border-box; }
    body {
      font-family: Consolas, "Courier New", monospace;
      font-size: 7pt;
      line-height: 1.25;
      color: #111;
      margin: 0;
      padding: 12mm 10mm;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    h1 {
      font-family: Segoe UI, Arial, sans-serif;
      font-size: 11pt;
      margin: 0 0 8px;
    }
    .meta {
      font-family: Segoe UI, Arial, sans-serif;
      font-size: 8pt;
      color: #444;
      margin-bottom: 12px;
      white-space: normal;
    }
    pre { margin: 0; white-space: pre-wrap; word-wrap: break-word; }
    @media print {
      body { padding: 0; }
    }
  </style>
</head>
<body>
  <h1>Gemini RECEIVER_FIRST Welcome — Exact Payload</h1>
  <p class="meta">Axerai Richera forensic dump. Share this PDF with ChatGPT for full systemInstruction + userPrompt review.</p>
  <pre>${escaped}</pre>
</body>
</html>`

writeFileSync(htmlPath, html, 'utf8')
console.log('HTML written:', htmlPath)

const edgePaths = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
]

const browser = edgePaths.find((p) => existsSync(p))
if (!browser) {
  console.log('')
  console.log('Browser not found for auto-PDF. Manual steps:')
  console.log('1. Open:', htmlPath)
  console.log('2. Ctrl+P → Save as PDF →', pdfPath)
  process.exit(0)
}

try {
  if (existsSync(pdfPath)) unlinkSync(pdfPath)
} catch {
  // ignore
}

const fileUrl = 'file:///' + htmlPath.replace(/\\/g, '/')
const result = spawnSync(
  browser,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-pdf-header-footer',
    `--print-to-pdf=${pdfPath}`,
    fileUrl,
  ],
  { stdio: 'inherit', timeout: 120000 },
)

if (result.status === 0 && existsSync(pdfPath)) {
  const stat = readFileSync(pdfPath)
  console.log(`PDF written: ${pdfPath} (${Math.round(stat.length / 1024)} KB)`)
} else {
  console.log('')
  console.log('Auto PDF failed. Open HTML manually:')
  console.log(htmlPath)
  console.log('Ctrl+P → Save as PDF')
  process.exit(result.status || 1)
}
