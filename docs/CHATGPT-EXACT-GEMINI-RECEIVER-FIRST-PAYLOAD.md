# EXACT Gemini Payload — RECEIVER_FIRST Welcome (for ChatGPT / external review)

**Scenario:** Chetan (sender) finished; Sejal's phone scans card first time; `RECEIVER` + `RECEIVER_FIRST`; Myra's first line (no `USER_JUST_SAID` yet).

**How to get the COMPLETE Part 1 + Part 2 strings (no ellipsis):**

```powershell
cd "c:\Users\HP\OneDrive\Desktop\axerai-richera"
node scripts/dump-receiver-first-gemini-payload.mjs
```

Output file (full exact strings): **`docs/forensic-gemini-receiver-first-payload.txt`**

> Temporary code added for this dump (safe to remove later):
> - `src/myraLedger.js` → `debugSeedAndBuildReceiverFirstMemory()`
> - `scripts/dump-receiver-first-gemini-payload.mjs`

---

## PART 5 — EXACT API REQUEST STRUCTURE (default dev: Inworld OFF)

```javascript
// App.jsx → askGemini() → client.getGenerativeModel({ ... }).generateContent(...)
{
  model: "gemini-3.1-flash-lite",           // MYRA_CHAT_FLASH_CHAIN[0]; fallback: gemini-flash-lite-latest
  modelFallbackChain: ["gemini-3.1-flash-lite", "gemini-flash-lite-latest"],
  systemInstruction: "<FULL STRING — see forensic-gemini-receiver-first-payload.txt PART 1>",
  contents: [
    {
      role: "user",
      parts: [
        { text: "<FULL STRING — see forensic-gemini-receiver-first-payload.txt PART 2>" }
      ]
    }
  ],
  generationConfig: {
    temperature: 0.95,
    topP: 0.95,
    topK: 40
  },
  // NO maxOutputTokens on chat calls
  // NO safetySettings override in code
  // NO multi-turn history in contents — only one user blob per call
  reason: "welcome-or-boot (resolveMyraChatModels forceFlash: true)"
}
```

**Conditional system block — included ONLY IF:** `isInworldTtsConfigured()` === true (`VITE_INWORLD_ENABLED=true` + API key).  
Then `getMyraSystemPrompt({ ttsAudioTags: true })` also appends `MYRA_TTS_AUDIO_TAGS_ADDENDUM` from `myraPrompt.js`. Default local dev without Inworld: **NOT included**.

---

## PART 3 — SENDER DATA AS IT APPEARS IN FINAL PROMPT (Chetan example)

Digest built by **`buildLocalStorySummary()`** + **`enrichSessionSummary()`** (same shape as Archivist/local fallback path).  
Myra lines in digest = **topic labels only** (via `myraDigestTopic()`). Sender lines = **exact quoted words**.

### Raw summary body inside `session_summaries`:

```
THREAD: Sender

DIALOGUE DIGEST:
1. myra: naam pucha
2. sender: "My name is Chetan."
3. myra: gift kiske liye pucha
4. sender: "This gift is for Sejal."
5. myra: Wah wah! Pehli mulaqat kahan hui tum dono ki?
6. sender: "We first met at a cafe."
7. myra: product / keepsake pucha
8. sender: "I bought this bracelet because it will look beautiful on her."

MYRA LAST STATE:
was_asking: product / keepsake pucha
user_answered: partial

SESSION END:
reason: user_cut_mid_myra_question
detail: Last user line before scan ended: "I bought this bracelet because it will look beautiful on her."
last_user_line: "I bought this bracelet because it will look beautiful on her."
resume_hint: Pick up: product / keepsake pucha — do not re-ask basics already in DIALOGUE DIGEST sender lines.

DISCOVERY:
none

BRAND PRODUCT PRAISE:
yes | "I bought this bracelet because it will look beautiful on her."

AXERAI PRAISE:
none
```

### What Gemini reads per sender fact:

| Sender said | In Gemini prompt as | Type |
|-------------|---------------------|------|
| My name is Chetan. | `2. sender: "My name is Chetan."` | **Exact quote** in DIALOGUE DIGEST |
| (Myra asked name) | `1. myra: naam pucha` | **Topic label only** — not Myra's real words |
| This gift is for Sejal. | `4. sender: "This gift is for Sejal."` | **Exact quote** |
| (Myra asked gift-for) | `3. myra: gift kiske liye pucha` | **Topic label** |
| We first met at a cafe. | `6. sender: "We first met at a cafe."` | **Exact quote** |
| (Myra asked meeting) | `5. myra: Wah wah! Pehli mulaqat kahan hui tum dono ki?` | **Topic label** (closing-question text ≤72 chars) |
| Bracelet / beautiful on her | `8. sender: "I bought this bracelet because it will look beautiful on her."` | **Exact quote** |
| (Myra asked product) | `7. myra: product / keepsake pucha` | **Topic label** |
| Chetan (name) | Not a separate field — **inferred from quote line 2** | No `sender_name:` metadata |
| Sejal (recipient) | Not a separate field — **inferred from quote line 4** | No `recipient_name:` metadata |
| Relationship / cafe | In quote line 6 only | **Exact quote** |
| Bracelet praise | Quote line 8 + `BRAND PRODUCT PRAISE: yes \| "..."` | **Quote + metadata header** |
| Raw full sender chat log | **NOT sent** (unless summary backfill pending → CONVERSATION FALLBACK) | — |
| RECIPIENT HANDOFF / story_queue | **NOT sent** | — |

### How this sits inside `AXERAI_LEDGER` in the user prompt:

```
AXERAI_LEDGER:
Product code: R. Role: RECEIVER.
Axerai backend: RECIPIENT first scan — welcome concept. Personal greet, scan arrival, Myra intro, bracelet feel; story drip turn 2+.

RECEIVER CONVERSATION (Myra ↔ Receiver): (empty)

SENDER CONVERSATION (Myra ↔ Sender) (ended scans on this thread: 1):

PAST SCAN SUMMARIES (read using SOUL LEDGER protocol — priority: DIALOGUE DIGEST sender lines):

<full MYRA_LEDGER_READING_GUIDE text — includes SENDER_SCAN_CHANNEL_RECIPE + RECIPIENT_DELIVERY_JOURNEY embedded>

SCAN 1 — Sender — started Wednesday, 27 August 2025, 2:00:00 pm — ended Wednesday, 27 August 2025, 2:30:00 pm — duration 30 min
<digest block above>

CURRENT SESSION (full live dialogue this scan only — not yet summarized):
(no chat yet this session)

LORE: MYRA CONCEPT LIBRARY + LORE INTENT (RULE 25) live in system instruction — YOU decide from USER_JUST_SAID; backend does not keyword-route.
```

**Optional block — included if sender quotes pass `quoteIsPredominantlyEnglish()`:**

```
ENGLISH NOTE PRESERVE (card/note beats ONLY — Roman Hinglish sender lines are NOT English; never verbatim those): When delivering a saved English card/note beat this turn, read that English VERBATIM after a Hinglish frame. Do NOT apply to Hindi/Hinglish digest lines:
- "I bought this bracelet because it will look beautiful on her."
```

(Placed in ledger header area via `buildEnglishNotesPreviewBlock()` — before SENDER CONVERSATION block.)

---

## PART 2 — USER PROMPT STRUCTURE (exact order from `buildMyraUserPrompt` welcome branch)

Blocks concatenated in this **exact order** (newline-separated):

1. `MYRA_RECIPIENT_WELCOME_NOTE` (+ Inworld suffix if configured)
2. `INTERNAL: RECIPIENT thread — DELIVER mode...` (`buildRoleCommand`)
3. Nine recipient concept blocks (`buildRolePromptExtras`) — see list below
4. `LOCATION: GPS pending — chatpati Hinglish...` + `RICHIRA_LOCAL_VOICE_CONCEPT`
5. `LOCAL VOICE (MANDATORY): RICHIRA_LOCAL_VOICE_CONCEPT`
6. `LIVE_CONTEXT NOTE: locationArea + weatherSummary are backend-only...`
7. `LIVE_CONTEXT:` + JSON from `getOpeningLiveContext()`
8. `AXERAI_LEDGER:\n` + full memory text
9. *(empty on first turn — no `buildAntiLoopHint` lines yet)*
10. `SCAN MODE: RECIPIENT FIRST SCAN — welcome concept in role pack.`
11. `TASK: RECIPIENT FIRST SCAN...` + `buildReceiverDeliveryContext()` output
12. *(empty on welcome — `buildCloudTtsHint` returns '' for welcome)*

**NOT present on first welcome:** `USER_JUST_SAID`, `LENGTH:`, `MYRA_EXIT_INTENT_TASK`, `BOOT:` line.

### Nine blocks in `buildRolePromptExtras('RECEIVER')` (exact order):

1. `RECIPIENT_FAIRY_ROADMAP`
2. `RECIPIENT_DELIVERY_JOURNEY`
3. `RECIPIENT_HOOK_DISCIPLINE`
4. `RECIPIENT_WELCOME_CONCEPT`
5. `RECIPIENT_FLOW_CONCEPT`
6. `RECIPIENT_MESSENGER_EXCITEMENT`
7. `RECIPIENT_DELIVERY_CONCEPT` *(long — ~130 lines)*
8. `RECIPIENT_LEDGER_JUMP_RECIPE`
9. `RECIPIENT_BRAND_LORE_FLEX`

**NOT injected:** `RECIPIENT_SACRED_ROLE_NOTE`, `RECIPIENT_SMART_CONVERSATION_CONCEPT`

### `buildReceiverDeliveryContext` on first scan (exact template):

```
DELIVERY MEMORY (rules in RECIPIENT DELIVERY JOURNEY above):
SENDER STORY SOURCE: SENDER CONVERSATION — read all DIALOGUE DIGEST sender: "..." lines. YOU infer sender name, recipient name, nicknames, undelivered beats, product vs love order. No pre-built queue from backend.
past recipient scans in SCAN CONVERSATION: no — first delivery scan

CONVERSATION POINTER: USER_JUST_SAID first — YOU decide meaning. Live thread wins. Backend saved all facts — drip, do not panic-dump.
DIGEST FACTS ONLY — FORBIDDEN vague tease without digest fact. Exactly ONE ? — hook last line only.
FORBIDDEN: copy your previous myra body from CURRENT SESSION or SCAN CONVERSATION.
```

---

## PART 1 — SYSTEM INSTRUCTION (composition)

```
getMyraSystemPrompt({ ttsAudioTags: false })
  = MYRA_SYSTEM_PROMPT                    // myraPrompt.js export (full character bible ~130 lines)
  + "\n\n"
  + MYRA_LORE_INTENT_RECIPE               // myraLore.js
  + "\n\n"
  + buildMyraConceptLibraryBlock()        // myraLore.js — brand essence, gift flow, scan channel, keepsake privacy, lore canon
  [+ MYRA_TTS_AUDIO_TAGS_ADDENDUM if Inworld ON]
```

Source files for verbatim copy: `src/myraPrompt.js` (lines 32–161), `src/myraLore.js` (full file concept exports).

**Run dump script for single paste-ready string with zero manual assembly.**

---

## PART 4 — GEMINI INPUT BREAKDOWN

### 1. Product code
**Exact value:** `Product code: R. Role: RECEIVER.`  
**Source:** `myraLedger.js` → `rebuildLedgerMemoryText()`  
**Sent as:** USER PROMPT (inside AXERAI_LEDGER)  
**Dynamic/FIXED:** DYNAMIC (code from verify; pilot hardcodes `R`)

### 2. Brand/product identity
**Exact value:** Richera card/bracelet/keepsake described across SYSTEM + USER concept blocks (not a single JSON field). Backend signal: `Axerai backend: RECIPIENT first scan — welcome concept. Personal greet, scan arrival, Myra intro, bracelet feel; story drip turn 2+.`  
**Source:** `buildBackendScanSignal('RECEIVER_FIRST')`  
**Sent as:** USER PROMPT  
**Dynamic:** FIXED text for RECEIVER_FIRST mode

### 3. Receiver role
**Exact value:** `Role: RECEIVER.` and `INTERNAL: RECIPIENT thread — DELIVER mode. Read RECIPIENT DELIVERY JOURNEY + sender DIALOGUE DIGEST — YOU infer everything.`  
**Source:** ledger + `buildRoleCommand()`  
**Sent as:** USER PROMPT

### 4. First receiver scan status
**Exact value:** `SCAN MODE: RECIPIENT FIRST SCAN — welcome concept in role pack.` and `past recipient scans in SCAN CONVERSATION: no — first delivery scan`  
**Source:** `buildMyraUserPrompt` + `buildReceiverDeliveryContext`  
**Sent as:** USER PROMPT

### 5. Sender name
**Exact value:** `"My name is Chetan."` inside DIALOGUE DIGEST only — **no separate `sender_name:` field**  
**Source:** digest quote line  
**Sent as:** USER PROMPT  
**Gemini understands:** sender introduced as Chetan from quoted line

### 6. Receiver name
**Exact value:** `"This gift is for Sejal."` in digest — **no separate `recipient_name:` field**  
**Source:** digest quote  
**Sent as:** USER PROMPT

### 7. Gift information
**Exact value:** quotes lines 4 and 8 + topic labels for gift/product questions  
**Source:** DIALOGUE DIGEST  
**Sent as:** USER PROMPT

### 8. Relationship/story facts
**Exact value:** `"We first met at a cafe."` + myra topic line 5  
**Source:** DIALOGUE DIGEST  
**Sent as:** USER PROMPT — **exact sender quote**, not paraphrase summary

### 9. Sender conversation summary
**Exact value:** Full DIALOGUE DIGEST block (see Part 3) inside `SENDER CONVERSATION`  
**Source:** `buildCompactThreadBlock()`  
**Sent as:** USER PROMPT

### 10. Previous Myra questions/topic labels
**Exact value:** e.g. `1. myra: naam pucha` … `7. myra: product / keepsake pucha` — **NOT full Myra speeches**  
**Source:** summary archivist/local digest  
**Sent as:** USER PROMPT

### 11. Current receiver conversation
**Exact value:** `(no chat yet this session)`  
**Source:** empty receiver thread  
**Sent as:** USER PROMPT

### 12. Session/scan information
**Exact value:** `SCAN 1 — Sender — started … — ended … — duration 30 min`; receiver `scan_count: 1` implied in thread header `(ended scans on this thread: 1)` for sender, receiver empty  
**Source:** `formatPastSessionDigestLine()`  
**Sent as:** USER PROMPT

### 13. Location information
**Exact value:** `"locationArea": "Location unavailable"`, `"locationPending": true` in LIVE_CONTEXT JSON + GPS-pending location/voice rules  
**Source:** `getOpeningLiveContext()`  
**Sent as:** USER PROMPT

### 14. Time information
**Exact value:** `"localTime": "<Intl en-IN weekday, time Asia/Kolkata>"` — **dynamic at runtime**  
**Source:** `getLocalTimeString()` in `getOpeningLiveContext()`  
**Sent as:** USER PROMPT

### 15. Weather information
**Exact value:** `"weatherSummary": "Weather unavailable"`  
**Source:** `getOpeningLiveContext()`  
**Sent as:** USER PROMPT

### 16. Battery/device information
**Exact value:** `"batteryPercent": null`  
**Source:** LIVE_CONTEXT  
**Sent as:** USER PROMPT

### 17. Hook instruction
**Exact value:** Multiple blocks — e.g. `ONE hook only (single ?). Hook = bracelet feel.` in runtime note; full `RECIPIENT_HOOK_DISCIPLINE`; welcome concept `Closing hook — FEEL toward bracelet/jewelry on wrist NOW`  
**Source:** runtime note + role extras  
**Sent as:** USER PROMPT (+ rules in SYSTEM)

### 18. Length instruction
**Exact value:** `Length: RECIPIENT FAIRY ROADMAP` and `Welcome ~120 words. Mid-chat default ~150 words...` inside FAIRY_ROADMAP  
**Source:** `MYRA_RECIPIENT_WELCOME_NOTE` + `RECIPIENT_FAIRY_ROADMAP`  
**Sent as:** USER PROMPT  
**Note:** No numeric LENGTH block on welcome (that's reply-only)

### 19. Anti-repeat instruction
**Exact value:** *(empty on turn 0 — no prior myra lines)*; pointer says `FORBIDDEN: copy your previous myra body from CURRENT SESSION or SCAN CONVERSATION`  
**Source:** `buildAntiLoopHint` empty + CONVERSATION POINTER  
**Sent as:** USER PROMPT

### 20. Recipient delivery instruction
**Exact value:** All nine RECIPIENT_* blocks + MYRA_LEDGER_READING_GUIDE + DELIVERY MEMORY block  
**Source:** `buildRolePromptExtras`, ledger  
**Sent as:** USER PROMPT

### 21. Hidden/internal instructions
**Exact value:** `INTERNAL: RECIPIENT thread — DELIVER mode...`, `Axerai backend: RECIPIENT first scan...`, `LIVE_CONTEXT NOTE: locationArea + weatherSummary are backend-only`, SOUL LEDGER protocol text  
**Source:** multiple  
**Sent as:** USER PROMPT (Gemini sees all of it)

### 22. Other backend context
**Exact value:** `LORE: MYRA CONCEPT LIBRARY + LORE INTENT (RULE 25) live in system instruction...`; full MYRA concept library in **systemInstruction**; SESSION END metadata in digest  
**Source:** ledger + system prompt  
**Sent as:** both

---

## PART 6 — Debug instrumentation added

| File | What |
|------|------|
| `scripts/dump-receiver-first-gemini-payload.mjs` | Runs Vite SSR, assembles payload, writes txt |
| `src/myraLedger.js` | `@temporary` export `debugSeedAndBuildReceiverFirstMemory()` |

To remove after review: delete script + remove debug export from `myraLedger.js`.

Optional live capture in browser (not added — use script instead):

```javascript
// App.jsx speakMyraWelcome(), immediately before askGemini(prompt, ...):
console.log('========== EXACT GEMINI SYSTEM INSTRUCTION ==========');
console.log(getMyraSystemPrompt({ ttsAudioTags: isInworldTtsConfigured() }));
console.log('========== EXACT GEMINI USER PROMPT ==========');
console.log(prompt);
console.log('========== EXACT GEMINI GENERATION CONFIG ==========');
console.log(myraGenerationConfig('flash'));
```
