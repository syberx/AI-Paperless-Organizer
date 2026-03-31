import { ReactNode, useState, useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  Tags,
  FileText,
  Settings,
  MessageSquare,
  Menu,
  X,
  CheckCircle2,
  XCircle,
  Bug,
  Lock,
  ScanLine,
  AlertCircle,
  Sparkles,
  Eye,
  Loader2,
  Scan,
  Activity,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Ban,
  Clock,
  Github,
  Heart,
  Coffee,
  Search,
  Briefcase,
  ExternalLink
} from 'lucide-react'
import clsx from 'clsx'
import * as api from '../services/api'

interface LayoutProps {
  children: ReactNode
}

interface NavChild {
  name: string
  href: string
  icon: React.ComponentType<{ className?: string }>
}

interface NavItem {
  name: string
  href?: string
  icon: React.ComponentType<{ className?: string }>
  alwaysShow: boolean
  requiresDebug?: boolean
  isGroup?: boolean
  children?: NavChild[]
}

const baseNavigation: NavItem[] = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard, alwaysShow: true },
  { name: 'KI-Klassifizierer', href: '/classifier', icon: Sparkles, alwaysShow: true },
  {
    name: 'Aufräumen',
    icon: FolderOpen,
    alwaysShow: true,
    isGroup: true,
    children: [
      { name: '1. Korrespondenten', href: '/correspondents', icon: Users },
      { name: '2. Dokumententypen', href: '/document-types', icon: FileText },
      { name: '3. Tags', href: '/tags', icon: Tags },
      { name: 'Unerwünschte Dokumente', href: '/cleanup', icon: Ban },
    ],
  },
  { name: 'Prompts', href: '/prompts', icon: MessageSquare, alwaysShow: true },
  { name: 'Einstellungen', href: '/settings', icon: Settings, alwaysShow: true },
  { name: 'Dokumenten-Chat', href: '/rag-chat', icon: Search, alwaysShow: true },
  { name: 'OCR', href: '/ocr', icon: ScanLine, alwaysShow: true },
  { name: 'Debug', href: '/debug', icon: Bug, alwaysShow: false, requiresDebug: true },
]

export default function Layout({ children }: LayoutProps) {
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [paperlessConnected, setPaperlessConnected] = useState<boolean | null>(null)
  const [llmConfigured, setLlmConfigured] = useState<boolean | null>(null)
  const [showDebugMenu, setShowDebugMenu] = useState(false)
  const [isAuthenticated, setIsAuthenticated] = useState(true)
  const [passwordRequired, setPasswordRequired] = useState(false)
  const [passwordInput, setPasswordInput] = useState('')
  const [passwordError, setPasswordError] = useState(false)
  const [ollamaConnected, setOllamaConnected] = useState<boolean | null>(null)
  const [ollamaModelAvailable, setOllamaModelAvailable] = useState<boolean | null>(null)
  const [ollamaModel, setOllamaModel] = useState<string | null>(null)
  const [reviewCount, setReviewCount] = useState<number>(0)
  const [errorCount, setErrorCount] = useState<number>(0)

  // Collapsible group state – auto-open when a child route is active
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {}
    baseNavigation.filter(n => n.isGroup).forEach(n => {
      const childActive = n.children?.some(c => c.href === window.location.pathname) ?? false
      initial[n.name] = childActive
    })
    return initial
  })

  // Auto-expand group when navigating to a child route
  useEffect(() => {
    baseNavigation.filter(n => n.isGroup).forEach(n => {
      if (n.children?.some(c => c.href === location.pathname)) {
        setExpandedGroups(prev => ({ ...prev, [n.name]: true }))
      }
    })
  }, [location.pathname])
  const [batchOcrStatus, setBatchOcrStatus] = useState<api.BatchOcrStatus | null>(null)
  const [watchdogStatus, setWatchdogStatus] = useState<api.WatchdogStatus | null>(null)
  const [autoClassifyStatus, setAutoClassifyStatus] = useState<any>(null)
  const [ragIndexStatus, setRagIndexStatus] = useState<any>(null)
  const jobPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Poll active jobs (faster when something is running)
  const pollJobs = async () => {
    try {
      const [batch, watchdog, autoClassify, ragIdx] = await Promise.all([
        api.getBatchOcrStatus().catch(() => null),
        api.getWatchdogStatus().catch(() => null),
        api.fetchJson<any>('/classifier/auto-classify/status').catch(() => null),
        api.fetchJson<any>('/rag/index/status').catch(() => null),
      ])
      setBatchOcrStatus(batch)
      setWatchdogStatus(watchdog)
      setAutoClassifyStatus(autoClassify)
      setRagIndexStatus(ragIdx)
    } catch {
      // silent
    }
  }

  useEffect(() => {
    pollJobs()
    const schedule = () => {
      if (jobPollRef.current) clearInterval(jobPollRef.current)
      const isActive = batchOcrStatus?.running || watchdogStatus?.running || autoClassifyStatus?.running
      jobPollRef.current = setInterval(pollJobs, isActive ? 8000 : 30000)
    }
    schedule()
    return () => { if (jobPollRef.current) clearInterval(jobPollRef.current) }
  }, [batchOcrStatus?.running, watchdogStatus?.running, autoClassifyStatus?.running])

  useEffect(() => {
    // First check if password is required
    api.getAppSettings()
      .then(appSettings => {
        setShowDebugMenu(appSettings.show_debug_menu)

        // Check if password is required - this blocks EVERYTHING
        if (appSettings.password_enabled && appSettings.password_set) {
          const savedAuth = localStorage.getItem('app_authenticated')
          if (savedAuth !== 'true') {
            setPasswordRequired(true)
            setIsAuthenticated(false)
            return // Don't load anything else until authenticated!
          }
        }

        // Only load status after authentication
        Promise.all([
          api.getPaperlessStatus().catch(() => ({ connected: false })),
          api.getActiveLLMProvider().catch(() => ({ configured: false }))
        ]).then(([paperless, llm]) => {
          setPaperlessConnected(paperless.connected)
          setLlmConfigured(llm.configured)
        })
      })
      .catch(() => {
        // If settings fail, still try to load (first time setup)
        Promise.all([
          api.getPaperlessStatus().catch(() => ({ connected: false })),
          api.getActiveLLMProvider().catch(() => ({ configured: false }))
        ]).then(([paperless, llm]) => {
          setPaperlessConnected(paperless.connected)
          setLlmConfigured(llm.configured)
        })
      })

    // Poll for statuses
    const checkStatuses = async () => {
      try {
        const ocrStatus = await api.testOcrConnection()
        setOllamaConnected(ocrStatus.connected)
        setOllamaModelAvailable(ocrStatus.model_available)
        setOllamaModel(ocrStatus.requested_model || ocrStatus.model || null)

        const [queue, errors] = await Promise.all([
          api.getReviewQueue(),
          api.getOcrErrorList().catch(() => ({ count: 0 })),
        ])
        setReviewCount(queue.count)
        setErrorCount(errors.count ?? 0)
      } catch {
        setOllamaConnected(false)
        setOllamaModelAvailable(false)
      }
    }

    checkStatuses()
    const interval = setInterval(checkStatuses, 60000)
    return () => clearInterval(interval)
  }, [])

  const handlePasswordSubmit = async () => {
    try {
      const result = await api.verifyPassword(passwordInput)
      if (result.valid) {
        localStorage.setItem('app_authenticated', 'true')
        setIsAuthenticated(true)
        setPasswordRequired(false)
        setPasswordError(false)
        // Reload to load all data
        window.location.reload()
      } else {
        setPasswordError(true)
        setPasswordInput('')
      }
    } catch {
      setPasswordError(true)
    }
  }

  const navigation = baseNavigation.filter(item =>
    item.alwaysShow || (item.requiresDebug && showDebugMenu)
  )

  const isChildActive = (item: NavItem) =>
    item.children?.some(c => c.href === location.pathname) ?? false

  // Password login screen - BLOCKS EVERYTHING
  if (passwordRequired && !isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-surface-900 via-surface-800 to-surface-900 flex items-center justify-center p-4">
        <div className="card p-8 max-w-md w-full text-center border border-primary-500/30">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700 
                        flex items-center justify-center shadow-xl shadow-primary-600/40 mx-auto mb-6">
            <Lock className="w-10 h-10 text-white" />
          </div>
          <h1 className="font-display text-2xl font-bold text-surface-100 mb-2">
            AI Paperless Organizer
          </h1>
          <p className="text-surface-400 mb-6">
            Diese Anwendung ist passwortgeschützt
          </p>
          <input
            type="password"
            value={passwordInput}
            onChange={(e) => setPasswordInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handlePasswordSubmit()}
            placeholder="Passwort eingeben..."
            className={clsx("input mb-4 text-center", passwordError && "border-red-500 animate-shake")}
            autoFocus
          />
          {passwordError && (
            <p className="text-red-400 text-sm mb-4">❌ Falsches Passwort</p>
          )}
          <button
            onClick={handlePasswordSubmit}
            className="btn btn-primary w-full flex items-center justify-center gap-2"
          >
            <Lock className="w-4 h-4" />
            Entsperren
          </button>
          <p className="text-surface-500 text-xs mt-6">
            Passwort vergessen? Lösche die Datei <code className="text-surface-400">data/app.db</code> im Backend.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={clsx(
        'fixed lg:static inset-y-0 left-0 z-50 w-72 transform transition-transform duration-300 ease-in-out',
        'bg-surface-900/95 backdrop-blur-xl border-r border-surface-700/50',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      )}>
        {/* Logo */}
        <div className="h-16 flex items-center justify-between px-6 border-b border-surface-700/50">
          <Link to="/" className="flex items-center gap-3 group">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 
                          flex items-center justify-center shadow-lg shadow-primary-600/30
                          group-hover:shadow-primary-500/50 transition-shadow">
              <FileText className="w-5 h-5 text-white" />
            </div>
            <span className="font-display font-semibold text-lg text-surface-100">
              Organizer
            </span>
          </Link>
          <button
            className="lg:hidden p-2 hover:bg-surface-800 rounded-lg"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Status indicators */}
        <div className="px-4 py-4 space-y-2 border-b border-surface-700/50">
          <div className="flex items-center gap-2 text-sm">
            {paperlessConnected === null ? (
              <div className="w-2 h-2 rounded-full bg-surface-500 animate-pulse" />
            ) : paperlessConnected ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <XCircle className="w-4 h-4 text-red-400" />
            )}
            <span className={clsx(
              paperlessConnected ? 'text-emerald-400' : 'text-surface-400'
            )}>
              Paperless {paperlessConnected ? 'verbunden' : 'nicht verbunden'}
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            {llmConfigured === null ? (
              <div className="w-2 h-2 rounded-full bg-surface-500 animate-pulse" />
            ) : llmConfigured ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <XCircle className="w-4 h-4 text-amber-400" />
            )}
            <span className={clsx(
              llmConfigured ? 'text-emerald-400' : 'text-surface-400'
            )}>
              LLM {llmConfigured ? 'konfiguriert' : 'nicht konfiguriert'}
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            {ollamaConnected === null ? (
              <div className="w-2 h-2 rounded-full bg-surface-500 animate-pulse" />
            ) : (ollamaConnected && ollamaModelAvailable) ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : ollamaConnected ? (
              <AlertCircle className="w-4 h-4 text-amber-400" />
            ) : (
              <XCircle className="w-4 h-4 text-red-400" />
            )}
            <span className={clsx(
              (ollamaConnected && ollamaModelAvailable) ? 'text-emerald-400' :
                ollamaConnected ? 'text-amber-400' : 'text-surface-400'
            )} title={ollamaModel ? `Modell: ${ollamaModel}` : undefined}>
              Ollama {ollamaConnected ? (ollamaModelAvailable ? 'Online' : 'Modell fehlt') : 'Offline'}
            </span>
          </div>
          {reviewCount > 0 && (
            <Link
              to="/ocr?tab=review"
              onClick={() => setSidebarOpen(false)}
              className="flex items-center gap-2 text-sm mt-1 hover:opacity-80 transition-opacity"
            >
              <AlertCircle className="w-4 h-4 text-amber-400 animate-pulse flex-shrink-0" />
              <span className="text-amber-400 font-medium">
                {reviewCount} OCR-Prüfung{reviewCount !== 1 ? 'en' : ''} offen
              </span>
            </Link>
          )}
          {errorCount > 0 && (
            <Link
              to="/ocr?tab=errors"
              onClick={() => setSidebarOpen(false)}
              className="flex items-center gap-2 text-sm mt-1 hover:opacity-80 transition-opacity"
            >
              <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
              <span className="text-red-400 font-medium">
                {errorCount} OCR-Fehler
              </span>
            </Link>
          )}
        </div>

        {/* Active background jobs */}
        {(batchOcrStatus?.running || watchdogStatus?.enabled || autoClassifyStatus?.enabled || ragIndexStatus?.status === 'indexing') && (
          <div className="px-4 py-3 border-b border-surface-700/50 space-y-2">
            <div className="flex items-center gap-1.5 mb-1">
              <Activity className="w-3.5 h-3.5 text-surface-400" />
              <span className="text-xs font-semibold text-surface-400 uppercase tracking-wider">Aktive Jobs</span>
            </div>

            {/* Batch OCR running */}
            {batchOcrStatus?.running && (
              <Link to="/ocr" className="block group">
                <div className="flex items-center gap-2 text-sm">
                  <Loader2 className="w-4 h-4 text-primary-400 animate-spin flex-shrink-0" />
                  <span className="text-primary-300 font-medium truncate">
                    {batchOcrStatus.paused ? 'Batch OCR pausiert' : 'Batch OCR läuft'}
                  </span>
                </div>
                {batchOcrStatus.total > 0 && (
                  <div className="mt-1.5 ml-6">
                    <div className="flex justify-between text-xs text-surface-500 mb-1">
                      <span>{batchOcrStatus.processed}/{batchOcrStatus.total} Dokumente</span>
                      <span>{Math.round((batchOcrStatus.processed / batchOcrStatus.total) * 100)}%</span>
                    </div>
                    <div className="h-1 bg-surface-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary-500 rounded-full transition-all duration-500"
                        style={{ width: `${Math.round((batchOcrStatus.processed / batchOcrStatus.total) * 100)}%` }}
                      />
                    </div>
                    {batchOcrStatus.current_document && typeof batchOcrStatus.current_document === 'object' && (
                      <p className="text-xs text-surface-500 mt-1 truncate" title={(batchOcrStatus.current_document as {title: string}).title}>
                        {(batchOcrStatus.current_document as {title: string}).title}
                      </p>
                    )}
                  </div>
                )}
              </Link>
            )}

            {/* RAG Indexing */}
            {ragIndexStatus?.status === 'indexing' && (
              <Link to="/rag-chat" className="block group">
                <div className="flex items-center gap-2 text-sm">
                  <Loader2 className="w-4 h-4 text-violet-400 animate-spin flex-shrink-0" />
                  <span className="text-violet-300 font-medium truncate">Chat-Index wird aufgebaut</span>
                </div>
                {ragIndexStatus.total_documents > 0 && (
                  <div className="mt-1.5 ml-6">
                    <div className="flex justify-between text-xs text-surface-500 mb-1">
                      <span>{ragIndexStatus.indexed_documents}/{ragIndexStatus.total_documents} Dok.</span>
                      <span>{Math.round((ragIndexStatus.indexed_documents / ragIndexStatus.total_documents) * 100)}%</span>
                    </div>
                    <div className="h-1 bg-surface-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-violet-500 rounded-full transition-all duration-500"
                        style={{ width: `${Math.round((ragIndexStatus.indexed_documents / ragIndexStatus.total_documents) * 100)}%` }}
                      />
                    </div>
                  </div>
                )}
              </Link>
            )}

            {/* Auto-Classify */}
            {autoClassifyStatus?.enabled && (
              <Link to="/classifier" className="block group">
                <div className="flex items-center gap-2 text-sm">
                  {autoClassifyStatus.waiting_for ? (
                    <Clock className="w-4 h-4 text-yellow-400 flex-shrink-0" />
                  ) : autoClassifyStatus.running ? (
                    <Loader2 className="w-4 h-4 text-amber-400 animate-spin flex-shrink-0" />
                  ) : (
                    <Eye className="w-4 h-4 text-surface-400 flex-shrink-0" />
                  )}
                  <span className={clsx(
                    'font-medium truncate',
                    autoClassifyStatus.waiting_for ? 'text-yellow-400'
                      : autoClassifyStatus.running ? 'text-amber-300'
                      : 'text-surface-400'
                  )}>
                    {autoClassifyStatus.waiting_for
                      ? `Wartet auf ${autoClassifyStatus.waiting_for === 'ocr-batch' ? 'OCR' : autoClassifyStatus.waiting_for}`
                      : autoClassifyStatus.running
                        ? `Klassifiziert #${autoClassifyStatus.current_doc || '...'}`
                        : 'Klassifizierer aktiv'}
                  </span>
                </div>
                {(autoClassifyStatus.processed > 0 || autoClassifyStatus.reviewed > 0) && (
                  <p className="text-xs text-surface-500 ml-6 mt-0.5">
                    {autoClassifyStatus.processed} angewendet, {autoClassifyStatus.reviewed} zur Prüfung
                  </p>
                )}
              </Link>
            )}

            {/* Watchdog status */}
            {watchdogStatus?.enabled && !batchOcrStatus?.running && (
              <Link to="/ocr" className="block group">
                <div className="flex items-center gap-2 text-sm">
                  {watchdogStatus.running ? (
                    <Scan className="w-4 h-4 text-cyan-400 animate-pulse flex-shrink-0" />
                  ) : (
                    <Eye className="w-4 h-4 text-surface-400 flex-shrink-0" />
                  )}
                  <span className={clsx(
                    'font-medium truncate',
                    watchdogStatus.running ? 'text-cyan-300' : 'text-surface-400'
                  )}>
                    {watchdogStatus.running ? 'Watchdog prüft...' : 'Watchdog aktiv'}
                  </span>
                </div>
                {watchdogStatus.last_run && !watchdogStatus.running && (
                  <p className="text-xs text-surface-500 ml-6 mt-0.5">
                    Zuletzt: {new Date(watchdogStatus.last_run).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                )}
              </Link>
            )}

          </div>
        )}

        {/* Navigation */}
        <nav className="p-4 space-y-1">
          {navigation.map((item) => {
            const Icon = item.icon

            // --- Collapsible group ---
            if (item.isGroup && item.children) {
              const expanded = expandedGroups[item.name] ?? false
              const anyChildActive = isChildActive(item)

              return (
                <div key={item.name}>
                  {/* Group header button */}
                  <button
                    onClick={() => setExpandedGroups(prev => ({ ...prev, [item.name]: !prev[item.name] }))}
                    className={clsx(
                      'w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200',
                      anyChildActive
                        ? 'text-primary-400'
                        : 'text-surface-400 hover:text-surface-100 hover:bg-surface-800/50'
                    )}
                  >
                    <Icon className={clsx('w-5 h-5 flex-shrink-0', anyChildActive && 'text-primary-400')} />
                    <span className="font-medium flex-1 text-left">{item.name}</span>
                    {expanded
                      ? <ChevronDown className="w-4 h-4 text-surface-500" />
                      : <ChevronRight className="w-4 h-4 text-surface-500" />
                    }
                  </button>

                  {/* Sub-items */}
                  <div className={clsx(
                    'overflow-hidden transition-all duration-300 ease-in-out',
                    expanded ? 'max-h-80 opacity-100' : 'max-h-0 opacity-0'
                  )}>
                    <div className="ml-3 pl-3 border-l border-surface-700/60 mt-0.5 mb-1 space-y-0.5">
                      {item.children.map(child => {
                        const isActive = location.pathname === child.href
                        const ChildIcon = child.icon
                        return (
                          <Link
                            key={child.href}
                            to={child.href}
                            onClick={() => setSidebarOpen(false)}
                            className={clsx(
                              'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200',
                              isActive
                                ? 'bg-primary-600/20 text-primary-400 border border-primary-500/30'
                                : 'text-surface-400 hover:text-surface-100 hover:bg-surface-800/50'
                            )}
                          >
                            <ChildIcon className={clsx('w-4 h-4 flex-shrink-0', isActive && 'text-primary-400')} />
                            <span className="font-medium text-sm">{child.name}</span>
                          </Link>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )
            }

            // --- Normal nav item ---
            const isActive = location.pathname === item.href
            return (
              <Link
                key={item.name}
                to={item.href!}
                onClick={() => setSidebarOpen(false)}
                className={clsx(
                  'flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200',
                  isActive
                    ? 'bg-primary-600/20 text-primary-400 border border-primary-500/30'
                    : 'text-surface-400 hover:text-surface-100 hover:bg-surface-800/50'
                )}
              >
                <Icon className={clsx('w-5 h-5', isActive && 'text-primary-400')} />
                <span className="font-medium">{item.name}</span>
              </Link>
            )
          })}
        </nav>

        {/* KI-Beratung subtle link – hidden if user dismissed */}
        {localStorage.getItem('ki_loesungen_hidden') !== 'true' && (
          <div className="px-4 pb-2">
            <Link
              to="/ki-loesungen"
              onClick={() => setSidebarOpen(false)}
              className={clsx(
                'flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-200 group',
                location.pathname === '/ki-loesungen'
                  ? 'bg-primary-600/20 text-primary-400 border border-primary-500/30'
                  : 'text-surface-500 hover:text-primary-300 hover:bg-primary-500/10 border border-dashed border-surface-700/60 hover:border-primary-500/40'
              )}
            >
              <Briefcase className="w-4 h-4 flex-shrink-0 group-hover:text-primary-400 transition-colors" />
              <span className="text-sm font-medium flex-1">Individuelle KI-Lösungen</span>
              <ExternalLink className="w-3 h-3 opacity-40 group-hover:opacity-80 transition-opacity" />
            </Link>
          </div>
        )}

        {/* Footer */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-surface-700/50 space-y-2">
          {/* GitHub + Donate links */}
          <div className="flex gap-2">
            <a
              href="https://github.com/syberx/AI-Paperless-Organizer"
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg
                         text-xs text-surface-400 hover:text-surface-100 hover:bg-surface-800/60
                         border border-surface-700/40 hover:border-surface-600/60 transition-all duration-200"
              title="GitHub Repository"
            >
              <Github className="w-3.5 h-3.5" />
              <span>GitHub</span>
            </a>
            <a
              href="https://ko-fi.com/chriswilms"
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg
                         text-xs text-surface-400 hover:text-amber-300 hover:bg-amber-500/10
                         border border-surface-700/40 hover:border-amber-500/40 transition-all duration-200"
              title="Ko-fi – Unterstützen"
            >
              <Coffee className="w-3.5 h-3.5" />
              <span>Ko-fi</span>
            </a>
            <a
              href="https://www.paypal.com/paypalme/withmoney"
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg
                         text-xs text-surface-400 hover:text-blue-300 hover:bg-blue-500/10
                         border border-surface-700/40 hover:border-blue-500/40 transition-all duration-200"
              title="PayPal – Spenden"
            >
              <Heart className="w-3.5 h-3.5" />
              <span>Spende</span>
            </a>
          </div>

          <div className="text-xs text-surface-600 text-center">
            AI Paperless Organizer v1.1
          </div>

          {localStorage.getItem('app_authenticated') === 'true' && (
            <button
              onClick={() => {
                localStorage.removeItem('app_authenticated')
                window.location.reload()
              }}
              className="w-full text-xs text-surface-500 hover:text-red-400 transition-colors"
            >
              🔓 Abmelden
            </button>
          )}
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-h-screen">
        {/* Top bar */}
        <header className="h-16 flex items-center gap-4 px-6 border-b border-surface-700/50 bg-surface-900/50 backdrop-blur-sm">
          <button
            className="lg:hidden p-2 hover:bg-surface-800 rounded-lg"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="w-5 h-5" />
          </button>
          <h1 className="font-display font-semibold text-lg text-surface-100">
            {navigation.find(n => n.href === location.pathname)?.name
              || navigation.flatMap(n => n.children ?? []).find(c => c.href === location.pathname)?.name
              || 'Dashboard'}
          </h1>
        </header>

        {/* Page content */}
        <main className="flex-1 p-6 overflow-auto">
          <div className="animate-fade-in">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}

