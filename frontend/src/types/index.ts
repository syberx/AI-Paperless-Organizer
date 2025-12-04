// API Types

export interface Correspondent {
  id: number
  name: string
  document_count: number
}

export interface Tag {
  id: number
  name: string
  color?: string
  document_count: number
}

export interface DocumentType {
  id: number
  name: string
  document_count: number
}

export interface SimilarityGroup {
  suggested_name: string
  confidence: number
  members: Array<{
    id: number
    name: string
    document_count: number
  }>
  reasoning: string
}

export interface MergeRequest {
  target_id: number
  target_name: string
  source_ids: number[]
}

export interface MergeResult {
  success: boolean
  merged_count?: number
  documents_affected?: number
  history_id?: number
  error?: string
}

export interface MergeHistoryItem {
  id: number
  entity_type: string
  target_id: number
  target_name: string
  merged_count: number
  documents_affected: number
  status: string
  created_at: string
}

export interface LLMProvider {
  id: number
  name: string
  display_name: string
  api_key: string
  api_base_url: string
  model: string
  is_active: boolean
  is_configured: boolean
}

export interface CustomPrompt {
  id: number
  entity_type: string
  prompt_template: string
  is_active: boolean
}

export interface PaperlessSettings {
  url: string
  api_token: string
  is_configured: boolean
}

export interface ConnectionStatus {
  connected: boolean
  url?: string
  error?: string
}

