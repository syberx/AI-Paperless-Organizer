import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
    ScanLine,
    Settings,
    Play,
    Square,
    Loader2,
    BarChart3,
    LayoutDashboard,
    Pause,
    FileSearch,
    AlertCircle,
    FlaskConical,
    ShieldOff,
    AlertTriangle,
    RotateCcw,
    XCircle,
    Ban,
    CheckCircle2,
} from 'lucide-react'
import clsx from 'clsx'
import * as api from '../services/api'
import OcrSettings from './OcrSettings'
import OcrStats from './OcrStats'
import SingleOcr from './SingleOcr'
import OcrReview from './OcrReview'
import OcrCompare from './OcrCompare'

type BatchMode = 'all' | 'tagged' | 'manual'
type Tab = 'processing' | 'single' | 'review' | 'compare' | 'stats' | 'settings' | 'ignore' | 'errors'

export default function OcrManager() {
    const [searchParams] = useSearchParams()
    const initialTab = (searchParams.get('tab') as Tab) || 'processing'
    const [activeTab, setActiveTab] = useState<Tab>(initialTab)
    const [recheckDocId, setRecheckDocId] = useState<number | null>(null)

    // Switch tab when URL param changes (e.g. sidebar link)
    useEffect(() => {
        const t = searchParams.get('tab') as Tab | null
        if (t) setActiveTab(t)
    }, [searchParams])

    // Handler: Review -> SingleOcr recheck
    const handleRecheckDocument = (docId: number) => {
        setRecheckDocId(docId)
        setActiveTab('single')
    }

    // Batch OCR state (persistent via localStorage)
    const [batchMode, setBatchModeState] = useState<BatchMode>(() => {
        const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('ocr_batch_mode') : null
        return (saved === 'all' || saved === 'tagged' || saved === 'manual') ? saved as BatchMode : 'all'
    })
    const setBatchMode = (mode: BatchMode) => {
        setBatchModeState(mode)
        try { localStorage.setItem('ocr_batch_mode', mode) } catch {}
    }
    const [manualIds, setManualIds] = useState('')
    const [setFinishTag, setSetFinishTag] = useState(true)
    const [batchStatus, setBatchStatus] = useState<api.BatchOcrStatus | null>(null)
    const [batchRunning, setBatchRunning] = useState(false)
    const [batchPaused, setBatchPaused] = useState(false)
    const [startingBatch, setStartingBatch] = useState(false)

    const [watchdogStatus, setWatchdogStatus] = useState<api.WatchdogStatus | null>(null)
    const pollInterval = useRef<ReturnType<typeof setInterval> | null>(null)
    const logContainerRef = useRef<HTMLDivElement>(null)
    const logEndRef = useRef<HTMLDivElement>(null)
    const [reviewCount, setReviewCount] = useState(0)
    const [errorCount, setErrorCount] = useState(0)
    const [ignoreCount, setIgnoreCount] = useState(0)

    // Check status on mount and set up background polling
    useEffect(() => {
        checkStatus()
        // Poll review/error/ignore counts
        const refreshCounts = () => {
            api.getReviewQueue().then(r => setReviewCount(r.count)).catch(() => { })
            api.getOcrErrorList().then(r => setErrorCount(r.count)).catch(() => { })
            api.getOcrIgnoreList().then(r => setIgnoreCount(r.count)).catch(() => { })
        }
        refreshCounts()
        const rPoll = setInterval(refreshCounts, 15000)

        // Background poll – only when batch is NOT running (startPolling covers the running case)
        const bgPoll = setInterval(() => {
            if (!batchRunning) checkStatus()
        }, 15000)

        return () => {
            if (pollInterval.current) clearInterval(pollInterval.current)
            clearInterval(rPoll)
            clearInterval(bgPoll)
        }
    }, [batchRunning])

    // Auto-scroll log (only if already at the bottom)
    useEffect(() => {
        const container = logContainerRef.current
        if (!container || !logEndRef.current) return

        // Check if we are within roughly 50px of the bottom BEFORE the new logs render
        const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 50

        if (isNearBottom) {
            container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
        }
    }, [batchStatus?.log])

    const checkStatus = async () => {
        try {
            const [bStatus, wStatus] = await Promise.all([
                api.getBatchOcrStatus(),
                api.getWatchdogStatus()
            ])

            setBatchStatus(bStatus)
            setWatchdogStatus(wStatus)

            if (bStatus.running) {
                setBatchRunning(true)
                setBatchPaused(!!bStatus.paused)
                startPolling()
            } else {
                setBatchRunning(false)
                setBatchPaused(false)
            }
        } catch { }
    }

    const startPolling = () => {
        if (pollInterval.current) clearInterval(pollInterval.current)
        pollInterval.current = setInterval(async () => {
            try {
                const bStatus = await api.getBatchOcrStatus()
                setBatchStatus(bStatus)
                setBatchPaused(!!bStatus.paused)

                if (!bStatus.running) {
                    setBatchRunning(false)
                    setBatchPaused(false)
                    if (pollInterval.current) clearInterval(pollInterval.current)
                    api.getWatchdogStatus().then(setWatchdogStatus)
                }
            } catch { }
        }, 3000)
    }

    const startBatch = async () => {
        setStartingBatch(true)
        setBatchStatus(null)
        try {
            let docIds: number[] | undefined
            if (batchMode === 'manual') {
                docIds = manualIds.split(',').map((s: string) => parseInt(s.trim())).filter((n: number) => !isNaN(n))
                if (!docIds || docIds.length === 0) {
                    setStartingBatch(false)
                    return
                }
            }

            await api.startBatchOcr(batchMode, docIds, setFinishTag, true)
            setBatchRunning(true)
            startPolling()
        } catch (e) {
            console.error('Error starting batch:', e)
        } finally {
            setStartingBatch(false)
        }
    }

    const stopBatch = async () => {
        try {
            await api.stopBatchOcr()
        } catch { }
    }

    const togglePause = async () => {
        try {
            if (batchPaused) {
                await api.resumeBatchOcr()
                setBatchPaused(false)
            } else {
                await api.pauseBatchOcr()
                setBatchPaused(true)
            }
        } catch { }
    }

    const progressPercent = batchStatus && batchStatus.total > 0
        ? Math.round((batchStatus.processed / batchStatus.total) * 100)
        : 0

    // Tab definitions
    const tabs: { id: Tab; label: string; icon: React.ReactNode; color: string; badge?: number }[] = [
        { id: 'processing', label: 'Verarbeitung', icon: <LayoutDashboard className="w-4 h-4" />, color: 'primary' },
        { id: 'single', label: 'Einzel-OCR', icon: <FileSearch className="w-4 h-4" />, color: 'cyan' },
        { id: 'compare', label: 'Vergleich', icon: <FlaskConical className="w-4 h-4" />, color: 'violet' },
        { id: 'review', label: 'Prüfen', icon: <AlertCircle className="w-4 h-4" />, color: 'amber', badge: reviewCount },
        { id: 'errors', label: 'Fehler', icon: <AlertTriangle className="w-4 h-4" />, color: 'red', badge: errorCount },
        { id: 'ignore', label: 'Ignoriert', icon: <ShieldOff className="w-4 h-4" />, color: 'orange', badge: ignoreCount },
        { id: 'stats', label: 'Statistiken', icon: <BarChart3 className="w-4 h-4" />, color: 'primary' },
        { id: 'settings', label: 'Einstellungen', icon: <Settings className="w-4 h-4" />, color: 'primary' },
    ]

    const colorMap: Record<string, string> = {
        primary: 'bg-primary-600 shadow-primary-900/20',
        cyan: 'bg-cyan-600 shadow-cyan-900/20',
        violet: 'bg-violet-600 shadow-violet-900/20',
        amber: 'bg-amber-600 shadow-amber-900/20',
        red: 'bg-red-600 shadow-red-900/20',
        orange: 'bg-orange-600 shadow-orange-900/20',
    }

    const badgeColorMap: Record<string, string> = {
        amber: 'bg-amber-500/30 text-amber-200',
        red: 'bg-red-500/30 text-red-200',
        orange: 'bg-orange-500/30 text-orange-200',
    }

    return (
        <div className="space-y-8 pb-12">
            {/* Header */}
            <div>
                <div className="flex justify-between items-start">
                    <div>
                        <h2 className="font-display text-3xl font-bold text-white flex items-center gap-3">
                            <div className="p-2 bg-gradient-to-br from-primary-500 to-primary-700 rounded-xl shadow-lg shadow-primary-500/20">
                                <ScanLine className="w-8 h-8 text-white" />
                            </div>
                            OCR Texterkennung <span className="text-primary-400">Pro</span>
                        </h2>
                        <p className="text-surface-400 mt-2 text-lg">
                            KI-gestützte Dokumentenanalyse mit Ollama Vision &amp; Multi-Server Failover
                        </p>
                    </div>

                    {watchdogStatus?.enabled && (
                        <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-800/60 border border-purple-500/30 text-xs font-medium text-purple-200 shadow-lg shadow-purple-900/20 animate-in fade-in">
                            <div className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-500"></span>
                            </div>
                            <span>Autopilot Aktiv ({watchdogStatus.interval_minutes}m)</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Navigation Tabs — 2 rows of 4 */}
            <div className="space-y-1">
                {[tabs.slice(0, 4), tabs.slice(4)].map((row, rowIdx) => (
                    <div key={rowIdx} className="flex p-1 space-x-1 bg-surface-800/40 rounded-xl backdrop-blur-md border border-surface-700/50">
                        {row.map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => {
                                    if (tab.id === 'single') setRecheckDocId(null)
                                    setActiveTab(tab.id)
                                }}
                                className={clsx(
                                    'flex-1 py-2.5 px-3 rounded-lg text-sm font-medium transition-all duration-200 flex items-center justify-center gap-2',
                                    activeTab === tab.id
                                        ? `${colorMap[tab.color]} text-white shadow-lg ring-1 ring-white/10`
                                        : 'text-surface-400 hover:text-white hover:bg-surface-700/50'
                                )}
                            >
                                {tab.icon}
                                <span className="hidden sm:inline">{tab.label}</span>
                                <span className="sm:hidden">{tab.label.split(' ')[0]}</span>
                                {tab.badge !== undefined && tab.badge > 0 && (
                                    <span className={clsx(
                                        'px-1.5 py-0.5 text-xs font-bold rounded-full',
                                        activeTab === tab.id
                                            ? 'bg-white/20 text-white'
                                            : (badgeColorMap[tab.color] || 'bg-surface-600 text-surface-300')
                                    )}>
                                        {tab.badge}
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>
                ))}
            </div>

            {/* Tab: Processing */}
            {activeTab === 'processing' && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="card p-0 overflow-hidden border border-surface-700/50 shadow-xl shadow-black/20 bg-surface-800/40 backdrop-blur-sm">
                        <div className="p-6 border-b border-surface-700/50 bg-surface-800/50">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-purple-500/20 rounded-lg">
                                    <LayersIcon className="w-5 h-5 text-purple-400" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-lg text-white">Batch Processing</h3>
                                    <p className="text-sm text-surface-400">Massenverarbeitung im Hintergrund</p>
                                </div>
                            </div>
                        </div>

                        <div className="p-6 space-y-6">
                            {/* Mode Selection */}
                            <div className="grid grid-cols-3 gap-3">
                                {[
                                    { id: 'all', icon: '🔄', label: 'Alle', desc: 'Ohne Finish-Tag' },
                                    { id: 'tagged', icon: '🏷️', label: 'Tag', desc: '"runocr"' },
                                    { id: 'manual', icon: '✏️', label: 'Manuell', desc: 'IDs eingeben' }
                                ].map((mode) => (
                                    <button
                                        key={mode.id}
                                        onClick={() => setBatchMode(mode.id as BatchMode)}
                                        disabled={batchRunning}
                                        className={clsx(
                                            'relative p-3 rounded-xl border transition-all text-left flex flex-col gap-1 hover:border-primary-500/30',
                                            batchMode === mode.id
                                                ? 'border-primary-500 bg-primary-500/10 ring-1 ring-primary-500/20'
                                                : 'border-surface-700 bg-surface-800/50 text-surface-400'
                                        )}
                                    >
                                        <span className="text-xl mb-1 block">{mode.icon}</span>
                                        <span className={clsx("font-medium text-sm", batchMode === mode.id ? "text-white" : "text-surface-300")}>{mode.label}</span>
                                        <span className="text-[10px] opacity-60 leading-tight">{mode.desc}</span>
                                    </button>
                                ))}
                            </div>

                            {/* Manual Input */}
                            {batchMode === 'manual' && (
                                <div className="space-y-1 animate-in slide-in-from-top-2 duration-200">
                                    <label className="text-xs font-medium text-surface-400 ml-1">Dokument-IDs (kommagetrennt)</label>
                                    <input
                                        type="text"
                                        value={manualIds}
                                        onChange={(e) => setManualIds(e.target.value)}
                                        placeholder="1, 5, 12, 23"
                                        className="input bg-surface-900/50 border-surface-700"
                                        disabled={batchRunning}
                                    />
                                </div>
                            )}

                            {/* Options */}
                            <div className="p-3 rounded-xl bg-surface-900/30 border border-surface-700/50">
                                <label className="flex items-center gap-3 text-sm text-surface-300 cursor-pointer group">
                                    <div className="relative flex items-center">
                                        <input
                                            type="checkbox"
                                            checked={setFinishTag}
                                            onChange={(e) => setSetFinishTag(e.target.checked)}
                                            disabled={batchRunning}
                                            className="peer sr-only"
                                        />
                                        <div className="w-9 h-5 bg-surface-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary-600"></div>
                                    </div>
                                    <span className="group-hover:text-white transition-colors">Tag "ocrfinish" setzen</span>
                                </label>
                            </div>

                            {/* Action Buttons */}
                            <div className="pt-2 flex gap-3">
                                {!batchRunning ? (
                                    <button
                                        onClick={startBatch}
                                        disabled={startingBatch || (batchMode === 'manual' && !manualIds.trim())}
                                        className="w-full btn btn-primary py-4 flex justify-center items-center gap-2 shadow-lg shadow-primary-900/20 text-lg font-medium"
                                    >
                                        {startingBatch ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5 fill-current" />}
                                        Batch Starten
                                    </button>
                                ) : (
                                    <>
                                        <button
                                            onClick={togglePause}
                                            className={clsx(
                                                "flex-1 btn py-4 flex justify-center items-center gap-2 shadow-lg border-0 text-lg font-medium transition-colors",
                                                batchPaused ? "bg-amber-500 hover:bg-amber-600 text-white" : "bg-surface-700 hover:bg-surface-600 text-surface-200"
                                            )}
                                        >
                                            {batchPaused ? (
                                                <>
                                                    <Play className="w-5 h-5 fill-current" />
                                                    Fortsetzen
                                                </>
                                            ) : (
                                                <>
                                                    <Pause className="w-5 h-5 fill-current" />
                                                    Pausieren
                                                </>
                                            )}
                                        </button>
                                        <button
                                            onClick={stopBatch}
                                            className="flex-1 btn py-4 flex justify-center items-center gap-2 shadow-lg bg-red-600 hover:bg-red-700 text-white border-0 text-lg font-medium"
                                        >
                                            <Square className="w-5 h-5 fill-current" />
                                            Stoppen
                                        </button>
                                    </>
                                )}
                            </div>

                            {/* Status & Logs */}
                            {batchStatus && (batchRunning || batchStatus.total > 0 || (batchStatus.log && batchStatus.log.length > 0)) && (
                                <div className="mt-6 pt-6 border-t border-surface-700/50 space-y-4 animate-in fade-in duration-500">
                                    <div>
                                        <div className="flex justify-between text-xs text-surface-400 mb-2 font-medium uppercase tracking-wider">
                                            <span>Fortschritt {batchPaused && <span className="text-amber-400 ml-2">(Pausiert)</span>}</span>
                                            <span>{batchStatus.processed} / {batchStatus.total}</span>
                                        </div>
                                        <div className="h-2.5 rounded-full bg-surface-900 overflow-hidden ring-1 ring-surface-700">
                                            <div
                                                className={clsx(
                                                    'h-full rounded-full transition-all duration-500 relative',
                                                    batchPaused ? 'bg-amber-500' :
                                                        batchRunning ? 'bg-gradient-to-r from-primary-600 to-primary-400' : 'bg-emerald-500'
                                                )}
                                                style={{ width: `${progressPercent}%` }}
                                            >
                                                {batchRunning && !batchPaused && (
                                                    <div className="absolute inset-0 bg-white/20 animate-[shimmer_2s_infinite]"></div>
                                                )}
                                            </div>
                                        </div>
                                        {/* Live page progress for current document */}
                                        {batchStatus.current_page_progress && (batchStatus.current_page_progress.total_pages ?? 0) > 0 && (
                                            <div className="rounded-xl bg-surface-800/60 border border-cyan-500/20 p-3 space-y-2">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin" />
                                                        <span className="text-xs text-cyan-300 font-medium">
                                                            Seite {batchStatus.current_page_progress.current_page}/{batchStatus.current_page_progress.total_pages}
                                                        </span>
                                                    </div>
                                                    <span className="text-xs text-surface-500">
                                                        {batchStatus.current_page_progress.done}/{batchStatus.current_page_progress.total_pages} fertig
                                                        {batchStatus.current_page_progress.errors ? ` · ${batchStatus.current_page_progress.errors} Fehler` : ''}
                                                    </span>
                                                </div>
                                                {/* Page progress bar */}
                                                <div className="w-full bg-surface-700/50 rounded-full h-1.5 overflow-hidden">
                                                    <div
                                                        className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-cyan-400 transition-all duration-500"
                                                        style={{ width: `${Math.round(((batchStatus.current_page_progress.done || 0) / (batchStatus.current_page_progress.total_pages || 1)) * 100)}%` }}
                                                    />
                                                </div>
                                                {/* Page tiles */}
                                                <div className="flex flex-wrap gap-1">
                                                    {(batchStatus.current_page_progress.pages || []).map((pg) => (
                                                        <div
                                                            key={pg.page}
                                                            className={clsx(
                                                                'w-7 h-7 rounded flex flex-col items-center justify-center text-[10px] font-mono border transition-all',
                                                                pg.status === 'done' && 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300',
                                                                pg.status === 'processing' && 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300 animate-pulse',
                                                                pg.status === 'error' && 'bg-red-500/20 border-red-500/40 text-red-300',
                                                                pg.status === 'pending' && 'bg-surface-700/30 border-surface-600/30 text-surface-500',
                                                            )}
                                                        >
                                                            <span className="leading-none">{pg.page}</span>
                                                            {pg.status === 'done' && <CheckCircle2 className="w-2 h-2" />}
                                                            {pg.status === 'processing' && <Loader2 className="w-2 h-2 animate-spin" />}
                                                            {pg.status === 'error' && <XCircle className="w-2 h-2" />}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        <div
                                            ref={logContainerRef}
                                            className="rounded-xl bg-black/40 border border-surface-700/50 p-4 font-mono text-xs h-64 overflow-y-auto custom-scrollbar shadow-inner"
                                        >
                                            {batchStatus.log.map((entry, i) => (
                                                <div key={i} className={clsx(
                                                    'py-1 border-l-2 pl-2 mb-1',
                                                    entry.includes('pausiert') ? 'border-amber-500 text-amber-400' :
                                                        entry.startsWith('✅') ? 'border-emerald-500 text-emerald-400' :
                                                            entry.startsWith('❌') ? 'border-red-500 text-red-400' :
                                                                entry.startsWith('⚠️') ? 'border-amber-500 text-amber-400' :
                                                                    entry.startsWith('🚫') ? 'border-red-600 text-red-300' :
                                                                        entry.startsWith('🔄') ? 'border-blue-500 text-blue-400' :
                                                                            'border-surface-700 text-surface-400'
                                                )}>
                                                    {entry}
                                                </div>
                                            ))}
                                            <div ref={logEndRef} />
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Tab: Stats */}
            {activeTab === 'stats' && (
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <OcrStats />
                </div>
            )}

            {/* Tab: Settings */}
            {activeTab === 'settings' && (
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <OcrSettings />
                </div>
            )}

            {/* Tab: Einzel-OCR */}
            {activeTab === 'single' && (
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <SingleOcr initialDocId={recheckDocId} />
                </div>
            )}

            {/* Tab: Vergleich */}
            {activeTab === 'compare' && (
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <OcrCompare />
                </div>
            )}

            {/* Tab: Prüfen */}
            {activeTab === 'review' && (
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <OcrReviewTab onRecheckDocument={handleRecheckDocument} />
                </div>
            )}

            {/* Tab: Fehler */}
            {activeTab === 'errors' && (
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <OcrErrorTab onCountChange={setErrorCount} />
                </div>
            )}

            {/* Tab: Ignoriert */}
            {activeTab === 'ignore' && (
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <OcrIgnoreTab onCountChange={setIgnoreCount} />
                </div>
            )}
        </div>
    )
}
// ---- Prüfen Tab (with ignore list visible below) ----
function OcrReviewTab({ onRecheckDocument }: { onRecheckDocument?: (id: number) => void }) {
    return <OcrReview onRecheckDocument={onRecheckDocument} />
}

// ---- Fehler Tab ----
function OcrErrorTab({ onCountChange }: { onCountChange: (n: number) => void }) {
    const [items, setItems] = useState<api.OcrErrorItem[]>([])
    const [loading, setLoading] = useState(true)
    const [actionLoading, setActionLoading] = useState<number | null>(null)
    const [bulkLoading, setBulkLoading] = useState(false)
    const [success, setSuccess] = useState('')
    const [error, setError] = useState('')

    useEffect(() => { load() }, [])

    const load = async () => {
        setLoading(true)
        try {
            const data = await api.getOcrErrorList()
            setItems(data.items || [])
            onCountChange(data.count)
        } catch (e: any) {
            setError(e?.message || 'Ladefehler')
        } finally {
            setLoading(false)
        }
    }

    const removeEntry = (docId: number) => {
        setItems(prev => {
            const next = prev.filter(i => i.document_id !== docId)
            onCountChange(next.length)
            return next
        })
    }

    const retry = async (docId: number, title: string) => {
        setActionLoading(docId)
        try {
            await api.removeFromOcrErrorList(docId)
            removeEntry(docId)
            setSuccess(`"${title}" – Fehlerzähler zurückgesetzt, wird beim nächsten Batch erneut versucht.`)
            setTimeout(() => setSuccess(''), 5000)
        } catch (e: any) {
            setError(e?.message || 'Fehler')
        } finally {
            setActionLoading(null)
        }
    }

    const ignoreOne = async (docId: number, title: string) => {
        setActionLoading(docId)
        try {
            await Promise.all([
                api.addToOcrIgnoreList(docId),
                api.removeFromOcrErrorList(docId),
            ])
            removeEntry(docId)
            setSuccess(`"${title}" – zur Ignore-Liste hinzugefügt, wird künftig übersprungen.`)
            setTimeout(() => setSuccess(''), 5000)
        } catch (e: any) {
            setError(e?.message || 'Fehler')
        } finally {
            setActionLoading(null)
        }
    }

    const ignoreAll = async () => {
        if (!confirm(`Alle ${items.length} Dokumente ignorieren? Sie werden zur Ignore-Liste verschoben und nicht mehr verarbeitet.`)) return
        setBulkLoading(true)
        try {
            await Promise.all(items.map(it =>
                Promise.all([
                    api.addToOcrIgnoreList(it.document_id),
                    api.removeFromOcrErrorList(it.document_id),
                ])
            ))
            setItems([])
            onCountChange(0)
            setSuccess(`${items.length} Dokumente ignoriert – Fehlerliste ist jetzt leer.`)
            setTimeout(() => setSuccess(''), 5000)
        } catch (e: any) {
            setError(e?.message || 'Fehler')
            await load()
        } finally {
            setBulkLoading(false)
        }
    }

    const clearAll = async () => {
        if (!confirm(`Alle ${items.length} Einträge von der Fehlerliste entfernen (ohne zu ignorieren)?`)) return
        try {
            await api.clearOcrErrorList()
            setItems([])
            onCountChange(0)
            setSuccess('Fehlerliste geleert.')
            setTimeout(() => setSuccess(''), 4000)
        } catch (e: any) {
            setError(e?.message || 'Fehler')
        }
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h2 className="font-display text-3xl font-bold text-white flex items-center gap-3">
                        <div className="p-2 bg-gradient-to-br from-red-500 to-red-700 rounded-xl shadow-lg shadow-red-500/20">
                            <AlertTriangle className="w-8 h-8 text-white" />
                        </div>
                        OCR <span className="text-red-400">Fehlerliste</span>
                        {items.length > 0 && (
                            <span className="ml-2 px-3 py-1 text-sm bg-red-500/20 text-red-300 rounded-full border border-red-500/30">
                                {items.length}
                            </span>
                        )}
                    </h2>
                    <p className="text-surface-400 mt-2">
                        Dokumente die nach 3 Fehlversuchen dauerhaft markiert wurden (Tag: <code className="text-red-300 text-sm">ocrfehler</code>)
                    </p>
                </div>
                <div className="flex gap-2 flex-wrap">
                    <button onClick={load} className="btn bg-surface-700 hover:bg-surface-600 text-surface-200 flex items-center gap-2">
                        <RotateCcw className="w-4 h-4" /> Aktualisieren
                    </button>
                    {items.length > 0 && (<>
                        <button
                            onClick={ignoreAll}
                            disabled={bulkLoading}
                            className="btn bg-amber-600/20 hover:bg-amber-600/40 text-amber-300 border border-amber-500/30 flex items-center gap-2 disabled:opacity-50"
                        >
                            {bulkLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
                            Alle ignorieren
                        </button>
                        <button onClick={clearAll} className="btn bg-red-600/20 hover:bg-red-600/40 text-red-300 border border-red-500/30 flex items-center gap-2">
                            <XCircle className="w-4 h-4" /> Alle löschen
                        </button>
                    </>)}
                </div>
            </div>

            {success && (
                <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-200 text-sm">{success}</div>
            )}
            {error && (
                <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-200 text-sm">{error}</div>
            )}

            {loading ? (
                <div className="card p-12 text-center border border-surface-700/50 bg-surface-800/40">
                    <Loader2 className="w-10 h-10 animate-spin text-red-400 mx-auto mb-3" />
                    <p className="text-surface-400">Lade Fehlerliste...</p>
                </div>
            ) : items.length === 0 ? (
                <div className="card p-12 text-center border border-surface-700/50 bg-surface-800/40">
                    <CheckCircle2 className="w-14 h-14 text-emerald-500 mx-auto mb-4" />
                    <p className="text-xl font-bold text-white">Keine Fehler 🎉</p>
                    <p className="text-surface-400 mt-2">Alle Dokumente konnten verarbeitet werden.</p>
                </div>
            ) : (
                <div className="space-y-2">
                    <p className="text-sm text-surface-500 mb-3">
                        <span className="text-amber-400 font-medium">Ignorieren</span> → dauerhaft überspringen (zur Ignore-Liste) ·{' '}
                        <span className="text-primary-400 font-medium">Retry</span> → Fehlerzähler zurücksetzen, nächster Batch versucht es erneut
                    </p>
                    {items.map(entry => (
                        <div key={entry.document_id} className="flex items-center justify-between p-4 rounded-xl bg-surface-800/40 border border-red-500/20 gap-4">
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                                <div className="p-2 bg-red-500/10 rounded-lg shrink-0">
                                    <AlertTriangle className="w-5 h-5 text-red-400" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-sm font-medium text-surface-100 truncate">{entry.title}</p>
                                    <div className="flex items-center gap-3 text-xs text-surface-500 mt-0.5">
                                        <span className="font-mono">#{entry.document_id}</span>
                                        <span className="text-red-400 font-semibold">{entry.fail_count}× fehlgeschlagen</span>
                                        <span>{new Date(entry.timestamp).toLocaleString('de-DE')}</span>
                                    </div>
                                    <p className="text-xs text-red-300/70 mt-1 truncate" title={entry.error}>{entry.error}</p>
                                </div>
                            </div>
                            <div className="flex gap-2 shrink-0">
                                <button
                                    onClick={() => ignoreOne(entry.document_id, entry.title)}
                                    disabled={actionLoading === entry.document_id}
                                    title="Dauerhaft ignorieren – nie wieder versuchen"
                                    className="btn bg-amber-600/20 hover:bg-amber-600/50 text-amber-300 hover:text-amber-100 text-xs px-3 py-2 flex items-center gap-1.5 disabled:opacity-50"
                                >
                                    {actionLoading === entry.document_id
                                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                        : <Ban className="w-3.5 h-3.5" />
                                    }
                                    Ignorieren
                                </button>
                                <button
                                    onClick={() => retry(entry.document_id, entry.title)}
                                    disabled={actionLoading === entry.document_id}
                                    title="Fehlerzähler zurücksetzen – nächster Batch versucht es erneut"
                                    className="btn bg-surface-700 hover:bg-primary-600 text-surface-400 hover:text-white text-xs px-3 py-2 flex items-center gap-1.5 disabled:opacity-50"
                                >
                                    {actionLoading === entry.document_id
                                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                        : <RotateCcw className="w-3.5 h-3.5" />
                                    }
                                    Retry
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

// ---- Ignore Tab ----
function OcrIgnoreTab({ onCountChange }: { onCountChange: (n: number) => void }) {
    const [items, setItems] = useState<api.OcrIgnoreItem[]>([])
    const [loading, setLoading] = useState(true)
    const [actionLoading, setActionLoading] = useState<number | null>(null)
    const [success, setSuccess] = useState('')
    const [error, setError] = useState('')

    useEffect(() => { load() }, [])

    const load = async () => {
        setLoading(true)
        try {
            const data = await api.getOcrIgnoreList()
            setItems(data.items || [])
            onCountChange(data.count)
        } catch (e: any) {
            setError(e?.message || 'Ladefehler')
        } finally {
            setLoading(false)
        }
    }

    const remove = async (docId: number, title: string) => {
        setActionLoading(docId)
        try {
            await api.removeFromOcrIgnoreList(docId)
            setItems(prev => prev.filter(i => i.document_id !== docId))
            onCountChange(items.length - 1)
            setSuccess(`"${title}" – Von Ignore-Liste entfernt. Wird beim nächsten Batch wieder verarbeitet.`)
            setTimeout(() => setSuccess(''), 5000)
        } catch (e: any) {
            setError(e?.message || 'Fehler')
        } finally {
            setActionLoading(null)
        }
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="font-display text-3xl font-bold text-white flex items-center gap-3">
                        <div className="p-2 bg-gradient-to-br from-orange-500 to-orange-700 rounded-xl shadow-lg shadow-orange-500/20">
                            <ShieldOff className="w-8 h-8 text-white" />
                        </div>
                        OCR <span className="text-orange-400">Ignoriert</span>
                        {items.length > 0 && (
                            <span className="ml-2 px-3 py-1 text-sm bg-orange-500/20 text-orange-300 rounded-full border border-orange-500/30">
                                {items.length}
                            </span>
                        )}
                    </h2>
                    <p className="text-surface-400 mt-2">
                        Dokumente die dauerhaft vom OCR-Batch ausgeschlossen sind (passwortgeschützt, 404, oder manuell ignoriert)
                    </p>
                </div>
                <button onClick={load} className="btn bg-surface-700 hover:bg-surface-600 text-surface-200 flex items-center gap-2">
                    <RotateCcw className="w-4 h-4" /> Aktualisieren
                </button>
            </div>

            {success && (
                <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-200 text-sm">{success}</div>
            )}
            {error && (
                <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-200 text-sm">{error}</div>
            )}

            {loading ? (
                <div className="card p-12 text-center border border-surface-700/50 bg-surface-800/40">
                    <Loader2 className="w-10 h-10 animate-spin text-orange-400 mx-auto mb-3" />
                    <p className="text-surface-400">Lade Ignore-Liste...</p>
                </div>
            ) : items.length === 0 ? (
                <div className="card p-12 text-center border border-surface-700/50 bg-surface-800/40">
                    <ShieldOff className="w-14 h-14 text-surface-600 mx-auto mb-4" />
                    <p className="text-xl font-bold text-white">Keine ignorierten Dokumente</p>
                    <p className="text-surface-400 mt-2">Alle Dokumente werden normal verarbeitet.</p>
                </div>
            ) : (
                <div className="space-y-2">
                    <p className="text-sm text-surface-500 mb-3">
                        "Entfernen" nimmt das Dokument von der Ignore-Liste — beim nächsten Batch wird es wieder versucht.
                    </p>
                    {items.map(entry => (
                        <div key={entry.document_id} className="flex items-center justify-between p-4 rounded-xl bg-surface-800/40 border border-orange-500/20 gap-4">
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                                <div className="p-2 bg-orange-500/10 rounded-lg shrink-0">
                                    <Ban className="w-5 h-5 text-orange-400" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-sm font-medium text-surface-100 truncate">{entry.title}</p>
                                    <div className="flex items-center gap-3 text-xs text-surface-500 mt-0.5">
                                        <span className="font-mono">#{entry.document_id}</span>
                                        <span className="text-orange-400/80">{entry.reason}</span>
                                        <span>{new Date(entry.timestamp).toLocaleString('de-DE')}</span>
                                    </div>
                                </div>
                            </div>
                            <button
                                onClick={() => remove(entry.document_id, entry.title)}
                                disabled={actionLoading === entry.document_id}
                                className="btn bg-surface-700 hover:bg-surface-600 text-surface-400 hover:text-white text-xs px-4 py-2 flex items-center gap-2 disabled:opacity-50 shrink-0"
                            >
                                {actionLoading === entry.document_id
                                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    : <XCircle className="w-3.5 h-3.5" />
                                }
                                Entfernen
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

function LayersIcon(props: any) {
    return (
        <svg
            {...props}
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <polygon points="12 2 2 7 12 12 22 7 12 2" />
            <polyline points="2 17 12 22 22 17" />
            <polyline points="2 12 12 17 22 12" />
        </svg>
    )
}
