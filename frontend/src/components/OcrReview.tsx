import { useState, useEffect } from 'react'
import {
    AlertCircle,
    CheckCircle2,
    XCircle,
    Loader2,
    ArrowRightLeft,
    FileText,
    Trash2,
    RefreshCw,
    RotateCcw,
    Ban,
    ShieldOff,
} from 'lucide-react'
import clsx from 'clsx'
import * as api from '../services/api'
import DocumentPreview from './DocumentPreview'

interface ReviewItem {
    document_id: number
    title: string
    old_content: string
    new_content: string
    old_length: number
    new_length: number
    ratio: number
    timestamp: string
}

interface IgnoreItem {
    document_id: number
    title: string
    reason: string
    timestamp: string
}

interface OcrReviewProps {
    onRecheckDocument?: (docId: number) => void
}

export default function OcrReview({ onRecheckDocument }: OcrReviewProps = {}) {
    const [items, setItems] = useState<ReviewItem[]>([])
    const [ignoreList, setIgnoreList] = useState<IgnoreItem[]>([])
    const [loading, setLoading] = useState(true)
    const [expandedId, setExpandedId] = useState<number | null>(null)
    const [actionLoading, setActionLoading] = useState<number | null>(null)
    const [error, setError] = useState('')
    const [success, setSuccess] = useState('')
    const [showIgnoreList, setShowIgnoreList] = useState(false)

    useEffect(() => {
        loadQueue()
        loadIgnoreList()
    }, [])

    const loadQueue = async () => {
        setLoading(true)
        try {
            const data = await api.getReviewQueue()
            setItems(data.items || [])
        } catch (e: any) {
            setError(e?.message || 'Fehler beim Laden')
        } finally {
            setLoading(false)
        }
    }

    const loadIgnoreList = async () => {
        try {
            const data = await api.getOcrIgnoreList()
            setIgnoreList(data.items || [])
        } catch {
            // silent
        }
    }

    const applyItem = async (docId: number, title: string) => {
        setActionLoading(docId)
        setError('')
        try {
            await api.applyReviewItem(docId)
            setItems(prev => prev.filter(i => i.document_id !== docId))
            setSuccess(`"${title}" – Text übernommen!`)
            setTimeout(() => setSuccess(''), 4000)
        } catch (e: any) {
            setError(e?.message || 'Fehler beim Anwenden')
        } finally {
            setActionLoading(null)
        }
    }

    const dismissItem = async (docId: number, title: string) => {
        setActionLoading(docId)
        setError('')
        try {
            await api.dismissReviewItem(docId)
            setItems(prev => prev.filter(i => i.document_id !== docId))
            setSuccess(`"${title}" – Verworfen.`)
            setTimeout(() => setSuccess(''), 4000)
        } catch (e: any) {
            setError(e?.message || 'Fehler beim Verwerfen')
        } finally {
            setActionLoading(null)
        }
    }

    const ignoreItem = async (docId: number, title: string) => {
        setActionLoading(docId)
        setError('')
        try {
            await api.ignoreReviewItem(docId)
            setItems(prev => prev.filter(i => i.document_id !== docId))
            setIgnoreList(prev => [...prev, { document_id: docId, title, reason: 'Original besser als OCR', timestamp: new Date().toISOString() }])
            setSuccess(`"${title}" – Auf Ignore-Liste gesetzt. Wird bei zukünftigem OCR übersprungen.`)
            setTimeout(() => setSuccess(''), 5000)
        } catch (e: any) {
            setError(e?.message || 'Fehler beim Ignorieren')
        } finally {
            setActionLoading(null)
        }
    }

    const removeFromIgnoreList = async (docId: number, title: string) => {
        setActionLoading(docId)
        setError('')
        try {
            await api.removeFromOcrIgnoreList(docId)
            setIgnoreList(prev => prev.filter(i => i.document_id !== docId))
            setSuccess(`"${title}" – Von Ignore-Liste entfernt.`)
            setTimeout(() => setSuccess(''), 4000)
        } catch (e: any) {
            setError(e?.message || 'Fehler beim Entfernen')
        } finally {
            setActionLoading(null)
        }
    }

    return (
        <div className="space-y-8 pb-12">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="font-display text-3xl font-bold text-white flex items-center gap-3">
                        <div className="p-2 bg-gradient-to-br from-amber-500 to-orange-600 rounded-xl shadow-lg shadow-amber-500/20">
                            <AlertCircle className="w-8 h-8 text-white" />
                        </div>
                        Manuell <span className="text-amber-400">Prüfen</span>
                        {items.length > 0 && (
                            <span className="ml-2 px-3 py-1 text-sm bg-amber-500/20 text-amber-300 rounded-full border border-amber-500/30">
                                {items.length}
                            </span>
                        )}
                    </h2>
                    <p className="text-surface-400 mt-2 text-lg">
                        OCR-Ergebnisse mit fraglicher Qualität — bitte manuell prüfen
                    </p>
                </div>
                <button
                    onClick={loadQueue}
                    className="btn bg-surface-700 hover:bg-surface-600 text-surface-200 border-surface-600 flex items-center gap-2"
                >
                    <RefreshCw className="w-4 h-4" />
                    Aktualisieren
                </button>
            </div>

            {/* Error */}
            {error && (
                <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-start gap-3">
                    <XCircle className="w-5 h-5 text-red-400 mt-0.5 shrink-0" />
                    <span className="text-red-200 text-sm">{error}</span>
                </div>
            )}

            {/* Success */}
            {success && (
                <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-start gap-3 animate-in zoom-in-95">
                    <CheckCircle2 className="w-5 h-5 text-emerald-400 mt-0.5 shrink-0" />
                    <span className="text-emerald-200 text-sm">{success}</span>
                </div>
            )}

            {/* Loading */}
            {loading && (
                <div className="card p-12 text-center border border-surface-700/50 bg-surface-800/40">
                    <Loader2 className="w-10 h-10 animate-spin text-amber-400 mx-auto mb-3" />
                    <p className="text-surface-400">Review Queue wird geladen...</p>
                </div>
            )}

            {/* Empty State */}
            {!loading && items.length === 0 && (
                <div className="card p-12 text-center border border-surface-700/50 bg-surface-800/40">
                    <CheckCircle2 className="w-14 h-14 text-emerald-500/40 mx-auto mb-4" />
                    <p className="text-xl font-bold text-white">Alles geprüft! 🎉</p>
                    <p className="text-surface-400 mt-2">Keine Dokumente in der Warteschlange.</p>
                </div>
            )}

            {/* Items */}
            {!loading && items.map(item => (
                <div
                    key={item.document_id}
                    className="card p-0 overflow-hidden border border-surface-700/50 shadow-xl shadow-black/20 bg-surface-800/40 backdrop-blur-sm animate-in fade-in"
                >
                    {/* Item Header */}
                    <div
                        className="p-5 flex items-center justify-between cursor-pointer hover:bg-surface-700/30 transition-colors"
                        onClick={() => setExpandedId(expandedId === item.document_id ? null : item.document_id)}
                    >
                        <div className="flex items-center gap-4">
                            <div className="p-2 bg-amber-500/20 rounded-lg">
                                <FileText className="w-5 h-5 text-amber-400" />
                            </div>
                            <div>
                                <h3 className="font-bold text-white">{item.title}</h3>
                                <div className="flex items-center gap-3 mt-1 text-sm text-surface-400">
                                    <span className="font-mono">#{item.document_id}</span>
                                    <span>•</span>
                                    <span>{new Date(item.timestamp).toLocaleString('de-DE')}</span>
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center gap-4">
                            <div className={clsx(
                                'px-3 py-1.5 rounded-lg text-sm font-bold',
                                item.ratio < 30
                                    ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                                    : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                            )}>
                                {item.ratio}% — {item.new_length.toLocaleString()} vs {item.old_length.toLocaleString()} Zeichen
                            </div>

                            {/* Action buttons */}
                            <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                                {onRecheckDocument && (
                                    <button
                                        onClick={() => onRecheckDocument(item.document_id)}
                                        disabled={actionLoading === item.document_id}
                                        className="btn bg-cyan-600 hover:bg-cyan-700 text-white text-sm px-4 py-2 flex items-center gap-2 disabled:opacity-50"
                                        title="Dokument erneut per Einzel-OCR prüfen"
                                    >
                                        <RotateCcw className="w-4 h-4" />
                                        Neu-OCR
                                    </button>
                                )}
                                <button
                                    onClick={() => applyItem(item.document_id, item.title)}
                                    disabled={actionLoading === item.document_id}
                                    className="btn bg-emerald-600 hover:bg-emerald-700 text-white text-sm px-4 py-2 flex items-center gap-2 disabled:opacity-50"
                                    title="Neuen Text übernehmen"
                                >
                                    {actionLoading === item.document_id
                                        ? <Loader2 className="w-4 h-4 animate-spin" />
                                        : <ArrowRightLeft className="w-4 h-4" />
                                    }
                                    Übernehmen
                                </button>
                                <button
                                    onClick={() => dismissItem(item.document_id, item.title)}
                                    disabled={actionLoading === item.document_id}
                                    className="btn bg-surface-700 hover:bg-red-600/80 text-surface-300 hover:text-white text-sm px-4 py-2 flex items-center gap-2 disabled:opacity-50"
                                    title="Verwerfen"
                                >
                                    <Trash2 className="w-4 h-4" />
                                    Verwerfen
                                </button>
                                <button
                                    onClick={() => ignoreItem(item.document_id, item.title)}
                                    disabled={actionLoading === item.document_id}
                                    className="btn bg-surface-700 hover:bg-orange-600/80 text-surface-300 hover:text-white text-sm px-4 py-2 flex items-center gap-2 disabled:opacity-50"
                                    title="Dauerhaft ignorieren — Original behalten, bei zukünftigem OCR überspringen"
                                >
                                    <Ban className="w-4 h-4" />
                                    Ignorieren
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Expanded: PDF Preview + Text Comparison */}
                    {expandedId === item.document_id && (
                        <div className="p-6 border-t border-surface-700/50 bg-surface-900/30 animate-in slide-in-from-top-2 duration-300">
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                {/* PDF Preview */}
                                <div>
                                    <DocumentPreview documentId={item.document_id} />
                                </div>
                                {/* Original OCR Text */}
                                <div>
                                    <h4 className="text-sm font-semibold text-surface-300 mb-3 flex items-center gap-2">
                                        <span className="w-2 h-2 rounded-full bg-surface-500"></span>
                                        Original OCR
                                        <span className="text-xs text-surface-500 font-mono ml-auto">{item.old_length.toLocaleString()} Zeichen</span>
                                    </h4>
                                    <div className="bg-surface-900/60 rounded-xl p-4 border border-surface-700/50 max-h-[500px] overflow-y-auto custom-scrollbar">
                                        <pre className="text-sm text-surface-300 whitespace-pre-wrap font-mono leading-relaxed">
                                            {item.old_content || '(leer)'}
                                        </pre>
                                    </div>
                                </div>
                                {/* New Vision OCR Text */}
                                <div>
                                    <h4 className="text-sm font-semibold text-cyan-300 mb-3 flex items-center gap-2">
                                        <span className="w-2 h-2 rounded-full bg-cyan-500"></span>
                                        Ollama Vision OCR
                                        <span className="text-xs text-surface-500 font-mono ml-auto">{item.new_length.toLocaleString()} Zeichen</span>
                                    </h4>
                                    <div className="bg-surface-900/60 rounded-xl p-4 border border-cyan-500/20 max-h-[500px] overflow-y-auto custom-scrollbar">
                                        <pre className="text-sm text-cyan-100 whitespace-pre-wrap font-mono leading-relaxed">
                                            {item.new_content || '(leer)'}
                                        </pre>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            ))}

            {/* OCR Ignore List */}
            {ignoreList.length > 0 && (
                <div className="mt-8">
                    <button
                        onClick={() => setShowIgnoreList(!showIgnoreList)}
                        className="flex items-center gap-3 text-surface-400 hover:text-surface-200 transition-colors mb-4"
                    >
                        <ShieldOff className="w-5 h-5" />
                        <span className="font-semibold">OCR Ignore-Liste</span>
                        <span className="px-2 py-0.5 text-xs bg-surface-700 text-surface-300 rounded-full">
                            {ignoreList.length}
                        </span>
                        <span className="text-xs text-surface-500">
                            {showIgnoreList ? '▲ ausblenden' : '▼ anzeigen'}
                        </span>
                    </button>

                    {showIgnoreList && (
                        <div className="space-y-2 animate-in slide-in-from-top-2 duration-200">
                            <p className="text-sm text-surface-500 mb-3">
                                Diese Dokumente werden bei zukünftigen OCR-Läufen übersprungen, da das Original besser ist.
                            </p>
                            {ignoreList.map(entry => (
                                <div
                                    key={entry.document_id}
                                    className="flex items-center justify-between p-3 rounded-xl bg-surface-800/40 border border-surface-700/50"
                                >
                                    <div className="flex items-center gap-3">
                                        <Ban className="w-4 h-4 text-orange-400/60" />
                                        <div>
                                            <span className="text-sm text-surface-200 font-medium">{entry.title}</span>
                                            <div className="flex items-center gap-2 text-xs text-surface-500">
                                                <span className="font-mono">#{entry.document_id}</span>
                                                <span>•</span>
                                                <span>{new Date(entry.timestamp).toLocaleString('de-DE')}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => removeFromIgnoreList(entry.document_id, entry.title)}
                                        disabled={actionLoading === entry.document_id}
                                        className="btn bg-surface-700 hover:bg-surface-600 text-surface-400 hover:text-white text-xs px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-50"
                                        title="Von Ignore-Liste entfernen"
                                    >
                                        <XCircle className="w-3.5 h-3.5" />
                                        Entfernen
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
