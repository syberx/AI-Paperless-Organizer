import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Send, Plus, Trash2, MessageSquare, Database, Loader2,
  Search, Settings2, RefreshCw, FileText, ChevronRight,
  AlertCircle, CheckCircle2, ExternalLink, Award,
} from 'lucide-react'
import clsx from 'clsx'
import * as ragApi from '../services/ragApi'
import { getPaperlessSettings } from '../services/api'

interface LocalMessage {
  role: 'user' | 'assistant'
  content: string
  sources?: ragApi.ChatSource[]
  citedSources?: number[]   // source.index values actually cited by the LLM
  isStreaming?: boolean
  statusMessage?: string
}

function scoreColor(score: number): string {
  if (score >= 0.85) return 'bg-primary-600/20 text-primary-400 border border-primary-500/40'
  if (score >= 0.65) return 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
  return 'bg-surface-600/40 text-surface-400 border border-surface-500/40'
}


export default function RagChat() {
  const [sessions, setSessions] = useState<ragApi.ChatSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<LocalMessage[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [indexStatus, setIndexStatus] = useState<ragApi.IndexStatus | null>(null)
  const [indexStatusLoaded, setIndexStatusLoaded] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [config, setConfig] = useState<ragApi.RagConfig | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [paperlessUrl, setPaperlessUrl] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    loadSessions()
    loadIndexStatus()
    loadConfig()
    getPaperlessSettings().then(s => {
      if (s.url) setPaperlessUrl(s.url.replace(/\/$/, ''))
    }).catch(() => {})
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const loadSessions = async () => {
    try {
      const data = await ragApi.getSessions()
      setSessions(data)
    } catch (e) {
      console.error('Failed to load sessions:', e)
    }
  }

  const loadIndexStatus = async () => {
    try {
      const status = await ragApi.getIndexStatus()
      setIndexStatus(status)
    } catch (e) {
      console.error('Failed to load index status:', e)
    } finally {
      setIndexStatusLoaded(true)
    }
  }

  const loadConfig = async () => {
    try {
      const cfg = await ragApi.getRagConfig()
      setConfig(cfg)
    } catch (e) {
      console.error('Failed to load config:', e)
    }
  }

  const loadSession = async (sessionId: string) => {
    try {
      const session = await ragApi.getSession(sessionId)
      setActiveSessionId(sessionId)
      setMessages(
        session.messages.map((m) => ({
          role: m.role,
          content: m.content,
          sources: m.sources,
        }))
      )
    } catch (e) {
      console.error('Failed to load session:', e)
    }
  }

  const startNewChat = () => {
    setActiveSessionId(null)
    setMessages([])
    inputRef.current?.focus()
  }

  const deleteChat = async (sessionId: string) => {
    try {
      await ragApi.deleteSession(sessionId)
      if (activeSessionId === sessionId) {
        startNewChat()
      }
      loadSessions()
    } catch (e) {
      console.error('Failed to delete session:', e)
    }
  }

  const handleSend = useCallback(async () => {
    const question = input.trim()
    if (!question || isLoading) return

    setInput('')
    setIsLoading(true)

    setMessages((prev) => [...prev, { role: 'user', content: question }])
    setMessages((prev) => [...prev, { role: 'assistant', content: '', isStreaming: true }])

    let currentSessionId = activeSessionId

    abortRef.current = ragApi.streamChat(
      question,
      {
        onSession: (sid) => {
          currentSessionId = sid
          setActiveSessionId(sid)
        },
        onSources: (sources) => {
          setMessages((prev) => {
            const updated = [...prev]
            const last = updated[updated.length - 1]
            if (last && last.role === 'assistant') {
              updated[updated.length - 1] = { ...last, sources }
            }
            return updated
          })
        },
        onStatus: (message) => {
          setMessages((prev) => {
            const updated = [...prev]
            const last = updated[updated.length - 1]
            if (last && last.role === 'assistant' && !last.content) {
              updated[updated.length - 1] = { ...last, statusMessage: message }
            }
            return updated
          })
        },
        onToken: (token) => {
          setMessages((prev) => {
            const updated = [...prev]
            const last = updated[updated.length - 1]
            if (last && last.role === 'assistant') {
              updated[updated.length - 1] = { ...last, content: last.content + token }
            }
            return updated
          })
        },
        onCitations: (cited) => {
          setMessages((prev) => {
            const updated = [...prev]
            const last = updated[updated.length - 1]
            if (last && last.role === 'assistant') {
              updated[updated.length - 1] = { ...last, citedSources: cited }
            }
            return updated
          })
        },
        onError: (error) => {
          setMessages((prev) => {
            const updated = [...prev]
            const last = updated[updated.length - 1]
            if (last && last.role === 'assistant') {
              updated[updated.length - 1] = {
                ...last,
                content: last.content + `\n\n⚠️ Fehler: ${error}`,
                isStreaming: false,
              }
            }
            return updated
          })
          setIsLoading(false)
        },
        onDone: () => {
          setMessages((prev) => {
            const updated = [...prev]
            const last = updated[updated.length - 1]
            if (last && last.role === 'assistant') {
              updated[updated.length - 1] = { ...last, isStreaming: false }
            }
            return updated
          })
          setIsLoading(false)
          loadSessions()
        },
      },
      currentSessionId || undefined,
    )
  }, [input, isLoading, activeSessionId])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const startIndex = async (force = false) => {
    try {
      await ragApi.startIndexing(force)
      loadIndexStatus()
      const interval = setInterval(async () => {
        const status = await ragApi.getIndexStatus()
        setIndexStatus(status)
        if (status.status !== 'indexing') {
          clearInterval(interval)
        }
      }, 3000)
    } catch (e: any) {
      console.error('Indexing error:', e)
    }
  }

  const saveConfig = async (updates: Partial<ragApi.RagConfig>) => {
    try {
      const updated = await ragApi.updateRagConfig(updates)
      setConfig(updated)
    } catch (e) {
      console.error('Failed to save config:', e)
    }
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] -m-6 -mt-2 bg-surface-900">
      {/* Sidebar */}
      <div
        className={clsx(
          'bg-surface-900 border-r border-surface-700/50 flex flex-col transition-all duration-200',
          sidebarOpen ? 'w-72' : 'w-0 overflow-hidden'
        )}
      >
        <div className="p-3 border-b border-surface-700/50">
          <button
            onClick={startNewChat}
            className="w-full flex items-center gap-2 px-3 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            Neuer Chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {sessions.length === 0 ? (
            <div className="p-4 text-sm text-surface-500 text-center">
              Noch keine Chats vorhanden
            </div>
          ) : (
            sessions.map((session) => (
              <div
                key={session.id}
                className={clsx(
                  'group flex items-center gap-2 px-3 py-2.5 cursor-pointer border-b border-surface-800 hover:bg-surface-800',
                  activeSessionId === session.id && 'bg-surface-800 border-l-2 border-l-primary-500'
                )}
                onClick={() => loadSession(session.id)}
              >
                <MessageSquare className="w-4 h-4 text-surface-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-surface-100 truncate">{session.title}</div>
                  <div className="text-xs text-surface-500">
                    {session.message_count} Nachrichten
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    deleteChat(session.id)
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 text-surface-500 hover:text-red-400 transition-all"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Index Status */}
        <div className="p-3 border-t border-surface-700/50 bg-surface-950/50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-surface-400 uppercase tracking-wider">Index</span>
            <div className="flex gap-1">
              <button
                onClick={() => startIndex(false)}
                disabled={indexStatus?.status === 'indexing'}
                className="p-1 text-surface-500 hover:text-primary-400 disabled:opacity-40 transition-colors"
                title="Neue Dokumente indexieren"
              >
                <RefreshCw className={clsx('w-3.5 h-3.5', indexStatus?.status === 'indexing' && 'animate-spin')} />
              </button>
              <button
                onClick={() => startIndex(true)}
                disabled={indexStatus?.status === 'indexing'}
                className="p-1 text-surface-500 hover:text-amber-400 disabled:opacity-40 transition-colors"
                title="Komplett neu indexieren"
              >
                <Database className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          {indexStatus && (
            <div className="text-xs text-surface-400 space-y-0.5">
              <div className="flex items-center gap-1">
                {indexStatus.status === 'indexing' ? (
                  <Loader2 className="w-3 h-3 animate-spin text-primary-400" />
                ) : indexStatus.status === 'completed' ? (
                  <CheckCircle2 className="w-3 h-3 text-primary-400" />
                ) : indexStatus.status === 'error' ? (
                  <AlertCircle className="w-3 h-3 text-red-400" />
                ) : (
                  <Database className="w-3 h-3 text-surface-500" />
                )}
                <span className="text-surface-300">
                  {indexStatus.indexed_documents}/{indexStatus.total_documents} Dokumente
                </span>
              </div>
              {indexStatus.chunks_in_index > 0 && (
                <div className="text-surface-500">{indexStatus.chunks_in_index} Chunks im Index</div>
              )}
              {indexStatus.status === 'indexing' && (
                <div className="w-full bg-surface-700 rounded-full h-1.5 mt-1">
                  <div
                    className="bg-primary-500 h-1.5 rounded-full transition-all"
                    style={{
                      width: `${indexStatus.total_documents > 0 ? (indexStatus.indexed_documents / indexStatus.total_documents) * 100 : 0}%`,
                    }}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col bg-surface-900">
        {/* Top bar */}
        <div className="bg-surface-800/80 backdrop-blur border-b border-surface-700/50 px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-1.5 text-surface-400 hover:text-surface-100 rounded-lg hover:bg-surface-700/50 transition-colors"
            >
              <ChevronRight className={clsx('w-4 h-4 transition-transform', sidebarOpen && 'rotate-180')} />
            </button>
            <h2 className="text-sm font-semibold text-surface-100 font-display">
              RAG Dokumenten-Chat
            </h2>
          </div>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={clsx(
              'p-1.5 rounded-lg transition-colors',
              showSettings ? 'text-primary-400 bg-primary-500/10' : 'text-surface-400 hover:text-surface-100 hover:bg-surface-700/50'
            )}
          >
            <Settings2 className="w-4 h-4" />
          </button>
        </div>

        {/* Settings Panel (collapsible) */}
        {showSettings && config && (
          <div className="bg-surface-800/60 border-b border-surface-700/50 p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div>
                <label className="block text-xs font-medium text-surface-400 mb-1">Embedding-Modell</label>
                <input
                  type="text"
                  value={config.embedding_model}
                  onChange={(e) => setConfig({ ...config, embedding_model: e.target.value })}
                  onBlur={() => saveConfig({ embedding_model: config.embedding_model })}
                  className="w-full px-2 py-1.5 bg-surface-700 border border-surface-600 rounded text-sm text-surface-100 focus:outline-none focus:border-primary-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-surface-400 mb-1">Chat-Modell</label>
                <input
                  type="text"
                  value={config.chat_model}
                  onChange={(e) => setConfig({ ...config, chat_model: e.target.value })}
                  onBlur={() => saveConfig({ chat_model: config.chat_model })}
                  className="w-full px-2 py-1.5 bg-surface-700 border border-surface-600 rounded text-sm text-surface-100 focus:outline-none focus:border-primary-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-surface-400 mb-1">BM25 Gewicht</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="1"
                  value={config.bm25_weight}
                  onChange={(e) => setConfig({ ...config, bm25_weight: parseFloat(e.target.value) })}
                  onBlur={() => saveConfig({ bm25_weight: config.bm25_weight })}
                  className="w-full px-2 py-1.5 bg-surface-700 border border-surface-600 rounded text-sm text-surface-100 focus:outline-none focus:border-primary-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-surface-400 mb-1">Max. Quellen</label>
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={config.max_sources}
                  onChange={(e) => setConfig({ ...config, max_sources: parseInt(e.target.value) })}
                  onBlur={() => saveConfig({ max_sources: config.max_sources })}
                  className="w-full px-2 py-1.5 bg-surface-700 border border-surface-600 rounded text-sm text-surface-100 focus:outline-none focus:border-primary-500"
                />
              </div>
            </div>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-16 h-16 rounded-2xl bg-surface-800 border border-surface-700/50 flex items-center justify-center mb-4">
                <Search className="w-7 h-7 text-primary-400" />
              </div>
              <h3 className="text-lg font-semibold text-surface-100 mb-2 font-display">Dokumenten-Chat</h3>
              <p className="text-sm text-surface-400 max-w-md">
                Stelle Fragen zu deinen Dokumenten. Der KI-Assistent durchsucht alle indexierten
                Dokumente und gibt dir Antworten mit Quellenangaben.
              </p>
              {!indexStatusLoaded ? (
                <div className="mt-4 flex items-center gap-2 text-sm text-surface-500">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Index-Status wird geladen...
                </div>
              ) : indexStatus && indexStatus.indexed_documents === 0 && indexStatus.status !== 'indexing' ? (
                <button
                  onClick={() => startIndex(false)}
                  className="mt-4 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm flex items-center gap-2 transition-colors"
                >
                  <Database className="w-4 h-4" />
                  Dokumente jetzt indexieren
                </button>
              ) : indexStatus && indexStatus.status === 'indexing' ? (
                <div className="mt-4 text-sm text-primary-400 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Indexierung läuft ({indexStatus.indexed_documents}/{indexStatus.total_documents})...
                </div>
              ) : null}
            </div>
          ) : (
            messages.map((msg, i) => (
              <div key={i} className={clsx('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                {msg.role === 'user' ? (
                  /* User bubble */
                  <div className="max-w-[75%] bg-primary-600 text-white rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap">
                    {msg.content}
                  </div>
                ) : (
                  /* Assistant response – full width, no bubble */
                  <div className="w-full max-w-3xl space-y-3">

                    {/* Sources FIRST – compact chips */}
                    {msg.sources && msg.sources.length > 0 && (
                      <div>
                        <div className="flex items-center gap-1.5 mb-2">
                          <FileText className="w-3.5 h-3.5 text-surface-500" />
                          <span className="text-xs font-semibold text-surface-500 uppercase tracking-wider">
                            {msg.sources.length} Quellen
                          </span>
                          {msg.citedSources && msg.citedSources.length > 0 && (
                            <span className="text-xs text-primary-400 ml-1">
                              · {msg.citedSources.length} verwendet
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {msg.sources.map((src) => {
                            // A source is "cited" if the LLM used [N] notation for it.
                            // Fall back to highlighting rank #1 if no citations were parsed.
                            const hasCitationData = msg.citedSources !== undefined
                            const isCited = hasCitationData
                              ? msg.citedSources!.includes(src.index)
                              : src.index === 1
                            return (
                              <a
                                key={src.index}
                                href={paperlessUrl ? `${paperlessUrl}/documents/${src.document_id}/details` : '#'}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={`${src.title} — Score: ${(src.score * 100).toFixed(0)}% ${isCited ? '· Vom KI verwendet' : ''}`}
                                className={clsx(
                                  'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all group border',
                                  isCited
                                    ? 'bg-primary-500/15 border-primary-500/40 text-primary-300 hover:bg-primary-500/25'
                                    : 'bg-surface-700/50 border-surface-600/40 text-surface-300 hover:bg-surface-700 hover:text-surface-100'
                                )}
                              >
                                <span className={clsx(
                                  'w-4 h-4 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0',
                                  isCited ? 'bg-primary-500 text-white' : 'bg-surface-600 text-surface-400'
                                )}>
                                  {isCited ? <Award className="w-2.5 h-2.5" /> : src.index}
                                </span>
                                <span className="truncate max-w-[180px]">{src.title}</span>
                                <span className={clsx(
                                  'flex-shrink-0 font-semibold',
                                  scoreColor(src.score).split(' ').find(c => c.startsWith('text-')) || 'text-surface-400'
                                )}>
                                  {(src.score * 100).toFixed(0)}%
                                </span>
                                <ExternalLink className="w-2.5 h-2.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                              </a>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {/* Loading indicator */}
                    {msg.isStreaming && !msg.content && (
                      <div className="flex items-center gap-1.5 text-surface-400 pl-1">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span className="text-xs">{msg.statusMessage || 'Suche relevante Dokumente...'}</span>
                      </div>
                    )}

                    {/* Answer text */}
                    {msg.content && (
                      <div className="bg-surface-800 border border-surface-700/50 rounded-2xl px-4 py-3 text-sm text-surface-100 whitespace-pre-wrap leading-relaxed">
                        {msg.content}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="bg-surface-800/80 backdrop-blur border-t border-surface-700/50 p-4">
          <div className="flex items-end gap-2 max-w-4xl mx-auto">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Stelle eine Frage zu deinen Dokumenten..."
              rows={1}
              className="flex-1 resize-none px-4 py-2.5 bg-surface-700 border border-surface-600 rounded-xl text-sm text-surface-100 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-colors"
              style={{ minHeight: '42px', maxHeight: '120px' }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement
                target.style.height = 'auto'
                target.style.height = `${Math.min(target.scrollHeight, 120)}px`
              }}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              className="p-2.5 bg-primary-600 text-white rounded-xl hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
