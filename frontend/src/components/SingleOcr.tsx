import { useState, useEffect, useRef } from 'react'
import {
    FileSearch,
    Play,
    Loader2,
    CheckCircle2,
    XCircle,
    ArrowRightLeft,
    FileText,
    AlertTriangle,
} from 'lucide-react'
import clsx from 'clsx'
import * as api from '../services/api'
import DocumentPreview from './DocumentPreview'

interface SingleOcrProps {
    initialDocId?: number | null
}

export default function SingleOcr({ initialDocId }: SingleOcrProps = {}) {
    const [docId, setDocId] = useState('')
    const autoStartTriggered = useRef(false)
    const [loading, setLoading] = useState(false)
    const [result, setResult] = useState<api.OcrResult | null>(null)
    const [error, setError] = useState('')
    const [applying, setApplying] = useState(false)
    const [applied, setApplied] = useState(false)
    const [setFinishTag, setSetFinishTag] = useState(true)
    const [forceOcr, setForceOcr] = useState(false)

    // Auto-start when initialDocId is passed (from Review queue "Recheck" button)
    useEffect(() => {
        if (initialDocId && !autoStartTriggered.current) {
            autoStartTriggered.current = true
            setDocId(String(initialDocId))
            setForceOcr(true)
            setResult(null)
            setError('')
            setApplied(false)
            // Small delay to let state update, then auto-start
            setTimeout(() => {
                runOcrForId(initialDocId)
            }, 100)
        }
    }, [initialDocId])

    // Reset trigger when initialDocId changes
    useEffect(() => {
        autoStartTriggered.current = false
    }, [initialDocId])

    const runOcrForId = async (id: number) => {
        setLoading(true)
        setResult(null)
        setError('')
        setApplied(false)
        try {
            const res = await api.ocrSingleDocument(id, true)
            setResult(res)
        } catch (e: any) {
            setError(e?.message || 'Unbekannter Fehler')
        } finally {
            setLoading(false)
        }
    }

    const runOcr = async () => {
        const id = parseInt(docId)
        if (isNaN(id)) return

        setLoading(true)
        setResult(null)
        setError('')
        setApplied(false)

        try {
            const res = await api.ocrSingleDocument(id, forceOcr)
            setResult(res)
        } catch (e: any) {
            setError(e?.message || 'Unbekannter Fehler')
        } finally {
            setLoading(false)
        }
    }

    const applyResult = async () => {
        if (!result) return
        setApplying(true)
        try {
            await api.applyOcrResult(result.document_id, result.new_content, setFinishTag)
            setApplied(true)
            // If this document was in the review queue, remove it silently
            try {
                await api.dismissReviewItem(result.document_id)
            } catch {
                // Not in review queue — that's fine
            }
        } catch (e: any) {
            setError(e?.message || 'Fehler beim Übertragen')
        } finally {
            setApplying(false)
        }
    }

    const ratio = result
        ? (result.old_length > 0 ? Math.round(result.new_length / result.old_length * 100) : 0)
        : 0

    const qualityWarning = result && result.old_length > 100 && result.new_length < result.old_length * 0.5

    return (
        <div className="space-y-8 pb-12">
            {/* Header */}
            <div>
                <h2 className="font-display text-3xl font-bold text-white flex items-center gap-3">
                    <div className="p-2 bg-gradient-to-br from-cyan-500 to-cyan-700 rounded-xl shadow-lg shadow-cyan-500/20">
                        <FileSearch className="w-8 h-8 text-white" />
                    </div>
                    Einzel-<span className="text-cyan-400">OCR</span>
                </h2>
                <p className="text-surface-400 mt-2 text-lg">
                    Einzelnes Dokument verarbeiten, alten und neuen Text vergleichen
                </p>
            </div>

            {/* Input */}
            <div className="card p-0 overflow-hidden border border-surface-700/50 shadow-xl shadow-black/20 bg-surface-800/40 backdrop-blur-sm">
                <div className="p-6 border-b border-surface-700/50 bg-surface-800/50">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-cyan-500/20 rounded-lg">
                            <FileText className="w-5 h-5 text-cyan-400" />
                        </div>
                        <div>
                            <h3 className="font-bold text-lg text-white">Dokument-ID</h3>
                            <p className="text-sm text-surface-400">Gib die Paperless Dokument-ID ein</p>
                        </div>
                    </div>
                </div>

                <div className="p-6">
                    <div className="flex gap-3">
                        <div className="relative flex-1">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-surface-500 font-mono text-sm">#</span>
                            <input
                                type="number"
                                value={docId}
                                onChange={(e) => setDocId(e.target.value)}
                                placeholder="z.B. 5702"
                                className="w-full input bg-surface-900/50 border-surface-700 focus:border-cyan-500 focus:ring-cyan-500/20 pl-8 font-mono text-lg"
                                onKeyDown={(e) => e.key === 'Enter' && runOcr()}
                            />
                        </div>
                        <button
                            onClick={runOcr}
                            disabled={loading || !docId}
                            className="btn bg-cyan-600 hover:bg-cyan-700 text-white flex items-center gap-2 px-8 shadow-lg shadow-cyan-900/20 disabled:opacity-50"
                        >
                            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5" />}
                            Start
                        </button>
                    </div>

                    <div className="flex items-center gap-6 mt-4">
                        <label className="flex items-center gap-2 cursor-pointer text-sm text-surface-400 hover:text-surface-200 transition-colors">
                            <input
                                type="checkbox"
                                checked={setFinishTag}
                                onChange={(e) => setSetFinishTag(e.target.checked)}
                                className="rounded bg-surface-700 border-surface-600 text-cyan-500 focus:ring-cyan-500/30"
                            />
                            <span>ocrfinish-Tag setzen</span>
                        </label>

                        <label className="flex items-center gap-2 cursor-pointer text-sm text-surface-400 hover:text-surface-200 transition-colors">
                            <input
                                type="checkbox"
                                checked={forceOcr}
                                onChange={(e) => setForceOcr(e.target.checked)}
                                className="rounded bg-surface-700 border-surface-600 text-amber-500 focus:ring-amber-500/30"
                            />
                            <span className={clsx(forceOcr && "text-amber-400 font-medium")}>
                                Neuberechnung erzwingen (Force OCR)
                            </span>
                        </label>
                    </div>
                </div>
            </div>

            {/* Error */}
            {error && (
                <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-start gap-3">
                    <XCircle className="w-5 h-5 text-red-400 mt-0.5 shrink-0" />
                    <span className="text-red-200 text-sm">{error}</span>
                </div>
            )}

            {/* Loading */}
            {loading && (
                <div className="card p-12 text-center border border-surface-700/50 bg-surface-800/40">
                    <Loader2 className="w-12 h-12 animate-spin text-cyan-400 mx-auto mb-4" />
                    <p className="text-white text-lg font-medium">OCR läuft...</p>
                    <p className="text-surface-400 text-sm mt-1">Dokument wird heruntergeladen, Seiten konvertiert und analysiert</p>
                </div>
            )}

            {/* Result */}
            {result && !loading && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    {/* Title & Stats */}
                    <div className="card p-0 overflow-hidden border border-surface-700/50 bg-surface-800/40">
                        <div className="p-6 border-b border-surface-700/50 bg-surface-800/50">
                            <div className="flex items-center justify-between flex-wrap gap-4">
                                <div>
                                    <h3 className="text-xl font-bold text-white">{result.title}</h3>
                                    <p className="text-sm text-surface-400 font-mono mt-1">ID: {result.document_id}</p>
                                </div>
                                <div className={clsx(
                                    'px-4 py-2 rounded-lg text-sm font-bold',
                                    qualityWarning
                                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                        : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                )}>
                                    {ratio}% Textumfang ({result.old_length.toLocaleString()} → {result.new_length.toLocaleString()} Zeichen)
                                </div>
                            </div>
                        </div>

                        {/* Quality Warning */}
                        {qualityWarning && (
                            <div className="mx-6 mt-4 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-start gap-3">
                                <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
                                <div className="text-amber-200 text-sm">
                                    <p className="font-medium">Qualitätswarnung!</p>
                                    <p className="mt-1">Der neue Text ist deutlich kürzer als das Original. Bitte prüfe den Vergleich sorgfältig vor der Übernahme.</p>
                                </div>
                            </div>
                        )}

                        {/* PDF Preview + Text Comparison */}
                        <div className="p-6">
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                {/* PDF Preview */}
                                <div>
                                    <DocumentPreview documentId={result.document_id} />
                                </div>
                                {/* Original OCR Text */}
                                <div>
                                    <h4 className="text-sm font-semibold text-surface-300 mb-3 flex items-center gap-2">
                                        <span className="w-2 h-2 rounded-full bg-surface-500"></span>
                                        Original OCR
                                        <span className="text-xs text-surface-500 font-mono ml-auto">{result.old_length.toLocaleString()} Zeichen</span>
                                    </h4>
                                    <div className="bg-surface-900/60 rounded-xl p-4 border border-surface-700/50 max-h-[500px] overflow-y-auto custom-scrollbar">
                                        <pre className="text-sm text-surface-300 whitespace-pre-wrap font-mono leading-relaxed">
                                            {result.old_content || '(leer)'}
                                        </pre>
                                    </div>
                                </div>
                                {/* New Vision OCR Text */}
                                <div>
                                    <h4 className="text-sm font-semibold text-cyan-300 mb-3 flex items-center gap-2">
                                        <span className="w-2 h-2 rounded-full bg-cyan-500"></span>
                                        Ollama Vision OCR
                                        <span className="text-xs text-surface-500 font-mono ml-auto">{result.new_length.toLocaleString()} Zeichen</span>
                                    </h4>
                                    <div className="bg-surface-900/60 rounded-xl p-4 border border-cyan-500/20 max-h-[500px] overflow-y-auto custom-scrollbar">
                                        <pre className="text-sm text-cyan-100 whitespace-pre-wrap font-mono leading-relaxed">
                                            {result.new_content || '(leer)'}
                                        </pre>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Apply Button */}
                    {!applied ? (
                        <button
                            onClick={applyResult}
                            disabled={applying}
                            className="w-full btn bg-gradient-to-r from-cyan-600 to-primary-600 hover:from-cyan-700 hover:to-primary-700 text-white py-4 text-lg font-bold flex items-center justify-center gap-3 shadow-xl shadow-cyan-900/20 rounded-xl disabled:opacity-50"
                        >
                            {applying
                                ? <><Loader2 className="w-5 h-5 animate-spin" /> Wird übertragen...</>
                                : <><ArrowRightLeft className="w-5 h-5" /> Neuen Text übernehmen</>
                            }
                        </button>
                    ) : (
                        <div className="p-5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-3">
                            <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                            <div>
                                <p className="font-bold text-emerald-200">Text wird gespeichert!</p>
                                <p className="text-sm text-emerald-300/70 mt-0.5">Paperless-ngx aktualisiert den Suchindex im Hintergrund. Das kann einige Sekunden dauern.</p>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
