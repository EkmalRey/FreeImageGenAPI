import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { PageHeader } from '@/components/page-header'

interface FallbackEntry {
  modelDbId: number
  priority: number
  effectivePriority: number
  penalty: number
  rateLimitHits: number
  enabled: boolean
  platform: string
  modelId: string
  displayName: string
  intelligenceRank: number
  speedRank: number
  sizeLabel: string
  taskType: string
  rpmLimit: number | null
  rpdLimit: number | null
  monthlyTokenBudget: string
  totalRequests: number
  successRate: number
  avgLatencyMs: number
  keyCount: number
  keyHealth: {
    healthy: number
    rateLimited: number
    invalid: number
    error: number
  }
}

function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

interface TokenUsageData {
  totalBudget: number
  totalUsed: number
  models: { displayName: string; platform: string; budget: number }[]
}

const platformColors: Record<string, string> = {
  google:      '#4285f4',
  groq:        '#f55036',
  cerebras:    '#8b5cf6',
  sambanova:   '#14b8a6',
  nvidia:      '#76b900',
  mistral:     '#f59e0b',
  openrouter:  '#ec4899',
  github:      '#6e7b8b',
  cohere:      '#d946ef',
  cloudflare:  '#f38020',
  zhipu:       '#06b6d4',
  ollama:      '#000000',
  kilo:        '#7c3aed',
  pollinations: '#a855f7',
  llm7:        '#0ea5e9',
  huggingface: '#ff9d00',
}

function TokenUsageBar({ data }: { data: TokenUsageData }) {
  const { totalBudget, totalUsed, models } = data
  const remaining = Math.max(0, totalBudget - totalUsed)
  const remainingPct = totalBudget > 0 ? Math.round((remaining / totalBudget) * 100) : 0

  const modelsWithWidth = models.map(m => ({
    ...m,
    remainingTokens: totalBudget > 0 ? (m.budget / totalBudget) * remaining : 0,
    widthPct: totalBudget > 0 ? (m.budget / totalBudget) * (remaining / totalBudget) * 100 : 0,
  }))
  const usedPct = totalBudget > 0 ? (totalUsed / totalBudget) * 100 : 0

  return (
    <section className="rounded-lg border bg-card p-5">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-sm font-medium">Token budget remaining</h2>
        <span className="text-xs text-muted-foreground tabular-nums">
          <span className="text-foreground font-medium">{formatTokens(remaining)}</span> remaining
          <span className="mx-1.5">·</span>
          {remainingPct}% of {formatTokens(totalBudget)}
        </span>
      </div>

      <div className="flex h-2.5 rounded-full overflow-hidden bg-muted">
        {modelsWithWidth.map((m, i) => (
          <div
            key={i}
            title={`${m.displayName} (${m.platform}) — ${formatTokens(m.remainingTokens)} remaining`}
            style={{
              width: `${m.widthPct}%`,
              backgroundColor: platformColors[m.platform] ?? '#94a3b8',
            }}
          />
        ))}
        {totalUsed > 0 && (
          <div
            title={`Used — ${formatTokens(totalUsed)}`}
            className="bg-muted-foreground/30"
            style={{ width: `${usedPct}%` }}
          />
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-1.5 text-xs tabular-nums">
        {modelsWithWidth.map((m, i) => (
          <div key={i} className="flex items-center gap-2 min-w-0">
            <span
              className="size-2 rounded-sm flex-shrink-0"
              style={{ backgroundColor: platformColors[m.platform] ?? '#94a3b8' }}
            />
            <span className="truncate">{m.displayName}</span>
            <span className="flex-1" />
            <span className="font-mono text-muted-foreground">{formatTokens(m.remainingTokens)}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function SortableModelRow({
  entry,
  index,
  onToggle,
}: {
  entry: FallbackEntry
  index: number
  onToggle: (modelDbId: number, enabled: boolean) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: entry.modelDbId,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const okKeys = entry.keyHealth.healthy + entry.keyHealth.rateLimited
  const totalKeys = okKeys + entry.keyHealth.invalid + entry.keyHealth.error

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative flex ${isDragging ? 'opacity-50 z-10' : ''} ${entry.enabled ? '' : 'opacity-60'}`}
    >
      {/* Priority bar */}
      <div
        className="w-1 flex-shrink-0 rounded-l-xl"
        style={{
          opacity: entry.enabled ? 1 : 0.3,
          background: `linear-gradient(to bottom, hsl(var(--foreground)), hsl(var(--muted-foreground)))`,
        }}
      />

      <div className="flex-1 min-w-0 px-4 py-4 bg-card">
        <div className="flex items-start gap-3">
          {/* Drag handle */}
          <button
            {...attributes}
            {...listeners}
            className="mt-0.5 flex items-center justify-center size-7 rounded-md border border-transparent hover:border-border hover:bg-muted transition-all cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-foreground"
            aria-label="Drag to reorder"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" />
              <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
              <circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" />
            </svg>
          </button>

          <div className="flex-1 min-w-0">
            {/* Top row: priority, name, health, switch */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-mono text-muted-foreground">
                #{index + 1}
              </span>
              <span className="truncate text-sm font-semibold">{entry.displayName}</span>

              {/* Compact key health chip */}
              {entry.keyCount > 0 && (
                <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium tabular-nums ${
                  entry.keyHealth.healthy > 0
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                }`}>
                  <span className={`size-1.5 rounded-full ${
                    entry.keyHealth.healthy > 0 ? 'bg-emerald-500' : 'bg-amber-500'
                  }`} />
                  {entry.keyHealth.healthy}/{totalKeys} ok
                </span>
              )}

              {entry.keyHealth.rateLimited > 0 && (
                <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                  <span className="size-1.5 rounded-full bg-amber-500" />
                  {entry.keyHealth.rateLimited} limited
                </span>
              )}

              {entry.keyHealth.error > 0 && (
                <span className="inline-flex items-center gap-1 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-300">
                  <span className="size-1.5 rounded-full bg-red-500" />
                  {entry.keyHealth.error} error
                </span>
              )}

              <Switch
                checked={entry.enabled}
                onCheckedChange={(checked) => onToggle(entry.modelDbId, checked)}
              />
            </div>

            {/* Penalty */}
            {entry.penalty > 0 && (
              <div className="mt-2 inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                Penalty {entry.penalty}
              </div>
            )}

            {/* Metadata grid */}
            <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-6">
              <MetaItem label="Provider">{entry.platform}</MetaItem>
              <MetaItem label="Intelligence">#{entry.intelligenceRank}</MetaItem>
              <MetaItem label="Speed">#{entry.speedRank}</MetaItem>
              <MetaItem label="Task">
                <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${entry.taskType === 'img2img' ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300'}`}>
                  {entry.taskType === 'img2img' ? 'img2img' : 'txt2img'}
                </span>
              </MetaItem>
              <MetaItem label="Rate limits">
                {entry.rpmLimit || entry.rpdLimit ? (
                  <span>{entry.rpmLimit ?? '—'} rpm · {entry.rpdLimit ?? '—'} rpd</span>
                ) : (
                  <span className="text-muted-foreground">No limits</span>
                )}
              </MetaItem>
              <MetaItem label="Budget">{entry.monthlyTokenBudget || '—'}</MetaItem>
            </div>

            {/* Performance stats row */}
            <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
              <span className="inline-flex items-center gap-1">
                <span className="font-medium text-foreground">{formatTokens(entry.totalRequests)}</span> requests
              </span>
              {entry.totalRequests > 0 && (
                <span className="inline-flex items-center gap-1">
                  <span className={`font-medium ${entry.successRate >= 90 ? 'text-emerald-600 dark:text-emerald-400' : entry.successRate >= 70 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}>
                    {entry.successRate}%
                  </span> success
                </span>
              )}
              {entry.avgLatencyMs > 0 && (
                <span className="inline-flex items-center gap-1">
                  <span className="font-medium text-foreground">{entry.avgLatencyMs}</span> ms avg
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function MetaItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] leading-none text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium leading-none truncate">{children}</div>
    </div>
  )
}

export default function FallbackPage() {
  const queryClient = useQueryClient()
  const [localEntries, setLocalEntries] = useState<FallbackEntry[] | null>(null)
  const [sortPreset, setSortPreset] = useState<string | null>(null)

  const { data: entries = [], isLoading } = useQuery<FallbackEntry[]>({
    queryKey: ['fallback'],
    queryFn: () => apiFetch('/api/fallback'),
  })

  const { data: tokenUsage } = useQuery<TokenUsageData>({
    queryKey: ['fallback', 'token-usage'],
    queryFn: () => apiFetch('/api/fallback/token-usage'),
  })

  const saveMutation = useMutation({
    mutationFn: (data: { modelDbId: number; priority: number; enabled: boolean }[]) =>
      apiFetch('/api/fallback', { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fallback'] })
      setLocalEntries(null)
    },
  })

  const sortMutation = useMutation({
    mutationFn: (preset: string) =>
      apiFetch(`/api/fallback/sort/${preset}`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fallback'] })
      setLocalEntries(null)
      setSortPreset(null)
    },
  })

  const allEntries = localEntries ?? entries
  const displayEntries = allEntries.filter(e => e.keyCount > 0)
  const unconfiguredPlatforms = [...new Set(allEntries.filter(e => e.keyCount === 0).map(e => e.platform))]

  const activeCount = allEntries.filter(e => e.enabled).length
  const totalCount = allEntries.length

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = displayEntries.findIndex(e => e.modelDbId === active.id)
    const newIndex = displayEntries.findIndex(e => e.modelDbId === over.id)
    const reorderedVisible = arrayMove(displayEntries, oldIndex, newIndex)
    const unconfigured = allEntries.filter(e => e.keyCount === 0)
    const merged = [
      ...reorderedVisible.map((e, i) => ({ ...e, priority: i + 1 })),
      ...unconfigured.map((e, i) => ({ ...e, priority: reorderedVisible.length + i + 1 })),
    ]
    setLocalEntries(merged)
  }

  function handleToggle(modelDbId: number, enabled: boolean) {
    const updated = allEntries.map(e =>
      e.modelDbId === modelDbId ? { ...e, enabled } : e
    )
    setLocalEntries(updated)
  }

  function handleSave() {
    if (!localEntries) return
    saveMutation.mutate(
      allEntries.map(e => ({
        modelDbId: e.modelDbId,
        priority: e.priority,
        enabled: e.enabled,
      }))
    )
  }

  const hasChanges = localEntries !== null

  return (
    <div>
      <PageHeader
        title="Fallback chain"
        description={`${activeCount}/${totalCount} models active · Drag to reorder · Requests try top-to-bottom`}
        actions={
          <div className="flex items-center gap-2">
            {/* Segmented sort control */}
            <div className="inline-flex rounded-md border bg-muted p-0.5">
              {[
                { key: 'intelligence', label: 'Intel' },
                { key: 'speed', label: 'Speed' },
                { key: 'budget', label: 'Budget' },
              ].map(s => (
                <button
                  key={s.key}
                  onClick={() => {
                    setSortPreset(s.key)
                    sortMutation.mutate(s.key)
                  }}
                  disabled={sortMutation.isPending}
                  className={`px-2.5 py-1 text-xs font-medium rounded-[5px] transition-colors ${
                    sortPreset === s.key
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        }
      />

      <div className="space-y-6">
        {tokenUsage && tokenUsage.totalBudget > 0 && (
          <TokenUsageBar data={tokenUsage} />
        )}

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />
            ))}
          </div>
        ) : displayEntries.length === 0 ? (
          <div className="rounded-xl border border-dashed p-12 text-center space-y-4">
            <div className="mx-auto size-12 rounded-full bg-muted flex items-center justify-center">
              <svg className="size-6 text-muted-foreground" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5 7.5 3m0 0L12 7.5M7.5 3v13.5m13.5-6L16.5 18m0 0L12 13.5m4.5 4.5V6" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium">No models available</p>
              <p className="text-sm text-muted-foreground mt-1">
                Add API keys on the <a href="/keys" className="underline text-foreground hover:text-foreground/80">Keys page</a> to populate the fallback chain.
              </p>
            </div>
            <a
              href="/keys"
              className="inline-flex items-center justify-center h-7 gap-1 rounded-lg border border-border bg-background px-2.5 text-[0.8rem] font-medium text-foreground hover:bg-muted transition-colors"
            >
              Go to Keys
            </a>
          </div>
        ) : (
          <>
            <div className="rounded-xl border divide-y overflow-hidden">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={displayEntries.map(e => e.modelDbId)}
                  strategy={verticalListSortingStrategy}
                >
                  {displayEntries.map((entry, index) => (
                    <SortableModelRow
                      key={entry.modelDbId}
                      entry={entry}
                      index={index}
                      onToggle={handleToggle}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            </div>

            {hasChanges && (
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setLocalEntries(null)}>
                  Discard
                </Button>
                <Button size="sm" onClick={handleSave} disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? 'Saving…' : 'Save order'}
                </Button>
              </div>
            )}

            {unconfiguredPlatforms.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Hidden (no keys): {unconfiguredPlatforms.join(', ')}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
