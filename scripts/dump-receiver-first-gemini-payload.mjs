/**
 * TEMPORARY FORENSIC TOOL — dumps exact Gemini payload for RECEIVER_FIRST welcome.
 * Run: node scripts/dump-receiver-first-gemini-payload.mjs
 * Output: docs/forensic-gemini-receiver-first-payload.txt
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const outPath = join(root, 'docs', 'forensic-gemini-receiver-first-payload.txt')

const SENDER_MYRA_LINES = [
  'Arre wah! Richera ki jaan jagi... pehle bata, tera naam kya hai?',
  'Achha! Ye gift kiske liye hai?',
  'Wah wah! Pehli mulaqat kahan hui tum dono ki?',
  'Bracelet ke baare mein kuch bata na — kyun choose kiya?',
]

const SENDER_USER_LINES = [
  'My name is Chetan.',
  'This gift is for Sejal.',
  'We first met at a cafe.',
  'I bought this bracelet because it will look beautiful on her.',
]

function buildMockSenderSummaryEntry(summarizeMod) {
  const raw = summarizeMod.buildLocalStorySummary({
    roleKey: 'sender',
    userLines: SENDER_USER_LINES,
    myraLines: SENDER_MYRA_LINES,
  })
  const enriched = summarizeMod.enrichSessionSummary(raw, '')
  const sanitized = summarizeMod.sanitizeSummaryForMemory(enriched)
  return [
    '--- session 1 summary (Sender) ---',
    'date: Wednesday, 27 August 2025, 2:30:00 pm',
    'started: Wednesday, 27 August 2025, 2:00:00 pm',
    'ended: Wednesday, 27 August 2025, 2:30:00 pm',
    'duration: 30 min',
    'summary:',
    sanitized,
    'brand_praise: "I bought this bracelet because it will look beautiful on her."',
    'praise: "I bought this bracelet because it will look beautiful on her."',
  ].join('\n')
}

const server = await createServer({
  root,
  logLevel: 'error',
  server: { middlewareMode: true },
})

try {
  const promptMod = await server.ssrLoadModule('/src/myraPrompt.js')
  const ledgerMod = await server.ssrLoadModule('/src/myraLedger.js')
  const summarizeMod = await server.ssrLoadModule('/src/myraSummarize.js')
  const geminiMod = await server.ssrLoadModule('/src/geminiModels.js')
  const ttsMod = await server.ssrLoadModule('/src/elevenLabsTts.js')

  const senderSummaries = buildMockSenderSummaryEntry(summarizeMod)
  const memoryText = ledgerMod.debugSeedAndBuildReceiverFirstMemory({
    verificationCode: 'R',
    senderSessionSummaries: senderSummaries,
  })

  const liveContext = promptMod.getOpeningLiveContext()
  const welcomeMode = 'RECEIVER_FIRST'
  const sessionRole = 'RECEIVER'

  const openingType = promptMod.resolveMyraOpeningPromptType({
    type: 'welcome',
    memoryText,
    welcomeMode,
    sessionRole,
  })

  const inworld = ttsMod.isInworldTtsConfigured()
  const systemInstruction = promptMod.getMyraSystemPrompt({ ttsAudioTags: inworld })

  const userPrompt = promptMod.buildMyraUserPrompt({
    type: openingType,
    liveContext,
    memoryText,
    sessionRole,
    welcomeMode,
  })

  const generationConfig = geminiMod.myraGenerationConfig('flash')
  const modelName = geminiMod.MYRA_CHAT_FLASH_CHAIN[0]

  const apiRequest = {
    model: modelName,
    modelFallbackChain: geminiMod.MYRA_CHAT_FLASH_CHAIN,
    systemInstruction,
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig,
    reason: 'welcome-or-boot (forceFlash: true)',
  }

  const lines = []
  const sep = (title) => {
    lines.push('')
    lines.push('='.repeat(60))
    lines.push(title)
    lines.push('='.repeat(60))
    lines.push('')
  }

  lines.push('FORENSIC DUMP — RECEIVER_FIRST welcome (first Myra line, no USER_JUST_SAID)')
  lines.push(`Generated: ${new Date().toISOString()}`)
  lines.push(`Inworld TTS configured: ${inworld}`)
  lines.push(`System instruction length: ${systemInstruction.length} chars`)
  lines.push(`User prompt length: ${userPrompt.length} chars`)

  sep('START OF EXACT SYSTEM INSTRUCTION')
  lines.push(systemInstruction)
  sep('END OF EXACT SYSTEM INSTRUCTION')

  sep('START OF EXACT USER PROMPT')
  lines.push(userPrompt)
  sep('END OF EXACT USER PROMPT')

  sep('RAW SENDER SUMMARY BLOCK (as stored in session_summaries)')
  lines.push(senderSummaries)

  sep('EXACT API REQUEST STRUCTURE (no API keys)')
  lines.push(JSON.stringify(apiRequest, null, 2))

  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, lines.join('\n'), 'utf8')

  console.log(`Wrote ${lines.join('\n').length} chars to:\n${outPath}`)
  console.log(`systemInstruction: ${systemInstruction.length} chars`)
  console.log(`userPrompt: ${userPrompt.length} chars`)
} finally {
  await server.close()
}
