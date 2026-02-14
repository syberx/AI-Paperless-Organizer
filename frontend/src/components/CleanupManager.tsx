import { useState } from 'react'
import {
    Search,
    CheckCircle2,
    Loader2,
    Trash2,
    AlertTriangle,
    FileText,
    XCircle,
    CheckSquare,
    Square
} from 'lucide-react'
import clsx from 'clsx'
import * as api from '../services/api'

const DEFAULT_QUERY = ''

export default function CleanupManager() {
    const [query, setQuery] = useState(DEFAULT_QUERY)
    const [documents, setDocuments] = useState<api.CleanupDocument[]>([])
    const [loading, setLoading] = useState(false)
    const [scanned, setScanned] = useState(false)
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
    const [deleting, setDeleting] = useState(false)
    const [deleteResult, setDeleteResult] = useState<{ count: number; errors: number } | null>(null)
    const [error, setError] = useState('')
    const [showConfirm, setShowConfirm] = useState(false)

    const scanDocuments = async () => {
        setLoading(true)
        setError('')
        setDeleteResult(null)
        setSelectedIds(new Set())
        try {
            const result = await api.scanJunkDocuments(query, 100)
            setDocuments(result.documents)
            setScanned(true)
        } catch (e: any) {
            setError(e?.message || 'Fehler beim Scannen')
        } finally {
            setLoading(false)
        }
    }

    const toggleSelect = (id: number) => {
        setSelectedIds(prev => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

    const toggleAll = () => {
        if (selectedIds.size === documents.length) {
            setSelectedIds(new Set())
        } else {
            setSelectedIds(new Set(documents.map(d => d.id)))
        }
    }

    const deleteSelected = async () => {
        setShowConfirm(false)
        setDeleting(true)
        setError('')
        try {
            const result = await api.deleteJunkDocuments(Array.from(selectedIds))
            setDeleteResult({ count: result.deleted_count, errors: result.errors?.length || 0 })
            setDocuments(prev => prev.filter(d => !selectedIds.has(d.id)))
            setSelectedIds(new Set())
        } catch (e: any) {
            setError(e?.message || 'Fehler beim Löschen')
        } finally {
            setDeleting(false)
        }
    }

    return (
        <div className="space-y-8 pb-12">
            {/* Header */}
            <div>
                <h2 className="font-display text-3xl font-bold text-white flex items-center gap-3">
                    <div className="p-2 bg-gradient-to-br from-red-500 to-red-700 rounded-xl shadow-lg shadow-red-500/20">
                        <Trash2 className="w-8 h-8 text-white" />
                    </div>
                    Dokumente <span className="text-red-400">Aufräumen</span>
                </h2>
                <p className="text-surface-400 mt-2 text-lg">
                    AGB, Widerrufsbelehrungen & Datenschutzerklärungen finden und entfernen
                </p>
            </div>

            {/* Search */}
            <div className="card p-0 overflow-hidden border border-surface-700/50 shadow-xl shadow-black/20 bg-surface-800/40 backdrop-blur-sm">
                <div className="p-6 border-b border-surface-700/50 bg-surface-800/50">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-amber-500/20 rounded-lg">
                            <Search className="w-5 h-5 text-amber-400" />
                        </div>
                        <div>
                            <h3 className="font-bold text-lg text-white">Suche</h3>
                            <p className="text-sm text-surface-400">Suche nach Junk-Dokumenten anhand des Titels</p>
                        </div>
                    </div>
                </div>

                <div className="p-6 space-y-4">
                    <div className="flex gap-3">
                        <input
                            type="text"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Leer = Standard-Begriffe (AGB, Widerruf, Datenschutz, Impressum...)"
                            className="flex-1 input bg-surface-900/50 border-surface-700 focus:border-amber-500 focus:ring-amber-500/20 font-mono text-sm"
                            onKeyDown={(e) => e.key === 'Enter' && scanDocuments()}
                        />
                        <button
                            onClick={scanDocuments}
                            disabled={loading}
                            className="btn btn-primary flex items-center gap-2 shadow-lg shadow-primary-900/20 px-6"
                        >
                            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                            Scannen
                        </button>
                    </div>
                    <p className="text-xs text-surface-500 flex items-center gap-1.5">
                        <AlertTriangle className="w-3 h-3 text-amber-500" />
                        Suche nur im <strong className="text-surface-300 mx-0.5">Titel</strong> der Dokumente. Leer lassen für Standard-Begriffe. Eigene Begriffe kommagetrennt eingeben.
                    </p>
                </div>
            </div>

            {/* Error */}
            {error && (
                <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-start gap-3">
                    <XCircle className="w-5 h-5 text-red-400 mt-0.5 shrink-0" />
                    <span className="text-red-200 text-sm">{error}</span>
                </div>
            )}

            {/* Delete success */}
            {deleteResult && (
                <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-start gap-3 animate-in zoom-in-95">
                    <CheckCircle2 className="w-5 h-5 text-emerald-400 mt-0.5 shrink-0" />
                    <div className="text-emerald-200 text-sm">
                        <p className="font-medium">{deleteResult.count} Dokument(e) gelöscht.</p>
                        {deleteResult.errors > 0 && (
                            <p className="text-amber-300 mt-1">{deleteResult.errors} Fehler aufgetreten.</p>
                        )}
                    </div>
                </div>
            )}

            {/* Results */}
            {scanned && (
                <div className="card p-0 overflow-hidden border border-surface-700/50 shadow-xl shadow-black/20 bg-surface-800/40 backdrop-blur-sm animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="p-6 border-b border-surface-700/50 bg-surface-800/50">
                        <div className="flex items-center justify-between flex-wrap gap-3">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-red-500/20 rounded-lg">
                                    <FileText className="w-5 h-5 text-red-400" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-lg text-white">
                                        {documents.length} Treffer
                                    </h3>
                                    <p className="text-sm text-surface-400">
                                        {selectedIds.size > 0 ? `${selectedIds.size} ausgewählt` : 'Klicke auf Karten zum Auswählen'}
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center gap-3">
                                {documents.length > 0 && (
                                    <button
                                        onClick={toggleAll}
                                        className="btn bg-surface-700 hover:bg-surface-600 text-surface-200 border-surface-600 flex items-center gap-2 text-sm"
                                    >
                                        {selectedIds.size === documents.length
                                            ? <><CheckSquare className="w-4 h-4 text-primary-400" /> Alle abwählen</>
                                            : <><Square className="w-4 h-4" /> Alle auswählen</>
                                        }
                                    </button>
                                )}

                                <button
                                    onClick={() => setShowConfirm(true)}
                                    disabled={deleting || selectedIds.size === 0}
                                    className="btn bg-red-600 hover:bg-red-700 text-white flex items-center gap-2 shadow-lg shadow-red-900/20 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                                    Löschen ({selectedIds.size})
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Documents Grid */}
                    <div className="p-6">
                        {documents.length === 0 ? (
                            <div className="py-12 text-center text-surface-500">
                                <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-emerald-500 opacity-40" />
                                <p className="text-lg font-medium">Keine Junk-Dokumente gefunden</p>
                                <p className="text-sm mt-1">Alles sauber! 🎉</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                                {documents.map(doc => (
                                    <div
                                        key={doc.id}
                                        onClick={() => toggleSelect(doc.id)}
                                        className={clsx(
                                            'relative rounded-xl overflow-hidden cursor-pointer transition-all duration-200 group border-2',
                                            selectedIds.has(doc.id)
                                                ? 'border-red-500 ring-2 ring-red-500/30 scale-[0.97]'
                                                : 'border-surface-700/50 hover:border-surface-500 hover:shadow-lg hover:shadow-black/20 hover:-translate-y-0.5'
                                        )}
                                    >
                                        {/* Checkbox Overlay */}
                                        <div className={clsx(
                                            'absolute top-2 left-2 z-10 w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all shadow-lg',
                                            selectedIds.has(doc.id)
                                                ? 'border-red-500 bg-red-500'
                                                : 'border-white/50 bg-black/40 backdrop-blur-sm group-hover:border-white/80'
                                        )}>
                                            {selectedIds.has(doc.id) && (
                                                <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                                </svg>
                                            )}
                                        </div>

                                        {/* Selected overlay */}
                                        {selectedIds.has(doc.id) && (
                                            <div className="absolute inset-0 bg-red-500/15 z-[1] pointer-events-none" />
                                        )}

                                        {/* Thumbnail */}
                                        <div className="w-full h-44 bg-surface-900/80 flex items-center justify-center overflow-hidden">
                                            {doc.thumbnail_url ? (
                                                <img
                                                    src={doc.thumbnail_url}
                                                    alt=""
                                                    className="w-full h-full object-cover"
                                                    onError={(e) => {
                                                        (e.target as HTMLImageElement).style.display = 'none';
                                                        const fallback = (e.target as HTMLImageElement).nextElementSibling;
                                                        if (fallback) (fallback as HTMLElement).classList.remove('hidden');
                                                    }}
                                                />
                                            ) : null}
                                            <div className={clsx("flex items-center justify-center", doc.thumbnail_url ? "hidden" : "")}>
                                                <FileText className="w-10 h-10 text-surface-600" />
                                            </div>
                                        </div>

                                        {/* Info */}
                                        <div className="p-3 bg-surface-800/80">
                                            <p className={clsx(
                                                'text-sm font-medium leading-tight line-clamp-2 transition-colors',
                                                selectedIds.has(doc.id) ? 'text-red-200' : 'text-white'
                                            )}>
                                                {doc.title}
                                            </p>
                                            <div className="flex items-center gap-2 mt-1.5 text-xs text-surface-500">
                                                <span className="font-mono">#{doc.id}</span>
                                                {doc.created && (
                                                    <span>{new Date(doc.created).toLocaleDateString('de-DE')}</span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Confirm Dialog */}
            {showConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-surface-800 border border-surface-600 rounded-2xl shadow-2xl p-8 max-w-md w-full mx-4 animate-in zoom-in-95 duration-300">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 bg-red-500/20 rounded-xl">
                                <AlertTriangle className="w-6 h-6 text-red-400" />
                            </div>
                            <h3 className="text-xl font-bold text-white">Endgültig löschen?</h3>
                        </div>
                        <p className="text-surface-300 mb-6">
                            <span className="font-bold text-red-400">{selectedIds.size}</span> Dokument(e) werden
                            <span className="font-bold text-red-400"> unwiderruflich</span> aus Paperless-ngx gelöscht.
                        </p>
                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => setShowConfirm(false)}
                                className="btn bg-surface-700 hover:bg-surface-600 text-surface-200 border-surface-600 px-6"
                            >
                                Abbrechen
                            </button>
                            <button
                                onClick={deleteSelected}
                                className="btn bg-red-600 hover:bg-red-700 text-white px-6 flex items-center gap-2 shadow-lg shadow-red-900/30"
                            >
                                <Trash2 className="w-4 h-4" />
                                Ja, löschen
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
