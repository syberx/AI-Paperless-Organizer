import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Send, Plus, Trash2, MessageSquare, Database, Loader2,
  Search, Settings2, RefreshCw, FileText, ChevronRight,
  AlertCircle, CheckCircle2, ExternalLink,
} from 'lucide-react'
import clsx from 'clsx'
import * as ragApi from '../services/ragApi'
import { getPaperlessSettings } from '../services/api'

interface LocalMessage {
  role: 'user' | 'assistant'
  content: string
  sources?: ragApi.ChatSource[]
  isStreaming?: boolean
  statusMessage?: string
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
    <div className="flex h-[calc(100vh-4rem)] -m-6 -mt-2">
      {/* Sidebar */}
      <div
        className={clsx(
          'bg-white border-r border-gray-200 flex flex-col transition-all duration-200',
          sidebarOpen ? 'w-72' : 'w-0 overflow-hidden'
        )}
      >
        <div className="p-3 border-b border-gray-200">
          <button
            onClick={startNewChat}
            className="w-full flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
            Neuer Chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {sessions.length === 0 ? (
            <div className="p-4 text-sm text-gray-500 text-center">
              Noch keine Chats vorhanden
            </div>
          ) : (
            sessions.map((session) => (
              <div
                key={session.id}
                className={clsx(
                  'group flex items-center gap-2 px-3 py-2.5 cursor-pointer border-b border-gray-100 hover:bg-gray-50',
                  activeSessionId === session.id && 'bg-blue-50 border-l-2 border-l-blue-600'
                )}
                onClick={() => loadSession(session.id)}
              >
                <MessageSquare className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-black truncate">{session.title}</div>
                  <div className="text-xs text-gray-500">
                    {session.message_count} Nachrichten
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    deleteChat(session.id)
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 transition-all"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Index Status */}
        <div className="p-3 border-t border-gray-200 bg-gray-50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-black">Index</span>
            <div className="flex gap-1">
              <button
                onClick={() => startIndex(false)}
                disabled={indexStatus?.status === 'indexing'}
                className="p-1 text-gray-500 hover:text-blue-600 disabled:opacity-50"
                title="Neue Dokumente indexieren"
              >
                <RefreshCw className={clsx('w-3.5 h-3.5', indexStatus?.status === 'indexing' && 'animate-spin')} />
              </button>
              <button
                onClick={() => startIndex(true)}
                disabled={indexStatus?.status === 'indexing'}
                className="p-1 text-gray-500 hover:text-orange-600 disabled:opacity-50"
                title="Komplett neu indexieren"
              >
                <Database className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          {indexStatus && (
            <div className="text-xs text-gray-600 space-y-0.5">
              <div className="flex items-center gap-1">
                {indexStatus.status === 'indexing' ? (
                  <Loader2 className="w-3 h-3 animate-spin text-blue-500" />
                ) : indexStatus.status === 'completed' ? (
                  <CheckCircle2 className="w-3 h-3 text-green-500" />
                ) : indexStatus.status === 'error' ? (
                  <AlertCircle className="w-3 h-3 text-red-500" />
                ) : (
                  <Database className="w-3 h-3 text-gray-400" />
                )}
                <span className="text-black">
                  {indexStatus.indexed_documents}/{indexStatus.total_documents} Dokumente
                </span>
              </div>
              {indexStatus.chunks_in_index > 0 && (
                <div className="text-gray-500">{indexStatus.chunks_in_index} Chunks im Index</div>
              )}
              {indexStatus.status === 'indexing' && (
                <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1">
                  <div
                    className="bg-blue-600 h-1.5 rounded-full transition-all"
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
      <div className="flex-1 flex flex-col bg-gray-50">
        {/* Top bar */}
        <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-1.5 text-gray-500 hover:text-black rounded-lg hover:bg-gray-100"
            >
              <ChevronRight className={clsx('w-4 h-4 transition-transform', sidebarOpen && 'rotate-180')} />
            </button>
            <h2 className="text-sm font-semibold text-black">
              RAG Dokumenten-Chat
            </h2>
          </div>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={clsx(
              'p-1.5 rounded-lg transition-colors',
              showSettings ? 'text-blue-600 bg-blue-50' : 'text-gray-500 hover:text-black hover:bg-gray-100'
            )}
          >
            <Settings2 className="w-4 h-4" />
          </button>
        </div>

        {/* Settings Panel (collapsible) */}
        {showSettings && config && (
          <div className="bg-white border-b border-gray-200 p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div>
                <label className="block text-xs font-medium text-black mb-1">Embedding-Modell</label>
                <input
                  type="text"
                  value={config.embedding_model}
                  onChange={(e) => setConfig({ ...config, embedding_model: e.target.value })}
                  onBlur={() => saveConfig({ embedding_model: config.embedding_model })}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm text-black"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-black mb-1">Chat-Modell</label>
                <input
                  type="text"
                  value={config.chat_model}
                  onChange={(e) => setConfig({ ...config, chat_model: e.target.value })}
                  onBlur={() => saveConfig({ chat_model: config.chat_model })}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm text-black"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-black mb-1">BM25 Gewicht</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="1"
                  value={config.bm25_weight}
                  onChange={(e) => setConfig({ ...config, bm25_weight: parseFloat(e.target.value) })}
                  onBlur={() => saveConfig({ bm25_weight: config.bm25_weight })}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm text-black"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-black mb-1">Max. Quellen</label>
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={config.max_sources}
                  onChange={(e) => setConfig({ ...config, max_sources: parseInt(e.target.value) })}
                  onBlur={() => saveConfig({ max_sources: config.max_sources })}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm text-black"
                />
              </div>
            </div>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <Search className="w-12 h-12 text-gray-300 mb-4" />
              <h3 className="text-lg font-semibold text-black mb-2">Dokumenten-Chat</h3>
              <p className="text-sm text-gray-500 max-w-md">
                Stelle Fragen zu deinen Dokumenten. Der KI-Assistent durchsucht alle indexierten
                Dokumente und gibt dir Antworten mit Quellenangaben.
              </p>
              {!indexStatusLoaded ? (
                <div className="mt-4 flex items-center gap-2 text-sm text-gray-400">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Index-Status wird geladen...
                </div>
              ) : indexStatus && indexStatus.indexed_documents === 0 && indexStatus.status !== 'indexing' ? (
                <button
                  onClick={() => startIndex(false)}
                  className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm flex items-center gap-2"
                >
                  <Database className="w-4 h-4" />
                  Dokumente jetzt indexieren
                </button>
              ) : indexStatus && indexStatus.status === 'indexing' ? (
                <div className="mt-4 text-sm text-blue-600 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Indexierung läuft ({indexStatus.indexed_documents}/{indexStatus.total_documents})...
                </div>
              ) : null}
            </div>
          ) : (
            messages.map((msg, i) => (
              <div
                key={i}
                className={clsx('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}
              >
                <div
                  className={clsx(
                    'max-w-[80%] rounded-2xl px-4 py-3',
                    msg.role === 'user'
                      ? 'bg-blue-600 text-white'
                      : 'bg-white border border-gray-200 text-black'
                  )}
                >
                  <div className="text-sm whitespace-pre-wrap">{msg.content}</div>
                  {msg.isStreaming && !msg.content && (
                    <div className="flex items-center gap-1.5 text-gray-400">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span className="text-xs">{msg.statusMessage || 'Suche relevante Dokumente...'}</span>
                    </div>
                  )}
                  {msg.sources && msg.sources.length > 0 && (
                    <div className="mt-3 pt-2 border-t border-gray-100">
                      <div className="text-xs font-medium text-gray-500 mb-1.5">Quellen:</div>
                      <div className="space-y-1">
                        {msg.sources.map((src) => (
                          <a
                            key={src.index}
                            href={paperlessUrl ? `${paperlessUrl}/documents/${src.document_id}/details` : '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-start gap-1.5 text-xs text-gray-600 bg-gray-50 rounded px-2 py-1 hover:bg-blue-50 hover:text-blue-700 transition-colors cursor-pointer group"
                          >
                            <FileText className="w-3 h-3 mt-0.5 text-blue-500 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <span className="font-medium text-black group-hover:text-blue-700">[{src.index}] {src.title}</span>
                              <span className="text-gray-400 ml-1">(#{src.document_id}, Score: {src.score.toFixed(2)})</span>
                            </div>
                            <ExternalLink className="w-3 h-3 mt-0.5 text-gray-300 group-hover:text-blue-500 flex-shrink-0" />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="bg-white border-t border-gray-200 p-4">
          <div className="flex items-end gap-2 max-w-4xl mx-auto">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Stelle eine Frage zu deinen Dokumenten..."
              rows={1}
              className="flex-1 resize-none px-4 py-2.5 border border-gray-300 rounded-xl text-sm text-black focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
              className="p-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
