import { useState, useEffect } from 'react'
import { Save, RotateCcw, Loader2, MessageSquare, Check } from 'lucide-react'
import clsx from 'clsx'
import * as api from '../services/api'

interface CustomPrompt {
  id: number
  entity_type: string
  display_name?: string
  prompt_template: string
  is_active: boolean
}

const ENTITY_DESCRIPTIONS: Record<string, string> = {
  correspondents: 'Prompt zur Analyse von Korrespondenten-Duplikaten',
  tags: 'Prompt zur Analyse von ähnlichen Tags',
  document_types: 'Prompt zur Analyse von ähnlichen Dokumententypen',
  tags_nonsense: 'Prompt zur Erkennung von sinnlosen/generischen Tags',
  tags_are_correspondents: 'Prompt zur Erkennung von Tags die eigentlich Firmen/Personen sind',
  tags_are_document_types: 'Prompt zur Erkennung von Tags die eigentlich Dokumententypen sind'
}

// Group prompts by category
const PROMPT_CATEGORIES: Record<string, string[]> = {
  'Duplikat-Erkennung': ['correspondents', 'tags', 'document_types'],
  'Tag Cleanup Wizard': ['tags_nonsense', 'tags_are_correspondents', 'tags_are_document_types']
}

export default function PromptEditor() {
  const [prompts, setPrompts] = useState<CustomPrompt[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<string>('correspondents')
  const [editedPrompt, setEditedPrompt] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)

  useEffect(() => {
    loadPrompts()
  }, [])

  useEffect(() => {
    const prompt = prompts.find(p => p.entity_type === activeTab)
    if (prompt) {
      setEditedPrompt(prompt.prompt_template)
    }
  }, [activeTab, prompts])

  const loadPrompts = async () => {
    setLoading(true)
    try {
      const data = await api.getPrompts()
      setPrompts(data)
      if (data.length > 0) {
        setActiveTab(data[0].entity_type)
        setEditedPrompt(data[0].prompt_template)
      }
    } catch (error) {
      console.error('Error loading prompts:', error)
    } finally {
      setLoading(false)
    }
  }

  const savePrompt = async () => {
    const prompt = prompts.find(p => p.entity_type === activeTab)
    if (!prompt) return

    setSaving(true)
    setSaveSuccess(false)
    try {
      await api.updatePrompt(prompt.id, {
        entity_type: prompt.entity_type,
        prompt_template: editedPrompt,
        is_active: true
      })
      
      // Update local state
      setPrompts(prompts.map(p => 
        p.entity_type === activeTab 
          ? { ...p, prompt_template: editedPrompt }
          : p
      ))
      
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 2000)
    } catch (error) {
      console.error('Error saving prompt:', error)
    } finally {
      setSaving(false)
    }
  }

  const resetPrompt = async () => {
    setResetting(true)
    try {
      const result = await api.resetPrompt(activeTab)
      setEditedPrompt(result.prompt_template)
      
      // Update local state
      setPrompts(prompts.map(p => 
        p.entity_type === activeTab 
          ? { ...p, prompt_template: result.prompt_template }
          : p
      ))
    } catch (error) {
      console.error('Error resetting prompt:', error)
    } finally {
      setResetting(false)
    }
  }

  const currentPrompt = prompts.find(p => p.entity_type === activeTab)
  const hasChanges = currentPrompt?.prompt_template !== editedPrompt

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="font-display text-2xl font-bold text-surface-100">
          Prompt Editor
        </h2>
        <p className="text-surface-400 mt-1">
          Passe die KI-Prompts für die Ähnlichkeitsanalyse an
        </p>
      </div>

      {/* Info Box */}
      <div className="card p-4 bg-primary-500/10 border-primary-500/30">
        <div className="flex items-start gap-3">
          <MessageSquare className="w-5 h-5 text-primary-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-surface-300">
            <p className="mb-2">
              <strong className="text-surface-100">Hinweis:</strong> Die Prompts verwenden 
              den Platzhalter <code className="px-1.5 py-0.5 rounded bg-surface-700 text-primary-400">{'{items}'}</code>, 
              der automatisch durch die Liste der zu analysierenden Einträge ersetzt wird.
            </p>
            <p>
              Die KI sollte JSON im Format <code className="px-1.5 py-0.5 rounded bg-surface-700 text-primary-400">
              {`{"groups": [...]}`}</code> zurückgeben.
            </p>
          </div>
        </div>
      </div>

      {/* Tabs by Category */}
      <div className="space-y-4">
        {Object.entries(PROMPT_CATEGORIES).map(([category, types]) => {
          const categoryPrompts = prompts.filter(p => types.includes(p.entity_type))
          if (categoryPrompts.length === 0) return null
          
          return (
            <div key={category}>
              <h3 className="text-sm font-medium text-surface-500 mb-2">{category}</h3>
              <div className="flex flex-wrap items-center gap-2">
                {categoryPrompts.map((prompt) => (
                  <button
                    key={prompt.entity_type}
                    onClick={() => setActiveTab(prompt.entity_type)}
                    className={clsx(
                      'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                      activeTab === prompt.entity_type
                        ? 'bg-primary-500 text-white'
                        : 'bg-surface-700 text-surface-300 hover:text-surface-100 hover:bg-surface-600'
                    )}
                  >
                    {prompt.display_name || prompt.entity_type}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Editor */}
      <div className="card p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-surface-300 mb-1">
            {currentPrompt?.display_name || activeTab} - Prompt
          </label>
          <p className="text-sm text-surface-500 mb-4">
            {ENTITY_DESCRIPTIONS[activeTab] || 'Prompt zur KI-Analyse'}
          </p>
          <textarea
            value={editedPrompt}
            onChange={(e) => setEditedPrompt(e.target.value)}
            rows={20}
            className="input font-mono text-sm leading-relaxed resize-y min-h-[300px]"
            placeholder="Prompt eingeben..."
          />
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between pt-4 border-t border-surface-700">
          <button
            onClick={resetPrompt}
            disabled={resetting}
            className="btn btn-secondary flex items-center gap-2"
          >
            {resetting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RotateCcw className="w-4 h-4" />
            )}
            Auf Standard zurücksetzen
          </button>

          <div className="flex items-center gap-3">
            {saveSuccess && (
              <span className="flex items-center gap-2 text-emerald-400 text-sm">
                <Check className="w-4 h-4" />
                Gespeichert
              </span>
            )}
            <button
              onClick={savePrompt}
              disabled={saving || !hasChanges}
              className={clsx(
                'btn btn-primary flex items-center gap-2',
                !hasChanges && 'opacity-50 cursor-not-allowed'
              )}
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              Speichern
            </button>
          </div>
        </div>
      </div>

      {/* Preview Section */}
      <div className="card p-6">
        <h3 className="font-display font-semibold text-lg text-surface-100 mb-4">
          Erwartetes Antwortformat
        </h3>
        <pre className="p-4 rounded-lg bg-surface-900 border border-surface-700 overflow-x-auto text-sm">
          <code className="text-surface-300">{`{
  "groups": [
    {
      "suggested_name": "Vollständiger Name",
      "confidence": 0.95,
      "members": ["name1", "name2", "name3"],
      "reasoning": "Begründung warum diese zusammengehören"
    }
  ]
}`}</code>
        </pre>
      </div>
    </div>
  )
}

