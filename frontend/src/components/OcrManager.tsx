import { useState, useEffect, useRef } from 'react'
import {
    ScanLine,
    Settings,
    Play,
    Square,
    CheckCircle2,
    XCircle,
    Loader2,
    ArrowRightLeft,
    FileText,
    BarChart3,
    LayoutDashboard,
    Pause
} from 'lucide-react'
import clsx from 'clsx'
import * as api from '../services/api'
import OcrSettings from './OcrSettings'
import OcrStats from './OcrStats'

type BatchMode = 'all' | 'tagged' | 'manual'
type Tab = 'processing' | 'stats' | 'settings'

export default function OcrManager() {
    const [activeTab, setActiveTab] = useState<Tab>('processing')

    // Single OCR state
    const [singleDocId, setSingleDocId] = useState('')
    const [singleLoading, setSingleLoading] = useState(false)
    const [singleResult, setSingleResult] = useState<api.OcrResult | null>(null)
    const [singleError, setSingleError] = useState('')
    const [applying, setApplying] = useState(false)
    const [applied, setApplied] = useState(false)

    // Batch OCR state
    const [batchMode, setBatchMode] = useState<BatchMode>('all')
    const [manualIds, setManualIds] = useState('')
    const [setFinishTag, setSetFinishTag] = useState(true)
    const [batchStatus, setBatchStatus] = useState<api.BatchOcrStatus | null>(null)
    const [batchRunning, setBatchRunning] = useState(false)
    const [batchPaused, setBatchPaused] = useState(false)
    const [startingBatch, setStartingBatch] = useState(false)

    // Watchdog state
    const [watchdogStatus, setWatchdogStatus] = useState<api.WatchdogStatus | null>(null)

    const logEndRef = useRef<HTMLDivElement>(null)
    const pollInterval = useRef<ReturnType<typeof setInterval> | null>(null)

    // Check status on mount
    useEffect(() => {
        checkStatus()
        // Always poll for watchdog and batch status every 5 seconds if not running
        const bgPoll = setInterval(() => {
            if (!batchRunning) checkStatus()
        }, 5000)

        return () => clearInterval(bgPoll)
    }, [batchRunning])

    // Auto-scroll log
    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
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
                startPolling() // Ensure fast polling is active
            } else {
                setBatchRunning(false)
                setBatchPaused(false)
            }
        } catch { }
    }

    const runSingleOcr = async () => {
        const docId = parseInt(singleDocId)
        if (isNaN(docId)) return

        setSingleLoading(true)
        setSingleResult(null)
        setSingleError('')
        setApplied(false)

        try {
            const result = await api.ocrSingleDocument(docId)
            setSingleResult(result)
        } catch (e: any) {
            setSingleError(e?.message || 'Unbekannter Fehler')
        } finally {
            setSingleLoading(false)
        }
    }

    const applySingleResult = async () => {
        if (!singleResult) return
        setApplying(true)
        try {
            await api.applyOcrResult(singleResult.document_id, singleResult.new_content, setFinishTag)
            setApplied(true)
        } catch (e: any) {
            setSingleError(e?.message || 'Fehler beim Übertragen')
        } finally {
            setApplying(false)
        }
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
                    // Re-fetch watchdog once batch stops
                    api.getWatchdogStatus().then(setWatchdogStatus)
                }
            } catch { }
        }, 1000) // Fast polling when running
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
                            KI-gestützte Dokumentenanalyse mit Ollama Vision & Multi-Server Failover
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

            {/* Navigation Tabs */}
            <div className="flex p-1 space-x-1 bg-surface-800/40 rounded-xl backdrop-blur-md border border-surface-700/50 w-full max-w-3xl">
                <button
                    onClick={() => setActiveTab('processing')}
                    className={clsx(
                        'flex-1 py-3 px-4 rounded-lg text-sm font-medium transition-all duration-200 flex items-center justify-center gap-2',
                        activeTab === 'processing'
                            ? 'bg-primary-600 text-white shadow-lg shadow-primary-900/20 ring-1 ring-white/10'
                            : 'text-surface-400 hover:text-white hover:bg-surface-700/50'
                    )}
                >
                    <LayoutDashboard className="w-4 h-4" />
                    Verarbeitung
                </button>
                <button
                    onClick={() => setActiveTab('stats')}
                    className={clsx(
                        'flex-1 py-3 px-4 rounded-lg text-sm font-medium transition-all duration-200 flex items-center justify-center gap-2',
                        activeTab === 'stats'
                            ? 'bg-primary-600 text-white shadow-lg shadow-primary-900/20 ring-1 ring-white/10'
                            : 'text-surface-400 hover:text-white hover:bg-surface-700/50'
                    )}
                >
                    <BarChart3 className="w-4 h-4" />
                    Statistiken
                </button>
                <button
                    onClick={() => setActiveTab('settings')}
                    className={clsx(
                        'flex-1 py-3 px-4 rounded-lg text-sm font-medium transition-all duration-200 flex items-center justify-center gap-2',
                        activeTab === 'settings'
                            ? 'bg-primary-600 text-white shadow-lg shadow-primary-900/20 ring-1 ring-white/10'
                            : 'text-surface-400 hover:text-white hover:bg-surface-700/50'
                    )}
                >
                    <Settings className="w-4 h-4" />
                    Einstellungen
                </button>
            </div>

            {/* Tab: Processing */}
            {activeTab === 'processing' && (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    {/* ========== SINGLE OCR SECTION ========== */}
                    <div className="card p-0 overflow-hidden border border-surface-700/50 shadow-xl shadow-black/20 bg-surface-800/40 backdrop-blur-sm">
                        <div className="p-6 border-b border-surface-700/50 bg-surface-800/50">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-blue-500/20 rounded-lg">
                                    <FileText className="w-5 h-5 text-blue-400" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-lg text-white">Einzel-OCR</h3>
                                    <p className="text-sm text-surface-400">Vorschau & manueller Vergleich</p>
                                </div>
                            </div>
                        </div>

                        <div className="p-6 space-y-6">
                            <div className="flex gap-3">
                                <div className="relative flex-1">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                        <HashIcon className="h-4 w-4 text-surface-500" />
                                    </div>
                                    <input
                                        type="number"
                                        value={singleDocId}
                                        onChange={(e) => setSingleDocId(e.target.value)}
                                        placeholder="Dokument-ID (z.B. 1042)"
                                        className="input pl-9 bg-surface-900/50 border-surface-700 focus:border-blue-500 focus:ring-blue-500/20"
                                        onKeyDown={(e) => e.key === 'Enter' && runSingleOcr()}
                                        min="1"
                                    />
                                </div>
                                <button
                                    onClick={runSingleOcr}
                                    disabled={singleLoading || !singleDocId}
                                    className="btn btn-primary flex items-center gap-2 shadow-lg shadow-primary-900/20"
                                >
                                    {singleLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
                                    Start
                                </button>
                            </div>

                            {singleError && (
                                <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-start gap-3">
                                    <XCircle className="w-5 h-5 text-red-400 mt-0.5" />
                                    <span className="text-red-200 text-sm">{singleError}</span>
                                </div>
                            )}

                            {singleLoading && (
                                <div className="py-12 text-center text-surface-400">
                                    <div className="relative mx-auto w-12 h-12 mb-4">
                                        <div className="absolute inset-0 border-4 border-surface-700 rounded-full"></div>
                                        <div className="absolute inset-0 border-4 border-primary-500 rounded-full border-t-transparent animate-spin"></div>
                                    </div>
                                    <p className="text-sm font-medium">Analysiere Dokument...</p>
                                </div>
                            )}

                            {singleResult && (
                                <div className="space-y-4 animate-in zoom-in-95 duration-300">
                                    <div className="p-4 rounded-xl bg-surface-700/30 border border-surface-600/50 backdrop-blur-sm">
                                        <div className="flex items-center justify-between mb-3">
                                            <h4 className="font-medium text-white max-w-[70%] truncate" title={singleResult.title}>
                                                {singleResult.title}
                                            </h4>
                                            <span className="text-xs font-mono text-surface-400 bg-surface-800/50 px-2 py-1 rounded">
                                                ID: {singleResult.document_id}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2 text-xs text-surface-400 bg-surface-900/30 p-2 rounded-lg">
                                            <span className={clsx(singleResult.new_length > singleResult.old_length ? 'text-emerald-400' : 'text-amber-400')}>
                                                {((singleResult.new_length / Math.max(1, singleResult.old_length)) * 100).toFixed(0)}%
                                            </span>
                                            <span>Textumfang ({singleResult.old_length} → {singleResult.new_length} Zeichen)</span>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4 h-64">
                                        <div className="flex flex-col h-full">
                                            <span className="text-xs font-uppercase text-surface-400 mb-2 pl-1">Original OCR</span>
                                            <div className="flex-1 rounded-xl bg-surface-900/50 border border-surface-700/50 p-3 overflow-y-auto text-xs font-mono text-surface-400 custom-scrollbar">
                                                {singleResult.old_content || <span className="italic opacity-50">Leer</span>}
                                            </div>
                                        </div>
                                        <div className="flex flex-col h-full">
                                            <span className="text-xs font-uppercase text-emerald-400/80 mb-2 pl-1">Ollama Vision OCR</span>
                                            <div className="flex-1 rounded-xl bg-surface-900/50 border border-emerald-500/20 p-3 overflow-y-auto text-xs font-mono text-emerald-300/90 custom-scrollbar">
                                                {singleResult.new_content || <span className="italic opacity-50">Leer</span>}
                                            </div>
                                        </div>
                                    </div>

                                    <button
                                        onClick={applySingleResult}
                                        disabled={applying || applied || !singleResult.new_content}
                                        className={clsx(
                                            'w-full btn py-3 flex justify-center items-center gap-2 shadow-lg transition-all',
                                            applied
                                                ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 cursor-default'
                                                : 'btn-primary'
                                        )}
                                    >
                                        {applying ? (
                                            <Loader2 className="w-5 h-5 animate-spin" />
                                        ) : applied ? (
                                            <>
                                                <CheckCircle2 className="w-5 h-5" />
                                                <span>Erfolgreich gespeichert</span>
                                            </>
                                        ) : (
                                            <>
                                                <ArrowRightLeft className="w-5 h-5" />
                                                <span>Neuen Text übernehmen</span>
                                            </>
                                        )}
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* ========== BATCH OCR SECTION ========== */}
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
                            {batchStatus && (batchRunning || batchStatus.total > 0) && (
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
                                    </div>

                                    <div className="rounded-xl bg-black/40 border border-surface-700/50 p-4 font-mono text-xs h-64 overflow-y-auto custom-scrollbar shadow-inner">
                                        {batchStatus.log.map((entry, i) => (
                                            <div key={i} className={clsx(
                                                'py-1 border-l-2 pl-2 mb-1',
                                                entry.includes('pausiert') ? 'border-amber-500 text-amber-400' :
                                                    entry.startsWith('✅') ? 'border-emerald-500 text-emerald-400' :
                                                        entry.startsWith('❌') ? 'border-red-500 text-red-400' :
                                                            entry.startsWith('⚠️') ? 'border-amber-500 text-amber-400' :
                                                                entry.startsWith('🔄') ? 'border-blue-500 text-blue-400' :
                                                                    'border-surface-700 text-surface-400'
                                            )}>
                                                {entry}
                                            </div>
                                        ))}
                                        <div ref={logEndRef} />
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
        </div>
    )
}

// Icons
function HashIcon(props: any) {
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
            <line x1="4" y1="9" x2="20" y2="9" />
            <line x1="4" y1="15" x2="20" y2="15" />
            <line x1="10" y1="3" x2="8" y2="21" />
            <line x1="16" y1="3" x2="14" y2="21" />
        </svg>
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
