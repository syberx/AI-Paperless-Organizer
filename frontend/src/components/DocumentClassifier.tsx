import { useState, useEffect, useRef } from 'react'
import {
  Sparkles, Settings2, Play, Check, Loader2,
  FileText, Tags, Users, FolderOpen, Calendar, Hash,
  Clock, Coins, AlertCircle, RefreshCw,
  History, XCircle, Info, ChevronDown, ChevronRight,
  Save, MessageSquare, Scale, Plus, Minus, Copy, Bug, X, Search, Pencil
} from 'lucide-react'
import clsx from 'clsx'
import * as api from '../services/api'

type Tab = 'classify' | 'benchmark' | 'settings' | 'history' | 'review' | 'tag_ideas'

export default function DocumentClassifier() {
  const [activeTab, setActiveTab] = useState<Tab>('classify')
  const [config, setConfig] = useState<api.ClassifierConfig | null>(null)
  const [loading, setLoading] = useState(true)

  // Classify tab state
  const [documentId, setDocumentId] = useState<string>('')
  const [classifying, setClassifying] = useState(false)
  const [result, setResult] = useState<api.ClassificationResult | null>(null)
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState(false)
  const [applyingAndNext, setApplyingAndNext] = useState(false)
  const [nextStatus, setNextStatus] = useState<string>('')

  // Editable result state (user can modify before applying)
  const [editTitle, setEditTitle] = useState<string>('')
  const [editTags, setEditTags] = useState<string[]>([])
  const [editCorrespondent, setEditCorrespondent] = useState<string>('')
  const [editDocType, setEditDocType] = useState<string>('')
  const [editCreatedDate, setEditCreatedDate] = useState<string>('')
  const [editStoragePathId, setEditStoragePathId] = useState<number | null>(null)
  const [editCustomFields, setEditCustomFields] = useState<Record<string, string | null>>({})
  const [disabledCustomFields, setDisabledCustomFields] = useState<Set<string>>(new Set())
  const [editExistingTags, setEditExistingTags] = useState<string[]>([])
  const [tagSearch, setTagSearch] = useState<string>('')
  const [corrSearch, setCorrSearch] = useState<string>('')
  const [showTagDropdown, setShowTagDropdown] = useState(false)
  const [showCorrDropdown, setShowCorrDropdown] = useState(false)
  const [paperlessStoragePaths, setPaperlessStoragePaths] = useState<any[]>([])
  const tagSearchRef = useRef<HTMLInputElement>(null)
  const resultRef = useRef<HTMLDivElement>(null)

  // Settings tab state
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [ollamaModels, setOllamaModels] = useState<api.OllamaModelsResponse | null>(null)
  const [ollamaLoading, setOllamaLoading] = useState(false)
  const [, setOllamaTestResult] = useState<api.OllamaTestResponse | null>(null)

  // Collapsible sections
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({})
  const [paperlessTags, setPaperlessTags] = useState<api.PaperlessTag[]>([])
  const [paperlessCorrespondents, setPaperlessCorrespondents] = useState<api.PaperlessCorrespondent[]>([])
  const [paperlessDocTypes, setPaperlessDocTypes] = useState<api.PaperlessDocumentType[]>([])
  const [storagePathProfiles, setStoragePathProfiles] = useState<api.StoragePathProfile[]>([])
  const [paperlessItemsLoading, setPaperlessItemsLoading] = useState(false)
  const [promptDefaults, setPromptDefaults] = useState<api.PromptDefaults | null>(null)
  const [customFieldMappings, setCustomFieldMappings] = useState<api.CustomFieldMapping[]>([])
  const [customFieldsSaving, setCustomFieldsSaving] = useState(false)

  // Benchmark tab state
  const [benchmarkDocId, setBenchmarkDocId] = useState<string>('')
  const [benchmarkRunning, setBenchmarkRunning] = useState(false)
  const [benchmarkResult, setBenchmarkResult] = useState<api.BenchmarkResponse | null>(null)
  const [benchSlots, setBenchSlots] = useState<api.BenchmarkSlot[]>([
    { provider: 'openai', model: 'gpt-4o-mini' },
    { provider: 'ollama', model: '' },
  ])

  // History tab state
  const [history, setHistory] = useState<api.ClassificationHistoryEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [stats, setStats] = useState<api.ClassifierStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const [tagStats, setTagStats] = useState<api.TagStats | null>(null)
  const [cacheRefreshing, setCacheRefreshing] = useState(false)
  const [reviewQueue, setReviewQueue] = useState<any[]>([])
  const [reviewLoading, setReviewLoading] = useState(false)
  const [autoClassifyStatus, setAutoClassifyStatus] = useState<any>(null)
  const [reviewMode, setReviewMode] = useState(false)

  // Tag ideas state
  const [tagIdeas, setTagIdeas] = useState<any[]>([])
  const [tagIdeasStats, setTagIdeasStats] = useState<any>(null)
  const [tagIdeasLoading, setTagIdeasLoading] = useState(false)

  useEffect(() => {
    loadConfig()
  }, [])

  const loadConfig = async () => {
    try {
      const cfg = await api.getClassifierConfig()
      setConfig(cfg)
    } catch (e) {
      console.error('Failed to load classifier config:', e)
    } finally {
      setLoading(false)
    }
  }

  const initEditState = (res: api.ClassificationResult) => {
    setEditTitle(res.title || '')
    setEditTags(res.tags || [])
    setEditExistingTags(
      (res.existing_tags || []).filter(t => !(res.tags || []).includes(t))
    )
    setEditCorrespondent(res.correspondent || '')
    setEditDocType(res.document_type || '')
    setEditCreatedDate(res.created_date || '')

    // Respect storage_path_behavior when initializing edit state
    let effectiveStoragePathId = res.storage_path_id
    if (config) {
      const spBehavior = config.storage_path_behavior || 'always'
      const existingId = res.existing_storage_path_id
      const existingName = (res.existing_storage_path_name || '').trim().toLowerCase()
      if (existingId) {
        if (spBehavior === 'keep_if_set') {
          effectiveStoragePathId = existingId
        } else if (spBehavior === 'keep_except_list') {
          const overrideNames = (config.storage_path_override_names || []).map(n => n.toLowerCase())
          if (!overrideNames.includes(existingName)) {
            effectiveStoragePathId = existingId
          }
        }
      }
    }
    setEditStoragePathId(effectiveStoragePathId)

    setEditCustomFields(
      Object.fromEntries(Object.entries(res.custom_fields).map(([k, v]) => [k, v !== null ? String(v) : null]))
    )
    setDisabledCustomFields(new Set())
    setTagSearch('')
    setCorrSearch('')
  }

  // Helper: was this field kept from existing (not changed by AI)?
  const isUnchanged = (field: 'correspondent' | 'document_type' | 'storage_path', res: api.ClassificationResult) => {
    if (field === 'correspondent')
      return res.correspondent === res.existing_correspondent && !!res.existing_correspondent
    if (field === 'document_type')
      return res.document_type === res.existing_document_type && !!res.existing_document_type
    if (field === 'storage_path')
      return res.storage_path_id === res.existing_storage_path_id && !!res.existing_storage_path_id
    return false
  }

  const handleClassify = async () => {
    const docId = parseInt(documentId)
    if (!docId || docId <= 0) return

    setClassifying(true)
    setResult(null)
    setApplied(false)
    setReviewMode(false)
    // Load Paperless items for editing if not yet loaded
    if (paperlessTags.length === 0 || paperlessDocTypes.length === 0 || paperlessCorrespondents.length === 0) loadPaperlessItems()
    if (paperlessStoragePaths.length === 0) {
      api.getStoragePathsFromPaperless().then(setPaperlessStoragePaths).catch(() => {})
    }
    try {
      const res = await api.classifyDocument(docId)
      setResult(res)
      initEditState(res)
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
    } catch (e: any) {
      const errRes: api.ClassificationResult = {
        title: null, tags: [], tags_new: [], existing_tags: [],
        existing_correspondent: null, existing_document_type: null,
        existing_storage_path_id: null, existing_storage_path_name: null,
        correspondent: null, correspondent_is_new: false,
        document_type: null, storage_path_id: null, storage_path_name: null, storage_path_reason: null,
        created_date: null, custom_fields: {}, tokens_input: 0, tokens_output: 0,
        cost_usd: 0, duration_seconds: 0, tool_calls_count: 0,
        error: e.message || 'Unbekannter Fehler',
      }
      setResult(errRes)
    } finally {
      setClassifying(false)
    }
  }

  const handleApply = async () => {
    if (!result || result.error || !documentId) return
    setApplying(true)
    try {
      await api.applyClassification(parseInt(documentId), {
        title: editTitle || result.title,
        tags: [...editTags, ...editExistingTags],
        correspondent: editCorrespondent || result.correspondent,
        document_type: editDocType || result.document_type,
        storage_path_id: editStoragePathId,
        existing_storage_path_id: result.existing_storage_path_id,
        existing_storage_path_name: result.existing_storage_path_name,
        created_date: editCreatedDate || result.created_date,
        custom_fields: Object.fromEntries(Object.entries(editCustomFields).filter(([k]) => !disabledCustomFields.has(k))),
      })
      setApplied(true)
      // Refresh Paperless lists so new tags/correspondents appear immediately
      loadPaperlessItems()
      // Remove from review queue if in review mode
      if (reviewMode) {
        const currentId = parseInt(documentId)
        setReviewQueue(prev => prev.filter(e => e.document_id !== currentId))
      }
    } catch (e) {
      console.error('Failed to apply:', e)
    } finally {
      setApplying(false)
    }
  }

  const handleApplyAndNext = async () => {
    if (!result || result.error || !documentId) return
    setApplyingAndNext(true)
    setNextStatus('Wende Klassifizierung an...')
    const currentId = parseInt(documentId)
    try {
      // 1. Apply current classification
      await api.applyClassification(currentId, {
        title: editTitle || result.title,
        tags: [...editTags, ...editExistingTags],
        correspondent: editCorrespondent || result.correspondent,
        document_type: editDocType || result.document_type,
        storage_path_id: editStoragePathId,
        existing_storage_path_id: result.existing_storage_path_id,
        existing_storage_path_name: result.existing_storage_path_name,
        created_date: editCreatedDate || result.created_date,
        custom_fields: Object.fromEntries(Object.entries(editCustomFields).filter(([k]) => !disabledCustomFields.has(k))),
      })
      setApplied(true)

      // Refresh Paperless lists so new tags/correspondents appear immediately
      loadPaperlessItems()
      api.getStoragePathsFromPaperless().then(setPaperlessStoragePaths).catch(() => {})

      if (reviewMode) {
        // ── Review mode: remove applied entry and load next from review queue ──
        setNextStatus('Lade nächsten Prüf-Eintrag...')

        // Small delay to let backend commit the status change
        await new Promise(r => setTimeout(r, 300))

        let freshQueue: any[] = []
        try {
          freshQueue = await api.fetchJson<any[]>('/classifier/review-queue')
        } catch {
          freshQueue = reviewQueue
        }
        // Safety: filter out the just-applied document in case of race condition
        freshQueue = freshQueue.filter(e => e.document_id !== currentId)
        setReviewQueue(freshQueue)

        if (freshQueue.length === 0) {
          setNextStatus('Prüf-Warteschlange leer!')
          setReviewMode(false)
          setTimeout(() => setNextStatus(''), 3000)
          setApplyingAndNext(false)
          return
        }

        const nextEntry = freshQueue[0]
        const nextRes = nextEntry.result_json as api.ClassificationResult
        setDocumentId(String(nextEntry.document_id))
        setResult(nextRes)
        initEditState(nextRes)
        setApplied(false)
        setApplyingAndNext(false)
        setNextStatus('')
        setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
      } else {
        // ── Normal mode: find next unclassified document ──
        setNextStatus('Suche naechstes Dokument...')
        const next = await api.getNextUnclassified(currentId)
        if (!next.found || !next.document_id) {
          setNextStatus('Keine weiteren Dokumente gefunden!')
          setTimeout(() => setNextStatus(''), 3000)
          setApplyingAndNext(false)
          return
        }

        setNextStatus(`Lade Dokument #${next.document_id}...`)
        setDocumentId(String(next.document_id))
        setResult(null)
        setApplied(false)
        setApplyingAndNext(false)

        setClassifying(true)
        setNextStatus('')
        try {
          const res = await api.classifyDocument(next.document_id)
          setResult(res)
          initEditState(res)
          setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
        } catch (e: any) {
          const errRes: api.ClassificationResult = {
            title: null, tags: [], tags_new: [], existing_tags: [],
            existing_correspondent: null, existing_document_type: null,
            existing_storage_path_id: null, existing_storage_path_name: null,
            correspondent: null, correspondent_is_new: false,
            document_type: null, storage_path_id: null, storage_path_name: null, storage_path_reason: null,
            created_date: null, custom_fields: {}, tokens_input: 0, tokens_output: 0,
            cost_usd: 0, duration_seconds: 0, tool_calls_count: 0,
            error: e.message || 'Unbekannter Fehler',
          }
          setResult(errRes)
        } finally {
          setClassifying(false)
        }
      }
    } catch (e: any) {
      setNextStatus(`Fehler: ${e.message}`)
      setTimeout(() => setNextStatus(''), 4000)
      setApplyingAndNext(false)
    }
  }

  const toggleSection = (key: string) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const loadPaperlessItems = async () => {
    setPaperlessItemsLoading(true)
    try {
      const [tags, correspondents, docTypes, profiles, defaults, cfMappings] = await Promise.all([
        api.getClassifierTags(),
        api.getClassifierCorrespondents(),
        api.getClassifierDocumentTypes(),
        api.getStoragePathProfiles(),
        api.getClassifierPromptDefaults(),
        api.getCustomFieldMappings(),
      ])
      setPaperlessTags(tags)
      setPaperlessCorrespondents(correspondents)
      setPaperlessDocTypes(docTypes)
      setStoragePathProfiles(profiles)
      setPromptDefaults(defaults)
      setCustomFieldMappings(cfMappings)
    } catch (e) {
      console.error('Failed to load Paperless items:', e)
    } finally {
      setPaperlessItemsLoading(false)
    }
  }

  useEffect(() => {
    if (activeTab === 'settings' && paperlessTags.length === 0) {
      loadPaperlessItems()
    }
    if ((activeTab === 'settings' || activeTab === 'benchmark') && !ollamaModels) {
      loadOllamaModels()
    }
  }, [activeTab])

  const toggleExclusion = (type: 'excluded_tag_ids' | 'excluded_correspondent_ids' | 'excluded_document_type_ids', id: number) => {
    if (!config) return
    const current = config[type] || []
    const updated = current.includes(id) ? current.filter((x: number) => x !== id) : [...current, id]
    setConfig({ ...config, [type]: updated })
  }

  const updateStorageProfile = (pathId: number, field: string, value: any) => {
    setStoragePathProfiles(prev =>
      prev.map(p => p.paperless_path_id === pathId ? { ...p, [field]: value } : p)
    )
  }

  const updateCustomFieldMapping = (fieldId: number, field: string, value: any) => {
    setCustomFieldMappings(prev =>
      prev.map(m => m.paperless_field_id === fieldId ? { ...m, [field]: value } : m)
    )
  }

  const handleSaveCustomFieldMappings = async () => {
    setCustomFieldsSaving(true)
    try {
      await api.saveCustomFieldMappings(customFieldMappings)
    } catch (e) {
      console.error('Failed to save custom field mappings:', e)
    } finally {
      setCustomFieldsSaving(false)
    }
  }

  const handleSaveProfiles = async () => {
    setSettingsSaving(true)
    try {
      await api.saveStoragePathProfiles(storagePathProfiles)
    } catch (e) {
      console.error('Failed to save profiles:', e)
    } finally {
      setSettingsSaving(false)
    }
  }

  const loadOllamaModels = async () => {
    setOllamaLoading(true)
    setOllamaTestResult(null)
    try {
      const models = await api.getClassifierOllamaModels()
      setOllamaModels(models)
    } catch (e) {
      console.error('Failed to load Ollama models:', e)
      setOllamaModels({ connected: false, ollama_host: '', installed: [], suggestions: [], top_recommendation: null })
    } finally {
      setOllamaLoading(false)
    }
  }


  const handleSaveConfig = async () => {
    if (!config) return
    setSettingsSaving(true)
    try {
      await api.updateClassifierConfig(config)
    } catch (e) {
      console.error('Failed to save config:', e)
    } finally {
      setSettingsSaving(false)
    }
  }

  const updateBenchSlot = (idx: number, field: 'provider' | 'model', value: string) => {
    setBenchSlots(prev => prev.map((s, i) => {
      if (i !== idx) return s
      if (field === 'provider') return { provider: value, model: '' }
      return { ...s, model: value }
    }))
  }

  const addBenchSlot = () => {
    if (benchSlots.length >= 6) return
    setBenchSlots(prev => [...prev, { provider: 'ollama', model: '' }])
  }

  const removeBenchSlot = (idx: number) => {
    if (benchSlots.length <= 2) return
    setBenchSlots(prev => prev.filter((_, i) => i !== idx))
  }

  const handleBenchmark = async () => {
    const docId = parseInt(benchmarkDocId)
    if (!docId || docId <= 0 || benchSlots.length < 2) return
    setBenchmarkRunning(true)
    setBenchmarkResult(null)
    try {
      const res = await api.benchmarkDocument({
        document_id: docId,
        slots: benchSlots,
      })
      setBenchmarkResult(res)
    } catch (e: any) {
      const emptyResult: api.ClassificationResult = {
        title: null, tags: [], tags_new: [], existing_tags: [],
        existing_correspondent: null, existing_document_type: null,
        existing_storage_path_id: null, existing_storage_path_name: null,
        correspondent: null, correspondent_is_new: false,
        document_type: null, storage_path_id: null, storage_path_name: null, storage_path_reason: null,
        created_date: null, custom_fields: {}, tokens_input: 0, tokens_output: 0,
        cost_usd: 0, duration_seconds: 0, tool_calls_count: 0, error: e.message,
      }
      setBenchmarkResult({
        document_id: docId,
        document_title: '',
        results: benchSlots.map(s => ({ provider: s.provider, model: s.model || '?', result: emptyResult })),
      })
    } finally {
      setBenchmarkRunning(false)
    }
  }

  const loadHistory = async () => {
    setHistoryLoading(true)
    try {
      const h = await api.getClassificationHistory()
      setHistory(h)
    } catch (e) {
      console.error('Failed to load history:', e)
    } finally {
      setHistoryLoading(false)
    }
  }

  const loadReviewQueue = async () => {
    setReviewLoading(true)
    try {
      const q = await api.fetchJson<any[]>('/classifier/review-queue')
      setReviewQueue(q)
    } catch (e) {
      console.error('Failed to load review queue:', e)
    } finally {
      setReviewLoading(false)
    }
  }

  const loadTagIdeas = async () => {
    setTagIdeasLoading(true)
    try {
      const [ideas, stats] = await Promise.all([
        api.fetchJson<any[]>('/classifier/tag-ideas'),
        api.fetchJson<any>('/classifier/tag-ideas/stats'),
      ])
      setTagIdeas(ideas)
      setTagIdeasStats(stats)
    } catch (e) {
      console.error('Failed to load tag ideas:', e)
    } finally {
      setTagIdeasLoading(false)
    }
  }

  const approveTagIdea = async (entryId: number, tagName: string) => {
    try {
      await api.fetchJson(`/classifier/tag-ideas/${entryId}/approve`, {
        method: 'POST',
        body: JSON.stringify({ tag_name: tagName }),
      })
      await loadTagIdeas()
    } catch (e) {
      console.error('Failed to approve tag idea:', e)
    }
  }

  const dismissTagIdea = async (entryId: number, tagName: string) => {
    try {
      await api.fetchJson(`/classifier/tag-ideas/${entryId}/dismiss`, {
        method: 'POST',
        body: JSON.stringify({ tag_name: tagName }),
      })
      await loadTagIdeas()
    } catch (e) {
      console.error('Failed to dismiss tag idea:', e)
    }
  }

  const approveAllTagIdeas = async (entryId: number) => {
    try {
      await api.fetchJson(`/classifier/tag-ideas/${entryId}/approve-all`, {
        method: 'POST',
      })
      await loadTagIdeas()
    } catch (e) {
      console.error('Failed to approve all tag ideas:', e)
    }
  }

  const loadAutoClassifyStatus = async () => {
    try {
      const s = await api.fetchJson<any>('/classifier/auto-classify/status')
      setAutoClassifyStatus(s)
    } catch {}
  }

  const toggleAutoClassify = async () => {
    const endpoint = autoClassifyStatus?.enabled
      ? '/classifier/auto-classify/stop'
      : '/classifier/auto-classify/start'
    await api.fetchJson(endpoint, { method: 'POST' })
    await loadAutoClassifyStatus()
  }

  const loadStats = async () => {
    setStatsLoading(true)
    try {
      const [s, ts] = await Promise.all([
        api.getClassifierStats(),
        api.getTagStats(),
      ])
      setStats(s)
      setTagStats(ts)
    } catch (e) {
      console.error('Failed to load stats:', e)
    } finally {
      setStatsLoading(false)
    }
  }

  const openHistoryEntry = (entry: api.ClassificationHistoryEntry) => {
    if (!entry.result_json) return
    const res = entry.result_json as api.ClassificationResult
    setDocumentId(String(entry.document_id))
    setResult(res)
    setApplied(entry.status === 'applied')
    setReviewMode(entry.status === 'review')
    initEditState(res)
    if (paperlessTags.length === 0 || paperlessDocTypes.length === 0 || paperlessCorrespondents.length === 0) {
      loadPaperlessItems()
    }
    if (paperlessStoragePaths.length === 0) {
      api.getStoragePathsFromPaperless().then(setPaperlessStoragePaths).catch(() => {})
    }
    setActiveTab('classify')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleRefreshCache = async () => {
    setCacheRefreshing(true)
    try {
      await api.refreshClassifierCache()
      await loadPaperlessItems()
    } catch (e) {
      console.error('Failed to refresh cache:', e)
    } finally {
      setCacheRefreshing(false)
    }
  }

  useEffect(() => {
    if (activeTab === 'review') {
      loadReviewQueue()
      loadAutoClassifyStatus()
    }
    if (activeTab === 'tag_ideas') {
      loadTagIdeas()
    }
  }, [activeTab])

  useEffect(() => {
    if (activeTab === 'history') {
      loadHistory()
      loadStats()
    }
  }, [activeTab])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary-400" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-purple-700
                        flex items-center justify-center shadow-lg shadow-purple-600/30">
            <Sparkles className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-display font-bold text-surface-100">
              KI-Klassifizierer
            </h1>
            <p className="text-sm text-surface-400">
              Automatische Dokumentenklassifizierung mit {
                config?.active_provider === 'openai' ? 'OpenAI' :
                config?.active_provider === 'mistral' ? 'Mistral' :
                config?.active_provider === 'openrouter' ? 'OpenRouter' : 'Ollama'
              }
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-surface-700/50 pb-0">
        {([
          { id: 'classify' as Tab, label: 'Klassifizieren', icon: Play },
          { id: 'benchmark' as Tab, label: 'Benchmark', icon: Scale },
          { id: 'review' as Tab, label: `Prüfen${reviewQueue.length > 0 ? ` (${reviewQueue.length})` : ''}`, icon: AlertCircle },
          { id: 'tag_ideas' as Tab, label: `Tag-Ideen${tagIdeas.length > 0 ? ` (${tagIdeas.length})` : ''}`, icon: Tags },
          { id: 'settings' as Tab, label: 'Einstellungen', icon: Settings2 },
          { id: 'history' as Tab, label: 'Verlauf', icon: History },
        ]).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={clsx(
              'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors -mb-[1px]',
              activeTab === tab.id
                ? 'border-primary-500 text-primary-400'
                : 'border-transparent text-surface-400 hover:text-surface-200'
            )}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Classify Tab */}
      {activeTab === 'classify' && (
        <div className="space-y-6">
          {/* Input */}
          <div className="card p-6">
            <h2 className="text-lg font-semibold text-surface-100 mb-4">Dokument analysieren</h2>
            <div className="flex gap-3">
              <input
                type="number"
                value={documentId}
                onChange={(e) => setDocumentId(e.target.value)}
                placeholder="Dokument-ID eingeben..."
                className="input flex-1"
                min={1}
                onKeyDown={(e) => e.key === 'Enter' && handleClassify()}
              />
              <button
                onClick={handleClassify}
                disabled={classifying || !documentId}
                className="btn btn-primary flex items-center gap-2"
              >
                {classifying ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                {classifying ? 'Analysiere...' : 'Analysieren'}
              </button>
            </div>
            <p className="text-xs text-surface-500 mt-2">
              Die Dokument-ID findest du in der Paperless-URL: /documents/<strong>123</strong>/details
            </p>
          </div>

          {/* Loading skeleton while classifying (no result yet) */}
          {classifying && !result && (
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              <div className="lg:col-span-3 card p-6 space-y-5">
                <div className="flex items-center gap-3 mb-2">
                  <Loader2 className="w-5 h-5 text-primary-400 animate-spin" />
                  <span className="text-sm text-primary-300 font-medium">KI analysiert Dokument...</span>
                </div>
                {[120, 80, 100, 60, 90].map((w, i) => (
                  <div key={i} className="space-y-1.5">
                    <div className="h-3 w-20 bg-surface-700/60 rounded animate-pulse" />
                    <div className={`h-5 bg-surface-700/40 rounded animate-pulse`} style={{ width: `${w}%` }} />
                  </div>
                ))}
              </div>
              <div className="lg:col-span-2 card p-4 flex items-center justify-center">
                <div className="text-center space-y-2">
                  <Loader2 className="w-8 h-8 text-surface-600 animate-spin mx-auto" />
                  <p className="text-xs text-surface-500">Lade Vorschau...</p>
                </div>
              </div>
            </div>
          )}

          {/* Result + Preview side by side */}
          {result && (
            <div ref={resultRef} className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              {/* Left: Classification results (editable) */}
              <div className="lg:col-span-3 card p-6 space-y-5">
                {result.error ? (
                  <div className="flex items-start gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
                    <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-red-400 font-medium">Fehler bei der Analyse</p>
                      <p className="text-red-300/70 text-sm mt-1">{result.error}</p>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Header: stats + reset */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <h2 className="text-lg font-semibold text-surface-100">Vorschlaege</h2>
                        <span className="text-xs text-surface-500 bg-surface-800 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <Pencil className="w-2.5 h-2.5" /> bearbeitbar
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-surface-500">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {result.duration_seconds.toFixed(1)}s
                        </span>
                        <span className="flex items-center gap-1">
                          <Hash className="w-3 h-3" />
                          {result.tokens_input + result.tokens_output} Tokens
                        </span>
                        {result.cost_usd > 0 ? (
                          <span className="flex items-center gap-1 text-amber-400">
                            <Coins className="w-3 h-3" />
                            ${result.cost_usd.toFixed(4)}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-emerald-400">
                            <Coins className="w-3 h-3" />
                            kostenlos
                          </span>
                        )}
                        <button
                          onClick={() => initEditState(result)}
                          className="text-surface-500 hover:text-surface-300 text-xs underline"
                          title="KI-Vorschlaege wiederherstellen"
                        >
                          Zuruecksetzen
                        </button>
                        <button
                          onClick={handleClassify}
                          disabled={classifying}
                          className="flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 disabled:opacity-50"
                          title="Dokument erneut analysieren"
                        >
                          {classifying ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <RefreshCw className="w-3 h-3" />
                          )}
                          Neu analysieren
                        </button>
                      </div>
                    </div>

                    {/* Titel */}
                    <div>
                      <label className="text-xs text-surface-500 flex items-center gap-1 mb-1">
                        <FileText className="w-3 h-3" /> Titel
                      </label>
                      <input
                        type="text"
                        value={editTitle}
                        onChange={e => setEditTitle(e.target.value)}
                        className="input w-full text-sm"
                        placeholder="Titel..."
                      />
                    </div>

                    {/* Korrespondent */}
                    <div className="relative">
                      <label className="text-xs text-surface-500 flex items-center gap-1 mb-1">
                        <Users className="w-3 h-3" /> Korrespondent
                        {isUnchanged('correspondent', result) && (
                          <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-surface-700 text-surface-400 border border-surface-600">
                            unveraendert
                          </span>
                        )}
                        {!isUnchanged('correspondent', result) && result.correspondent && result.existing_correspondent && result.correspondent !== result.existing_correspondent && (
                          <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-primary-500/20 text-primary-300 border border-primary-500/30">
                            war: {result.existing_correspondent}
                          </span>
                        )}
                        {result.correspondent_is_new && editCorrespondent === result.correspondent && (
                          <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
                            Neu -- wird erstellt
                          </span>
                        )}
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          value={editCorrespondent}
                          onChange={e => { setEditCorrespondent(e.target.value); setCorrSearch(e.target.value); setShowCorrDropdown(true) }}
                          onFocus={() => { setCorrSearch(editCorrespondent); setShowCorrDropdown(true) }}
                          onBlur={() => setTimeout(() => setShowCorrDropdown(false), 150)}
                          className="input w-full text-sm pr-8"
                          placeholder="Korrespondent suchen oder eingeben..."
                        />
                        <Search className="w-3.5 h-3.5 text-surface-500 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      </div>
                      {showCorrDropdown && paperlessCorrespondents.length > 0 && (
                        <div className="absolute z-20 mt-1 w-full bg-surface-800 border border-surface-700 rounded-lg shadow-xl max-h-48 overflow-y-auto">
                          {paperlessCorrespondents
                            .filter(c => !corrSearch || c.name.toLowerCase().includes(corrSearch.toLowerCase()))
                            .slice(0, 10)
                            .map(c => (
                              <button
                                key={c.id}
                                onMouseDown={() => { setEditCorrespondent(c.name); setShowCorrDropdown(false) }}
                                className="w-full text-left px-3 py-2 text-sm text-surface-200 hover:bg-surface-700 transition-colors"
                              >
                                {c.name}
                              </button>
                            ))}
                          {corrSearch && !paperlessCorrespondents.find(c => c.name.toLowerCase() === corrSearch.toLowerCase()) && (
                            <button
                              onMouseDown={() => { setEditCorrespondent(corrSearch); setShowCorrDropdown(false) }}
                              className="w-full text-left px-3 py-2 text-sm text-amber-400 hover:bg-surface-700 border-t border-surface-700"
                            >
                              + "{corrSearch}" neu erstellen
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Dokumenttyp */}
                    <div>
                      <label className="text-xs text-surface-500 flex items-center gap-1 mb-1">
                        <FileText className="w-3 h-3" /> Dokumenttyp
                        {isUnchanged('document_type', result) && (
                          <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-surface-700 text-surface-400 border border-surface-600">
                            unveraendert
                          </span>
                        )}
                        {!isUnchanged('document_type', result) && result.document_type && result.existing_document_type && result.document_type !== result.existing_document_type && (
                          <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-primary-500/20 text-primary-300 border border-primary-500/30">
                            war: {result.existing_document_type}
                          </span>
                        )}
                      </label>
                      <select
                        value={editDocType}
                        onChange={e => setEditDocType(e.target.value)}
                        className="input w-full text-sm"
                      >
                        <option value="">-- kein Typ --</option>
                        {paperlessDocTypes.map(dt => (
                          <option key={dt.id} value={dt.name}>{dt.name}</option>
                        ))}
                      </select>
                    </div>

                    {/* Datum + Speicherpfad nebeneinander */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-surface-500 flex items-center gap-1 mb-1">
                          <Calendar className="w-3 h-3" /> Erstelldatum
                        </label>
                        <input
                          type="date"
                          value={editCreatedDate}
                          onChange={e => setEditCreatedDate(e.target.value)}
                          className="input w-full text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-surface-500 flex items-center gap-1 mb-1">
                          <FolderOpen className="w-3 h-3" /> Speicherpfad
                          {isUnchanged('storage_path', result) && (
                            <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-surface-700 text-surface-400 border border-surface-600">
                              unveraendert
                            </span>
                          )}
                          {!isUnchanged('storage_path', result) && result.storage_path_id && result.existing_storage_path_id && result.storage_path_id !== result.existing_storage_path_id && (
                            <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-primary-500/20 text-primary-300 border border-primary-500/30">
                              war: {result.existing_storage_path_name}
                            </span>
                          )}
                        </label>
                        <select
                          value={editStoragePathId ?? ''}
                          onChange={e => setEditStoragePathId(e.target.value ? parseInt(e.target.value) : null)}
                          className="input w-full text-sm"
                        >
                          <option value="">-- kein Pfad --</option>
                          {paperlessStoragePaths.map((sp: any) => (
                            <option key={sp.id} value={sp.id}>{sp.name}</option>
                          ))}
                        </select>
                        {result.storage_path_reason && (
                          <details className="mt-1 group">
                            <summary className="text-xs text-surface-500 cursor-pointer hover:text-surface-300 transition-colors select-none">
                              {result.storage_path_reason.split('.')[0]}.
                              <span className="ml-1 text-surface-600 group-open:hidden">▸ mehr</span>
                            </summary>
                            <p className="text-xs text-surface-500 mt-1 italic pl-2 border-l border-surface-700">
                              {result.storage_path_reason.split('. ').slice(1).join('. ')}
                            </p>
                          </details>
                        )}
                      </div>
                    </div>

                    {/* Tags */}
                    <div>
                      <label className="text-xs text-surface-500 flex items-center gap-1 mb-2">
                        <Tags className="w-3 h-3" />
                        Tags
                        <span className="text-surface-600">
                          ({editTags.length} KI-Vorschlag{editTags.length !== 1 ? 'e' : ''}
                          {editExistingTags.length > 0 && ` + ${editExistingTags.length} vorhanden`})
                        </span>
                      </label>
                      <div className="flex flex-wrap gap-1.5 mb-2 min-h-[2rem]">
                        {/* AI suggested tags */}
                        {editTags.map((tag) => {
                          const isNew = (result.tags_new || []).includes(tag)
                          return (
                            <span
                              key={tag}
                              className={clsx(
                                'px-2.5 py-1 rounded-full text-xs border flex items-center gap-1',
                                isNew
                                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                                  : 'bg-primary-500/20 text-primary-300 border-primary-500/30'
                              )}
                            >
                              {tag}
                              {isNew && <span className="text-[9px] font-bold uppercase opacity-70">Neu</span>}
                              <button
                                onClick={() => setEditTags(prev => prev.filter(t => t !== tag))}
                                className="opacity-50 hover:opacity-100 ml-0.5"
                                title="Tag entfernen"
                              >
                                <X className="w-2.5 h-2.5" />
                              </button>
                            </span>
                          )
                        })}
                        {/* Existing tags not in AI suggestion -- shown greyed out */}
                        {editExistingTags.map((tag) => (
                          <span
                            key={`existing-${tag}`}
                            className="px-2.5 py-1 rounded-full text-xs border flex items-center gap-1 bg-surface-700/50 text-surface-400 border-surface-600/50"
                            title="Vorhandener Tag (wird behalten)"
                          >
                            {tag}
                            <button
                              onClick={() => setEditExistingTags(prev => prev.filter(t => t !== tag))}
                              className="opacity-40 hover:opacity-90 hover:text-red-400 ml-0.5"
                              title="Tag entfernen"
                            >
                              <X className="w-2.5 h-2.5" />
                            </button>
                          </span>
                        ))}
                      </div>
                      {/* Tag search input */}
                      <div className="relative">
                        <div className="flex items-center gap-2 border border-surface-700 rounded-lg px-2.5 bg-surface-800/50 focus-within:border-primary-500/50">
                          <Search className="w-3.5 h-3.5 text-surface-500 shrink-0" />
                          <input
                            ref={tagSearchRef}
                            type="text"
                            value={tagSearch}
                            onChange={e => { setTagSearch(e.target.value); setShowTagDropdown(true) }}
                            onFocus={() => setShowTagDropdown(true)}
                            onBlur={() => setTimeout(() => setShowTagDropdown(false), 150)}
                            placeholder="Tag suchen und hinzufuegen..."
                            className="bg-transparent text-sm text-surface-200 py-1.5 outline-none w-full placeholder-surface-600"
                          />
                        </div>
                        {showTagDropdown && tagSearch && (
                          <div className="absolute z-20 mt-1 w-full bg-surface-800 border border-surface-700 rounded-lg shadow-xl max-h-48 overflow-y-auto">
                            {paperlessTags
                              .filter(t => t.name.toLowerCase().includes(tagSearch.toLowerCase()) && !editTags.includes(t.name) && !editExistingTags.includes(t.name))
                              .slice(0, 12)
                              .map(t => (
                                <button
                                  key={t.id}
                                  onMouseDown={() => {
                                    setEditTags(prev => [...prev, t.name])
                                    setTagSearch('')
                                    setShowTagDropdown(false)
                                    tagSearchRef.current?.focus()
                                  }}
                                  className="w-full text-left px-3 py-2 text-sm text-surface-200 hover:bg-surface-700 transition-colors"
                                >
                                  {t.name}
                                </button>
                              ))}
                            {tagSearch && !paperlessTags.find(t => t.name.toLowerCase() === tagSearch.toLowerCase()) && (
                              <button
                                onMouseDown={() => {
                                  setEditTags(prev => [...prev, tagSearch])
                                  setTagSearch('')
                                  setShowTagDropdown(false)
                                }}
                                className="w-full text-left px-3 py-2 text-sm text-amber-400 hover:bg-surface-700 border-t border-surface-700"
                              >
                                + "{tagSearch}" neu erstellen
                              </button>
                            )}
                            {paperlessTags.filter(t => t.name.toLowerCase().includes(tagSearch.toLowerCase()) && !editTags.includes(t.name)).length === 0 &&
                              paperlessTags.find(t => t.name.toLowerCase() === tagSearch.toLowerCase()) && (
                              <p className="px-3 py-2 text-sm text-surface-500 italic">Bereits hinzugefuegt</p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Custom Fields */}
                    {Object.keys(editCustomFields).length > 0 && (
                      <div>
                        <label className="text-xs text-surface-500 flex items-center gap-1 mb-2">
                          <Hash className="w-3 h-3" /> Custom Fields
                          <span className="text-surface-600 ml-1">— Klick auf Namen zum Deaktivieren</span>
                        </label>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {Object.entries(editCustomFields).map(([key, value]) => {
                            const isDisabled = disabledCustomFields.has(key)
                            return (
                              <div key={key} className={clsx(isDisabled && 'opacity-40')}>
                                <button
                                  type="button"
                                  onClick={() => setDisabledCustomFields(prev => {
                                    const next = new Set(prev)
                                    if (next.has(key)) next.delete(key); else next.add(key)
                                    return next
                                  })}
                                  className={clsx(
                                    'text-xs mb-0.5 flex items-center gap-1 transition-colors',
                                    isDisabled ? 'text-red-400 line-through' : 'text-surface-500 hover:text-surface-300'
                                  )}
                                >
                                  {isDisabled ? <XCircle className="w-3 h-3" /> : <Check className="w-3 h-3 opacity-50" />}
                                  {key}
                                </button>
                                <input
                                  type="text"
                                  value={value ?? ''}
                                  onChange={e => setEditCustomFields(prev => ({ ...prev, [key]: e.target.value || null }))}
                                  disabled={isDisabled}
                                  className={clsx('input w-full text-sm font-mono', isDisabled && 'bg-surface-900 text-surface-600')}
                                  placeholder="nicht gefunden"
                                />
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {/* Apply Buttons */}
                    <div className="pt-2 border-t border-surface-700/50 space-y-2">
                      {/* Review mode indicator */}
                      {reviewMode && (
                        <div className="flex items-center justify-between text-xs bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-1.5">
                          <span className="text-amber-300 font-medium">Prüf-Modus — {reviewQueue.length} weitere in Warteschlange</span>
                          <button onClick={() => setReviewMode(false)} className="text-surface-500 hover:text-surface-300 underline">Beenden</button>
                        </div>
                      )}
                      {/* Status message for apply-and-next */}
                      {nextStatus && (
                        <div className="flex items-center gap-2 text-sm text-primary-300 bg-primary-500/10 border border-primary-500/20 rounded-lg px-3 py-2">
                          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                          {nextStatus}
                        </div>
                      )}
                      <div className="flex justify-end gap-2">
                        {applied && !applyingAndNext ? (
                          <div className="flex items-center gap-2 text-emerald-400 text-sm">
                            <Check className="w-4 h-4" />
                            Angewendet
                          </div>
                        ) : (
                          <>
                            <button
                              onClick={handleApply}
                              disabled={applying || applyingAndNext}
                              className="btn flex items-center gap-2 bg-surface-700 hover:bg-surface-600 text-surface-200 text-sm"
                            >
                              {applying ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Check className="w-3.5 h-3.5" />
                              )}
                              Anwenden
                            </button>
                            <button
                              onClick={handleApplyAndNext}
                              disabled={applying || applyingAndNext}
                              className="btn btn-primary flex items-center gap-2 text-sm"
                            >
                              {applyingAndNext ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Check className="w-3.5 h-3.5" />
                              )}
                              {reviewMode ? 'Anwenden & Nächste Prüfung' : 'Anwenden & Weiter'}
                              {!applyingAndNext && (
                                <ChevronRight className="w-3.5 h-3.5 opacity-70" />
                              )}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Right: Document Preview */}
              <div className="lg:col-span-2 card p-4 flex flex-col">
                <h3 className="text-sm font-medium text-surface-400 mb-3 flex items-center gap-2">
                  <FileText className="w-4 h-4" /> Dokument-Vorschau
                </h3>
                <div className="rounded-lg overflow-hidden bg-surface-900 border border-surface-700/50 flex-1 min-h-[600px]">
                  <object
                    data={`${api.getClassifierDocumentPreviewUrl(parseInt(documentId))}#toolbar=0&navpanes=0&view=FitH`}
                    type="application/pdf"
                    title={`Vorschau Dokument ${documentId}`}
                    className="w-full h-full min-h-[600px] border-0"
                    style={{ background: '#fff' }}
                  >
                    <div className="flex flex-col items-center justify-center h-full gap-3 p-8">
                      <p className="text-surface-400 text-sm">PDF-Vorschau nicht verfügbar.</p>
                      <a
                        href={api.getClassifierDocumentPreviewUrl(parseInt(documentId))}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-4 py-2 bg-primary-600 hover:bg-primary-500 text-white rounded-lg text-sm transition-colors"
                      >
                        PDF in neuem Tab öffnen
                      </a>
                    </div>
                  </object>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Benchmark Tab */}
      {activeTab === 'benchmark' && (
        <div className="space-y-6">
          <div className="card p-6">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold text-surface-100">Provider-Benchmark</h2>
              <span className="text-xs text-surface-500">{benchSlots.length} Modelle</span>
            </div>
            <p className="text-sm text-surface-400 mb-4">
              Waehle 2-6 Provider/Modelle und vergleiche die Klassifizierung Side-by-Side.
            </p>

            {/* Slot Selection */}
            <div className="space-y-2 mb-4">
              {benchSlots.map((slot, idx) => {
                const colors = ['violet', 'emerald', 'sky', 'amber', 'rose', 'teal']
                const c = colors[idx % colors.length]
                return (
                  <div key={idx} className={`flex items-center gap-2 p-2 rounded-lg border bg-${c}-500/5 border-${c}-500/20`}
                    style={{ background: `color-mix(in srgb, var(--color-${c}-500) 5%, transparent)`, borderColor: `color-mix(in srgb, var(--color-${c}-500) 20%, transparent)` }}
                  >
                    <span className="text-xs font-bold text-surface-400 w-5 shrink-0">{idx + 1}</span>
                    <select
                      value={slot.provider}
                      onChange={(e) => updateBenchSlot(idx, 'provider', e.target.value)}
                      className="input text-sm py-1.5 w-36 shrink-0"
                    >
                      <option value="openai">OpenAI</option>
                      <option value="mistral">Mistral</option>
                      <option value="openrouter">OpenRouter</option>
                      <option value="anthropic">Anthropic</option>
                      <option value="ollama">Ollama</option>
                    </select>
                    {slot.provider === 'openai' ? (
                      <select value={slot.model} onChange={(e) => updateBenchSlot(idx, 'model', e.target.value)} className="input text-sm py-1.5 flex-1">
                        <option value="">Standard</option>
                        <option value="gpt-4o-mini">gpt-4o-mini</option>
                        <option value="gpt-4o">gpt-4o</option>
                      </select>
                    ) : slot.provider === 'mistral' ? (
                        <select value={slot.model} onChange={(e) => updateBenchSlot(idx, 'model', e.target.value)} className="input text-sm py-1.5 flex-1">
                        <option value="">Standard</option>
                        <option value="mistral-small-latest">mistral-small</option>
                        <option value="mistral-medium-latest">mistral-medium</option>
                        <option value="mistral-large-latest">mistral-large</option>
                        <option value="open-mistral-nemo">open-mistral-nemo</option>
                        <option value="ministral-8b-latest">ministral-8b</option>
                        <option value="codestral-latest">codestral</option>
                      </select>
                    ) : slot.provider === 'openrouter' || slot.provider === 'anthropic' ? (
                      <input
                        type="text"
                        value={slot.model}
                        onChange={(e) => updateBenchSlot(idx, 'model', e.target.value)}
                        className="input text-sm py-1.5 flex-1"
                        placeholder="Modellname eingeben"
                      />
                    ) : (
                      <select value={slot.model} onChange={(e) => updateBenchSlot(idx, 'model', e.target.value)} className="input text-sm py-1.5 flex-1">
                        {ollamaLoading ? (
                          <option value="">Lade Modelle...</option>
                        ) : ollamaModels?.installed && ollamaModels.installed.length > 0 ? (
                          <>
                            <option value="">Standard</option>
                            {ollamaModels.installed
                              .sort((a: any, b: any) => {
                                if (a.is_thinking && !b.is_thinking) return 1
                                if (!a.is_thinking && b.is_thinking) return -1
                                return a.name.localeCompare(b.name)
                              })
                              .map((m: any) => (
                              <option key={m.name} value={m.name}>
                                {m.is_thinking ? '\u26A0 ' : ''}{m.name} ({m.size_gb}GB)
                              </option>
                            ))}
                          </>
                        ) : (
                          <option value="">Keine Modelle -- Ollama pruefen</option>
                        )}
                      </select>
                    )}
                    {benchSlots.length > 2 && (
                      <button onClick={() => removeBenchSlot(idx)} className="p-1 text-surface-500 hover:text-red-400 transition-colors" title="Entfernen">
                        <Minus className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                )
              })}
              {benchSlots.length < 6 && (
                <button
                  onClick={addBenchSlot}
                  className="flex items-center gap-2 text-sm text-surface-400 hover:text-primary-400 transition-colors p-2 w-full rounded-lg border border-dashed border-surface-700/50 hover:border-primary-500/30"
                >
                  <Plus className="w-4 h-4" /> Modell hinzufuegen
                </button>
              )}
            </div>

            {/* Document + Start */}
            <div className="flex gap-3">
              <input
                type="number"
                value={benchmarkDocId}
                onChange={(e) => setBenchmarkDocId(e.target.value)}
                placeholder="Dokument-ID eingeben..."
                className="input flex-1"
                min={1}
                onKeyDown={(e) => e.key === 'Enter' && handleBenchmark()}
              />
              <button
                onClick={handleBenchmark}
                disabled={benchmarkRunning || !benchmarkDocId || benchSlots.length < 2}
                className="btn btn-primary flex items-center gap-2"
              >
                {benchmarkRunning ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Scale className="w-4 h-4" />
                )}
                {benchmarkRunning ? 'Laeuft...' : `${benchSlots.length} Modelle vergleichen`}
              </button>
            </div>
            {benchmarkRunning && (
              <p className="text-xs text-amber-400 mt-2 flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                {benchSlots.length} Provider laufen nacheinander -- das kann je nach Anzahl etwas dauern.
              </p>
            )}
            {!ollamaModels?.connected && (
              <p className="text-xs text-surface-500 mt-2">
                Tipp: Lade Ollama-Modelle unter Einstellungen, damit du sie hier auswaehlen kannst.
              </p>
            )}
          </div>

          {benchmarkResult && benchmarkResult.results && (
            <>
              {benchmarkResult.document_title && (
                <p className="text-sm text-surface-400">
                  Dokument: <strong className="text-surface-200">#{benchmarkResult.document_id} -- {benchmarkResult.document_title}</strong>
                </p>
              )}

              {/* Result Columns */}
              <div className={clsx(
                'grid gap-4',
                benchmarkResult.results.length <= 2 ? 'grid-cols-1 lg:grid-cols-2' :
                benchmarkResult.results.length === 3 ? 'grid-cols-1 lg:grid-cols-3' :
                'grid-cols-1 md:grid-cols-2 xl:grid-cols-4'
              )}>
                {benchmarkResult.results.map((res, idx) => {
                  const accents: Array<'violet' | 'emerald'> = ['violet', 'emerald']
                  return (
                    <BenchmarkColumn
                      key={idx}
                      title={`${res.provider === 'openai' ? 'OpenAI' : 'Ollama'}`}
                      provider={res}
                      accent={accents[idx % 2]}
                    />
                  )
                })}
              </div>

              {/* Debug Copy Button */}
              <div className="flex justify-end">
                <button
                  onClick={() => {
                    const debugData = benchmarkResult.results.map((res, idx) => ({
                      slot: idx + 1,
                      provider: res.provider,
                      model: res.model,
                      error: res.result.error,
                      title: res.result.title,
                      tags: res.result.tags,
                      tags_new: res.result.tags_new,
                      correspondent: res.result.correspondent,
                      document_type: res.result.document_type,
                      storage_path_id: res.result.storage_path_id,
                      storage_path_name: res.result.storage_path_name,
                      storage_path_reason: res.result.storage_path_reason,
                      created_date: res.result.created_date,
                      custom_fields: res.result.custom_fields,
                      summary: res.result.summary,
                      tokens_input: res.result.tokens_input,
                      tokens_output: res.result.tokens_output,
                      cost_usd: res.result.cost_usd,
                      duration_seconds: res.result.duration_seconds,
                      tool_calls_count: res.result.tool_calls_count,
                      debug_info: res.result.debug_info || {},
                    }))
                    const text = JSON.stringify({
                      document_id: benchmarkResult.document_id,
                      document_title: benchmarkResult.document_title,
                      timestamp: new Date().toISOString(),
                      results: debugData,
                    }, null, 2)
                    navigator.clipboard.writeText(text)
                      .then(() => alert('Debug-Daten in Zwischenablage kopiert!'))
                      .catch(() => {
                        const w = window.open('', '_blank')
                        if (w) { w.document.write(`<pre>${text}</pre>`) }
                      })
                  }}
                  className="btn text-sm flex items-center gap-2 bg-surface-700 hover:bg-surface-600 text-surface-300"
                >
                  <Bug className="w-4 h-4" />
                  <Copy className="w-4 h-4" />
                  Debug Copy
                </button>
              </div>

              {/* Metrics comparison table */}
              {benchmarkResult.results.filter(r => !r.result.error).length >= 2 && (
                <div className="card p-6">
                  <h3 className="text-sm font-semibold text-surface-300 mb-3">Vergleich</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-surface-700/50">
                          <th className="text-left text-xs text-surface-500 py-2 pr-4">Metrik</th>
                          {benchmarkResult.results.map((res, idx) => (
                            <th key={idx} className="text-center text-xs text-surface-400 py-2 px-2">
                              {res.model}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          {
                            label: 'Dauer',
                            values: benchmarkResult.results.map(r => r.result.duration_seconds),
                            format: (v: number) => `${v.toFixed(1)}s`,
                            best: 'min' as const,
                          },
                          {
                            label: 'Tokens',
                            values: benchmarkResult.results.map(r => r.result.tokens_input + r.result.tokens_output),
                            format: (v: number) => v > 0 ? `${v}` : '-',
                            best: null,
                          },
                          {
                            label: 'Kosten',
                            values: benchmarkResult.results.map(r => r.result.cost_usd),
                            format: (v: number) => `$${v.toFixed(4)}`,
                            best: 'min' as const,
                          },
                          {
                            label: 'Calls',
                            values: benchmarkResult.results.map(r => r.result.tool_calls_count),
                            format: (v: number) => `${v}`,
                            best: null,
                          },
                        ].map(metric => {
                          const bestVal = metric.best === 'min'
                            ? Math.min(...metric.values.filter(v => v > 0))
                            : null
                          return (
                            <tr key={metric.label} className="border-b border-surface-700/30">
                              <td className="text-surface-400 py-2 pr-4">{metric.label}</td>
                              {metric.values.map((v, idx) => (
                                <td key={idx} className={clsx(
                                  'text-center font-mono py-2 px-2',
                                  bestVal !== null && v === bestVal && v > 0
                                    ? 'text-emerald-400 font-bold'
                                    : 'text-surface-300'
                                )}>
                                  {metric.format(v)}
                                </td>
                              ))}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Settings Tab */}
      {activeTab === 'settings' && config && (
        <div className="space-y-6">
          {/* Provider (read-only, configured in Settings) */}
          <div className="card p-6">
            <h2 className="text-lg font-semibold text-surface-100 mb-4">Provider</h2>
            <div className="flex items-center justify-between p-4 rounded-xl border-2 border-primary-500 bg-primary-500/10">
              <div>
                <p className="font-semibold text-surface-100">
                  {config.active_provider === 'openai' ? 'OpenAI' :
                   config.active_provider === 'mistral' ? 'Mistral' :
                   config.active_provider === 'openrouter' ? 'OpenRouter' :
                   config.active_provider === 'ollama' ? 'Ollama (Lokal)' :
                   config.active_provider === 'anthropic' ? 'Anthropic' :
                   config.active_provider}
                </p>
                <p className="text-sm text-surface-400 mt-1">
                  Modell: <span className="text-surface-200">{config.active_model || 'Standard'}</span>
                </p>
              </div>
              <a
                href="/settings"
                className="btn bg-surface-700 hover:bg-surface-600 text-surface-300 text-sm"
              >
                In Einstellungen aendern
              </a>
            </div>

          </div>

          {/* Fields with collapsible filter sections */}
          <div className="card p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-surface-100">Aktive Felder &amp; Filter</h2>
              <div className="flex items-center gap-2">
                {paperlessItemsLoading && <Loader2 className="w-4 h-4 animate-spin text-primary-400" />}
                <button
                  onClick={handleRefreshCache}
                  disabled={cacheRefreshing}
                  className="btn text-xs flex items-center gap-1.5 bg-surface-700 hover:bg-surface-600 text-surface-300"
                  title="Tags, Korrespondenten, Typen neu von Paperless laden"
                >
                  <RefreshCw className={clsx('w-3 h-3', cacheRefreshing && 'animate-spin')} />
                  Paperless sync
                </button>
              </div>
            </div>
            <div className="space-y-2">
              {/* Titel -- aufklappbar */}
              <FieldToggle
                icon={FileText}
                label="Titel"
                checked={config.enable_title}
                onChange={(v) => setConfig({ ...config, enable_title: v })}
                expandable
                expanded={expandedSections['title']}
                onToggleExpand={() => toggleSection('title')}
                badge={config.prompt_title ? 'Prompt' : undefined}
              />
              {expandedSections['title'] && config.enable_title && (
                <PromptSection
                  defaultPrompt={promptDefaults?.title}
                  userPrompt={config.prompt_title}
                  onUserPromptChange={(v) => setConfig({ ...config, prompt_title: v })}
                  placeholder='z.B.: "Immer Dokumentnummer mit in den Titel" oder "Produktnamen bevorzugen"'
                />
              )}

              {/* Tags -- aufklappbar */}
              <FieldToggle
                icon={Tags}
                label="Tags"
                checked={config.enable_tags}
                onChange={(v) => setConfig({ ...config, enable_tags: v })}
                expandable
                expanded={expandedSections['tags']}
                onToggleExpand={() => toggleSection('tags')}
                badge={config.excluded_tag_ids?.length ? `${config.excluded_tag_ids.length} ausgeschl.` : config.prompt_tags ? 'Prompt' : undefined}
              />
              {expandedSections['tags'] && config.enable_tags && (
                <div className="ml-8 p-3 rounded-lg bg-surface-800/30 border border-surface-700/50 space-y-3">
                  <PromptSection
                    defaultPrompt={promptDefaults?.tags}
                    userPrompt={config.prompt_tags}
                    onUserPromptChange={(v) => setConfig({ ...config, prompt_tags: v })}
                    placeholder='z.B.: "Immer den Lebensbereich taggen (KFZ, Wohnen, Gesundheit...)"'
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-sm text-surface-400">Tag-Verhalten</label>
                      <select
                        value={config.tag_behavior}
                        onChange={(e) => setConfig({ ...config, tag_behavior: e.target.value })}
                        className="input mt-1"
                      >
                        <option value="existing_only">Nur bestehende Tags -- keine neuen</option>
                        <option value="suggest_new">Bestehende bevorzugen + neue vorschlagen (Review)</option>
                        <option value="auto_create">Bestehende + neue automatisch anlegen</option>
                      </select>
                      <p className="text-xs text-surface-600 mt-1">
                        {config.tag_behavior === 'existing_only' && 'KI waehlt nur aus vorhandenen Tags in Paperless.'}
                        {config.tag_behavior === 'suggest_new' && 'KI bevorzugt vorhandene, darf aber neue vorschlagen. Du entscheidest vor dem Anwenden.'}
                        {config.tag_behavior === 'auto_create' && 'KI darf neue Tags vorschlagen die beim Anwenden automatisch erstellt werden.'}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-sm text-surface-400">Min Tags</label>
                        <input
                          type="number"
                          value={config.tags_min}
                          onChange={(e) => setConfig({ ...config, tags_min: parseInt(e.target.value) || 1 })}
                          className="input mt-1"
                          min={0}
                          max={10}
                        />
                      </div>
                      <div>
                        <label className="text-sm text-surface-400">Max Tags</label>
                        <input
                          type="number"
                          value={config.tags_max}
                          onChange={(e) => setConfig({ ...config, tags_max: parseInt(e.target.value) || 5 })}
                          className="input mt-1"
                          min={1}
                          max={20}
                        />
                      </div>
                    </div>
                  </div>
                  {/* Keep existing tags toggle */}
                  <label className="flex items-center justify-between p-2 rounded bg-surface-700/30 cursor-pointer">
                    <div>
                      <span className="text-sm text-surface-300">Bestehende Tags behalten</span>
                      <p className="text-xs text-surface-600">
                        {config.tags_keep_existing
                          ? 'Vorhandene Tags bleiben erhalten, neue werden hinzugefuegt.'
                          : 'Vorhandene Tags werden durch die KI-Vorschlaege ersetzt (geschuetzte bleiben).'
                        }
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={config.tags_keep_existing}
                      onChange={(e) => setConfig({ ...config, tags_keep_existing: e.target.checked })}
                      className="w-5 h-5 rounded accent-primary-500 shrink-0"
                    />
                  </label>

                  {/* Protected tags -- only visible when NOT keeping all existing tags */}
                  {!config.tags_keep_existing && (
                    <div className="p-2.5 rounded-lg bg-amber-500/5 border border-amber-500/20">
                      <label className="text-sm text-amber-300 font-medium">Geschuetzte Tags (bleiben beim Ersetzen erhalten)</label>
                      <div className="flex gap-2 mt-1.5">
                        <input
                          type="text"
                          placeholder="z.B. INBOX, ocr*, ai-* ..."
                          className="input flex-1 text-sm"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const val = (e.target as HTMLInputElement).value.trim()
                              if (val && !(config.tags_protected || []).includes(val)) {
                                setConfig({ ...config, tags_protected: [...(config.tags_protected || []), val] });
                                (e.target as HTMLInputElement).value = ''
                              }
                            }
                          }}
                        />
                      </div>
                      {(config.tags_protected || []).length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {(config.tags_protected || []).map(tag => (
                            <span
                              key={tag}
                              className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/20"
                            >
                              {tag}
                              <button
                                onClick={() => setConfig({ ...config, tags_protected: (config.tags_protected || []).filter(t => t !== tag) })}
                                className="hover:text-amber-200"
                              >&times;</button>
                            </span>
                          ))}
                        </div>
                      )}
                      <p className="text-xs text-surface-500 mt-1.5">
                        Diese Tags bleiben am Dokument, auch wenn die KI sie nicht vorschlaegt.
                        Wildcards: <code className="text-amber-400">ocr*</code> schuetzt ocrfehler, ocrfinish usw.
                      </p>
                    </div>
                  )}

                  {/* Ignore tags */}
                  <div>
                    <label className="text-sm text-surface-400">Ignore-Tags (nie anfassen/vorschlagen)</label>
                    <div className="flex gap-2 mt-1">
                      <input
                        type="text"
                        placeholder="Tag-Name eingeben, Enter druecken..."
                        className="input flex-1 text-sm"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const val = (e.target as HTMLInputElement).value.trim()
                            if (val && !(config.tags_ignore || []).includes(val)) {
                              setConfig({ ...config, tags_ignore: [...(config.tags_ignore || []), val] });
                              (e.target as HTMLInputElement).value = ''
                            }
                          }
                        }}
                      />
                    </div>
                    {(config.tags_ignore || []).length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {(config.tags_ignore || []).map(tag => (
                          <span
                            key={tag}
                            className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-red-500/15 text-red-400 border border-red-500/20"
                          >
                            {tag}
                            <button
                              onClick={() => setConfig({ ...config, tags_ignore: (config.tags_ignore || []).filter(t => t !== tag) })}
                              className="hover:text-red-300"
                            >&times;</button>
                          </span>
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-surface-600 mt-1">
                      Diese Tags werden nie vorgeschlagen und beim Anwenden nicht angetastet.
                      Wildcards moeglich: <code className="text-primary-400">Steuer*</code> ignoriert alle Tags die mit "Steuer" beginnen.
                    </p>
                  </div>

                  {/* Tag exclusion list */}
                  <div>
                    <p className="text-xs text-surface-500 mb-2">
                      Tags fuer KI-Vorschlaege deaktivieren:
                    </p>
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {paperlessTags.map(tag => {
                        const excluded = (config.excluded_tag_ids || []).includes(tag.id)
                        const ignored = (config.tags_ignore || []).some(t => t.toLowerCase() === tag.name.toLowerCase())
                        return (
                          <label
                            key={tag.id}
                            className={clsx(
                              'flex items-center gap-2 p-1.5 rounded text-sm cursor-pointer transition-colors',
                              excluded || ignored ? 'opacity-50' : 'hover:bg-surface-700/30'
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={!excluded}
                              disabled={ignored}
                              onChange={() => toggleExclusion('excluded_tag_ids', tag.id)}
                              className="w-4 h-4 rounded accent-primary-500"
                            />
                            <span className={clsx(
                              excluded ? 'text-surface-500 line-through' : 'text-surface-300',
                              ignored && 'text-red-400/60'
                            )}>
                              {tag.name}
                              {ignored && <span className="text-red-400/60 text-xs ml-1">(ignoriert)</span>}
                            </span>
                          </label>
                        )
                      })}
                      {paperlessTags.length === 0 && (
                        <p className="text-xs text-surface-600">Keine Tags geladen</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Korrespondent -- aufklappbar */}
              <FieldToggle
                icon={Users}
                label="Korrespondent"
                checked={config.enable_correspondent}
                onChange={(v) => setConfig({ ...config, enable_correspondent: v })}
                expandable
                expanded={expandedSections['correspondents']}
                onToggleExpand={() => toggleSection('correspondents')}
                badge={config.excluded_correspondent_ids?.length ? `${config.excluded_correspondent_ids.length} ausgeschl.` : config.prompt_correspondent ? 'Prompt' : undefined}
              />
              {expandedSections['correspondents'] && config.enable_correspondent && (
                <div className="ml-8 p-3 rounded-lg bg-surface-800/30 border border-surface-700/50 space-y-3">
                  <PromptSection
                    defaultPrompt={promptDefaults?.correspondent}
                    userPrompt={config.prompt_correspondent}
                    onUserPromptChange={(v) => setConfig({ ...config, prompt_correspondent: v })}
                    placeholder='z.B.: "Offizielle Firmennamen verwenden, keine Abkuerzungen"'
                  />
                  <div>
                    <label className="text-sm text-surface-400">Korrespondent-Verhalten</label>
                    <select
                      value={config.correspondent_behavior}
                      onChange={(e) => setConfig({ ...config, correspondent_behavior: e.target.value })}
                      className="input mt-1"
                    >
                      <option value="existing_only">Nur bestehende -- keine neuen anlegen</option>
                      <option value="suggest_new">Bestehende bevorzugen + neue vorschlagen &amp; anlegen</option>
                    </select>
                    <p className="text-xs text-surface-600 mt-1">
                      {config.correspondent_behavior === 'existing_only'
                        ? 'KI matcht nur vorhandene Korrespondenten. Unbekannte werden uebersprungen.'
                        : 'KI bevorzugt vorhandene, darf aber neue erkennen. Neue werden mit "Neu"-Badge angezeigt und beim Anwenden erstellt.'
                      }
                    </p>
                  </div>

                  {/* ── Namens-Trimming ── */}
                  <div className="pt-2 border-t border-surface-700/40 space-y-3">
                    <p className="text-sm font-medium text-surface-300">Namens-Trimming</p>

                    <label className="flex items-start gap-3 cursor-pointer group">
                      <div className="relative mt-0.5 shrink-0">
                        <input
                          type="checkbox"
                          checked={config.correspondent_trim_prompt ?? false}
                          onChange={(e) => setConfig({ ...config, correspondent_trim_prompt: e.target.checked })}
                          className="sr-only peer"
                        />
                        <div className="w-9 h-5 bg-surface-700 peer-checked:bg-primary-600 rounded-full transition-colors" />
                        <div className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-4" />
                      </div>
                      <div>
                        <span className="text-sm text-surface-200 group-hover:text-white transition-colors">
                          KI-Prompt: Kurznamen bevorzugen
                        </span>
                        <p className="text-xs text-surface-500 mt-0.5">
                          Ändert den Prompt so, dass die KI nur den Kernmarkennamen zurückgibt –
                          z.B. <span className="text-primary-400 font-mono">"Telekom"</span> statt{' '}
                          <span className="text-surface-400 font-mono">"Deutsche Telekom AG"</span>,{' '}
                          <span className="text-primary-400 font-mono">"IKEA"</span> statt{' '}
                          <span className="text-surface-400 font-mono">"IKEA Deutschland GmbH & Co. KG"</span>
                        </p>
                      </div>
                    </label>

                    <label className="flex items-start gap-3 cursor-pointer group">
                      <div className="relative mt-0.5 shrink-0">
                        <input
                          type="checkbox"
                          checked={config.correspondent_strip_legal ?? false}
                          onChange={(e) => setConfig({ ...config, correspondent_strip_legal: e.target.checked })}
                          className="sr-only peer"
                        />
                        <div className="w-9 h-5 bg-surface-700 peer-checked:bg-emerald-600 rounded-full transition-colors" />
                        <div className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-4" />
                      </div>
                      <div>
                        <span className="text-sm text-surface-200 group-hover:text-white transition-colors">
                          Post-Processing: Rechtsformen entfernen
                        </span>
                        <p className="text-xs text-surface-500 mt-0.5">
                          Schneidet nach der KI-Antwort Rechtsform-Zusätze automatisch ab –
                          GmbH, AG, KG, GmbH & Co. KG, Ltd., eV, UG, SE usw.
                          Funktioniert unabhängig vom KI-Prompt.
                        </p>
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {['GmbH', 'AG', 'KG', 'GmbH & Co. KG', 'Ltd.', 'eV', 'UG', 'SE', 'OHG', 'GbR'].map(f => (
                            <span key={f} className="text-[10px] px-1.5 py-0.5 rounded bg-surface-700/60 text-surface-400 font-mono">{f}</span>
                          ))}
                        </div>
                      </div>
                    </label>
                  </div>

                  {/* ── Korrespondenten-Ignorliste ── */}
                  <div className="pt-2 border-t border-surface-700/40">
                    <p className="text-sm font-medium text-surface-300 mb-1">Ignorliste</p>
                    <p className="text-xs text-surface-500 mb-2">
                      Namen, die NIE als Korrespondent vorgeschlagen werden (z.B. Personennamen aus Speicherpfaden).
                    </p>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {(config.correspondent_ignore || []).map((name: string) => (
                        <span
                          key={name}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/15 text-red-300 text-xs border border-red-500/30"
                        >
                          {name}
                          <button
                            onClick={() => setConfig({
                              ...config,
                              correspondent_ignore: (config.correspondent_ignore || []).filter((n: string) => n !== name),
                            })}
                            className="hover:text-red-100 transition-colors"
                          >×</button>
                        </span>
                      ))}
                      {(config.correspondent_ignore || []).length === 0 && (
                        <span className="text-xs text-surface-600 italic">Keine Einträge</span>
                      )}
                    </div>
                    <form
                      className="flex gap-2"
                      onSubmit={(e) => {
                        e.preventDefault()
                        const input = (e.target as HTMLFormElement).elements.namedItem('corrIgnoreInput') as HTMLInputElement
                        const val = input.value.trim()
                        if (val && !(config.correspondent_ignore || []).includes(val)) {
                          setConfig({
                            ...config,
                            correspondent_ignore: [...(config.correspondent_ignore || []), val],
                          })
                          input.value = ''
                        }
                      }}
                    >
                      <input
                        name="corrIgnoreInput"
                        type="text"
                        placeholder="Name eingeben..."
                        className="input text-sm flex-1"
                      />
                      <button type="submit" className="btn btn-sm bg-surface-700 hover:bg-surface-600 text-surface-300 text-xs px-3">
                        Hinzufügen
                      </button>
                    </form>
                  </div>

                  <div>
                    <p className="text-xs text-surface-500 mb-2">
                      Deaktiviere Korrespondenten, die die KI nicht vorschlagen soll:
                    </p>
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {paperlessCorrespondents.map(c => {
                        const excluded = (config.excluded_correspondent_ids || []).includes(c.id)
                        return (
                          <label
                            key={c.id}
                            className={clsx(
                              'flex items-center gap-2 p-1.5 rounded text-sm cursor-pointer transition-colors',
                              excluded ? 'opacity-50' : 'hover:bg-surface-700/30'
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={!excluded}
                              onChange={() => toggleExclusion('excluded_correspondent_ids', c.id)}
                              className="w-4 h-4 rounded accent-primary-500"
                            />
                            <span className={excluded ? 'text-surface-500 line-through' : 'text-surface-300'}>{c.name}</span>
                          </label>
                        )
                      })}
                      {paperlessCorrespondents.length === 0 && (
                        <p className="text-xs text-surface-600">Keine Korrespondenten geladen</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Dokumenttyp -- aufklappbar */}
              <FieldToggle
                icon={FileText}
                label="Dokumenttyp"
                checked={config.enable_document_type}
                onChange={(v) => setConfig({ ...config, enable_document_type: v })}
                expandable
                expanded={expandedSections['docTypes']}
                onToggleExpand={() => toggleSection('docTypes')}
                badge={config.excluded_document_type_ids?.length ? `${config.excluded_document_type_ids.length} ausgeschlossen` : config.prompt_document_type ? 'Prompt' : undefined}
              />
              {expandedSections['docTypes'] && config.enable_document_type && (
                <div className="ml-8 p-3 rounded-lg bg-surface-800/30 border border-surface-700/50 space-y-3">
                  <PromptSection
                    defaultPrompt={promptDefaults?.document_type}
                    userPrompt={config.prompt_document_type}
                    onUserPromptChange={(v) => setConfig({ ...config, prompt_document_type: v })}
                    placeholder='z.B.: "Im Zweifel lieber null statt falschen Typ"'
                  />
                  <p className="text-xs text-surface-500">
                    Deaktiviere Dokumenttypen, die die KI nicht vorschlagen soll:
                  </p>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {paperlessDocTypes.map(dt => {
                      const excluded = (config.excluded_document_type_ids || []).includes(dt.id)
                      return (
                        <label
                          key={dt.id}
                          className={clsx(
                            'flex items-center gap-2 p-1.5 rounded text-sm cursor-pointer transition-colors',
                            excluded ? 'opacity-50' : 'hover:bg-surface-700/30'
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={!excluded}
                            onChange={() => toggleExclusion('excluded_document_type_ids', dt.id)}
                            className="w-4 h-4 rounded accent-primary-500"
                          />
                          <span className={excluded ? 'text-surface-500 line-through' : 'text-surface-300'}>{dt.name}</span>
                        </label>
                      )
                    })}
                    {paperlessDocTypes.length === 0 && (
                      <p className="text-xs text-surface-600">Keine Dokumenttypen geladen</p>
                    )}
                  </div>
                </div>
              )}

              {/* Speicherpfad -- aufklappbar mit Profil-Editor */}
              <FieldToggle
                icon={FolderOpen}
                label="Speicherpfad"
                checked={config.enable_storage_path}
                onChange={(v) => setConfig({ ...config, enable_storage_path: v })}
                expandable
                expanded={expandedSections['storagePaths']}
                onToggleExpand={() => toggleSection('storagePaths')}
                badge={storagePathProfiles.length > 0 ? `${storagePathProfiles.filter(p => p.enabled !== false).length}/${storagePathProfiles.length} aktiv` : undefined}
              />
              {expandedSections['storagePaths'] && config.enable_storage_path && (
                <div className="ml-8 p-3 rounded-lg bg-surface-800/30 border border-surface-700/50 space-y-3">
                  <div className="flex items-start gap-2 p-2 bg-primary-500/10 border border-primary-500/20 rounded text-xs text-primary-300">
                    <Info className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      Konfiguriere hier die Speicherpfade als Personen-Profile.
                      Der Kontext-Prompt hilft der KI zu verstehen, welche Dokumente zu welchem Pfad gehoeren.
                    </span>
                  </div>

                  {/* Speicherpfad-Verhalten */}
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-surface-300">Zuweisung bei vorhandenem Pfad</p>
                    <div className="space-y-1.5">
                      {[
                        { value: 'always', label: 'Immer zuweisen', desc: 'KI-Vorschlag ersetzt immer den vorhandenen Pfad' },
                        { value: 'keep_if_set', label: 'Vorhandenen behalten', desc: 'Pfad wird nie geaendert, nur bei leeren Dokumenten gesetzt' },
                        { value: 'keep_except_list', label: 'Behalten — außer bei diesen Pfaden', desc: 'Vorhandener Pfad bleibt, außer er steht in der Liste unten (z.\u202fB. Platzhalter)' },
                      ].map((opt) => (
                        <label key={opt.value} className="flex items-start gap-2.5 p-2 rounded-lg border border-surface-700/50 hover:border-surface-600/50 cursor-pointer bg-surface-800/30">
                          <input
                            type="radio"
                            name="storage_path_behavior"
                            value={opt.value}
                            checked={(config.storage_path_behavior || 'always') === opt.value}
                            onChange={() => setConfig({ ...config, storage_path_behavior: opt.value })}
                            className="mt-0.5 accent-primary-500"
                          />
                          <div>
                            <p className="text-xs text-surface-200 font-medium">{opt.label}</p>
                            <p className="text-xs text-surface-500">{opt.desc}</p>
                          </div>
                        </label>
                      ))}
                    </div>

                    {(config.storage_path_behavior || 'always') === 'keep_except_list' && (
                      <div className="mt-2 space-y-2">
                        <p className="text-xs text-surface-400">
                          Pfad-Namen, die überschrieben werden sollen (z.\u202fB. Platzhalter wie "Zuweisen"):
                        </p>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            placeholder='z.B. "Zuweisen" — Enter zum Hinzufügen'
                            className="input flex-1 text-sm"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                const val = (e.target as HTMLInputElement).value.trim()
                                if (val && !(config.storage_path_override_names || []).includes(val)) {
                                  setConfig({ ...config, storage_path_override_names: [...(config.storage_path_override_names || []), val] })
                                }
                                ;(e.target as HTMLInputElement).value = ''
                              }
                            }}
                          />
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {(config.storage_path_override_names || []).map((name) => (
                            <span key={name} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-amber-500/20 text-amber-300 border border-amber-500/30">
                              {name}
                              <button
                                onClick={() => setConfig({ ...config, storage_path_override_names: (config.storage_path_override_names || []).filter(n => n !== name) })}
                                className="hover:text-amber-100 ml-0.5"
                              >×</button>
                            </span>
                          ))}
                          {(config.storage_path_override_names || []).length === 0 && (
                            <span className="text-xs text-surface-500 italic">Keine Pfade konfiguriert</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="space-y-3">
                    {storagePathProfiles.map((profile) => {
                      const enabled = profile.enabled ?? true
                      return (
                        <div
                          key={profile.paperless_path_id}
                          className={clsx(
                            'border rounded-lg transition-all',
                            enabled ? 'border-primary-500/30 bg-surface-800/50' : 'border-surface-700/30 opacity-60'
                          )}
                        >
                          <div className="flex items-center justify-between p-3">
                            <div className="flex items-center gap-3">
                              <input
                                type="checkbox"
                                checked={enabled}
                                onChange={(e) => updateStorageProfile(profile.paperless_path_id, 'enabled', e.target.checked)}
                                className="w-4 h-4 rounded accent-primary-500"
                              />
                              <div>
                                <p className="text-sm text-surface-200 font-medium">{profile.paperless_path_name}</p>
                                <p className="text-xs text-surface-500">{profile.paperless_path_path}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {profile.context_prompt && (
                                <span className="text-xs text-primary-400 flex items-center gap-1">
                                  <MessageSquare className="w-3 h-3" /> Prompt
                                </span>
                              )}
                              <button
                                onClick={() => toggleSection(`sp-${profile.paperless_path_id}`)}
                                className="text-surface-400 hover:text-surface-200 p-1"
                              >
                                {expandedSections[`sp-${profile.paperless_path_id}`] ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                              </button>
                            </div>
                          </div>
                          {expandedSections[`sp-${profile.paperless_path_id}`] && (
                            <div className="px-3 pb-3 space-y-2 border-t border-surface-700/30 pt-2">
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="text-xs text-surface-500">Person (optional)</label>
                                  <input
                                    type="text"
                                    value={profile.person_name || ''}
                                    onChange={(e) => updateStorageProfile(profile.paperless_path_id, 'person_name', e.target.value)}
                                    className="input mt-0.5 text-sm"
                                    placeholder="z.B. Christian Wilms"
                                  />
                                </div>
                                <div>
                                  <label className="text-xs text-surface-500">Typ</label>
                                  <select
                                    value={profile.path_type || 'private'}
                                    onChange={(e) => updateStorageProfile(profile.paperless_path_id, 'path_type', e.target.value)}
                                    className="input mt-0.5 text-sm"
                                  >
                                    <option value="private">Privat</option>
                                    <option value="business">Geschaeftlich</option>
                                    <option value="mixed">Gemischt</option>
                                  </select>
                                </div>
                              </div>
                              <div>
                                <label className="text-xs text-surface-500 flex items-center gap-1">
                                  <MessageSquare className="w-3 h-3" /> Kontext-Prompt (optional -- verbessert die Erkennung)
                                </label>
                                <textarea
                                  value={profile.context_prompt || ''}
                                  onChange={(e) => updateStorageProfile(profile.paperless_path_id, 'context_prompt', e.target.value)}
                                  className="input mt-0.5 text-sm"
                                  rows={3}
                                  placeholder="Erklaere der KI, welche Dokumente hierhin gehoeren...&#10;z.B.: Private Dokumente von [Name]. Rechnungen, Versicherungen, persoenliche Korrespondenz. NICHT geschaeftlich."
                                />
                                <p className="text-xs text-surface-600 mt-1">Ohne Prompt nutzt die KI nur den Pfadnamen zur Zuordnung.</p>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                    {storagePathProfiles.length === 0 && (
                      <p className="text-xs text-surface-600">Keine Speicherpfade in Paperless gefunden</p>
                    )}
                  </div>
                  {storagePathProfiles.length > 0 && (
                    <div className="flex justify-end pt-2">
                      <button
                        onClick={handleSaveProfiles}
                        disabled={settingsSaving}
                        className="btn text-sm flex items-center gap-2 bg-surface-700 hover:bg-surface-600 text-surface-200"
                      >
                        {settingsSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                        Profile speichern
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Erstelldatum -- aufklappbar */}
              <FieldToggle
                icon={Calendar}
                label="Erstelldatum"
                checked={config.enable_created_date}
                onChange={(v) => setConfig({ ...config, enable_created_date: v })}
                expandable
                expanded={expandedSections['date']}
                onToggleExpand={() => toggleSection('date')}
                badge={config.prompt_date ? 'Prompt' : undefined}
              />
              {expandedSections['date'] && config.enable_created_date && (
                <div className="ml-8 space-y-4">
                  <PromptSection
                    defaultPrompt={promptDefaults?.date}
                    userPrompt={config.prompt_date}
                    onUserPromptChange={(v) => setConfig({ ...config, prompt_date: v })}
                    placeholder='z.B.: "Bei Kontoauszuegen das Auszugsdatum nehmen, nicht den Zeitraum"'
                  />
                  {/* Datum-Ignorieren-Liste */}
                  <div className="p-3 rounded-lg bg-surface-800/30 border border-surface-700/50 space-y-2">
                    <label className="text-sm text-surface-300 font-medium flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-amber-400" />
                      Bekannte Daten ignorieren
                    </label>
                    <p className="text-xs text-surface-500">
                      Daten die nie als Erstelldatum vorgeschlagen werden sollen (z.B. Geburtsdaten).
                      Format: TT.MM.JJJJ oder JJJJ-MM-TT.
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="z.B. 17.06.1987 oder 1987-06-17, Enter druecken..."
                        className="input flex-1 text-sm"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const val = (e.target as HTMLInputElement).value.trim()
                            if (val && !(config.dates_ignore || []).includes(val)) {
                              setConfig({ ...config, dates_ignore: [...(config.dates_ignore || []), val] })
                              ;(e.target as HTMLInputElement).value = ''
                            }
                          }
                        }}
                      />
                    </div>
                    {(config.dates_ignore || []).length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {(config.dates_ignore || []).map(d => (
                          <span
                            key={d}
                            className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/20"
                          >
                            {d}
                            <button
                              onClick={() => setConfig({ ...config, dates_ignore: (config.dates_ignore || []).filter(x => x !== d) })}
                              className="hover:text-amber-100 ml-0.5"
                            >&times;</button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Custom Fields -- aufklappbar */}
              <FieldToggle
                icon={Hash}
                label="Custom Fields"
                checked={config.enable_custom_fields}
                onChange={(v) => setConfig({ ...config, enable_custom_fields: v })}
                expandable
                expanded={expandedSections['customFields']}
                onToggleExpand={() => toggleSection('customFields')}
                badge={customFieldMappings.filter(m => m.enabled).length > 0 ? `${customFieldMappings.filter(m => m.enabled).length} aktiv` : undefined}
              />
              {expandedSections['customFields'] && config.enable_custom_fields && (
                <div className="ml-8 p-3 rounded-lg bg-surface-800/30 border border-surface-700/50 space-y-3">
                  <div className="flex items-start gap-2 p-2 bg-primary-500/10 border border-primary-500/20 rounded text-xs text-primary-300">
                    <Info className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      Aktiviere die Felder, die die KI aus Dokumenten extrahieren soll.
                      Der Extraktions-Prompt erklaert der KI, was und wie sie suchen soll.
                    </span>
                  </div>

                  {customFieldMappings.length === 0 && (
                    <p className="text-xs text-surface-600">
                      Keine Custom Fields in Paperless gefunden. Erstelle zuerst Felder in Paperless-ngx.
                    </p>
                  )}

                  <div className="space-y-3">
                    {customFieldMappings.map((mapping) => (
                      <div
                        key={mapping.paperless_field_id}
                        className={clsx(
                          'border rounded-lg transition-all',
                          mapping.enabled ? 'border-primary-500/30 bg-surface-800/50' : 'border-surface-700/30 opacity-60'
                        )}
                      >
                        <div className="flex items-center justify-between p-3">
                          <div className="flex items-center gap-3">
                            <input
                              type="checkbox"
                              checked={mapping.enabled}
                              onChange={(e) => updateCustomFieldMapping(mapping.paperless_field_id, 'enabled', e.target.checked)}
                              className="w-4 h-4 rounded accent-primary-500"
                            />
                            <div>
                              <p className="text-sm text-surface-200 font-medium">{mapping.paperless_field_name}</p>
                              <p className="text-xs text-surface-500">
                                Typ: {mapping.paperless_field_type}
                                {mapping.validation_regex && <span className="ml-2 text-primary-400">Validierung aktiv</span>}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {mapping.extraction_prompt && (
                              <span className="text-xs text-primary-400 flex items-center gap-1">
                                <MessageSquare className="w-3 h-3" /> Prompt
                              </span>
                            )}
                            <button
                              onClick={() => toggleSection(`cf-${mapping.paperless_field_id}`)}
                              className="text-surface-400 hover:text-surface-200 p-1"
                            >
                              {expandedSections[`cf-${mapping.paperless_field_id}`] ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            </button>
                          </div>
                        </div>

                        {expandedSections[`cf-${mapping.paperless_field_id}`] && (
                          <div className="px-3 pb-3 space-y-2 border-t border-surface-700/30 pt-2">
                            <div>
                              <label className="text-xs text-surface-500 flex items-center gap-1">
                                <MessageSquare className="w-3 h-3" /> Extraktions-Prompt
                              </label>
                              <textarea
                                value={mapping.extraction_prompt}
                                onChange={(e) => updateCustomFieldMapping(mapping.paperless_field_id, 'extraction_prompt', e.target.value)}
                                className="input mt-0.5 text-sm"
                                rows={2}
                                placeholder="Beschreibe, wie die KI dieses Feld extrahieren soll..."
                              />
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="text-xs text-surface-500">Beispielwerte</label>
                                <input
                                  type="text"
                                  value={mapping.example_values}
                                  onChange={(e) => updateCustomFieldMapping(mapping.paperless_field_id, 'example_values', e.target.value)}
                                  className="input mt-0.5 text-sm"
                                  placeholder="z.B. RE-2024-001, INV-123"
                                />
                                <p className="text-xs text-surface-600 mt-0.5">Kommagetrennte Beispiele</p>
                              </div>
                              <div>
                                <label className="text-xs text-surface-500">Validierung (Regex)</label>
                                <input
                                  type="text"
                                  value={mapping.validation_regex}
                                  onChange={(e) => updateCustomFieldMapping(mapping.paperless_field_id, 'validation_regex', e.target.value)}
                                  className="input mt-0.5 text-sm font-mono"
                                  placeholder="z.B. ^RE-\d{4}-\d+$"
                                />
                                <p className="text-xs text-surface-600 mt-0.5">Leerlassen = keine Pruefung</p>
                              </div>
                            </div>
                            <div>
                              <label className="text-xs text-surface-500 flex items-center gap-1">
                                <XCircle className="w-3 h-3" /> Eigene Werte ignorieren
                              </label>
                              <input
                                type="text"
                                value={mapping.ignore_values}
                                onChange={(e) => updateCustomFieldMapping(mapping.paperless_field_id, 'ignore_values', e.target.value)}
                                className="input mt-0.5 text-sm"
                                placeholder="z.B. DE89370400440532013000, DE12345678901234567890"
                              />
                              <p className="text-xs text-surface-600 mt-0.5">
                                Kommagetrennt. Diese Werte gehoeren dir und werden bei der Extraktion ignoriert (z.B. eigene IBAN).
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {customFieldMappings.length > 0 && (
                    <div className="flex justify-end pt-2">
                      <button
                        onClick={handleSaveCustomFieldMappings}
                        disabled={customFieldsSaving}
                        className="btn text-sm flex items-center gap-2 bg-surface-700 hover:bg-surface-600 text-surface-200"
                      >
                        {customFieldsSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                        Felder speichern
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Review Mode */}
          <div className="card p-6">
            <h2 className="text-lg font-semibold text-surface-100 mb-4">Review-Modus</h2>
            <select
              value={config.review_mode}
              onChange={(e) => setConfig({ ...config, review_mode: e.target.value })}
              className="input"
            >
              <option value="always">Immer Review vor Anwendung</option>
              <option value="uncertain_only">Nur bei unsicheren Ergebnissen</option>
              <option value="auto_apply">Automatisch anwenden</option>
            </select>
          </div>

          {/* Classification / Status Tags */}
          <div className="card p-6">
            <h2 className="text-lg font-semibold text-surface-100 mb-1">Status-Tags</h2>
            <p className="text-xs text-surface-500 mb-4">
              Optionale Tags, die automatisch in Paperless-ngx gesetzt werden (werden angelegt falls nicht vorhanden).
            </p>
            <div className="space-y-4">
              {/* Klassifiziert */}
              <div className="flex items-center gap-4 p-3 rounded-lg bg-surface-800/50">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-medium text-surface-200">Klassifiziert</span>
                    <span className="text-xs text-surface-500">– wird gesetzt wenn Klassifizierung angewendet wird</span>
                  </div>
                  {config.classification_tag_enabled && (
                    <input
                      type="text"
                      value={config.classification_tag_name ?? 'KI-klassifiziert'}
                      onChange={e => setConfig({ ...config, classification_tag_name: e.target.value })}
                      placeholder="KI-klassifiziert"
                      className="input text-sm w-56 mt-1"
                    />
                  )}
                </div>
                <div
                  onClick={() => setConfig({ ...config, classification_tag_enabled: !config.classification_tag_enabled })}
                  className={clsx(
                    'relative w-10 h-5 rounded-full transition-colors cursor-pointer shrink-0',
                    config.classification_tag_enabled ? 'bg-primary-500' : 'bg-surface-600'
                  )}
                >
                  <div className={clsx(
                    'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
                    config.classification_tag_enabled ? 'translate-x-5' : 'translate-x-0.5'
                  )} />
                </div>
              </div>

              {/* Prüfen */}
              <div className="flex items-center gap-4 p-3 rounded-lg bg-surface-800/50">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-medium text-surface-200">Prüfen</span>
                    <span className="text-xs text-surface-500">– wird gesetzt wenn Dokument in die Prüf-Warteschlange kommt</span>
                  </div>
                  {config.review_tag_enabled && (
                    <input
                      type="text"
                      value={config.review_tag_name ?? 'KI-prüfen'}
                      onChange={e => setConfig({ ...config, review_tag_name: e.target.value })}
                      placeholder="KI-prüfen"
                      className="input text-sm w-56 mt-1"
                    />
                  )}
                </div>
                <div
                  onClick={() => setConfig({ ...config, review_tag_enabled: !config.review_tag_enabled })}
                  className={clsx(
                    'relative w-10 h-5 rounded-full transition-colors cursor-pointer shrink-0',
                    config.review_tag_enabled ? 'bg-primary-500' : 'bg-surface-600'
                  )}
                >
                  <div className={clsx(
                    'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
                    config.review_tag_enabled ? 'translate-x-5' : 'translate-x-0.5'
                  )} />
                </div>
              </div>

              {/* Tag-Ideen */}
              <div className="flex items-center gap-4 p-3 rounded-lg bg-surface-800/50">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-medium text-surface-200">Tag-Ideen</span>
                    <span className="text-xs text-surface-500">– wird gesetzt wenn die KI neue Tag-Vorschläge hat</span>
                  </div>
                  {config.tag_ideas_tag_enabled && (
                    <input
                      type="text"
                      value={config.tag_ideas_tag_name ?? 'KI-tag-ideen'}
                      onChange={e => setConfig({ ...config, tag_ideas_tag_name: e.target.value })}
                      placeholder="KI-tag-ideen"
                      className="input text-sm w-56 mt-1"
                    />
                  )}
                </div>
                <div
                  onClick={() => setConfig({ ...config, tag_ideas_tag_enabled: !config.tag_ideas_tag_enabled })}
                  className={clsx(
                    'relative w-10 h-5 rounded-full transition-colors cursor-pointer shrink-0',
                    config.tag_ideas_tag_enabled ? 'bg-primary-500' : 'bg-surface-600'
                  )}
                >
                  <div className={clsx(
                    'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
                    config.tag_ideas_tag_enabled ? 'translate-x-5' : 'translate-x-0.5'
                  )} />
                </div>
              </div>
            </div>
          </div>

          {/* Save */}
          <div className="flex justify-end">
            <button
              onClick={handleSaveConfig}
              disabled={settingsSaving}
              className="btn btn-primary flex items-center gap-2"
            >
              {settingsSaving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              Einstellungen speichern
            </button>
          </div>
        </div>
      )}

      {/* Review Tab */}
      {activeTab === 'review' && (
        <div className="space-y-6">
          {/* Auto-Classify Control */}
          <div className="card p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-surface-100">Auto-Klassifizierung</h2>
                <p className="text-xs text-surface-500 mt-0.5">Klassifiziert neue Dokumente automatisch im Hintergrund</p>
              </div>
              <div className="flex items-center gap-3">
                {autoClassifyStatus?.enabled && (
                  <span className="text-xs text-surface-500">
                    {autoClassifyStatus.processed} angewendet · {autoClassifyStatus.reviewed} zur Prüfung · {autoClassifyStatus.errors} Fehler
                  </span>
                )}
                <button
                  onClick={toggleAutoClassify}
                  className={clsx(
                    'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                    autoClassifyStatus?.enabled
                      ? 'bg-red-500/20 text-red-300 hover:bg-red-500/30 border border-red-500/30'
                      : 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/30'
                  )}
                >
                  {autoClassifyStatus?.enabled ? 'Stoppen' : 'Starten'}
                </button>
              </div>
            </div>

            {autoClassifyStatus?.running && autoClassifyStatus.current_doc && (
              <div className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />
                <span className="text-sm text-amber-300">Klassifiziert Dokument #{autoClassifyStatus.current_doc}...</span>
              </div>
            )}

            {/* Settings inline */}
            {config && (
              <>
                <div className="flex items-center gap-4 mt-3 pt-3 border-t border-surface-700/40">
                  <label className="flex items-center gap-2 text-sm text-surface-300">
                    Intervall:
                    <input
                      type="number" min={1} max={60}
                      value={config.auto_classify_interval}
                      onChange={e => setConfig({ ...config, auto_classify_interval: parseInt(e.target.value) || 5 })}
                      className="input w-16 text-sm text-center"
                    /> Min
                  </label>
                  <label className="flex items-center gap-2 text-sm text-surface-300">
                    Modus:
                    <select
                      value={config.auto_classify_mode}
                      onChange={e => setConfig({ ...config, auto_classify_mode: e.target.value })}
                      className="input text-sm"
                    >
                      <option value="review">Immer prüfen</option>
                      <option value="auto_apply">Auto-Anwenden (nur unsichere prüfen)</option>
                    </select>
                  </label>
                </div>

                {/* Auto-Classify Skip Tags */}
                <div className="mt-3 pt-3 border-t border-surface-700/40">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="text-sm font-medium text-surface-200">Dokumente mit diesen Tags überspringen</p>
                      <p className="text-xs text-surface-500 mt-0.5">
                        Dokumente die einen dieser Tags haben, werden von der Auto-Klassifizierung komplett ignoriert (z.B. wenn sie von einem n8n-Workflow bereits klassifiziert wurden).
                      </p>
                    </div>
                    {(config.auto_classify_skip_tag_ids || []).length > 0 && (
                      <span className="text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">
                        {config.auto_classify_skip_tag_ids.length} aktiv
                      </span>
                    )}
                  </div>
                  <div className="max-h-40 overflow-y-auto space-y-1 bg-surface-900/30 rounded-lg p-2 border border-surface-700/30">
                    {paperlessTags.length === 0 ? (
                      <p className="text-xs text-surface-500 text-center py-2">Keine Tags gefunden</p>
                    ) : (
                      paperlessTags.map(tag => {
                        const skip = (config.auto_classify_skip_tag_ids || []).includes(tag.id)
                        return (
                          <label
                            key={tag.id}
                            className={clsx(
                              'flex items-center gap-2 p-1.5 rounded text-sm cursor-pointer transition-colors',
                              skip ? 'bg-amber-500/10' : 'hover:bg-surface-700/30'
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={skip}
                              onChange={() => {
                                const current = config.auto_classify_skip_tag_ids || []
                                const next = skip
                                  ? current.filter(id => id !== tag.id)
                                  : [...current, tag.id]
                                setConfig({ ...config, auto_classify_skip_tag_ids: next })
                              }}
                              className="w-4 h-4 rounded accent-amber-500"
                            />
                            <span className={skip ? 'text-amber-300 font-medium' : 'text-surface-300'}>
                              {tag.name}
                            </span>
                          </label>
                        )
                      })
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Review Queue */}
          <div className="card p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-surface-100">Prüf-Warteschlange</h2>
                <p className="text-xs text-surface-500 mt-0.5">
                  {reviewQueue.length} Dokument{reviewQueue.length !== 1 ? 'e' : ''} zur manuellen Prüfung
                </p>
              </div>
              <button onClick={loadReviewQueue} className="btn btn-sm bg-surface-700 hover:bg-surface-600 text-surface-300 text-xs">
                <RefreshCw className="w-3 h-3 mr-1" /> Aktualisieren
              </button>
            </div>

            {reviewLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-primary-400" />
              </div>
            ) : reviewQueue.length === 0 ? (
              <p className="text-surface-500 text-center py-8">Keine Dokumente zur Prüfung.</p>
            ) : (
              <div className="space-y-1.5">
                {reviewQueue.map(entry => {
                  const rj = entry.result_json || {}
                  return (
                    <button
                      key={entry.id}
                      onClick={() => {
                        setDocumentId(String(entry.document_id))
                        setResult(rj as api.ClassificationResult)
                        initEditState(rj as api.ClassificationResult)
                        setApplied(false)
                        setReviewMode(true)
                        if (paperlessTags.length === 0 || paperlessDocTypes.length === 0 || paperlessCorrespondents.length === 0) {
                          loadPaperlessItems()
                        }
                        if (paperlessStoragePaths.length === 0) {
                          api.getStoragePathsFromPaperless().then(setPaperlessStoragePaths).catch(() => {})
                        }
                        setActiveTab('classify')
                        window.scrollTo({ top: 0, behavior: 'smooth' })
                      }}
                      className="w-full flex items-center justify-between p-3 rounded-lg text-left bg-amber-500/5 hover:bg-amber-500/10 border border-amber-500/20 transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-surface-200 text-sm font-medium truncate">
                            <span className="text-surface-500 mr-1">#{entry.document_id}</span>
                            {entry.document_title || 'Unbekannt'}
                          </p>
                          <p className="text-xs text-amber-400/70 mt-0.5 truncate">{entry.error_message}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-3">
                        <span className="text-xs text-surface-500">
                          {entry.created_at ? new Date(entry.created_at).toLocaleString('de-DE') : ''}
                        </span>
                        <ChevronRight className="w-3.5 h-3.5 text-surface-600" />
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tag Ideas Tab */}
      {activeTab === 'tag_ideas' && (
        <div className="space-y-6">
          {/* Stats Overview */}
          {tagIdeasStats && tagIdeasStats.unique_tags > 0 && (
            <div className="card p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-surface-100 flex items-center gap-2">
                    <Tags className="w-4 h-4 text-cyan-400" />
                    Vorgeschlagene neue Tags
                  </h2>
                  <p className="text-xs text-surface-500 mt-0.5">
                    {tagIdeasStats.unique_tags} verschiedene Tags &middot; {tagIdeasStats.total_ideas} Vorschläge &middot; {tagIdeasStats.documents_with_ideas} Dokumente
                  </p>
                </div>
                <button
                  onClick={loadTagIdeas}
                  disabled={tagIdeasLoading}
                  className="btn text-xs flex items-center gap-1.5 bg-surface-700 hover:bg-surface-600 text-surface-300"
                >
                  <RefreshCw className={clsx('w-3 h-3', tagIdeasLoading && 'animate-spin')} />
                  Aktualisieren
                </button>
              </div>
              <div className="space-y-1.5">
                {tagIdeasStats.top_tags.map((tag: any, i: number) => {
                  const maxCount = tagIdeasStats.top_tags[0]?.count || 1
                  const pct = Math.round((tag.count / maxCount) * 100)
                  return (
                    <div key={tag.name} className="flex items-center gap-3 group">
                      <span className="text-xs text-surface-600 w-5 text-right shrink-0">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-sm text-surface-200 truncate">{tag.name}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 shrink-0">
                            {tag.count}x vorgeschlagen
                          </span>
                        </div>
                        <div className="w-full bg-surface-700/40 rounded-full h-1.5">
                          <div
                            className="bg-gradient-to-r from-cyan-500 to-cyan-400 h-1.5 rounded-full transition-all duration-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button
                          onClick={async () => {
                            try {
                              await api.fetchJson('/classifier/tag-ideas/bulk-approve', {
                                method: 'POST',
                                body: JSON.stringify({ tag_name: tag.name }),
                              })
                              loadTagIdeas()
                            } catch { /* ignore */ }
                          }}
                          className="px-2 py-1 rounded text-[11px] font-medium bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/30 transition-colors whitespace-nowrap"
                        >
                          Erstellen &amp; Zuweisen
                        </button>
                        <button
                          onClick={async () => {
                            try {
                              await api.fetchJson('/classifier/tag-ideas/bulk-dismiss', {
                                method: 'POST',
                                body: JSON.stringify({ tag_name: tag.name }),
                              })
                              loadTagIdeas()
                            } catch { /* ignore */ }
                          }}
                          className="px-2 py-1 rounded text-[11px] font-medium bg-surface-700 text-surface-400 hover:bg-surface-600 hover:text-surface-300 transition-colors"
                        >
                          Verwerfen
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Document List */}
          <div className="card p-6">
            <h2 className="text-lg font-semibold text-surface-100 mb-4">Dokumente mit Tag-Ideen</h2>
            {tagIdeasLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-primary-400" />
              </div>
            ) : tagIdeas.length === 0 ? (
              <p className="text-surface-500 text-center py-8">Keine neuen Tag-Vorschläge vorhanden.</p>
            ) : (
              <div className="space-y-2">
                {tagIdeas.map(entry => (
                  <details key={entry.id} className="group bg-surface-800/50 rounded-lg border border-surface-700/50 overflow-hidden">
                    <summary className="flex items-center gap-3 p-3 cursor-pointer hover:bg-surface-700/50 transition-colors select-none list-none">
                      <ChevronRight className="w-4 h-4 text-surface-500 transition-transform group-open:rotate-90 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-surface-200 text-sm font-medium truncate">
                          <span className="text-surface-500 mr-1">#{entry.document_id}</span>
                          {entry.document_title || 'Unbekannt'}
                        </p>
                        <span className="text-surface-600 text-[11px]">
                          {entry.created_at ? new Date(entry.created_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {(entry.tag_ideas || []).map((tag: string) => (
                          <span key={tag} className="px-2 py-0.5 rounded text-[11px] font-medium bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 truncate max-w-[120px]">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </summary>
                    <div className="px-3 pb-3 pt-1 border-t border-surface-700/40 space-y-3">
                      {/* Existing classification info */}
                      {entry.result_json && (
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          {entry.result_json.correspondent && (
                            <div><span className="text-surface-500">Korrespondent:</span> <span className="text-surface-300">{entry.result_json.correspondent}</span></div>
                          )}
                          {entry.result_json.document_type && (
                            <div><span className="text-surface-500">Typ:</span> <span className="text-surface-300">{entry.result_json.document_type}</span></div>
                          )}
                          {entry.result_json.tags && entry.result_json.tags.length > 0 && (
                            <div className="col-span-2"><span className="text-surface-500">Bestehende Tags:</span> <span className="text-surface-300">{entry.result_json.tags.join(', ')}</span></div>
                          )}
                        </div>
                      )}
                      {/* Tag idea actions */}
                      <div className="space-y-1.5">
                        {(entry.tag_ideas || []).map((tag: string) => (
                          <div key={tag} className="flex items-center justify-between bg-surface-900/50 rounded-lg px-3 py-2">
                            <span className="text-sm text-cyan-300 font-medium">{tag}</span>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => approveTagIdea(entry.id, tag)}
                                className="px-3 py-1 rounded text-xs font-medium bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/30 transition-colors"
                              >
                                Erstellen &amp; Zuweisen
                              </button>
                              <button
                                onClick={() => dismissTagIdea(entry.id, tag)}
                                className="px-3 py-1 rounded text-xs font-medium bg-surface-700 text-surface-400 hover:bg-surface-600 hover:text-surface-300 transition-colors"
                              >
                                Verwerfen
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                      {(entry.tag_ideas || []).length > 1 && (
                        <button
                          onClick={() => approveAllTagIdeas(entry.id)}
                          className="w-full py-1.5 rounded text-xs font-medium bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 border border-cyan-500/20 transition-colors"
                        >
                          Alle Tags erstellen &amp; zuweisen
                        </button>
                      )}
                      {/* Bestehenden Tag zuweisen */}
                      <TagIdeaAssignExisting entryId={entry.id} paperlessTags={paperlessTags} onAssigned={loadTagIdeas} />
                    </div>
                  </details>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* History Tab */}
      {activeTab === 'history' && (
        <div className="space-y-6">
          {/* Stats Dashboard */}
          {statsLoading && !stats ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-primary-400" />
            </div>
          ) : stats && (
            <>
              {/* Key Metrics */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard
                  label="Dokumente gesamt"
                  value={stats.total_documents_paperless.toLocaleString('de-DE')}
                  sub="in Paperless"
                  color="surface"
                />
                <StatCard
                  label="Klassifiziert"
                  value={stats.unique_applied.toLocaleString('de-DE')}
                  sub={`von ${stats.total_documents_paperless} (${stats.total_documents_paperless > 0 ? Math.round(stats.unique_applied / stats.total_documents_paperless * 100) : 0}%)`}
                  color="emerald"
                />
                <StatCard
                  label="Noch offen"
                  value={stats.remaining.toLocaleString('de-DE')}
                  sub="nicht klassifiziert"
                  color="amber"
                />
                <StatCard
                  label="Cloud-Kosten"
                  value={stats.total_cost_usd > 0 ? `$${stats.total_cost_usd.toFixed(4)}` : '$0.0000'}
                  sub={(() => {
                    const cloudProviders = stats.by_provider.filter(p => p.provider === 'openai' && p.cost > 0)
                    const localProviders = stats.by_provider.filter(p => p.provider === 'ollama')
                    const parts = []
                    if (cloudProviders.length > 0) parts.push(cloudProviders.map(p => `${p.model}: $${p.cost.toFixed(4)}`).join(', '))
                    if (localProviders.length > 0) parts.push('lokal: 0\u20ac')
                    return parts.length > 0 ? parts.join(' | ') : `${(stats.total_tokens_in + stats.total_tokens_out).toLocaleString('de-DE')} Tokens`
                  })()}
                  color="sky"
                />
              </div>

              {/* Progress Bar */}
              {stats.total_documents_paperless > 0 && (
                <div className="card p-4">
                  <div className="flex justify-between text-xs text-surface-400 mb-2">
                    <span>Fortschritt</span>
                    <span>{stats.unique_applied} / {stats.total_documents_paperless}</span>
                  </div>
                  <div className="w-full bg-surface-700/50 rounded-full h-3">
                    <div
                      className="bg-gradient-to-r from-emerald-500 to-emerald-400 h-3 rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(100, (stats.unique_applied / stats.total_documents_paperless) * 100)}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Run Stats + Provider Breakdown */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="card p-4">
                  <h3 className="text-sm font-semibold text-surface-300 mb-3">Ausfuehrungen</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-surface-400">Gesamt-Runs</span>
                      <span className="text-surface-200 font-mono">{stats.total_runs}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-surface-400">Angewendet</span>
                      <span className="text-emerald-400 font-mono">{stats.total_applied}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-surface-400">Fehler</span>
                      <span className={clsx('font-mono', stats.total_errors > 0 ? 'text-red-400' : 'text-surface-500')}>{stats.total_errors}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-surface-400">Durchschn. Dauer</span>
                      <span className="text-surface-200 font-mono">{stats.avg_duration_seconds}s</span>
                    </div>
                  </div>
                </div>
                <div className="card p-4">
                  <h3 className="text-sm font-semibold text-surface-300 mb-3">Pro Provider/Modell</h3>
                  {stats.by_provider.length === 0 ? (
                    <p className="text-xs text-surface-500">Noch keine Daten</p>
                  ) : (
                    <div className="space-y-2.5 text-sm">
                      {stats.by_provider.map(p => (
                        <div key={`${p.provider}-${p.model}`} className="flex justify-between items-center py-1 border-b border-surface-700/40 last:border-0">
                          <div className="flex items-center gap-2">
                            <span className={clsx(
                              'text-xs px-1.5 py-0.5 rounded font-medium',
                              p.provider === 'openai' ? 'bg-sky-500/20 text-sky-400' :
                              p.provider === 'mistral' ? 'bg-orange-500/20 text-orange-400' :
                      p.provider === 'openrouter' ? 'bg-violet-500/20 text-violet-400' :
                              'bg-emerald-500/20 text-emerald-400'
                            )}>
                              {p.provider === 'ollama' ? 'Lokal' : 'Cloud'}
                            </span>
                            <span className="text-surface-200 text-xs font-mono">{p.model || p.provider}</span>
                          </div>
                          <div className="flex items-center gap-3 text-xs">
                            <span className="text-surface-400">{p.count}x</span>
                            <span className="text-surface-500">{p.avg_duration}s</span>
                            {p.cost > 0
                              ? <span className="text-amber-400 font-mono">${p.cost.toFixed(4)}</span>
                              : <span className="text-emerald-400 font-mono">0\u20ac</span>
                            }
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* History List */}
          <div className="card p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-surface-100">Verlauf</h2>
                <p className="text-xs text-surface-500 mt-0.5">Klicken zum Anschauen &amp; Nachbessern</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { loadHistory(); loadStats() }}
                  disabled={historyLoading || statsLoading}
                  className="btn text-xs flex items-center gap-1.5 bg-surface-700 hover:bg-surface-600 text-surface-300"
                >
                  <RefreshCw className={clsx('w-3 h-3', (historyLoading || statsLoading) && 'animate-spin')} />
                  Aktualisieren
                </button>
              </div>
            </div>
            {historyLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-primary-400" />
              </div>
            ) : history.length === 0 ? (
              <p className="text-surface-500 text-center py-8">Noch keine Klassifizierungen durchgefuehrt.</p>
            ) : (
              <div className="space-y-1.5">
                {history.map(entry => {
                  const rj = (entry.result_json || {}) as Record<string, any>
                  const hasNewCorr = rj.correspondent_is_new
                  const hasNewTags = (rj.tags_new || []).length > 0
                  const corrChanged = rj.correspondent && rj.existing_correspondent && rj.correspondent !== rj.existing_correspondent
                  const dtChanged = rj.document_type && rj.existing_document_type && rj.document_type !== rj.existing_document_type
                  const isReview = entry.status === 'review'

                  const spChanged = rj.storage_path_name && rj.existing_storage_path && rj.storage_path_name !== rj.existing_storage_path
                  const hasBadges = isReview || hasNewCorr || hasNewTags || corrChanged || dtChanged || spChanged

                  return (
                    <button
                      key={entry.id}
                      onClick={() => openHistoryEntry(entry)}
                      disabled={!entry.result_json}
                      className={clsx(
                        'w-full flex items-center gap-3 p-3 rounded-lg text-left transition-colors',
                        isReview ? 'bg-amber-500/5 hover:bg-amber-500/10 border border-amber-500/20' :
                        entry.result_json
                          ? 'bg-surface-800/50 hover:bg-surface-700/70 cursor-pointer'
                          : 'bg-surface-800/30 cursor-not-allowed opacity-60'
                      )}
                      title={entry.result_json ? 'Klicken um Ergebnis anzuschauen und zu bearbeiten' : 'Kein gespeichertes Ergebnis'}
                    >
                      {/* Status dot */}
                      <div className={clsx(
                        'w-2.5 h-2.5 rounded-full shrink-0',
                        entry.status === 'applied' ? 'bg-emerald-400' :
                        entry.status === 'error' ? 'bg-red-400' :
                        entry.status === 'review' ? 'bg-amber-400' :
                        'bg-sky-400'
                      )} />

                      {/* Left: Doc info */}
                      <div className="min-w-0 flex-1">
                        <p className="text-surface-200 text-sm font-medium truncate">
                          <span className="text-surface-500 mr-1">#{entry.document_id}</span>
                          {entry.document_title || 'Unbekannt'}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={clsx(
                            'px-1.5 py-0 rounded text-[10px] font-medium',
                            entry.provider === 'openai' ? 'bg-sky-500/20 text-sky-400' :
                            entry.provider === 'mistral' ? 'bg-orange-500/20 text-orange-400' :
                            entry.provider === 'openrouter' ? 'bg-violet-500/20 text-violet-400' :
                            'bg-emerald-500/20 text-emerald-400'
                          )}>
                            {entry.model || entry.provider}
                          </span>
                          <span className="text-surface-600 text-[11px]">{entry.duration_seconds.toFixed(1)}s</span>
                          <span className="text-surface-600 text-[11px]">{entry.created_at ? new Date(entry.created_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}</span>
                        </div>
                      </div>

                      {/* Right: Change details + badges */}
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="flex flex-col items-end gap-0.5 max-w-[280px]">
                          {isReview && (
                            <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                              Prüfen{entry.error_message ? `: ${entry.error_message.substring(0, 40)}` : ''}
                            </span>
                          )}
                          {(hasNewCorr || (corrChanged && !hasNewCorr)) && (
                            <span className={clsx(
                              'px-2 py-0.5 rounded text-[11px] font-medium border truncate max-w-full',
                              hasNewCorr
                                ? 'bg-purple-500/20 text-purple-300 border-purple-500/30'
                                : 'bg-blue-500/20 text-blue-300 border-blue-500/30'
                            )}>
                              {hasNewCorr ? '+' : ''}{rj.correspondent}
                            </span>
                          )}
                          {hasNewTags && (
                            <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 truncate max-w-full">
                              +{(rj.tags_new || []).join(', ')}
                            </span>
                          )}
                          {dtChanged && (
                            <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 truncate max-w-full">
                              Typ: {rj.document_type}
                            </span>
                          )}
                          {spChanged && (
                            <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-teal-500/20 text-teal-300 border border-teal-500/30 truncate max-w-full">
                              Pfad: {rj.storage_path_name}
                            </span>
                          )}
                          {!hasBadges && entry.status === 'applied' && (
                            <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-500/10 text-emerald-500/60 border border-emerald-500/20">OK</span>
                          )}
                        </div>
                        {entry.result_json && (
                          <ChevronRight className="w-4 h-4 text-surface-600" />
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Tag Statistics */}
          {tagStats && tagStats.top_tags.length > 0 && (
            <div className="card p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-surface-100 flex items-center gap-2">
                    <Tags className="w-4 h-4 text-primary-400" />
                    Tag-Statistik
                  </h2>
                  <p className="text-xs text-surface-500 mt-0.5">
                    {tagStats.total_unique_tags} verschiedene Tags &middot; {tagStats.total_tag_assignments.toLocaleString('de-DE')} Zuweisungen &middot; {tagStats.total_new_tags_created} neue erstellt
                  </p>
                </div>
              </div>
              <div className="space-y-1.5">
                {tagStats.top_tags.map((tag, i) => {
                  const maxCount = tagStats.top_tags[0]?.count || 1
                  const pct = Math.round((tag.count / maxCount) * 100)
                  return (
                    <div key={tag.name} className="flex items-center gap-3 group">
                      <span className="text-xs text-surface-600 w-5 text-right shrink-0">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-sm text-surface-200 truncate">{tag.name}</span>
                          {tag.new_count > 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 shrink-0">
                              {tag.new_count}x neu
                            </span>
                          )}
                        </div>
                        <div className="w-full bg-surface-700/40 rounded-full h-1.5">
                          <div
                            className="bg-gradient-to-r from-primary-500 to-primary-400 h-1.5 rounded-full transition-all duration-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                      <span className="text-xs font-mono text-surface-400 shrink-0 w-8 text-right">{tag.count}x</span>
                      {tag.applied_count > 0 && tag.applied_count !== tag.count && (
                        <span className="text-xs font-mono text-emerald-500 shrink-0 w-8 text-right" title="davon angewendet">
                          ✓{tag.applied_count}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}


function PromptSection({ defaultPrompt, userPrompt, onUserPromptChange, placeholder, inline }: {
  defaultPrompt?: string
  userPrompt: string
  onUserPromptChange: (v: string) => void
  placeholder: string
  inline?: boolean
}) {
  const isCustomized = userPrompt.trim() !== '' && userPrompt.trim() !== defaultPrompt?.trim()
  const displayValue = userPrompt !== '' ? userPrompt : (defaultPrompt || '')

  return (
    <div className={clsx(
      'p-3 rounded-lg bg-surface-800/30 border border-surface-700/50 space-y-2',
      !inline && 'ml-8'
    )}>
      <div className="flex items-center justify-between">
        <label className="text-xs text-surface-400 flex items-center gap-1 font-medium">
          <MessageSquare className="w-3 h-3" /> Anweisung (direkt bearbeitbar)
        </label>
        <div className="flex items-center gap-2">
          {isCustomized && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">
              Angepasst
            </span>
          )}
          {isCustomized && defaultPrompt && (
            <button
              onClick={() => onUserPromptChange('')}
              className="text-xs text-surface-500 hover:text-surface-300 underline transition-colors"
              title="Auf Standard zuruecksetzen"
            >
              Zuruecksetzen
            </button>
          )}
        </div>
      </div>
      <textarea
        value={displayValue}
        onChange={(e) => onUserPromptChange(e.target.value)}
        className={clsx(
          'input text-sm w-full',
          isCustomized ? 'border-amber-500/40' : 'border-surface-600/40'
        )}
        rows={4}
        placeholder={placeholder}
      />
      <p className="text-xs text-surface-600">
        {isCustomized
          ? 'Deine angepasste Version wird verwendet. Klicke "Zuruecksetzen" fuer den Standard.'
          : 'Standard-Anweisung aktiv. Direkt bearbeiten um anzupassen.'
        }
      </p>
    </div>
  )
}

function BenchmarkColumn({ title, provider, accent }: {
  title: string
  provider: api.BenchmarkSlotResult
  accent: 'violet' | 'emerald'
}) {
  const r = provider.result
  const borderColor = accent === 'violet' ? 'border-violet-500/30' : 'border-emerald-500/30'
  const headerBg = accent === 'violet' ? 'bg-violet-500/10' : 'bg-emerald-500/10'
  const headerText = accent === 'violet' ? 'text-violet-300' : 'text-emerald-300'

  return (
    <div className={clsx('card border-2 overflow-hidden', borderColor)}>
      <div className={clsx('p-3 flex items-center justify-between', headerBg)}>
        <div>
          <p className={clsx('font-semibold text-sm', headerText)}>{title}</p>
          <p className="text-xs text-surface-500">{provider.model}</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-surface-500">
          <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{r.duration_seconds.toFixed(1)}s</span>
          {r.cost_usd > 0 && <span className="flex items-center gap-1"><Coins className="w-3 h-3" />${r.cost_usd.toFixed(4)}</span>}
        </div>
      </div>

      <div className="p-4 space-y-3">
        {r.error ? (
          <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-red-300 text-sm">{r.error}</p>
          </div>
        ) : (
          <>
            {r.title && (
              <div className="p-2 rounded bg-surface-800/50">
                <p className="text-xs text-surface-500 mb-0.5">Titel</p>
                <p className="text-surface-200 text-sm font-medium">{r.title}</p>
              </div>
            )}
            {r.correspondent && (
              <div className="p-2 rounded bg-surface-800/50">
                <p className="text-xs text-surface-500 mb-0.5">Korrespondent</p>
                <div className="flex items-center gap-2">
                  <p className="text-surface-200 text-sm">{r.correspondent}</p>
                  {r.correspondent_is_new && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">Neu</span>
                  )}
                </div>
              </div>
            )}
            {r.document_type && (
              <div className="p-2 rounded bg-surface-800/50">
                <p className="text-xs text-surface-500 mb-0.5">Dokumenttyp</p>
                <p className="text-surface-200 text-sm">{r.document_type}</p>
              </div>
            )}
            {r.created_date && (
              <div className="p-2 rounded bg-surface-800/50">
                <p className="text-xs text-surface-500 mb-0.5">Erstelldatum</p>
                <p className="text-surface-200 text-sm">{(() => {
                  const m = r.created_date?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
                  return m ? `${m[3]}.${m[2]}.${m[1]}` : r.created_date
                })()}</p>
              </div>
            )}
            {r.storage_path_id && (
              <div className="p-2 rounded bg-surface-800/50">
                <p className="text-xs text-surface-500 mb-0.5">Speicherpfad</p>
                <p className="text-surface-200 text-sm">{r.storage_path_name || `ID: ${r.storage_path_id}`}</p>
                {r.storage_path_reason && <p className="text-xs text-surface-500 mt-0.5">{r.storage_path_reason}</p>}
              </div>
            )}
            {r.tags.length > 0 && (
              <div>
                <p className="text-xs text-surface-500 mb-1">Tags ({r.tags.length})</p>
                <div className="flex flex-wrap gap-1.5">
                  {r.tags.map((tag: string) => {
                    const isNew = (r.tags_new || []).includes(tag)
                    return (
                      <span key={tag} className={clsx(
                        'px-2 py-0.5 rounded-full text-xs border',
                        isNew
                          ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                          : 'bg-primary-500/15 text-primary-300 border-primary-500/20'
                      )}>
                        {tag}{isNew && ' ✦'}
                      </span>
                    )
                  })}
                </div>
              </div>
            )}
            {Object.keys(r.custom_fields).length > 0 && (
              <div>
                <p className="text-xs text-surface-500 mb-1">Custom Fields</p>
                {Object.entries(r.custom_fields).map(([k, v]) => (
                  <div key={k} className="flex justify-between p-1.5 rounded bg-surface-800/50 text-xs mb-1">
                    <span className="text-surface-400">{k}</span>
                    <span className="text-surface-200 font-mono">{v !== null ? String(v) : '-'}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function FieldToggle({ icon: Icon, label, checked, onChange, expandable, expanded, onToggleExpand, badge }: {
  icon: any
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  expandable?: boolean
  expanded?: boolean
  onToggleExpand?: () => void
  badge?: string
}) {
  return (
    <div className="flex items-center justify-between p-3 rounded-lg bg-surface-800/50 hover:bg-surface-800 transition-colors">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <Icon className="w-4 h-4 text-surface-400 shrink-0" />
        <span className="text-surface-200">{label}</span>
        {badge && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-primary-500/20 text-primary-400 border border-primary-500/20">
            {badge}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {expandable && checked && (
          <button
            onClick={onToggleExpand}
            className="p-1 text-surface-400 hover:text-surface-200 transition-colors"
          >
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        )}
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="w-5 h-5 rounded accent-primary-500 cursor-pointer"
        />
      </div>
    </div>
  )
}

function StatCard({ label, value, sub, color }: {
  label: string; value: string; sub: string; color: 'surface' | 'emerald' | 'amber' | 'sky'
}) {
  const colors = {
    surface: 'border-surface-600/40 bg-surface-800/50',
    emerald: 'border-emerald-500/30 bg-emerald-500/5',
    amber: 'border-amber-500/30 bg-amber-500/5',
    sky: 'border-sky-500/30 bg-sky-500/5',
  }
  const valueColors = {
    surface: 'text-surface-100',
    emerald: 'text-emerald-400',
    amber: 'text-amber-400',
    sky: 'text-sky-400',
  }
  return (
    <div className={clsx('p-4 rounded-xl border', colors[color])}>
      <p className="text-xs text-surface-400 mb-1">{label}</p>
      <p className={clsx('text-2xl font-bold font-mono', valueColors[color])}>{value}</p>
      <p className="text-xs text-surface-500 mt-0.5">{sub}</p>
    </div>
  )
}

// ── Tag-Idea: Bestehenden Tag zuweisen ──────────────────────────────────────

function TagIdeaAssignExisting({
  entryId, paperlessTags, onAssigned,
}: {
  entryId: number
  paperlessTags: { id: number; name: string }[]
  onAssigned: () => void
}) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [assigning, setAssigning] = useState(false)

  const filtered = search.length > 0
    ? paperlessTags.filter(t => t.name.toLowerCase().includes(search.toLowerCase())).slice(0, 8)
    : []

  const assign = async (tagName: string) => {
    setAssigning(true)
    try {
      await api.fetchJson(`/classifier/tag-ideas/${entryId}/assign-existing`, {
        method: 'POST',
        body: JSON.stringify({ tag_name: tagName }),
      })
      setSearch('')
      setOpen(false)
      onAssigned()
    } catch { /* ignore */ }
    finally { setAssigning(false) }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full py-1.5 rounded text-xs font-medium bg-surface-700/50 text-surface-400 hover:bg-surface-700 hover:text-surface-300 border border-surface-700/50 transition-colors flex items-center justify-center gap-1.5"
      >
        <Tags className="w-3 h-3" />
        Bestehenden Tag zuweisen
      </button>
    )
  }

  return (
    <div className="relative">
      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Tag suchen..."
        autoFocus
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        className="w-full px-3 py-1.5 bg-surface-900 border border-surface-600 rounded text-sm text-white focus:border-primary-500 focus:outline-none"
      />
      {filtered.length > 0 && (
        <div className="absolute z-10 left-0 right-0 mt-1 bg-surface-800 border border-surface-600 rounded-lg shadow-xl max-h-40 overflow-y-auto">
          {filtered.map(t => (
            <button
              key={t.id}
              onMouseDown={() => assign(t.name)}
              disabled={assigning}
              className="w-full text-left px-3 py-1.5 text-sm text-surface-200 hover:bg-surface-700 transition-colors"
            >
              {t.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
