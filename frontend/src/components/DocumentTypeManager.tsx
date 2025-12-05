import React, { useState, useEffect } from 'react'
import { Sparkles, RefreshCw, Loader2, FileText, AlertCircle, Info, Trash2, X, Clock, Check, History, Zap, ChevronDown, ChevronUp, ExternalLink, Eye } from 'lucide-react'
import clsx from 'clsx'
import * as api from '../services/api'
import MergePreview from './MergePreview'

interface DocumentType {
  id: number
  name: string
  document_count: number
}

interface SimilarityGroup {
  suggested_name: string
  confidence: number
  members: DocumentType[]
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
  items_info?: string
  estimated_tokens: number
  token_limit?: number
  model?: string
  recommended_batches: number
  warning?: string
}

export default function DocumentTypeManager() {
  const [documentTypes, setDocumentTypes] = useState<DocumentType[]>([])
  const [groups, setGroups] = useState<SimilarityGroup[]>([])
  const [stats, setStats] = useState<AnalysisStats | null>(null)
  const [estimate, setEstimate] = useState<Estimate | null>(null)
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisCompleted, setAnalysisCompleted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ignoredItemIds, setIgnoredItemIds] = useState<number[]>([])
  const [view, setView] = useState<'list' | 'analyze'>('list')
  
  const [lastSync, setLastSync] = useState<Date | null>(null)
  const [, setTick] = useState(0) // Force re-render for time display
  
  // Saved Analysis
  const [savedAnalysis, setSavedAnalysis] = useState<api.SavedAnalysisInfo | null>(null)
  const [showLoadAnalysisModal, setShowLoadAnalysisModal] = useState(false)
  const [analysisLoadedAt, setAnalysisLoadedAt] = useState<string | null>(null)
  
  // Empty cleanup
  const [emptyCount, setEmptyCount] = useState<number>(0)
  const [emptyItems, setEmptyItems] = useState<DocumentType[]>([])
  const [selectedEmpty, setSelectedEmpty] = useState<Set<number>>(new Set())
  const [showCleanupModal, setShowCleanupModal] = useState(false)
  const [cleaningUp, setCleaningUp] = useState(false)
  const [cleanupResult, setCleanupResult] = useState<{ deleted: number; total: number; errors?: string[] } | null>(null)
  
  // AI Analysis Confirmation Modal
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [confirmEstimate, setConfirmEstimate] = useState<Estimate | null>(null)
  const [loadingEstimate, setLoadingEstimate] = useState(false)
  
  // Document preview in list view
  const [expandedRow, setExpandedRow] = useState<number | null>(null)
  const [previewDocs, setPreviewDocs] = useState<api.DocumentPreview[]>([])
  const [loadingPreview, setLoadingPreview] = useState(false)

  // Update time display every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 10000)
    return () => clearInterval(interval)
  }, [])
  
  // Load document previews when expanding a row
  const handleRowClick = async (docTypeId: number) => {
    if (expandedRow === docTypeId) {
      setExpandedRow(null)
      setPreviewDocs([])
      return
    }
    
    setExpandedRow(docTypeId)
    setLoadingPreview(true)
    try {
      const docs = await api.getDocumentPreviews({ document_type_id: docTypeId, limit: 6 })
      setPreviewDocs(docs)
    } catch (e) {
      console.error('Failed to load document previews:', e)
      setPreviewDocs([])
    } finally {
      setLoadingPreview(false)
    }
  }

  useEffect(() => {
    loadDocumentTypes()
  }, [])

  const loadDocumentTypes = async (forceRefresh: boolean = false) => {
    setLoading(true)
    setError(null)
    try {
      // Force refresh clears cache first
      if (forceRefresh) {
        await api.refreshPaperlessCache()
      }
      const data = await api.getDocumentTypes()
      setDocumentTypes(data)
      setLastSync(new Date())
      
      // Get estimate
      try {
        const est = await api.estimateDocumentTypes()
        setEstimate(est)
      } catch (e) {
        // Estimate is optional
      }
      
      // Load ignored items
      try {
        const ignored = await api.getIgnoredIds('document_type', 'similar')
        setIgnoredItemIds(ignored)
      } catch (e) {
        // Ignored items are optional
      }
      
      // Get empty items
      try {
        const empty = await api.getEmptyDocumentTypes()
        setEmptyCount(empty.count)
        setEmptyItems(empty.items || [])
        setSelectedEmpty(new Set((empty.items || []).map((dt: DocumentType) => dt.id)))
      } catch (e) {
        // Optional
      }
      
      // Check for saved analysis
      try {
        const saved = await api.getDocTypeSavedAnalysis()
        setSavedAnalysis(saved)
      } catch (e) {
        // Optional
      }
    } catch (err) {
      setError('Fehler beim Laden der Dokumententypen. Ist Paperless verbunden?')
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
    if (savedAnalysis?.exists) {
      setShowLoadAnalysisModal(true)
    } else {
      await openAnalysisConfirm()
    }
  }
  
  const loadSavedAnalysis = async () => {
    setShowLoadAnalysisModal(false)
    setAnalyzing(true)
    setError(null)
    try {
      const result = await api.loadDocTypeSavedAnalysis()
      setGroups(result.groups || [])
      setStats(result.stats || null)
      setAnalysisLoadedAt(result.created_at || null)
      setAnalysisCompleted(true)
      setView('analyze')
    } catch (err) {
      setError('Fehler beim Laden der gespeicherten Analyse')
    } finally {
      setAnalyzing(false)
    }
  }
  
  // Open confirmation modal before AI analysis
  const openAnalysisConfirm = async () => {
    setShowLoadAnalysisModal(false)
    setShowConfirmModal(true)
    setLoadingEstimate(true)
    setConfirmEstimate(null)
    
    try {
      const est = await api.estimateDocumentTypes()
      // Check if external LLM
      const isExternal = est.model ? !est.model.toLowerCase().includes('llama') && !est.model.toLowerCase().includes('mistral') && !est.model.toLowerCase().includes('local') : true
      setConfirmEstimate({ ...est, is_external: isExternal } as any)
    } catch (e) {
      setConfirmEstimate({
        items_info: `${documentTypes.length} Dokumententypen`,
        estimated_tokens: documentTypes.length * 20,
        token_limit: 128000,
        model: 'Unbekannt',
        recommended_batches: 1
      })
    } finally {
      setLoadingEstimate(false)
    }
  }
  
  const runNewAnalysis = async () => {
    setShowConfirmModal(false)
    setShowLoadAnalysisModal(false)
    setAnalyzing(true)
    setError(null)
    setStats(null)
    setAnalysisLoadedAt(null)
    try {
      const result = await api.analyzeDocumentTypes(200)
      setGroups(result.groups || [])
      setStats(result.stats || null)
      setAnalysisCompleted(true)
      setView('analyze')
      
      // Check for error in result
      if (result.error) {
        setError(`Analyse-Fehler: ${result.error}`)
      }
      
      const saved = await api.getDocTypeSavedAnalysis()
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
    await api.mergeDocumentTypes({ target_id: targetId, target_name: targetName, source_ids: sourceIds })
    
    // Remove the merged group from the list immediately (no reload needed!)
    if (groupIndex !== undefined) {
      setGroups(prev => prev.filter((_, i) => i !== groupIndex))
    }
    
    // Delete saved analysis since it's now outdated (fire & forget)
    api.deleteDocTypeSavedAnalysis().catch(() => {})
    setSavedAnalysis(null)
    
    // Don't reload - user can click "Aktualisieren" when done with all merges
  }

  const handleIgnoreItem = async (itemId: number, itemName: string) => {
    await api.addIgnoredItem({
      item_id: itemId,
      item_name: itemName,
      entity_type: 'document_type',
      analysis_type: 'similar',
      reason: 'Manuell ignoriert'
    })
    setIgnoredItemIds(prev => [...prev, itemId])
  }

  const handleCleanup = async () => {
    setCleaningUp(true)
    setCleanupResult(null)
    const toDelete = emptyItems.filter(dt => selectedEmpty.has(dt.id))
    const totalToDelete = toDelete.length
    
    let deleted = 0
    const errors: string[] = []
    
    for (const dt of toDelete) {
      try {
        await api.deleteDocumentType(dt.id)
        deleted++
      } catch (e) {
        errors.push(`${dt.name}: ${String(e)}`)
      }
    }
    
    setCleanupResult({ deleted, total: totalToDelete, errors: errors.length > 0 ? errors : undefined })
    
    // Record statistics if any deleted
    if (deleted > 0) {
      try {
        await api.recordStatistic('document_types', 'deleted', deleted, 0)
      } catch (e) {
        // Statistics are optional
      }
    }
    
    await loadDocumentTypes(true)
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
    setSelectedEmpty(new Set(emptyItems.map(dt => dt.id)))
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
            Dokumententypen
          </h2>
          <p className="text-surface-400 mt-1">
            {documentTypes.length} Dokumententypen in Paperless
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
            onClick={() => loadDocumentTypes(true)}
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
            disabled={analyzing || documentTypes.length === 0}
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
                <span className="ml-1 text-surface-100 font-medium">{estimate.items_info || 'Dokumententypen'}</span>
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
              onClick={openAnalysisConfirm}
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
            Liste ({documentTypes.length})
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
          entityType="document_types"
          analysisType="similar"
          onMerge={handleMerge}
          onIgnoreItem={handleIgnoreItem}
          ignoredItemIds={ignoredItemIds}
        />
      ) : view === 'analyze' && groups.length === 0 && analysisCompleted ? (
        <div className="card p-8 text-center">
          <div className="text-4xl mb-4">✅</div>
          <h3 className="text-xl font-semibold text-surface-200 mb-2">
            Keine ähnlichen Dokumententypen gefunden
          </h3>
          <p className="text-surface-400 mb-4">
            Die KI-Analyse hat keine Gruppen von ähnlichen Dokumententypen identifiziert, 
            die zusammengeführt werden könnten. Alle Dokumententypen sind einzigartig!
          </p>
          {stats && (
            <p className="text-sm text-surface-500">
              Analysiert: {stats.items_count} Dokumententypen • 
              Tokens: ~{stats.estimated_total_tokens?.toLocaleString() || 'N/A'}
            </p>
          )}
          <button
            onClick={() => setView('list')}
            className="mt-4 px-4 py-2 bg-surface-700 hover:bg-surface-600 rounded-lg text-surface-200 transition-colors"
          >
            Zurück zur Liste
          </button>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-surface-700">
                  <th className="px-4 py-3 text-left text-sm font-medium text-surface-400">Name</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-surface-400">Dokumente</th>
                  <th className="px-4 py-3 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-700/50">
                {documentTypes.map((docType) => (
                  <React.Fragment key={docType.id}>
                    <tr 
                      onClick={() => docType.document_count > 0 && handleRowClick(docType.id)}
                      className={clsx(
                        "transition-colors",
                        docType.document_count > 0 
                          ? "hover:bg-surface-700/30 cursor-pointer" 
                          : "opacity-60",
                        expandedRow === docType.id && "bg-surface-700/40"
                      )}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <FileText className="w-4 h-4 text-amber-400" />
                          <span className="text-surface-100">{docType.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-surface-400">
                        {docType.document_count}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {docType.document_count > 0 && (
                          expandedRow === docType.id 
                            ? <ChevronUp className="w-4 h-4 text-surface-400" />
                            : <ChevronDown className="w-4 h-4 text-surface-400" />
                        )}
                      </td>
                    </tr>
                    {expandedRow === docType.id && (
                      <tr>
                        <td colSpan={3} className="px-4 py-4 bg-surface-800/50">
                          {loadingPreview ? (
                            <div className="flex items-center justify-center py-4">
                              <Loader2 className="w-5 h-5 animate-spin text-primary-400" />
                              <span className="ml-2 text-surface-400">Lade Dokumente...</span>
                            </div>
                          ) : previewDocs.length > 0 ? (
                            <div>
                              <div className="flex items-center gap-2 mb-3 text-sm text-surface-400">
                                <Eye className="w-4 h-4" />
                                <span>Vorschau ({Math.min(previewDocs.length, 6)} von {docType.document_count} Dokumenten)</span>
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                {previewDocs.map(doc => (
                                  <a
                                    key={doc.id}
                                    href={doc.document_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="flex items-center gap-2 p-2 rounded bg-surface-700/50 hover:bg-surface-700 
                                              border border-surface-600/30 hover:border-primary-500/50 transition-all group"
                                  >
                                    <div className="w-10 h-10 rounded bg-surface-600 overflow-hidden flex-shrink-0">
                                      <img 
                                        src={doc.thumbnail_url}
                                        alt=""
                                        className="w-full h-full object-cover"
                                        onError={(e) => {
                                          (e.target as HTMLImageElement).style.display = 'none'
                                        }}
                                      />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-xs text-surface-200 truncate group-hover:text-primary-300">
                                        {doc.title}
                                      </p>
                                      <p className="text-[10px] text-surface-500">
                                        {new Date(doc.created).toLocaleDateString('de-DE')}
                                      </p>
                                    </div>
                                    <ExternalLink className="w-3 h-3 text-surface-500 group-hover:text-primary-400 flex-shrink-0" />
                                  </a>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <div className="text-center py-4 text-surface-400">
                              Keine Dokumente gefunden
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
          
          {documentTypes.length === 0 && (
            <div className="py-12 text-center text-surface-400">
              Keine Dokumententypen gefunden.
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
                onClick={openAnalysisConfirm}
                className="btn btn-secondary w-full flex items-center justify-center gap-2"
              >
                <Zap className="w-4 h-4" />
                Neue Analyse starten
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
                Leere Dokumententypen entfernen
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
                  <strong className="text-amber-400">{emptyCount} Dokumententypen</strong> mit 0 Dokumenten gefunden.
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
                  {emptyItems.map((dt) => (
                    <label
                      key={dt.id}
                      className={clsx(
                        'flex items-center gap-3 p-2 rounded cursor-pointer transition-colors',
                        selectedEmpty.has(dt.id) 
                          ? 'bg-amber-500/10 border border-amber-500/30' 
                          : 'hover:bg-surface-700/50'
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={selectedEmpty.has(dt.id)}
                        onChange={() => toggleSelectEmpty(dt.id)}
                        className="w-4 h-4 rounded border-surface-600 text-amber-500 focus:ring-amber-500"
                      />
                      <FileText className="w-4 h-4 text-surface-500" />
                      <span className="text-surface-200 flex-1 truncate">{dt.name}</span>
                      <span className="text-xs text-surface-500">0 Dok.</span>
                    </label>
                  ))}
                  {emptyItems.length === 0 && (
                    <p className="text-center text-surface-500 py-4">Keine leeren Dokumententypen.</p>
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
                    {cleanupResult.deleted} von {cleanupResult.total} Dokumententypen erfolgreich gelöscht!
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
      
      {/* AI Analysis Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-surface-800 rounded-xl p-6 w-full max-w-md mx-4 border border-surface-700 shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-primary-500/20 flex items-center justify-center">
                <Sparkles className="w-6 h-6 text-primary-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-surface-100">
                  KI-Analyse starten
                </h3>
                <p className="text-sm text-surface-400">Dokumententypen gruppieren</p>
              </div>
            </div>
            
            {loadingEstimate ? (
              <div className="py-8 text-center">
                <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary-400 mb-2" />
                <p className="text-surface-400">Berechne Token-Schätzung...</p>
              </div>
            ) : confirmEstimate && (
              <>
                <div className="bg-surface-700/50 rounded-lg p-4 mb-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-surface-400">Modell</span>
                    <span className="text-primary-400 font-medium">{confirmEstimate.model || 'Unbekannt'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-surface-400">Daten</span>
                    <span className="text-surface-200">{confirmEstimate.items_info || `${documentTypes.length} Items`}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-surface-400">Geschätzte Tokens</span>
                    <span className="text-surface-200">~{confirmEstimate.estimated_tokens.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-surface-400">Token-Limit</span>
                    <span className="text-surface-200">{(confirmEstimate.token_limit || 128000).toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-surface-400">Auslastung</span>
                    <span className={clsx(
                      'px-2 py-0.5 rounded text-xs font-medium',
                      confirmEstimate.estimated_tokens > (confirmEstimate.token_limit || 128000) * 0.8 
                        ? 'bg-amber-500/20 text-amber-400' 
                        : 'bg-emerald-500/20 text-emerald-400'
                    )}>
                      {Math.round(confirmEstimate.estimated_tokens / (confirmEstimate.token_limit || 128000) * 100)}%
                    </span>
                  </div>
                </div>
                
                {confirmEstimate.warning && (
                  <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg mb-4">
                    <p className="text-amber-400 text-sm">⚠️ {confirmEstimate.warning}</p>
                  </div>
                )}
                
                {(confirmEstimate as any).is_external && (
                  <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg mb-4">
                    <p className="text-blue-400 text-sm flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                      <span>
                        <strong>Hinweis:</strong> Du verwendest einen externen LLM-Anbieter. 
                        Deine Dokumententyp-Namen werden zur Analyse übertragen.
                      </span>
                    </p>
                  </div>
                )}
              </>
            )}
            
            <div className="flex gap-3 justify-end mt-4">
              <button
                onClick={() => setShowConfirmModal(false)}
                className="btn btn-secondary"
              >
                Abbrechen
              </button>
              <button
                onClick={runNewAnalysis}
                disabled={loadingEstimate}
                className="btn btn-primary flex items-center gap-2"
              >
                <Sparkles className="w-4 h-4" />
                Analyse starten
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
