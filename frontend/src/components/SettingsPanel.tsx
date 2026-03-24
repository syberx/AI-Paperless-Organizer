import { useState, useEffect } from 'react'
import { Save, Check, X, Eye, EyeOff, TestTube, Loader2, ChevronDown, ChevronUp, Cpu, Lock, Bug, Trash2, Ban } from 'lucide-react'
import clsx from 'clsx'
import * as api from '../services/api'

interface LLMProvider {
  id: number
  name: string
  display_name: string
  api_key: string
  api_base_url: string
  model: string
  classifier_model: string
  vision_model: string
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
  
  
  // Ollama installed models (fetched from Ollama API)
  const [ollamaInstalledModels, setOllamaInstalledModels] = useState<string[]>([])
  const [ollamaModelsLoading, setOllamaModelsLoading] = useState(false)
  
  // App Settings
  const [appSettings, setAppSettings] = useState({
    password_enabled: false,
    password_set: false,
    show_debug_menu: false,
    sidebar_compact: false,
    classifier_provider: 'ollama',
  })
  const [newPassword, setNewPassword] = useState('')
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [savingAppSettings, setSavingAppSettings] = useState(false)
  const [appSettingsSaved, setAppSettingsSaved] = useState(false)
  
  // Ignored Items
  const [ignoredItems, setIgnoredItems] = useState<api.IgnoredItem[]>([])
  const [loadingIgnored, setLoadingIgnored] = useState(false)
  const [removingIgnored, setRemovingIgnored] = useState<number | null>(null)

  useEffect(() => {
    loadSettings()
    loadAppSettings()
    loadIgnoredItems()
  }, [])
  
  const loadIgnoredItems = async () => {
    setLoadingIgnored(true)
    try {
      const items = await api.getIgnoredItems()
      setIgnoredItems(items)
    } catch (e) {
      console.error('Failed to load ignored items:', e)
    } finally {
      setLoadingIgnored(false)
    }
  }
  
  const handleRemoveIgnored = async (id: number) => {
    setRemovingIgnored(id)
    try {
      await api.removeIgnoredItem(id)
      setIgnoredItems(ignoredItems.filter(item => item.id !== id))
    } catch (e) {
      console.error('Failed to remove ignored item:', e)
    } finally {
      setRemovingIgnored(null)
    }
  }

  const loadOllamaInstalledModels = async () => {
    setOllamaModelsLoading(true)
    try {
      const res = await api.getClassifierOllamaModels()
      if (res.connected && res.installed) {
        setOllamaInstalledModels(res.installed.map((m: any) => m.name))
      }
    } catch (e) {
      console.error('Failed to load Ollama models:', e)
    } finally {
      setOllamaModelsLoading(false)
    }
  }

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
        classifier_model: editState.classifier_model || '',
        vision_model: editState.vision_model || '',
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
        classifier_model: editingProvider[providerName]?.classifier_model || provider.classifier_model || '',
        vision_model: editingProvider[providerName]?.vision_model || provider.vision_model || '',
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

                    {/* === OLLAMA: Role-based model selection with live data === */}
                    {provider.name === 'ollama' ? (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <label className="block text-sm font-medium text-surface-300">Modelle</label>
                          <button
                            onClick={loadOllamaInstalledModels}
                            disabled={ollamaModelsLoading}
                            className="btn text-xs flex items-center gap-1.5 bg-surface-700 hover:bg-surface-600 text-surface-300"
                          >
                            {ollamaModelsLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Cpu className="w-3 h-3" />}
                            Installierte Modelle laden
                          </button>
                        </div>

                        {/* Bereinigung Model */}
                        <div className="p-3 bg-surface-700/30 rounded-lg space-y-2">
                          <label className="block text-sm font-medium text-surface-200">Bereinigung-Modell</label>
                          <p className="text-xs text-surface-500">Fuer Metadaten-Bereinigung (Tags, Korrespondenten, Dokumententypen zusammenfuehren)</p>
                          {ollamaInstalledModels.length > 0 ? (
                            <select
                              value={editState.model}
                              onChange={(e) => updateEditState(provider.name, 'model', e.target.value)}
                              className="input"
                            >
                              {!ollamaInstalledModels.includes(editState.model) && editState.model && (
                                <option value={editState.model}>{editState.model} (nicht gefunden)</option>
                              )}
                              {ollamaInstalledModels.map(m => (
                                <option key={m} value={m}>{m}</option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type="text"
                              value={editState.model}
                              onChange={(e) => updateEditState(provider.name, 'model', e.target.value)}
                              placeholder="z.B. llama3.1"
                              className="input"
                            />
                          )}
                        </div>

                        {/* Klassifizierer Model */}
                        <div className="p-3 bg-surface-700/30 rounded-lg space-y-2">
                          <label className="block text-sm font-medium text-surface-200">Klassifizierer-Modell</label>
                          <p className="text-xs text-surface-500">Fuer Dokument-Klassifizierung (Tags, Typ, Korrespondent zuordnen)</p>
                          {ollamaInstalledModels.length > 0 ? (
                            <select
                              value={editState.classifier_model || ''}
                              onChange={(e) => updateEditState(provider.name, 'classifier_model', e.target.value)}
                              className="input"
                            >
                              <option value="">Gleich wie Bereinigung ({editState.model || '-'})</option>
                              {ollamaInstalledModels.map(m => (
                                <option key={m} value={m}>{m}</option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type="text"
                              value={editState.classifier_model || ''}
                              onChange={(e) => updateEditState(provider.name, 'classifier_model', e.target.value)}
                              placeholder={editState.model || 'Gleich wie Bereinigung'}
                              className="input"
                            />
                          )}
                        </div>

                        {/* Vision Model */}
                        <div className="p-3 bg-surface-700/30 rounded-lg space-y-2">
                          <label className="block text-sm font-medium text-surface-200">OCR Vision-Modell</label>
                          <p className="text-xs text-surface-500">Fuer Texterkennung mit Ollama Vision (wird in OCR-Einstellungen verwaltet)</p>
                          {ollamaInstalledModels.length > 0 ? (
                            <select
                              value={editState.vision_model || ''}
                              onChange={(e) => updateEditState(provider.name, 'vision_model', e.target.value)}
                              className="input"
                            >
                              <option value="">Nicht gesetzt</option>
                              {ollamaInstalledModels.map(m => (
                                <option key={m} value={m}>{m}</option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type="text"
                              value={editState.vision_model || ''}
                              onChange={(e) => updateEditState(provider.name, 'vision_model', e.target.value)}
                              placeholder="z.B. qwen3-vl:4b-instruct"
                              className="input"
                            />
                          )}
                        </div>

                        {ollamaInstalledModels.length === 0 && !ollamaModelsLoading && (
                          <p className="text-xs text-surface-500">Klicke "Installierte Modelle laden" um Dropdowns zu sehen.</p>
                        )}
                      </div>
                    ) : (
                      /* === CLOUD PROVIDERS: Simple text inputs === */
                      <>
                        <div className="p-3 bg-surface-700/30 rounded-lg space-y-2">
                          <label className="block text-sm font-medium text-surface-200">Bereinigung-Modell</label>
                          <p className="text-xs text-surface-500">Fuer Metadaten-Bereinigung (Tags, Korrespondenten, Dokumententypen zusammenfuehren)</p>
                          <input
                            type="text"
                            value={editState.model}
                            onChange={(e) => updateEditState(provider.name, 'model', e.target.value)}
                            placeholder={{
                              openai: 'z.B. gpt-4o, gpt-4o-mini',
                              anthropic: 'z.B. claude-sonnet-4-20250514',
                              azure: 'z.B. gpt-4',
                              mistral: 'z.B. mistral-small-latest',
                              openrouter: 'z.B. mistralai/mistral-small-2603',
                            }[provider.name] || 'Modellname eingeben'}
                            className="input"
                          />
                        </div>

                        <div className="p-3 bg-surface-700/30 rounded-lg space-y-2">
                          <label className="block text-sm font-medium text-surface-200">Klassifizierer-Modell <span className="text-surface-500 font-normal">(optional)</span></label>
                          <p className="text-xs text-surface-500">Eigenes Modell fuer Dokument-Klassifizierung (leer = Bereinigung-Modell wird verwendet)</p>
                          <input
                            type="text"
                            value={editState.classifier_model || ''}
                            onChange={(e) => updateEditState(provider.name, 'classifier_model', e.target.value)}
                            placeholder={editState.model ? `Gleich wie ${editState.model}` : 'Gleich wie Bereinigung-Modell'}
                            className="input"
                          />
                        </div>
                      </>
                    )}

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

      {/* Job-Zuweisung */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-surface-100 mb-4 flex items-center gap-2">
          <Cpu className="w-5 h-5 text-primary-400" />
          Job-Zuweisung
        </h2>
        <p className="text-sm text-surface-400 mb-4">
          Welcher Provider wird fuer welchen Job verwendet?
        </p>
        <div className="space-y-4">
          {/* Bereinigung */}
          <div className="flex items-center justify-between p-3 bg-surface-700/50 rounded-lg">
            <div>
              <p className="text-sm font-medium text-surface-200">Metadaten-Bereinigung</p>
              <p className="text-xs text-surface-500">Tags, Korrespondenten, Dokumententypen aufraeumen</p>
            </div>
            <select
              value={providers.find(p => p.is_active)?.name || ''}
              onChange={async (e) => {
                const selectedName = e.target.value
                const selectedProvider = providers.find(p => p.name === selectedName)
                if (!selectedProvider) return
                const edit = editingProvider[selectedName]
                await api.updateLLMProvider(selectedProvider.id, {
                  name: selectedProvider.name,
                  display_name: selectedProvider.display_name,
                  api_key: edit?.api_key || selectedProvider.api_key,
                  api_base_url: edit?.api_base_url || selectedProvider.api_base_url,
                  model: edit?.model || selectedProvider.model,
                  classifier_model: edit?.classifier_model || selectedProvider.classifier_model || '',
                  vision_model: edit?.vision_model || selectedProvider.vision_model || '',
                  is_active: true
                })
                const newProviders = await api.getLLMProviders()
                setProviders(newProviders)
                const editStates: {[key: string]: LLMProvider} = {}
                newProviders.forEach((p: LLMProvider) => { editStates[p.name] = { ...p } })
                setEditingProvider(editStates)
              }}
              className="input w-48 text-sm"
            >
              {providers.filter(p => p.is_configured || p.name === 'ollama').map(p => (
                <option key={p.name} value={p.name}>{p.display_name}</option>
              ))}
            </select>
          </div>

          {/* Klassifizierer */}
          <div className="flex items-center justify-between p-3 bg-surface-700/50 rounded-lg">
            <div>
              <p className="text-sm font-medium text-surface-200">Dokument-Klassifizierer</p>
              <p className="text-xs text-surface-500">Tags, Typ, Korrespondent, Speicherpfad zuordnen</p>
            </div>
            <select
              value={appSettings.classifier_provider}
              onChange={async (e) => {
                const val = e.target.value
                setAppSettings(prev => ({ ...prev, classifier_provider: val }))
                await api.updateAppSettings({ classifier_provider: val })
              }}
              className="input w-48 text-sm"
            >
              {providers.map(p => (
                <option key={p.name} value={p.name}>{p.display_name}</option>
              ))}
            </select>
          </div>

          {/* Benchmark */}
          <div className="flex items-center justify-between p-3 bg-surface-700/50 rounded-lg">
            <div>
              <p className="text-sm font-medium text-surface-200">Benchmark</p>
              <p className="text-xs text-surface-500">Mehrere Provider gleichzeitig testen</p>
            </div>
            <div className="text-sm text-surface-400">
              Freie Auswahl im Klassifizierer
            </div>
          </div>

          {/* OCR */}
          <div className="flex items-center justify-between p-3 bg-surface-700/50 rounded-lg">
            <div>
              <p className="text-sm font-medium text-surface-200">OCR Vision</p>
              <p className="text-xs text-surface-500">Texterkennung mit Ollama Vision-Modellen</p>
            </div>
            <div className="text-sm text-surface-400">
              Ollama (eigene OCR-Einstellungen)
            </div>
          </div>
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
      
      {/* Ignored Items */}
      <div className="card p-6">
        <h2 className="font-display font-semibold text-lg text-surface-100 mb-6 flex items-center gap-2">
          <Ban className="w-5 h-5 text-red-400" />
          Ignorierte Einträge
          {ignoredItems.length > 0 && (
            <span className="text-sm font-normal text-surface-400">({ignoredItems.length})</span>
          )}
        </h2>
        
        <p className="text-sm text-surface-400 mb-4">
          Diese Einträge werden bei KI-Analysen nicht mehr vorgeschlagen. Du kannst sie hier wieder aktivieren.
        </p>
        
        {loadingIgnored ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-primary-400" />
          </div>
        ) : ignoredItems.length === 0 ? (
          <div className="text-center py-8 text-surface-500">
            Keine ignorierten Einträge vorhanden.
          </div>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {ignoredItems.map(item => (
              <div 
                key={item.id} 
                className="flex items-center justify-between p-3 rounded-lg bg-surface-800/50 border border-surface-700"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-surface-200">{item.item_name}</span>
                    <span className="text-xs px-2 py-0.5 rounded bg-surface-700 text-surface-400">
                      {item.entity_type === 'tag' ? 'Tag' : 
                       item.entity_type === 'correspondent' ? 'Korrespondent' : 'Dokumententyp'}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded bg-surface-700 text-surface-400">
                      {item.analysis_type === 'nonsense' ? 'Unsinnig' :
                       item.analysis_type === 'correspondent_match' ? 'Korrespondent-Match' :
                       item.analysis_type === 'doctype_match' ? 'Dokumententyp-Match' : 'Ähnlich'}
                    </span>
                  </div>
                  <p className="text-xs text-surface-500 mt-1">
                    Ignoriert am {new Date(item.created_at).toLocaleDateString('de-DE')}
                  </p>
                </div>
                <button
                  onClick={() => handleRemoveIgnored(item.id)}
                  disabled={removingIgnored === item.id}
                  className="p-2 rounded text-surface-400 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                  title="Wieder aktivieren"
                >
                  {removingIgnored === item.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
