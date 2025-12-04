import { ReactNode, useState, useEffect } from 'react'
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
  Lock
} from 'lucide-react'
import clsx from 'clsx'
import * as api from '../services/api'

interface LayoutProps {
  children: ReactNode
}

const baseNavigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard, step: null, alwaysShow: true },
  { name: '1. Korrespondenten', href: '/correspondents', icon: Users, step: 1, alwaysShow: true },
  { name: '2. Dokumententypen', href: '/document-types', icon: FileText, step: 2, alwaysShow: true },
  { name: '3. Tags', href: '/tags', icon: Tags, step: 3, alwaysShow: true },
  { name: 'Prompts', href: '/prompts', icon: MessageSquare, step: null, alwaysShow: true },
  { name: 'Einstellungen', href: '/settings', icon: Settings, step: null, alwaysShow: true },
  { name: 'Debug', href: '/debug', icon: Bug, step: null, alwaysShow: false, requiresDebug: true },
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
        </div>

        {/* Navigation */}
        <nav className="p-4 space-y-1">
          {navigation.map((item) => {
            const isActive = location.pathname === item.href
            const Icon = item.icon
            
            return (
              <Link
                key={item.name}
                to={item.href}
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

        {/* Footer */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-surface-700/50">
          <div className="text-xs text-surface-500 text-center">
            AI Paperless Organizer v1.0
          </div>
          {localStorage.getItem('app_authenticated') === 'true' && (
            <button
              onClick={() => {
                localStorage.removeItem('app_authenticated')
                window.location.reload()
              }}
              className="mt-2 w-full text-xs text-surface-500 hover:text-red-400 transition-colors"
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
            {navigation.find(n => n.href === location.pathname)?.name || 'Dashboard'}
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

