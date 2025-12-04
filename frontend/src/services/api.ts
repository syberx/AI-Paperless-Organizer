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
    throw new Error(`API Error: ${response.status} ${response.statusText}`)
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
  fetchJson<{ items_count: number; estimated_tokens: number; recommended_batches: number; warning?: string }>('/correspondents/estimate')

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

export const estimateTags = () => 
  fetchJson<{ items_count: number; estimated_tokens: number; recommended_batches: number; warning?: string }>('/tags/estimate')

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
  fetchJson<{ nonsense_tags: any[]; stats?: any; error?: string }>('/tags/analyze-nonsense', { method: 'POST' })

export const analyzeCorrespondentTags = () =>
  fetchJson<{ correspondent_tags: any[]; stats?: any; error?: string }>('/tags/analyze-correspondent-matches', { method: 'POST' })

export const analyzeDoctypeTags = () =>
  fetchJson<{ doctype_tags: any[]; stats?: any; error?: string }>('/tags/analyze-doctype-matches', { method: 'POST' })

// Tag Saved Analysis
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
  fetchJson<{ items_count: number; estimated_tokens: number; recommended_batches: number; warning?: string }>('/document-types/estimate')

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

