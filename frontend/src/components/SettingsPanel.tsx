import { useState, useEffect } from 'react'
import { Save, Check, X, Eye, EyeOff, TestTube, Loader2, ChevronDown, ChevronUp, DollarSign, Cpu, Lock, Bug, Trash2 } from 'lucide-react'
import clsx from 'clsx'
import * as api from '../services/api'
import type { ModelInfo } from '../services/api'

interface LLMProvider {
  id: number
  name: string
  display_name: string
  api_key: string
  api_base_url: string
  model: string
  is_active: boolean
  is_configured: boolean
}

export default function SettingsPanel() {
  // Paperless Settings
  const [paperlessUrl, setPaperlessUrl] = useState('')
  const [paperlessToken, setPaperlessToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [paperlessSaving, setPaperlessSaving] = useState(false)
  const [paperlessTestResult, setPaperlessTestResult] = useState<{ success: boolean; message: string } | null>(null)

  // LLM Providers
  const [providers, setProviders] = useState<LLMProvider[]>([])
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null)
  const [llmTestResult, setLlmTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [testingLLM, setTestingLLM] = useState(false)
  
  // Provider edit states
  const [editingProvider, setEditingProvider] = useState<{[key: string]: LLMProvider}>({})
  const [savingProvider, setSavingProvider] = useState<string | null>(null)
  
  // Model info with pricing
  const [modelInfos, setModelInfos] = useState<Record<string, ModelInfo>>({})
  
  // App Settings
  const [appSettings, setAppSettings] = useState({
    password_enabled: false,
    password_set: false,
    show_debug_menu: false,
    sidebar_compact: false
  })
  const [newPassword, setNewPassword] = useState('')
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [savingAppSettings, setSavingAppSettings] = useState(false)
  const [appSettingsSaved, setAppSettingsSaved] = useState(false)

  useEffect(() => {
    loadSettings()
    loadModelInfos()
    loadAppSettings()
  }, [])

  const loadAppSettings = async () => {
    try {
      const settings = await api.getAppSettings()
      setAppSettings(settings)
    } catch (e) {
      console.error('Error loading app settings:', e)
    }
  }

  const saveAppSettings = async (updates: Partial<typeof appSettings> & { password?: string }) => {
    setSavingAppSettings(true)
    try {
      await api.updateAppSettings(updates)
      await loadAppSettings()
      setAppSettingsSaved(true)
      setTimeout(() => setAppSettingsSaved(false), 2000)
      // Reload page to apply changes (like debug menu toggle)
      if (updates.show_debug_menu !== undefined) {
        window.location.reload()
      }
    } catch (e) {
      console.error('Error saving app settings:', e)
    } finally {
      setSavingAppSettings(false)
    }
  }

  const handleSetPassword = async () => {
    if (!newPassword) return
    await saveAppSettings({ password: newPassword, password_enabled: true })
    setNewPassword('')
  }

  const handleRemovePassword = async () => {
    await api.removePassword()
    await loadAppSettings()
    localStorage.removeItem('app_authenticated')
  }

  const loadModelInfos = async () => {
    try {
      const result = await api.getAvailableModels()
      const infos: Record<string, ModelInfo> = {}
      result.models.forEach((m: ModelInfo) => {
        infos[m.id] = m
      })
      setModelInfos(infos)
    } catch (e) {
      console.error('Error loading model infos:', e)
    }
  }

  const loadSettings = async () => {
    try {
      const [paperlessSettings, llmProviders] = await Promise.all([
        api.getPaperlessSettings(),
        api.getLLMProviders()
      ])

      setPaperlessUrl(paperlessSettings.url)
      setPaperlessToken(paperlessSettings.api_token)
      setProviders(llmProviders)
      
      // Initialize edit states
      const editStates: {[key: string]: LLMProvider} = {}
      llmProviders.forEach((p: LLMProvider) => {
        editStates[p.name] = { ...p }
      })
      setEditingProvider(editStates)
    } catch (error) {
      console.error('Error loading settings:', error)
    }
  }

  const savePaperlessSettings = async () => {
    setPaperlessSaving(true)
    setPaperlessTestResult(null)
    try {
      await api.savePaperlessSettings({ url: paperlessUrl, api_token: paperlessToken })
      
      // Run detailed test via debug endpoint
      const testRes = await fetch('/api/debug/paperless-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: paperlessUrl, token: paperlessToken })
      })
      const testResult = await testRes.json()
      
      if (testResult.success && testResult.is_paperless) {
        setPaperlessTestResult({ 
          success: true, 
          message: `Verbindung erfolgreich! API gefunden: ${testResult.working_url}`
        })
      } else {
        // Fallback to simple status check
        const status = await api.getPaperlessStatus()
        if (status.connected) {
          setPaperlessTestResult({ success: true, message: 'Verbindung erfolgreich!' })
        } else {
          setPaperlessTestResult({ 
            success: false, 
            message: testResult.message || status.error || 'Verbindung fehlgeschlagen'
          })
        }
      }
    } catch (error) {
      setPaperlessTestResult({ success: false, message: 'Fehler beim Speichern' })
    } finally {
      setPaperlessSaving(false)
    }
  }

  const saveProvider = async (providerName: string) => {
    const editState = editingProvider[providerName]
    if (!editState) return
    
    const provider = providers.find(p => p.name === providerName)
    if (!provider) return

    setSavingProvider(providerName)
    try {
      await api.updateLLMProvider(provider.id, {
        name: editState.name,
        display_name: editState.display_name,
        api_key: editState.api_key,
        api_base_url: editState.api_base_url,
        model: editState.model,
        is_active: editState.is_active
      })
      
      // Reload providers
      const newProviders = await api.getLLMProviders()
      setProviders(newProviders)
      
      // Update edit states
      const editStates: {[key: string]: LLMProvider} = {}
      newProviders.forEach((p: LLMProvider) => {
        editStates[p.name] = { ...p }
      })
      setEditingProvider(editStates)
    } catch (error) {
      console.error('Error updating provider:', error)
    } finally {
      setSavingProvider(null)
    }
  }

  const activateProvider = async (providerName: string) => {
    const provider = providers.find(p => p.name === providerName)
    if (!provider) return

    setSavingProvider(providerName)
    try {
      await api.updateLLMProvider(provider.id, {
        name: provider.name,
        display_name: provider.display_name,
        api_key: editingProvider[providerName]?.api_key || provider.api_key,
        api_base_url: editingProvider[providerName]?.api_base_url || provider.api_base_url,
        model: editingProvider[providerName]?.model || provider.model,
        is_active: true
      })
      
      const newProviders = await api.getLLMProviders()
      setProviders(newProviders)
      
      const editStates: {[key: string]: LLMProvider} = {}
      newProviders.forEach((p: LLMProvider) => {
        editStates[p.name] = { ...p }
      })
      setEditingProvider(editStates)
    } catch (error) {
      console.error('Error activating provider:', error)
    } finally {
      setSavingProvider(null)
    }
  }

  const updateEditState = (providerName: string, field: keyof LLMProvider, value: string | boolean) => {
    setEditingProvider(prev => ({
      ...prev,
      [providerName]: {
        ...prev[providerName],
        [field]: value
      }
    }))
  }

  const testLLM = async () => {
    setTestingLLM(true)
    setLlmTestResult(null)
    try {
      const result = await api.testLLMConnection()
      if (result.success) {
        setLlmTestResult({ success: true, message: `Verbunden mit ${result.provider} (${result.model})` })
      } else {
        setLlmTestResult({ success: false, message: result.error || 'Test fehlgeschlagen' })
      }
    } catch (error) {
      setLlmTestResult({ success: false, message: 'Verbindung fehlgeschlagen' })
    } finally {
      setTestingLLM(false)
    }
  }

  return (
    <div className="space-y-8 max-w-4xl">
      {/* Paperless Settings */}
      <div className="card p-6">
        <h2 className="font-display font-semibold text-xl text-surface-100 mb-6">
          Paperless-ngx Verbindung
        </h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-surface-300 mb-2">
              Paperless URL
            </label>
            <input
              type="url"
              value={paperlessUrl}
              onChange={(e) => setPaperlessUrl(e.target.value)}
              placeholder="https://paperless.example.com"
              className="input"
            />
            <p className="mt-1 text-xs text-surface-500">
              Tipp: Für lokales Paperless nutze <code className="text-primary-400">http://host.docker.internal:PORT</code>
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-surface-300 mb-2">
              API Token
            </label>
            <div className="relative">
              <input
                type={showToken ? 'text' : 'password'}
                value={paperlessToken}
                onChange={(e) => setPaperlessToken(e.target.value)}
                placeholder="Token aus Paperless Admin-Bereich"
                className="input pr-12"
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 hover:text-surface-200"
              >
                {showToken ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {paperlessTestResult && (
            <div className={clsx(
              'p-4 rounded-lg',
              paperlessTestResult.success 
                ? 'bg-emerald-500/10 border border-emerald-500/30'
                : 'bg-red-500/10 border border-red-500/30'
            )}>
              <div className="flex items-center gap-2">
                {paperlessTestResult.success ? (
                  <Check className="w-5 h-5 text-emerald-400" />
                ) : (
                  <X className="w-5 h-5 text-red-400" />
                )}
                <span className={paperlessTestResult.success ? 'text-emerald-400' : 'text-red-400'}>
                  {paperlessTestResult.success ? 'Verbindung erfolgreich!' : 'Verbindung fehlgeschlagen'}
                </span>
              </div>
              <p className="mt-2 text-sm text-surface-300">{paperlessTestResult.message}</p>
            </div>
          )}

          <button
            onClick={savePaperlessSettings}
            disabled={paperlessSaving}
            className="btn btn-primary flex items-center gap-2"
          >
            {paperlessSaving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            Speichern & Testen
          </button>
        </div>
      </div>

      {/* LLM Providers */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-display font-semibold text-xl text-surface-100">
            LLM Provider
          </h2>
          <button
            onClick={testLLM}
            disabled={testingLLM}
            className="btn btn-secondary flex items-center gap-2"
          >
            {testingLLM ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <TestTube className="w-4 h-4" />
            )}
            Aktiven Provider testen
          </button>
        </div>

        {llmTestResult && (
          <div className={clsx(
            'p-3 rounded-lg flex items-center gap-2 mb-4',
            llmTestResult.success 
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
              : 'bg-red-500/10 text-red-400 border border-red-500/30'
          )}>
            {llmTestResult.success ? <Check className="w-5 h-5" /> : <X className="w-5 h-5" />}
            {llmTestResult.message}
          </div>
        )}

        <div className="space-y-3">
          {providers.map((provider) => {
            const editState = editingProvider[provider.name] || provider
            const isExpanded = expandedProvider === provider.name
            
            return (
              <div
                key={provider.id}
                className={clsx(
                  'rounded-xl border transition-all duration-200',
                  provider.is_active 
                    ? 'bg-primary-500/10 border-primary-500/30' 
                    : 'bg-surface-800/50 border-surface-600/50'
                )}
              >
                {/* Provider Header */}
                <div 
                  className="p-4 flex items-center justify-between cursor-pointer"
                  onClick={() => setExpandedProvider(isExpanded ? null : provider.name)}
                >
                  <div className="flex items-center gap-3">
                    {isExpanded ? (
                      <ChevronUp className="w-5 h-5 text-surface-400" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-surface-400" />
                    )}
                    <span className="font-medium text-surface-100">
                      {provider.display_name}
                    </span>
                    {provider.is_active && (
                      <span className="badge badge-primary">Aktiv</span>
                    )}
                    {provider.is_configured && !provider.is_active && (
                      <span className="badge badge-success">Konfiguriert</span>
                    )}
                  </div>
                  {!provider.is_active && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        activateProvider(provider.name)
                      }}
                      disabled={savingProvider === provider.name}
                      className="btn btn-secondary text-sm"
                    >
                      {savingProvider === provider.name ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        'Aktivieren'
                      )}
                    </button>
                  )}
                </div>

                {/* Provider Details */}
                {isExpanded && (
                  <div className="px-4 pb-4 pt-2 border-t border-surface-600/50 space-y-4">
                    {/* API Key (not for Ollama) */}
                    {provider.name !== 'ollama' && (
                      <div>
                        <label className="block text-sm font-medium text-surface-300 mb-2">
                          API Key
                        </label>
                        <input
                          type="password"
                          value={editState.api_key === '***' ? '' : editState.api_key}
                          onChange={(e) => updateEditState(provider.name, 'api_key', e.target.value)}
                          placeholder={provider.api_key ? '••••••••••••••••' : 'API Key eingeben'}
                          className="input"
                        />
                        <p className="mt-1 text-xs text-surface-500">
                          {provider.name === 'openai' && 'Hole deinen Key von platform.openai.com/api-keys'}
                          {provider.name === 'anthropic' && 'Hole deinen Key von console.anthropic.com'}
                          {provider.name === 'azure' && 'Azure Portal → Cognitive Services → Keys'}
                        </p>
                      </div>
                    )}

                    {/* Base URL (for Azure and Ollama) */}
                    {(provider.name === 'azure' || provider.name === 'ollama') && (
                      <div>
                        <label className="block text-sm font-medium text-surface-300 mb-2">
                          {provider.name === 'azure' ? 'Azure Endpoint' : 'Ollama URL'}
                        </label>
                        <input
                          type="url"
                          value={editState.api_base_url}
                          onChange={(e) => updateEditState(provider.name, 'api_base_url', e.target.value)}
                          placeholder={provider.name === 'azure' ? 'https://xxx.openai.azure.com' : 'http://host.docker.internal:11434'}
                          className="input"
                        />
                        {provider.name === 'ollama' && (
                          <p className="mt-1 text-xs text-surface-500">
                            Für lokales Ollama: <code className="text-primary-400">http://host.docker.internal:11434</code>
                          </p>
                        )}
                      </div>
                    )}

                    {/* Model Selection */}
                    <div>
                      <label className="block text-sm font-medium text-surface-300 mb-2">
                        Model
                      </label>
                      <div className="space-y-3">
                        <input
                          type="text"
                          value={editState.model}
                          onChange={(e) => updateEditState(provider.name, 'model', e.target.value)}
                          placeholder="Model-Name eingeben"
                          className="input"
                        />
                        
                        {/* Model Cards with Pricing */}
                        <div className="grid grid-cols-1 gap-2">
                          {Object.values(modelInfos)
                            .filter(m => m.provider === provider.name)
                            .sort((a, b) => b.context - a.context)
                            .map((model) => (
                              <button
                                key={model.id}
                                onClick={() => updateEditState(provider.name, 'model', model.id)}
                                className={clsx(
                                  'p-3 rounded-lg text-left transition-all border',
                                  editState.model === model.id
                                    ? 'bg-primary-500/20 border-primary-500/50'
                                    : 'bg-surface-700/50 border-surface-600/50 hover:bg-surface-700'
                                )}
                              >
                                <div className="flex items-center justify-between mb-1">
                                  <span className="font-medium text-surface-100">{model.id}</span>
                                  {editState.model === model.id && (
                                    <Check className="w-4 h-4 text-primary-400" />
                                  )}
                                </div>
                                <p className="text-xs text-surface-400 mb-2">{model.description}</p>
                                <div className="flex items-center gap-4 text-xs">
                                  <span className="flex items-center gap-1 text-surface-400">
                                    <Cpu className="w-3 h-3" />
                                    {(model.context / 1000).toFixed(0)}k Context
                                  </span>
                                  {model.input_price > 0 ? (
                                    <span className="flex items-center gap-1 text-emerald-400">
                                      <DollarSign className="w-3 h-3" />
                                      ${model.input_price.toFixed(2)} / ${model.output_price.toFixed(2)} per 1M
                                    </span>
                                  ) : (
                                    <span className="text-emerald-400">✓ Kostenlos (lokal)</span>
                                  )}
                                </div>
                              </button>
                            ))}
                        </div>
                        
                        {/* Fallback for models not in list */}
                        {Object.values(modelInfos).filter(m => m.provider === provider.name).length === 0 && (
                          <p className="text-xs text-surface-500">Gib den Model-Namen manuell ein</p>
                        )}
                        
                        {/* Current model info if selected */}
                        {editState.model && modelInfos[editState.model] && (
                          <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                            <div className="flex items-center gap-2 text-sm text-emerald-400">
                              <Check className="w-4 h-4" />
                              <span className="font-medium">{editState.model}</span>
                            </div>
                            <div className="mt-1 text-xs text-surface-400">
                              {(modelInfos[editState.model].context / 1000).toFixed(0)}k Tokens Context •{' '}
                              {modelInfos[editState.model].input_price > 0 
                                ? `$${modelInfos[editState.model].input_price.toFixed(2)} Input / $${modelInfos[editState.model].output_price.toFixed(2)} Output (per 1M Tokens)`
                                : 'Kostenlos (lokal)'
                              }
                            </div>
                          </div>
                        )}
                      </div>
                    </div>


                    {/* Save Button */}
                    <div className="pt-2">
                      <button
                        onClick={() => saveProvider(provider.name)}
                        disabled={savingProvider === provider.name}
                        className="btn btn-primary flex items-center gap-2"
                      >
                        {savingProvider === provider.name ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Save className="w-4 h-4" />
                        )}
                        Speichern
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* App Settings */}
      <div className="card p-6">
        <h2 className="font-display font-semibold text-lg text-surface-100 mb-6 flex items-center gap-2">
          <Lock className="w-5 h-5 text-primary-400" />
          App-Einstellungen
        </h2>

        <div className="space-y-6">
          {/* Password Protection */}
          <div className="p-4 rounded-lg bg-surface-800/50 border border-surface-700">
            <h3 className="font-medium text-surface-100 mb-3">Passwort-Schutz</h3>
            <p className="text-sm text-surface-400 mb-4">
              Schütze die gesamte Anwendung mit einem Passwort. Ohne Passwort ist kein Zugriff möglich!
            </p>
            
            {appSettings.password_set ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-emerald-400">
                  <Check className="w-4 h-4" />
                  <span>Passwort ist gesetzt</span>
                </div>
                <button
                  onClick={handleRemovePassword}
                  className="btn btn-danger btn-sm flex items-center gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  Entfernen
                </button>
              </div>
            ) : (
              <div className="flex gap-3">
                <div className="flex-1 relative">
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Neues Passwort"
                    className="input w-full pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 hover:text-surface-200"
                  >
                    {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <button
                  onClick={handleSetPassword}
                  disabled={!newPassword || savingAppSettings}
                  className="btn btn-primary flex items-center gap-2"
                >
                  <Lock className="w-4 h-4" />
                  Setzen
                </button>
              </div>
            )}
          </div>

          {/* Debug Menu Toggle */}
          <div className="p-4 rounded-lg bg-surface-800/50 border border-surface-700">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium text-surface-100 flex items-center gap-2">
                  <Bug className="w-4 h-4 text-surface-400" />
                  Debug-Menü in Sidebar
                </h3>
                <p className="text-sm text-surface-400 mt-1">
                  Zeigt Netzwerk-Diagnose-Tools in der Navigation
                </p>
              </div>
              <button
                onClick={() => saveAppSettings({ show_debug_menu: !appSettings.show_debug_menu })}
                className={clsx(
                  'relative w-12 h-6 rounded-full transition-colors',
                  appSettings.show_debug_menu ? 'bg-primary-500' : 'bg-surface-600'
                )}
              >
                <span className={clsx(
                  'absolute top-1 w-4 h-4 rounded-full bg-white transition-all',
                  appSettings.show_debug_menu ? 'left-7' : 'left-1'
                )} />
              </button>
            </div>
          </div>

          {/* Save Confirmation */}
          {appSettingsSaved && (
            <div className="flex items-center gap-2 text-emerald-400 text-sm">
              <Check className="w-4 h-4" />
              Einstellungen gespeichert
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
