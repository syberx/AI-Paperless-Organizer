import { useState, useEffect } from 'react'
import { Sparkles, RefreshCw, Loader2, Users, AlertCircle, Info, Trash2, X, Clock, Check, History, Zap } from 'lucide-react'
import clsx from 'clsx'
import * as api from '../services/api'
import MergePreview from './MergePreview'

interface Correspondent {
  id: number
  name: string
  document_count: number
}

interface SimilarityGroup {
  suggested_name: string
  confidence: number
  members: Correspondent[]
  reasoning: string
}

interface AnalysisStats {
  items_count: number
  estimated_input_tokens: number
  estimated_output_tokens: number
  estimated_total_tokens: number
  batches_processed?: number
  batches_total?: number
  cross_batch_phase?: boolean
  groups_before_merge?: number
  groups_after_merge?: number
  warning?: string
}

interface Estimate {
  items_count: number
  estimated_tokens: number
  token_limit?: number
  recommended_batches: number
  warning?: string
}

export default function CorrespondentManager() {
  const [correspondents, setCorrespondents] = useState<Correspondent[]>([])
  const [groups, setGroups] = useState<SimilarityGroup[]>([])
  const [stats, setStats] = useState<AnalysisStats | null>(null)
  const [estimate, setEstimate] = useState<Estimate | null>(null)
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'list' | 'analyze'>('list')
  const [lastSync, setLastSync] = useState<Date | null>(null)
  const [, setTick] = useState(0) // Force re-render for time display
  
  // Saved Analysis
  const [savedAnalysis, setSavedAnalysis] = useState<api.SavedAnalysisInfo | null>(null)
  const [showLoadAnalysisModal, setShowLoadAnalysisModal] = useState(false)
  const [analysisLoadedAt, setAnalysisLoadedAt] = useState<string | null>(null)
  
  // Empty cleanup
  const [emptyCount, setEmptyCount] = useState<number>(0)
  const [emptyItems, setEmptyItems] = useState<Correspondent[]>([])
  const [selectedEmpty, setSelectedEmpty] = useState<Set<number>>(new Set())
  const [showCleanupModal, setShowCleanupModal] = useState(false)
  const [cleaningUp, setCleaningUp] = useState(false)
  const [cleanupResult, setCleanupResult] = useState<{ deleted: number; total: number; errors?: string[] } | null>(null)

  // Update time display every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 10000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    loadCorrespondents()
  }, [])

  const loadCorrespondents = async (forceRefresh: boolean = false) => {
    setLoading(true)
    setError(null)
    try {
      // Force refresh clears cache first
      if (forceRefresh) {
        await api.refreshPaperlessCache()
      }
      const data = await api.getCorrespondents()
      setCorrespondents(data)
      setLastSync(new Date())
      
      // Get estimate
      try {
        const est = await api.estimateCorrespondents()
        setEstimate(est)
      } catch (e) {
        // Estimate is optional
      }
      
      // Get empty items
      try {
        const empty = await api.getEmptyCorrespondents()
        setEmptyCount(empty.count)
        setEmptyItems(empty.items || [])
        setSelectedEmpty(new Set((empty.items || []).map((c: Correspondent) => c.id)))
      } catch (e) {
        // Optional
      }
      
      // Check for saved analysis
      try {
        const saved = await api.getCorrespondentSavedAnalysis()
        setSavedAnalysis(saved)
      } catch (e) {
        // Optional
      }
    } catch (err) {
      setError('Fehler beim Laden der Korrespondenten. Ist Paperless verbunden?')
    } finally {
      setLoading(false)
    }
  }

  const formatLastSync = () => {
    if (!lastSync) return 'Nie'
    const now = new Date()
    const diffMs = now.getTime() - lastSync.getTime()
    const diffSec = Math.floor(diffMs / 1000)
    const diffMin = Math.floor(diffSec / 60)
    
    if (diffSec < 60) return `vor ${diffSec}s`
    if (diffMin < 60) return `vor ${diffMin}m`
    return lastSync.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  }

  const handleAnalyzeClick = async () => {
    // Check if there's a saved analysis
    if (savedAnalysis?.exists) {
      setShowLoadAnalysisModal(true)
    } else {
      await runNewAnalysis()
    }
  }
  
  const loadSavedAnalysis = async () => {
    setShowLoadAnalysisModal(false)
    setAnalyzing(true)
    setError(null)
    try {
      const result = await api.loadCorrespondentSavedAnalysis()
      setGroups(result.groups || [])
      setStats(result.stats || null)
      setAnalysisLoadedAt(result.created_at || null)
      setView('analyze')
    } catch (err) {
      setError('Fehler beim Laden der gespeicherten Analyse')
    } finally {
      setAnalyzing(false)
    }
  }
  
  const runNewAnalysis = async () => {
    setShowLoadAnalysisModal(false)
    setAnalyzing(true)
    setError(null)
    setStats(null)
    setAnalysisLoadedAt(null)
    try {
      const result = await api.analyzeCorrespondents(200)
      setGroups(result.groups || [])
      setStats(result.stats || null)
      setView('analyze')
      
      // Refresh saved analysis info
      const saved = await api.getCorrespondentSavedAnalysis()
      setSavedAnalysis(saved)
      
      if (result.error) {
        setError(`Analyse-Fehler: ${result.error}`)
      }
    } catch (err) {
      setError('Fehler bei der Analyse. Ist ein LLM Provider konfiguriert?')
    } finally {
      setAnalyzing(false)
    }
  }

  const handleMerge = async (targetId: number, targetName: string, sourceIds: number[], groupIndex?: number) => {
    await api.mergeCorrespondents({ target_id: targetId, target_name: targetName, source_ids: sourceIds })
    
    // Remove the merged group from the list immediately (no reload needed!)
    if (groupIndex !== undefined) {
      setGroups(prev => prev.filter((_, i) => i !== groupIndex))
    }
    
    // Delete saved analysis since it's now outdated (fire & forget)
    api.deleteCorrespondentSavedAnalysis().catch(() => {})
    setSavedAnalysis(null)
    
    // Don't reload - user can click "Aktualisieren" when done with all merges
  }

  const handleCleanup = async () => {
    setCleaningUp(true)
    setCleanupResult(null)
    const toDelete = emptyItems.filter(c => selectedEmpty.has(c.id))
    const totalToDelete = toDelete.length
    
    let deleted = 0
    const errors: string[] = []
    
    for (const c of toDelete) {
      try {
        await api.deleteCorrespondent(c.id)
        deleted++
      } catch (e) {
        errors.push(`${c.name}: ${String(e)}`)
      }
    }
    
    setCleanupResult({ deleted, total: totalToDelete, errors: errors.length > 0 ? errors : undefined })
    
    // Record statistics if any deleted
    if (deleted > 0) {
      try {
        await api.recordStatistic('correspondents', 'deleted', deleted, 0)
      } catch (e) {
        // Statistics are optional
      }
    }
    
    await loadCorrespondents(true)
    setCleaningUp(false)
  }

  const toggleSelectEmpty = (id: number) => {
    setSelectedEmpty(prev => {
      const newSet = new Set(prev)
      if (newSet.has(id)) {
        newSet.delete(id)
      } else {
        newSet.add(id)
      }
      return newSet
    })
  }

  const selectAllEmpty = () => {
    setSelectedEmpty(new Set(emptyItems.map(c => c.id)))
  }

  const deselectAllEmpty = () => {
    setSelectedEmpty(new Set())
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-bold text-surface-100">
            Korrespondenten
          </h2>
          <p className="text-surface-400 mt-1">
            {correspondents.length} Korrespondenten in Paperless
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          {emptyCount > 0 && (
            <button
              onClick={() => setShowCleanupModal(true)}
              className="btn btn-secondary flex items-center gap-2 text-amber-400 border-amber-500/50 hover:bg-amber-500/10"
            >
              <Trash2 className="w-4 h-4" />
              {emptyCount} Leere entfernen
            </button>
          )}
          <button
            onClick={() => loadCorrespondents(true)}
            disabled={loading}
            className="btn btn-secondary flex items-center gap-2 group"
          >
            <RefreshCw className={clsx('w-4 h-4 transition-transform group-hover:rotate-180', loading && 'animate-spin')} />
            <span className="flex items-center gap-2">
              Aktualisieren
              <span className="text-xs text-surface-500 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {formatLastSync()}
              </span>
            </span>
          </button>
          <button
            onClick={handleAnalyzeClick}
            disabled={analyzing || correspondents.length === 0}
            className="btn btn-primary flex items-center gap-2"
          >
            {analyzing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Analysiere...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Mit KI analysieren
                {savedAnalysis?.exists && (
                  <span className="ml-1 px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 text-xs">
                    ✓ gespeichert
                  </span>
                )}
              </>
            )}
          </button>
        </div>
      </div>

      {/* Estimate Preview (before analysis) */}
      {estimate && !stats && (
        <div className={clsx(
          'card p-4 flex items-start gap-3',
          estimate.warning ? 'border-amber-500/50 bg-amber-500/10' : 'border-surface-600/50'
        )}>
          <Info className="w-5 h-5 text-primary-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <div className="flex flex-wrap gap-4">
              <span>
                <span className="text-surface-400">Items:</span>
                <span className="ml-1 text-surface-100 font-medium">{estimate.items_count}</span>
              </span>
              <span>
                <span className="text-surface-400">Tokens:</span>
                <span className="ml-1 text-surface-100 font-medium">
                  ~{estimate.estimated_tokens.toLocaleString()}
                  {estimate.token_limit && (
                    <span className="text-surface-500"> / {(estimate.token_limit / 1000).toFixed(0)}k Limit</span>
                  )}
                </span>
              </span>
              {estimate.recommended_batches > 1 && (
                <span className="text-amber-400">
                  Wird in {estimate.recommended_batches} Batches aufgeteilt
                </span>
              )}
            </div>
            {estimate.warning && (
              <div className="mt-2 text-amber-400">{estimate.warning}</div>
            )}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
          <p className="text-red-400">{error}</p>
        </div>
      )}

      {/* Stats (after analysis) */}
      {stats && (
        <div className={clsx(
          'card p-4',
          stats.warning ? 'border-amber-500/50 bg-amber-500/10' : 'border-surface-600/50'
        )}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-4 text-sm">
              {analysisLoadedAt && (
                <div className="flex items-center gap-1 px-2 py-1 rounded bg-primary-500/10 border border-primary-500/30">
                  <History className="w-3 h-3 text-primary-400" />
                  <span className="text-primary-400 text-xs">
                    Geladen: {new Date(analysisLoadedAt).toLocaleString('de-DE')}
                  </span>
                </div>
              )}
              <div>
                <span className="text-surface-400">Items:</span>
                <span className="ml-2 text-surface-100 font-medium">{stats.items_count}</span>
              </div>
              <div>
                <span className="text-surface-400">Tokens:</span>
                <span className="ml-2 text-surface-100 font-medium">
                  ~{stats.estimated_total_tokens?.toLocaleString() || 0}
                </span>
              </div>
              {stats.batches_total && stats.batches_total > 1 && (
                <div>
                  <span className="text-surface-400">Batches:</span>
                  <span className="ml-2 text-surface-100 font-medium">
                    {stats.batches_processed}/{stats.batches_total}
                  </span>
                </div>
              )}
              {stats.cross_batch_phase && (
                <div>
                  <span className="text-emerald-400">Cross-Batch:</span>
                  <span className="ml-2 text-surface-100 font-medium">
                    {stats.groups_before_merge} → {stats.groups_after_merge}
                  </span>
                </div>
              )}
            </div>
            <button
              onClick={runNewAnalysis}
              disabled={analyzing}
              className="btn btn-secondary btn-sm flex items-center gap-2"
            >
              <Zap className="w-4 h-4" />
              NEU analysieren
            </button>
          </div>
          {stats.warning && (
            <div className="mt-2 text-sm text-amber-400">
              {stats.warning}
            </div>
          )}
        </div>
      )}

      {/* View Toggle */}
      {groups.length > 0 && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => setView('list')}
            className={clsx(
              'px-4 py-2 rounded-lg font-medium transition-colors',
              view === 'list' 
                ? 'bg-surface-700 text-surface-100' 
                : 'text-surface-400 hover:text-surface-200'
            )}
          >
            Liste ({correspondents.length})
          </button>
          <button
            onClick={() => setView('analyze')}
            className={clsx(
              'px-4 py-2 rounded-lg font-medium transition-colors',
              view === 'analyze' 
                ? 'bg-surface-700 text-surface-100' 
                : 'text-surface-400 hover:text-surface-200'
            )}
          >
            Vorschläge ({groups.length})
          </button>
        </div>
      )}

      {/* Content */}
      {view === 'analyze' && groups.length > 0 ? (
        <MergePreview 
          groups={groups} 
          entityType="correspondents"
          onMerge={handleMerge}
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-surface-700">
                  <th className="px-4 py-3 text-left text-sm font-medium text-surface-400">Name</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-surface-400">Dokumente</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-700/50">
                {correspondents.map((correspondent) => (
                  <tr 
                    key={correspondent.id}
                    className="hover:bg-surface-700/30 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Users className="w-4 h-4 text-surface-500" />
                        <span className="text-surface-100">{correspondent.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-surface-400">
                      {correspondent.document_count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          {correspondents.length === 0 && (
            <div className="py-12 text-center text-surface-400">
              Keine Korrespondenten gefunden.
            </div>
          )}
        </div>
      )}

      {/* Load Saved Analysis Modal */}
      {showLoadAnalysisModal && savedAnalysis?.exists && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="card p-6 max-w-md w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display font-semibold text-lg text-surface-100 flex items-center gap-2">
                <History className="w-5 h-5 text-primary-400" />
                Gespeicherte Analyse gefunden
              </h3>
              <button 
                onClick={() => setShowLoadAnalysisModal(false)}
                className="text-surface-400 hover:text-surface-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-4 rounded-lg bg-surface-800/50 border border-surface-700 mb-6">
              <p className="text-surface-300 mb-3">
                Es gibt eine gespeicherte Analyse:
              </p>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-surface-400">Erstellt am:</span>
                  <span className="text-surface-100">
                    {savedAnalysis.created_at 
                      ? new Date(savedAnalysis.created_at).toLocaleString('de-DE') 
                      : 'Unbekannt'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-surface-400">Gruppen gefunden:</span>
                  <span className="text-surface-100">{savedAnalysis.groups_count || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-surface-400">Analysierte Items:</span>
                  <span className="text-surface-100">{savedAnalysis.items_count || 0}</span>
                </div>
              </div>
            </div>
            
            <div className="space-y-3">
              <button
                onClick={loadSavedAnalysis}
                className="btn btn-primary w-full flex items-center justify-center gap-2"
              >
                <History className="w-4 h-4" />
                Gespeicherte Analyse laden
                <span className="text-xs opacity-75">(kostenlos)</span>
              </button>
              <button
                onClick={runNewAnalysis}
                className="btn btn-secondary w-full flex items-center justify-center gap-2"
              >
                <Zap className="w-4 h-4" />
                Neue Analyse starten
                <span className="text-xs opacity-75">(KI-Kosten)</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cleanup Modal */}
      {showCleanupModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="card p-6 max-w-lg w-full mx-4 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display font-semibold text-lg text-surface-100">
                Leere Korrespondenten entfernen
              </h3>
              <button 
                onClick={() => {
                  setShowCleanupModal(false)
                  setCleanupResult(null)
                }}
                className="p-1 hover:bg-surface-700 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {!cleanupResult ? (
              <>
                <p className="text-surface-300 mb-2">
                  <strong className="text-amber-400">{emptyCount} Korrespondenten</strong> mit 0 Dokumenten gefunden.
                </p>
                <p className="text-surface-500 text-sm mb-4">
                  Wähle aus, welche gelöscht werden sollen:
                </p>
                
                {/* Selection controls */}
                <div className="flex gap-2 mb-3">
                  <button onClick={selectAllEmpty} className="text-xs text-primary-400 hover:text-primary-300">
                    Alle auswählen
                  </button>
                  <span className="text-surface-600">|</span>
                  <button onClick={deselectAllEmpty} className="text-xs text-surface-400 hover:text-surface-300">
                    Keine
                  </button>
                  <span className="ml-auto text-xs text-surface-500">
                    {selectedEmpty.size} von {emptyItems.length} ausgewählt
                  </span>
                </div>
                
                {/* List of empty items */}
                <div className="flex-1 overflow-y-auto max-h-64 space-y-1 mb-4 border border-surface-700 rounded-lg p-2">
                  {emptyItems.map((c) => (
                    <label
                      key={c.id}
                      className={clsx(
                        'flex items-center gap-3 p-2 rounded cursor-pointer transition-colors',
                        selectedEmpty.has(c.id) 
                          ? 'bg-amber-500/10 border border-amber-500/30' 
                          : 'hover:bg-surface-700/50'
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={selectedEmpty.has(c.id)}
                        onChange={() => toggleSelectEmpty(c.id)}
                        className="w-4 h-4 rounded border-surface-600 text-amber-500 focus:ring-amber-500"
                      />
                      <Users className="w-4 h-4 text-surface-500" />
                      <span className="text-surface-200 flex-1 truncate">{c.name}</span>
                      <span className="text-xs text-surface-500">0 Dok.</span>
                    </label>
                  ))}
                  {emptyItems.length === 0 && (
                    <p className="text-center text-surface-500 py-4">Keine leeren Korrespondenten.</p>
                  )}
                </div>
                
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowCleanupModal(false)}
                    className="btn btn-secondary flex-1"
                  >
                    Abbrechen
                  </button>
                  <button
                    onClick={handleCleanup}
                    disabled={cleaningUp || selectedEmpty.size === 0}
                    className="btn btn-danger flex-1 flex items-center justify-center gap-2"
                  >
                    {cleaningUp ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Lösche...
                      </>
                    ) : (
                      <>
                        <Trash2 className="w-4 h-4" />
                        {selectedEmpty.size} löschen
                      </>
                    )}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className={clsx(
                  'p-4 rounded-lg mb-4',
                  cleanupResult.errors?.length 
                    ? 'bg-amber-500/10 border border-amber-500/30'
                    : 'bg-emerald-500/10 border border-emerald-500/30'
                )}>
                  <p className={clsx(
                    'flex items-center gap-2',
                    cleanupResult.errors?.length ? 'text-amber-400' : 'text-emerald-400'
                  )}>
                    <Check className="w-5 h-5" />
                    {cleanupResult.deleted} von {cleanupResult.total} Korrespondenten erfolgreich gelöscht!
                  </p>
                  {cleanupResult.errors && cleanupResult.errors.length > 0 && (
                    <div className="mt-2 text-sm text-surface-400">
                      <p>Fehler:</p>
                      <ul className="list-disc list-inside">
                        {cleanupResult.errors.slice(0, 5).map((e, i) => (
                          <li key={i}>{e}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => {
                    setShowCleanupModal(false)
                    setCleanupResult(null)
                  }}
                  className="btn btn-primary w-full"
                >
                  Schließen
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
