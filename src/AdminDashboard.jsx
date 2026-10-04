import { useEffect, useMemo, useState } from 'react'
import {
  buildDashboardAnalytics,
  buildElevenLabsUsageAnalytics,
  buildGeminiUsageAnalytics,
  countActiveLedgerThreads,
  fetchDashboardThreads,
  formatDashboardDuration,
  isLedgerConfigured,
  parseConversationForDashboard,
} from './myraLedger.js'

function formatTokenCount(value) {
  return Number(value || 0).toLocaleString('en-IN')
}

function callTypeLabel(call) {
  if (call === 'verify') return 'Verify'
  if (call === 'chat') return 'Chat'
  if (call === 'welcome') return 'Welcome'
  if (call === 'summary') return 'Summary'
  return call || 'Other'
}

const DEFAULT_CODE = 'R'
const AUTH_KEY = 'axerai_dash_auth'
const DASHBOARD_PATH = String(import.meta.env.VITE_DASHBOARD_PATH || 'axerai-insights-7k2m').replace(
  /^\/+|\/+$/g,
  '',
)
const DASHBOARD_PASSWORD = String(import.meta.env.VITE_DASHBOARD_PASSWORD ?? '').trim()
const DASHBOARD_REQUIRES_PASSWORD = import.meta.env.PROD || Boolean(DASHBOARD_PASSWORD)

function roleLabel(role) {
  if (role === 'sender') return 'Sender'
  if (role === 'receiver') return 'Receiver'
  return role || '—'
}

function scanViewModeSummary(row) {
  const ar = row.arViewSeconds ?? 0
  const vr = row.vrViewSeconds ?? 0
  const overview = row.overviewViewSeconds ?? 0
  const parts = []
  if (ar > 0) parts.push(`AR ${formatDashboardDuration(ar)}`)
  if (vr > 0) parts.push(`VR ${formatDashboardDuration(vr)}`)
  if (overview > 0) parts.push(`Intro ${formatDashboardDuration(overview)}`)
  return parts.length ? parts.join(' · ') : '—'
}

function bubbleLabel(speaker) {
  if (speaker === 'session-end') return '—'
  if (speaker === 'session-started') return 'Session started'
  if (speaker === 'session-ended') return 'Session ended'
  if (speaker === 'session-duration') return 'Duration'
  if (speaker === 'session-praise') return 'Praise'
  if (speaker === 'sender-summary') return 'Sender summary'
  if (speaker === 'receiver-summary') return 'Receiver summary'
  return speaker
}

function DashboardBrand({ subtitle }) {
  return (
    <div className="admin-dash__brand">
      <span className="admin-dash__brand-mark">RICHERA</span>
      <h1 className="admin-dash__brand-title">Axerai Insights</h1>
      {subtitle ? <p className="admin-dash__brand-sub">{subtitle}</p> : null}
    </div>
  )
}

function DashboardLogin({ onSuccess }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = (event) => {
    event.preventDefault()
    if (!DASHBOARD_PASSWORD) {
      setError('Password set nahi hai — .env me VITE_DASHBOARD_PASSWORD daalo.')
      return
    }
    if (password === DASHBOARD_PASSWORD) {
      sessionStorage.setItem(AUTH_KEY, '1')
      onSuccess()
      return
    }
    setError('Galat password.')
  }

  return (
    <div className="admin-dash admin-dash--gate">
      <form className="admin-dash__gate" onSubmit={handleSubmit}>
        <DashboardBrand subtitle="Private business dashboard — sirf tumhare liye" />
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            placeholder="Enter password"
          />
        </label>
        {error ? <p className="admin-dash__gate-error">{error}</p> : null}
        <button type="submit">Open dashboard</button>
      </form>
    </div>
  )
}

function CollapsibleDashPanel({ title, open, onToggle, className = '', children }) {
  return (
    <section
      className={`admin-dash__panel admin-dash__panel--collapsible${open ? '' : ' admin-dash__panel--collapsed'}${className ? ` ${className}` : ''}`}
    >
      <button
        type="button"
        className="admin-dash__panel-head"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span
          className={`admin-dash__panel-chevron${open ? ' is-open' : ''}`}
          aria-hidden="true"
        />
        <span className="admin-dash__panel-label">{title}</span>
      </button>
      {open ? children : null}
    </section>
  )
}

function PraiseDetailSheet({ type, quotes, onClose }) {
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  const isBrand = type === 'brand'
  const title = isBrand ? 'Brand praise' : 'Axerai praise'
  const subtitle = isBrand
    ? 'User ne Richera product (bracelet, card, packaging) ki kya tareef ki'
    : 'User ne Myra, scan moment, ya Richera experience ki kya tareef ki'

  return (
    <div className="admin-dash__sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="admin-dash__sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-praise-sheet-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="admin-dash__sheet-head">
          <div>
            <h2 id="admin-praise-sheet-title">{title}</h2>
            <p className="admin-dash__sheet-sub">{subtitle}</p>
          </div>
          <button type="button" className="admin-dash__sheet-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        {quotes.length === 0 ? (
          <p className="admin-dash__empty">Abhi koi tarif save nahi — scan, baat, exit ke baad yahan dikhegi.</p>
        ) : (
          <ul className="admin-dash__quote-list admin-dash__quote-list--sheet">
            {quotes.map((item) => (
              <li key={`${type}-${item.role}-${item.scanNumber}-${item.quote.slice(0, 32)}`}>
                <span className="admin-dash__quote-meta">
                  Scan #{item.scanNumber} · {roleLabel(item.role)}
                </span>
                <p className="admin-dash__praise">"{item.quote}"</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export default function AdminDashboard() {
  useEffect(() => {
    document.documentElement.classList.add('admin-dash-page')
    return () => {
      document.documentElement.classList.remove('admin-dash-page')
    }
  }, [])

  const [authed, setAuthed] = useState(() => {
    if (!DASHBOARD_REQUIRES_PASSWORD) return true
    if (!DASHBOARD_PASSWORD) return false
    return sessionStorage.getItem(AUTH_KEY) === '1'
  })
  const [code, setCode] = useState(DEFAULT_CODE)
  const [threads, setThreads] = useState([])
  const [selectedThread, setSelectedThread] = useState(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const [praiseSheet, setPraiseSheet] = useState(null)
  const [aiTokensOpen, setAiTokensOpen] = useState(true)
  const [voiceTokensOpen, setVoiceTokensOpen] = useState(true)
  const [conversationOpen, setConversationOpen] = useState(true)
  const [summaryOpen, setSummaryOpen] = useState(true)

  useEffect(() => {
    if (!isLedgerConfigured() || !authed) {
      setLoading(false)
      return
    }

    let cancelled = false
    ;(async () => {
      setLoading(true)
      const rows = await fetchDashboardThreads(code)
      if (!cancelled) {
        setThreads(rows)
        setSelectedThread(rows[0] ?? null)
        setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [code, reloadKey, authed])

  const analytics = useMemo(() => buildDashboardAnalytics(threads), [threads])
  const tokenStats = useMemo(() => buildGeminiUsageAnalytics(threads), [threads])
  const elevenStats = useMemo(() => buildElevenLabsUsageAnalytics(threads), [threads])
  const brandPraiseList = useMemo(
    () =>
      analytics.brandPraiseQuotes?.length
        ? analytics.brandPraiseQuotes
        : analytics.praiseQuotes ?? [],
    [analytics],
  )
  const axeraiPraiseList = useMemo(() => analytics.axeraiPraiseQuotes ?? [], [analytics])

  if (DASHBOARD_REQUIRES_PASSWORD && !DASHBOARD_PASSWORD) {
    return (
      <div className="admin-dash admin-dash--gate">
        <div className="admin-dash__gate">
          <DashboardBrand />
          <p className="admin-dash__gate-error">
            Dashboard lock ke liye <code>VITE_DASHBOARD_PASSWORD</code> .env me set karo, phir dev
            server restart karo.
          </p>
        </div>
      </div>
    )
  }

  if (!authed) {
    return <DashboardLogin onSuccess={() => setAuthed(true)} />
  }

  if (!isLedgerConfigured()) {
    return (
      <div className="admin-dash">
        <div className="admin-dash__shell">
          <p>Supabase keys missing. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env</p>
        </div>
      </div>
    )
  }

  const bubbles = selectedThread
    ? parseConversationForDashboard(selectedThread.conversation)
    : []

  return (
    <div className="admin-dash">
      <div className="admin-dash__shell">
        <header className="admin-dash__hero">
          <DashboardBrand subtitle={`Product code ${code} · scans · talk time · brand praise`} />
          <div className="admin-dash__header-actions">
            <button
              type="button"
              className="admin-dash__btn admin-dash__btn--ghost"
              onClick={() => setReloadKey((value) => value + 1)}
            >
              Refresh
            </button>
            <button
              type="button"
              className="admin-dash__btn admin-dash__btn--ghost"
              onClick={() => {
                sessionStorage.removeItem(AUTH_KEY)
                setAuthed(false)
              }}
            >
              Logout
            </button>
            <a href="/" className="admin-dash__back">
              ← App
            </a>
          </div>
        </header>

        <div className="admin-dash__toolbar">
          <label className="admin-dash__field">
            <span>Verification code</span>
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
          </label>
          {loading ? <span className="admin-dash__loading-pill">Loading…</span> : null}
        </div>

        <section className="admin-dash__stats">
          <article className="admin-dash__stat-card">
            <span className="admin-dash__stat-label">Total scans</span>
            <strong className="admin-dash__stat-value">{analytics.totalScans}</strong>
          </article>
          <article className="admin-dash__stat-card">
            <span className="admin-dash__stat-label">Talk time (code total)</span>
            <strong className="admin-dash__stat-value">
              {formatDashboardDuration(analytics.totalTalkTimeSeconds)}
            </strong>
            <span className="admin-dash__stat-hint">Sender + receiver sessions</span>
          </article>
          <article className="admin-dash__stat-card">
            <span className="admin-dash__stat-label">Sender talk time</span>
            <strong className="admin-dash__stat-value">
              {formatDashboardDuration(analytics.senderTalkTimeSeconds ?? 0)}
            </strong>
            <span className="admin-dash__stat-hint">{analytics.senderScanCount ?? 0} scans</span>
          </article>
          <article className="admin-dash__stat-card">
            <span className="admin-dash__stat-label">Receiver talk time</span>
            <strong className="admin-dash__stat-value">
              {formatDashboardDuration(analytics.receiverTalkTimeSeconds ?? 0)}
            </strong>
            <span className="admin-dash__stat-hint">{analytics.receiverScanCount ?? 0} scans</span>
          </article>
          <article className="admin-dash__stat-card">
            <span className="admin-dash__stat-label">AR view time</span>
            <strong className="admin-dash__stat-value">
              {formatDashboardDuration(analytics.totalArViewSeconds ?? 0)}
            </strong>
            <span className="admin-dash__stat-hint">Camera + card scan</span>
          </article>
          <article className="admin-dash__stat-card">
            <span className="admin-dash__stat-label">VR mode time</span>
            <strong className="admin-dash__stat-value">
              {formatDashboardDuration(analytics.totalVrViewSeconds ?? 0)}
            </strong>
            <span className="admin-dash__stat-hint">Full-screen Myra</span>
          </article>
          <article className="admin-dash__stat-card">
            <span className="admin-dash__stat-label">Intro video</span>
            <strong className="admin-dash__stat-value">
              {formatDashboardDuration(analytics.totalOverviewViewSeconds ?? 0)}
            </strong>
            <span className="admin-dash__stat-hint">After verify, before AR</span>
          </article>
          <button
            type="button"
            className="admin-dash__stat-card admin-dash__stat-card--praise admin-dash__stat-card--clickable"
            onClick={() => setPraiseSheet('brand')}
            aria-label="Brand praise — saari tareef dekho"
          >
            <span className="admin-dash__stat-label">Brand praise</span>
            <strong className="admin-dash__stat-value">{analytics.positiveCount}</strong>
            <span className="admin-dash__stat-hint">Tap — product tareef</span>
          </button>
          <button
            type="button"
            className="admin-dash__stat-card admin-dash__stat-card--praise admin-dash__stat-card--clickable admin-dash__stat-card--axerai"
            onClick={() => setPraiseSheet('axerai')}
            aria-label="Axerai praise — saari tareef dekho"
          >
            <span className="admin-dash__stat-label">Axerai praise</span>
            <strong className="admin-dash__stat-value">{analytics.axeraiPraiseCount ?? 0}</strong>
            <span className="admin-dash__stat-hint">Tap — Myra / experience</span>
          </button>
          <article className="admin-dash__stat-card">
            <span className="admin-dash__stat-label">Threads joined</span>
            <strong className="admin-dash__stat-value">
              {countActiveLedgerThreads(threads)}/2
            </strong>
            <span className="admin-dash__stat-hint">Sender + receiver devices</span>
          </article>
          <article className="admin-dash__stat-card admin-dash__stat-card--wide">
            <span className="admin-dash__stat-label">Last scan</span>
            <strong className="admin-dash__stat-value admin-dash__stat-value--small">
              {analytics.lastScanDate || '—'}
            </strong>
          </article>
        </section>

        {!analytics.totalArViewSeconds &&
        !analytics.totalVrViewSeconds &&
        !analytics.totalOverviewViewSeconds ? (
          <p className="admin-dash__muted admin-dash__panel-note">
            AR/VR time purane scans me save nahi hua — naye scan ke baad yahan dikhega (session footer).
          </p>
        ) : null}

        <CollapsibleDashPanel
          title={`Axerai AI tokens — code ${code}`}
          open={aiTokensOpen}
          onToggle={() => setAiTokensOpen((value) => !value)}
        >
          <div className="admin-dash__token-stats">
            <article className="admin-dash__stat-card admin-dash__stat-card--token">
              <span className="admin-dash__stat-label">Axerai AI tokens</span>
              <strong className="admin-dash__stat-value">
                {formatTokenCount(tokenStats.totalTokens)}
              </strong>
            </article>
            <article className="admin-dash__stat-card">
              <span className="admin-dash__stat-label">Prompt in</span>
              <strong className="admin-dash__stat-value admin-dash__stat-value--small">
                {formatTokenCount(tokenStats.promptTokens)}
              </strong>
            </article>
            <article className="admin-dash__stat-card">
              <span className="admin-dash__stat-label">Output out</span>
              <strong className="admin-dash__stat-value admin-dash__stat-value--small">
                {formatTokenCount(tokenStats.outputTokens)}
              </strong>
            </article>
            <article className="admin-dash__stat-card">
              <span className="admin-dash__stat-label">API calls</span>
              <strong className="admin-dash__stat-value admin-dash__stat-value--small">
                {tokenStats.callCount}
              </strong>
            </article>
          </div>
          <div className="admin-dash__token-breakdown">
            <span>Verify {formatTokenCount(tokenStats.byCall.verify)}</span>
            <span>Welcome {formatTokenCount(tokenStats.byCall.welcome)}</span>
            <span>Chat {formatTokenCount(tokenStats.byCall.chat)}</span>
            <span>Summary {formatTokenCount(tokenStats.byCall.summary)}</span>
          </div>
          {tokenStats.entries.length === 0 ? (
            <p className="admin-dash__empty">
              Abhi koi AI token log nahi — scan / chat / exit ke baad yahan dikhega. (Naya setup: Supabase me{' '}
              <code>fresh_start.sql</code> run karo.)
            </p>
          ) : (
            <div className="admin-dash__table-wrap">
              <table className="admin-dash__table admin-dash__table--tokens">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Type</th>
                    <th>Role</th>
                    <th>Scan</th>
                    <th>Total</th>
                    <th>Model</th>
                  </tr>
                </thead>
                <tbody>
                  {[...tokenStats.entries].reverse().map((row, index) => (
                    <tr key={`${row.at}-${row.call}-${index}`}>
                      <td>{row.at ? new Date(row.at).toLocaleString('en-IN') : '—'}</td>
                      <td>{callTypeLabel(row.call)}</td>
                      <td>{roleLabel(row.threadRole)}</td>
                      <td>{row.scan ?? '—'}</td>
                      <td>{formatTokenCount(row.totalTokens)}</td>
                      <td className="admin-dash__muted">{row.model}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CollapsibleDashPanel>

        <CollapsibleDashPanel
          title={`Axerai voice tokens — code ${code}`}
          open={voiceTokensOpen}
          onToggle={() => setVoiceTokensOpen((value) => !value)}
        >
          <div className="admin-dash__token-stats">
            <article className="admin-dash__stat-card admin-dash__stat-card--token admin-dash__stat-card--axerai">
              <span className="admin-dash__stat-label">Axerai voice tokens</span>
              <strong className="admin-dash__stat-value">
                {formatTokenCount(elevenStats.totalCharacters)}
              </strong>
            </article>
            <article className="admin-dash__stat-card">
              <span className="admin-dash__stat-label">Voice calls</span>
              <strong className="admin-dash__stat-value admin-dash__stat-value--small">
                {elevenStats.callCount}
              </strong>
            </article>
          </div>
          {elevenStats.entries.length === 0 ? (
            <p className="admin-dash__empty">
              Abhi koi voice token log nahi — Myra jab bolegi tab yahan dikhega. (Naya setup: Supabase me{' '}
              <code>fresh_start.sql</code> run karo.)
            </p>
          ) : (
            <div className="admin-dash__table-wrap">
              <table className="admin-dash__table admin-dash__table--tokens">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Type</th>
                    <th>Role</th>
                    <th>Scan</th>
                    <th>Tokens</th>
                    <th>Model</th>
                  </tr>
                </thead>
                <tbody>
                  {[...elevenStats.entries].reverse().map((row, index) => (
                    <tr key={`${row.at}-voice-${index}`}>
                      <td>{row.at ? new Date(row.at).toLocaleString('en-IN') : '—'}</td>
                      <td>Voice</td>
                      <td>{roleLabel(row.threadRole)}</td>
                      <td>{row.scan ?? '—'}</td>
                      <td>{formatTokenCount(row.characters)}</td>
                      <td className="admin-dash__muted">{row.model}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CollapsibleDashPanel>

        {praiseSheet ? (
          <PraiseDetailSheet
            type={praiseSheet}
            quotes={praiseSheet === 'brand' ? brandPraiseList : axeraiPraiseList}
            onClose={() => setPraiseSheet(null)}
          />
        ) : null}

        {analytics.discoveryQuotes?.length > 0 ? (
          <section className="admin-dash__panel admin-dash__quotes">
            <h2 className="admin-dash__panel-title">Discovery — user ne brand kahan dekha</h2>
            <ul className="admin-dash__quote-list">
              {analytics.discoveryQuotes.map((item) => (
                <li key={`disc-${item.role}-${item.scanNumber}-${item.quote.slice(0, 24)}`}>
                  <span className="admin-dash__quote-meta">
                    Scan #{item.scanNumber} · {roleLabel(item.role)}
                  </span>
                  <p className="admin-dash__praise">"{item.quote}"</p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="admin-dash__panel">
          <h2 className="admin-dash__panel-title">Scan history</h2>
          {analytics.sessions.length === 0 ? (
            <p className="admin-dash__empty">
              Abhi koi completed scan nahi — scan karo, baat karo, exit dabao, phir refresh.
            </p>
          ) : (
            <div className="admin-dash__table-wrap">
              <table className="admin-dash__table">
                <thead>
                  <tr>
                    <th>Scan</th>
                    <th>Role</th>
                    <th>Date</th>
                    <th>Duration</th>
                    <th>AR / VR</th>
                    <th>Pasand</th>
                    <th>Quote</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.sessions.map((row) => (
                    <tr key={`${row.threadId}-${row.scanNumber}`}>
                      <td>
                        <span className="admin-dash__scan-badge">#{row.scanNumber}</span>
                      </td>
                      <td>
                        <span
                          className={`admin-dash__role-pill admin-dash__role-pill--${row.threadRole}`}
                        >
                          {roleLabel(row.threadRole)}
                        </span>
                      </td>
                      <td>{row.date || '—'}</td>
                      <td>{row.durationText || formatDashboardDuration(row.durationSeconds)}</td>
                      <td className="admin-dash__muted">{scanViewModeSummary(row)}</td>
                      <td>
                        {row.brandPraiseQuote || row.praiseQuote || row.axeraiPraiseQuote ? (
                          <span className="admin-dash__yes">✓ Haan</span>
                        ) : (
                          <span className="admin-dash__muted">—</span>
                        )}
                      </td>
                      <td className="admin-dash__praise">
                        {row.brandPraiseQuote || row.praiseQuote
                          ? `[brand] "${row.brandPraiseQuote || row.praiseQuote}"`
                          : row.axeraiPraiseQuote
                            ? `[axerai] "${row.axeraiPraiseQuote}"`
                            : row.discoveryQuote
                              ? `[discovery] "${row.discoveryQuote}"`
                              : row.userSaid || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="admin-dash__grid">
          <section className="admin-dash__panel">
            <h2 className="admin-dash__panel-title">Threads</h2>
            {threads.length === 0 ? (
              <p className="admin-dash__empty">No ledger rows yet for {code}.</p>
            ) : (
              <ul className="admin-dash__scan-list">
                {threads.map((thread) => (
                  <li key={thread.id}>
                    <button
                      type="button"
                      className={`admin-dash__scan${selectedThread?.id === thread.id ? ' admin-dash__scan--active' : ''}`}
                      onClick={() => setSelectedThread(thread)}
                    >
                      <span
                        className={`admin-dash__role-pill admin-dash__role-pill--${thread.role}`}
                      >
                        {roleLabel(thread.role)}
                      </span>
                      <strong>{thread.scan_count} scans</strong>
                      <span className="admin-dash__muted">
                        {thread.device_id ? `${thread.device_id.slice(0, 8)}…` : 'Waiting for scan'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="admin-dash__grid-stack">
          <CollapsibleDashPanel
            title="Conversation"
            className="admin-dash__panel--chat"
            open={conversationOpen}
            onToggle={() => setConversationOpen((value) => !value)}
          >
            {!selectedThread ? (
              <p className="admin-dash__empty">Select a thread to view chat.</p>
            ) : (
              <>
                <div className="admin-dash__meta">
                  <span>
                    <strong>Code</strong> {selectedThread.verification_code}
                  </span>
                  <span>
                    <strong>Role</strong> {roleLabel(selectedThread.role)}
                  </span>
                  <span>
                    <strong>Scans</strong> {selectedThread.scan_count}
                  </span>
                </div>
                <div className="admin-dash__chat">
                  {bubbles.length === 0 ? (
                    <p className="admin-dash__empty">No messages in this thread yet.</p>
                  ) : (
                    bubbles.map((msg) => (
                      <div
                        key={msg.key}
                        className={`admin-dash__bubble admin-dash__bubble--${msg.speaker}`}
                      >
                        {msg.speaker !== 'session-end' ? (
                          <strong>{bubbleLabel(msg.speaker)}</strong>
                        ) : null}
                        <p>{msg.text}</p>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </CollapsibleDashPanel>

          <CollapsibleDashPanel
            title="Session summaries"
            open={summaryOpen}
            onToggle={() => setSummaryOpen((value) => !value)}
          >
            {!selectedThread ? (
              <p className="admin-dash__empty">Select a thread to view summaries.</p>
            ) : selectedThread.session_summaries?.trim() ? (
              <pre className="admin-dash__summaries-pre">{selectedThread.session_summaries}</pre>
            ) : (
              <p className="admin-dash__empty">Exit after chat to save summaries.</p>
            )}
          </CollapsibleDashPanel>
          </div>
        </div>
      </div>
    </div>
  )
}
