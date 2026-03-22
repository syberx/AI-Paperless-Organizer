import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  Users, Tags, FileText, ArrowRight, Zap, Activity, ScanText, Brain, Wrench,
  ChevronRight, Eye, BarChart3, ShieldOff, Layers, TrendingUp
} from 'lucide-react'
import clsx from 'clsx'
import * as api from '../services/api'

// ── Animated counter ──────────────────────────────────────────────────────────
function AnimatedNumber({ value, duration = 900 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(0)
  const raf = useRef<number>()
  useEffect(() => {
    const from = 0
    const start = performance.now()
    const animate = (now: number) => {
      const t = Math.min((now - start) / duration, 1)
      const ease = 1 - Math.pow(1 - t, 3)
      setDisplay(Math.round(from + (value - from) * ease))
      if (t < 1) raf.current = requestAnimationFrame(animate)
    }
    raf.current = requestAnimationFrame(animate)
    return () => { if (raf.current) cancelAnimationFrame(raf.current) }
  }, [value])
  return <>{display.toLocaleString('de-DE')}</>
}

// ── SVG Donut Chart ───────────────────────────────────────────────────────────
interface DonutSeg { value: number; color: string; label: string; glow?: string }

function DonutChart({ segments, total, centerTop, centerBot }:
  { segments: DonutSeg[]; total: number; centerTop: string; centerBot: string }) {
  const r = 74; const cx = 100; const cy = 100
  const circ = 2 * Math.PI * r
  const gap = circ * 0.008

  // Build arcs
  const arcs: { len: number; offset: number; seg: DonutSeg }[] = []
  let cursor = -circ * 0.25
  for (const seg of segments) {
    const len = total > 0 ? Math.max((seg.value / total) * circ - gap, 0) : 0
    arcs.push({ len, offset: cursor, seg })
    cursor += len + gap
  }

  return (
    <div className="relative select-none">
      <svg width={200} height={200} viewBox="0 0 200 200">
        {/* Track */}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1e293b" strokeWidth={24} />
        {arcs.map((arc, i) => arc.len > 0 && (
          <circle
            key={i} cx={cx} cy={cy} r={r} fill="none"
            stroke={arc.seg.color} strokeWidth={22}
            strokeDasharray={`${arc.len} ${circ}`}
            strokeDashoffset={-arc.offset}
            strokeLinecap="butt"
            style={{ filter: arc.seg.glow ? `drop-shadow(0 0 5px ${arc.seg.glow})` : undefined, transition: 'stroke-dasharray 1.2s cubic-bezier(.4,0,.2,1)' }}
          />
        ))}
        {/* Center */}
        <text x={cx} y={cy - 9} textAnchor="middle" fill="white"
          fontSize="22" fontWeight="700" fontFamily="ui-monospace,monospace">{centerTop}</text>
        <text x={cx} y={cy + 12} textAnchor="middle" fill="#64748b"
          fontSize="10" fontFamily="inherit">{centerBot}</text>
      </svg>
    </div>
  )
}

// ── Progress Bar ──────────────────────────────────────────────────────────────
function Bar({ pct, color, glow }: { pct: number; color: string; glow: string }) {
  return (
    <div className="h-1.5 bg-surface-700/60 rounded-full overflow-hidden">
      <div className="h-full rounded-full transition-all duration-1000"
        style={{ width: `${Math.min(pct, 100)}%`, background: color, boxShadow: `0 0 6px ${glow}` }} />
    </div>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [classStats, setClassStats] = useState<api.ClassifierStats | null>(null)
  const [ocrStatus, setOcrStatus] = useState<{ total_documents: number; finished_documents: number; pending_documents: number; percentage: number } | null>(null)
  const [cleanupStats, setCleanupStats] = useState<any>(null)
  const [ocrBatch, setOcrBatch] = useState<any>(null)
  const [ocrReview, setOcrReview] = useState(0)
  const [ocrErrors, setOcrErrors] = useState(0)
  const [ocrIgnored, setOcrIgnored] = useState(0)
  const [timeSaved, setTimeSaved] = useState(0)
  const [counts, setCounts] = useState({ correspondents: 0, tags: 0, documentTypes: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    const [statsRes, batchRes, reviewRes, ignoreRes, errorsRes, ocrRes] = await Promise.allSettled([
      api.getStatisticsSummary(),
      api.getBatchOcrStatus(),
      api.getReviewQueue(),
      api.getOcrIgnoreList(),
      api.getOcrErrorList(),
      api.getOcrStatus(),
    ])
    if (statsRes.status === 'fulfilled' && statsRes.value) {
      const s = statsRes.value as any
      setCounts({ correspondents: s.current_counts?.correspondents || 0, tags: s.current_counts?.tags || 0, documentTypes: s.current_counts?.document_types || 0 })
      setCleanupStats(s.cleanup_stats)
      setTimeSaved(s.savings?.estimated_time_saved_minutes || 0)
    }
    if (batchRes.status === 'fulfilled') setOcrBatch(batchRes.value)
    if (reviewRes.status === 'fulfilled') setOcrReview((reviewRes.value as any).count || 0)
    if (ignoreRes.status === 'fulfilled') setOcrIgnored((ignoreRes.value as any).count || 0)
    if (errorsRes.status === 'fulfilled') setOcrErrors(((errorsRes.value as any).items || []).length)
    if (ocrRes.status === 'fulfilled') setOcrStatus(ocrRes.value as any)
    try { setClassStats(await api.getClassifierStats()) } catch {}
    setLoading(false)
  }

  // ── Derived values ──────────────────────────────────────────────────────────
  const totalDocs = ocrStatus?.total_documents || classStats?.total_documents_paperless || 0
  const ocrDone = ocrStatus?.finished_documents || 0
  const ocrPending = ocrStatus?.pending_documents || 0
  const ocrPct = ocrStatus?.percentage || 0
  const applied = classStats?.unique_applied || 0
  const analyzed = Math.max(0, (classStats?.unique_classified || 0) - applied)
  // Docs with ocrfinish that are not yet classified at all
  const ocrDoneUnclassified = Math.max(0, ocrDone - applied - analyzed)
  const classifiedPct = totalDocs > 0 ? ((applied / totalDocs) * 100).toFixed(1) : '0'
  const totalCleaned = cleanupStats?.total_items_cleaned || 0

  // Donut: shows full archive breakdown
  const donutSegs: DonutSeg[] = [
    { value: applied, color: '#10b981', glow: '#10b98177', label: 'KI-Klassifiziert' },
    { value: analyzed, color: '#f59e0b', glow: '#f59e0b66', label: 'Analysiert (offen)' },
    { value: ocrDoneUnclassified, color: '#0ea5e9', glow: '#0ea5e955', label: 'OCR fertig' },
    { value: ocrReview, color: '#f97316', glow: '#f9731666', label: 'OCR Prüfen' },
    { value: ocrErrors, color: '#ef4444', glow: '#ef444466', label: 'OCR Fehler' },
    { value: Math.max(0, ocrPending - ocrIgnored - ocrReview - ocrErrors), color: '#334155', label: 'Noch kein OCR' },
    { value: ocrIgnored, color: '#475569', label: 'Ignoriert' },
  ].filter(s => s.value > 0)

  const lastBatchLog = (ocrBatch?.log || []).filter((l: string) => !l.startsWith('⏳') && !l.startsWith('🔎')).slice(-2)

  return (
    <div className="space-y-5 pb-8">

      {/* ── Gesamtübersicht: Donut + 4 Kacheln ─────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

        {/* Donut Card */}
        <div className="lg:col-span-2 card p-6 flex flex-col items-center bg-surface-800/60 border border-surface-700/50">
          <h3 className="font-display font-semibold text-surface-100 flex items-center gap-2 self-start mb-4 text-base">
            <BarChart3 className="w-4 h-4 text-primary-400" />
            Archiv-Übersicht
          </h3>
          {loading ? (
            <div className="w-48 h-48 rounded-full border-[24px] border-surface-700 animate-pulse my-2" />
          ) : (
            <DonutChart
              segments={donutSegs}
              total={totalDocs}
              centerTop={`${ocrPct}%`}
              centerBot="OCR-Quote"
            />
          )}
          {/* Legend */}
          <div className="w-full space-y-1.5 mt-2">
            {[
              { color: '#10b981', label: 'KI-Klassifiziert', value: applied, pct: totalDocs > 0 ? (applied / totalDocs * 100).toFixed(1) : '0' },
              { color: '#f59e0b', label: 'Analysiert (offen)', value: analyzed, pct: totalDocs > 0 ? (analyzed / totalDocs * 100).toFixed(1) : '0' },
              { color: '#0ea5e9', label: 'OCR fertig', value: ocrDoneUnclassified, pct: totalDocs > 0 ? (ocrDoneUnclassified / totalDocs * 100).toFixed(1) : '0' },
              { color: '#f97316', label: 'OCR Prüfen', value: ocrReview, pct: totalDocs > 0 ? (ocrReview / totalDocs * 100).toFixed(1) : '0' },
              { color: '#475569', label: 'Ignoriert / kein OCR', value: ocrPending, pct: totalDocs > 0 ? (ocrPending / totalDocs * 100).toFixed(1) : '0' },
            ].map(seg => (
              <div key={seg.label} className="flex items-center gap-2 text-xs">
                <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: seg.color }} />
                <span className="text-surface-400 flex-1 truncate">{seg.label}</span>
                <span className="font-mono text-surface-500 text-[11px]">{seg.pct}%</span>
                <span className="font-mono text-surface-300 w-12 text-right">{seg.value.toLocaleString('de-DE')}</span>
              </div>
            ))}
            <div className="pt-1.5 border-t border-surface-700/40 flex justify-between text-xs">
              <span className="text-surface-500">Gesamt</span>
              <span className="font-mono font-bold text-surface-200">{totalDocs.toLocaleString('de-DE')}</span>
            </div>
          </div>
        </div>

        {/* 4 Kacheln */}
        <div className="lg:col-span-3 grid grid-cols-2 gap-4">
          {[
            {
              label: 'Gesamt Dokumente', value: totalDocs, sub: `${counts.correspondents} Korr. · ${counts.tags} Tags`,
              icon: Layers, grad: 'from-slate-500 to-slate-600', glow: '#64748b',
            },
            {
              label: 'KI-Klassifiziert', value: applied, sub: `${classifiedPct}% des Archivs klassifiziert`,
              icon: Brain, grad: 'from-violet-500 to-purple-600', glow: '#7c3aed',
            },
            {
              label: 'OCR abgeschlossen', value: ocrDone, sub: `${ocrPct}% · ${ocrPending} ausstehend`,
              icon: ScanText, grad: 'from-cyan-500 to-blue-600', glow: '#0891b2',
            },
            {
              label: 'Bereinigt', value: totalCleaned, sub: `${timeSaved} Min. gespart`,
              icon: Wrench, grad: 'from-amber-500 to-orange-600', glow: '#d97706',
            },
          ].map((c) => {
            const Icon = c.icon
            return (
              <div key={c.label} className="card p-5 border border-surface-700/50 bg-surface-800/50">
                <div className={clsx('p-2.5 rounded-xl bg-gradient-to-br w-fit mb-3', c.grad)}
                  style={{ boxShadow: `0 4px 16px ${c.glow}40` }}>
                  <Icon className="w-5 h-5 text-white" />
                </div>
                <div className="font-display text-3xl font-bold text-white mb-0.5">
                  {loading ? <div className="h-8 w-20 bg-surface-700 rounded animate-pulse" /> : <AnimatedNumber value={c.value} />}
                </div>
                <div className="text-xs font-medium text-surface-400">{c.label}</div>
                <div className="text-xs text-surface-600 mt-0.5 truncate">{c.sub}</div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── 3 Modul-Karten ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

        {/* OCR */}
        <Link to="/ocr" className="group card p-5 border border-cyan-500/20 bg-gradient-to-b from-cyan-500/5 to-transparent hover:border-cyan-500/40 transition-all hover:scale-[1.01]">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-cyan-500/15 border border-cyan-500/20">
                <ScanText className="w-5 h-5 text-cyan-400" />
              </div>
              <span className="font-display font-semibold text-surface-100">OCR Engine</span>
            </div>
            <ArrowRight className="w-4 h-4 text-surface-600 group-hover:text-cyan-400 group-hover:translate-x-1 transition-all" />
          </div>

          {/* Big percentage */}
          <div className="flex items-end gap-2 mb-3">
            <span className="font-display text-4xl font-bold text-cyan-300">{ocrPct}%</span>
            <span className="text-surface-400 text-sm mb-1">abgeschlossen</span>
          </div>
          <Bar pct={ocrPct} color="#22d3ee" glow="#22d3ee66" />

          <div className="grid grid-cols-3 gap-2 mt-4 text-center">
            {[
              { val: ocrDone, label: 'Fertig', color: 'text-cyan-300' },
              { val: ocrReview, label: 'Prüfen', color: ocrReview > 0 ? 'text-orange-400' : 'text-surface-500' },
              { val: ocrIgnored, label: 'Ignoriert', color: 'text-surface-500' },
            ].map(i => (
              <div key={i.label} className="p-2 rounded-lg bg-surface-700/30">
                <div className={clsx('text-lg font-bold', i.color)}>{i.val.toLocaleString('de-DE')}</div>
                <div className="text-xs text-surface-500">{i.label}</div>
              </div>
            ))}
          </div>

          {lastBatchLog.length > 0 && (
            <div className="mt-3 pt-3 border-t border-surface-700/40 space-y-0.5">
              {lastBatchLog.map((l: string, i: number) => (
                <p key={i} className="text-xs text-surface-500 truncate">{l}</p>
              ))}
            </div>
          )}
        </Link>

        {/* Klassifizierer */}
        <Link to="/classifier" className="group card p-5 border border-violet-500/20 bg-gradient-to-b from-violet-500/5 to-transparent hover:border-violet-500/40 transition-all hover:scale-[1.01]">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-violet-500/15 border border-violet-500/20">
                <Brain className="w-5 h-5 text-violet-400" />
              </div>
              <span className="font-display font-semibold text-surface-100">KI-Klassifizierer</span>
            </div>
            <ArrowRight className="w-4 h-4 text-surface-600 group-hover:text-violet-400 group-hover:translate-x-1 transition-all" />
          </div>

          <div className="flex items-end gap-2 mb-3">
            <span className="font-display text-4xl font-bold text-violet-300">{classifiedPct}%</span>
            <span className="text-surface-400 text-sm mb-1">klassifiziert</span>
          </div>
          <Bar pct={parseFloat(classifiedPct)} color="#7c3aed" glow="#7c3aed66" />

          <div className="grid grid-cols-3 gap-2 mt-4 text-center">
            {[
              { val: applied, label: 'Angewendet', color: 'text-emerald-400' },
              { val: analyzed, label: 'Offen', color: analyzed > 0 ? 'text-amber-400' : 'text-surface-500' },
              { val: classStats?.total_runs || 0, label: 'Analysen', color: 'text-violet-300' },
            ].map(i => (
              <div key={i.label} className="p-2 rounded-lg bg-surface-700/30">
                <div className={clsx('text-lg font-bold', i.color)}>{i.val.toLocaleString('de-DE')}</div>
                <div className="text-xs text-surface-500">{i.label}</div>
              </div>
            ))}
          </div>

          {classStats && (
            <div className="mt-3 pt-3 border-t border-surface-700/40 flex justify-between text-xs text-surface-500">
              <span>⌀ {classStats.avg_duration_seconds.toFixed(1)}s</span>
              <span>{classStats.total_cost_usd > 0 ? `$${classStats.total_cost_usd.toFixed(3)} USD` : '100% lokal'}</span>
              <span>{((classStats.total_tokens_in + classStats.total_tokens_out) / 1000).toFixed(0)}k Tokens</span>
            </div>
          )}
        </Link>

        {/* Aufräumen */}
        <Link to="/correspondents" className="group card p-5 border border-amber-500/20 bg-gradient-to-b from-amber-500/5 to-transparent hover:border-amber-500/40 transition-all hover:scale-[1.01]">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-amber-500/15 border border-amber-500/20">
                <Wrench className="w-5 h-5 text-amber-400" />
              </div>
              <span className="font-display font-semibold text-surface-100">Aufräumen</span>
            </div>
            <ArrowRight className="w-4 h-4 text-surface-600 group-hover:text-amber-400 group-hover:translate-x-1 transition-all" />
          </div>

          <div className="grid grid-cols-3 gap-2 mb-4 text-center">
            {[
              { val: counts.correspondents, label: 'Korr.', cleaned: cleanupStats?.correspondents?.merged + cleanupStats?.correspondents?.deleted || 0, color: 'text-blue-400' },
              { val: counts.tags, label: 'Tags', cleaned: cleanupStats?.tags?.merged + cleanupStats?.tags?.deleted || 0, color: 'text-purple-400' },
              { val: counts.documentTypes, label: 'Typen', cleaned: cleanupStats?.document_types?.merged || 0, color: 'text-amber-400' },
            ].map(i => (
              <div key={i.label} className="p-2 rounded-lg bg-surface-700/30">
                <div className={clsx('text-xl font-bold', i.color)}>{i.val}</div>
                <div className="text-xs text-surface-500">{i.label}</div>
                {i.cleaned > 0 && <div className="text-xs text-emerald-400">−{i.cleaned}</div>}
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-surface-400">Bereinigt gesamt</span>
              <span className="font-bold text-emerald-400">{totalCleaned}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-surface-400">Dokumente aktualisiert</span>
              <span className="font-bold text-surface-200">{cleanupStats?.total_documents_affected || 0}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-surface-400">Zeit gespart</span>
              <span className="font-bold text-surface-200">{timeSaved} min</span>
            </div>
          </div>
        </Link>
      </div>

      {/* ── Modell-Performance + Letzte Klassifizierungen ───────────────────── */}
      {classStats && (classStats.by_provider?.length > 0 || classStats.recent?.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

          {/* Provider Breakdown */}
          <div className="lg:col-span-2 card p-6 border border-surface-700/50">
            <h3 className="font-display font-semibold text-surface-100 mb-4 flex items-center gap-2 text-sm">
              <Zap className="w-4 h-4 text-amber-400" />
              Modell-Einsatz
            </h3>
            <div className="space-y-4">
              {classStats.by_provider?.map((p: any) => {
                const pct = (p.count / classStats.total_runs) * 100
                const isCloud = p.provider === 'openai' || p.provider === 'anthropic' || p.provider === 'mistral'
                return (
                  <div key={`${p.provider}-${p.model}`}>
                    <div className="flex justify-between items-baseline mb-1.5">
                      <span className="text-sm text-surface-200 truncate max-w-[150px]" title={p.model}>{p.model}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={clsx('text-xs px-1.5 py-0.5 rounded border',
                          isCloud ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-violet-500/10 border-violet-500/20 text-violet-400')}>
                          {isCloud ? 'Cloud' : 'Lokal'}
                        </span>
                        <span className="text-xs text-surface-500">{p.count}×</span>
                      </div>
                    </div>
                    <Bar
                      pct={pct}
                      color={isCloud ? '#10b981' : '#7c3aed'}
                      glow={isCloud ? '#10b98155' : '#7c3aed55'}
                    />
                    <div className="flex justify-between text-xs text-surface-600 mt-1">
                      <span>⌀ {p.avg_duration?.toFixed(0)}s</span>
                      {p.cost > 0 ? <span>${p.cost.toFixed(4)}</span> : <span className="text-violet-400/60">kostenlos</span>}
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="mt-4 pt-3 border-t border-surface-700/40 grid grid-cols-2 gap-3">
              <div>
                <div className="text-xl font-bold text-surface-100">{classStats.avg_duration_seconds.toFixed(1)}s</div>
                <div className="text-xs text-surface-500">Ø Analysezeit</div>
              </div>
              <div>
                <div className="text-xl font-bold text-surface-100">
                  {((classStats.total_tokens_in + classStats.total_tokens_out) / 1000).toFixed(0)}k
                </div>
                <div className="text-xs text-surface-500">Tokens gesamt</div>
              </div>
            </div>
          </div>

          {/* Recent */}
          <div className="lg:col-span-3 card p-6 border border-surface-700/50">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display font-semibold text-surface-100 flex items-center gap-2 text-sm">
                <Activity className="w-4 h-4 text-violet-400" />
                Letzte Klassifizierungen
              </h3>
              <Link to="/classifier" className="text-xs text-surface-500 hover:text-primary-400 flex items-center gap-1 transition-colors">
                Alle <ChevronRight className="w-3 h-3" />
              </Link>
            </div>
            <div className="space-y-1.5">
              {(classStats.recent || []).slice(0, 7).map((item: any, i: number) => (
                <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg bg-surface-700/20 hover:bg-surface-700/40 transition-colors">
                  <div className={clsx('w-1.5 h-1.5 rounded-full shrink-0',
                    item.status === 'applied' ? 'bg-emerald-400' : 'bg-amber-400'
                  )} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-surface-200 truncate">{item.document_title}</p>
                    <p className="text-xs text-surface-500">
                      {item.model} · {item.duration_seconds?.toFixed(1)}s
                    </p>
                  </div>
                  <span className={clsx('text-xs px-1.5 py-0.5 rounded border shrink-0',
                    item.status === 'applied'
                      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                      : 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                  )}>
                    {item.status === 'applied' ? '✓' : '○'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Schnellzugriff ─────────────────────────────────────────────────── */}
      <div>
        <h3 className="font-display text-xs font-semibold text-surface-500 uppercase tracking-widest mb-3 flex items-center gap-2">
          <TrendingUp className="w-3.5 h-3.5" />
          Schnellzugriff
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { href: '/classifier', icon: Brain, label: 'Klassifizierer', sub: `${(classStats?.total_documents_paperless || 0) - applied} offen`, color: 'border-violet-500/25 hover:border-violet-500/50', ic: 'text-violet-400', bg: 'bg-violet-500/5' },
            { href: '/ocr', icon: ScanText, label: 'OCR Manager', sub: ocrPending > ocrIgnored ? `${ocrPending - ocrIgnored} ausstehend` : 'Alles fertig ✓', color: 'border-cyan-500/25 hover:border-cyan-500/50', ic: 'text-cyan-400', bg: 'bg-cyan-500/5' },
            { href: '/correspondents', icon: Users, label: 'Korrespondenten', sub: `${counts.correspondents} aktiv`, color: 'border-blue-500/25 hover:border-blue-500/50', ic: 'text-blue-400', bg: 'bg-blue-500/5' },
            { href: '/tags/wizard', icon: Tags, label: 'Tag Wizard', sub: `${counts.tags} Tags`, color: 'border-purple-500/25 hover:border-purple-500/50', ic: 'text-purple-400', bg: 'bg-purple-500/5' },
            { href: '/ocr?tab=review', icon: Eye, label: 'OCR Prüfen', sub: ocrReview > 0 ? `${ocrReview} ausstehend` : 'Alles erledigt ✓', color: 'border-orange-500/25 hover:border-orange-500/50', ic: 'text-orange-400', bg: 'bg-orange-500/5' },
            { href: '/ocr?tab=ignore', icon: ShieldOff, label: 'Ignore-Liste', sub: `${ocrIgnored} Einträge`, color: 'border-surface-600/40 hover:border-surface-500/60', ic: 'text-surface-400', bg: '' },
            { href: '/document-types', icon: FileText, label: 'Dokumententypen', sub: `${counts.documentTypes} Typen`, color: 'border-amber-500/25 hover:border-amber-500/50', ic: 'text-amber-400', bg: 'bg-amber-500/5' },
            { href: '/settings', icon: Activity, label: 'Einstellungen', sub: 'KI, Paperless & Prompts', color: 'border-surface-600/40 hover:border-surface-500/60', ic: 'text-surface-400', bg: '' },
          ].map(item => {
            const Icon = item.icon
            return (
              <Link key={item.href} to={item.href}
                className={clsx('card p-4 border transition-all duration-200 hover:scale-[1.02] group', item.color, item.bg)}>
                <div className="flex items-start justify-between mb-2">
                  <Icon className={clsx('w-4.5 h-4.5', item.ic)} />
                  <ChevronRight className="w-3.5 h-3.5 text-surface-600 group-hover:text-surface-400 group-hover:translate-x-0.5 transition-all" />
                </div>
                <div className="text-sm font-medium text-surface-200">{item.label}</div>
                <div className="text-xs text-surface-500 mt-0.5 truncate">{item.sub}</div>
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
