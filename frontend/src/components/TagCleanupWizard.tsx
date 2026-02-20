import { useState, useEffect } from 'react'
import { 
  Sparkles, Loader2, Tag, AlertCircle, Trash2,
  ChevronRight, ChevronLeft, Check, Users, FileText, Layers, RefreshCw, Brain,
  Shield, Plus, X, Ban, Eye, ExternalLink
} from 'lucide-react'
import clsx from 'clsx'
import * as api from '../services/api'

// Confirmation modal for AI analysis
interface AnalysisConfirmInfo {
  step: number
  stepName: string
  analysisType: 'nonsense' | 'correspondent' | 'doctype' | 'similar'
}

interface IgnoredTag {
  id: number
  pattern: string
  reason: string
  is_regex: boolean
}

interface TagItem {
  id: number
  name: string
  document_count: number
}

interface NonsenseTag {
  id: number
  name: string
  document_count: number
  confidence: number
  reason: string
}

interface CorrespondentMatch {
  tag_id: number
  tag_name: string
  document_count: number
  suggested_correspondent: string
  correspondent_id: number | null
  correspondent_exists: boolean
  confidence: number
  reason: string
}

interface DoctypeMatch {
  tag_id: number
  tag_name: string
  document_count: number
  suggested_doctype: string
  doctype_id: number | null
  doctype_exists: boolean
  confidence: number
  reason: string
}

interface StepStatus {
  completed: boolean
  skipped: boolean
  analyzed?: boolean
  result?: {
    deleted?: number
    total?: number
    converted?: number
    merged?: number
  }
}

const STEPS = [
  { id: 1, title: 'Leere Tags löschen', icon: Trash2, description: 'Tags mit 0 Dokumenten entfernen', needsAI: false },
  { id: 2, title: 'Unsinnige Tags', icon: AlertCircle, description: 'KI identifiziert sinnlose Tags', needsAI: true },
  { id: 3, title: 'Korrespondenten-Tags', icon: Users, description: 'KI findet Tags die Firmen/Personen sind', needsAI: true },
  { id: 4, title: 'Dokumententyp-Tags', icon: FileText, description: 'KI findet Tags die Dokumententypen sind', needsAI: true },
  { id: 5, title: 'Ähnliche zusammenlegen', icon: Layers, description: 'KI findet Duplikate und Varianten', needsAI: true },
]

export default function TagCleanupWizard() {
  const [currentStep, setCurrentStep] = useState(1)
  const [stepStatus, setStepStatus] = useState<Record<number, StepStatus>>({})
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [loadTime, setLoadTime] = useState<number | null>(null)
  const [cachedInfo, setCachedInfo] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null)
  
  // Data
  const [tags, setTags] = useState<TagItem[]>([])
  
  // Step-specific data
  const [emptyTags, setEmptyTags] = useState<TagItem[]>([])
  const [nonsenseTags, setNonsenseTags] = useState<NonsenseTag[]>([])
  const [correspondentMatches, setCorrespondentMatches] = useState<CorrespondentMatch[]>([])
  const [docTypeMatches, setDocTypeMatches] = useState<DoctypeMatch[]>([])
  const [similarGroups, setSimilarGroups] = useState<any[]>([])
  
  // Selection states
  const [selectedEmpty, setSelectedEmpty] = useState<Set<number>>(new Set())
  const [selectedNonsense, setSelectedNonsense] = useState<Set<number>>(new Set())
  const [selectedCorrespondentMatches, setSelectedCorrespondentMatches] = useState<Set<number>>(new Set())
  const [selectedDocTypeMatches, setSelectedDocTypeMatches] = useState<Set<number>>(new Set())
  
  // Ignore list (pattern-based)
  const [ignoredTags, setIgnoredTags] = useState<IgnoredTag[]>([])
  const [showIgnoreModal, setShowIgnoreModal] = useState(false)
  const [newIgnorePattern, setNewIgnorePattern] = useState('')
  const [newIgnoreReason, setNewIgnoreReason] = useState('')
  
  // Ignored items (ID-based, per analysis type)
  const [ignoredItemIds, setIgnoredItemIds] = useState<{
    nonsense: number[]
    correspondent: number[]
    doctype: number[]
    similar: number[]
  }>({ nonsense: [], correspondent: [], doctype: [], similar: [] })
  const [ignoringItemId, setIgnoringItemId] = useState<number | null>(null)
  
  // Saved analysis info
  const [savedNonsenseInfo, setSavedNonsenseInfo] = useState<{ exists: boolean; created_at?: string } | null>(null)
  const [savedCorrespondentInfo, setSavedCorrespondentInfo] = useState<{ exists: boolean; created_at?: string } | null>(null)
  const [savedDoctypeInfo, setSavedDoctypeInfo] = useState<{ exists: boolean; created_at?: string } | null>(null)
  const [savedSimilarInfo, setSavedSimilarInfo] = useState<{ exists: boolean; created_at?: string } | null>(null)
  
  
  // Auto-refresh: track when data was last loaded from backend
  const [lastDataLoad, setLastDataLoad] = useState<number>(0)
  const CACHE_MAX_AGE_MS = 5 * 60 * 1000 // 5 minutes
  
  // Confirmation modal for AI analysis
  const [confirmModal, setConfirmModal] = useState<AnalysisConfirmInfo | null>(null)
  const [confirmEstimate, setConfirmEstimate] = useState<{
    items_info: string
    estimated_tokens: number
    token_limit: number
    model: string
    is_external: boolean
    warning?: string
  } | null>(null)
  const [loadingEstimate, setLoadingEstimate] = useState(false)
  
  // Document preview in wizard steps
  const [previewTagId, setPreviewTagId] = useState<number | null>(null)
  const [previewDocs, setPreviewDocs] = useState<api.DocumentPreview[]>([])
  const [loadingPreview, setLoadingPreview] = useState(false)

  useEffect(() => {
    loadInitialData()
    loadIgnoredTags()
    loadIgnoredItemIds()
    loadSavedAnalysisInfo()
  }, [])
  
  // Auto-refresh data when switching steps if cache is older than 5 min
  useEffect(() => {
    if (lastDataLoad > 0 && Date.now() - lastDataLoad > CACHE_MAX_AGE_MS) {
      api.refreshPaperlessCache().catch(() => {})
      loadInitialData()
      loadSavedAnalysisInfo()
    }
  }, [currentStep])
  
  // Load document previews for a tag
  const toggleDocPreview = async (tagId: number) => {
    if (previewTagId === tagId) {
      setPreviewTagId(null)
      setPreviewDocs([])
      return
    }
    
    setPreviewTagId(tagId)
    setLoadingPreview(true)
    try {
      const docs = await api.getDocumentPreviews({ tag_id: tagId, limit: 4 })
      setPreviewDocs(docs)
    } catch (e) {
      console.error('Failed to load document previews:', e)
      setPreviewDocs([])
    } finally {
      setLoadingPreview(false)
    }
  }
  
  // Reusable document preview component
  const renderDocPreview = (tagId: number, docCount: number) => {
    if (previewTagId !== tagId) return null
    
    return (
      <div className="mt-2 p-3 rounded bg-surface-800/50 border border-surface-700">
        {loadingPreview ? (
          <div className="flex items-center justify-center py-3">
            <Loader2 className="w-4 h-4 animate-spin text-primary-400" />
            <span className="ml-2 text-sm text-surface-400">Lade Dokumente...</span>
          </div>
        ) : previewDocs.length > 0 ? (
          <div>
            <div className="flex items-center gap-2 mb-2 text-xs text-surface-400">
              <Eye className="w-3 h-3" />
              <span>Vorschau ({previewDocs.length} von {docCount})</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
                  <div className="w-8 h-8 rounded bg-surface-600 overflow-hidden flex-shrink-0">
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
          <div className="text-center py-2 text-sm text-surface-400">
            Keine Dokumente gefunden
          </div>
        )}
      </div>
    )
  }
  
  const loadSavedAnalysisInfo = async () => {
    try {
      const [nonsense, correspondent, doctype, similar] = await Promise.all([
        api.getSavedNonsenseAnalysis(),
        api.getSavedCorrespondentAnalysis(),
        api.getSavedDoctypeAnalysis(),
        api.getTagSavedAnalysis()
      ])
      setSavedNonsenseInfo(nonsense)
      setSavedCorrespondentInfo(correspondent)
      setSavedDoctypeInfo(doctype)
      setSavedSimilarInfo(similar)
    } catch (e) {
      console.error('Failed to load saved analysis info:', e)
    }
  }
  
  const loadIgnoredTags = async () => {
    try {
      const data = await api.getIgnoredTags()
      setIgnoredTags(data)
    } catch (e) {
      console.error('Failed to load ignored tags:', e)
    }
  }
  
  const loadIgnoredItemIds = async () => {
    try {
      const [nonsense, correspondent, doctype, similar] = await Promise.all([
        api.getIgnoredIds('tag', 'nonsense'),
        api.getIgnoredIds('tag', 'correspondent_match'),
        api.getIgnoredIds('tag', 'doctype_match'),
        api.getIgnoredIds('tag', 'similar')
      ])
      setIgnoredItemIds({ nonsense, correspondent, doctype, similar })
    } catch (e) {
      console.error('Failed to load ignored item IDs:', e)
    }
  }
  
  const handleIgnoreItem = async (itemId: number, itemName: string, analysisType: 'nonsense' | 'correspondent' | 'doctype' | 'similar') => {
    setIgnoringItemId(itemId)
    try {
      await api.addIgnoredItem({
        item_id: itemId,
        item_name: itemName,
        entity_type: 'tag',
        analysis_type: analysisType === 'correspondent' ? 'correspondent_match' : analysisType === 'doctype' ? 'doctype_match' : analysisType,
        reason: 'Manuell ignoriert'
      })
      setIgnoredItemIds(prev => ({
        ...prev,
        [analysisType]: [...prev[analysisType], itemId]
      }))
    } catch (e) {
      console.error('Failed to ignore item:', e)
    } finally {
      setIgnoringItemId(null)
    }
  }
  
  const addToIgnoreList = async () => {
    if (!newIgnorePattern.trim()) return
    try {
      const newTag = await api.addIgnoredTag({
        pattern: newIgnorePattern.trim(),
        reason: newIgnoreReason.trim() || 'Manuell hinzugefügt'
      })
      setIgnoredTags([...ignoredTags, newTag])
      setNewIgnorePattern('')
      setNewIgnoreReason('')
    } catch (e: any) {
      setError(e.message || 'Fehler beim Hinzufügen')
    }
  }
  
  const removeFromIgnoreList = async (id: number) => {
    try {
      await api.deleteIgnoredTag(id)
      setIgnoredTags(ignoredTags.filter(t => t.id !== id))
    } catch (e) {
      console.error('Failed to remove ignored tag:', e)
    }
  }
  
  const refreshCache = async () => {
    setRefreshing(true)
    setCachedInfo('')
    try {
      const startTime = Date.now()
      await api.refreshPaperlessCache()
      const elapsed = Date.now() - startTime
      setCachedInfo(`Cache neu geladen in ${(elapsed / 1000).toFixed(1)}s`)
      await loadInitialData()
    } catch (e) {
      console.error('Failed to refresh cache:', e)
    } finally {
      setRefreshing(false)
    }
  }

  const loadInitialData = async () => {
    setLoading(true)
    const startTime = Date.now()
    try {
      const tagsData = await api.getTags()
      setTags(tagsData)
      
      // Prepare step 1: Empty tags (no AI needed)
      const empty = tagsData.filter((t: TagItem) => t.document_count === 0)
      setEmptyTags(empty)
      setSelectedEmpty(new Set(empty.map((t: TagItem) => t.id)))
      
    } catch (e) {
      console.error('Error loading data:', e)
    } finally {
      setLoading(false)
      setLastDataLoad(Date.now())
      const elapsed = Date.now() - startTime
      setLoadTime(elapsed)
      if (elapsed < 1000) {
        setCachedInfo('(aus Cache)')
      }
    }
  }
  
  // Open confirmation modal before AI analysis
  const openAnalysisConfirm = async (step: number, forceNew: boolean = false) => {
    const stepInfo: Record<number, { name: string; type: 'nonsense' | 'correspondent' | 'doctype' | 'similar' }> = {
      2: { name: 'Unsinnige Tags', type: 'nonsense' },
      3: { name: 'Korrespondenten-Tags', type: 'correspondent' },
      4: { name: 'Dokumententyp-Tags', type: 'doctype' },
      5: { name: 'Ähnliche Tags', type: 'similar' }
    }
    
    const info = stepInfo[step]
    if (!info) return
    
    // If loading saved (not forceNew), skip modal
    if (!forceNew) {
      const hasSaved = 
        (step === 2 && savedNonsenseInfo?.exists) ||
        (step === 3 && savedCorrespondentInfo?.exists) ||
        (step === 4 && savedDoctypeInfo?.exists) ||
        (step === 5 && savedSimilarInfo?.exists)
      
      if (hasSaved) {
        // Load saved directly without modal
        await loadSavedOrAnalyze(step, false)
        return
      }
    }
    
    // Show modal and load estimate
    setConfirmModal({ step, stepName: info.name, analysisType: info.type })
    setLoadingEstimate(true)
    setConfirmEstimate(null)
    
    try {
      const estimate = await api.estimateTags(info.type)
      // Check if external LLM (not Ollama)
      const isExternal = estimate.model ? !estimate.model.toLowerCase().includes('llama') && !estimate.model.toLowerCase().includes('mistral') && !estimate.model.toLowerCase().includes('local') : true
      setConfirmEstimate({ ...estimate, is_external: isExternal })
    } catch (e) {
      console.error('Error loading estimate:', e)
      setConfirmEstimate({
        items_info: `${tags.length} Tags`,
        estimated_tokens: tags.length * 20,
        token_limit: 128000,
        model: 'Unbekannt',
        is_external: true
      })
    } finally {
      setLoadingEstimate(false)
    }
  }
  
  const confirmAndAnalyze = async () => {
    if (!confirmModal) return
    setConfirmModal(null)
    await loadSavedOrAnalyze(confirmModal.step, true)
  }
  
  const loadSavedOrAnalyze = async (step: number, forceNew: boolean = false) => {
    setAnalyzing(true)
    setError(null)
    
    try {
      switch(step) {
        case 2: // Nonsense tags
          if (!forceNew && savedNonsenseInfo?.exists) {
            const saved = await api.loadSavedNonsenseAnalysis()
            if (saved.exists && saved.nonsense_tags) {
              setNonsenseTags(saved.nonsense_tags)
              setSelectedNonsense(new Set(saved.nonsense_tags.map((t: NonsenseTag) => t.id)))
              setStepStatus(prev => ({ ...prev, [step]: { ...prev[step], analyzed: true } }))
              setAnalyzing(false)
              return
            }
          }
          // Run new analysis
          const nonsenseResult = await api.analyzeNonsenseTags()
          if (nonsenseResult.error) {
            setError(nonsenseResult.error)
          } else {
            setNonsenseTags(nonsenseResult.nonsense_tags || [])
            setSelectedNonsense(new Set(nonsenseResult.nonsense_tags?.map((t: NonsenseTag) => t.id) || []))
            setSavedNonsenseInfo({ exists: true, created_at: new Date().toISOString() })
          }
          break
          
        case 3: // Correspondent matches
          if (!forceNew && savedCorrespondentInfo?.exists) {
            const saved = await api.loadSavedCorrespondentAnalysis()
            if (saved.exists && saved.correspondent_tags) {
              setCorrespondentMatches(saved.correspondent_tags)
              setSelectedCorrespondentMatches(new Set(saved.correspondent_tags.map((t: CorrespondentMatch) => t.tag_id)))
              setStepStatus(prev => ({ ...prev, [step]: { ...prev[step], analyzed: true } }))
              setAnalyzing(false)
              return
            }
          }
          // Run new analysis
          const corrResult = await api.analyzeCorrespondentTags()
          if (corrResult.error) {
            setError(corrResult.error)
          } else {
            setCorrespondentMatches(corrResult.correspondent_tags || [])
            setSelectedCorrespondentMatches(new Set(corrResult.correspondent_tags?.map((t: CorrespondentMatch) => t.tag_id) || []))
            setSavedCorrespondentInfo({ exists: true, created_at: new Date().toISOString() })
          }
          break
          
        case 4: // Doctype matches
          if (!forceNew && savedDoctypeInfo?.exists) {
            const saved = await api.loadSavedDoctypeAnalysis()
            if (saved.exists && saved.doctype_tags) {
              setDocTypeMatches(saved.doctype_tags)
              setSelectedDocTypeMatches(new Set(saved.doctype_tags.map((t: DoctypeMatch) => t.tag_id)))
              setStepStatus(prev => ({ ...prev, [step]: { ...prev[step], analyzed: true } }))
              setAnalyzing(false)
              return
            }
          }
          // Run new analysis
          const dtResult = await api.analyzeDoctypeTags()
          if (dtResult.error) {
            setError(dtResult.error)
          } else {
            setDocTypeMatches(dtResult.doctype_tags || [])
            setSelectedDocTypeMatches(new Set(dtResult.doctype_tags?.map((t: DoctypeMatch) => t.tag_id) || []))
            setSavedDoctypeInfo({ exists: true, created_at: new Date().toISOString() })
          }
          break
          
        case 5: // Similar tags
          if (!forceNew && savedSimilarInfo?.exists) {
            const saved = await api.loadTagSavedAnalysis()
            if (saved.groups && saved.groups.length > 0) {
              setSimilarGroups(saved.groups)
              setStepStatus(prev => ({ ...prev, [step]: { ...prev[step], analyzed: true } }))
              setAnalyzing(false)
              return
            }
          }
          // Run new analysis
          const analysisResult = await api.analyzeTags(200)
          if (analysisResult.error) {
            setError(analysisResult.error)
          } else {
            setSimilarGroups(analysisResult.groups || [])
            setSavedSimilarInfo({ exists: true, created_at: new Date().toISOString() })
          }
          break
      }
      
      setStepStatus(prev => ({
        ...prev,
        [step]: { ...prev[step], analyzed: true }
      }))
      
    } catch (e: any) {
      setError(e.message || 'Analyse fehlgeschlagen. Ist ein LLM Provider konfiguriert?')
    } finally {
      setAnalyzing(false)
    }
  }

  const executeStep = async (step: number) => {
    setProcessing(true)
    setError(null)
    setProgress(null)
    
    try {
      let deletedCount = 0
      let requestedCount = 0
      let deletedTagIds: number[] = []
      
      switch(step) {
        case 1: {
          const ids = emptyTags.filter(t => selectedEmpty.has(t.id)).map(t => t.id)
          requestedCount = ids.length
          setProgress({ current: 0, total: ids.length })
          const bulkResult = await api.bulkDeleteTags(ids)
          deletedTagIds = bulkResult.deleted
          deletedCount = bulkResult.deleted_count
          setProgress({ current: ids.length, total: ids.length })
          break
        }
        case 2: {
          const ids = nonsenseTags.filter(t => selectedNonsense.has(t.id)).map(t => t.id)
          requestedCount = ids.length
          setProgress({ current: 0, total: ids.length })
          const bulkResult = await api.bulkDeleteTags(ids)
          deletedTagIds = bulkResult.deleted
          deletedCount = bulkResult.deleted_count
          setProgress({ current: ids.length, total: ids.length })
          break
        }
        case 3: {
          const ids = correspondentMatches.filter(m => selectedCorrespondentMatches.has(m.tag_id)).map(m => m.tag_id)
          requestedCount = ids.length
          setProgress({ current: 0, total: ids.length })
          const bulkResult = await api.bulkDeleteTags(ids)
          deletedTagIds = bulkResult.deleted
          deletedCount = bulkResult.deleted_count
          setProgress({ current: ids.length, total: ids.length })
          break
        }
        case 4: {
          const ids = docTypeMatches.filter(m => selectedDocTypeMatches.has(m.tag_id)).map(m => m.tag_id)
          requestedCount = ids.length
          setProgress({ current: 0, total: ids.length })
          const bulkResult = await api.bulkDeleteTags(ids)
          deletedTagIds = bulkResult.deleted
          deletedCount = bulkResult.deleted_count
          setProgress({ current: ids.length, total: ids.length })
          break
        }
        case 5:
          break
      }
      
      // Calculate remaining items BEFORE removing from local state
      const deletedSet = new Set(deletedTagIds)
      let remainingCount = 0
      switch(step) {
        case 1: remainingCount = emptyTags.filter(t => !deletedSet.has(t.id)).length; break
        case 2: remainingCount = nonsenseTags.filter(t => !deletedSet.has(t.id)).length; break
        case 3: remainingCount = correspondentMatches.filter(m => !deletedSet.has(m.tag_id)).length; break
        case 4: remainingCount = docTypeMatches.filter(m => !deletedSet.has(m.tag_id)).length; break
      }
      
      // Remove deleted tags from local lists
      if (deletedSet.size > 0) {
        setEmptyTags(prev => prev.filter(t => !deletedSet.has(t.id)))
        setNonsenseTags(prev => prev.filter(t => !deletedSet.has(t.id)))
        setCorrespondentMatches(prev => prev.filter(m => !deletedSet.has(m.tag_id)))
        setDocTypeMatches(prev => prev.filter(m => !deletedSet.has(m.tag_id)))
        setSelectedEmpty(prev => { const n = new Set(prev); deletedTagIds.forEach(id => n.delete(id)); return n })
        setSelectedNonsense(prev => { const n = new Set(prev); deletedTagIds.forEach(id => n.delete(id)); return n })
        setSelectedCorrespondentMatches(prev => { const n = new Set(prev); deletedTagIds.forEach(id => n.delete(id)); return n })
        setSelectedDocTypeMatches(prev => { const n = new Set(prev); deletedTagIds.forEach(id => n.delete(id)); return n })
      }
      
      const prevResult = stepStatus[step]?.result
      const cumulativeDeleted = (prevResult?.deleted || 0) + deletedCount
      const isFullyDone = remainingCount === 0
      
      setStepStatus(prev => ({
        ...prev,
        [step]: {
          completed: isFullyDone,
          skipped: false,
          analyzed: prev[step]?.analyzed || false,
          result: { deleted: cumulativeDeleted, total: requestedCount }
        }
      }))
      
      // Remove deleted tags from ALL saved analyses in backend
      if (deletedTagIds.length > 0) {
        try { await api.removeTagsFromSavedAnalyses(deletedTagIds) } catch (_) { /* ignore */ }
      }
      
      // Refresh backend cache + reload fresh tag list
      try { await api.refreshPaperlessCache() } catch (_) { /* ignore */ }
      await loadInitialData()
      await loadSavedAnalysisInfo()
      
    } catch (e: any) {
      console.error('Error executing step:', e)
      setError(e?.message || 'Fehler beim Ausführen')
    } finally {
      setProcessing(false)
      setProgress(null)
    }
  }

  const skipStep = () => {
    setStepStatus(prev => ({
      ...prev,
      [currentStep]: { completed: false, skipped: true }
    }))
    if (currentStep < 5) {
      setCurrentStep(currentStep + 1)
    }
  }

  const renderStepContent = () => {
    const needsAnalysis = STEPS[currentStep - 1].needsAI && !stepStatus[currentStep]?.analyzed
    
    switch(currentStep) {
      case 1:
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-surface-300">
                <strong className="text-amber-400">{emptyTags.length}</strong> Tags haben 0 Dokumente
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setSelectedEmpty(new Set(emptyTags.map(t => t.id)))}
                  className="text-sm text-primary-400 hover:text-primary-300"
                >
                  Alle auswählen
                </button>
                <button
                  onClick={() => setSelectedEmpty(new Set())}
                  className="text-sm text-surface-400 hover:text-surface-300"
                >
                  Keine
                </button>
              </div>
            </div>
            
            <div className="max-h-96 overflow-y-auto space-y-1">
              {emptyTags.map(tag => (
                <label key={tag.id} className="flex items-center gap-3 p-2 rounded hover:bg-surface-700/50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedEmpty.has(tag.id)}
                    onChange={(e) => {
                      const newSet = new Set(selectedEmpty)
                      if (e.target.checked) newSet.add(tag.id)
                      else newSet.delete(tag.id)
                      setSelectedEmpty(newSet)
                    }}
                    className="w-4 h-4"
                  />
                  <Tag className="w-4 h-4 text-surface-500" />
                  <span className="text-surface-200">{tag.name}</span>
                </label>
              ))}
              {emptyTags.length === 0 && (
                <p className="text-center text-surface-400 py-8">Keine leeren Tags gefunden! ✓</p>
              )}
            </div>
          </div>
        )
        
      case 2:
        if (needsAnalysis) {
          return (
            <div className="space-y-6">
              {/* Ignore List Management */}
              <div className="p-4 bg-surface-700/30 rounded-lg border border-surface-600">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Shield className="w-5 h-5 text-emerald-400" />
                    <span className="font-medium text-surface-100">Geschützte Tags ({ignoredTags.length})</span>
                  </div>
                  <button
                    onClick={() => setShowIgnoreModal(true)}
                    className="text-sm text-primary-400 hover:text-primary-300 flex items-center gap-1"
                  >
                    <Plus className="w-4 h-4" />
                    Hinzufügen
                  </button>
                </div>
                <p className="text-sm text-surface-400 mb-3">
                  Diese Tags werden bei der Analyse ignoriert und nicht als "unsinnig" markiert.
                </p>
                <div className="flex flex-wrap gap-2">
                  {ignoredTags.map(t => (
                    <span key={t.id} className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-500/20 text-emerald-400 rounded text-sm">
                      {t.pattern}
                      <button
                        onClick={() => removeFromIgnoreList(t.id)}
                        className="hover:text-red-400"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                  {ignoredTags.length === 0 && (
                    <span className="text-surface-500 text-sm">Keine geschützten Tags</span>
                  )}
                </div>
              </div>
              
              <div className="text-center py-8">
                <Brain className="w-16 h-16 mx-auto text-primary-500 mb-4" />
                <h4 className="text-lg font-medium text-surface-100 mb-2">
                  {savedNonsenseInfo?.exists ? 'Gespeicherte Analyse vorhanden' : 'KI-Analyse erforderlich'}
                </h4>
                <p className="text-surface-400 mb-6 max-w-md mx-auto">
                  {savedNonsenseInfo?.exists 
                    ? `Letzte Analyse: ${savedNonsenseInfo.created_at ? new Date(savedNonsenseInfo.created_at).toLocaleString('de-DE') : 'Unbekannt'}` 
                    : 'Die KI analysiert alle Tags und identifiziert unsinnige, generische oder sinnlose Tags wie "test", "Dokument", "Sonstige" etc.'}
                </p>
                
                <div className="flex gap-3 justify-center">
                  {savedNonsenseInfo?.exists ? (
                    <>
                      <button
                        onClick={() => openAnalysisConfirm(2, false)}
                        disabled={analyzing}
                        className="btn btn-primary flex items-center gap-2"
                      >
                        {analyzing ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Lade...
                          </>
                        ) : (
                          <>
                            <RefreshCw className="w-4 h-4" />
                            Gespeicherte laden
                          </>
                        )}
                      </button>
                      <button
                        onClick={() => openAnalysisConfirm(2, true)}
                        disabled={analyzing}
                        className="btn btn-secondary flex items-center gap-2"
                      >
                        <Sparkles className="w-4 h-4" />
                        Neu analysieren
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => openAnalysisConfirm(2, true)}
                      disabled={analyzing}
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
                          KI-Analyse starten
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        }
        
        return (
          <div className="space-y-4">
            
            <div className="flex items-center justify-between">
              <p className="text-surface-300">
                <strong className="text-amber-400">{nonsenseTags.length}</strong> unsinnige Tags gefunden
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowIgnoreModal(true)}
                  className="text-sm text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
                >
                  <Shield className="w-4 h-4" />
                  Ignorieren ({ignoredTags.length})
                </button>
                <button
                  onClick={() => setSelectedNonsense(new Set(nonsenseTags.map(t => t.id)))}
                  className="text-sm text-primary-400 hover:text-primary-300"
                >
                  Alle auswählen
                </button>
                <button
                  onClick={() => setSelectedNonsense(new Set())}
                  className="text-sm text-surface-400 hover:text-surface-300"
                >
                  Keine
                </button>
              </div>
            </div>
            
            <div className="max-h-96 overflow-y-auto space-y-2">
              {nonsenseTags
                .filter(tag => !ignoredItemIds.nonsense.includes(tag.id))
                .map(tag => (
                <div key={tag.id} className="p-3 rounded bg-surface-700/30 hover:bg-surface-700/50">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selectedNonsense.has(tag.id)}
                      onChange={(e) => {
                        const newSet = new Set(selectedNonsense)
                        if (e.target.checked) newSet.add(tag.id)
                        else newSet.delete(tag.id)
                        setSelectedNonsense(newSet)
                      }}
                      className="w-4 h-4 mt-1 cursor-pointer"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Tag className="w-4 h-4 text-amber-400" />
                        <span className="text-surface-200 font-medium">{tag.name}</span>
                        <span className="text-surface-500 text-sm">({tag.document_count} Dok.)</span>
                        <span className="text-xs text-amber-400 bg-amber-500/20 px-2 py-0.5 rounded">
                          {Math.round(tag.confidence * 100)}%
                        </span>
                        {tag.document_count > 0 && (
                          <button
                            onClick={() => toggleDocPreview(tag.id)}
                            className={clsx(
                              "text-xs px-2 py-0.5 rounded flex items-center gap-1 transition-colors",
                              previewTagId === tag.id 
                                ? "bg-primary-500/20 text-primary-300" 
                                : "bg-surface-600/50 text-surface-400 hover:text-primary-300"
                            )}
                          >
                            <Eye className="w-3 h-3" />
                            Dokumente
                          </button>
                        )}
                      </div>
                      <p className="text-sm text-surface-400 mt-1">{tag.reason}</p>
                      {renderDocPreview(tag.id, tag.document_count)}
                    </div>
                    <button
                      onClick={() => handleIgnoreItem(tag.id, tag.name, 'nonsense')}
                      disabled={ignoringItemId === tag.id}
                      className="p-1.5 rounded text-surface-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      title="Dauerhaft ignorieren"
                    >
                      {ignoringItemId === tag.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Ban className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              ))}
              {nonsenseTags.filter(t => !ignoredItemIds.nonsense.includes(t.id)).length === 0 && (
                <p className="text-center text-surface-400 py-8">Keine unsinnigen Tags gefunden! ✓</p>
              )}
            </div>
          </div>
        )
        
      case 3:
        if (needsAnalysis) {
          return (
            <div className="text-center py-12">
              <Brain className="w-16 h-16 mx-auto text-blue-500 mb-4" />
              <h4 className="text-lg font-medium text-surface-100 mb-2">
                {savedCorrespondentInfo?.exists ? 'Gespeicherte Analyse vorhanden' : 'KI-Analyse erforderlich'}
              </h4>
              <p className="text-surface-400 mb-6 max-w-md mx-auto">
                {savedCorrespondentInfo?.exists 
                  ? `Letzte Analyse: ${savedCorrespondentInfo.created_at ? new Date(savedCorrespondentInfo.created_at).toLocaleString('de-DE') : 'Unbekannt'}` 
                  : 'Die KI analysiert alle Tags und findet Tags die eigentlich Firmen oder Personen (Korrespondenten) sind.'}
              </p>
              
              
              <div className="flex gap-3 justify-center">
                {savedCorrespondentInfo?.exists ? (
                  <>
                    <button
                      onClick={() => openAnalysisConfirm(3, false)}
                      disabled={analyzing}
                      className="btn btn-primary flex items-center gap-2"
                    >
                      {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                      {analyzing ? 'Lade...' : 'Gespeicherte laden'}
                    </button>
                    <button
                      onClick={() => openAnalysisConfirm(3, true)}
                      disabled={analyzing}
                      className="btn btn-secondary flex items-center gap-2"
                    >
                      <Sparkles className="w-4 h-4" />
                      Neu analysieren
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => openAnalysisConfirm(3, true)}
                    disabled={analyzing}
                    className="btn btn-primary flex items-center gap-2"
                  >
                    {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    {analyzing ? 'Analysiere...' : 'KI-Analyse starten'}
                  </button>
                )}
              </div>
            </div>
          )
        }
        
        return (
          <div className="space-y-4">
            
            <div className="flex items-center justify-between">
              <p className="text-surface-300">
                <strong className="text-blue-400">{correspondentMatches.length}</strong> Tags sind eigentlich Korrespondenten
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setSelectedCorrespondentMatches(new Set(
                    correspondentMatches.filter(m => !ignoredItemIds.correspondent.includes(m.tag_id)).map(m => m.tag_id)
                  ))}
                  className="text-sm text-primary-400 hover:text-primary-300"
                >
                  Alle auswählen
                </button>
                <button
                  onClick={() => setSelectedCorrespondentMatches(new Set())}
                  className="text-sm text-surface-400 hover:text-surface-300"
                >
                  Keine
                </button>
              </div>
            </div>
            
            <div className="max-h-96 overflow-y-auto space-y-2">
              {correspondentMatches
                .filter(match => !ignoredItemIds.correspondent.includes(match.tag_id))
                .map(match => (
                <div key={match.tag_id} className="p-3 rounded bg-surface-700/30 hover:bg-surface-700/50">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selectedCorrespondentMatches.has(match.tag_id)}
                      onChange={(e) => {
                        const newSet = new Set(selectedCorrespondentMatches)
                        if (e.target.checked) newSet.add(match.tag_id)
                        else newSet.delete(match.tag_id)
                        setSelectedCorrespondentMatches(newSet)
                      }}
                      className="w-4 h-4 mt-1 cursor-pointer"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Tag className="w-4 h-4 text-purple-400" />
                        <span className="text-surface-200">Tag: {match.tag_name}</span>
                        <span className="text-surface-500 text-sm">({match.document_count} Dok.)</span>
                        {match.document_count > 0 && (
                          <button
                            onClick={() => toggleDocPreview(match.tag_id)}
                            className={clsx(
                              "text-xs px-2 py-0.5 rounded flex items-center gap-1 transition-colors",
                              previewTagId === match.tag_id 
                                ? "bg-primary-500/20 text-primary-300" 
                                : "bg-surface-600/50 text-surface-400 hover:text-primary-300"
                            )}
                          >
                            <Eye className="w-3 h-3" />
                            Dokumente
                          </button>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-sm">
                        <Users className="w-4 h-4 text-blue-400" />
                        <span className="text-surface-400">
                          → Korrespondent: {match.suggested_correspondent}
                          {match.correspondent_exists && <span className="text-emerald-400 ml-1">(existiert)</span>}
                        </span>
                      </div>
                      <p className="text-sm text-surface-500 mt-1">{match.reason}</p>
                      {renderDocPreview(match.tag_id, match.document_count)}
                    </div>
                    <button
                      onClick={() => handleIgnoreItem(match.tag_id, match.tag_name, 'correspondent')}
                      disabled={ignoringItemId === match.tag_id}
                      className="p-1.5 rounded text-surface-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      title="Dauerhaft ignorieren"
                    >
                      {ignoringItemId === match.tag_id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Ban className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              ))}
              {correspondentMatches.filter(m => !ignoredItemIds.correspondent.includes(m.tag_id)).length === 0 && (
                <p className="text-center text-surface-400 py-8">Keine solchen Tags gefunden! ✓</p>
              )}
            </div>
          </div>
        )
        
      case 4:
        if (needsAnalysis) {
          return (
            <div className="text-center py-12">
              <Brain className="w-16 h-16 mx-auto text-amber-500 mb-4" />
              <h4 className="text-lg font-medium text-surface-100 mb-2">
                {savedDoctypeInfo?.exists ? 'Gespeicherte Analyse vorhanden' : 'KI-Analyse erforderlich'}
              </h4>
              <p className="text-surface-400 mb-6 max-w-md mx-auto">
                {savedDoctypeInfo?.exists 
                  ? `Letzte Analyse: ${savedDoctypeInfo.created_at ? new Date(savedDoctypeInfo.created_at).toLocaleString('de-DE') : 'Unbekannt'}` 
                  : 'Die KI analysiert alle Tags und findet Tags die eigentlich Dokumententypen sind (z.B. "Rechnung", "Vertrag").'}
              </p>
              
              
              <div className="flex gap-3 justify-center">
                {savedDoctypeInfo?.exists ? (
                  <>
                    <button
                      onClick={() => openAnalysisConfirm(4, false)}
                      disabled={analyzing}
                      className="btn btn-primary flex items-center gap-2"
                    >
                      {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                      {analyzing ? 'Lade...' : 'Gespeicherte laden'}
                    </button>
                    <button
                      onClick={() => openAnalysisConfirm(4, true)}
                      disabled={analyzing}
                      className="btn btn-secondary flex items-center gap-2"
                    >
                      <Sparkles className="w-4 h-4" />
                      Neu analysieren
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => openAnalysisConfirm(4, true)}
                    disabled={analyzing}
                    className="btn btn-primary flex items-center gap-2"
                  >
                    {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    {analyzing ? 'Analysiere...' : 'KI-Analyse starten'}
                  </button>
                )}
              </div>
            </div>
          )
        }
        
        return (
          <div className="space-y-4">
            
            <div className="flex items-center justify-between">
              <p className="text-surface-300">
                <strong className="text-amber-400">{docTypeMatches.length}</strong> Tags sind eigentlich Dokumententypen
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setSelectedDocTypeMatches(new Set(
                    docTypeMatches.filter(m => !ignoredItemIds.doctype.includes(m.tag_id)).map(m => m.tag_id)
                  ))}
                  className="text-sm text-primary-400 hover:text-primary-300"
                >
                  Alle auswählen
                </button>
                <button
                  onClick={() => setSelectedDocTypeMatches(new Set())}
                  className="text-sm text-surface-400 hover:text-surface-300"
                >
                  Keine
                </button>
              </div>
            </div>
            
            <div className="max-h-96 overflow-y-auto space-y-2">
              {docTypeMatches
                .filter(match => !ignoredItemIds.doctype.includes(match.tag_id))
                .map(match => (
                <div key={match.tag_id} className="p-3 rounded bg-surface-700/30 hover:bg-surface-700/50">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selectedDocTypeMatches.has(match.tag_id)}
                      onChange={(e) => {
                        const newSet = new Set(selectedDocTypeMatches)
                        if (e.target.checked) newSet.add(match.tag_id)
                        else newSet.delete(match.tag_id)
                        setSelectedDocTypeMatches(newSet)
                      }}
                      className="w-4 h-4 mt-1 cursor-pointer"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Tag className="w-4 h-4 text-purple-400" />
                        <span className="text-surface-200">Tag: {match.tag_name}</span>
                        <span className="text-surface-500 text-sm">({match.document_count} Dok.)</span>
                        {match.document_count > 0 && (
                          <button
                            onClick={() => toggleDocPreview(match.tag_id)}
                            className={clsx(
                              "text-xs px-2 py-0.5 rounded flex items-center gap-1 transition-colors",
                              previewTagId === match.tag_id 
                                ? "bg-primary-500/20 text-primary-300" 
                                : "bg-surface-600/50 text-surface-400 hover:text-primary-300"
                            )}
                          >
                            <Eye className="w-3 h-3" />
                            Dokumente
                          </button>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-sm">
                        <FileText className="w-4 h-4 text-amber-400" />
                        <span className="text-surface-400">
                          → Dokumententyp: {match.suggested_doctype}
                          {match.doctype_exists && <span className="text-emerald-400 ml-1">(existiert)</span>}
                        </span>
                      </div>
                      <p className="text-sm text-surface-500 mt-1">{match.reason}</p>
                      {renderDocPreview(match.tag_id, match.document_count)}
                    </div>
                    <button
                      onClick={() => handleIgnoreItem(match.tag_id, match.tag_name, 'doctype')}
                      disabled={ignoringItemId === match.tag_id}
                      className="p-1.5 rounded text-surface-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      title="Dauerhaft ignorieren"
                    >
                      {ignoringItemId === match.tag_id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Ban className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              ))}
              {docTypeMatches.filter(m => !ignoredItemIds.doctype.includes(m.tag_id)).length === 0 && (
                <p className="text-center text-surface-400 py-8">Keine solchen Tags gefunden! ✓</p>
              )}
            </div>
          </div>
        )
        
      case 5:
        if (needsAnalysis) {
          return (
            <div className="text-center py-12">
              <Brain className="w-16 h-16 mx-auto text-purple-500 mb-4" />
              <h4 className="text-lg font-medium text-surface-100 mb-2">
                {savedSimilarInfo?.exists ? 'Gespeicherte Analyse vorhanden' : 'KI-Analyse erforderlich'}
              </h4>
              <p className="text-surface-400 mb-6 max-w-md mx-auto">
                {savedSimilarInfo?.exists 
                  ? `Letzte Analyse: ${savedSimilarInfo.created_at ? new Date(savedSimilarInfo.created_at).toLocaleString('de-DE') : 'Unbekannt'}` 
                  : 'Die KI findet ähnliche Tags wie "Hoster", "Webhoster", "Web-Hoster" und schlägt vor, sie zusammenzulegen.'}
              </p>
              
              
              <div className="flex gap-3 justify-center">
                {savedSimilarInfo?.exists ? (
                  <>
                    <button
                      onClick={() => openAnalysisConfirm(5, false)}
                      disabled={analyzing}
                      className="btn btn-primary flex items-center gap-2"
                    >
                      {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                      {analyzing ? 'Lade...' : 'Gespeicherte laden'}
                    </button>
                    <button
                      onClick={() => openAnalysisConfirm(5, true)}
                      disabled={analyzing}
                      className="btn btn-secondary flex items-center gap-2"
                    >
                      <Sparkles className="w-4 h-4" />
                      Neu analysieren
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => openAnalysisConfirm(5, true)}
                    disabled={analyzing}
                    className="btn btn-primary flex items-center gap-2"
                  >
                    {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    {analyzing ? 'Analysiere...' : 'KI-Analyse starten'}
                  </button>
                )}
              </div>
            </div>
          )
        }
        
        return (
          <div className="space-y-4">
            
            <p className="text-surface-300">
              <strong className="text-purple-400">{similarGroups.length}</strong> Gruppen ähnlicher Tags gefunden
            </p>
            
            {similarGroups.length > 0 ? (
              <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
                <p className="text-emerald-400 mb-2">
                  {similarGroups.length} Gruppen gefunden!
                </p>
                <p className="text-surface-400 text-sm">
                  Gehe zu <strong>Tags</strong> im Menü, um die Vorschläge anzusehen und zusammenzuführen.
                </p>
              </div>
            ) : (
              <p className="text-center text-surface-400 py-8">Keine ähnlichen Tags gefunden! ✓</p>
            )}
          </div>
        )
        
      default:
        return null
    }
  }

  const getStepActionLabel = () => {
    const needsAnalysis = STEPS[currentStep - 1].needsAI && !stepStatus[currentStep]?.analyzed
    if (needsAnalysis) return 'Erst analysieren'
    
    switch(currentStep) {
      case 1: return `${selectedEmpty.size} Tags löschen`
      case 2: return `${selectedNonsense.size} Tags löschen`
      case 3: return `${selectedCorrespondentMatches.size} Tags entfernen`
      case 4: return `${selectedDocTypeMatches.size} Tags entfernen`
      case 5: return 'Fertig'
      default: return 'Ausführen'
    }
  }
  
  const canExecute = () => {
    const needsAnalysis = STEPS[currentStep - 1].needsAI && !stepStatus[currentStep]?.analyzed
    if (needsAnalysis) return false
    
    switch(currentStep) {
      case 1: return selectedEmpty.size > 0
      case 2: return selectedNonsense.size > 0
      case 3: return selectedCorrespondentMatches.size > 0
      case 4: return selectedDocTypeMatches.size > 0
      case 5: return true
      default: return false
    }
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
      <div className="flex items-start justify-between">
        <div>
          <h2 className="font-display text-2xl font-bold text-surface-100">
            Tag Cleanup Wizard
          </h2>
          <p className="text-surface-400 mt-1">
            Mehrstufige KI-Bereinigung deiner {tags.length} Tags
            {loadTime !== null && (
              <span className="text-surface-500 ml-2">
                (geladen in {(loadTime / 1000).toFixed(1)}s {cachedInfo})
              </span>
            )}
          </p>
        </div>
        <button
          onClick={refreshCache}
          disabled={refreshing || loading}
          className="btn btn-secondary flex items-center gap-2"
          title="Cache neu laden"
        >
          <RefreshCw className={clsx('w-4 h-4', refreshing && 'animate-spin')} />
          {refreshing ? 'Lade...' : 'Neu laden'}
        </button>
      </div>

      {/* Progress Steps */}
      <div className="card p-4">
        <div className="flex items-center justify-between">
          {STEPS.map((step, index) => {
            const Icon = step.icon
            const status = stepStatus[step.id]
            const isActive = currentStep === step.id
            
            return (
              <div key={step.id} className="flex items-center">
                <button
                  onClick={() => setCurrentStep(step.id)}
                  className={clsx(
                    'flex flex-col items-center gap-2 p-2 rounded-lg transition-colors',
                    isActive && 'bg-primary-500/20',
                    !isActive && 'hover:bg-surface-700/50'
                  )}
                >
                  <div className={clsx(
                    'w-10 h-10 rounded-full flex items-center justify-center',
                    status?.completed && 'bg-emerald-500',
                    status?.skipped && 'bg-surface-600',
                    isActive && !status?.completed && 'bg-primary-500',
                    !isActive && !status?.completed && !status?.skipped && 'bg-surface-700'
                  )}>
                    {status?.completed ? (
                      <Check className="w-5 h-5 text-white" />
                    ) : (
                      <Icon className="w-5 h-5 text-white" />
                    )}
                  </div>
                  <span className={clsx(
                    'text-xs text-center max-w-[80px]',
                    isActive ? 'text-primary-400' : 'text-surface-400'
                  )}>
                    {step.title}
                  </span>
                  {step.needsAI && (
                    <span className="text-[10px] text-purple-400">KI</span>
                  )}
                </button>
                {index < STEPS.length - 1 && (
                  <ChevronRight className="w-5 h-5 text-surface-600 mx-1" />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400">
          <strong>Fehler:</strong> {error}
        </div>
      )}

      {/* Current Step */}
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-4">
          {(() => {
            const Icon = STEPS[currentStep - 1].icon
            return <Icon className="w-6 h-6 text-primary-400" />
          })()}
          <div>
            <h3 className="font-semibold text-lg text-surface-100">
              Schritt {currentStep}: {STEPS[currentStep - 1].title}
            </h3>
            <p className="text-sm text-surface-400">{STEPS[currentStep - 1].description}</p>
          </div>
        </div>

        {stepStatus[currentStep]?.completed ? (
          <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg mb-4">
            <p className="text-emerald-400 flex items-center gap-2">
              <Check className="w-5 h-5" />
              Schritt abgeschlossen! Insgesamt {stepStatus[currentStep].result?.deleted || 0} gelöscht.
            </p>
          </div>
        ) : stepStatus[currentStep]?.result?.deleted ? (
          <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg mb-4">
            <p className="text-blue-300 flex items-center gap-2">
              <Check className="w-5 h-5 text-emerald-400" />
              {stepStatus[currentStep].result.deleted} Tag(s) gelöscht. Restliche Tags können weiter bearbeitet werden.
            </p>
          </div>
        ) : stepStatus[currentStep]?.skipped ? (
          <div className="p-4 bg-surface-700/50 border border-surface-600 rounded-lg mb-4">
            <p className="text-surface-400">Schritt übersprungen</p>
          </div>
        ) : null}

        {renderStepContent()}

        {/* Actions */}
        <div className="flex items-center justify-between mt-6 pt-4 border-t border-surface-700">
          <button
            onClick={() => setCurrentStep(Math.max(1, currentStep - 1))}
            disabled={currentStep === 1}
            className="btn btn-secondary flex items-center gap-2"
          >
            <ChevronLeft className="w-4 h-4" />
            Zurück
          </button>
          
          <div className="flex items-center gap-3">
            <button
              onClick={skipStep}
              className="btn btn-secondary"
            >
              Überspringen
            </button>
            <button
              onClick={() => executeStep(currentStep)}
              disabled={processing || stepStatus[currentStep]?.completed || !canExecute()}
              className="btn btn-primary flex items-center gap-2 min-w-[180px]"
            >
              {processing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {progress ? (
                    <span>{progress.current}/{progress.total} ({Math.round(progress.current / progress.total * 100)}%)</span>
                  ) : (
                    <span>Verarbeite...</span>
                  )}
                </>
              ) : (
                <>
                  {stepStatus[currentStep]?.completed ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  {getStepActionLabel()}
                </>
              )}
            </button>
            {currentStep < 5 && (
              <button
                onClick={() => setCurrentStep(currentStep + 1)}
                className="btn btn-secondary flex items-center gap-2"
              >
                Weiter
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
      
      {/* Ignore List Modal */}
      {showIgnoreModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface-800 rounded-xl p-6 w-full max-w-lg mx-4 border border-surface-700">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-surface-100 flex items-center gap-2">
                <Shield className="w-5 h-5 text-emerald-400" />
                Geschützte Tags verwalten
              </h3>
              <button
                onClick={() => setShowIgnoreModal(false)}
                className="text-surface-400 hover:text-surface-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <p className="text-sm text-surface-400 mb-4">
              Diese Tags werden bei der KI-Analyse ignoriert und nicht als "unsinnig" markiert.
              Du kannst Wildcards (*) verwenden, z.B. "*@*" für E-Mail-Adressen.
            </p>
            
            {/* Add new pattern */}
            <div className="flex gap-2 mb-4">
              <input
                type="text"
                value={newIgnorePattern}
                onChange={(e) => setNewIgnorePattern(e.target.value)}
                placeholder="Tag-Name oder Muster..."
                className="flex-1 px-3 py-2 bg-surface-900 border border-surface-600 rounded-lg text-surface-100 placeholder-surface-500"
              />
              <button
                onClick={addToIgnoreList}
                disabled={!newIgnorePattern.trim()}
                className="btn btn-primary flex items-center gap-1"
              >
                <Plus className="w-4 h-4" />
                Hinzufügen
              </button>
            </div>
            
            <input
              type="text"
              value={newIgnoreReason}
              onChange={(e) => setNewIgnoreReason(e.target.value)}
              placeholder="Grund (optional)..."
              className="w-full px-3 py-2 bg-surface-900 border border-surface-600 rounded-lg text-surface-100 placeholder-surface-500 mb-4"
            />
            
            {/* Current list */}
            <div className="max-h-64 overflow-y-auto space-y-2">
              {ignoredTags.map(tag => (
                <div key={tag.id} className="flex items-center justify-between p-2 bg-surface-700/50 rounded">
                  <div>
                    <span className="text-surface-200 font-medium">{tag.pattern}</span>
                    {tag.reason && (
                      <span className="text-surface-500 text-sm ml-2">({tag.reason})</span>
                    )}
                  </div>
                  <button
                    onClick={() => removeFromIgnoreList(tag.id)}
                    className="text-red-400 hover:text-red-300"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              {ignoredTags.length === 0 && (
                <p className="text-center text-surface-500 py-4">Keine geschützten Tags</p>
              )}
            </div>
            
            <div className="flex justify-end mt-4 pt-4 border-t border-surface-700">
              <button
                onClick={() => setShowIgnoreModal(false)}
                className="btn btn-primary"
              >
                Fertig
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* AI Analysis Confirmation Modal */}
      {confirmModal && (
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
                <p className="text-sm text-surface-400">{confirmModal.stepName}</p>
              </div>
            </div>
            
            {loadingEstimate ? (
              <div className="py-8 text-center">
                <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary-400 mb-2" />
                <p className="text-surface-400">Berechne Token-Schätzung...</p>
              </div>
            ) : confirmEstimate && (
              <>
                {/* Token Info */}
                <div className="bg-surface-700/50 rounded-lg p-4 mb-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-surface-400">Modell</span>
                    <span className="text-primary-400 font-medium">{confirmEstimate.model}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-surface-400">Daten</span>
                    <span className="text-surface-200">{confirmEstimate.items_info}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-surface-400">Geschätzte Tokens</span>
                    <span className="text-surface-200">~{confirmEstimate.estimated_tokens.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-surface-400">Token-Limit</span>
                    <span className="text-surface-200">{confirmEstimate.token_limit.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-surface-400">Auslastung</span>
                    <span className={clsx(
                      'px-2 py-0.5 rounded text-xs font-medium',
                      confirmEstimate.estimated_tokens > confirmEstimate.token_limit * 0.8 
                        ? 'bg-amber-500/20 text-amber-400' 
                        : 'bg-emerald-500/20 text-emerald-400'
                    )}>
                      {Math.round(confirmEstimate.estimated_tokens / confirmEstimate.token_limit * 100)}%
                    </span>
                  </div>
                </div>
                
                {confirmEstimate.warning && (
                  <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg mb-4">
                    <p className="text-amber-400 text-sm">⚠️ {confirmEstimate.warning}</p>
                  </div>
                )}
                
                {/* External LLM Warning */}
                {confirmEstimate.is_external && (
                  <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg mb-4">
                    <p className="text-blue-400 text-sm flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                      <span>
                        <strong>Hinweis:</strong> Du verwendest einen externen LLM-Anbieter. 
                        Deine Tag-Namen werden zur Analyse an diesen Dienst übertragen.
                      </span>
                    </p>
                  </div>
                )}
              </>
            )}
            
            <div className="flex gap-3 justify-end mt-4">
              <button
                onClick={() => setConfirmModal(null)}
                className="btn btn-secondary"
              >
                Abbrechen
              </button>
              <button
                onClick={confirmAndAnalyze}
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
