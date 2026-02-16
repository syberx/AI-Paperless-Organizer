import { useState, useEffect, useRef, useCallback } from 'react'
import {
    FlaskConical,
    Play,
    Loader2,
    Clock,
    FileText,
    Trophy,
    AlertCircle,
    ChevronDown,
    ChevronUp,
    Check,
    Sparkles,
    ShieldAlert,
    Star,
    Zap,
    ThumbsUp,
    ThumbsDown
} from 'lucide-react'
import clsx from 'clsx'
import * as api from '../services/api'

export default function OcrCompare() {
    const [docId, setDocId] = useState('')
    const [page, setPage] = useState(1)
    const [availableModels, setAvailableModels] = useState<string[]>([])
    const [currentModel, setCurrentModel] = useState('')
    const [selectedModels, setSelectedModels] = useState<string[]>([])
    const [loadingModels, setLoadingModels] = useState(false)
    const [running, setRunning] = useState(false)
    const [status, setStatus] = useState<api.OcrCompareStatus | null>(null)
    const [result, setResult] = useState<api.OcrCompareResponse | null>(null)
    const [error, setError] = useState('')
    const [expandedResults, setExpandedResults] = useState<Set<number>>(new Set())
    const [showModelPicker, setShowModelPicker] = useState(false)
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
    
    // Evaluation state
    const [evaluating, setEvaluating] = useState(false)
    const [evaluation, setEvaluation] = useState<api.OcrEvaluateResponse | null>(null)
    const [evalError, setEvalError] = useState('')
    const [showEvalWarning, setShowEvalWarning] = useState(false)
    const [evalModel, setEvalModel] = useState('')  // Override model for evaluation

    useEffect(() => {
        loadModels()
        return () => { if (pollRef.current) clearInterval(pollRef.current) }
    }, [])

    const loadModels = async () => {
        setLoadingModels(true)
        try {
            const data = await api.getOllamaModels()
            setAvailableModels(data.models)
            setCurrentModel(data.current_model)
            if (data.current_model && data.models.includes(data.current_model)) {
                setSelectedModels([data.current_model])
            }
        } catch (e: any) {
            setError('Modelle konnten nicht geladen werden: ' + e.message)
        } finally {
            setLoadingModels(false)
        }
    }

    const toggleModel = (model: string) => {
        setSelectedModels(prev => {
            if (prev.includes(model)) {
                return prev.filter(m => m !== model)
            }
            if (prev.length >= 5) return prev
            return [...prev, model]
        })
    }

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
                const s = await api.getOcrCompareStatus()
                setStatus(s)
                
                if (!s.running && (s.phase === 'done' || s.phase === 'error')) {
                    stopPolling()
                    setRunning(false)
                    
                    if (s.phase === 'done') {
                        setResult({
                            document_id: s.document_id,
                            title: s.title,
                            total_pages: s.total_pages,
                            compared_page: s.compared_page,
                            old_content: s.old_content,
                            results: s.results
                        })
                        setExpandedResults(new Set(s.results.map((_: any, i: number) => i)))
                    } else if (s.error) {
                        setError(s.error)
                    }
                }
            } catch {}
        }, 1000)
    }, [stopPolling])

    const startCompare = async () => {
        const id = parseInt(docId)
        if (isNaN(id) || id <= 0) {
            setError('Bitte eine gültige Dokument-ID eingeben')
            return
        }
        if (selectedModels.length === 0) {
            setError('Bitte mindestens ein Modell auswählen')
            return
        }

        setRunning(true)
        setError('')
        setResult(null)
        setStatus(null)
        setEvaluation(null)
        setExpandedResults(new Set())

        try {
            await api.startOcrCompare(id, selectedModels, page)
            startPolling()
        } catch (e: any) {
            setError(e.message || 'Vergleich konnte nicht gestartet werden')
            setRunning(false)
        }
    }

    const toggleExpand = (index: number) => {
        setExpandedResults(prev => {
            const next = new Set(prev)
            if (next.has(index)) next.delete(index)
            else next.add(index)
            return next
        })
    }

    const getBestModel = () => {
        if (!result || result.results.length === 0) return null
        const successful = result.results.filter(r => !r.error)
        if (successful.length === 0) return null
        return successful.reduce((best, r) =>
            r.chars > best.chars ? r : best
        )
    }

    const getFastestModel = () => {
        if (!result || result.results.length === 0) return null
        const successful = result.results.filter(r => !r.error && r.chars > 0)
        if (successful.length === 0) return null
        return successful.reduce((best, r) =>
            r.duration_seconds < best.duration_seconds ? r : best
        )
    }

    const getPhaseLabel = (phase: string) => {
        switch (phase) {
            case 'starting': return 'Starte...'
            case 'download': return 'Dokument herunterladen...'
            case 'convert': return 'PDF in Bilder konvertieren...'
            case 'health_check': return 'Ollama Health-Check...'
            case 'waiting_ollama': return 'Warte auf Ollama-Neustart...'
            case 'model_loading': return 'Modell wird geladen...'
            case 'ocr_page': return 'OCR läuft...'
            case 'unloading': return 'Modell wird entladen...'
            case 'done': return 'Fertig!'
            case 'error': return 'Fehler!'
            default: return phase
        }
    }

    const EVAL_MODELS = [
        { id: '', label: 'Standard (konfiguriertes Modell)' },
        { id: 'gpt-4.1', label: 'GPT-4.1 (OpenAI, sehr stark)' },
        { id: 'gpt-4o', label: 'GPT-4o (OpenAI, schnell)' },
        { id: 'gpt-4o-mini', label: 'GPT-4o Mini (OpenAI, günstig)' },
        { id: 'o3', label: 'o3 (OpenAI, Reasoning)' },
        { id: 'o4-mini', label: 'o4-mini (OpenAI, Reasoning günstig)' },
    ]

    const getSeverityColor = (severity: string) => {
        switch (severity) {
            case 'critical': return 'bg-red-500/20 text-red-300 border-red-500/30'
            case 'high': return 'bg-orange-500/20 text-orange-300 border-orange-500/30'
            case 'medium': return 'bg-amber-500/20 text-amber-300 border-amber-500/30'
            case 'low': return 'bg-surface-700/50 text-surface-400 border-surface-600/50'
            default: return 'bg-surface-700/50 text-surface-400 border-surface-600/50'
        }
    }

    const getSeverityLabel = (severity: string) => {
        switch (severity) {
            case 'critical': return 'KRITISCH'
            case 'high': return 'HOCH'
            case 'medium': return 'MITTEL'
            case 'low': return 'NIEDRIG'
            default: return severity
        }
    }

    const getCategoryLabel = (key: string) => {
        const labels: Record<string, string> = {
            names_persons: 'Namen & Personen',
            dates_periods: 'Datum & Zeitraum',
            iban_banking: 'IBAN & Bankdaten',
            amounts_numbers: 'Beträge & Zahlen',
            addresses: 'Adressen',
            form_logic: 'Formularlogik',
            completeness: 'Vollständigkeit',
            formatting: 'Formatierung',
            no_hallucinations: 'Keine Halluzinationen',
            automatizability: 'Automatisierbarkeit'
        }
        return labels[key] || key
    }

    const getCategoryBarColor = (score: number) => {
        if (score >= 8) return 'bg-emerald-500'
        if (score >= 6) return 'bg-amber-500'
        if (score >= 4) return 'bg-orange-500'
        return 'bg-red-500'
    }

    const startEvaluation = async () => {
        if (!result) return
        setShowEvalWarning(false)
        setEvaluating(true)
        setEvalError('')
        setEvaluation(null)

        try {
            const successfulResults = result.results.filter(r => !r.error && r.chars > 0)
            if (successfulResults.length === 0) {
                setEvalError('Keine erfolgreichen OCR-Ergebnisse zum Auswerten')
                return
            }
            const data = await api.evaluateOcrResults(result.title, successfulResults, evalModel || undefined)
            setEvaluation(data)
        } catch (e: any) {
            setEvalError(e.message || 'Auswertung fehlgeschlagen')
        } finally {
            setEvaluating(false)
        }
    }

    const getScoreColor = (score: number) => {
        if (score >= 80) return 'text-emerald-400'
        if (score >= 60) return 'text-amber-400'
        return 'text-red-400'
    }

    const bestModel = getBestModel()
    const fastestModel = getFastestModel()

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header Card */}
            <div className="card p-0 overflow-hidden border border-surface-700/50 shadow-xl shadow-black/20 bg-surface-800/40 backdrop-blur-sm">
                <div className="p-6 border-b border-surface-700/50 bg-surface-800/50">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-violet-500/20 rounded-lg">
                            <FlaskConical className="w-5 h-5 text-violet-400" />
                        </div>
                        <div>
                            <h3 className="font-bold text-lg text-white">OCR Modell-Vergleich</h3>
                            <p className="text-sm text-surface-400">
                                Teste verschiedene Ollama-Modelle auf demselben Dokument
                            </p>
                        </div>
                    </div>
                </div>

                <div className="p-6 space-y-5">
                    {/* Document ID + Page Input */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="sm:col-span-2">
                            <label className="text-xs font-medium text-surface-400 ml-1 mb-1 block">
                                Dokument-ID
                            </label>
                            <input
                                type="number"
                                value={docId}
                                onChange={(e) => setDocId(e.target.value)}
                                placeholder="z.B. 42"
                                className="w-full input bg-surface-900/50 border-surface-700 focus:border-violet-500 text-lg"
                                disabled={running}
                                min={1}
                            />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-surface-400 ml-1 mb-1 block">
                                Seite (0 = alle)
                            </label>
                            <input
                                type="number"
                                value={page}
                                onChange={(e) => setPage(parseInt(e.target.value) || 0)}
                                placeholder="1"
                                className="w-full input bg-surface-900/50 border-surface-700 focus:border-violet-500 text-lg"
                                disabled={running}
                                min={0}
                            />
                        </div>
                    </div>

                    {/* Model Picker */}
                    <div>
                        <label className="text-xs font-medium text-surface-400 ml-1 mb-2 block">
                            Modelle auswählen (max. 5)
                        </label>

                        {loadingModels ? (
                            <div className="flex items-center gap-2 text-surface-400 text-sm py-4">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Lade verfügbare Modelle...
                            </div>
                        ) : availableModels.length === 0 ? (
                            <div className="text-amber-400 text-sm py-2">
                                Keine Modelle gefunden. Ist Ollama erreichbar?
                            </div>
                        ) : (
                            <div>
                                <button
                                    onClick={() => setShowModelPicker(!showModelPicker)}
                                    className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-surface-900/50 border border-surface-700 hover:border-violet-500/50 transition-colors"
                                    disabled={running}
                                >
                                    <span className="text-sm text-surface-300">
                                        {selectedModels.length === 0
                                            ? 'Modelle auswählen...'
                                            : `${selectedModels.length} Modell${selectedModels.length > 1 ? 'e' : ''} ausgewählt`
                                        }
                                    </span>
                                    {showModelPicker
                                        ? <ChevronUp className="w-4 h-4 text-surface-500" />
                                        : <ChevronDown className="w-4 h-4 text-surface-500" />
                                    }
                                </button>

                                {showModelPicker && (
                                    <div className="mt-2 p-2 rounded-xl bg-surface-900/80 border border-surface-700 max-h-64 overflow-y-auto custom-scrollbar animate-in fade-in slide-in-from-top-2 duration-200">
                                        {availableModels.map((model) => {
                                            const isSelected = selectedModels.includes(model)
                                            const isCurrent = model === currentModel
                                            return (
                                                <button
                                                    key={model}
                                                    onClick={() => toggleModel(model)}
                                                    disabled={running || (!isSelected && selectedModels.length >= 5)}
                                                    className={clsx(
                                                        'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all text-sm',
                                                        isSelected
                                                            ? 'bg-violet-500/20 text-violet-200 border border-violet-500/30'
                                                            : 'text-surface-300 hover:bg-surface-800 hover:text-white border border-transparent',
                                                        !isSelected && selectedModels.length >= 5 && 'opacity-40 cursor-not-allowed'
                                                    )}
                                                >
                                                    <div className={clsx(
                                                        'w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-colors',
                                                        isSelected
                                                            ? 'bg-violet-500 border-violet-500'
                                                            : 'border-surface-600'
                                                    )}>
                                                        {isSelected && <Check className="w-3.5 h-3.5 text-white" />}
                                                    </div>
                                                    <span className="font-mono text-sm truncate">{model}</span>
                                                    {isCurrent && (
                                                        <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex-shrink-0">
                                                            aktiv
                                                        </span>
                                                    )}
                                                </button>
                                            )
                                        })}
                                    </div>
                                )}

                                {/* Selected tags */}
                                {selectedModels.length > 0 && (
                                    <div className="flex flex-wrap gap-2 mt-3">
                                        {selectedModels.map((model, i) => (
                                            <span
                                                key={model}
                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-500/15 text-violet-200 text-xs font-mono border border-violet-500/30"
                                            >
                                                <span className="w-4 h-4 rounded-full bg-violet-500/30 text-[10px] font-bold flex items-center justify-center text-violet-300">
                                                    {i + 1}
                                                </span>
                                                {model}
                                                {!running && (
                                                    <button
                                                        onClick={() => toggleModel(model)}
                                                        className="ml-1 text-violet-400 hover:text-white transition-colors"
                                                    >
                                                        ×
                                                    </button>
                                                )}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Error */}
                    {error && (
                        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm flex items-center gap-2">
                            <AlertCircle className="w-4 h-4 flex-shrink-0" />
                            {error}
                        </div>
                    )}

                    {/* Start Button */}
                    <button
                        onClick={startCompare}
                        disabled={running || selectedModels.length === 0 || !docId}
                        className="w-full btn py-4 flex justify-center items-center gap-2 shadow-lg text-lg font-medium bg-violet-600 hover:bg-violet-700 text-white border-0 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {running ? (
                            <>
                                <Loader2 className="w-5 h-5 animate-spin" />
                                Vergleich läuft...
                            </>
                        ) : (
                            <>
                                <Play className="w-5 h-5 fill-current" />
                                Vergleich starten ({selectedModels.length} Modell{selectedModels.length !== 1 ? 'e' : ''})
                            </>
                        )}
                    </button>

                    {/* Live Progress */}
                    {running && status && (
                        <div className="space-y-4 p-4 rounded-xl bg-surface-900/50 border border-violet-500/30 animate-in fade-in duration-200">
                            {/* Progress bar */}
                            <div>
                                <div className="flex justify-between text-xs text-surface-400 mb-2 font-medium">
                                    <span>Modell {status.current_model_index + 1} / {status.total_models}</span>
                                    <span>{status.elapsed_seconds}s</span>
                                </div>
                                <div className="h-2.5 rounded-full bg-surface-900 overflow-hidden ring-1 ring-surface-700">
                                    <div
                                        className="h-full rounded-full bg-gradient-to-r from-violet-600 to-violet-400 transition-all duration-500 relative"
                                        style={{ width: `${status.total_models > 0 ? Math.round(((status.current_model_index + (status.phase === 'ocr_page' ? 0.5 : 0)) / status.total_models) * 100) : 0}%` }}
                                    >
                                        <div className="absolute inset-0 bg-white/20 animate-[shimmer_2s_infinite]" />
                                    </div>
                                </div>
                            </div>

                            {/* Current action */}
                            <div className="flex items-center gap-3">
                                <Loader2 className="w-4 h-4 animate-spin text-violet-400 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-white truncate">
                                        {status.current_model || 'Vorbereitung...'}
                                    </p>
                                    <p className="text-xs text-surface-400">
                                        {getPhaseLabel(status.phase)}
                                        {status.phase === 'ocr_page' && status.total_pages > 0 && (
                                            <> Seite {status.current_page}/{status.total_pages}</>
                                        )}
                                    </p>
                                </div>
                            </div>

                            {/* Model pipeline */}
                            <div className="flex flex-wrap gap-2">
                                {status.models.map((m, i) => {
                                    const isDone = i < status.results.length
                                    const isCurrent = i === status.current_model_index && status.running
                                    const result = status.results[i]
                                    return (
                                        <div
                                            key={m}
                                            className={clsx(
                                                'px-3 py-1.5 rounded-lg text-xs font-mono border transition-all',
                                                isDone
                                                    ? result?.error
                                                        ? 'bg-red-500/15 border-red-500/30 text-red-300'
                                                        : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                                                    : isCurrent
                                                        ? 'bg-violet-500/20 border-violet-500/40 text-violet-200 ring-1 ring-violet-500/30'
                                                        : 'bg-surface-800/50 border-surface-700/50 text-surface-500'
                                            )}
                                        >
                                            {isDone && !result?.error && <span className="mr-1">&#10003;</span>}
                                            {isDone && result?.error && <span className="mr-1">&#10007;</span>}
                                            {isCurrent && <span className="mr-1 inline-block animate-pulse">&#9679;</span>}
                                            {m}
                                            {isDone && result && !result.error && (
                                                <span className="ml-1.5 text-surface-500">
                                                    {result.duration_seconds}s
                                                </span>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Results */}
            {result && (
                <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    {/* Summary Header */}
                    <div className="card p-4 border border-surface-700/50 bg-surface-800/40">
                        <div className="flex flex-wrap items-center gap-4 text-sm">
                            <div className="flex items-center gap-2 text-surface-300">
                                <FileText className="w-4 h-4 text-surface-500" />
                                <span className="font-medium text-white">{result.title}</span>
                                <span className="text-surface-500">(ID: {result.document_id})</span>
                            </div>
                            <div className="text-surface-500">
                                {result.total_pages} Seite{result.total_pages !== 1 ? 'n' : ''}
                                {result.compared_page > 0 && ` (Seite ${result.compared_page} getestet)`}
                            </div>
                        </div>

                        {/* Winner badges */}
                        {result.results.length > 1 && (bestModel || fastestModel) && (
                            <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t border-surface-700/50">
                                {bestModel && (
                                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30">
                                        <Trophy className="w-4 h-4 text-amber-400" />
                                        <span className="text-xs text-amber-200">
                                            Meiste Zeichen: <span className="font-mono font-bold">{bestModel.model}</span> ({bestModel.chars})
                                        </span>
                                    </div>
                                )}
                                {fastestModel && (
                                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                                        <Clock className="w-4 h-4 text-emerald-400" />
                                        <span className="text-xs text-emerald-200">
                                            Schnellstes: <span className="font-mono font-bold">{fastestModel.model}</span> ({fastestModel.duration_seconds}s)
                                        </span>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Model Results Grid */}
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                        {result.results.map((r, i) => {
                            const isBest = bestModel?.model === r.model
                            const isFastest = fastestModel?.model === r.model
                            const isExpanded = expandedResults.has(i)

                            return (
                                <div
                                    key={i}
                                    className={clsx(
                                        'card p-0 overflow-hidden border shadow-lg transition-all',
                                        r.error
                                            ? 'border-red-500/30 bg-red-950/20'
                                            : isBest
                                                ? 'border-amber-500/40 bg-surface-800/60 ring-1 ring-amber-500/20'
                                                : 'border-surface-700/50 bg-surface-800/40'
                                    )}
                                >
                                    {/* Model Header */}
                                    <div className="p-4 border-b border-surface-700/50 bg-surface-800/50">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <span className="w-6 h-6 rounded-full bg-violet-500/30 text-xs font-bold flex items-center justify-center text-violet-300">
                                                    {i + 1}
                                                </span>
                                                <span className="font-mono font-bold text-white text-sm">
                                                    {r.model}
                                                </span>
                                                {isBest && result.results.length > 1 && (
                                                    <Trophy className="w-4 h-4 text-amber-400" />
                                                )}
                                                {isFastest && !isBest && result.results.length > 1 && (
                                                    <Clock className="w-4 h-4 text-emerald-400" />
                                                )}
                                            </div>
                                            <button
                                                onClick={() => toggleExpand(i)}
                                                className="text-surface-500 hover:text-white transition-colors"
                                            >
                                                {isExpanded
                                                    ? <ChevronUp className="w-4 h-4" />
                                                    : <ChevronDown className="w-4 h-4" />
                                                }
                                            </button>
                                        </div>

                                        {/* Stats Row */}
                                        <div className="flex flex-wrap gap-4 mt-2 text-xs">
                                            <div className={clsx(
                                                'flex items-center gap-1',
                                                isFastest && result.results.length > 1 ? 'text-emerald-300' : 'text-surface-400'
                                            )}>
                                                <Clock className="w-3.5 h-3.5" />
                                                <span className="font-mono font-bold text-sm">{r.duration_seconds}s</span>
                                            </div>
                                            <div className={clsx(
                                                'flex items-center gap-1',
                                                isBest && result.results.length > 1 ? 'text-amber-300' : 'text-surface-400'
                                            )}>
                                                <FileText className="w-3.5 h-3.5" />
                                                <span className="font-mono font-bold text-sm">
                                                    {r.chars.toLocaleString()} Zeichen
                                                </span>
                                            </div>
                                            <div className="text-surface-500">
                                                {r.pages_processed} Seite{r.pages_processed !== 1 ? 'n' : ''}
                                            </div>
                                            {!r.error && r.chars > 0 && (
                                                <div className="text-surface-500">
                                                    ~{Math.round(r.chars / r.duration_seconds)} Zeichen/s
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Text Content */}
                                    {isExpanded && (
                                        <div className="p-4 animate-in fade-in duration-200">
                                            {r.error ? (
                                                <div className="p-3 rounded-lg bg-red-500/10 text-red-300 text-sm">
                                                    Fehler: {r.error}
                                                </div>
                                            ) : (
                                                <div className="relative">
                                                    <pre className="whitespace-pre-wrap font-mono text-xs text-surface-300 max-h-96 overflow-y-auto custom-scrollbar p-3 rounded-lg bg-black/30 border border-surface-700/50 leading-relaxed">
                                                        {r.text || '(Kein Text erkannt)'}
                                                    </pre>
                                                    <button
                                                        onClick={() => navigator.clipboard.writeText(r.text)}
                                                        className="absolute top-2 right-2 px-2 py-1 rounded-md bg-surface-700/80 text-surface-400 hover:text-white text-xs transition-colors"
                                                        title="Text kopieren"
                                                    >
                                                        Kopieren
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>

                    {/* Original Content for reference */}
                    {result.old_content && (
                        <div className="card p-0 overflow-hidden border border-surface-700/50 bg-surface-800/40">
                            <button
                                onClick={() => {
                                    const el = document.getElementById('original-content')
                                    if (el) el.classList.toggle('hidden')
                                }}
                                className="w-full p-4 flex items-center justify-between text-left hover:bg-surface-800/50 transition-colors"
                            >
                                <div className="flex items-center gap-2 text-sm text-surface-400">
                                    <FileText className="w-4 h-4" />
                                    Originaler Paperless-Text ({result.old_content.length.toLocaleString()} Zeichen)
                                </div>
                                <ChevronDown className="w-4 h-4 text-surface-500" />
                            </button>
                            <div id="original-content" className="hidden p-4 border-t border-surface-700/50">
                                <pre className="whitespace-pre-wrap font-mono text-xs text-surface-400 max-h-64 overflow-y-auto custom-scrollbar p-3 rounded-lg bg-black/30 border border-surface-700/50 leading-relaxed">
                                    {result.old_content || '(Kein Text vorhanden)'}
                                </pre>
                            </div>
                        </div>
                    )}

                    {/* === KI-Qualitätsbewertung === */}
                    {!evaluation && !evaluating && (
                        <div className="card p-0 overflow-hidden border border-orange-500/30 bg-surface-800/40">
                            {!showEvalWarning ? (
                                <button
                                    onClick={() => setShowEvalWarning(true)}
                                    disabled={evaluating}
                                    className="w-full p-5 flex items-center justify-center gap-3 text-left hover:bg-orange-500/5 transition-colors group"
                                >
                                    <div className="p-2 bg-orange-500/20 rounded-lg group-hover:bg-orange-500/30 transition-colors">
                                        <Sparkles className="w-5 h-5 text-orange-400" />
                                    </div>
                                    <div>
                                        <p className="font-bold text-white text-sm">KI-Qualitätsbewertung (Cloud API)</p>
                                        <p className="text-xs text-surface-400">
                                            OCR-Ergebnisse von einem großen Sprachmodell auswerten lassen
                                        </p>
                                    </div>
                                </button>
                            ) : (
                                <div className="p-5 space-y-4 animate-in fade-in duration-200">
                                    <div className="flex items-start gap-3 p-4 rounded-xl bg-orange-500/10 border border-orange-500/30">
                                        <ShieldAlert className="w-6 h-6 text-orange-400 flex-shrink-0 mt-0.5" />
                                        <div className="space-y-2">
                                            <p className="font-bold text-orange-200 text-sm">Datenschutz-Hinweis</p>
                                            <p className="text-xs text-orange-200/80 leading-relaxed">
                                                Die OCR-Texte werden an den konfigurierten externen LLM-Provider
                                                (z.B. OpenAI, Anthropic) gesendet. Der Dokumenteninhalt verlässt
                                                damit dein lokales Netzwerk.
                                            </p>
                                        </div>
                                    </div>

                                    {/* Model Override Selector */}
                                    <div>
                                        <label className="text-xs font-medium text-surface-400 ml-1 mb-1 block">
                                            Auswertungsmodell (stärkeres Modell = bessere Analyse)
                                        </label>
                                        <select
                                            value={evalModel}
                                            onChange={(e) => setEvalModel(e.target.value)}
                                            className="w-full input bg-surface-900/50 border-surface-700 focus:border-orange-500 text-sm"
                                        >
                                            {EVAL_MODELS.map(m => (
                                                <option key={m.id} value={m.id}>{m.label}</option>
                                            ))}
                                        </select>
                                    </div>

                                    <div className="flex gap-3">
                                        <button
                                            onClick={startEvaluation}
                                            className="flex-1 btn py-3 flex justify-center items-center gap-2 bg-orange-600 hover:bg-orange-700 text-white border-0 font-medium"
                                        >
                                            <Sparkles className="w-4 h-4" />
                                            Auswertung starten
                                        </button>
                                        <button
                                            onClick={() => setShowEvalWarning(false)}
                                            className="btn py-3 px-6 bg-surface-700 hover:bg-surface-600 text-surface-300 border-0"
                                        >
                                            Abbrechen
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Evaluation Loading */}
                    {evaluating && (
                        <div className="card p-6 border border-orange-500/30 bg-surface-800/40 animate-in fade-in duration-200">
                            <div className="flex items-center gap-3">
                                <Loader2 className="w-5 h-5 animate-spin text-orange-400" />
                                <div>
                                    <p className="font-bold text-white text-sm">KI analysiert OCR-Ergebnisse...</p>
                                    <p className="text-xs text-surface-400">
                                        Die Texte werden an den Cloud-Provider gesendet. Das kann einige Sekunden dauern.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Evaluation Error */}
                    {evalError && (
                        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm flex items-center gap-2">
                            <AlertCircle className="w-4 h-4 flex-shrink-0" />
                            {evalError}
                        </div>
                    )}

                    {/* Evaluation Results */}
                    {evaluation?.evaluation && (
                        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            {/* Eval Header + Recommendation */}
                            <div className="card p-0 overflow-hidden border border-orange-500/30 bg-surface-800/40">
                                <div className="p-4 border-b border-surface-700/50 bg-orange-500/5">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <Sparkles className="w-5 h-5 text-orange-400" />
                                            <span className="font-bold text-white text-sm">KI-Qualitätsbewertung</span>
                                        </div>
                                        <span className="text-[10px] px-2 py-1 rounded-full bg-surface-700/50 text-surface-400 font-mono">
                                            {evaluation.provider} / {evaluation.model}
                                        </span>
                                    </div>
                                </div>

                                {/* Recommendation */}
                                <div className="p-4 border-b border-surface-700/50">
                                    <p className="text-sm text-surface-200 leading-relaxed">
                                        {evaluation.evaluation.recommendation || evaluation.evaluation.summary}
                                    </p>

                                    {/* Critical Finding */}
                                    {evaluation.evaluation.critical_finding && (
                                        <div className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30 flex items-start gap-2">
                                            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                                            <p className="text-xs text-red-200 font-medium">
                                                {evaluation.evaluation.critical_finding}
                                            </p>
                                        </div>
                                    )}

                                    <div className="flex flex-wrap gap-3 mt-3">
                                        {(evaluation.evaluation.best_quality || evaluation.evaluation.best_model) && (
                                            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30">
                                                <Trophy className="w-4 h-4 text-amber-400" />
                                                <span className="text-xs text-amber-200">
                                                    Beste Qualität: <strong className="font-mono">{evaluation.evaluation.best_quality || evaluation.evaluation.best_model}</strong>
                                                </span>
                                            </div>
                                        )}
                                        {evaluation.evaluation.best_speed && (
                                            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                                                <Clock className="w-4 h-4 text-emerald-400" />
                                                <span className="text-xs text-emerald-200">
                                                    Schnellstes: <strong className="font-mono">{evaluation.evaluation.best_speed}</strong>
                                                </span>
                                            </div>
                                        )}
                                        {evaluation.evaluation.best_value && (
                                            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-500/10 border border-violet-500/30">
                                                <Zap className="w-4 h-4 text-violet-400" />
                                                <span className="text-xs text-violet-200">
                                                    Bestes P/L: <strong className="font-mono">{evaluation.evaluation.best_value}</strong>
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Cross-comparison */}
                                {evaluation.evaluation.cross_comparison && (
                                    <div className="p-4 border-b border-surface-700/50 grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        {evaluation.evaluation.cross_comparison.agreement && evaluation.evaluation.cross_comparison.agreement.length > 0 && (
                                            <div>
                                                <p className="text-[10px] font-medium text-emerald-400 uppercase tracking-wider mb-2">Alle Versionen stimmen überein:</p>
                                                <div className="space-y-1">
                                                    {evaluation.evaluation.cross_comparison.agreement.map((item, i) => (
                                                        <div key={i} className="text-xs text-emerald-300 flex items-start gap-1.5">
                                                            <Check className="w-3 h-3 mt-0.5 flex-shrink-0" />
                                                            <span>{item}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        {evaluation.evaluation.cross_comparison.disagreement && evaluation.evaluation.cross_comparison.disagreement.length > 0 && (
                                            <div>
                                                <p className="text-[10px] font-medium text-red-400 uppercase tracking-wider mb-2">Widersprüche (mind. ein Fehler):</p>
                                                <div className="space-y-1">
                                                    {evaluation.evaluation.cross_comparison.disagreement.map((item, i) => (
                                                        <div key={i} className="text-xs text-red-300 flex items-start gap-1.5">
                                                            <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                                                            <span>{item}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Detailed Model Rankings */}
                            {evaluation.evaluation.ranking
                                .sort((a, b) => a.rank - b.rank)
                                .map((entry) => (
                                    <div
                                        key={entry.model}
                                        className={clsx(
                                            'card p-0 overflow-hidden border shadow-lg transition-all',
                                            entry.rank === 1
                                                ? 'border-amber-500/40 bg-surface-800/60 ring-1 ring-amber-500/20'
                                                : 'border-surface-700/50 bg-surface-800/40'
                                        )}
                                    >
                                        {/* Header with score */}
                                        <div className="p-4 border-b border-surface-700/50 bg-surface-800/50">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <span className={clsx(
                                                        'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold',
                                                        entry.rank === 1 ? 'bg-amber-500 text-white' :
                                                        entry.rank === 2 ? 'bg-surface-500 text-white' :
                                                        'bg-surface-700 text-surface-300'
                                                    )}>
                                                        {entry.rank}
                                                    </span>
                                                    <span className="font-mono font-bold text-white">{entry.model}</span>
                                                    {entry.rank === 1 && <Star className="w-4 h-4 text-amber-400 fill-amber-400" />}
                                                </div>
                                                <span className={clsx('text-3xl font-bold font-mono', getScoreColor(entry.overall_score))}>
                                                    {entry.overall_score}
                                                </span>
                                            </div>
                                            {entry.verdict && (
                                                <p className="mt-2 text-xs text-surface-300 italic">{entry.verdict}</p>
                                            )}
                                        </div>

                                        <div className="p-4 space-y-4">
                                            {/* Category Score Bars */}
                                            {entry.category_scores && (
                                                <div className="space-y-1.5">
                                                    <p className="text-[10px] font-medium text-surface-500 uppercase tracking-wider mb-2">Detailbewertung (0-10)</p>
                                                    {Object.entries(entry.category_scores).map(([key, score]) => (
                                                        <div key={key} className="flex items-center gap-2">
                                                            <span className="text-[11px] text-surface-400 w-32 truncate">{getCategoryLabel(key)}</span>
                                                            <div className="flex-1 h-2 rounded-full bg-surface-900 overflow-hidden">
                                                                <div
                                                                    className={clsx('h-full rounded-full transition-all duration-700', getCategoryBarColor(score as number))}
                                                                    style={{ width: `${((score as number) / 10) * 100}%` }}
                                                                />
                                                            </div>
                                                            <span className={clsx('text-xs font-mono w-6 text-right font-bold', getScoreColor((score as number) * 10))}>
                                                                {score as number}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            {/* Strengths & Weaknesses */}
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                {entry.strengths && entry.strengths.length > 0 && (
                                                    <div className="space-y-1.5">
                                                        <p className="text-[10px] font-medium text-emerald-400 uppercase tracking-wider">Stärken</p>
                                                        {entry.strengths.map((s, si) => (
                                                            <div key={si} className="flex items-start gap-1.5 text-xs text-emerald-300">
                                                                <ThumbsUp className="w-3 h-3 mt-0.5 flex-shrink-0" />
                                                                <span>{s}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                                {entry.weaknesses && entry.weaknesses.length > 0 && (
                                                    <div className="space-y-1.5">
                                                        <p className="text-[10px] font-medium text-red-400 uppercase tracking-wider">Schwächen</p>
                                                        {entry.weaknesses.map((w, wi) => (
                                                            <div key={wi} className="flex items-start gap-1.5 text-xs text-red-300">
                                                                <ThumbsDown className="w-3 h-3 mt-0.5 flex-shrink-0" />
                                                                <span>{w}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>

                                            {/* Specific Errors with severity */}
                                            {entry.specific_errors && entry.specific_errors.length > 0 && (
                                                <div>
                                                    <p className="text-[10px] font-medium text-red-400 uppercase tracking-wider mb-2">Erkannte Fehler</p>
                                                    <div className="space-y-1.5">
                                                        {entry.specific_errors.map((err, ei) => (
                                                            <div key={ei} className={clsx('flex items-start gap-2 px-3 py-2 rounded-lg border text-xs', getSeverityColor(err.severity))}>
                                                                <span className="font-bold text-[10px] uppercase px-1.5 py-0.5 rounded bg-black/20 flex-shrink-0">
                                                                    {getSeverityLabel(err.severity)}
                                                                </span>
                                                                <div className="flex-1 min-w-0">
                                                                    <span className="font-medium">{err.field}:</span>{' '}
                                                                    <span className="text-surface-400">erwartet</span>{' '}
                                                                    <span className="font-mono">"{err.expected}"</span>{' '}
                                                                    <span className="text-surface-400">bekam</span>{' '}
                                                                    <span className="font-mono">"{err.got}"</span>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}

                            {/* Re-evaluate button */}
                            <button
                                onClick={() => { setEvaluation(null); setShowEvalWarning(false) }}
                                className="w-full btn py-3 flex justify-center items-center gap-2 bg-surface-700 hover:bg-surface-600 text-surface-300 border-0 text-sm"
                            >
                                <Sparkles className="w-4 h-4" />
                                Neue Auswertung starten
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
