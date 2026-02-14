import { useState, useEffect } from 'react'
import { Plus, Trash2, Save, Wifi, CheckCircle2, XCircle, Loader2, Server, Clock, Zap } from 'lucide-react'
import * as api from '../services/api'
import clsx from 'clsx'

export default function OcrSettings() {
    const [ollamaUrls, setOllamaUrls] = useState<string[]>(['http://localhost:11434'])
    const [newUrl, setNewUrl] = useState('')
    const [ocrModel, setOcrModel] = useState('qwen2.5vl:7b')
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [testing, setTesting] = useState(false)
    const [connectionStatus, setConnectionStatus] = useState<api.OcrConnectionResult | null>(null)
    const [watchdogEnabled, setWatchdogEnabled] = useState(false)
    const [watchdogInterval, setWatchdogInterval] = useState(5)
    const [editingIndex, setEditingIndex] = useState<number | null>(null)
    const [editValue, setEditValue] = useState('')

    useEffect(() => {
        loadSettings()
    }, [])

    const loadSettings = async () => {
        try {
            const settings = await api.getOcrSettings()
            if (settings.ollama_urls && settings.ollama_urls.length > 0) {
                setOllamaUrls(settings.ollama_urls)
            } else {
                setOllamaUrls([settings.ollama_url])
            }
            setOcrModel(settings.model)
            if (settings.watchdog_enabled !== undefined) {
                setWatchdogEnabled(settings.watchdog_enabled)
                setWatchdogInterval(settings.watchdog_interval || 5)
            }
        } catch (e) {
            console.error('Failed to load settings', e)
        } finally {
            setLoading(false)
        }
    }

    const addUrl = async () => {
        if (newUrl && !ollamaUrls.includes(newUrl)) {
            const updatedUrls = [...ollamaUrls, newUrl]
            setOllamaUrls(updatedUrls)
            setNewUrl('')
            // Auto-save
            const primaryUrl = updatedUrls.length > 0 ? updatedUrls[0] : 'http://localhost:11434'
            await api.saveOcrSettings({
                ollama_url: primaryUrl,
                ollama_urls: updatedUrls,
                model: ocrModel
            })
        }
    }

    const removeUrl = async (url: string) => {
        const updatedUrls = ollamaUrls.filter(u => u !== url)
        setOllamaUrls(updatedUrls)
        // Auto-save
        const primaryUrl = updatedUrls.length > 0 ? updatedUrls[0] : 'http://localhost:11434'
        await api.saveOcrSettings({
            ollama_url: primaryUrl,
            ollama_urls: updatedUrls,
            model: ocrModel
        })
    }

    const startEditing = (index: number) => {
        setEditingIndex(index)
        setEditValue(ollamaUrls[index])
    }

    const saveEdit = async () => {
        if (editingIndex !== null && editValue.trim()) {
            const updatedUrls = [...ollamaUrls]
            updatedUrls[editingIndex] = editValue.trim()
            setOllamaUrls(updatedUrls)
            setEditingIndex(null)
            // Auto-save
            const primaryUrl = updatedUrls.length > 0 ? updatedUrls[0] : 'http://localhost:11434'
            await api.saveOcrSettings({
                ollama_url: primaryUrl,
                ollama_urls: updatedUrls,
                model: ocrModel
            })
        }
    }

    const cancelEdit = () => {
        setEditingIndex(null)
    }

    const saveSettings = async () => {
        setSaving(true)
        try {
            const primaryUrl = ollamaUrls.length > 0 ? ollamaUrls[0] : 'http://localhost:11434'
            await api.saveOcrSettings({
                ollama_url: primaryUrl,
                ollama_urls: ollamaUrls,
                model: ocrModel
            })
            // Save watchdog settings separately
            await api.setWatchdogSettings(watchdogEnabled, watchdogInterval)
        } catch (e) {
            console.error('Failed to save settings', e)
        } finally {
            setSaving(false)
        }
    }

    const testConnection = async () => {
        setTesting(true)
        setConnectionStatus(null)
        try {
            await saveSettings()
            const result = await api.testOcrConnection()
            setConnectionStatus(result)
        } catch (e) {
            setConnectionStatus({ connected: false, model_available: false, error: String(e) })
        } finally {
            setTesting(false)
        }
    }

    if (loading) return (
        <div className="flex items-center justify-center p-12 text-surface-400">
            <Loader2 className="w-6 h-6 animate-spin mr-3" />
            <span>Lade Einstellungen...</span>
        </div>
    )

    return (
        <div className="card p-0 overflow-hidden border border-surface-700/50 shadow-xl shadow-black/20 bg-surface-800/40 backdrop-blur-sm">
            <div className="p-6 border-b border-surface-700/50 bg-surface-800/50">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-500/20 rounded-lg">
                        <Server className="w-5 h-5 text-blue-400" />
                    </div>
                    <div>
                        <h3 className="font-bold text-lg text-white">OCR Server Konfiguration</h3>
                        <p className="text-sm text-surface-400">Multi-Server Setup & Failover</p>
                    </div>
                </div>
            </div>

            <div className="p-6 space-y-8">
                {/* URLs List */}
                <div>
                    <label className="block text-sm font-medium text-surface-300 mb-3">
                        Ollama Server URLs (Priorität von oben nach unten)
                    </label>
                    <div className="space-y-2 mb-3">
                        {ollamaUrls.map((url, index) => (
                            <div key={index} className="group flex items-center gap-2 p-2 rounded-lg bg-surface-900/50 border border-surface-700/50 hover:border-surface-600 transition-colors">
                                <div className="flex-1 px-2 text-sm text-surface-200 flex items-center justify-between font-mono">
                                    {editingIndex === index ? (
                                        <div className="flex-1 flex gap-2">
                                            <input
                                                type="text"
                                                value={editValue}
                                                onChange={(e) => setEditValue(e.target.value)}
                                                className="flex-1 bg-surface-900 border-blue-500 rounded px-2 py-0.5 text-sm"
                                                autoFocus
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') saveEdit()
                                                    if (e.key === 'Escape') cancelEdit()
                                                }}
                                            />
                                            <button onClick={saveEdit} className="text-emerald-400 hover:text-emerald-300">Save</button>
                                            <button onClick={cancelEdit} className="text-surface-500 hover:text-surface-400">Cancel</button>
                                        </div>
                                    ) : (
                                        <>
                                            <span className="truncate">{url}</span>
                                            <div className="flex items-center gap-2">
                                                {index === 0 && (
                                                    <span className="text-[10px] uppercase font-bold tracking-wider bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded">
                                                        Primär
                                                    </span>
                                                )}
                                                <button
                                                    onClick={() => startEditing(index)}
                                                    className="opacity-0 group-hover:opacity-100 text-[10px] uppercase font-bold text-surface-500 hover:text-white transition-all"
                                                >
                                                    Edit
                                                </button>
                                            </div>
                                        </>
                                    )}
                                </div>
                                <button
                                    onClick={() => removeUrl(url)}
                                    className="p-1.5 text-surface-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                                    title="Entfernen"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        ))}
                    </div>

                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={newUrl}
                            onChange={(e) => setNewUrl(e.target.value)}
                            placeholder="http://192.168.1.x:11434"
                            className="flex-1 input bg-surface-900/50 border-surface-700 focus:border-blue-500 font-mono text-sm"
                            onKeyDown={(e) => e.key === 'Enter' && addUrl()}
                        />
                        <button
                            onClick={addUrl}
                            disabled={!newUrl}
                            className="btn bg-surface-700 hover:bg-surface-600 text-white border-surface-600 px-4 flex items-center gap-2"
                        >
                            <Plus className="w-4 h-4" />
                            <span className="hidden sm:inline">Hinzufügen</span>
                        </button>
                    </div>
                    <p className="text-xs text-surface-500 mt-2 flex items-center gap-1">
                        <Wifi className="w-3 h-3" />
                        Automatisch Failover auf Backup-Server bei Verbindungsproblemen.
                    </p>
                </div>

                {/* Model */}
                <div>
                    <label className="block text-sm font-medium text-surface-300 mb-2">
                        OCR Modell <span className="text-surface-500 font-normal">(muss auf allen Servern installiert sein)</span>
                    </label>
                    <input
                        type="text"
                        value={ocrModel}
                        onChange={(e) => setOcrModel(e.target.value)}
                        className="w-full input bg-surface-900/50 border-surface-700 focus:border-blue-500 font-mono text-sm"
                        placeholder="qwen2.5vl:7b"
                    />
                </div>

                {/* Watchdog / Continuous Mode */}
                <div className="pt-6 border-t border-surface-700/50">
                    <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                        <Clock className="w-5 h-5 text-purple-400" />
                        Dauerhafter Hintergrund-Modus (Watchdog)
                    </h3>

                    <div className="bg-surface-900/30 rounded-xl p-4 border border-surface-700/50 space-y-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <label className="text-sm font-medium text-surface-200 block">Automatische Überwachung</label>
                                <p className="text-xs text-surface-500">Prüft regelmäßig auf neue Dokumente ohne OCR-Status</p>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="sr-only peer"
                                    checked={watchdogEnabled}
                                    onChange={(e) => setWatchdogEnabled(e.target.checked)}
                                />
                                <div className="w-11 h-6 bg-surface-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                            </label>
                        </div>

                        {watchdogEnabled && (
                            <div className="animate-in slide-in-from-top-2">
                                <label className="block text-sm font-medium text-surface-300 mb-2">
                                    Prüf-Intervall (Minuten)
                                </label>
                                <input
                                    type="number"
                                    min="1"
                                    max="60"
                                    value={watchdogInterval}
                                    onChange={(e) => setWatchdogInterval(parseInt(e.target.value) || 5)}
                                    className="w-full input bg-surface-900/50 border-surface-700 focus:border-purple-500 font-mono text-sm"
                                />
                            </div>
                        )}

                        <div className="flex items-center gap-2 text-xs text-surface-400 bg-surface-800/50 p-2 rounded border border-surface-700/50">
                            <Zap className="w-3 h-3 text-amber-400" />
                            <span>Startet automatisch beim Hochfahren des Containers, wenn aktiviert.</span>
                        </div>
                    </div>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-between pt-6 border-t border-surface-700/50">
                    <button
                        onClick={testConnection}
                        disabled={testing}
                        className="btn bg-surface-800 hover:bg-surface-700 text-surface-200 border-surface-700 flex items-center gap-2"
                    >
                        {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
                        Verbindung testen
                    </button>

                    <button
                        onClick={saveSettings}
                        disabled={saving}
                        className="btn btn-primary flex items-center gap-2 shadow-lg shadow-blue-900/20"
                    >
                        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Speichern
                    </button>
                </div>

                {/* Status Result */}
                {connectionStatus && (
                    <div className={clsx(
                        "p-4 rounded-xl border text-sm transition-all animate-in zoom-in-95",
                        connectionStatus.connected
                            ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-200"
                            : "bg-red-500/10 border-red-500/20 text-red-200"
                    )}>
                        <h4 className="font-bold flex items-center gap-2 mb-2">
                            {connectionStatus.connected
                                ? <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                                : <XCircle className="w-5 h-5 text-red-400" />
                            }
                            {connectionStatus.connected ? "Verbindung erfolgreich" : "Verbindung fehlgeschlagen"}
                        </h4>

                        {!connectionStatus.connected && (
                            <p className="text-red-300/80 ml-7">{connectionStatus.error}</p>
                        )}

                        {connectionStatus.connected && (
                            <div className="ml-7 grid grid-cols-2 gap-x-8 gap-y-1 text-xs opacity-80">
                                <div className="flex justify-between">
                                    <span>Server erreichbar:</span>
                                    <span className="font-bold">Ja</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Modell verfügbar:</span>
                                    <span className={clsx("font-bold", connectionStatus.model_available ? "text-emerald-400" : "text-amber-400")}>
                                        {connectionStatus.model_available ? "Ja" : "Nein (Download erforderlich)"}
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div >
    )
}
