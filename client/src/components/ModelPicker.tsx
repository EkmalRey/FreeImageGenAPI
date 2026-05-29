import { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Search, Sparkles, ImageIcon, Layers } from 'lucide-react'
import { cn } from '@/lib/utils'

interface FallbackEntry {
  modelDbId: number
  priority: number
  enabled: boolean
  platform: string
  modelId: string
  displayName: string
  sizeLabel: string
  taskType: string
  keyCount: number
}

interface ModelPickerProps {
  models: FallbackEntry[]
  value: string
  onChange: (modelId: string) => void
  hasImage?: boolean
}

const platformAccent: Record<string, string> = {
  cloudflare: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
  google: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  groq: 'bg-red-500/15 text-red-600 dark:text-red-400',
  cerebras: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
  sambanova: 'bg-teal-500/15 text-teal-600 dark:text-teal-400',
  nvidia: 'bg-lime-500/15 text-lime-600 dark:text-lime-400',
  mistral: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  openrouter: 'bg-pink-500/15 text-pink-600 dark:text-pink-400',
  cohere: 'bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400',
  github: 'bg-slate-500/15 text-slate-600 dark:text-slate-400',
  pollinations: 'bg-purple-500/15 text-purple-600 dark:text-purple-400',
  llm7: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  huggingface: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
}

function useRepositionOnScroll(
  open: boolean,
  triggerRef: React.RefObject<HTMLButtonElement | null>,
  setStyle: (style: React.CSSProperties) => void
) {
  useEffect(() => {
    if (!open) return
    function reposition() {
      const el = triggerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const gap = 6
      const prefHeight = 360
      const spaceBelow = window.innerHeight - rect.bottom
      const spaceAbove = rect.top

      if (spaceBelow >= prefHeight) {
        setStyle({
          position: 'fixed',
          top: `${rect.bottom + gap}px`,
          left: `${rect.left}px`,
          width: `${Math.max(rect.width, 320)}px`,
          maxHeight: `${Math.min(prefHeight, spaceBelow - gap)}px`,
        })
      } else {
        setStyle({
          position: 'fixed',
          top: `${Math.max(gap, rect.top - prefHeight)}px`,
          left: `${rect.left}px`,
          width: `${Math.max(rect.width, 320)}px`,
          maxHeight: `${Math.min(prefHeight, spaceAbove - gap)}px`,
        })
      }
    }
    reposition()
    window.addEventListener('scroll', reposition, { capture: true })
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('scroll', reposition, { capture: true })
      window.removeEventListener('resize', reposition)
    }
  }, [open, triggerRef, setStyle])
}

function ModelPicker({ models, value, onChange, hasImage }: ModelPickerProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [highlightIdx, setHighlightIdx] = useState<number>(-1)
  const [posStyle, setPosStyle] = useState<React.CSSProperties>({})

  useRepositionOnScroll(open, triggerRef, setPosStyle)

  const textToImage = useMemo(() =>
    models.filter(m => m.taskType === 'text-to-image'),
    [models]
  )
  const imgToImg = useMemo(() =>
    models.filter(m => m.taskType === 'img2img'),
    [models]
  )

  const filterModels = (list: FallbackEntry[]) => {
    if (!search) return list
    const q = search.toLowerCase()
    return list.filter(m =>
      m.displayName.toLowerCase().includes(q) ||
      m.platform.toLowerCase().includes(q) ||
      m.modelId.toLowerCase().includes(q)
    )
  }

  const filteredTxt = filterModels(textToImage)
  const filteredImg = filterModels(imgToImg)

  const flatItems = useMemo(() => {
    const items: Array<{ type: 'auto' | 'txt-header' | 'img-header' | 'model'; model?: FallbackEntry }> = []
    items.push({ type: 'auto' })
    if (filteredTxt.length > 0) {
      items.push({ type: 'txt-header' })
      filteredTxt.forEach(m => items.push({ type: 'model', model: m }))
    }
    if (filteredImg.length > 0) {
      items.push({ type: 'img-header' })
      filteredImg.forEach(m => items.push({ type: 'model', model: m }))
    }
    return items
  }, [filteredTxt, filteredImg])

  const activeModel = value === 'auto'
    ? null
    : models.find(m => m.modelId === value)

  const activeLabel = value === 'auto'
    ? 'Auto'
    : activeModel?.displayName ?? value

  const activeTaskType = value === 'auto'
    ? (hasImage ? 'img2img' : 'text-to-image')
    : activeModel?.taskType ?? 'text-to-image'

  useEffect(() => {
    if (open) {
      setSearch('')
      setHighlightIdx(-1)
      setTimeout(() => searchRef.current?.focus(), 50)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault()
        setOpen(true)
      }
      return
    }

    if (e.key === 'Escape') {
      setOpen(false)
      triggerRef.current?.focus()
      return
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightIdx(prev => Math.min(prev + 1, flatItems.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightIdx(prev => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = flatItems[highlightIdx]
      if (item?.type === 'auto') {
        onChange('auto')
        setOpen(false)
      } else if (item?.type === 'model' && item.model) {
        onChange(item.model.modelId)
        setOpen(false)
      }
    }
  }

  return (
    <div className="inline-flex">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        onKeyDown={handleKeyDown}
        className={cn(
          'flex items-center gap-2 rounded-lg border border-input bg-transparent px-3 h-10 text-sm font-medium',
          'transition-colors outline-none select-none',
          'hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
          'w-[180px] lg:w-[220px]'
        )}
      >
        <span className="flex items-center gap-1.5 min-w-0">
          {value === 'auto' ? (
            <Sparkles className="size-3.5 text-muted-foreground shrink-0" />
          ) : activeTaskType === 'img2img' ? (
            <ImageIcon className="size-3.5 text-amber-500 shrink-0" />
          ) : (
            <Layers className="size-3.5 text-blue-500 shrink-0" />
          )}
          <span className="truncate">{activeLabel}</span>
        </span>
        {activeModel && (
          <span className="text-[9px] text-muted-foreground uppercase tracking-wider shrink-0">
            {activeModel.platform}
          </span>
        )}
        <ChevronDown className={cn(
          'size-3.5 text-muted-foreground shrink-0 transition-transform duration-200',
          open && 'rotate-180'
        )} />
      </button>

      {open && createPortal(
        <div
          ref={dropdownRef}
          style={posStyle}
          className="z-[100] rounded-xl bg-popover border border-border shadow-lg shadow-black/10 flex flex-col animate-in fade-in-0 zoom-in-95 duration-150"
        >
          <div className="shrink-0 p-2 border-b border-border/50">
            <div className="flex items-center gap-2 px-2.5 h-8 rounded-lg bg-muted/50 text-muted-foreground">
              <Search className="size-3.5 shrink-0" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={e => { setSearch(e.target.value); setHighlightIdx(-1) }}
                onKeyDown={handleKeyDown}
                placeholder="Search models..."
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto py-1 scrollbar-styled" onMouseLeave={() => setHighlightIdx(-1)}>
            <button
              type="button"
              className={cn(
                'flex items-center gap-3 w-full px-3 py-2 text-left text-sm transition-colors',
                highlightIdx === 0 ? 'bg-accent/60' : 'hover:bg-accent/40',
                value === 'auto' && 'bg-accent'
              )}
              onMouseEnter={() => setHighlightIdx(0)}
              onClick={() => { onChange('auto'); setOpen(false) }}
            >
              <span className="flex items-center justify-center size-7 rounded-lg bg-primary/10 shrink-0">
                <Sparkles className="size-3.5 text-primary" />
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">Auto</div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {hasImage ? 'Routes to img2img models' : 'Routes via fallback chain'}
                </div>
              </div>
              {value === 'auto' && (
                <span className="size-1.5 rounded-full bg-primary shrink-0" />
              )}
            </button>

            {filteredTxt.length > 0 && (
              <>
                <div className="px-3 pt-3 pb-1.5 border-t border-border/40 mt-1">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    <Layers className="size-3" />
                    Text to Image
                  </div>
                </div>
                {filteredTxt.map(m => {
                  const idx = flatItems.findIndex(f => f.type === 'model' && f.model?.modelDbId === m.modelDbId)
                  return (
                    <ModelOption
                      key={m.modelDbId}
                      model={m}
                      selected={value === m.modelId}
                      highlighted={highlightIdx === idx}
                      onHover={() => setHighlightIdx(idx)}
                      onSelect={() => { onChange(m.modelId); setOpen(false) }}
                    />
                  )
                })}
              </>
            )}

            {filteredImg.length > 0 && (
              <>
                <div className="px-3 pt-3 pb-1.5 border-t border-border/40 mt-1">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    <ImageIcon className="size-3" />
                    Image to Image
                  </div>
                </div>
                {filteredImg.map(m => {
                  const idx = flatItems.findIndex(f => f.type === 'model' && f.model?.modelDbId === m.modelDbId)
                  return (
                    <ModelOption
                      key={m.modelDbId}
                      model={m}
                      selected={value === m.modelId}
                      highlighted={highlightIdx === idx}
                      onHover={() => setHighlightIdx(idx)}
                      onSelect={() => { onChange(m.modelId); setOpen(false) }}
                    />
                  )
                })}
              </>
            )}

            {filteredTxt.length === 0 && filteredImg.length === 0 && (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                No models match "{search}"
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

function ModelOption({
  model,
  selected,
  highlighted,
  onHover,
  onSelect,
}: {
  model: FallbackEntry
  selected: boolean
  highlighted: boolean
  onHover: () => void
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      className={cn(
        'flex items-center gap-2.5 w-full px-3 py-2 text-left text-sm transition-colors',
        highlighted ? 'bg-accent/60' : 'hover:bg-accent/40',
        selected && 'bg-accent'
      )}
      onMouseEnter={onHover}
      onClick={onSelect}
    >
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <span className={cn('font-medium truncate', selected && 'text-foreground')}>
          {model.displayName}
        </span>
        <span className={cn(
          'text-[9px] px-1 py-0.5 rounded font-medium uppercase tracking-wider shrink-0',
          platformAccent[model.platform] ?? 'bg-muted text-muted-foreground'
        )}>
          {model.platform}
        </span>
      </div>
      {selected && (
        <span className="size-1.5 rounded-full bg-primary shrink-0" />
      )}
    </button>
  )
}

export { ModelPicker }
export type { FallbackEntry }
