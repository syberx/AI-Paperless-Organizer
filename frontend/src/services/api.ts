// API Service for backend communication

const API_BASE = '/api'

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })

  if (!response.ok) {
    // Try to extract detailed error message from response body
    let detail = ''
    try {
      const errorBody = await response.json()
      detail = errorBody?.detail || ''
    } catch {
      // Response body not JSON, ignore
    }
    throw new Error(detail || `API Error: ${response.status} ${response.statusText}`)
  }

  return response.json()
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
}

export const getAppSettings = () =>
  fetchJson<AppSettingsResponse>('/settings/app')

export const updateAppSettings = (data: {
  password_enabled?: boolean
  password?: string
  show_debug_menu?: boolean
  sidebar_compact?: boolean
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
  current_document?: string
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
}

// OCR Settings
export const getOcrSettings = () =>
  fetchJson<{ ollama_url: string; ollama_urls: string[]; model: string; max_image_size: number; smart_skip_enabled: boolean; watchdog_enabled?: boolean; watchdog_interval?: number }>('/ocr/settings')

export const saveOcrSettings = (data: { ollama_url: string; ollama_urls?: string[]; model: string; max_image_size: number; smart_skip_enabled: boolean }) =>
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
// Single Document OCR
export const ocrSingleDocument = (documentId: number, force: boolean = false) =>
  fetchJson<OcrResult>(`/ocr/single/${documentId}?force=${force}`, { method: 'POST' })

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

export const setWatchdogSettings = (enabled: boolean, intervalMinutes: number = 5) =>
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

export const scanJunkDocuments = (query: string, limit: number = 50) =>
  fetchJson<ScanResult>(`/cleanup/scan?query=${encodeURIComponent(query)}&limit=${limit}`)

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

// --- OCR Model Comparison API ---

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
