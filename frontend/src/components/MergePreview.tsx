import { useState } from 'react'
import React from 'react'
import { Check, X, ChevronDown, ChevronUp, FileText, Loader2, Eye, ExternalLink } from 'lucide-react'
import clsx from 'clsx'
import * as api from '../services/api'

interface Member {
  id: number
  name: string
  document_count: number
}

interface SimilarityGroup {
  suggested_name: string
  confidence: number
  members: Member[]
  reasoning: string
}

interface MergePreviewProps {
  groups: SimilarityGroup[]
  entityType: 'correspondents' | 'tags' | 'document_types'
  onMerge: (targetId: number, targetName: string, sourceIds: number[], groupIndex?: number) => Promise<void>
  onIgnore?: (groupKey: string) => void
}

export default function MergePreview({ groups, entityType, onMerge, onIgnore }: MergePreviewProps) {
  // Use group's suggested_name as unique key instead of index
  const getGroupKey = (group: SimilarityGroup) => group.suggested_name + '_' + group.members.map(m => m.id).join('_')
  
  // All state uses groupKey instead of index to avoid bugs when groups are removed
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [merging, setMerging] = useState<string | null>(null)
  const [mergedGroups, setMergedGroups] = useState<Set<string>>(new Set())
  const [ignoredGroups, setIgnoredGroups] = useState<Set<string>>(new Set())
  
  // Document preview state
  const [previewMemberId, setPreviewMemberId] = useState<number | null>(null)
  const [previewDocs, setPreviewDocs] = useState<api.DocumentPreview[]>([])
  const [loadingPreview, setLoadingPreview] = useState(false)
  
  const [selectedMembers, setSelectedMembers] = useState<Map<string, Set<number>>>(new Map())
  const [targetNames, setTargetNames] = useState<Map<string, string>>(new Map())
  const [targetIds, setTargetIds] = useState<Map<string, number>>(new Map())
  
  // Re-initialize states when groups change
  React.useEffect(() => {
    const newSelected = new Map<string, Set<number>>()
    const newTargetNames = new Map<string, string>()
    const newTargetIds = new Map<string, number>()
    const newExpanded = new Set<string>()
    
    groups.forEach((g, index) => {
      const key = getGroupKey(g)
      // Only set if not already set (preserve user selections)
      if (!selectedMembers.has(key)) {
        newSelected.set(key, new Set(g.members.map(m => m.id)))
      } else {
        newSelected.set(key, selectedMembers.get(key)!)
      }
      if (!targetNames.has(key)) {
        newTargetNames.set(key, g.suggested_name)
      } else {
        newTargetNames.set(key, targetNames.get(key)!)
      }
      if (!targetIds.has(key)) {
        const maxDocMember = g.members.reduce((prev, curr) => 
          curr.document_count > prev.document_count ? curr : prev
        , g.members[0])
        newTargetIds.set(key, maxDocMember?.id || g.members[0]?.id)
      } else {
        newTargetIds.set(key, targetIds.get(key)!)
      }
      
      // Expand first non-merged group by default
      if (index === 0 && !mergedGroups.has(key)) {
        newExpanded.add(key)
      } else if (expandedGroups.has(key) && !mergedGroups.has(key)) {
        // Preserve expansion state for non-merged groups
        newExpanded.add(key)
      }
    })
    
    setSelectedMembers(newSelected)
    setTargetNames(newTargetNames)
    setTargetIds(newTargetIds)
    setExpandedGroups(newExpanded)
  }, [groups])

  const toggleGroup = (groupKey: string) => {
    const newExpanded = new Set(expandedGroups)
    if (newExpanded.has(groupKey)) {
      newExpanded.delete(groupKey)
    } else {
      newExpanded.add(groupKey)
    }
    setExpandedGroups(newExpanded)
  }

  const toggleMember = (groupKey: string, memberId: number) => {
    const selected = new Set(selectedMembers.get(groupKey) || [])
    const targetId = targetIds.get(groupKey)
    
    // Can't deselect the target
    if (memberId === targetId) return
    
    if (selected.has(memberId)) {
      selected.delete(memberId)
    } else {
      selected.add(memberId)
    }
    
    setSelectedMembers(new Map(selectedMembers.set(groupKey, selected)))
  }

  const setTarget = (groupKey: string, memberId: number, group: SimilarityGroup) => {
    setTargetIds(new Map(targetIds.set(groupKey, memberId)))
    
    // Ensure target is selected
    const selected = new Set(selectedMembers.get(groupKey) || [])
    selected.add(memberId)
    setSelectedMembers(new Map(selectedMembers.set(groupKey, selected)))
    
    // Update target name
    const member = group.members.find(m => m.id === memberId)
    if (member) {
      setTargetNames(new Map(targetNames.set(groupKey, member.name)))
    }
  }

  const handleMerge = async (groupIndex: number, groupKey: string) => {
    const targetId = targetIds.get(groupKey)
    const targetName = targetNames.get(groupKey)
    const selected = selectedMembers.get(groupKey) || new Set()
    
    if (!targetId || !targetName || selected.size < 2) return
    
    const sourceIds = Array.from(selected).filter(id => id !== targetId)
    
    setMerging(groupKey)
    try {
      await onMerge(targetId, targetName, sourceIds, groupIndex)
      // Mark as merged using groupKey (not index!)
      setMergedGroups(prev => new Set([...prev, groupKey]))
    } catch (error) {
      console.error('Merge error:', error)
    } finally {
      setMerging(null)
    }
  }

  const handleIgnore = (groupKey: string) => {
    setIgnoredGroups(prev => new Set([...prev, groupKey]))
    // Notify parent component so it can update saved analysis
    if (onIgnore) {
      onIgnore(groupKey)
    }
  }

  const loadPreview = async (memberId: number) => {
    if (previewMemberId === memberId) {
      // Toggle off if same member clicked
      setPreviewMemberId(null)
      setPreviewDocs([])
      return
    }
    
    setLoadingPreview(true)
    setPreviewMemberId(memberId)
    setPreviewDocs([])
    
    try {
      const params: any = { limit: 5 }
      if (entityType === 'correspondents') params.correspondent_id = memberId
      else if (entityType === 'tags') params.tag_id = memberId
      else if (entityType === 'document_types') params.document_type_id = memberId
      
      const docs = await api.getDocumentPreviews(params)
      setPreviewDocs(docs)
    } catch (error) {
      console.error('Error loading previews:', error)
      setPreviewDocs([])
    } finally {
      setLoadingPreview(false)
    }
  }

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.9) return 'text-emerald-400'
    if (confidence >= 0.7) return 'text-amber-400'
    return 'text-red-400'
  }

  const getConfidenceBg = (confidence: number) => {
    if (confidence >= 0.9) return 'bg-emerald-500/10 border-emerald-500/30'
    if (confidence >= 0.7) return 'bg-amber-500/10 border-amber-500/30'
    return 'bg-red-500/10 border-red-500/30'
  }

  // Filter out ignored groups
  const visibleGroups = groups.filter(g => !ignoredGroups.has(getGroupKey(g)))
  const ignoredCount = groups.length - visibleGroups.length

  if (visibleGroups.length === 0) {
    return (
      <div className="text-center py-12 text-surface-400">
        {ignoredCount > 0 
          ? `Alle ${ignoredCount} Vorschläge wurden ignoriert.`
          : 'Keine ähnlichen Einträge gefunden.'
        }
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Info about ignored groups */}
      {ignoredCount > 0 && (
        <div className="text-sm text-surface-400 flex items-center gap-2">
          <span>{ignoredCount} Vorschläge ignoriert</span>
          <button
            onClick={() => setIgnoredGroups(new Set())}
            className="text-primary-400 hover:text-primary-300 underline"
          >
            Alle wieder anzeigen
          </button>
        </div>
      )}
      
      {visibleGroups.map((group, index) => {
        const groupKey = getGroupKey(group)
        const isExpanded = expandedGroups.has(groupKey)
        const isMerged = mergedGroups.has(groupKey)
        const selected = selectedMembers.get(groupKey) || new Set()
        const targetId = targetIds.get(groupKey)
        const targetName = targetNames.get(groupKey) || group.suggested_name
        const totalDocs = group.members.reduce((sum, m) => sum + m.document_count, 0)

        return (
          <div
            key={groupKey}
            className={clsx(
              'card overflow-hidden transition-all duration-300',
              isMerged && 'opacity-60 border-emerald-500/50 bg-emerald-500/5'
            )}
          >
            {/* Header */}
            <div 
              className={clsx(
                'p-4 flex items-center justify-between transition-colors',
                !isMerged && 'cursor-pointer hover:bg-surface-700/30'
              )}
              onClick={() => !isMerged && toggleGroup(groupKey)}
            >
              <div className="flex items-center gap-4">
                <div className={clsx(
                  'px-3 py-1 rounded-full text-sm font-medium border',
                  getConfidenceBg(group.confidence)
                )}>
                  <span className={getConfidenceColor(group.confidence)}>
                    {Math.round(group.confidence * 100)}%
                  </span>
                </div>
                <div>
                  <h3 className="font-semibold text-surface-100">
                    {targetName}
                  </h3>
                  <p className="text-sm text-surface-400">
                    {group.members.length} Einträge · {totalDocs} Dokumente
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {isMerged && (
                  <span className="flex items-center gap-1 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-sm font-medium">
                    <Check className="w-4 h-4" />
                    Erledigt!
                  </span>
                )}
                {!isMerged && (
                  isExpanded ? (
                    <ChevronUp className="w-5 h-5 text-surface-400" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-surface-400" />
                  )
                )}
              </div>
            </div>

            {/* Content */}
            {isExpanded && !isMerged && (
              <div className="p-4 pt-0 space-y-4">
                {/* Reasoning */}
                <div className="p-3 rounded-lg bg-surface-700/30 border border-surface-600/50">
                  <p className="text-sm text-surface-300">
                    <span className="text-surface-400">KI-Begründung: </span>
                    {group.reasoning}
                  </p>
                </div>

                {/* Members */}
                <div className="space-y-2">
                  <p className="text-sm font-medium text-surface-300">
                    Wähle die zusammenzuführenden Einträge:
                  </p>
                  {group.members.map((member) => {
                    const isSelected = selected.has(member.id)
                    const isTarget = member.id === targetId
                    const showingPreview = previewMemberId === member.id
                    
                    return (
                      <div key={member.id} className="space-y-2">
                        <div
                          className={clsx(
                            'p-3 rounded-lg border transition-all duration-200 flex items-center gap-3',
                            isTarget 
                              ? 'bg-primary-500/10 border-primary-500/50' 
                              : isSelected
                                ? 'bg-surface-700/50 border-surface-500/50'
                                : 'bg-surface-800/50 border-surface-600/30 opacity-50'
                          )}
                        >
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleMember(groupKey, member.id)
                            }}
                            disabled={isTarget}
                            className={clsx(
                              'w-5 h-5 rounded border-2 flex items-center justify-center transition-colors',
                              isSelected 
                                ? 'bg-primary-500 border-primary-500' 
                                : 'border-surface-500 hover:border-surface-400'
                            )}
                          >
                            {isSelected && <Check className="w-3 h-3 text-white" />}
                          </button>
                          
                          <div className="flex-1">
                            <span className="text-surface-100">{member.name}</span>
                          </div>
                          
                          <div className="flex items-center gap-2 text-sm text-surface-400">
                            <FileText className="w-4 h-4" />
                            <span>{member.document_count ?? 0} Dok.</span>
                          </div>
                          
                          {/* Preview Button */}
                          {member.document_count > 0 && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                loadPreview(member.id)
                              }}
                              className={clsx(
                                'px-2 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1',
                                showingPreview
                                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/50'
                                  : 'bg-surface-600/50 text-surface-400 hover:bg-surface-600 hover:text-surface-200'
                              )}
                              title="Dokumente anzeigen"
                            >
                              {loadingPreview && previewMemberId === member.id ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Eye className="w-3 h-3" />
                              )}
                              <span className="hidden sm:inline">Vorschau</span>
                            </button>
                          )}
                          
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setTarget(groupKey, member.id, group)
                            }}
                            className={clsx(
                              'px-2 py-1 rounded text-xs font-medium transition-colors',
                              isTarget
                                ? 'bg-primary-500 text-white'
                                : 'bg-surface-600 text-surface-300 hover:bg-surface-500'
                            )}
                          >
                            {isTarget ? 'Ziel' : 'Als Ziel'}
                          </button>
                        </div>
                        
                        {/* Document Preview */}
                        {showingPreview && (
                          <div className="ml-8 p-3 rounded-lg bg-surface-800/80 border border-surface-600/50">
                            {loadingPreview ? (
                              <div className="flex items-center justify-center py-4">
                                <Loader2 className="w-5 h-5 animate-spin text-primary-400" />
                                <span className="ml-2 text-surface-400">Lade Dokumente...</span>
                              </div>
                            ) : previewDocs.length === 0 ? (
                              <p className="text-surface-400 text-sm">Keine Dokumente gefunden.</p>
                            ) : (
                              <div className="space-y-2">
                                <p className="text-xs text-surface-500 mb-2">
                                  Zeige {previewDocs.length} von {member.document_count} Dokumenten:
                                </p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                  {previewDocs.map(doc => (
                                    <a
                                      key={doc.id}
                                      href={doc.document_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="flex items-center gap-2 p-2 rounded bg-surface-700/50 hover:bg-surface-700 
                                                border border-surface-600/30 hover:border-primary-500/50 transition-all group"
                                    >
                                      <div className="w-10 h-10 rounded bg-surface-600 overflow-hidden flex-shrink-0">
                                        <img 
                                          src={doc.thumbnail_url}
                                          alt=""
                                          className="w-full h-full object-cover"
                                          onError={(e) => {
                                            (e.target as HTMLImageElement).style.display = 'none'
                                          }}
                                        />
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <p className="text-xs text-surface-200 truncate group-hover:text-primary-300">
                                          {doc.title}
                                        </p>
                                        <p className="text-[10px] text-surface-500">
                                          {new Date(doc.created).toLocaleDateString('de-DE')}
                                        </p>
                                      </div>
                                      <ExternalLink className="w-3 h-3 text-surface-500 group-hover:text-primary-400 flex-shrink-0" />
                                    </a>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Custom target name */}
                <div>
                  <label className="block text-sm font-medium text-surface-300 mb-2">
                    Zielname (kann angepasst werden):
                  </label>
                  <input
                    type="text"
                    value={targetName}
                    onChange={(e) => setTargetNames(new Map(targetNames.set(groupKey, e.target.value)))}
                    className="input"
                  />
                </div>

                {/* Actions */}
                <div className="flex items-center gap-3 pt-2">
                  <button
                    onClick={() => handleMerge(index, groupKey)}
                    disabled={merging !== null || selected.size < 2}
                    className="btn btn-primary flex items-center gap-2"
                  >
                    {merging === groupKey ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Zusammenführen...
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        Zusammenführen ({selected.size} Einträge)
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => handleIgnore(groupKey)}
                    className="btn btn-secondary flex items-center gap-2"
                  >
                    <X className="w-4 h-4" />
                    Ignorieren
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

