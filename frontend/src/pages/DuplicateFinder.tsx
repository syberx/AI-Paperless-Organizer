import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Copy, Search, Loader2, CheckCircle2, AlertTriangle, ExternalLink,
  EyeOff, FileText, Hash, Calculator, RefreshCw, Info,
} from 'lucide-react'
import clsx from 'clsx'
import * as api from '../services/api'

// ── Types ────────────────────────────────────────────────────────────────────

interface DuplicateDoc {
  id: number
  title: string
  created: string
  correspondent: string | null
  document_type: string | null
  similarity?: number
  invoice_number?: string
  amount?: number
}

interface DuplicateGroup {
  group_id: number
  documents: DuplicateDoc[]
}

interface ScanStatus {
  running: boolean
  phase: string
  progress: number
  total: number
  error: string | null
}

interface ScanResults {
  exact: DuplicateGroup[]
  similar: DuplicateGroup[]
  invoices: DuplicateGroup[]
}

interface IndexStatus {
  indexed_documents: number
}

type TabKey = 'exact' | 'similar' | 'invoices'

// ── Helpers ──────────────────────────────────────────────────────────────────

const inputCls =
  'w-full px-3 py-2 bg-surface-800 border border-surface-600 rounded-lg text-white text-sm focus:border-primary-500 focus:outline-none'

function formatDate(iso: string): string {
  if (!iso) return '–'
  try {
    return new Date(iso).toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

function formatAmount(amount: number | undefined): string {
  if (amount == null) return '–'
  return amount.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
}

// ── Component ────────────────────────────────────────────────────────────────

export default function DuplicateFinder() {
  // ── State ────────────────────────────────────────
  const [paperlessUrl, setPaperlessUrl] = useState('')
  const [ragIndexed, setRagIndexed] = useState<number | null>(null)

  const [modeExact, setModeExact] = useState(true)
  const [modeSimilar, setModeSimilar] = useState(true)
  const [modeInvoices, setModeInvoices] = useState(false)
  const [threshold, setThreshold] = useState(92)

  const [status, setStatus] = useState<ScanStatus | null>(null)
  const [results, setResults] = useState<ScanResults | null>(null)
  const [activeTab, setActiveTab] = useState<TabKey>('exact')
  const [ignoredGroups, setIgnoredGroups] = useState<Set<string>>(new Set())

  const [scanError, setScanError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Initial loads ────────────────────────────────
  useEffect(() => {
    // Load paperless URL
    api.fetchJson<{ url?: string; paperless_url?: string }>('/paperless/status')
      .then((res) => {
        const url = res.url || res.paperless_url || ''
        setPaperlessUrl(url.replace(/\/+$/, ''))
      })
      .catch(() => { /* ignore */ })

    // Check RAG index status
    api.fetchJson<IndexStatus>('/rag/index/status')
      .then((res) => setRagIndexed(res.indexed_documents ?? 0))
      .catch(() => setRagIndexed(0))

    // Check if a scan is already running
    api.fetchJson<ScanStatus>('/cleanup/duplicates/status')
      .then((s) => {
        if (s.running) {
          setStatus(s)
          startPolling()
        }
      })
      .catch(() => { /* ignore */ })

    return () => stopPolling()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Polling ──────────────────────────────────────
  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const startPolling = useCallback(() => {
    stopPolling()
    pollRef.current = setInterval(async () => {
      try {
        const s = await api.fetchJson<ScanStatus>('/cleanup/duplicates/status')
        setStatus(s)
        if (!s.running) {
          stopPolling()
          setLoading(false)
          if (s.error) {
            setScanError(s.error)
          } else {
            loadResults()
          }
        }
      } catch {
        stopPolling()
        setLoading(false)
      }
    }, 1500)
  }, [stopPolling]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load results ─────────────────────────────────
  const loadResults = useCallback(async () => {
    try {
      const r = await api.fetchJson<ScanResults>('/cleanup/duplicates/results')
      setResults(r)
      setIgnoredGroups(new Set())
      // Auto-select first tab with results
      if (r.exact.length > 0) setActiveTab('exact')
      else if (r.similar.length > 0) setActiveTab('similar')
      else if (r.invoices.length > 0) setActiveTab('invoices')
    } catch {
      /* ignore */
    }
  }, [])

  // ── Start scan ───────────────────────────────────
  const startScan = useCallback(async () => {
    setScanError(null)
    setResults(null)
    setLoading(true)

    const modes: string[] = []
    if (modeExact) modes.push('exact')
    if (modeSimilar) modes.push('similar')
    if (modeInvoices) modes.push('invoices')

    if (modes.length === 0) {
      setScanError('Bitte mindestens einen Modus auswählen.')
      setLoading(false)
      return
    }

    try {
      await api.fetchJson('/cleanup/duplicates/scan', {
        method: 'POST',
        body: JSON.stringify({
          modes,
          similarity_threshold: threshold / 100,
        }),
      })
      startPolling()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unbekannter Fehler'
      setScanError(msg)
      setLoading(false)
    }
  }, [modeExact, modeSimilar, modeInvoices, threshold, startPolling])

  // ── Ignore group ─────────────────────────────────
  const ignoreGroup = useCallback(async (group: DuplicateGroup) => {
    const docIds = group.documents.map((d) => d.id)
    try {
      await api.fetchJson('/cleanup/duplicates/ignore', {
        method: 'POST',
        body: JSON.stringify({ doc_ids: docIds }),
      })
      setIgnoredGroups((prev) => {
        const next = new Set(prev)
        next.add(groupKey(group))
        return next
      })
    } catch {
      /* ignore */
    }
  }, [])

  const groupKey = (g: DuplicateGroup): string =>
    `${g.group_id}-${g.documents.map((d) => d.id).join(',')}`

  // ── Derived ──────────────────────────────────────
  const running = status?.running ?? false
  const noRagIndex = ragIndexed !== null && ragIndexed === 0
  const similarDisabled = noRagIndex

  const filteredGroups = (groups: DuplicateGroup[]): DuplicateGroup[] =>
    groups.filter((g) => !ignoredGroups.has(groupKey(g)))

  const tabCounts = results
    ? {
        exact: filteredGroups(results.exact).length,
        similar: filteredGroups(results.similar).length,
        invoices: filteredGroups(results.invoices).length,
      }
    : { exact: 0, similar: 0, invoices: 0 }

  const currentGroups = results ? filteredGroups(results[activeTab]) : []

  // ── Progress percentage ──────────────────────────
  const progressPct =
    status && status.total > 0
      ? Math.min(100, Math.round((status.progress / status.total) * 100))
      : 0

  // ── Render ───────────────────────────────────────
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="card p-6">
        <div className="flex items-center gap-4">
          <div
            className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700
                        flex items-center justify-center shadow-lg shadow-primary-600/30 flex-shrink-0"
          >
            <Copy className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-surface-100">Duplikate finden</h1>
            <p className="text-surface-400 text-sm mt-1">
              Erkennt exakte Duplikate (Checksumme), inhaltlich ähnliche Dokumente (KI-Embeddings)
              und doppelte Rechnungen in deinem Paperless-ngx Archiv.
            </p>
          </div>
        </div>
      </div>

      {/* RAG-Hinweis */}
      {noRagIndex && (
        <div className="card border-amber-500/30 bg-amber-500/5 p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-amber-200 font-medium text-sm">RAG-Index nicht vorhanden</p>
              <p className="text-amber-300/80 text-sm mt-1 leading-relaxed">
                Für die Ähnlichkeits-Erkennung muss der RAG-Chat aktiviert und ein Index aufgebaut sein.
                Bitte zuerst unter{' '}
                <a
                  href="/rag-chat"
                  className="text-primary-400 hover:text-primary-300 underline underline-offset-2"
                >
                  Dokumenten-Chat
                </a>{' '}
                die Indexierung starten. Exakte Duplikate können trotzdem gesucht werden.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Scan-Konfiguration */}
      <div className="card p-6 space-y-5">
        <h2 className="text-surface-100 font-semibold flex items-center gap-2">
          <Search className="w-5 h-5 text-primary-400" />
          Scan-Konfiguration
        </h2>

        {/* Checkboxen */}
        <div className="grid sm:grid-cols-3 gap-4">
          <label
            className={clsx(
              'flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-colors',
              modeExact
                ? 'bg-primary-500/10 border-primary-500/30'
                : 'bg-surface-800/50 border-surface-600/50 hover:border-surface-500'
            )}
          >
            <input
              type="checkbox"
              checked={modeExact}
              onChange={(e) => setModeExact(e.target.checked)}
              className="mt-0.5 accent-primary-500"
            />
            <div>
              <div className="flex items-center gap-2">
                <Hash className="w-4 h-4 text-blue-400" />
                <span className="text-surface-100 text-sm font-medium">Exakte Duplikate</span>
              </div>
              <p className="text-surface-400 text-xs mt-1">Identische Dateien (Checksumme)</p>
            </div>
          </label>

          <label
            className={clsx(
              'flex items-start gap-3 p-4 rounded-xl border transition-colors',
              similarDisabled
                ? 'opacity-50 cursor-not-allowed bg-surface-800/30 border-surface-700/50'
                : modeSimilar
                  ? 'cursor-pointer bg-primary-500/10 border-primary-500/30'
                  : 'cursor-pointer bg-surface-800/50 border-surface-600/50 hover:border-surface-500'
            )}
          >
            <input
              type="checkbox"
              checked={modeSimilar}
              onChange={(e) => !similarDisabled && setModeSimilar(e.target.checked)}
              disabled={similarDisabled}
              className="mt-0.5 accent-primary-500"
            />
            <div>
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-purple-400" />
                <span className="text-surface-100 text-sm font-medium">Ähnliche Dokumente</span>
              </div>
              <p className="text-surface-400 text-xs mt-1">KI-Embeddings Vergleich</p>
              {similarDisabled && (
                <p className="text-amber-400/70 text-xs mt-1">RAG-Index benötigt</p>
              )}
            </div>
          </label>

          <label
            className={clsx(
              'flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-colors',
              modeInvoices
                ? 'bg-primary-500/10 border-primary-500/30'
                : 'bg-surface-800/50 border-surface-600/50 hover:border-surface-500'
            )}
          >
            <input
              type="checkbox"
              checked={modeInvoices}
              onChange={(e) => setModeInvoices(e.target.checked)}
              className="mt-0.5 accent-primary-500"
            />
            <div>
              <div className="flex items-center gap-2">
                <Calculator className="w-4 h-4 text-emerald-400" />
                <span className="text-surface-100 text-sm font-medium">Doppelte Rechnungen</span>
              </div>
              <p className="text-surface-400 text-xs mt-1">Gleiche Rechnungsnummer</p>
            </div>
          </label>
        </div>

        {/* Threshold-Slider */}
        {modeSimilar && !similarDisabled && (
          <div className="space-y-2">
            <label className="flex items-center justify-between text-sm">
              <span className="text-surface-300">Ähnlichkeits-Schwelle</span>
              <span className="text-primary-400 font-mono font-medium">{threshold}%</span>
            </label>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min={80}
                max={100}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="flex-1 accent-primary-500 h-2 bg-surface-700 rounded-full appearance-none cursor-pointer"
              />
              <input
                type="number"
                min={80}
                max={100}
                value={threshold}
                onChange={(e) => {
                  const v = Math.min(100, Math.max(80, Number(e.target.value)))
                  setThreshold(v)
                }}
                className={clsx(inputCls, 'w-20 text-center')}
              />
            </div>
            <p className="text-surface-500 text-xs">
              80% = mehr Treffer (auch entfernt ähnliche), 100% = nur fast identische Inhalte
            </p>
          </div>
        )}

        {/* Scan-Button + Fehler */}
        <div className="flex items-center gap-4">
          <button
            onClick={startScan}
            disabled={running || loading}
            className={clsx(
              'flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all',
              running || loading
                ? 'bg-surface-700 text-surface-400 cursor-not-allowed'
                : 'bg-primary-600 hover:bg-primary-500 text-white shadow-lg shadow-primary-600/20'
            )}
          >
            {running || loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Search className="w-4 h-4" />
            )}
            {running ? 'Scan läuft...' : 'Scan starten'}
          </button>

          {results && !running && (
            <button
              onClick={loadResults}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium
                         bg-surface-700 hover:bg-surface-600 text-surface-300 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Ergebnisse neu laden
            </button>
          )}
        </div>

        {scanError && (
          <div className="flex items-start gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg p-3">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{scanError}</span>
          </div>
        )}

        {/* Progress */}
        {running && status && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-surface-300">{status.phase || 'Wird vorbereitet...'}</span>
              <span className="text-surface-400 font-mono">
                {status.progress}/{status.total} ({progressPct}%)
              </span>
            </div>
            <div className="w-full h-2 bg-surface-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-primary-600 to-primary-400 rounded-full transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Ergebnisse */}
      {results && !running && (
        <div className="space-y-4">
          {/* Tabs */}
          <div className="flex gap-1 bg-surface-800/50 rounded-xl p-1 border border-surface-700/50">
            {([
              { key: 'exact' as TabKey, label: 'Exakt', icon: Hash, color: 'text-blue-400' },
              { key: 'similar' as TabKey, label: 'Ähnlich', icon: FileText, color: 'text-purple-400' },
              { key: 'invoices' as TabKey, label: 'Rechnungen', icon: Calculator, color: 'text-emerald-400' },
            ]).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={clsx(
                  'flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all',
                  activeTab === tab.key
                    ? 'bg-surface-700 text-surface-100 shadow-sm'
                    : 'text-surface-400 hover:text-surface-300 hover:bg-surface-700/50'
                )}
              >
                <tab.icon className={clsx('w-4 h-4', activeTab === tab.key ? tab.color : '')} />
                {tab.label}
                <span
                  className={clsx(
                    'text-xs px-2 py-0.5 rounded-full',
                    activeTab === tab.key
                      ? 'bg-surface-600 text-surface-200'
                      : 'bg-surface-700 text-surface-500'
                  )}
                >
                  {tabCounts[tab.key]}
                </span>
              </button>
            ))}
          </div>

          {/* Gruppen */}
          {currentGroups.length === 0 ? (
            <div className="card p-8 text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
              <p className="text-surface-300 text-sm">
                {activeTab === 'exact' && 'Keine exakten Duplikate gefunden.'}
                {activeTab === 'similar' && 'Keine ähnlichen Dokumente gefunden.'}
                {activeTab === 'invoices' && 'Keine doppelten Rechnungen gefunden.'}
              </p>
              <p className="text-surface-500 text-xs mt-1">Alles sauber!</p>
            </div>
          ) : (
            <div className="space-y-4">
              {currentGroups.map((group) => (
                <GroupCard
                  key={groupKey(group)}
                  group={group}
                  tab={activeTab}
                  paperlessUrl={paperlessUrl}
                  onIgnore={() => ignoreGroup(group)}
                />
              ))}
            </div>
          )}

          {/* Zusammenfassung */}
          {(tabCounts.exact > 0 || tabCounts.similar > 0 || tabCounts.invoices > 0) && (
            <div className="card p-4 flex items-center gap-3 text-sm">
              <Info className="w-4 h-4 text-surface-400 flex-shrink-0" />
              <p className="text-surface-400">
                Dokumente werden nicht automatisch gelöscht. Prüfe die Treffer in Paperless-ngx
                und entscheide selbst, welche Duplikate entfernt werden sollen.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Group Card ───────────────────────────────────────────────────────────────

interface GroupCardProps {
  group: DuplicateGroup
  tab: TabKey
  paperlessUrl: string
  onIgnore: () => void
}

function GroupCard({ group, tab, paperlessUrl, onIgnore }: GroupCardProps) {
  const [ignored, setIgnored] = useState(false)

  const handleIgnore = () => {
    setIgnored(true)
    onIgnore()
  }

  if (ignored) return null

  return (
    <div className="card p-5 space-y-4">
      {/* Group header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          {tab === 'exact' && (
            <>
              <Hash className="w-4 h-4 text-blue-400" />
              <span className="text-surface-300">
                Exakte Übereinstimmung — {group.documents.length} Dokumente
              </span>
            </>
          )}
          {tab === 'similar' && (
            <>
              <FileText className="w-4 h-4 text-purple-400" />
              <span className="text-surface-300">
                Ähnliche Dokumente — {group.documents.length} Treffer
              </span>
            </>
          )}
          {tab === 'invoices' && (
            <>
              <Calculator className="w-4 h-4 text-emerald-400" />
              <span className="text-surface-300">
                Rechnungsnr.{' '}
                <span className="text-surface-100 font-mono font-medium">
                  {group.documents[0]?.invoice_number || '–'}
                </span>{' '}
                — {group.documents.length} Dokumente
              </span>
            </>
          )}
        </div>

        <button
          onClick={handleIgnore}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                     bg-surface-700 hover:bg-surface-600 text-surface-400 hover:text-surface-200
                     transition-colors"
        >
          <EyeOff className="w-3.5 h-3.5" />
          Kein Duplikat
        </button>
      </div>

      {/* Documents grid */}
      <div
        className={clsx(
          'grid gap-3',
          group.documents.length === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3'
        )}
      >
        {group.documents.map((doc) => (
          <DocCard key={doc.id} doc={doc} tab={tab} paperlessUrl={paperlessUrl} />
        ))}
      </div>
    </div>
  )
}

// ── Document Card ────────────────────────────────────────────────────────────

interface DocCardProps {
  doc: DuplicateDoc
  tab: TabKey
  paperlessUrl: string
}

function DocCard({ doc, tab, paperlessUrl }: DocCardProps) {
  const link = paperlessUrl
    ? `${paperlessUrl}/documents/${doc.id}/details`
    : '#'

  return (
    <div className="bg-surface-800/60 border border-surface-700/50 rounded-xl p-4 space-y-3">
      {/* Title */}
      <div>
        <p className="text-surface-100 text-sm font-medium leading-snug line-clamp-2">
          {doc.title || 'Ohne Titel'}
        </p>
        <p className="text-surface-500 text-xs mt-1 font-mono">ID {doc.id}</p>
      </div>

      {/* Meta */}
      <div className="space-y-1.5 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-surface-500">Datum</span>
          <span className="text-surface-300">{formatDate(doc.created)}</span>
        </div>
        {doc.correspondent && (
          <div className="flex items-center justify-between">
            <span className="text-surface-500">Korrespondent</span>
            <span className="text-surface-300 truncate ml-2 max-w-[60%] text-right">
              {doc.correspondent}
            </span>
          </div>
        )}
        {doc.document_type && (
          <div className="flex items-center justify-between">
            <span className="text-surface-500">Typ</span>
            <span className="text-surface-300 truncate ml-2 max-w-[60%] text-right">
              {doc.document_type}
            </span>
          </div>
        )}
        {tab === 'similar' && doc.similarity != null && (
          <div className="flex items-center justify-between">
            <span className="text-surface-500">Ähnlichkeit</span>
            <span
              className={clsx(
                'font-mono font-medium',
                doc.similarity >= 0.95
                  ? 'text-red-400'
                  : doc.similarity >= 0.9
                    ? 'text-amber-400'
                    : 'text-emerald-400'
              )}
            >
              {Math.round(doc.similarity * 100)}%
            </span>
          </div>
        )}
        {tab === 'invoices' && (
          <>
            {doc.invoice_number && (
              <div className="flex items-center justify-between">
                <span className="text-surface-500">Rechnungsnr.</span>
                <span className="text-surface-300 font-mono">{doc.invoice_number}</span>
              </div>
            )}
            {doc.amount != null && (
              <div className="flex items-center justify-between">
                <span className="text-surface-500">Betrag</span>
                <span className="text-surface-300 font-mono">{formatAmount(doc.amount)}</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Paperless link */}
      {paperlessUrl && (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full px-3 py-2 rounded-lg text-xs font-medium
                     bg-surface-700/70 hover:bg-surface-600 text-surface-300 hover:text-surface-100
                     border border-surface-600/50 transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          In Paperless öffnen
        </a>
      )}
    </div>
  )
}
