const API_BASE = '/api'

export interface SearchFilters {
  tags?: number[]
  correspondent_id?: number
  document_type_id?: number
  date_from?: string
  date_to?: string
}

export interface SearchResult {
  document_id: number
  title: string
  snippet: string
  score: number
  metadata: Record<string, any>
  chunk_id: string
}

export interface ChatSource {
  index: number
  document_id: number
  title: string
  score: number
  snippet: string
}

export interface ChatMessage {
  id?: number
  role: 'user' | 'assistant'
  content: string
  sources?: ChatSource[]
  created_at?: string
}

export interface ChatSession {
  id: string
  title: string
  created_at: string
  updated_at?: string
  message_count: number
}

export interface ChatSessionDetail {
  id: string
  title: string
  created_at: string
  messages: ChatMessage[]
}

export interface RagConfig {
  embedding_provider: string
  embedding_model: string
  ollama_base_url: string
  chunk_size: number
  chunk_overlap: number
  bm25_weight: number
  semantic_weight: number
  max_sources: number
  max_context_tokens: number
  chat_model_provider: string
  chat_model: string
  chat_system_prompt: string
  auto_index_enabled: boolean
  auto_index_interval: number
  query_rewrite_enabled: boolean
  contextual_retrieval_enabled: boolean
}

export interface IndexStatus {
  status: string
  total_documents: number
  indexed_documents: number
  last_indexed_at: string | null
  error_message: string
  chunks_in_index: number
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })
  if (!response.ok) {
    let detail = ''
    try {
      const body = await response.json()
      detail = body?.detail || ''
    } catch { /* ignore */ }
    throw new Error(detail || `API Error: ${response.status}`)
  }
  return response.json()
}

export async function searchDocuments(query: string, limit = 10, filters?: SearchFilters) {
  return fetchJson<{ query: string; results: SearchResult[]; total: number }>('/rag/search', {
    method: 'POST',
    body: JSON.stringify({ query, limit, filters }),
  })
}

export async function startIndexing(force = false) {
  return fetchJson<{ status: string; force: boolean }>('/rag/index/start', {
    method: 'POST',
    body: JSON.stringify({ force }),
  })
}

export async function getIndexStatus() {
  return fetchJson<IndexStatus>('/rag/index/status')
}

export async function getSessions() {
  return fetchJson<ChatSession[]>('/rag/sessions')
}

export async function getSession(sessionId: string) {
  return fetchJson<ChatSessionDetail>(`/rag/sessions/${sessionId}`)
}

export async function deleteSession(sessionId: string) {
  return fetchJson<{ deleted: boolean }>(`/rag/sessions/${sessionId}`, { method: 'DELETE' })
}

export async function getRagConfig() {
  return fetchJson<RagConfig>('/rag/config')
}

export async function updateRagConfig(updates: Partial<RagConfig>) {
  return fetchJson<RagConfig>('/rag/config', {
    method: 'PUT',
    body: JSON.stringify(updates),
  })
}

export async function getRagHealth() {
  return fetchJson<{ embedding: any; index: IndexStatus }>('/rag/health')
}

export interface StreamCallbacks {
  onSession?: (sessionId: string) => void
  onSources?: (sources: ChatSource[]) => void
  onStatus?: (message: string) => void
  onToken?: (token: string) => void
  onCitations?: (cited: number[]) => void
  onError?: (error: string) => void
  onDone?: () => void
}

export function streamChat(
  question: string,
  callbacks: StreamCallbacks,
  sessionId?: string,
  filters?: SearchFilters,
): AbortController {
  const controller = new AbortController()

  const run = async () => {
    try {
      const response = await fetch(`${API_BASE}/rag/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, session_id: sessionId, filters }),
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error(`Chat error: ${response.status}`)
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No reader')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const text = line.replace(/^\s*data:\s*/, '').trim()
          if (!text) continue
          try {
            const data = JSON.parse(text)
            switch (data.type) {
              case 'session':
                callbacks.onSession?.(data.session_id)
                break
              case 'sources':
                callbacks.onSources?.(data.sources)
                break
              case 'status':
                callbacks.onStatus?.(data.message)
                break
              case 'token':
                callbacks.onToken?.(data.content)
                break
              case 'citations':
                callbacks.onCitations?.(data.cited ?? [])
                break
              case 'error':
                callbacks.onError?.(data.message)
                break
              case 'done':
                callbacks.onDone?.()
                break
            }
          } catch { /* ignore parse errors */ }
        }
      }
      callbacks.onDone?.()
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        callbacks.onError?.(e.message)
      }
    }
  }

  run()
  return controller
}
