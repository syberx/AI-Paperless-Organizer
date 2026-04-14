// API Service for backend communication

const API_BASE = '/api'

export async function fetchJson<T>(url: string, options?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const { timeoutMs, ...fetchOptions } = options || {}

  // Create an AbortController for timeout support
  const controller = new AbortController()
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  if (timeoutMs) {
    timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  }

  try {
    const response = await fetch(`${API_BASE}${url}`, {
      ...fetchOptions,
      signal: fetchOptions?.signal ?? controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...fetchOptions?.headers,
      },
    })

    if (!response.ok) {
      let detail = ''
      try {
        const errorBody = await response.json()
        detail = errorBody?.detail || ''
      } catch {
        // ignore
      }
      throw new Error(detail || `API Error: ${response.status} ${response.statusText}`)
    }

    return response.json()
  } catch (e: any) {
    if (e.name === 'AbortError') {
      throw new Error('Zeitüberschreitung: Der Server hat nicht rechtzeitig geantwortet.')
    }
    throw e
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

// Health Check
export const checkHealth = () => fetchJson<{ status: string }>('/health')

// Paperless Connection
export const getPaperlessStatus = () => fetchJson<{ connected: boolean; url?: string; error?: string }>('/paperless/status')

export const refreshPaperlessCache = () =>
  fetchJson<{ success: boolean; correspondents: number; tags: number; document_types: number; message: string }>('/paperless/refresh-cache', { method: 'POST' })

// Document Previews
export interface DocumentPreview {
  id: number
  title: string
  created: string
  thumbnail_url: string
  document_url: string
  download_url: string
}

export const getDocumentPreviews = (params: {
  correspondent_id?: number
  tag_id?: number
  document_type_id?: number
  limit?: number
}) => {
  const searchParams = new URLSearchParams()
  if (params.correspondent_id) searchParams.set('correspondent_id', String(params.correspondent_id))
  if (params.tag_id) searchParams.set('tag_id', String(params.tag_id))
  if (params.document_type_id) searchParams.set('document_type_id', String(params.document_type_id))
  if (params.limit) searchParams.set('limit', String(params.limit))

  return fetchJson<DocumentPreview[]>(`/paperless/document-previews?${searchParams.toString()}`)
}

// Settings
export const getPaperlessSettings = () => fetchJson<{ url: string; api_token: string; is_configured: boolean }>('/settings/paperless')

export const savePaperlessSettings = (data: { url: string; api_token: string }) =>
  fetchJson<{ success: boolean }>('/settings/paperless', {
    method: 'POST',
    body: JSON.stringify(data),
  })

export const getLLMProviders = () => fetchJson<any[]>('/settings/llm-providers')

export const updateLLMProvider = (id: number, data: any) =>
  fetchJson<{ success: boolean }>(`/settings/llm-providers/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })

export const getPrompts = () => fetchJson<any[]>('/settings/prompts')

export const updatePrompt = (id: number, data: any) =>
  fetchJson<{ success: boolean }>(`/settings/prompts/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })

export const resetPrompt = (entityType: string) =>
  fetchJson<{ success: boolean; prompt_template: string }>(`/settings/prompts/reset/${entityType}`, {
    method: 'POST',
  })

// Ignored Tags
export const getIgnoredTags = () =>
  fetchJson<{ id: number; pattern: string; reason: string; is_regex: boolean }[]>('/settings/ignored-tags')

export const addIgnoredTag = (data: { pattern: string; reason?: string; is_regex?: boolean }) =>
  fetchJson<{ id: number; pattern: string; reason: string; is_regex: boolean }>('/settings/ignored-tags', {
    method: 'POST',
    body: JSON.stringify(data)
  })

export const deleteIgnoredTag = (id: number) =>
  fetchJson<{ success: boolean }>(`/settings/ignored-tags/${id}`, { method: 'DELETE' })

// App Settings
export interface AppSettingsResponse {
  password_enabled: boolean
  password_set: boolean
  show_debug_menu: boolean
  sidebar_compact: boolean
  classifier_provider: string
}

export const getAppSettings = () =>
  fetchJson<AppSettingsResponse>('/settings/app')

export const updateAppSettings = (data: {
  password_enabled?: boolean
  password?: string
  show_debug_menu?: boolean
  sidebar_compact?: boolean
  classifier_provider?: string
}) =>
  fetchJson<{ success: boolean }>('/settings/app', {
    method: 'PUT',
    body: JSON.stringify(data)
  })

export const verifyPassword = (password: string) =>
  fetchJson<{ valid: boolean; password_required: boolean }>('/settings/app/verify-password', {
    method: 'POST',
    body: JSON.stringify({ password })
  })

export const removePassword = () =>
  fetchJson<{ success: boolean }>('/settings/app/password', { method: 'DELETE' })

// Correspondents
export const getCorrespondents = () => fetchJson<any[]>('/correspondents/')

export const estimateCorrespondents = () =>
  fetchJson<{ items_info?: string; estimated_tokens: number; token_limit?: number; model?: string; recommended_batches: number; warning?: string }>('/correspondents/estimate')

export const analyzeCorrespondents = (batchSize: number = 200) =>
  fetchJson<{ groups: any[]; stats?: any; error?: string }>('/correspondents/analyze', {
    method: 'POST',
    body: JSON.stringify({ batch_size: batchSize })
  })

export const mergeCorrespondents = (data: { target_id: number; target_name: string; source_ids: number[] }) =>
  fetchJson<any>('/correspondents/merge', {
    method: 'POST',
    body: JSON.stringify(data),
  })

export const getCorrespondentHistory = () => fetchJson<any[]>('/correspondents/history')

export const getEmptyCorrespondents = () =>
  fetchJson<{ count: number; items: any[] }>('/correspondents/empty')

export const deleteEmptyCorrespondents = () =>
  fetchJson<{ deleted: number; total: number; errors?: string[] }>('/correspondents/empty', { method: 'DELETE' })

export const deleteCorrespondent = (id: number) =>
  fetchJson<{ success: boolean }>(`/correspondents/${id}`, { method: 'DELETE' })

// Correspondent Saved Analysis
export interface SavedAnalysisInfo {
  exists: boolean
  id?: number
  created_at?: string
  items_count?: number
  groups_count?: number
  processed_groups?: number[]
}

export interface SavedAnalysisData {
  groups: any[]
  stats?: any
  created_at?: string
  processed_groups?: number[]
}

export const getCorrespondentSavedAnalysis = () =>
  fetchJson<SavedAnalysisInfo>('/correspondents/saved-analysis')

export const loadCorrespondentSavedAnalysis = () =>
  fetchJson<SavedAnalysisData>('/correspondents/saved-analysis/load')

export const deleteCorrespondentSavedAnalysis = () =>
  fetchJson<{ success: boolean }>('/correspondents/saved-analysis', { method: 'DELETE' })

export const markCorrespondentGroupProcessed = (groupIndex: number) =>
  fetchJson<{ success: boolean }>(`/correspondents/saved-analysis/mark-processed?group_index=${groupIndex}`, { method: 'POST' })

// Tags
export const getTags = () => fetchJson<any[]>('/tags/')

export const estimateTags = (analysisType: 'nonsense' | 'correspondent' | 'doctype' | 'similar' = 'nonsense') =>
  fetchJson<{
    analysis_type: string
    items_info: string
    estimated_tokens: number
    token_limit: number
    model: string
    recommended_batches: number
    warning?: string
  }>(`/tags/estimate?analysis_type=${analysisType}`)

export const analyzeTags = (batchSize: number = 200) =>
  fetchJson<{ groups: any[]; stats?: any; error?: string }>('/tags/analyze', {
    method: 'POST',
    body: JSON.stringify({ batch_size: batchSize })
  })

export const mergeTags = (data: { target_id: number; target_name: string; source_ids: number[] }) =>
  fetchJson<any>('/tags/merge', {
    method: 'POST',
    body: JSON.stringify(data),
  })

export const getTagHistory = () => fetchJson<any[]>('/tags/history')

export const getEmptyTags = () =>
  fetchJson<{ count: number; items: any[] }>('/tags/empty')

export const deleteEmptyTags = () =>
  fetchJson<{ deleted: number; total: number; errors?: string[] }>('/tags/empty', { method: 'DELETE' })

export const deleteTag = (tagId: number) =>
  fetchJson<{ success: boolean; message: string }>(`/tags/${tagId}`, { method: 'DELETE' })

export const bulkDeleteTags = (tagIds: number[]) =>
  fetchJson<{ deleted: number[]; deleted_count: number; errors: { tag_id: number; error: string }[] }>(
    '/tags/bulk-delete',
    { method: 'POST', body: JSON.stringify({ tag_ids: tagIds }), timeoutMs: 300000 }
  )

export const removeTagsFromSavedAnalyses = (tagIds: number[]) =>
  fetchJson<{ success: boolean; updated: Record<string, { before: number; after: number }> }>(
    '/tags/saved-analyses/remove-tags', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tag_ids: tagIds }) }
  )

export const analyzeNonsenseTags = () =>
  fetchJson<{ nonsense_tags: any[]; stats?: AnalysisStats; error?: string }>('/tags/analyze-nonsense', { method: 'POST' })

export const analyzeCorrespondentTags = () =>
  fetchJson<{ correspondent_tags: any[]; stats?: AnalysisStats; error?: string }>('/tags/analyze-correspondent-matches', { method: 'POST' })

export const analyzeDoctypeTags = () =>
  fetchJson<{ doctype_tags: any[]; stats?: AnalysisStats; error?: string }>('/tags/analyze-doctype-matches', { method: 'POST' })

// Nonsense Tags Saved Analysis
export const getSavedNonsenseAnalysis = () =>
  fetchJson<{ exists: boolean; id?: number; created_at?: string; items_count?: number; groups_count?: number }>('/tags/saved-nonsense')

export interface AnalysisStats {
  estimated_input_tokens?: number
  estimated_output_tokens?: number
  estimated_total_tokens?: number
  token_limit?: number
  model?: string
  warning?: string
  [key: string]: any
}

export const loadSavedNonsenseAnalysis = () =>
  fetchJson<{ exists: boolean; nonsense_tags: any[]; stats?: AnalysisStats; created_at?: string }>('/tags/saved-nonsense/load')

export const deleteSavedNonsenseAnalysis = () =>
  fetchJson<{ success: boolean }>('/tags/saved-nonsense', { method: 'DELETE' })

// Correspondent Tags Saved Analysis
export const getSavedCorrespondentAnalysis = () =>
  fetchJson<{ exists: boolean; id?: number; created_at?: string; items_count?: number; groups_count?: number }>('/tags/saved-correspondent-matches')

export const loadSavedCorrespondentAnalysis = () =>
  fetchJson<{ exists: boolean; correspondent_tags: any[]; stats?: AnalysisStats; created_at?: string }>('/tags/saved-correspondent-matches/load')

export const deleteSavedCorrespondentAnalysis = () =>
  fetchJson<{ success: boolean }>('/tags/saved-correspondent-matches', { method: 'DELETE' })

// Doctype Tags Saved Analysis
export const getSavedDoctypeAnalysis = () =>
  fetchJson<{ exists: boolean; id?: number; created_at?: string; items_count?: number; groups_count?: number }>('/tags/saved-doctype-matches')

export const loadSavedDoctypeAnalysis = () =>
  fetchJson<{ exists: boolean; doctype_tags: any[]; stats?: AnalysisStats; created_at?: string }>('/tags/saved-doctype-matches/load')

export const deleteSavedDoctypeAnalysis = () =>
  fetchJson<{ success: boolean }>('/tags/saved-doctype-matches', { method: 'DELETE' })

// Tag Saved Analysis (Similarity)
export const getTagSavedAnalysis = () =>
  fetchJson<SavedAnalysisInfo>('/tags/saved-analysis')

export const loadTagSavedAnalysis = () =>
  fetchJson<SavedAnalysisData>('/tags/saved-analysis/load')

export const deleteTagSavedAnalysis = () =>
  fetchJson<{ success: boolean }>('/tags/saved-analysis', { method: 'DELETE' })

export const markTagGroupProcessed = (groupIndex: number) =>
  fetchJson<{ success: boolean }>(`/tags/saved-analysis/mark-processed?group_index=${groupIndex}`, { method: 'POST' })

// Document Types
export const getDocumentTypes = () => fetchJson<any[]>('/document-types/')

export const estimateDocumentTypes = () =>
  fetchJson<{ items_info?: string; estimated_tokens: number; token_limit?: number; model?: string; recommended_batches: number; warning?: string }>('/document-types/estimate')

export const analyzeDocumentTypes = (batchSize: number = 200) =>
  fetchJson<{ groups: any[]; stats?: any; error?: string }>('/document-types/analyze', {
    method: 'POST',
    body: JSON.stringify({ batch_size: batchSize })
  })

export const mergeDocumentTypes = (data: { target_id: number; target_name: string; source_ids: number[] }) =>
  fetchJson<any>('/document-types/merge', {
    method: 'POST',
    body: JSON.stringify(data),
  })

export const getDocumentTypeHistory = () => fetchJson<any[]>('/document-types/history')

export const getEmptyDocumentTypes = () =>
  fetchJson<{ count: number; items: any[] }>('/document-types/empty')

export const deleteEmptyDocumentTypes = () =>
  fetchJson<{ deleted: number; total: number; errors?: string[] }>('/document-types/empty', { method: 'DELETE' })

export const deleteDocumentType = (id: number) =>
  fetchJson<{ success: boolean }>(`/document-types/${id}`, { method: 'DELETE' })

// Document Type Saved Analysis
export const getDocTypeSavedAnalysis = () =>
  fetchJson<SavedAnalysisInfo>('/document-types/saved-analysis')

export const loadDocTypeSavedAnalysis = () =>
  fetchJson<SavedAnalysisData>('/document-types/saved-analysis/load')

export const deleteDocTypeSavedAnalysis = () =>
  fetchJson<{ success: boolean }>('/document-types/saved-analysis', { method: 'DELETE' })

export const markDocTypeGroupProcessed = (groupIndex: number) =>
  fetchJson<{ success: boolean }>(`/document-types/saved-analysis/mark-processed?group_index=${groupIndex}`, { method: 'POST' })

// Statistics
export const recordStatistic = (entityType: string, operation: string, itemsAffected: number, documentsAffected: number = 0) =>
  fetchJson<{ success: boolean }>('/statistics/record', {
    method: 'POST',
    body: JSON.stringify({ entity_type: entityType, operation, items_affected: itemsAffected, documents_affected: documentsAffected })
  })

// LLM
export const testLLMConnection = () =>
  fetchJson<{ success: boolean; provider?: string; model?: string; error?: string }>('/llm/test', { method: 'POST' })

export const getActiveLLMProvider = () =>
  fetchJson<{ configured: boolean; provider?: string; display_name?: string; model?: string }>('/llm/active-provider')

export interface ModelInfo {
  id: string
  provider: string
  context: number
  input_price: number
  output_price: number
  description: string
}

export const getAvailableModels = (provider?: string) =>
  fetchJson<{ models: ModelInfo[] }>(`/llm/models${provider ? `?provider=${provider}` : ''}`)

export const getModelInfo = (modelId: string) =>
  fetchJson<ModelInfo & { model_id: string }>(`/llm/model-info/${modelId}`)

// Statistics
export const getStatisticsSummary = () =>
  fetchJson<{
    current_counts: { correspondents: number; tags: number; document_types: number };
    cleanup_stats: {
      correspondents: { merged: number; deleted: number };
      tags: { merged: number; deleted: number };
      document_types: { merged: number; deleted: number };
      total_items_cleaned: number;
      total_documents_affected: number;
      total_operations: number;
    };
    savings: { total_items_cleaned: number; estimated_time_saved_minutes: number };
  }>('/statistics/summary')

export const getRecentOperations = (limit: number = 10) =>
  fetchJson<any[]>(`/statistics/recent?limit=${limit}`)

// Ignored Items
export interface IgnoredItem {
  id: number
  item_id: number
  item_name: string
  entity_type: string  // "tag", "correspondent", "document_type"
  analysis_type: string  // "nonsense", "correspondent_match", "doctype_match", "similar"
  reason: string
  created_at: string
}

export const getIgnoredItems = (entityType?: string, analysisType?: string) => {
  const params = new URLSearchParams()
  if (entityType) params.append('entity_type', entityType)
  if (analysisType) params.append('analysis_type', analysisType)
  const query = params.toString()
  return fetchJson<IgnoredItem[]>(`/ignored-items${query ? `?${query}` : ''}`)
}

export const addIgnoredItem = (data: {
  item_id: number
  item_name: string
  entity_type: string
  analysis_type: string
  reason?: string
}) => fetchJson<IgnoredItem>('/ignored-items', {
  method: 'POST',
  body: JSON.stringify(data)
})

export const removeIgnoredItem = (id: number) =>
  fetchJson<{ status: string; message: string }>(`/ignored-items/${id}`, { method: 'DELETE' })

export const getIgnoredIds = (entityType: string, analysisType: string) =>
  fetchJson<number[]>(`/ignored-items/ids/${entityType}/${analysisType}`)

// --- OCR API ---

export interface OcrResult {
  document_id: number
  title: string
  old_content: string
  new_content: string
  old_length: number
  new_length: number
  pages_processed: number
  processing_time_seconds: number
}

export interface OcrConnectionResult {
  connected: boolean
  model_available: boolean
  ollama_url?: string
  model?: string
  error?: string
}

export interface BatchOcrStatus {
  running: boolean
  paused: boolean
  total: number
  processed: number
  failed: number
  current_document?: { id: number; title: string } | string | null
  current_page_progress?: OcrPageProgress | null
  errors: string[]
  log: string[]
  start_time?: string
  mode?: string
}

export interface WatchdogStatus {
  enabled: boolean
  running: boolean
  interval_minutes: number
  last_run?: string
  documents_found?: number
}

export interface OcrStats {
  doc_id: number
  title: string
  timestamp: string
  pages: number
  chars: number
  duration: number
  server: string
  success?: boolean
}

// OCR Settings
export const getOcrSettings = () =>
  fetchJson<{ ollama_url: string; ollama_urls: string[]; model: string; max_image_size: number; smart_skip_enabled: boolean; provider?: string; watchdog_enabled?: boolean; watchdog_interval?: number }>('/ocr/settings')

export const saveOcrSettings = (data: { ollama_url: string; ollama_urls?: string[]; model: string; max_image_size: number; smart_skip_enabled: boolean; provider?: string }) =>
  fetchJson<{ success: boolean }>('/ocr/settings', {
    method: 'POST',
    body: JSON.stringify(data)
  })

// OCR Connection Test
export const ensureOcrTags = async () => {
  await fetchJson('/ocr/tags', { method: 'POST' })
}

export const testOcrConnection = async () => {
  return fetchJson<{
    connected: boolean;
    model_available: boolean;
    available_models?: string[];
    requested_model?: string;
    model?: string;
    url?: string;
    error?: string
  }>('/ocr/test-connection', { method: 'POST' })
}

export const getOcrStats = async () => {
  return fetchJson<OcrStats[]>('/ocr/stats')
}

export interface OcrStatus {
  total_documents: number
  finished_documents: number
  pending_documents: number
  percentage: number
  ocrfinish_tag_id: number | null
}

export const getOcrStatus = async () => {
  return fetchJson<OcrStatus>('/ocr/status')
}

// Single Document OCR
export const ocrSingleDocument = (documentId: number, force: boolean = false) =>
  fetchJson<OcrResult>(`/ocr/single/${documentId}?force=${force}`, { method: 'POST' })

export interface OcrPageProgress {
  active: boolean
  document_id: number
  status?: string
  total_pages?: number
  done?: number
  errors?: number
  current_page?: number
  elapsed_seconds?: number
  pages?: { page: number; status: string; chars: number; error?: string }[]
}

export const getOcrProgress = (documentId: number) =>
  fetchJson<OcrPageProgress>(`/ocr/progress/${documentId}`)

export const applyOcrResult = (documentId: number, content: string, setFinishTag: boolean = true) =>
  fetchJson<{ success: boolean }>(`/ocr/apply/${documentId}`, {
    method: 'POST',
    body: JSON.stringify({ content, set_finish_tag: setFinishTag })
  })

// Batch OCR
export const startBatchOcr = (mode: string = 'all', documentIds?: number[], setFinishTag: boolean = true, removeRunocrTag: boolean = true) =>
  fetchJson<{ success: boolean; message: string }>('/ocr/batch/start', {
    method: 'POST',
    body: JSON.stringify({ mode, document_ids: documentIds, set_finish_tag: setFinishTag, remove_runocr_tag: removeRunocrTag })
  })

export const getBatchOcrStatus = () =>
  fetchJson<BatchOcrStatus>('/ocr/batch/status')

export const stopBatchOcr = () =>
  fetchJson<{ success: boolean }>('/ocr/batch/stop', { method: 'POST' })

export const pauseBatchOcr = () =>
  fetchJson<{ success: boolean }>('/ocr/batch/pause', { method: 'POST' })

export const resumeBatchOcr = () =>
  fetchJson<{ success: boolean }>('/ocr/batch/resume', { method: 'POST' })

// Watchdog
export const getWatchdogStatus = () =>
  fetchJson<WatchdogStatus>('/ocr/watchdog/status')

export const setWatchdogSettings = (enabled: boolean, intervalMinutes: number = 1) =>
  fetchJson<{ success: boolean }>('/ocr/watchdog/settings', {
    method: 'POST',
    body: JSON.stringify({ enabled, interval_minutes: intervalMinutes })
  })

// --- Cleanup API ---

export interface CleanupDocument {
  id: number
  title: string
  created: string
  correspondent: number | null
  thumbnail_url: string
}

export interface ScanResult {
  documents: CleanupDocument[]
  total_count: number
}

export const scanJunkDocuments = (query: string, limit: number = 50, searchContent: boolean = false) =>
  fetchJson<ScanResult>(`/cleanup/scan?query=${encodeURIComponent(query)}&limit=${limit}&search_content=${searchContent}`)

export const deleteJunkDocuments = (ids: number[]) =>
  fetchJson<{ success: boolean; deleted_count: number; errors: any[] }>('/cleanup/delete', {
    method: 'POST',
    body: JSON.stringify({ document_ids: ids })
  })

// --- OCR Review Queue API ---

export interface ReviewQueueItem {
  document_id: number
  title: string
  old_content: string
  new_content: string
  old_length: number
  new_length: number
  ratio: number
  timestamp: string
}

export interface ReviewQueueResponse {
  items: ReviewQueueItem[]
  count: number
}

export const getReviewQueue = () =>
  fetchJson<ReviewQueueResponse>('/ocr/review/queue')

export const applyReviewItem = (documentId: number) =>
  fetchJson<{ applied: boolean }>(`/ocr/review/apply/${documentId}`, { method: 'POST' })

export const dismissReviewItem = (documentId: number) =>
  fetchJson<{ dismissed: boolean }>(`/ocr/review/dismiss/${documentId}`, { method: 'POST' })

export const ignoreReviewItem = (documentId: number) =>
  fetchJson<{ ignored: boolean; document_id: number; title: string }>(`/ocr/review/ignore/${documentId}`, { method: 'POST' })

export const resetAllReviewItems = () =>
  fetchJson<{ reset: number; errors: string[] }>('/ocr/review/reset-all', { method: 'POST' })

export const keepAllOriginals = () =>
  fetchJson<{ kept: number; errors: string[] }>('/ocr/review/keep-all-originals', { method: 'POST' })

// --- OCR Ignore List API ---

export interface OcrIgnoreItem {
  document_id: number
  title: string
  reason: string
  timestamp: string
}

export interface OcrIgnoreListResponse {
  items: OcrIgnoreItem[]
  count: number
}

export const getOcrIgnoreList = () =>
  fetchJson<OcrIgnoreListResponse>('/ocr/ignore/list')

export const addToOcrIgnoreList = (documentId: number) =>
  fetchJson<{ added: boolean; document_id: number }>(`/ocr/ignore/add/${documentId}`, { method: 'POST' })

export const removeFromOcrIgnoreList = (documentId: number) =>
  fetchJson<{ removed: boolean; document_id: number }>(`/ocr/ignore/remove/${documentId}`, { method: 'DELETE' })

// --- OCR Error List API ---

export interface OcrErrorItem {
  document_id: number
  title: string
  error: string
  fail_count: number
  timestamp: string
}

export interface OcrErrorListResponse {
  items: OcrErrorItem[]
  count: number
  pending_errors: Record<string, { count: number; title: string; errors: { error: string; timestamp: string }[] }>
}

export const getOcrErrorList = () =>
  fetchJson<OcrErrorListResponse>('/ocr/errors/list')

export const removeFromOcrErrorList = (documentId: number) =>
  fetchJson<{ removed: boolean; document_id: number }>(`/ocr/errors/remove/${documentId}`, { method: 'DELETE' })

export const clearOcrErrorList = () =>
  fetchJson<{ cleared: boolean }>('/ocr/errors/clear', { method: 'POST' })


export interface OcrModelCompareResult {
  model: string
  text: string
  chars: number
  duration_seconds: number
  pages_processed: number
  error: string | null
}

export interface OcrCompareResponse {
  document_id: number
  title: string
  total_pages: number
  compared_page: number
  old_content: string
  results: OcrModelCompareResult[]
}

export const getOllamaModels = () =>
  fetchJson<{ models: string[]; current_model: string }>('/ocr/models')

export const startOcrCompare = (documentId: number, models: string[], page: number = 1) =>
  fetchJson<{ started: boolean; models: number }>('/ocr/compare', {
    method: 'POST',
    body: JSON.stringify({ document_id: documentId, models, page })
  })

export interface OcrCompareStatus {
  running: boolean
  phase: string
  current_model: string
  current_model_index: number
  total_models: number
  current_page: number
  total_pages: number
  models: string[]
  document_id: number
  title: string
  old_content: string
  compared_page: number
  results: OcrModelCompareResult[]
  error: string | null
  elapsed_seconds: number
}

export const getOcrCompareStatus = () =>
  fetchJson<OcrCompareStatus>('/ocr/compare/status')

// OCR Quality Evaluation via external LLM
export interface OcrSpecificError {
  field: string
  expected: string
  got: string
  severity: 'critical' | 'high' | 'medium' | 'low'
}

export interface OcrCategoryScores {
  names_persons: number
  dates_periods: number
  iban_banking: number
  amounts_numbers: number
  addresses: number
  form_logic: number
  completeness: number
  formatting: number
  no_hallucinations: number
  automatizability: number
}

export interface OcrEvaluationRanking {
  rank: number
  model: string
  overall_score: number
  category_scores?: OcrCategoryScores
  speed_seconds?: number
  strengths: string[]
  weaknesses: string[]
  specific_errors?: OcrSpecificError[]
  verdict?: string
}

export interface OcrEvaluation {
  ranking: OcrEvaluationRanking[]
  best_quality?: string
  best_speed?: string
  best_value?: string
  best_model?: string
  recommendation?: string
  critical_finding?: string
  summary?: string
  cross_comparison?: {
    agreement?: string[]
    disagreement?: string[]
  }
  quality_notes?: Record<string, string>
  detected_errors?: Record<string, string[]>
}

export interface OcrEvaluateResponse {
  success: boolean
  evaluation: OcrEvaluation | null
  provider?: string
  model?: string
  raw_response?: string
  parse_error?: string
}

export const evaluateOcrResults = (documentTitle: string, results: OcrModelCompareResult[], evaluationModel?: string) =>
  fetchJson<OcrEvaluateResponse>('/ocr/compare/evaluate', {
    method: 'POST',
    body: JSON.stringify({
      document_title: documentTitle,
      results: results.map(r => ({
        model: r.model,
        text: r.text,
        chars: r.chars,
        duration_seconds: r.duration_seconds
      })),
      evaluation_model: evaluationModel || null
    })
  })


// ==========================================
// KI-Klassifizierer
// ==========================================

export interface ClassifierConfig {
  active_provider: string
  active_model: string
  enable_title: boolean
  enable_tags: boolean
  enable_correspondent: boolean
  enable_document_type: boolean
  enable_storage_path: boolean
  enable_created_date: boolean
  enable_custom_fields: boolean
  tag_behavior: string
  tags_min: number
  tags_max: number
  tags_keep_existing: boolean
  tags_ignore: string[]
  tags_protected: string[]
  dates_ignore: string[]
  storage_path_behavior: string
  storage_path_override_names: string[]
  correspondent_behavior: string
  prompt_title: string
  prompt_tags: string
  prompt_correspondent: string
  prompt_document_type: string
  prompt_date: string
  review_mode: string
  batch_size: number
  system_prompt: string
  excluded_tag_ids: number[]
  excluded_correspondent_ids: number[]
  excluded_document_type_ids: number[]
  correspondent_trim_prompt: boolean
  correspondent_strip_legal: boolean
  correspondent_ignore: string[]
  auto_classify_enabled: boolean
  auto_classify_interval: number
  auto_classify_mode: string
  auto_classify_skip_tag_ids: number[]
  auto_classify_only_tag_ids: number[]
  classification_tag_enabled: boolean
  classification_tag_name: string
  review_tag_enabled: boolean
  review_tag_name: string
  tag_ideas_tag_enabled: boolean
  tag_ideas_tag_name: string
}

export interface PaperlessTag {
  id: number
  name: string
  slug?: string
  colour?: number
  is_inbox_tag?: boolean
}

export interface PaperlessCorrespondent {
  id: number
  name: string
  slug?: string
}

export interface PaperlessDocumentType {
  id: number
  name: string
  slug?: string
}

export interface StoragePathProfile {
  id?: number
  paperless_path_id: number
  paperless_path_name: string
  paperless_path_path: string
  enabled: boolean
  person_name: string
  path_type: string
  context_prompt: string
}

export interface CustomFieldMapping {
  id?: number
  paperless_field_id: number
  paperless_field_name: string
  paperless_field_type: string
  enabled: boolean
  extraction_prompt: string
  example_values: string
  validation_regex: string
  ignore_values: string
}

export interface ClassificationResult {
  title: string | null
  tags: string[]
  tags_new: string[]
  existing_tags: string[]
  existing_correspondent: string | null
  existing_document_type: string | null
  existing_storage_path_id: number | null
  existing_storage_path_name: string | null
  correspondent: string | null
  correspondent_is_new: boolean
  document_type: string | null
  storage_path_id: number | null
  storage_path_name: string | null
  storage_path_reason: string | null
  created_date: string | null
  custom_fields: Record<string, any>
  tokens_input: number
  tokens_output: number
  cost_usd: number
  duration_seconds: number
  tool_calls_count: number
  error: string | null
  debug_info?: Record<string, any>
  summary?: string | null
}

export interface ClassificationHistoryEntry {
  id: number
  document_id: number
  document_title: string
  provider: string
  model: string
  tokens_input: number
  tokens_output: number
  cost_usd: number
  duration_seconds: number
  tool_calls_count: number
  status: string
  error_message: string
  created_at: string
  result_json: ClassificationResult | null
}

export interface TagStat {
  name: string
  count: number
  applied_count: number
  new_count: number
}

export interface TagStats {
  top_tags: TagStat[]
  total_unique_tags: number
  total_tag_assignments: number
  total_new_tags_created: number
}

export interface PromptDefaults {
  title: string
  tags: string
  correspondent: string
  document_type: string
  date: string
}

export const getClassifierPromptDefaults = () =>
  fetchJson<PromptDefaults>('/classifier/prompt-defaults')

export const getClassifierConfig = () =>
  fetchJson<ClassifierConfig>('/classifier/config')

export const updateClassifierConfig = (data: Partial<ClassifierConfig>) =>
  fetchJson<{ status: string }>('/classifier/config', {
    method: 'PUT',
    body: JSON.stringify(data),
  })

export interface OllamaModel {
  name: string
  size_gb: number
  parameter_size: string
  family: string
  is_thinking: boolean
  recommendation: string | null
  category: 'standard' | 'thinking'
  speed: string | null
  quality: string | null
}

export interface OllamaModelSuggestion {
  name: string
  recommendation: string
  category: string
  speed: string | null
  quality: string | null
  install_command: string
}

export interface OllamaModelsResponse {
  connected: boolean
  ollama_host: string
  installed: OllamaModel[]
  suggestions: OllamaModelSuggestion[]
  top_recommendation: string | null
}

export interface OllamaTestResponse {
  connected: boolean
  model_available: boolean
  model: string
  message: string
  installed_models?: string[]
  install_hint?: string
}

export const getClassifierTags = () =>
  fetchJson<PaperlessTag[]>('/classifier/tags')

export const getClassifierCorrespondents = () =>
  fetchJson<PaperlessCorrespondent[]>('/classifier/correspondents')

export const getClassifierDocumentTypes = () =>
  fetchJson<PaperlessDocumentType[]>('/classifier/document-types')

export const getClassifierOllamaModels = () =>
  fetchJson<OllamaModelsResponse>('/classifier/ollama/models')

export const testClassifierOllama = (model?: string, host?: string) => {
  const params = new URLSearchParams()
  if (model) params.set('model', model)
  if (host) params.set('host', host)
  const qs = params.toString() ? `?${params.toString()}` : ''
  return fetchJson<OllamaTestResponse>(`/classifier/ollama/test${qs}`, { method: 'POST' })
}

export const getStoragePathsFromPaperless = () =>
  fetchJson<any[]>('/classifier/storage-paths')

export const getStoragePathProfiles = () =>
  fetchJson<StoragePathProfile[]>('/classifier/storage-path-profiles')

export const saveStoragePathProfiles = (profiles: StoragePathProfile[]) =>
  fetchJson<{ status: string; saved_count: number }>('/classifier/storage-path-profiles', {
    method: 'PUT',
    body: JSON.stringify(profiles),
  })

export const getCustomFieldsFromPaperless = () =>
  fetchJson<any[]>('/classifier/custom-fields')

export const getCustomFieldMappings = () =>
  fetchJson<CustomFieldMapping[]>('/classifier/custom-field-mappings')

export const saveCustomFieldMappings = (mappings: CustomFieldMapping[]) =>
  fetchJson<{ status: string; saved_count: number }>('/classifier/custom-field-mappings', {
    method: 'PUT',
    body: JSON.stringify(mappings),
  })

export const classifyDocument = (documentId: number) =>
  fetchJson<ClassificationResult>(`/classifier/analyze?document_id=${documentId}`, {
    method: 'POST',
    timeoutMs: 600000,
  })

export interface BenchmarkSlotResult {
  provider: string
  model: string
  result: ClassificationResult
}

export interface BenchmarkResponse {
  document_id: number
  document_title: string
  results: BenchmarkSlotResult[]
  error?: string
}

export interface BenchmarkSlot {
  provider: string
  model: string
}

export interface BenchmarkRequest {
  document_id: number
  slots: BenchmarkSlot[]
}

export const benchmarkDocument = (req: BenchmarkRequest) =>
  fetchJson<BenchmarkResponse>('/classifier/benchmark', {
    method: 'POST',
    body: JSON.stringify(req),
    timeoutMs: 600000,
  })

export const getClassifierDocumentThumbUrl = (documentId: number) =>
  `${API_BASE}/classifier/document/${documentId}/thumb`

export const getClassifierDocumentPreviewUrl = (documentId: number) =>
  `${API_BASE}/classifier/document/${documentId}/preview`

export const applyClassification = (documentId: number, classification: Record<string, any>) =>
  fetchJson<{ applied: boolean; updated_fields?: string[] }>('/classifier/apply', {
    method: 'POST',
    body: JSON.stringify({ document_id: documentId, classification }),
  })

export const getClassificationHistory = (limit: number = 50) =>
  fetchJson<ClassificationHistoryEntry[]>(`/classifier/history?limit=${limit}`)

export interface ClassifierStats {
  total_documents_paperless: number
  unique_classified: number
  unique_applied: number
  remaining: number
  total_runs: number
  total_applied: number
  total_errors: number
  total_tokens_in: number
  total_tokens_out: number
  total_cost_usd: number
  avg_duration_seconds: number
  by_provider: Array<{
    provider: string
    model: string
    count: number
    cost: number
    avg_duration: number
  }>
  recent: Array<{
    document_id: number
    document_title: string
    provider: string
    model: string
    status: string
    cost_usd: number
    duration_seconds: number
    created_at: string | null
  }>
}

export const getClassifierStats = () =>
  fetchJson<ClassifierStats>('/classifier/stats')

export const getTagStats = () =>
  fetchJson<TagStats>('/classifier/tag-stats')

export const getNextUnclassified = (afterId: number = 0) =>
  fetchJson<{ found: boolean; document_id: number | null; title: string }>(
    `/classifier/next-unclassified?after_id=${afterId}`
  )

export const refreshClassifierCache = () =>
  fetchJson<{ refreshed: boolean; tags: number; correspondents: number; document_types: number; storage_paths: number }>(
    '/classifier/refresh-cache', { method: 'POST' }
  )

// --- API Keys ---
export interface ApiKeyInfo {
  id: number
  name: string
  key_prefix: string
  is_active: boolean
  created_at: string | null
  last_used_at: string | null
}

export interface GeneratedKey {
  id: number
  name: string
  key: string
  key_prefix: string
  message: string
}

export const generateApiKey = (name: string) =>
  fetchJson<GeneratedKey>('/api-keys/generate', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })

export const listApiKeys = () => fetchJson<ApiKeyInfo[]>('/api-keys/list')

export const deleteApiKey = (id: number) =>
  fetchJson<{ deleted: boolean }>(`/api-keys/${id}`, { method: 'DELETE' })

export const toggleApiKey = (id: number) =>
  fetchJson<{ id: number; is_active: boolean }>(`/api-keys/${id}/toggle`, { method: 'PUT' })
