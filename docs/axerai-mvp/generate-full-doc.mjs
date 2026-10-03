/**
 * Generates AXERAI-MVP-Technical-FULL.html — exhaustive technical reference.
 * Run: node docs/axerai-mvp/generate-full-doc.mjs
 */
import { writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const out = join(dirname(fileURLToPath(import.meta.url)), 'AXERAI-MVP-Technical-FULL.html')

const pages = []

function page(num, section, body) {
  pages.push({ num, section, body })
}

function pageShell(sectionLabel, body, pageNum) {
  return `<div class="page"><div class="page-inner">
<div class="page-header"><div class="ph-brand"><strong>Axerai</strong><span>Products receive digital life</span></div><div class="ph-doc">${sectionLabel}</div></div>
<div class="page-body">${body}</div>
<div class="page-footer"><span>Axerai MVP · Full Technical Reference · Confidential</span><span>Page ${pageNum}</span></div>
</div></div>`
}

function h2(n, title) {
  return `<h2><span class="section-num">${n}</span>${title}</h2>`
}

function tbl(headers, rows) {
  const th = headers.map((h) => `<th>${h}</th>`).join('')
  const tr = rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')
  return `<table><tr>${th}</tr>${tr}</table>`
}

function pre(text) {
  return `<pre class="code-block">${text.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`
}

function ul(items) {
  return `<ul class="compact">${items.map((i) => `<li>${i}</li>`).join('')}</ul>`
}

// ─── COVER ───
pages.push({
  num: 0,
  section: 'cover',
  body: `<div class="cover-layout">
    <div class="cover-left">
      <div class="cover-brand"><div class="cover-brand-name">Axerai</div><div class="cover-brand-line">Products receive digital life</div></div>
      <h1>Full Technical<br /><em>Reference</em></h1>
      <p class="cover-sub">Implementation bible — all modules, flows, env vars, APIs, ledger rules, and edge cases. Companion to the Overview PDF.</p>
      <div class="cover-pills">
        <span class="cover-pill">22 Sections</span><span class="cover-pill">Complete File Map</span><span class="cover-pill">Env + API Spec</span>
        <span class="cover-pill">Verify + Ledger Deep Dive</span><span class="cover-pill">Example Code AXE-327T5</span>
      </div>
      <div class="cover-meta">
        <div class="cover-meta-item"><label>Document Type</label><strong>Technical FULL</strong></div>
        <div class="cover-meta-item"><label>Voice (Doc)</label><strong>Inworld API</strong></div>
        <div class="cover-meta-item"><label>Version</label><strong>July 2026 Pilot</strong></div>
        <div class="cover-meta-item"><label>Pair With</label><strong>AXERAI-MVP-Document.pdf</strong></div>
      </div>
    </div>
    <div class="cover-right">
      <svg class="cover-visual" viewBox="0 0 400 280" xmlns="http://www.w3.org/2000/svg">
        <rect width="400" height="280" fill="#0f1824" rx="12"/>
        <text x="200" y="50" text-anchor="middle" font-size="14" fill="#e8c547" font-weight="700">IMPLEMENTATION MAP</text>
        <rect x="30" y="70" width="160" height="36" rx="6" fill="#ecfdf5" stroke="#0d9488"/><text x="110" y="93" text-anchor="middle" font-size="9" fill="#1e293b">Intro + Preload</text>
        <rect x="210" y="70" width="160" height="36" rx="6" fill="#ecfdf5" stroke="#0d9488"/><text x="290" y="93" text-anchor="middle" font-size="9" fill="#1e293b">MindAR + Layer A</text>
        <rect x="30" y="120" width="160" height="36" rx="6" fill="#eff6ff" stroke="#2563eb"/><text x="110" y="143" text-anchor="middle" font-size="9" fill="#1e293b">Verify B + C</text>
        <rect x="210" y="120" width="160" height="36" rx="6" fill="#eff6ff" stroke="#2563eb"/><text x="290" y="143" text-anchor="middle" font-size="9" fill="#1e293b">Gemini + Inworld</text>
        <rect x="30" y="170" width="160" height="36" rx="6" fill="#fef9e7" stroke="#c9a227"/><text x="110" y="193" text-anchor="middle" font-size="9" fill="#1e293b">Ledger Memory</text>
        <rect x="210" y="170" width="160" height="36" rx="6" fill="#fef9e7" stroke="#c9a227"/><text x="290" y="193" text-anchor="middle" font-size="9" fill="#1e293b">Admin Dashboard</text>
        <text x="200" y="240" text-anchor="middle" font-size="10" fill="#94a3b8">App.jsx orchestrates · 25+ src modules</text>
      </svg>
    </div>
  </div>`,
})

// ─── TOC ───
page('TOC', 'Contents', `${h2('§', 'Contents — 22 Sections')}
<div class="toc-grid">
<ul class="toc">
<li><span>01</span><span>What This MVP Is</span></li>
<li><span>02</span><span>Technology Stack (Complete)</span></li>
<li><span>03</span><span>Repository Structure</span></li>
<li><span>04</span><span>End-to-End User Flow</span></li>
<li><span>05</span><span>Intro Overlay &amp; Asset Preload</span></li>
<li><span>06</span><span>AR / MindAR Configuration</span></li>
<li><span>07</span><span>Three-Layer Verification (Product + Code)</span></li>
<li><span>08</span><span>D3 Character — Model &amp; Animation</span></li>
<li><span>09</span><span>Lip Sync Pipeline</span></li>
<li><span>10</span><span>AI Brain — Google Gemini</span></li>
<li><span>11</span><span>Voice — Inworld API</span></li>
</ul>
<ul class="toc">
<li><span>12</span><span>Speech-to-Text &amp; Input Modes</span></li>
<li><span>13</span><span>Supabase Ledger &amp; Memory</span></li>
<li><span>14</span><span>Session Summaries &amp; KNOWN FACTS</span></li>
<li><span>15</span><span>Admin Dashboard</span></li>
<li><span>16</span><span>Environment Variables</span></li>
<li><span>17</span><span>Netlify Deployment &amp; API Endpoints</span></li>
<li><span>18</span><span>UI / CSS Components</span></li>
<li><span>19</span><span>Error Handling Catalog</span></li>
<li><span>20</span><span>Key Constants &amp; State Machine</span></li>
<li><span>21</span><span>Security, VR Mode, Mobile Shell</span></li>
<li><span>22</span><span>Build, Run &amp; Not in MVP</span></li>
</ul>
</div>
<div class="callout"><strong>Note:</strong> This document uses generic MVP naming (D3 character, code <code>AXE-327T5</code>, Inworld voice). Codebase module names (myra*, elevenLabsTts.js) are cited as implementation paths only.</div>`)

page('01-02', 'Sections 01–02', `${h2('1', 'What This MVP Is')}
<p class="lead">Browser-based, app-less WebAR platform turning physical packaging into a conversational digital touchpoint with persistent per-code memory.</p>
${ul([
  'User opens URL → intro preload → camera grant → MindAR tracks image target on box.',
  '<strong>Layer A (fast):</strong> product visible → 3D persona appears immediately (Stage 1).',
  '<strong>Layers B + C (background):</strong> Gemini vision verifies brand/code on packaging + liveness anti-spoof → true/false stored.',
  'Live mic STT → Gemini reply → Inworld TTS → D3 persona talks with lip-sync mouth morph.',
  'Exit: session summary + KNOWN FACTS saved; Axerai AI + voice tokens logged per code.',
])}
${h2('2', 'Technology Stack (Complete)')}
${tbl(['Layer', 'Technology', 'Version / Notes'], [
  ['Language', 'JavaScript ES modules', '.js / .jsx — no TypeScript'],
  ['UI', 'React + Vite + Tailwind', '19.x / 8.x / 4.x'],
  ['3D / AR', 'Three.js + MindAR', '0.184 / mind-ar image tracking'],
  ['Character', 'FBX Mixamo rig + morph targets', 'D3 persona on AR anchor'],
  ['AI', 'Google Gemini SDK', 'gemini-3.1-flash-lite primary'],
  ['Voice TTS', 'Inworld API (doc)', 'Custom cloned persona; browser TTS fallback'],
  ['STT', 'Web Speech API', 'en-IN — Roman Hinglish intent'],
  ['Database', 'Supabase PostgreSQL', 'ledger_threads table'],
  ['Hosting', 'Netlify', 'Static dist/ + Node 20 functions'],
  ['Lint', 'ESLint 10', 'npm run lint'],
])}`)

page('03', 'Section 03', `${h2('3', 'Repository Structure')}
${pre(`axerai-love/
├── index.html                 SPA shell, mobile meta, viewport
├── vite.config.js             React + Tailwind + three-mindar-shim
├── tailwind.config.js
├── netlify.toml               Build, Node 20, SPA redirect, functions/
├── package.json
├── scripts/verify-netlify-env.mjs   Pre-build secret leak guard
├── public/
│   ├── models/myra2.fbx       D3 character mesh (+ idle/talk FBX at runtime)
│   ├── videos/target.mp4      Product card video on AR anchor
│   ├── videos/intro.mp4       Optional intro media
│   ├── images/*-loading.png   Intro splash background
│   ├── targets.mind           MindAR image target (deploy asset)
│   └── manifest.webmanifest
├── netlify/functions/
│   ├── gemini.mjs             Secure Gemini proxy
│   └── elevenlabs-tts.mjs     TTS proxy (Inworld wiring in production doc)
├── supabase/fresh_start.sql   Full schema + seed rows
└── src/
    ├── main.jsx               App vs AdminDashboard route split
    ├── App.jsx                Main orchestrator (~3700 lines)
    ├── AdminDashboard.jsx     Password insights UI
    ├── index.css              AR HUD, intro, live mic, admin styles
    ├── apiProxy.js            /.netlify/functions/* fetch helpers
    ├── supabaseClient.js      Anon Supabase client
    ├── geminiModels.js        Model chains + flash/lite routing
    ├── geminiUsage.js         Token normalization from API responses
    ├── axeraiAssets.js        Weighted intro preload
    ├── myraModel.js           D3 load, animations, mouth morph
    ├── myraLipSync.js         Audio → mouth level 0–1
    ├── myraPrompt.js          Persona system prompt + user prompts
    ├── myraSummarize.js       Exit summary + KNOWN FACTS extraction
    ├── myraLedger.js          Supabase memory, pairing, token logs
    ├── myraVerify.js          Gemini 3-layer vision verify
    ├── myraErrorFallback.js   Offline in-character error lines
    ├── myraTargetVideo.js     AR anchor product video plane
    ├── myraStaticSession.jsx  VR static scene (no camera)
    ├── elevenLabsTts.js       TTS module (Inworld integration layer)
    ├── mobileBrowser.js       iOS/Android detection
    ├── mobileShell.js         Portrait lock, gesture block
    └── three-mindar-shim.js   Three.js encoding shim`)}`)

page('04a', 'Section 04', `${h2('4', 'End-to-End User Flow')}
<h3>Phase A — Intro &amp; Permissions</h3>
${ul([
  'User opens Netlify URL → <code>IntroShell</code> visible, <code>loadAxeraiExperienceAssets()</code> runs.',
  'Weighted preload: D3 FBX (5), target.mp4 (2), targets.mind (1), splash image (1). Min splash 1200ms.',
  'Progress bar reflects actual download — not fake timer.',
  'Camera grant on user gesture (iOS requirement). Back/environment camera preferred.',
  'Geolocation requested in background for regional slang in AI prompts.',
  'Intro handoff animation → <code>main-reveal</code> crossfade to AR viewport.',
])}
<h3>Phase B — AR Session &amp; Layer A</h3>
${ul([
  '<code>MindARThree</code> starts — reuses intro camera stream when possible.',
  'User points at printed image target on packaging.',
  '<strong>Layer A fires:</strong> target found → anchor group live → product video on plane → D3 persona mounts.',
  'Persona may show after target video phase; verify runs in parallel (background).',
  'Torch toggle, camera flip available in HUD.',
])}`)

page('04b', 'Section 04 cont.', `${h2('4', 'User Flow (continued)')}
<h3>Phase C — Meet Character &amp; Audio Gate</h3>
${ul([
  'First TTS on iPhone requires explicit tap (“Meet character”) — unlocks Web Audio session.',
  '<code>needsAudioTap</code> gate; separate unlock audio element never overwrites TTS src.',
  'After unlock, subsequent lines auto-play.',
])}
<h3>Phase D — Live Conversation</h3>
${ul([
  'Default compose mode: <strong>liveMic</strong> — Web Speech API continuous recognition.',
  'Interim transcript in liquid capsule UI; “Tap to fix” before auto-send.',
  'Auto-send after <code>LIVE_MIC_SILENCE_MS = 2200</code> ms silence.',
  'While AI thinks or speaks: mic <strong>fully released</strong> (not muted); live mic panel hidden.',
  'Gemini reply → <code>prepareMyraSpeechText()</code> → Inworld TTS → lip sync + talk animation.',
  '<code>isTalking</code> true only on audio <code>onStart</code>, not when text arrives.',
  'Alternate modes: <strong>keyboard</strong> text + image upload; PTT fingerprint button in compose bar.',
])}
<h3>Phase E — Session End</h3>
${ul([
  'User exits or <code>&lt;SYSTEM_SLEEP&gt;</code> token in Gemini reply triggers warm exit.',
  '<code>finishLedgerScan()</code> + <code>summarizeSessionDialogue()</code> via Gemini.',
  'KNOWN FACTS merged into locked memory block.',
  'Axerai AI tokens + voice tokens appended as JSON lines.',
  'Next scan injects memory — persona does not re-ask locked facts.',
])}
<div class="diagram-wrap"><div class="diagram-title">App State Machine (Simplified)</div>
${pre(`introVisible → asset preload → camera grant → intro exit
  → MindARSession → onTargetFound → target video → Layer A persona
  → runAnchorVerify (once, locked) → ledger pairing → welcome
  → liveMic|keyboard loop → exit → summarize → ledger save
Parallel: AR|VR toggle · verifyLocked · needsAudioTap · torch`)}
</div>`)

page('05', 'Section 05', `${h2('5', 'Intro Overlay &amp; Asset Preload')}
<p><strong>File:</strong> <code>axeraiAssets.js</code> + <code>IntroShell</code> in <code>App.jsx</code></p>
${tbl(['Asset', 'Path', 'Weight', 'Purpose'], [
  ['D3 FBX bundle', 'preloadMyraModels()', '5', 'Character + idle + talk clips'],
  ['Target video', '/videos/target.mp4', '2', 'Product card on AR anchor'],
  ['MindAR target', '/targets.mind', '1', 'Image tracking definition'],
  ['Splash art', '/images/*-loading.png', '1', 'Branded loading background'],
])}
${ul([
  '<code>MIN_SPLASH_MS = 1200</code> — minimum branded splash even if assets cache-fast.',
  'Camera permission UI: tap ring, retry card (<code>.intro-access-*</code> CSS).',
  'iOS strategy: getUserMedia on first pointerdown before audio/geo prompts.',
  'Failed preload surfaces error state; user can retry grant.',
  '<code>logAxeraiBuildConfig()</code> logs env fingerprint on App mount (dev debug).',
])}`)

page('06', 'Section 06', `${h2('6', 'AR / MindAR Configuration')}
${tbl(['Setting', 'Value / Behavior'], [
  ['Target file', '<code>/targets.mind</code>'],
  ['Library', '<code>MindARThree</code> from mind-ar'],
  ['UI chrome', "uiLoading/uiScanning/uiError: 'no' — custom HUD only"],
  ['Camera', 'Reuse intro stream via startMindARWithPreviewStream()'],
  ['Anchor', 'Image target 0 → anchorGroup → video plane + D3 wrapper'],
  ['Lighting', 'Ambient 1.4 + directional 2.5 + fill 1.2'],
  ['Character scale', '0.008 · position tuned to product anchor'],
  ['Scan guide', 'HUD: “Center the product / brand card”'],
  ['Teardown', 'softTeardownMindAR() keeps camera alive between sessions'],
  ['VR mode', 'myraStaticSession.jsx — static art, no camera, same chat stack'],
])}
<h3>Target Video Phase</h3>
<p><strong>File:</strong> <code>myraTargetVideo.js</code></p>
${ul([
  'MP4 on anchor plane before or during persona reveal.',
  '16s watchdog + Safari inline playback hacks.',
  '<code>TARGET_VIDEO_SAFETY_MS</code> force-advances stuck Safari playback.',
  '<code>targetVideoDone</code> gates welcome message scheduling.',
])}`)

page('07a', 'Section 07', `${h2('7', 'Three-Layer Verification')}
<div class="callout callout-teal"><strong>Product logic (patent):</strong> Layer A = fast visibility engine. Persona appears when product/target visible. Layers B + C run in background; return true/false without blocking Stage 1.</div>
<div class="layer-row"><div class="layer-badge layer-a">A · FAST</div><div class="layer-body"><h4>Product Visibility Engine</h4><p><strong>Trigger:</strong> MindAR target found / product in frame.<br><strong>Action:</strong> Instant 3D persona on anchor (Stage 1).<br><strong>Implementation:</strong> MindAR onTargetFound — not a Gemini call.</p></div></div>
<div class="layer-row"><div class="layer-badge layer-b">B · BG</div><div class="layer-body"><h4>Code / Brand Verification</h4><p><strong>Trigger:</strong> After Layer A — background frame capture.<br><strong>Action:</strong> Verify brand text / product code on packaging (e.g. <code>AXE-327T5</code>).<br><strong>Output:</strong> true = authentic · false = wrong/missing/unreadable.</p></div></div>
<div class="layer-row"><div class="layer-badge layer-c">C · BG</div><div class="layer-body"><h4>Liveness / Anti-Spoof</h4><p><strong>Trigger:</strong> Parallel with B.<br><strong>Action:</strong> Detect real product vs photo-on-screen, monitor replay, print spoof.<br><strong>Output:</strong> true = live product · false = spoof.</p></div></div>
<h3>Implementation Mapping (Gemini Vision — myraVerify.js)</h3>
${tbl(['Gemini Layer', 'Maps To', 'Checks'], [
  ['LAYER1 brand text', 'Product Layer B', 'Full brand name visible — no partial guess'],
  ['LAYER2 liveness', 'Product Layer C', 'Real card in hand vs screen/photo spoof'],
  ['LAYER3 frame', 'Quality gate', 'Card centered, readable, not random background'],
])}`)

page('07b', 'Section 07 cont.', `${h2('7', 'Verification Implementation (continued)')}
<h3>Single Gemini Call — Structured Output</h3>
${pre(`LAYER1: PASS | FAIL
LAYER2: PASS | FAIL
LAYER3: PASS | FAIL
RESULT: REAL | PHOTO_SPOOF | NO_BRAND | BAD_FRAME | UNCERTAIN

REAL = all PASS → code assigned (e.g. AXE-327T5)
PHOTO_SPOOF = LAYER2 FAIL (priority over others)
NO_BRAND = LAYER1 FAIL
BAD_FRAME = LAYER1 PASS + LAYER3 FAIL`)}
<h3>Pipeline</h3>
${ul([
  'Trigger: mindarReady && showMindAR && !verifyLocked && !isVerified',
  'Canvas snap from MindAR video → compressImageForVerify (max 768px JPEG 0.82)',
  'Gemini via proxy · temperature 0 · VERIFY_MODEL_CHAIN · 1 retry',
  '<code>verifyLockedRef</code> — one attempt per AR session (pass or fail)',
  'Verify fail: HUD note + in-character error via myraErrorFallback (not saved to ledger)',
  'Persona visibility: continues after target video even if verify fails; verify gates ledger pairing',
])}
<h3>Fail Reasons → UX</h3>
${tbl(['RESULT', 'Situation Key', 'User Experience'], [
  ['PHOTO_SPOOF', 'SCAN_PHOTO_SPOOF', 'Persona line: not a real product'],
  ['NO_BRAND', 'SCAN_CARD_NOT_FOUND', 'Brand/code not readable'],
  ['BAD_FRAME', 'SCAN_BAD_FRAME', 'Re-center product in frame'],
  ['UNCERTAIN', 'SCAN_GLITCH', 'Try again messaging'],
  ['Pair full', 'SCAN_PAIR_FULL', '3rd device blocked — 2 roles filled'],
])}`)

page('08', 'Sections 08–09', `${h2('8', 'D3 Character — Model &amp; Animation')}
${tbl(['Asset', 'Path', 'Purpose'], [
  ['Character mesh', '/models/myra2.fbx', 'Skinned D3 persona'],
  ['Idle', 'idle.fbx', 'Standing loop when silent'],
  ['Talk clips', 'talking-4/5/6.fbx', 'Random while speaking'],
  ['Placement', 'pos (0,-0.35,-0.15) scale 0.008', 'Tuned to packaging anchor'],
])}
${ul([
  'Three.js AnimationMixer on skinned mesh.',
  'Idle ↔ Talk crossfade 0.35s — no hard stop (prevents T-pose flash).',
  'Random talk clip; avoids same clip twice consecutively.',
  'preloadMyraModels() + SkeletonUtils.clone() per session.',
  'tickMyraMixer(anchorGroup, delta) every animation frame.',
])}
${h2('9', 'Lip Sync Pipeline')}
<h3>Step 1 — Audio analysis (myraLipSync.js)</h3>
${ul([
  'TTS &lt;audio&gt; → Web Audio AnalyserNode → mouth level 0 (closed) to 1 (open).',
  'Mid-frequency speech band energy mapped to mouth openness.',
  'iPhone: skip Web Audio graph → procedural sine mouth (protects audio session).',
  'Smoothed per frame; eases closed on speech end.',
])}
<h3>Step 2 — Mesh application (myraModel.js)</h3>
${ul([
  '<strong>Priority A:</strong> morph target <code>mouth open</code> (also mouthopen, jaw, lip keys).',
  '<strong>Priority B:</strong> head bone micro-tilt if no morph targets.',
  'Smoothing factor 0.32 per frame on morph influence.',
  'connectTtsAudio() / disconnectTtsAudio() on TTS lifecycle.',
])}`)

page('10', 'Section 10', `${h2('10', 'AI Brain — Google Gemini')}
<h3>Model Chains (geminiModels.js)</h3>
${tbl(['Use', 'Primary', 'Fallback'], [
  ['Chat', 'gemini-3.1-flash-lite', 'gemini-flash-lite-latest'],
  ['Verify', 'same chain', 'same'],
  ['Summary', 'same chain', 'same'],
])}
<h3>Flash vs Lite Tier Routing</h3>
${ul([
  'Flash tier (temp 0.95): first 6 user turns, messages ≥150 words, welcome/boot/resume.',
  'Lite tier (temp 0.85): default mid-session chat.',
  'resolveMyraChatModels() returns models + tier + reason string for logging.',
])}
<h3>Persona Prompt (myraPrompt.js)</h3>
${ul([
  'Large MYRA_SYSTEM_PROMPT — Axerai Core Directive + character bible.',
  'Output: casual Hinglish Roman script; emotion-first; no bot/API jargon.',
  'Scenarios: retail browse, keepsake gift, sender/receiver gift flows.',
  'buildMyraUserPrompt({ type: welcome|resume|reply|boot }) per turn.',
  'KNOWN FACTS (LOCKED) block injected from ledger — no re-ask name/gift-for/occasion.',
  'Inworld path: sparse audio tags [laughs softly] stripped from ledger text.',
])}
<h3>Call Types Logged</h3>
${tbl(['callType', 'When'], [
  ['verify', '3-layer vision frame check'],
  ['welcome', 'First greeting after scan'],
  ['chat', 'User message reply'],
  ['summary', 'Session exit summarization'],
])}`)

page('11', 'Section 11', `${h2('11', 'Voice — Inworld API')}
<div class="callout"><strong>MVP documentation voice:</strong> Inworld TTS with custom cloned brand persona. Integration module in codebase: <code>elevenLabsTts.js</code> + <code>elevenlabs-tts.mjs</code> proxy. Browser speechSynthesis is fallback.</div>
<h3>Configuration</h3>
${tbl(['Env (local)', 'Purpose'], [
  ['VITE_INWORLD_ENABLED=true', 'Enable cloud voice'],
  ['VITE_INWORLD_VOICE_ID', 'Cloned persona voice ID'],
])}
${tbl(['Env (Netlify server)', 'Purpose'], [
  ['INWORLD_API_KEY', 'Server-side only — never in browser bundle'],
  ['INWORLD_VOICE_ID', 'Default voice for proxy'],
])}
<h3>TTS Flow</h3>
${ul([
  '1. Gemini text → prepareMyraSpeechText() — strip markdown/emojis.',
  '2. PROD: POST /.netlify/functions/inworld-tts (proxy) → MP3 blob.',
  '3. Hidden &lt;audio&gt; playback → connectTtsAudio() → lip sync.',
  '4. Response header X-Axerai-Characters → voice token log.',
  '5. Failure → pickMyraVoice() browser speechSynthesis (Swara/hi/en-IN priority).',
  '6. MYRA_TTS_SAFETY_MS = 35000 — recovery if TTS hangs.',
])}
<h3>iPhone / Safari Critical Rules</h3>
${ul([
  'Separate unlock audio element — never overwrite active TTS src.',
  'First line deferred until Meet-character tap (user gesture).',
  'Silent oscillator keep-alive on iOS only.',
  'Mic fully released during TTS — prevents echo + Android STT conflict.',
  'primeSafariSpeechSynthesis() + unlockMobileSpeechAudio() on first touch.',
])}`)

page('12', 'Section 12', `${h2('12', 'Speech-to-Text &amp; Input Modes')}
${tbl(['Setting', 'Value'], [
  ['API', 'Browser Web Speech API'],
  ['Language', 'en-IN (Roman Hinglish intent — avoid hi-IN Devanagari)'],
  ['Auto-send silence', 'LIVE_MIC_SILENCE_MS = 2200'],
  ['Voice energy threshold', 'LIVE_MIC_VOICE_ENERGY = 20'],
  ['Vision upload', 'GEMINI_VISION_ENABLED = false (UI exists, disabled)'],
])}
<h3>Tap to Fix</h3>
${ul([
  'Transcript tappable → edit mode with textarea + Send / Cancel.',
  'Auto-send timer paused while editing; STT onresult ignored.',
  'Cancel restores silence timer or restarts mic.',
])}
<h3>Compose Modes (App.jsx)</h3>
${tbl(['Mode', 'UI', 'Behavior'], [
  ['liveMic (default)', 'Liquid capsule + voice visualizer', 'Continuous STT → auto-send'],
  ['keyboard', 'Text field + optional image', 'Manual send; PTT fingerprint in bar'],
  ['HUD toggle', 'Keyboard / mic icons', 'Switch modes mid-session'],
])}
<h3>Android Mic Rule</h3>
<p>Do not hold getUserMedia for level meter while STT active — steals mic from recognition. Use procedural level animation instead.</p>`)

page('13', 'Sections 13–14', `${h2('13', 'Supabase Ledger &amp; Memory')}
<p><strong>Table:</strong> <code>ledger_threads</code> — max 2 rows per product code (sender + receiver). Schema: <code>supabase/fresh_start.sql</code></p>
${tbl(['Column', 'Type', 'Purpose'], [
  ['verification_code', 'text', 'Product code e.g. AXE-327T5'],
  ['device_id', 'text', 'Stable browser ID (localStorage + 5yr cookie)'],
  ['role', 'text', 'sender | receiver'],
  ['scan_count', 'int', 'Completed scans on this thread'],
  ['conversation', 'text', 'Full chat with session markers'],
  ['session_summaries', 'text', 'Exit summaries + FACTS per scan'],
  ['axerai_ai_usage', 'text', 'JSON lines — Gemini tokens'],
  ['axerai_voice_usage', 'text', 'JSON lines — Inworld characters'],
])}
<h3>Device Pairing Rules</h3>
${ul([
  'First device on code → sender thread. Second distinct device → receiver.',
  'Third device when both roles filled → SCAN_PAIR_FULL (blocked).',
  'resolveSessionAccess() determines role before welcome.',
  'Welcome modes: SENDER_FIRST, SENDER_RETURN, RECEIVER_FIRST, RECEIVER_RETURN.',
])}
${h2('14', 'Session Summaries &amp; KNOWN FACTS')}
<p><strong>File:</strong> <code>myraSummarize.js</code></p>
${ul([
  'Exit: summarizeSessionDialogue() via Gemini — FACTS / STORY / OPEN HOOK / BRAND PRAISE format.',
  'extractFactsFromSummary() → mergeKnownFacts() → formatKnownFactsBlock().',
  'buildGeminiMemoryText() injects locked facts + past story into next session prompt.',
  'Offline myraErrorFallback lines NEVER saved to ledger.',
  'Session markers: --- session N start/end --- in conversation column.',
])}
<h3>Usage JSON Line Examples</h3>
${pre(`{"at":"ISO8601","call":"chat","model":"gemini-3.1-flash-lite","prompt":4200,"output":180,"total":4380}
{"at":"ISO8601","call":"tts","model":"inworld-tts","voice":"persona-id","chars":287}`)}`)

page('15', 'Section 15', `${h2('15', 'Admin Dashboard')}
<p><strong>File:</strong> <code>AdminDashboard.jsx</code> · <strong>Route:</strong> <code>/{VITE_DASHBOARD_PATH}</code> (default <code>axerai-insights-7k2m</code>)</p>
${ul([
  'Routed in main.jsx by pathname or hash — skips mobile shell init.',
  'Password gate: VITE_DASHBOARD_PASSWORD → sessionStorage auth.',
  'Per-code filter (default seed: AXE-327T5 in doc / pilot codes in DB).',
  'Panels: scan analytics, conversation bubble parse, duration formatting.',
  'buildGeminiUsageAnalytics() — totals by call type, per-entry table.',
  'buildElevenLabsUsageAnalytics() — voice character totals (Inworld in doc).',
  'Brand product praise parsed from session summaries.',
  'Refresh + logout controls.',
])}`)

page('16-17', 'Sections 16–17', `${h2('16', 'Environment Variables')}
<h3>Local Development (.env)</h3>
${pre(`VITE_GEMINI_API_KEY=          # Direct Gemini in dev
VITE_INWORLD_ENABLED=true
VITE_INWORLD_VOICE_ID=
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_DASHBOARD_PATH=axerai-insights-7k2m
VITE_DASHBOARD_PASSWORD=`)}
<h3>Netlify Production (server — NOT in browser bundle)</h3>
${pre(`GEMINI_API_KEY=               # Required — build fails without
INWORLD_API_KEY=              # Inworld TTS server key
INWORLD_VOICE_ID=
NODE_VERSION=20
VITE_SUPABASE_URL=            # OK in client
VITE_SUPABASE_ANON_KEY=       # OK in client
VITE_DASHBOARD_PATH=
VITE_DASHBOARD_PASSWORD=`)}
<div class="callout"><strong>Build guard:</strong> verify-netlify-env.mjs blocks VITE_GEMINI_API_KEY and VITE_INWORLD_API_KEY on Netlify — secrets must use server keys only.</div>
${h2('17', 'Netlify Deployment &amp; API Endpoints')}
${tbl(['Item', 'Value'], [
  ['Build cmd', 'node scripts/verify-netlify-env.mjs && npm run build'],
  ['Publish', 'dist/'],
  ['Node', '20'],
  ['SPA', '/* → /index.html status 200'],
])}
${tbl(['Endpoint', 'Method', 'Body / Response'], [
  ['/.netlify/functions/gemini', 'GET', 'Health / key fingerprint'],
  ['/.netlify/functions/gemini', 'POST', 'userPrompt, systemInstruction, models[], imagePart?, generationConfig'],
  ['/.netlify/functions/inworld-tts', 'POST', 'text, voiceId? → MP3 + X-Axerai-Characters header'],
])}
<p>Local dev: USE_API_PROXY false when not PROD — direct SDK with VITE_GEMINI_API_KEY.</p>`)

page('18-19', 'Sections 18–19', `${h2('18', 'UI / CSS Components (index.css)')}
${tbl(['Class prefix', 'Purpose'], [
  ['.intro-* / .intro-access-*', 'Intro shell, camera permission tap ring'],
  ['.myra-live-mic-*', 'Live mic panel, capsule, voice energy (~230 lines)'],
  ['.myra-live-mic-edit', 'Tap-to-fix edit UI'],
  ['.hud-*', 'AR overlay: scan guide, verify note, side dock, AR/VR toggle'],
  ['.axerai-audio-tap', 'Meet character iOS unlock button'],
  ['.compose-* / .myra-ptt-*', 'Keyboard compose + fingerprint PTT'],
  ['.admin-dash__*', 'Dashboard layout and analytics tables'],
  ['.main-reveal', 'Intro → AR crossfade animation'],
])}
${h2('19', 'Error Handling Catalog')}
<p><strong>File:</strong> <code>myraErrorFallback.js</code></p>
${tbl(['Phase', 'Situations'], [
  ['SCAN', 'SCAN_CARD_NOT_FOUND, SCAN_PHOTO_SPOOF, SCAN_BAD_FRAME, SCAN_GLITCH, SCAN_PAIR_FULL, SCAN_MAGIC_ASLEEP'],
  ['WELCOME', 'WELCOME_MAGIC_OFF, WELCOME_QUOTA, WELCOME_CONNECTION_WEAK, WELCOME_BUSY, WELCOME_GLITCH'],
  ['CHAT', 'CHAT_QUOTA, CHAT_CONNECTION_WEAK, CHAT_BUSY, CHAT_GLITCH'],
  ['INPUT', 'NO_SPEECH, MIC_BLOCKED, PHOTO_FAIL'],
])}
${ul([
  'pickMyraErrorLine(situation) — random in-character Hinglish; no repeat same session.',
  'classifyGeminiError() maps API errors to situations.',
  'Silent errors (no TTS): NO_SPEECH, CHAT_GLITCH, CHAT_QUOTA.',
  'MYRA_ERROR_REPEAT_RISK: high/medium/low/once per situation.',
])}`)

page('20-21', 'Sections 20–21', `${h2('20', 'Key Constants &amp; State Machine')}
${tbl(['Constant', 'Value', 'Meaning'], [
  ['MINDAR_TARGET', '/targets.mind', 'AR target file'],
  ['SPEECH_RECO_LANG', 'en-IN', 'STT language'],
  ['LIVE_MIC_SILENCE_MS', '2200', 'Auto-send delay'],
  ['LIVE_MIC_VOICE_ENERGY', '20', 'Mic level threshold'],
  ['MYRA_TTS_SAFETY_MS', '35000', 'Max TTS wait before recovery'],
  ['GEMINI_VISION_ENABLED', 'false', 'User photo to Gemini in chat off'],
  ['GEMINI_RETRIES_PER_MODEL', '2', 'API retry count'],
  ['MYRA_FLASH_USER_TURNS', '6', 'Flash tier turn count'],
  ['MIN_SPLASH_MS', '1200', 'Intro minimum display'],
])}
${h2('21', 'Security, VR Mode, Mobile Shell')}
<h3>Security Model</h3>
${ul([
  '3-layer verify + one cycle per session.',
  'API keys server-side in production.',
  'Supabase RLS: anon insert/select/update on ledger_threads (pilot — tighten at scale).',
  'Dashboard: secret path + password, sessionStorage only.',
  'Device ID = continuity, not authentication.',
  'Per-code usage caps (pilot policy) — soft exit ~200–300 voice tokens remain.',
  'Patent-pending multi-layer verification architecture.',
])}
<h3>VR Mode &amp; Mobile Shell</h3>
${ul([
  'experienceViewMode: ar | vr — toggle in HUD.',
  'VR: MyraStaticSession — static brand art background, same chat/voice stack.',
  'mobileShell.js: portrait orientation lock, block pinch/double-tap zoom, select prevention.',
  'mobileBrowser.js: iOS detection drives lip sync + audio unlock paths.',
])}`)

page('22', 'Section 22', `${h2('22', 'Per-Code Budget, Build &amp; Not in MVP')}
<h3>Pilot Budget Packages (Example AXE-327T5)</h3>
${tbl(['Package', 'Time', 'AI Tokens', 'Voice Tokens'], [
  ['Light', '~12 min', '~59,000', '~4,000'],
  ['Standard', '~30 min', '~1.5L', '~10,000'],
  ['Deep', '~60 min', '~2.9L', '~20,000'],
])}
<p>Policy: when ~200–300 voice tokens remain → persona warm exit line → session ends for that code. (Pricing model — enforcement configurable per pilot.)</p>
<h3>Build &amp; Run</h3>
${pre(`npm install
npm run dev          # localhost Vite
npm run build        # production dist/
npm run preview
npm run lint

Fresh DB: Supabase SQL Editor → run supabase/fresh_start.sql only`)}
<h3>Not in MVP Yet</h3>
${ul([
  'Self-serve brand dashboard (upload persona, register products).',
  'Inworld STS full speech-to-speech pipeline.',
  'Google Cloud STT (browser only today).',
  'Own GPU inference server (future scale path documented in pricing docs).',
  'Multi-tenant brand admin.',
  'Native app store application.',
])}
<div class="callout" style="margin-top:12px;"><strong>One-line definition:</strong> Axerai MVP = scan packaging → Layer A instant persona → background B/C verify → Gemini conversation with ledger memory → Inworld voice with lip-sync → Axerai AI + voice tokens per code <code>AXE-327T5</code>.</div>
<p style="margin-top:10px;font-size:8pt;color:#64748b;">End of Full Technical Reference. Companion overview: AXERAI-MVP-Document.pdf. No application code modified by this document.</p>`)

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Axerai MVP — Full Technical Reference</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet" />
  <style>
    :root{--ink:#0a0e14;--ink-soft:#141c28;--surface:#fff;--surface-muted:#f1f5f9;--border:#dde4ed;--gold:#c9a227;--gold-light:#e8c547;--gold-bg:#fef9e7;--teal:#0d9488;--teal-bg:#ecfdf5;--blue:#2563eb;--blue-bg:#eff6ff;--rose:#be123c;--text:#1e293b;--text-muted:#64748b;--page-w:297mm;--page-h:210mm;--pad-x:14mm;--pad-y:11mm}
    @page{size:297mm 210mm;margin:0}*{box-sizing:border-box;margin:0;padding:0}
    body{font-family:"DM Sans",system-ui,sans-serif;background:#c8d0da;color:var(--text);line-height:1.5;font-size:8.5pt;-webkit-print-color-adjust:exact;print-color-adjust:exact;padding-top:48px}
    .toolbar{position:fixed;top:0;left:0;right:0;z-index:999;background:var(--ink);color:#fff;padding:12px 24px;display:flex;align-items:center;justify-content:space-between}
    .toolbar button{background:linear-gradient(135deg,var(--gold-light),var(--gold));color:var(--ink);border:none;padding:9px 20px;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer}
    .doc{margin:16px auto;width:var(--page-w)}
    .page{width:var(--page-w);height:var(--page-h);background:var(--surface);position:relative;overflow:hidden;page-break-after:always;margin-bottom:16px;box-shadow:0 8px 32px rgba(0,0,0,.12)}
    .page:last-child{page-break-after:auto;margin-bottom:0}
    .page-inner{padding:var(--pad-y) var(--pad-x);height:100%;display:flex;flex-direction:column}
    @media print{body{background:#fff;padding-top:0}.toolbar{display:none!important}.doc{margin:0;width:auto}.page{margin:0;box-shadow:none;height:var(--page-h)}@page{size:A4 landscape;margin:0}}
    .page-cover{background:linear-gradient(125deg,#060a10 0%,#0f1824 35%,#152238 65%,#1a3050 100%);color:#fff;padding:0}
    .cover-layout{position:relative;z-index:1;display:grid;grid-template-columns:1.1fr .9fr;height:100%;padding:16mm 18mm;gap:12mm}
    .cover-left{display:flex;flex-direction:column;justify-content:center}
    .cover-brand{display:flex;align-items:baseline;gap:14px;margin-bottom:24px;flex-wrap:wrap}
    .cover-brand-name{font-size:38px;font-weight:700;letter-spacing:.06em;color:var(--gold-light);text-transform:uppercase}
    .cover-brand-line{font-size:14px;font-style:italic;color:rgba(255,255,255,.75);font-family:"Instrument Serif",Georgia,serif}
    .cover-brand-line::before{content:"—";margin-right:8px;color:var(--gold);font-style:normal}
    .cover h1{font-family:"Instrument Serif",Georgia,serif;font-size:42px;font-weight:400;line-height:1.1;margin-bottom:12px}
    .cover h1 em{font-style:italic;color:var(--gold-light)}
    .cover-sub{font-size:12px;color:rgba(255,255,255,.82);max-width:420px;margin-bottom:18px;line-height:1.6}
    .cover-pills{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:22px}
    .cover-pill{background:rgba(255,255,255,.07);border:1px solid rgba(232,197,71,.35);padding:6px 12px;border-radius:6px;font-size:9px;font-weight:600;color:rgba(255,255,255,.92)}
    .cover-meta{display:flex;gap:24px;flex-wrap:wrap;border-top:1px solid rgba(255,255,255,.12);padding-top:14px}
    .cover-meta-item label{display:block;font-size:7px;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.45);margin-bottom:3px}
    .cover-meta-item strong{font-size:12px;color:var(--gold-light)}
    .cover-right{display:flex;align-items:center;justify-content:center}
    .cover-visual{width:100%;max-width:320px}
    .page-header{display:flex;justify-content:space-between;align-items:center;padding-bottom:8px;margin-bottom:8px;border-bottom:2px solid var(--ink);flex-shrink:0}
    .ph-brand{display:flex;align-items:baseline;gap:10px}
    .ph-brand strong{font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase}
    .ph-brand span{font-size:9px;color:var(--text-muted);font-style:italic;font-family:"Instrument Serif",Georgia,serif}
    .ph-doc{font-size:7px;color:var(--text-muted);letter-spacing:.08em;text-transform:uppercase}
    .page-body{flex:1;min-height:0;overflow:hidden}
    .page-footer{flex-shrink:0;margin-top:auto;padding-top:6px;border-top:1px solid var(--border);display:flex;justify-content:space-between;font-size:7pt;color:var(--text-muted)}
    .section-num{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;background:var(--ink);color:var(--gold-light);font-size:10px;font-weight:700;border-radius:6px;margin-right:8px;flex-shrink:0}
    h2{font-family:"Instrument Serif",Georgia,serif;font-size:20px;font-weight:400;color:var(--ink);margin:0 0 10px;display:flex;align-items:center}
    h3{font-size:9px;font-weight:700;color:var(--ink);margin:10px 0 6px;text-transform:uppercase;letter-spacing:.07em}
    p{margin-bottom:6px}.lead{font-size:9.5pt;color:var(--text-muted);margin-bottom:10px}
    table{width:100%;border-collapse:collapse;font-size:7.5pt;margin:8px 0}
    th{background:var(--ink);color:#fff;font-weight:600;text-align:left;padding:5px 8px;font-size:7px;letter-spacing:.04em;text-transform:uppercase}
    td{padding:4px 8px;border-bottom:1px solid var(--border);vertical-align:top}
    tr:nth-child(even) td{background:var(--surface-muted)}
    .callout{border-left:3px solid var(--gold);background:var(--gold-bg);padding:8px 12px;border-radius:0 8px 8px 0;margin:8px 0;font-size:8pt}
    .callout-teal{border-left-color:var(--teal);background:var(--teal-bg)}
    .toc-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 20px}
    .toc{list-style:none}.toc li{display:flex;gap:8px;padding:5px 0;border-bottom:1px dotted var(--border);font-size:9pt}
    .toc li span:first-child{color:var(--gold);font-weight:700;min-width:22px}
    code{font-family:Consolas,monospace;font-size:7pt;background:var(--surface-muted);padding:1px 4px;border-radius:3px;color:var(--rose)}
    .code-block{font-family:Consolas,monospace;font-size:6.5pt;background:var(--surface-muted);border:1px solid var(--border);border-radius:8px;padding:10px;margin:8px 0;line-height:1.45;white-space:pre-wrap;word-break:break-word}
    ul.compact{margin:0 0 8px 16px;font-size:8pt}ul.compact li{margin-bottom:3px}
    .layer-row{display:grid;grid-template-columns:68px 1fr;gap:8px;margin-bottom:6px}
    .layer-badge{padding:6px 4px;border-radius:8px;text-align:center;font-weight:700;font-size:8px;line-height:1.3}
    .layer-a{background:var(--teal);color:#fff}.layer-b{background:var(--blue);color:#fff}.layer-c{background:var(--ink-soft);color:#fff}
    .layer-body{background:var(--surface-muted);border:1px solid var(--border);border-radius:8px;padding:8px 10px}
    .layer-body h4{font-size:10px;margin-bottom:3px}.layer-body p{font-size:7.5pt;margin:0;color:var(--text-muted);line-height:1.4}
    .diagram-wrap{background:var(--surface-muted);border:1px solid var(--border);border-radius:8px;padding:10px;margin:8px 0}
    .diagram-title{font-size:7px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:6px;text-align:center}
  </style>
</head>
<body>
<div class="toolbar">
  <span>Axerai MVP · FULL Technical Reference · Landscape A4</span>
  <button type="button" onclick="window.print()">Download PDF</button>
</div>
<div class="doc">
${pages
  .map((p, i) => {
    if (p.section === 'cover') {
      return `<div class="page page-cover">${p.body}</div>`
    }
    return pageShell(p.section, p.body, i + 1)
  })
  .join('\n')}
</div>
</body>
</html>`

writeFileSync(out, html, 'utf8')
console.log(`Written ${out} (${pages.length} pages)`)
