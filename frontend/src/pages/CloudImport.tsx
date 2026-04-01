import { useState, useEffect, useCallback } from 'react'
import {
  Cloud, Plus, Trash2, Edit2, RefreshCw, CheckCircle2,
  XCircle, Loader2, Globe, HardDrive,
  ChevronDown, ChevronUp, Clock, FileText, Tag, User,
  ToggleLeft, ToggleRight, Eye, EyeOff, Link2,
} from 'lucide-react'
import clsx from 'clsx'
import * as api from '../services/api'

// ── Types ────────────────────────────────────────────────────────────────────

interface CloudSource {
  id: number
  name: string
  source_type: string
  enabled: boolean
  poll_interval_minutes: number
  webdav_url: string
  webdav_username: string
  webdav_password: string
  webdav_path: string
  rclone_remote: string
  rclone_path: string
  rclone_config: string
  local_path: string
  filename_prefix: string
  paperless_tag_ids: string
  paperless_correspondent_id: number | null
  paperless_document_type_id: number | null
  after_import_action: string
  last_checked_at: string | null
  last_status: string
  last_error: string
  files_imported: number
}

interface ImportLog {
  id: number
  source_id: number
  source_name: string
  file_name: string
  file_path: string
  import_status: string
  error_message: string
  imported_at: string
}

interface PaperlessMeta {
  tags: { id: number; name: string }[]
  correspondents: { id: number; name: string }[]
  documentTypes: { id: number; name: string }[]
}

interface SyncStatus {
  enabled: boolean
  running: boolean
  current_source_name: string | null
  current_file: string | null
  last_run: string | null
  files_imported_session: number
  errors_session: number
}

const EMPTY_SOURCE: Partial<CloudSource> = {
  name: '',
  source_type: 'webdav',
  enabled: true,
  poll_interval_minutes: 5,
  webdav_url: '',
  webdav_username: '',
  webdav_password: '',
  webdav_path: '/',
  rclone_remote: '',
  rclone_path: '/',
  rclone_config: '',
  local_path: '',
  filename_prefix: '',
  paperless_tag_ids: '[]',
  paperless_correspondent_id: null,
  paperless_document_type_id: null,
  after_import_action: 'keep',
}

// ── Source type icons/labels ─────────────────────────────────────────────────

function SourceTypeIcon({ type, className }: { type: string; className?: string }) {
  if (type === 'webdav') return <Globe className={clsx('text-blue-400', className)} />
  if (type === 'rclone') return <Cloud className={clsx('text-purple-400', className)} />
  return <HardDrive className={clsx('text-green-400', className)} />
}

function sourceTypeLabel(type: string) {
  if (type === 'webdav') return 'WebDAV / Nextcloud'
  if (type === 'rclone') return 'rclone (Google Drive, OneDrive…)'
  return 'Lokaler Ordner'
}

// ── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  if (status === 'syncing')
    return <span className="flex items-center gap-1 text-amber-400 text-xs"><Loader2 className="w-3 h-3 animate-spin" />Synchronisiert…</span>
  if (status === 'error')
    return <span className="flex items-center gap-1 text-red-400 text-xs"><XCircle className="w-3 h-3" />Fehler</span>
  if (status === 'idle')
    return <span className="flex items-center gap-1 text-green-400 text-xs"><CheckCircle2 className="w-3 h-3" />Bereit</span>
  return <span className="text-surface-500 text-xs">—</span>
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CloudImport() {
  const [sources, setSources] = useState<CloudSource[]>([])
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null)
  const [importLog, setImportLog] = useState<ImportLog[]>([])
  const [meta, setMeta] = useState<PaperlessMeta>({ tags: [], correspondents: [], documentTypes: [] })
  const [loading, setLoading] = useState(true)
  const [showLog, setShowLog] = useState(false)

  // Modal state
  const [modalOpen, setModalOpen] = useState(false)
  const [editSource, setEditSource] = useState<Partial<CloudSource>>(EMPTY_SOURCE)
  const [isEditing, setIsEditing] = useState(false)
  const [modalStep, setModalStep] = useState(1) // 1=Typ, 2=Verbindung, 3=Import
  const [modalSaving, setModalSaving] = useState(false)
  const [modalError, setModalError] = useState('')
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [testLoading, setTestLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showRcloneConfig, setShowRcloneConfig] = useState(false)

  // Sync action states
  const [syncingId, setSyncingId] = useState<number | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  // Tag selection in modal
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([])

  const loadAll = useCallback(async () => {
    try {
      const [srcs, status, log, tags, corrs, types] = await Promise.all([
        api.fetchJson<CloudSource[]>('/cloud-import/sources'),
        api.fetchJson<SyncStatus>('/cloud-import/status'),
        api.fetchJson<ImportLog[]>('/cloud-import/log?limit=50'),
        api.fetchJson<{ id: number; name: string }[]>('/cloud-import/paperless/tags'),
        api.fetchJson<{ id: number; name: string }[]>('/cloud-import/paperless/correspondents'),
        api.fetchJson<{ id: number; name: string }[]>('/cloud-import/paperless/document-types'),
      ])
      setSources(srcs)
      setSyncStatus(status)
      setImportLog(log)
      setMeta({ tags, correspondents: corrs, documentTypes: types })
    } catch (e) {
      console.error('Cloud Import: load failed', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadAll()
    const interval = setInterval(async () => {
      try {
        const [srcs, status] = await Promise.all([
          api.fetchJson<CloudSource[]>('/cloud-import/sources'),
          api.fetchJson<SyncStatus>('/cloud-import/status'),
        ])
        setSources(srcs)
        setSyncStatus(status)
      } catch { /* ignore */ }
    }, 8000)
    return () => clearInterval(interval)
  }, [loadAll])

  // ── Daemon toggle ───────────────────────────────────────────────────────

  const toggleDaemon = async () => {
    if (!syncStatus) return
    try {
      if (syncStatus.enabled) {
        await api.fetchJson('/cloud-import/stop', { method: 'POST' })
      } else {
        await api.fetchJson('/cloud-import/start', { method: 'POST' })
      }
      const status = await api.fetchJson<SyncStatus>('/cloud-import/status')
      setSyncStatus(status)
    } catch (e: any) {
      alert('Fehler: ' + e.message)
    }
  }

  // ── Source actions ──────────────────────────────────────────────────────

  const openAdd = () => {
    setEditSource({ ...EMPTY_SOURCE })
    setSelectedTagIds([])
    setIsEditing(false)
    setModalStep(1)
    setModalError('')
    setTestResult(null)
    setModalOpen(true)
  }

  const openEdit = (source: CloudSource) => {
    setEditSource({ ...source, webdav_password: '' })
    try {
      setSelectedTagIds(JSON.parse(source.paperless_tag_ids || '[]'))
    } catch {
      setSelectedTagIds([])
    }
    setIsEditing(true)
    setModalStep(1)
    setModalError('')
    setTestResult(null)
    setModalOpen(true)
  }

  const saveSource = async () => {
    if (!editSource.name?.trim()) {
      setModalError('Bitte einen Namen vergeben.')
      return
    }
    setModalSaving(true)
    setModalError('')
    try {
      const payload = {
        ...editSource,
        paperless_tag_ids: JSON.stringify(selectedTagIds),
      }
      if (isEditing && editSource.id) {
        await api.fetchJson(`/cloud-import/sources/${editSource.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        })
      } else {
        await api.fetchJson('/cloud-import/sources', {
          method: 'POST',
          body: JSON.stringify(payload),
        })
      }
      setModalOpen(false)
      await loadAll()
    } catch (e: any) {
      setModalError(e.message)
    } finally {
      setModalSaving(false)
    }
  }

  const deleteSource = async (id: number) => {
    if (!confirm('Quelle wirklich löschen? Der Import-Verlauf bleibt erhalten.')) return
    setDeletingId(id)
    try {
      await api.fetchJson(`/cloud-import/sources/${id}`, { method: 'DELETE' })
      await loadAll()
    } catch (e: any) {
      alert('Fehler beim Löschen: ' + e.message)
    } finally {
      setDeletingId(null)
    }
  }

  const syncNow = async (id: number) => {
    setSyncingId(id)
    try {
      const res = await api.fetchJson<any>(`/cloud-import/sources/${id}/sync`, { method: 'POST' })
      alert(`Synchronisation abgeschlossen:\n${res.imported} importiert, ${res.skipped} übersprungen, ${res.errors} Fehler`)
      await loadAll()
      const log = await api.fetchJson<ImportLog[]>('/cloud-import/log?limit=50')
      setImportLog(log)
    } catch (e: any) {
      alert('Fehler bei Synchronisation: ' + e.message)
    } finally {
      setSyncingId(null)
    }
  }

  const testConnection = async () => {
    if (!editSource.id && !editSource.source_type) return
    setTestLoading(true)
    setTestResult(null)
    // Save first if new, then test — or test from temp object via dedicated endpoint
    // For simplicity: if editing, test saved source; if new, show hint to save first
    if (!isEditing || !editSource.id) {
      setTestResult({ ok: false, message: 'Bitte erst speichern, dann testen.' })
      setTestLoading(false)
      return
    }
    try {
      const res = await api.fetchJson<{ ok: boolean; message: string }>(`/cloud-import/sources/${editSource.id}/test`, { method: 'POST' })
      setTestResult(res)
    } catch (e: any) {
      setTestResult({ ok: false, message: e.message })
    } finally {
      setTestLoading(false)
    }
  }

  const toggleTag = (tagId: number) => {
    setSelectedTagIds(prev =>
      prev.includes(tagId) ? prev.filter(id => id !== tagId) : [...prev, tagId]
    )
  }

  // ── Render ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-surface-400">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        Lade Cloud-Import…
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Cloud className="w-7 h-7 text-primary-400" />
          <div>
            <h1 className="text-xl font-semibold text-white">Cloud Sync / Import</h1>
            <p className="text-sm text-surface-400">Dokumente aus WebDAV, Google Drive, OneDrive oder lokalen Ordnern importieren</p>
          </div>
        </div>
        <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-500 text-white rounded-lg text-sm font-medium transition-colors">
          <Plus className="w-4 h-4" />
          Quelle hinzufügen
        </button>
      </div>

      {/* Sync Daemon Status */}
      <div className={clsx(
        'rounded-xl border p-4 flex items-center justify-between',
        syncStatus?.enabled ? 'bg-green-950/30 border-green-800/40' : 'bg-surface-800 border-surface-700'
      )}>
        <div className="flex items-center gap-3">
          {syncStatus?.running ? (
            <Loader2 className="w-5 h-5 text-amber-400 animate-spin" />
          ) : syncStatus?.enabled ? (
            <CheckCircle2 className="w-5 h-5 text-green-400" />
          ) : (
            <Clock className="w-5 h-5 text-surface-400" />
          )}
          <div>
            <p className="text-sm font-medium text-white">
              {syncStatus?.running
                ? `Synchronisiert: ${syncStatus.current_source_name || '…'} – ${syncStatus.current_file || '…'}`
                : syncStatus?.enabled
                  ? 'Sync-Daemon aktiv – prüft Quellen automatisch'
                  : 'Sync-Daemon gestoppt'}
            </p>
            {syncStatus?.last_run && (
              <p className="text-xs text-surface-500">
                Letzter Lauf: {new Date(syncStatus.last_run).toLocaleString('de-DE')}
                {syncStatus.files_imported_session > 0 && ` · ${syncStatus.files_imported_session} Dateien importiert`}
              </p>
            )}
          </div>
        </div>
        <button
          onClick={toggleDaemon}
          className={clsx(
            'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
            syncStatus?.enabled
              ? 'bg-red-900/40 hover:bg-red-900/60 text-red-300 border border-red-800/40'
              : 'bg-green-900/40 hover:bg-green-900/60 text-green-300 border border-green-800/40'
          )}
        >
          {syncStatus?.enabled ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
          {syncStatus?.enabled ? 'Stoppen' : 'Starten'}
        </button>
      </div>

      {/* Sources list */}
      {sources.length === 0 ? (
        <div className="text-center py-16 text-surface-400 border border-dashed border-surface-700 rounded-xl">
          <Cloud className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">Noch keine Quellen konfiguriert</p>
          <p className="text-sm mt-1">Klicke auf „Quelle hinzufügen" um loszulegen.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sources.map(source => (
            <SourceCard
              key={source.id}
              source={source}
              meta={meta}
              onEdit={() => openEdit(source)}
              onDelete={() => deleteSource(source.id)}
              onSync={() => syncNow(source.id)}
              syncing={syncingId === source.id}
              deleting={deletingId === source.id}
            />
          ))}
        </div>
      )}

      {/* Import log */}
      <div className="border border-surface-700 rounded-xl overflow-hidden">
        <button
          onClick={() => setShowLog(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3 bg-surface-800 hover:bg-surface-750 text-sm font-medium text-white"
        >
          <span className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-surface-400" />
            Import-Verlauf
            {importLog.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 bg-surface-700 text-surface-300 rounded text-xs">{importLog.length}</span>
            )}
          </span>
          {showLog ? <ChevronUp className="w-4 h-4 text-surface-400" /> : <ChevronDown className="w-4 h-4 text-surface-400" />}
        </button>

        {showLog && (
          <div className="divide-y divide-surface-700/50 max-h-80 overflow-y-auto">
            {importLog.length === 0 ? (
              <p className="text-center py-8 text-surface-500 text-sm">Noch keine Importe.</p>
            ) : (
              importLog.map(entry => (
                <div key={entry.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-800/50">
                  {entry.import_status === 'success'
                    ? <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
                    : <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                  }
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{entry.file_name}</p>
                    <p className="text-xs text-surface-500 truncate">
                      {entry.source_name} · {entry.imported_at ? new Date(entry.imported_at).toLocaleString('de-DE') : '—'}
                    </p>
                  </div>
                  {entry.error_message && (
                    <p className="text-xs text-red-400 truncate max-w-xs">{entry.error_message}</p>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Modal */}
      {modalOpen && (
        <SourceModal
          source={editSource}
          isEditing={isEditing}
          step={modalStep}
          setStep={setModalStep}
          meta={meta}
          selectedTagIds={selectedTagIds}
          toggleTag={toggleTag}
          onChange={(key, val) => setEditSource(prev => ({ ...prev, [key]: val }))}
          onSave={saveSource}
          onClose={() => setModalOpen(false)}
          saving={modalSaving}
          error={modalError}
          testResult={testResult}
          testLoading={testLoading}
          onTest={testConnection}
          showPassword={showPassword}
          setShowPassword={setShowPassword}
          showRcloneConfig={showRcloneConfig}
          setShowRcloneConfig={setShowRcloneConfig}
        />
      )}
    </div>
  )
}

// ── Source Card ───────────────────────────────────────────────────────────────

function SourceCard({
  source, meta, onEdit, onDelete, onSync, syncing, deleting,
}: {
  source: CloudSource
  meta: PaperlessMeta
  onEdit: () => void
  onDelete: () => void
  onSync: () => void
  syncing: boolean
  deleting: boolean
}) {
  const tagNames = (() => {
    try {
      const ids: number[] = JSON.parse(source.paperless_tag_ids || '[]')
      return ids.map(id => meta.tags.find(t => t.id === id)?.name).filter(Boolean).join(', ')
    } catch { return '' }
  })()

  const corrName = source.paperless_correspondent_id
    ? meta.correspondents.find(c => c.id === source.paperless_correspondent_id)?.name
    : null
  const typeName = source.paperless_document_type_id
    ? meta.documentTypes.find(t => t.id === source.paperless_document_type_id)?.name
    : null

  return (
    <div className={clsx(
      'rounded-xl border p-4 transition-colors',
      source.enabled ? 'bg-surface-800 border-surface-700' : 'bg-surface-900 border-surface-800 opacity-60'
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <SourceTypeIcon type={source.source_type} className="w-5 h-5 flex-shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-medium text-white truncate">{source.name}</p>
              <StatusBadge status={source.last_status} />
            </div>
            <p className="text-xs text-surface-500 truncate mt-0.5">
              {sourceTypeLabel(source.source_type)}
              {source.source_type === 'webdav' && source.webdav_url && ` · ${source.webdav_url}`}
              {source.source_type === 'rclone' && source.rclone_remote && ` · ${source.rclone_remote}:${source.rclone_path}`}
              {source.source_type === 'local' && source.local_path && ` · ${source.local_path}`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={onSync}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-700 hover:bg-surface-600 text-white rounded-lg text-xs transition-colors disabled:opacity-50"
          >
            {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Jetzt sync
          </button>
          <button onClick={onEdit} className="p-1.5 text-surface-400 hover:text-white hover:bg-surface-700 rounded-lg transition-colors">
            <Edit2 className="w-4 h-4" />
          </button>
          <button
            onClick={onDelete}
            disabled={deleting}
            className="p-1.5 text-surface-400 hover:text-red-400 hover:bg-red-950/30 rounded-lg transition-colors"
          >
            {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Meta info row */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-surface-500">
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          alle {source.poll_interval_minutes} Min.
        </span>
        {source.files_imported > 0 && (
          <span className="flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-green-500" />
            {source.files_imported} importiert
          </span>
        )}
        {source.filename_prefix && (
          <span className="text-surface-400">Präfix: <span className="text-white">{source.filename_prefix}</span></span>
        )}
        {tagNames && (
          <span className="flex items-center gap-1">
            <Tag className="w-3 h-3" />
            {tagNames}
          </span>
        )}
        {corrName && (
          <span className="flex items-center gap-1">
            <User className="w-3 h-3" />
            {corrName}
          </span>
        )}
        {typeName && (
          <span className="flex items-center gap-1">
            <FileText className="w-3 h-3" />
            {typeName}
          </span>
        )}
        {source.after_import_action === 'delete' && (
          <span className="text-orange-400">Quelldatei löschen</span>
        )}
        {source.last_checked_at && (
          <span>Zuletzt: {new Date(source.last_checked_at).toLocaleString('de-DE')}</span>
        )}
      </div>

      {source.last_error && (
        <div className="mt-2 px-3 py-2 bg-red-950/30 border border-red-800/40 rounded-lg text-xs text-red-400">
          {source.last_error}
        </div>
      )}
    </div>
  )
}

// ── Source Modal ──────────────────────────────────────────────────────────────

function SourceModal({
  source, isEditing, step, setStep, meta, selectedTagIds, toggleTag,
  onChange, onSave, onClose, saving, error,
  testResult, testLoading, onTest,
  showPassword, setShowPassword, showRcloneConfig, setShowRcloneConfig,
}: {
  source: Partial<CloudSource>
  isEditing: boolean
  step: number
  setStep: (n: number) => void
  meta: PaperlessMeta
  selectedTagIds: number[]
  toggleTag: (id: number) => void
  onChange: (key: string, val: any) => void
  onSave: () => void
  onClose: () => void
  saving: boolean
  error: string
  testResult: { ok: boolean; message: string } | null
  testLoading: boolean
  onTest: () => void
  showPassword: boolean
  setShowPassword: (v: boolean) => void
  showRcloneConfig: boolean
  setShowRcloneConfig: (v: boolean) => void
}) {
  const steps = ['Typ wählen', 'Verbindung', 'Import-Einstellungen']

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-surface-900 border border-surface-700 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="px-6 py-4 border-b border-surface-700 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">
            {isEditing ? 'Quelle bearbeiten' : 'Quelle hinzufügen'}
          </h2>
          <button onClick={onClose} className="text-surface-400 hover:text-white p-1">✕</button>
        </div>

        {/* Step indicator */}
        <div className="px-6 pt-4 flex gap-2">
          {steps.map((label, i) => (
            <button
              key={i}
              onClick={() => i < step - 1 && setStep(i + 1)}
              className={clsx(
                'flex-1 text-center text-xs py-1.5 rounded-lg font-medium transition-colors',
                step === i + 1
                  ? 'bg-primary-600 text-white'
                  : step > i + 1
                    ? 'bg-green-900/40 text-green-300 cursor-pointer'
                    : 'bg-surface-800 text-surface-500'
              )}
            >
              {i + 1}. {label}
            </button>
          ))}
        </div>

        <div className="px-6 py-4 space-y-4">
          {/* Step 1: Type */}
          {step === 1 && (
            <div className="space-y-3">
              <p className="text-sm text-surface-400">Wähle den Typ der Cloud-Quelle:</p>
              {[
                { type: 'webdav', icon: <Globe className="w-5 h-5 text-blue-400" />, label: 'WebDAV / Nextcloud', desc: 'Nextcloud, ownCloud, Box, HiDrive, GMX Cloud – kein API-Key nötig' },
                { type: 'rclone', icon: <Cloud className="w-5 h-5 text-purple-400" />, label: 'Google Drive / OneDrive / Dropbox', desc: 'Einfach anmelden – wird automatisch eingerichtet' },
                { type: 'local', icon: <HardDrive className="w-5 h-5 text-green-400" />, label: 'Lokaler Ordner', desc: 'Docker-Volume oder gemounteter Netzwerkpfad' },
              ].map(opt => (
                <button
                  key={opt.type}
                  onClick={() => onChange('source_type', opt.type)}
                  className={clsx(
                    'w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all',
                    source.source_type === opt.type
                      ? 'border-primary-500 bg-primary-900/30'
                      : 'border-surface-700 hover:border-surface-500 bg-surface-800'
                  )}
                >
                  {opt.icon}
                  <div>
                    <p className="font-medium text-white text-sm">{opt.label}</p>
                    <p className="text-xs text-surface-400 mt-0.5">{opt.desc}</p>
                  </div>
                </button>
              ))}

              <div>
                <label className="block text-xs text-surface-400 mb-1">Name der Quelle</label>
                <input
                  type="text"
                  value={source.name || ''}
                  onChange={e => onChange('name', e.target.value)}
                  placeholder="z.B. Nextcloud Scans"
                  className="w-full px-3 py-2 bg-surface-800 border border-surface-600 rounded-lg text-white text-sm focus:border-primary-500 focus:outline-none"
                />
              </div>
            </div>
          )}

          {/* Step 2: Connection */}
          {step === 2 && (
            <div className="space-y-4">
              {/* WebDAV */}
              {source.source_type === 'webdav' && (
                <>
                  <Field label="WebDAV-URL" required>
                    <input
                      type="url"
                      value={source.webdav_url || ''}
                      onChange={e => onChange('webdav_url', e.target.value)}
                      placeholder="https://nextcloud.example.com/remote.php/dav/files/username"
                      className={inputCls}
                    />
                    <p className="text-xs text-surface-500 mt-1">Nextcloud: <code className="text-primary-400">https://DEINE-URL/remote.php/dav/files/BENUTZERNAME</code></p>
                  </Field>
                  <Field label="Ordner / Pfad">
                    <input
                      type="text"
                      value={source.webdav_path || '/'}
                      onChange={e => onChange('webdav_path', e.target.value)}
                      placeholder="/Scans"
                      className={inputCls}
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Benutzername">
                      <input type="text" value={source.webdav_username || ''} onChange={e => onChange('webdav_username', e.target.value)} className={inputCls} />
                    </Field>
                    <Field label="Passwort">
                      <div className="relative">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          value={source.webdav_password || ''}
                          onChange={e => onChange('webdav_password', e.target.value)}
                          placeholder={isEditing ? '(unverändert)' : ''}
                          className={clsx(inputCls, 'pr-8')}
                        />
                        <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-2 top-1/2 -translate-y-1/2 text-surface-400">
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </Field>
                  </div>
                </>
              )}

              {/* rclone */}
              {source.source_type === 'rclone' && (
                <RcloneConnectFlow
                  source={source}
                  onChange={onChange}
                  showRcloneConfig={showRcloneConfig}
                  setShowRcloneConfig={setShowRcloneConfig}
                />
              )}

              {/* Local */}
              {source.source_type === 'local' && (
                <Field label="Lokaler Pfad" required>
                  <input
                    type="text"
                    value={source.local_path || ''}
                    onChange={e => onChange('local_path', e.target.value)}
                    placeholder="/app/data/scan-input"
                    className={inputCls}
                  />
                  <p className="text-xs text-surface-500 mt-1">Docker-Volume-Pfad im Container, z.B. <code className="text-primary-400">/app/data/scan-input</code></p>
                </Field>
              )}

              {/* Test connection */}
              {isEditing && (
                <div className="pt-2">
                  <button
                    onClick={onTest}
                    disabled={testLoading}
                    className="flex items-center gap-2 px-3 py-2 bg-surface-700 hover:bg-surface-600 text-sm text-white rounded-lg transition-colors"
                  >
                    {testLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                    Verbindung testen
                  </button>
                  {testResult && (
                    <div className={clsx(
                      'mt-2 px-3 py-2 rounded-lg text-xs flex items-center gap-2',
                      testResult.ok ? 'bg-green-950/30 border border-green-800/40 text-green-300' : 'bg-red-950/30 border border-red-800/40 text-red-300'
                    )}>
                      {testResult.ok ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" /> : <XCircle className="w-3.5 h-3.5 flex-shrink-0" />}
                      {testResult.message}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Step 3: Import settings */}
          {step === 3 && (
            <div className="space-y-4">
              <Field label="Dateiname-Präfix" hint="Wird dem Dateinamen vorangestellt, z.B. 'SCAN-' → 'SCAN-rechnung.pdf'">
                <input
                  type="text"
                  value={source.filename_prefix || ''}
                  onChange={e => onChange('filename_prefix', e.target.value)}
                  placeholder="z.B. SCAN- oder NC-"
                  className={inputCls}
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Abruf-Intervall">
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={1440}
                      value={source.poll_interval_minutes ?? 5}
                      onChange={e => onChange('poll_interval_minutes', parseInt(e.target.value) || 5)}
                      className={clsx(inputCls, 'w-20')}
                    />
                    <span className="text-sm text-surface-400">Minuten</span>
                  </div>
                </Field>

                <Field label="Nach Import">
                  <select
                    value={source.after_import_action || 'keep'}
                    onChange={e => onChange('after_import_action', e.target.value)}
                    className={inputCls}
                  >
                    <option value="keep">Quelldatei behalten</option>
                    <option value="delete">Quelldatei löschen</option>
                  </select>
                </Field>
              </div>

              <Field label="Tags zuweisen" hint="Werden allen importierten Dokumenten in Paperless hinzugefügt">
                {meta.tags.length === 0 ? (
                  <p className="text-xs text-surface-500">Keine Tags in Paperless gefunden.</p>
                ) : (
                  <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                    {meta.tags.map(tag => (
                      <button
                        key={tag.id}
                        onClick={() => toggleTag(tag.id)}
                        className={clsx(
                          'px-2 py-1 rounded-full text-xs border transition-colors',
                          selectedTagIds.includes(tag.id)
                            ? 'bg-primary-600 border-primary-500 text-white'
                            : 'bg-surface-800 border-surface-600 text-surface-300 hover:border-surface-400'
                        )}
                      >
                        {tag.name}
                      </button>
                    ))}
                  </div>
                )}
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Korrespondent">
                  <select
                    value={source.paperless_correspondent_id ?? ''}
                    onChange={e => onChange('paperless_correspondent_id', e.target.value ? parseInt(e.target.value) : null)}
                    className={inputCls}
                  >
                    <option value="">— kein Korrespondent —</option>
                    {meta.correspondents.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </Field>

                <Field label="Dokumententyp">
                  <select
                    value={source.paperless_document_type_id ?? ''}
                    onChange={e => onChange('paperless_document_type_id', e.target.value ? parseInt(e.target.value) : null)}
                    className={inputCls}
                  >
                    <option value="">— kein Typ —</option>
                    {meta.documentTypes.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </Field>
              </div>

              <Field label="Quelle aktiviert">
                <button
                  onClick={() => onChange('enabled', !source.enabled)}
                  className={clsx(
                    'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm border transition-colors',
                    source.enabled
                      ? 'bg-green-900/30 border-green-700/40 text-green-300'
                      : 'bg-surface-800 border-surface-600 text-surface-400'
                  )}
                >
                  {source.enabled ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                  {source.enabled ? 'Aktiv' : 'Deaktiviert'}
                </button>
              </Field>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="px-3 py-2 bg-red-950/30 border border-red-800/40 rounded-lg text-sm text-red-400">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-surface-700 flex justify-between">
          <div className="flex gap-2">
            {step > 1 && (
              <button onClick={() => setStep(step - 1)} className="px-4 py-2 bg-surface-700 hover:bg-surface-600 text-white rounded-lg text-sm transition-colors">
                Zurück
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 bg-surface-800 hover:bg-surface-700 text-surface-300 rounded-lg text-sm transition-colors">
              Abbrechen
            </button>
            {step < 3 ? (
              <button
                onClick={() => setStep(step + 1)}
                disabled={step === 1 && !source.name?.trim()}
                className="px-4 py-2 bg-primary-600 hover:bg-primary-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                Weiter
              </button>
            ) : (
              <button
                onClick={onSave}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {isEditing ? 'Speichern' : 'Quelle anlegen'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const inputCls = 'w-full px-3 py-2 bg-surface-800 border border-surface-600 rounded-lg text-white text-sm focus:border-primary-500 focus:outline-none'

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-surface-400 mb-1">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-surface-500 mt-1">{hint}</p>}
    </div>
  )
}

// ── rclone OAuth Connect Flow ────────────────────────────────────────────────

type RcloneProvider = 'gdrive' | 'onedrive' | 'dropbox'

const RCLONE_PROVIDERS: { id: RcloneProvider; label: string; color: string }[] = [
  { id: 'gdrive', label: 'Google Drive', color: 'text-blue-400' },
  { id: 'onedrive', label: 'OneDrive', color: 'text-sky-400' },
  { id: 'dropbox', label: 'Dropbox', color: 'text-indigo-400' },
]

function RcloneConnectFlow({
  source, onChange, showRcloneConfig, setShowRcloneConfig,
}: {
  source: Partial<CloudSource>
  onChange: (key: string, val: any) => void
  showRcloneConfig: boolean
  setShowRcloneConfig: (v: boolean) => void
}) {
  const [selectedProvider, setSelectedProvider] = useState<RcloneProvider>('gdrive')
  const [authStatus, setAuthStatus] = useState<'idle' | 'starting' | 'waiting' | 'success' | 'error'>('idle')
  const [authUrl, setAuthUrl] = useState<string | null>(null)
  const [authError, setAuthError] = useState('')
  const [polling, setPolling] = useState(false)

  const startAuth = async () => {
    setAuthStatus('starting')
    setAuthUrl(null)
    setAuthError('')
    try {
      const res = await api.fetchJson<any>(`/cloud-import/rclone/authorize?provider=${selectedProvider}`, { method: 'POST' })
      if (res.auth_url) {
        setAuthUrl(res.auth_url)
        setAuthStatus('waiting')
        startPolling()
      } else {
        setAuthStatus('waiting')
        startPolling()
      }
    } catch (e: any) {
      setAuthError(e.message)
      setAuthStatus('error')
    }
  }

  const startPolling = () => {
    setPolling(true)
    const iv = setInterval(async () => {
      try {
        const status = await api.fetchJson<any>('/cloud-import/rclone/authorize/status')
        if (status.auth_url && !authUrl) {
          setAuthUrl(status.auth_url)
        }
        if (status.status === 'success' && status.token) {
          clearInterval(iv)
          setPolling(false)
          setAuthStatus('success')

          // Auto-fill source fields
          const providerInfo = RCLONE_PROVIDERS.find(p => p.id === selectedProvider)
          const remoteName = selectedProvider === 'gdrive' ? 'gdrive' : selectedProvider === 'onedrive' ? 'onedrive' : 'dropbox'
          const rcloneType = selectedProvider === 'gdrive' ? 'drive' : selectedProvider
          const configContent = `[${remoteName}]\ntype = ${rcloneType}\ntoken = ${status.token}\n`

          onChange('rclone_remote', remoteName)
          onChange('rclone_config', configContent)
          if (!source.name) {
            onChange('name', providerInfo?.label || 'Cloud')
          }
        } else if (status.status === 'error') {
          clearInterval(iv)
          setPolling(false)
          setAuthError(status.error || 'Autorisierung fehlgeschlagen')
          setAuthStatus('error')
        }
      } catch { /* ignore */ }
    }, 2000)

    // Timeout after 5 minutes
    setTimeout(() => {
      clearInterval(iv)
      if (polling) {
        setPolling(false)
        if (authStatus === 'waiting') {
          setAuthError('Zeitüberschreitung – bitte erneut versuchen.')
          setAuthStatus('error')
        }
      }
    }, 300000)
  }

  // Already connected (editing existing source)
  if (source.rclone_config && authStatus === 'idle') {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 p-3 bg-green-950/30 border border-green-800/40 rounded-xl">
          <CheckCircle2 className="w-4 h-4 text-green-400" />
          <p className="text-sm text-green-300">Cloud-Konto verbunden</p>
        </div>
        <Field label="Ordner wählen">
          {source.id ? (
            <FolderPicker sourceId={source.id} currentPath={source.rclone_path || '/'} onSelect={p => onChange('rclone_path', p)} />
          ) : (
            <input type="text" value={source.rclone_path || '/'} onChange={e => onChange('rclone_path', e.target.value)} placeholder="/Scans" className={inputCls} />
          )}
        </Field>
        <button onClick={() => setShowRcloneConfig(!showRcloneConfig)} className="text-xs text-surface-500 hover:text-surface-300">
          {showRcloneConfig ? 'Erweitert' : 'Erweitert'}
        </button>
        {showRcloneConfig && (
          <div className="space-y-2">
            <Field label="Remote-Name">
              <input type="text" value={source.rclone_remote || ''} onChange={e => onChange('rclone_remote', e.target.value)} className={inputCls} />
            </Field>
            <textarea value={source.rclone_config || ''} onChange={e => onChange('rclone_config', e.target.value)} rows={3} className={clsx(inputCls, 'font-mono text-xs')} />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Provider selection */}
      <Field label="Cloud-Dienst wählen">
        <div className="flex gap-2">
          {RCLONE_PROVIDERS.map(p => (
            <button
              key={p.id}
              onClick={() => setSelectedProvider(p.id)}
              className={clsx(
                'flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors',
                selectedProvider === p.id
                  ? 'border-primary-500 bg-primary-900/30 text-white'
                  : 'border-surface-600 bg-surface-800 text-surface-300 hover:border-surface-400'
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </Field>

      {/* Auth flow */}
      {authStatus === 'idle' && (
        <button
          onClick={startAuth}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary-600 hover:bg-primary-500 text-white rounded-xl text-sm font-medium transition-colors"
        >
          <Cloud className="w-5 h-5" />
          {RCLONE_PROVIDERS.find(p => p.id === selectedProvider)?.label} verbinden
        </button>
      )}

      {authStatus === 'starting' && (
        <div className="flex items-center justify-center gap-2 p-4 text-surface-400">
          <Loader2 className="w-5 h-5 animate-spin" />
          Autorisierung wird gestartet…
        </div>
      )}

      {(authStatus === 'waiting') && (
        <div className="space-y-3">
          <div className="p-4 bg-blue-950/30 border border-blue-800/40 rounded-xl space-y-2">
            <p className="text-sm text-blue-300 font-medium flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Warte auf Autorisierung…
            </p>
            {authUrl ? (
              <>
                <p className="text-xs text-surface-400">Bitte öffne diesen Link und melde dich an:</p>
                <a
                  href={authUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block px-3 py-2 bg-surface-800 rounded-lg text-xs text-primary-400 hover:text-primary-300 break-all underline"
                >
                  {authUrl.length > 100 ? authUrl.substring(0, 100) + '…' : authUrl}
                </a>
                <p className="text-xs text-surface-500">
                  Nach der Anmeldung wird der Zugang automatisch übernommen.
                </p>
              </>
            ) : (
              <p className="text-xs text-surface-400">Link wird geladen…</p>
            )}
          </div>
        </div>
      )}

      {authStatus === 'success' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 p-3 bg-green-950/30 border border-green-800/40 rounded-xl">
            <CheckCircle2 className="w-5 h-5 text-green-400" />
            <p className="text-sm text-green-300 font-medium">Erfolgreich verbunden!</p>
          </div>
          <Field label="Ordner wählen" hint="Wähle den Ordner aus dem importiert werden soll">
            <input
              type="text"
              value={source.rclone_path || '/'}
              onChange={e => onChange('rclone_path', e.target.value)}
              placeholder="/Scans"
              className={inputCls}
            />
            <p className="text-xs text-surface-500 mt-1">Speichere die Quelle zuerst, dann kannst du Ordner durchsuchen.</p>
          </Field>
        </div>
      )}

      {authStatus === 'error' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 p-3 bg-red-950/30 border border-red-800/40 rounded-xl">
            <XCircle className="w-4 h-4 text-red-400" />
            <p className="text-sm text-red-300">{authError}</p>
          </div>
          <button
            onClick={() => { setAuthStatus('idle'); setAuthError('') }}
            className="px-3 py-1.5 bg-surface-700 hover:bg-surface-600 text-white rounded-lg text-xs"
          >
            Erneut versuchen
          </button>
        </div>
      )}
    </div>
  )
}

// ── Folder Picker ────────────────────────────────────────────────────────────

function FolderPicker({ sourceId, currentPath, onSelect }: { sourceId: number; currentPath: string; onSelect: (path: string) => void }) {
  const [browsePath, setBrowsePath] = useState(currentPath || '/')
  const [folders, setFolders] = useState<{ name: string; path: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)

  const loadFolders = async (path: string) => {
    setLoading(true)
    setError('')
    try {
      const res = await api.fetchJson<{ path: string; folders: { name: string; path: string }[] }>(
        `/cloud-import/sources/${sourceId}/folders?path=${encodeURIComponent(path)}`
      )
      setFolders(res.folders)
      setBrowsePath(path)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const openBrowser = () => {
    setOpen(true)
    loadFolders(browsePath)
  }

  const goUp = () => {
    const parts = browsePath.split('/').filter(Boolean)
    parts.pop()
    loadFolders('/' + parts.join('/') || '/')
  }

  const selectFolder = (path: string) => {
    onSelect(path)
    setOpen(false)
  }

  return (
    <div>
      <div className="flex gap-2">
        <input type="text" value={currentPath} onChange={e => onSelect(e.target.value)} className={clsx(inputCls, 'flex-1')} placeholder="/" />
        <button onClick={openBrowser} className="px-3 py-2 bg-surface-700 hover:bg-surface-600 text-white rounded-lg text-sm whitespace-nowrap transition-colors flex items-center gap-1.5">
          <Cloud className="w-4 h-4" />
          Durchsuchen
        </button>
      </div>
      {open && (
        <div className="mt-2 border border-surface-600 rounded-xl bg-surface-800 overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 bg-surface-750 border-b border-surface-700 text-xs">
            <span className="text-surface-400">Pfad:</span>
            <span className="text-white font-mono">{browsePath}</span>
            {browsePath !== '/' && (
              <button onClick={goUp} className="ml-auto text-primary-400 hover:text-primary-300 text-xs">Hoch</button>
            )}
          </div>
          <div className="max-h-48 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-6 text-surface-400"><Loader2 className="w-4 h-4 animate-spin mr-2" />Ordner laden…</div>
            ) : error ? (
              <p className="text-red-400 text-xs px-3 py-4">{error}</p>
            ) : folders.length === 0 ? (
              <p className="text-surface-500 text-xs px-3 py-4 text-center">Keine Unterordner</p>
            ) : (
              folders.map(f => (
                <div key={f.path} className="flex items-center justify-between px-3 py-2 hover:bg-surface-700/50 border-b border-surface-700/30 last:border-0">
                  <button onClick={() => loadFolders(f.path)} className="flex items-center gap-2 text-sm text-white hover:text-primary-300 min-w-0">
                    <Globe className="w-4 h-4 text-yellow-400 flex-shrink-0" />
                    <span className="truncate">{f.name}</span>
                  </button>
                  <button onClick={() => selectFolder(f.path)} className="ml-2 px-2 py-1 text-xs bg-primary-600/80 hover:bg-primary-500 text-white rounded transition-colors flex-shrink-0">
                    Wählen
                  </button>
                </div>
              ))
            )}
          </div>
          <div className="flex items-center justify-between px-3 py-2 bg-surface-750 border-t border-surface-700">
            <button onClick={() => selectFolder(browsePath)} className="text-xs text-primary-400 hover:text-primary-300">
              Diesen Ordner verwenden
            </button>
            <button onClick={() => setOpen(false)} className="text-xs text-surface-400 hover:text-white">Schliessen</button>
          </div>
        </div>
      )}
    </div>
  )
}
