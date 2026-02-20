import { useState, useEffect } from 'react'
import { BarChart3, Clock, FileText, Layers, RefreshCw, CheckCircle, Loader2, AlertCircle } from 'lucide-react'
import * as api from '../services/api'
import clsx from 'clsx'

export default function OcrStats() {
    const [stats, setStats] = useState<api.OcrStats[]>([])
    const [ocrStatus, setOcrStatus] = useState<api.OcrStatus | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        loadStats()
    }, [])

    const loadStats = async () => {
        setLoading(true)
        try {
            // Load both stats and status
            const [statsData, statusData] = await Promise.all([
                api.getOcrStats(),
                api.getOcrStatus()
            ])
            setStats(statsData.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()))
            setOcrStatus(statusData)
        } catch (e) {
            console.error('Failed to load stats', e)
        } finally {
            setLoading(false)
        }
    }

    // Calculate aggregations (only successful entries)
    const successStats = stats.filter(s => s.success !== false)
    const totalDocs = successStats.length
    const totalPages = successStats.reduce((acc, curr) => acc + (curr.pages || 0), 0)
    const avgTime = totalDocs > 0
        ? successStats.reduce((acc, curr) => acc + (curr.duration || 0), 0) / totalDocs
        : 0
    const avgTimePerPage = totalPages > 0
        ? successStats.reduce((acc, curr) => acc + (curr.duration || 0), 0) / totalPages
        : 0

    // Calculate progress color based on percentage
    const getProgressColor = (percentage: number) => {
        if (percentage >= 90) return 'emerald'
        if (percentage >= 50) return 'amber'
        return 'red'
    }

    const progressColor = ocrStatus ? getProgressColor(ocrStatus.percentage) : 'red'

    return (
        <div className="space-y-6">
            {/* Header / Actions */}
            <div className="flex justify-end">
                <button
                    onClick={loadStats}
                    disabled={loading}
                    className="flex items-center gap-2 text-sm text-surface-400 hover:text-white transition-colors"
                >
                    <RefreshCw className={clsx("w-4 h-4", loading && "animate-spin")} />
                    Aktualisieren
                </button>
            </div>

            {/* OCR Status Card - NEW */}
            {ocrStatus && (
                <div className="card p-6 border border-surface-700/50 shadow-xl shadow-black/20 bg-surface-800/40 backdrop-blur-sm">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-bold text-lg text-white flex items-center gap-2">
                            <CheckCircle className="w-5 h-5 text-primary-400" />
                            OCR Gesamtstatus
                        </h3>
                        <div className={clsx(
                            "px-3 py-1 rounded-full text-sm font-bold",
                            progressColor === 'emerald' && "bg-emerald-500/20 text-emerald-300",
                            progressColor === 'amber' && "bg-amber-500/20 text-amber-300",
                            progressColor === 'red' && "bg-red-500/20 text-red-300"
                        )}>
                            {ocrStatus.percentage}%
                        </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="mb-6">
                        <div className="h-4 bg-surface-700 rounded-full overflow-hidden">
                            <div 
                                className={clsx(
                                    "h-full transition-all duration-1000 ease-out rounded-full",
                                    progressColor === 'emerald' && "bg-gradient-to-r from-emerald-600 to-emerald-400",
                                    progressColor === 'amber' && "bg-gradient-to-r from-amber-600 to-amber-400",
                                    progressColor === 'red' && "bg-gradient-to-r from-red-600 to-red-400"
                                )}
                                style={{ width: `${ocrStatus.percentage}%` }}
                            />
                        </div>
                        <div className="flex justify-between mt-2 text-xs text-surface-400">
                            <span>0%</span>
                            <span>50%</span>
                            <span>100%</span>
                        </div>
                    </div>

                    {/* Status Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="p-4 rounded-xl bg-surface-900/50 border border-surface-700">
                            <div className="flex items-center gap-2 mb-2">
                                <FileText className="w-4 h-4 text-surface-400" />
                                <span className="text-sm text-surface-400">Gesamtdokumente</span>
                            </div>
                            <div className="text-2xl font-bold text-white">{ocrStatus.total_documents}</div>
                        </div>

                        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
                            <div className="flex items-center gap-2 mb-2">
                                <CheckCircle className="w-4 h-4 text-emerald-400" />
                                <span className="text-sm text-emerald-300">OCR Fertig</span>
                            </div>
                            <div className="text-2xl font-bold text-emerald-300">{ocrStatus.finished_documents}</div>
                            <div className="text-xs text-emerald-400/70 mt-1">
                                {((ocrStatus.finished_documents / ocrStatus.total_documents) * 100).toFixed(1)}% abgeschlossen
                            </div>
                        </div>

                        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30">
                            <div className="flex items-center gap-2 mb-2">
                                <Loader2 className="w-4 h-4 text-amber-400" />
                                <span className="text-sm text-amber-300">Offen / Pending</span>
                            </div>
                            <div className="text-2xl font-bold text-amber-300">{ocrStatus.pending_documents}</div>
                            <div className="text-xs text-amber-400/70 mt-1">
                                Noch {ocrStatus.pending_documents} Dokumente zu verarbeiten
                            </div>
                        </div>
                    </div>

                    {ocrStatus.percentage < 100 && (
                        <div className="mt-4 p-3 bg-surface-700/30 rounded-lg flex items-center gap-3">
                            <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0" />
                            <p className="text-sm text-surface-300">
                                Es fehlen noch <strong className="text-white">{ocrStatus.pending_documents} Dokumente</strong> bis alle aktuell sind. 
                                Starte den Batch-OCR um diese zu verarbeiten.
                            </p>
                        </div>
                    )}

                    {ocrStatus.percentage === 100 && (
                        <div className="mt-4 p-3 bg-emerald-500/10 rounded-lg flex items-center gap-3">
                            <CheckCircle className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                            <p className="text-sm text-emerald-300">
                                <strong>Super!</strong> Alle {ocrStatus.total_documents} Dokumente haben aktuelles OCR.
                            </p>
                        </div>
                    )}
                </div>
            )}

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <MetricCard
                    icon={<FileText className="w-5 h-5 text-blue-400" />}
                    label="Verarbeitete Dokumente"
                    value={totalDocs}
                    color="blue"
                />
                <MetricCard
                    icon={<Layers className="w-5 h-5 text-emerald-400" />}
                    label="Seiten"
                    value={totalPages}
                    color="emerald"
                />
                <MetricCard
                    icon={<Clock className="w-5 h-5 text-purple-400" />}
                    label="Ø Zeit / Dok"
                    value={`${avgTime.toFixed(1)}s`}
                    color="purple"
                />
                <MetricCard
                    icon={<Clock className="w-5 h-5 text-orange-400" />}
                    label="Ø Zeit / Seite"
                    value={`${avgTimePerPage.toFixed(1)}s`}
                    color="orange"
                />
            </div>

            {/* Recent Activity List */}
            <div className="card p-0 overflow-hidden border border-surface-700/50 shadow-xl shadow-black/20 bg-surface-800/40 backdrop-blur-sm">
                <div className="p-6 border-b border-surface-700/50 bg-surface-800/50 flex justify-between items-center">
                    <h3 className="font-bold text-lg text-white flex items-center gap-2">
                        <BarChart3 className="w-5 h-5 text-primary-400" />
                        Letzte Aktivitäten
                    </h3>
                </div>

                {stats.length === 0 ? (
                    <div className="p-12 text-center text-surface-500">
                        <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-20" />
                        <p>Noch keine Statistiken verfügbar.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="text-xs text-surface-400 uppercase bg-surface-900/50 border-b border-surface-700/50">
                                <tr>
                                    <th className="px-6 py-4 font-medium">Zeitpunkt</th>
                                    <th className="px-6 py-4 font-medium">Dokument</th>
                                    <th className="px-6 py-4 font-medium text-center">Seiten</th>
                                    <th className="px-6 py-4 font-medium text-center">Zeichen</th>
                                    <th className="px-6 py-4 font-medium text-right">Dauer</th>
                                    <th className="px-6 py-4 font-medium">Server</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-surface-700/30">
                                {stats.slice(0, 10).map((stat, i) => (
                                    <tr key={i} className={clsx(
                                        "transition-colors",
                                        stat.success === false ? "bg-red-500/10 hover:bg-red-500/20" : "hover:bg-surface-700/20"
                                    )}>
                                        <td className="px-6 py-4 text-surface-300 whitespace-nowrap">
                                            {new Date(stat.timestamp).toLocaleString()}
                                        </td>
                                        <td className="px-6 py-4 font-medium text-white">
                                            <span className="flex items-center gap-2">
                                                #{stat.doc_id}
                                                {stat.success === false && (
                                                    <span className="text-xs text-red-400 bg-red-500/20 px-1.5 py-0.5 rounded">FEHLER</span>
                                                )}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-center text-surface-300">
                                            {stat.pages}
                                        </td>
                                        <td className="px-6 py-4 text-center text-surface-300">
                                            {stat.chars}
                                        </td>
                                        <td className="px-6 py-4 text-right font-mono text-primary-300">
                                            {stat.duration ? stat.duration.toFixed(1) : '-'}s
                                        </td>
                                        <td className="px-6 py-4 text-xs text-surface-500 truncate max-w-[150px] font-mono" title={stat.server}>
                                            {stat.server ? stat.server.replace('http://', '').replace('https://', '') : '-'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    )
}

function MetricCard({ icon, label, value, color }: { icon: any, label: string, value: string | number, color: string }) {
    return (
        <div className={clsx(
            "p-5 rounded-xl border bg-surface-800/40 backdrop-blur-sm shadow-lg transition-transform hover:scale-[1.02]",
            color === 'blue' && "border-blue-500/20 shadow-blue-900/10",
            color === 'emerald' && "border-emerald-500/20 shadow-emerald-900/10",
            color === 'purple' && "border-purple-500/20 shadow-purple-900/10",
            color === 'orange' && "border-orange-500/20 shadow-orange-900/10"
        )}>
            <div className="flex items-center gap-3 mb-2 opacity-80">
                {icon}
                <span className="text-sm font-medium text-surface-400">{label}</span>
            </div>
            <div className="text-3xl font-bold text-white tracking-tight">{value}</div>
        </div>
    )
}
