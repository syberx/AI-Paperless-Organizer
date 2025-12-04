import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { 
  Users, Tags, FileText, ArrowRight, Sparkles, AlertCircle, CheckCircle2,
  TrendingUp, Clock, Zap, Trophy, Activity
} from 'lucide-react'
import clsx from 'clsx'
import * as api from '../services/api'

interface Stats {
  correspondents: number
  tags: number
  documentTypes: number
}

interface CleanupStats {
  correspondents: { merged: number; deleted: number }
  tags: { merged: number; deleted: number }
  document_types: { merged: number; deleted: number }
  total_items_cleaned: number
  total_documents_affected: number
  total_operations: number
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats>({ correspondents: 0, tags: 0, documentTypes: 0 })
  const [cleanupStats, setCleanupStats] = useState<CleanupStats | null>(null)
  const [timeSaved, setTimeSaved] = useState(0)
  const [statsLoading, setStatsLoading] = useState(true)
  const [paperlessConnected, setPaperlessConnected] = useState<boolean | null>(null)
  const [llmProvider, setLlmProvider] = useState<string | null>(null)
  const [recentOps, setRecentOps] = useState<any[]>([])

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setStatsLoading(true)
    
    // Fire all requests at once - don't wait for each other
    const paperlessPromise = api.getPaperlessStatus().catch(() => ({ connected: false }))
    const llmPromise = api.getActiveLLMProvider().catch(() => ({ configured: false }))
    const statsPromise = api.getStatisticsSummary().catch(() => null)
    const recentPromise = api.getRecentOperations(5).catch(() => [])
    
    // Update UI as soon as each result comes in
    paperlessPromise.then(status => setPaperlessConnected(status.connected))
    llmPromise.then(status => setLlmProvider(status.configured && 'display_name' in status ? status.display_name || null : null))
    recentPromise.then(ops => setRecentOps(ops))
    
    // Stats takes longest - update when ready
    statsPromise.then(async statsData => {
      if (statsData) {
        setStats({
          correspondents: statsData.current_counts.correspondents,
          tags: statsData.current_counts.tags,
          documentTypes: statsData.current_counts.document_types
        })
        setCleanupStats(statsData.cleanup_stats)
        setTimeSaved(statsData.savings.estimated_time_saved_minutes)
      }
      setStatsLoading(false)
    }).catch(() => setStatsLoading(false))
    
    // Wait for critical data (status indicators)
    await Promise.all([paperlessPromise, llmPromise])
  }

  const statCards = [
    { 
      step: 1,
      name: 'Korrespondenten', 
      count: stats.correspondents, 
      cleaned: cleanupStats ? cleanupStats.correspondents.merged + cleanupStats.correspondents.deleted : 0,
      icon: Users, 
      href: '/correspondents',
      color: 'from-blue-500 to-cyan-500',
      bgColor: 'bg-blue-500/10',
      borderColor: 'border-blue-500/30'
    },
    { 
      step: 2,
      name: 'Dokumententypen', 
      count: stats.documentTypes, 
      cleaned: cleanupStats ? cleanupStats.document_types.merged + cleanupStats.document_types.deleted : 0,
      icon: FileText, 
      href: '/document-types',
      color: 'from-amber-500 to-orange-500',
      bgColor: 'bg-amber-500/10',
      borderColor: 'border-amber-500/30'
    },
    { 
      step: 3,
      name: 'Tags', 
      count: stats.tags, 
      cleaned: cleanupStats ? cleanupStats.tags.merged + cleanupStats.tags.deleted : 0,
      icon: Tags, 
      href: '/tags',
      color: 'from-purple-500 to-pink-500',
      bgColor: 'bg-purple-500/10',
      borderColor: 'border-purple-500/30'
    },
  ]

  const totalCleaned = cleanupStats?.total_items_cleaned || 0

  return (
    <div className="space-y-8">
      {/* Welcome Section */}
      <div className="card p-8">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-display text-2xl font-bold text-surface-100 mb-2">
              Willkommen beim AI Paperless Organizer
            </h2>
            <p className="text-surface-400 max-w-2xl">
              Bereinige und konsolidiere deine Korrespondenten, Tags und Dokumententypen 
              mit Hilfe von KI-gestützter Ähnlichkeitserkennung.
            </p>
          </div>
          <div className="hidden md:block">
            <Sparkles className="w-12 h-12 text-primary-500 opacity-50" />
          </div>
        </div>
      </div>

      {/* Connection Status */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className={clsx(
          'card p-6 border-l-4',
          paperlessConnected 
            ? 'border-l-emerald-500' 
            : 'border-l-red-500'
        )}>
          <div className="flex items-center gap-4">
            {paperlessConnected ? (
              <CheckCircle2 className="w-8 h-8 text-emerald-400" />
            ) : (
              <AlertCircle className="w-8 h-8 text-red-400" />
            )}
            <div>
              <h3 className="font-semibold text-surface-100">Paperless-ngx</h3>
              <p className="text-sm text-surface-400">
                {paperlessConnected 
                  ? 'Verbindung hergestellt' 
                  : 'Nicht verbunden - bitte in Einstellungen konfigurieren'}
              </p>
            </div>
          </div>
        </div>

        <div className={clsx(
          'card p-6 border-l-4',
          llmProvider 
            ? 'border-l-emerald-500' 
            : 'border-l-amber-500'
        )}>
          <div className="flex items-center gap-4">
            {llmProvider ? (
              <CheckCircle2 className="w-8 h-8 text-emerald-400" />
            ) : (
              <AlertCircle className="w-8 h-8 text-amber-400" />
            )}
            <div>
              <h3 className="font-semibold text-surface-100">LLM Provider</h3>
              <p className="text-sm text-surface-400">
                {llmProvider 
                  ? `Aktiv: ${llmProvider}` 
                  : 'Nicht konfiguriert - bitte in Einstellungen aktivieren'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Grid with Cleanup Progress */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {statCards.map((card, index) => {
          const Icon = card.icon
          return (
            <Link
              key={card.name}
              to={card.href}
              className={clsx(
                'card p-6 group hover:scale-[1.02] transition-all duration-300',
                card.bgColor, card.borderColor, 'border'
              )}
              style={{ animationDelay: `${index * 100}ms` }}
            >
              <div className="flex items-center justify-between mb-4">
                <div className={clsx(
                  'w-12 h-12 rounded-xl flex items-center justify-center',
                  'bg-gradient-to-br', card.color,
                  statsLoading && 'animate-pulse'
                )}>
                  <Icon className="w-6 h-6 text-white" />
                </div>
                <ArrowRight className="w-5 h-5 text-surface-500 group-hover:text-surface-300 
                                      group-hover:translate-x-1 transition-all" />
              </div>
              <div>
                <p className="text-surface-400 text-sm mb-1">{card.name}</p>
                {statsLoading ? (
                  <div className="space-y-2">
                    <div className="h-9 w-20 bg-surface-700 rounded animate-pulse" />
                    <div className="h-4 w-16 bg-surface-700/50 rounded animate-pulse" />
                  </div>
                ) : (
                  <>
                    <p className="font-display text-3xl font-bold text-surface-100">
                      {card.count}
                    </p>
                    {card.cleaned > 0 && (
                      <p className="text-emerald-400 text-sm mt-2 flex items-center gap-1">
                        <TrendingUp className="w-4 h-4" />
                        {card.cleaned} bereinigt
                      </p>
                    )}
                  </>
                )}
              </div>
            </Link>
          )
        })}
      </div>

      {/* Cleanup Summary Cards */}
      {cleanupStats && totalCleaned > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="card p-4 bg-gradient-to-br from-blue-500/10 to-transparent border border-blue-500/20">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                <Users className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-surface-100">
                  {cleanupStats.correspondents.merged}
                </p>
                <p className="text-xs text-surface-400">Korr. zusammengeführt</p>
              </div>
            </div>
          </div>
          
          <div className="card p-4 bg-gradient-to-br from-purple-500/10 to-transparent border border-purple-500/20">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
                <Tags className="w-5 h-5 text-purple-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-surface-100">
                  {cleanupStats.tags.merged + cleanupStats.tags.deleted}
                </p>
                <p className="text-xs text-surface-400">Tags bereinigt</p>
              </div>
            </div>
          </div>
          
          <div className="card p-4 bg-gradient-to-br from-amber-500/10 to-transparent border border-amber-500/20">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
                <FileText className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-surface-100">
                  {cleanupStats.document_types.merged}
                </p>
                <p className="text-xs text-surface-400">Typen zusammengeführt</p>
              </div>
            </div>
          </div>
          
          <div className="card p-4 bg-gradient-to-br from-emerald-500/10 to-transparent border border-emerald-500/20">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                <Clock className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-surface-100">
                  {timeSaved}m
                </p>
                <p className="text-xs text-surface-400">Zeit gespart</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Recent Activity */}
      {recentOps.length > 0 && (
        <div className="card p-6">
          <h3 className="font-display font-semibold text-lg text-surface-100 mb-4 flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary-400" />
            Letzte Aktivitäten
          </h3>
          <div className="space-y-3">
            {recentOps.map((op, i) => (
              <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-surface-700/30">
                <div className="flex items-center gap-3">
                  {op.entity_type === 'correspondents' && <Users className="w-4 h-4 text-blue-400" />}
                  {op.entity_type === 'tags' && <Tags className="w-4 h-4 text-purple-400" />}
                  {op.entity_type === 'document_types' && <FileText className="w-4 h-4 text-amber-400" />}
                  <span className="text-surface-200">
                    {op.items_affected} {op.entity_type === 'correspondents' ? 'Korrespondenten' : 
                      op.entity_type === 'tags' ? 'Tags' : 'Dokumententypen'} {op.operation === 'merged' ? 'zusammengeführt' : 'gelöscht'}
                  </span>
                </div>
                <span className="text-xs text-surface-500">
                  {op.created_at ? new Date(op.created_at).toLocaleDateString('de-DE') : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Workflow & Quick Actions Combined */}
      <div className="card p-6 border border-primary-500/30 bg-gradient-to-br from-primary-500/5 to-transparent">
        <h3 className="font-display font-semibold text-lg text-surface-100 mb-6 flex items-center gap-2">
          <Zap className="w-5 h-5 text-primary-400" />
          Empfohlener Workflow
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Link 
            to="/correspondents"
            className="p-5 rounded-xl bg-surface-800/50 hover:bg-surface-700 
                     border border-blue-500/30 hover:border-blue-500/60
                     transition-all duration-200 group"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold shrink-0">
                1
              </div>
              <Users className="w-6 h-6 text-blue-400" />
            </div>
            <h4 className="font-medium text-surface-100 mb-1">
              Korrespondenten
            </h4>
            <p className="text-sm text-surface-400">
              Starte hier! Firmen/Personen sind die wichtigste Basis für alle Dokumente.
            </p>
          </Link>

          <Link 
            to="/document-types"
            className="p-5 rounded-xl bg-surface-800/50 hover:bg-surface-700 
                     border border-amber-500/30 hover:border-amber-500/60
                     transition-all duration-200 group"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold shrink-0">
                2
              </div>
              <FileText className="w-6 h-6 text-amber-400" />
            </div>
            <h4 className="font-medium text-surface-100 mb-1">
              Dokumententypen
            </h4>
            <p className="text-sm text-surface-400">
              Bereinige Typen wie Rechnung, Vertrag, etc. bevor du zu Tags gehst.
            </p>
          </Link>

          <Link 
            to="/tags/wizard"
            className="p-5 rounded-xl bg-surface-800/50 hover:bg-surface-700 
                     border border-purple-500/30 hover:border-purple-500/60
                     transition-all duration-200 group"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center font-bold shrink-0">
                3
              </div>
              <Tags className="w-6 h-6 text-purple-400" />
            </div>
            <h4 className="font-medium text-surface-100 mb-1">
              Tag Cleanup Wizard
            </h4>
            <p className="text-sm text-surface-400">
              5-Stufen KI-Bereinigung: Leere → Unsinnige → Korr. → Typen → Ähnliche
            </p>
          </Link>
        </div>
      </div>

      {/* Statistics Banner */}
      <div className={clsx(
        "relative overflow-hidden rounded-2xl p-8",
        totalCleaned > 0 
          ? "bg-gradient-to-br from-emerald-600 via-emerald-500 to-teal-500" 
          : "bg-gradient-to-br from-surface-700 via-surface-600 to-surface-700 border border-surface-600"
      )}>
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -translate-y-32 translate-x-32" />
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-white/10 rounded-full translate-y-16 -translate-x-16" />
        
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-4">
            <Trophy className={clsx("w-8 h-8", totalCleaned > 0 ? "text-yellow-300" : "text-surface-400")} />
            <h2 className={clsx("font-display text-2xl font-bold", totalCleaned > 0 ? "text-white" : "text-surface-200")}>
              {totalCleaned > 0 ? 'Deine Erfolge' : 'Statistiken'}
            </h2>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div className="text-center">
              <div className={clsx("text-4xl md:text-5xl font-display font-bold mb-1", totalCleaned > 0 ? "text-white" : "text-surface-100")}>
                {totalCleaned}
              </div>
              <div className={clsx("text-sm", totalCleaned > 0 ? "text-emerald-100" : "text-surface-400")}>Einträge bereinigt</div>
            </div>
            <div className="text-center">
              <div className={clsx("text-4xl md:text-5xl font-display font-bold mb-1", totalCleaned > 0 ? "text-white" : "text-surface-100")}>
                {cleanupStats?.total_documents_affected || 0}
              </div>
              <div className={clsx("text-sm", totalCleaned > 0 ? "text-emerald-100" : "text-surface-400")}>Dokumente aktualisiert</div>
            </div>
            <div className="text-center">
              <div className={clsx("text-4xl md:text-5xl font-display font-bold mb-1", totalCleaned > 0 ? "text-white" : "text-surface-100")}>
                {timeSaved}
              </div>
              <div className={clsx("text-sm", totalCleaned > 0 ? "text-emerald-100" : "text-surface-400")}>Minuten gespart</div>
            </div>
            <div className="text-center">
              <div className={clsx("text-4xl md:text-5xl font-display font-bold mb-1", totalCleaned > 0 ? "text-white" : "text-surface-100")}>
                {cleanupStats?.total_operations || 0}
              </div>
              <div className={clsx("text-sm", totalCleaned > 0 ? "text-emerald-100" : "text-surface-400")}>Operationen</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
