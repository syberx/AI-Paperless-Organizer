import { useState, useEffect } from 'react'
import { BarChart3, Clock, FileText, Layers, RefreshCw } from 'lucide-react'
import * as api from '../services/api'
import clsx from 'clsx'

export default function OcrStats() {
    const [stats, setStats] = useState<api.OcrStats[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        loadStats()
    }, [])

    const loadStats = async () => {
        setLoading(true)
        try {
            const data = await api.getOcrStats()
            // Sort by timestamp desc
            setStats(data.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()))
        } catch (e) {
            console.error('Failed to load stats', e)
        } finally {
            setLoading(false)
        }
    }

    // Calculate aggregations
    const totalDocs = stats.length

    // Safely calculate totals to avoid NaN
    const totalPages = stats.reduce((acc, curr) => acc + (curr.pages || 0), 0)

    const avgTime = totalDocs > 0
        ? stats.reduce((acc, curr) => acc + (curr.duration || 0), 0) / totalDocs
        : 0

    const avgTimePerPage = totalPages > 0
        ? stats.reduce((acc, curr) => acc + (curr.duration || 0), 0) / totalPages
        : 0

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

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <MetricCard
                    icon={<FileText className="w-5 h-5 text-blue-400" />}
                    label="Dokumente"
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
                                    <tr key={i} className="hover:bg-surface-700/20 transition-colors">
                                        <td className="px-6 py-4 text-surface-300 whitespace-nowrap">
                                            {new Date(stat.timestamp).toLocaleString()}
                                        </td>
                                        <td className="px-6 py-4 font-medium text-white">
                                            #{stat.doc_id}
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
