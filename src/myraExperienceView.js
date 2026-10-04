/** Live AR / VR / overview (target video) seconds — flushed to ledger session footer on scan end. */

let activeBucket = null
let activeSince = 0
const totals = { ar: 0, vr: 0, overview: 0 }

export function syncExperienceViewBucket(bucket) {
  const next = bucket && totals[bucket] !== undefined ? bucket : null
  const now = Date.now()

  if (activeBucket && activeSince) {
    const secs = Math.max(0, Math.round((now - activeSince) / 1000))
    if (secs > 0) totals[activeBucket] += secs
  }

  activeBucket = next
  activeSince = next ? now : 0
}

export function resetExperienceViewTotals() {
  syncExperienceViewBucket(null)
  totals.ar = 0
  totals.vr = 0
  totals.overview = 0
}

export function takeExperienceViewTotals() {
  syncExperienceViewBucket(null)
  return {
    arSeconds: totals.ar,
    vrSeconds: totals.vr,
    overviewSeconds: totals.overview,
  }
}

export function parseExperienceViewSecondsFromFooter(footerText = '') {
  const footer = String(footerText ?? '')
  const read = (key) => {
    const match = footer.match(new RegExp(`^session-view-${key}-seconds:\\s*(\\d+)`, 'm'))
    return match ? Number(match[1]) || 0 : 0
  }
  return {
    arSeconds: read('ar'),
    vrSeconds: read('vr'),
    overviewSeconds: read('overview'),
  }
}
