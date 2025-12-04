import { useState, useEffect } from 'react'
import { 
  Sparkles, Loader2, Tag, AlertCircle, Trash2,
  ChevronRight, ChevronLeft, Check, Users, FileText, Layers, RefreshCw, Brain,
  Shield, Plus, X
} from 'lucide-react'
import clsx from 'clsx'
import * as api from '../services/api'

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
  
  // Ignore list
  const [ignoredTags, setIgnoredTags] = useState<IgnoredTag[]>([])
  const [showIgnoreModal, setShowIgnoreModal] = useState(false)
  const [newIgnorePattern, setNewIgnorePattern] = useState('')
  const [newIgnoreReason, setNewIgnoreReason] = useState('')

  useEffect(() => {
    loadInitialData()
    loadIgnoredTags()
  }, [])
  
  const loadIgnoredTags = async () => {
    try {
      const data = await api.getIgnoredTags()
      setIgnoredTags(data)
    } catch (e) {
      console.error('Failed to load ignored tags:', e)
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
  
  const addTagToIgnoreList = async (tagName: string) => {
    try {
      const newTag = await api.addIgnoredTag({
        pattern: tagName,
        reason: 'Aus Vorschlag entfernt'
      })
      setIgnoredTags([...ignoredTags, newTag])
      // Remove from nonsense list
      setNonsenseTags(nonsenseTags.filter(t => t.name !== tagName))
      setSelectedNonsense(prev => {
        const tag = nonsenseTags.find(t => t.name === tagName)
        if (tag) {
          const newSet = new Set(prev)
          newSet.delete(tag.id)
          return newSet
        }
        return prev
      })
    } catch (e) {
      console.error('Failed to add to ignore list:', e)
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
      
      // Reset AI-analyzed data
      setNonsenseTags([])
      setCorrespondentMatches([])
      setDocTypeMatches([])
      setSimilarGroups([])
      
    } catch (e) {
      console.error('Error loading data:', e)
    } finally {
      setLoading(false)
      const elapsed = Date.now() - startTime
      setLoadTime(elapsed)
      if (elapsed < 1000) {
        setCachedInfo('(aus Cache)')
      }
    }
  }
  
  const analyzeStep = async (step: number) => {
    setAnalyzing(true)
    setError(null)
    
    try {
      switch(step) {
        case 2: // Nonsense tags via AI
          const nonsenseResult = await api.analyzeNonsenseTags()
          if (nonsenseResult.error) {
            setError(nonsenseResult.error)
          } else {
            setNonsenseTags(nonsenseResult.nonsense_tags || [])
            setSelectedNonsense(new Set(nonsenseResult.nonsense_tags?.map((t: NonsenseTag) => t.id) || []))
          }
          break
          
        case 3: // Correspondent matches via AI
          const corrResult = await api.analyzeCorrespondentTags()
          if (corrResult.error) {
            setError(corrResult.error)
          } else {
            setCorrespondentMatches(corrResult.correspondent_tags || [])
            setSelectedCorrespondentMatches(new Set(corrResult.correspondent_tags?.map((t: CorrespondentMatch) => t.tag_id) || []))
          }
          break
          
        case 4: // Doctype matches via AI
          const dtResult = await api.analyzeDoctypeTags()
          if (dtResult.error) {
            setError(dtResult.error)
          } else {
            setDocTypeMatches(dtResult.doctype_tags || [])
            setSelectedDocTypeMatches(new Set(dtResult.doctype_tags?.map((t: DoctypeMatch) => t.tag_id) || []))
          }
          break
          
        case 5: // Similar tags via AI
          const analysisResult = await api.analyzeTags(200)
          if (analysisResult.error) {
            setError(analysisResult.error)
          } else {
            setSimilarGroups(analysisResult.groups || [])
          }
          break
      }
      
      setStepStatus(prev => ({
        ...prev,
        [step]: { ...prev[step], analyzed: true }
      }))
      
    } catch (e: any) {
      setError(e.message || 'Analyse fehlgeschlagen')
    } finally {
      setAnalyzing(false)
    }
  }

  const executeStep = async (step: number) => {
    setProcessing(true)
    setError(null)
    try {
      let result: StepStatus['result'] = {}
      
      switch(step) {
        case 1: // Delete empty tags
          const emptyToDelete = emptyTags.filter(t => selectedEmpty.has(t.id))
          let deleted1 = 0
          for (const tag of emptyToDelete) {
            try {
              await api.deleteTag(tag.id)
              deleted1++
            } catch (e) {
              console.error(`Failed to delete tag ${tag.name}:`, e)
            }
          }
          result.deleted = deleted1
          result.total = emptyToDelete.length
          break
          
        case 2: // Delete nonsense tags
          const nonsenseToDelete = nonsenseTags.filter(t => selectedNonsense.has(t.id))
          let deleted2 = 0
          for (const tag of nonsenseToDelete) {
            try {
              await api.deleteTag(tag.id)
              deleted2++
            } catch (e) {
              console.error(`Failed to delete tag ${tag.name}:`, e)
            }
          }
          result.deleted = deleted2
          result.total = nonsenseToDelete.length
          break
          
        case 3: // Delete correspondent tags
          const corrToDelete = correspondentMatches.filter(m => selectedCorrespondentMatches.has(m.tag_id))
          let deleted3 = 0
          for (const match of corrToDelete) {
            try {
              await api.deleteTag(match.tag_id)
              deleted3++
            } catch (e) {
              console.error(`Failed to delete tag ${match.tag_name}:`, e)
            }
          }
          result.deleted = deleted3
          result.total = corrToDelete.length
          break
          
        case 4: // Delete doctype tags
          const dtToDelete = docTypeMatches.filter(m => selectedDocTypeMatches.has(m.tag_id))
          let deleted4 = 0
          for (const match of dtToDelete) {
            try {
              await api.deleteTag(match.tag_id)
              deleted4++
            } catch (e) {
              console.error(`Failed to delete tag ${match.tag_name}:`, e)
            }
          }
          result.deleted = deleted4
          result.total = dtToDelete.length
          break
          
        case 5: // Similar tags - redirect to tag manager for merge
          // Just mark as completed, actual merge happens in TagManager
          break
      }
      
      setStepStatus(prev => ({
        ...prev,
        [step]: { completed: true, skipped: false, result }
      }))
      
      // Reload data
      await loadInitialData()
      
    } catch (e) {
      console.error('Error executing step:', e)
    } finally {
      setProcessing(false)
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
                <h4 className="text-lg font-medium text-surface-100 mb-2">KI-Analyse erforderlich</h4>
                <p className="text-surface-400 mb-6 max-w-md mx-auto">
                  Die KI analysiert alle Tags und identifiziert unsinnige, generische oder sinnlose Tags wie "test", "Dokument", "Sonstige" etc.
                </p>
                <button
                  onClick={() => analyzeStep(2)}
                  disabled={analyzing}
                  className="btn btn-primary flex items-center gap-2 mx-auto"
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
              {nonsenseTags.map(tag => (
                <div key={tag.id} className="flex items-start gap-3 p-3 rounded bg-surface-700/30 hover:bg-surface-700/50">
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
                    <div className="flex items-center gap-2">
                      <Tag className="w-4 h-4 text-amber-400" />
                      <span className="text-surface-200 font-medium">{tag.name}</span>
                      <span className="text-surface-500 text-sm">({tag.document_count} Dok.)</span>
                      <span className="text-xs text-amber-400 bg-amber-500/20 px-2 py-0.5 rounded">
                        {Math.round(tag.confidence * 100)}%
                      </span>
                    </div>
                    <p className="text-sm text-surface-400 mt-1">{tag.reason}</p>
                  </div>
                  <button
                    onClick={() => addTagToIgnoreList(tag.name)}
                    className="text-xs text-emerald-400 hover:text-emerald-300 px-2 py-1 bg-emerald-500/10 rounded"
                    title="Zur Ignorier-Liste hinzufügen"
                  >
                    <Shield className="w-4 h-4" />
                  </button>
                </div>
              ))}
              {nonsenseTags.length === 0 && (
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
              <h4 className="text-lg font-medium text-surface-100 mb-2">KI-Analyse erforderlich</h4>
              <p className="text-surface-400 mb-6 max-w-md mx-auto">
                Die KI analysiert alle Tags und findet Tags die eigentlich Firmen oder Personen (Korrespondenten) sind.
              </p>
              <button
                onClick={() => analyzeStep(3)}
                disabled={analyzing}
                className="btn btn-primary flex items-center gap-2 mx-auto"
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
            </div>
          )
        }
        
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-surface-300">
                <strong className="text-blue-400">{correspondentMatches.length}</strong> Tags sind eigentlich Korrespondenten
              </p>
            </div>
            
            <div className="max-h-96 overflow-y-auto space-y-2">
              {correspondentMatches.map(match => (
                <label key={match.tag_id} className="flex items-start gap-3 p-3 rounded bg-surface-700/30 hover:bg-surface-700/50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedCorrespondentMatches.has(match.tag_id)}
                    onChange={(e) => {
                      const newSet = new Set(selectedCorrespondentMatches)
                      if (e.target.checked) newSet.add(match.tag_id)
                      else newSet.delete(match.tag_id)
                      setSelectedCorrespondentMatches(newSet)
                    }}
                    className="w-4 h-4 mt-1"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Tag className="w-4 h-4 text-purple-400" />
                      <span className="text-surface-200">Tag: {match.tag_name}</span>
                      <span className="text-surface-500 text-sm">({match.document_count} Dok.)</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-sm">
                      <Users className="w-4 h-4 text-blue-400" />
                      <span className="text-surface-400">
                        → Korrespondent: {match.suggested_correspondent}
                        {match.correspondent_exists && <span className="text-emerald-400 ml-1">(existiert)</span>}
                      </span>
                    </div>
                    <p className="text-sm text-surface-500 mt-1">{match.reason}</p>
                  </div>
                </label>
              ))}
              {correspondentMatches.length === 0 && (
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
              <h4 className="text-lg font-medium text-surface-100 mb-2">KI-Analyse erforderlich</h4>
              <p className="text-surface-400 mb-6 max-w-md mx-auto">
                Die KI analysiert alle Tags und findet Tags die eigentlich Dokumententypen sind (z.B. "Rechnung", "Vertrag").
              </p>
              <button
                onClick={() => analyzeStep(4)}
                disabled={analyzing}
                className="btn btn-primary flex items-center gap-2 mx-auto"
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
            </div>
          )
        }
        
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-surface-300">
                <strong className="text-amber-400">{docTypeMatches.length}</strong> Tags sind eigentlich Dokumententypen
              </p>
            </div>
            
            <div className="max-h-96 overflow-y-auto space-y-2">
              {docTypeMatches.map(match => (
                <label key={match.tag_id} className="flex items-start gap-3 p-3 rounded bg-surface-700/30 hover:bg-surface-700/50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedDocTypeMatches.has(match.tag_id)}
                    onChange={(e) => {
                      const newSet = new Set(selectedDocTypeMatches)
                      if (e.target.checked) newSet.add(match.tag_id)
                      else newSet.delete(match.tag_id)
                      setSelectedDocTypeMatches(newSet)
                    }}
                    className="w-4 h-4 mt-1"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Tag className="w-4 h-4 text-purple-400" />
                      <span className="text-surface-200">Tag: {match.tag_name}</span>
                      <span className="text-surface-500 text-sm">({match.document_count} Dok.)</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-sm">
                      <FileText className="w-4 h-4 text-amber-400" />
                      <span className="text-surface-400">
                        → Dokumententyp: {match.suggested_doctype}
                        {match.doctype_exists && <span className="text-emerald-400 ml-1">(existiert)</span>}
                      </span>
                    </div>
                    <p className="text-sm text-surface-500 mt-1">{match.reason}</p>
                  </div>
                </label>
              ))}
              {docTypeMatches.length === 0 && (
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
              <h4 className="text-lg font-medium text-surface-100 mb-2">KI-Analyse erforderlich</h4>
              <p className="text-surface-400 mb-6 max-w-md mx-auto">
                Die KI findet ähnliche Tags wie "Hoster", "Webhoster", "Web-Hoster" und schlägt vor, sie zusammenzulegen.
              </p>
              <button
                onClick={() => analyzeStep(5)}
                disabled={analyzing}
                className="btn btn-primary flex items-center gap-2 mx-auto"
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
              Schritt abgeschlossen!
              {stepStatus[currentStep].result?.deleted !== undefined && 
                ` ${stepStatus[currentStep].result.deleted} von ${stepStatus[currentStep].result.total || stepStatus[currentStep].result.deleted} gelöscht.`}
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
              className="btn btn-primary flex items-center gap-2"
            >
              {processing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Verarbeite...
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
    </div>
  )
}
