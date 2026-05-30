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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

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
  keyCount: number
  keyHealth: {
    healthy: number
    rateLimited: number
    invalid: number
    error: number
  }
  successRate: number | null
  lastUsed: string | null
}

function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'never'
  const diff = Date.now() - new Date(dateStr + 'Z').getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
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

function MetaItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] leading-none text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium leading-none truncate">{children}</div>
    </div>
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

  const healthEntries = [
    { count: entry.keyHealth.healthy, label: 'healthy', title: 'Healthy keys', color: 'emerald' },
    { count: entry.keyHealth.rateLimited, label: 'limited', title: 'Rate-limited keys', color: 'amber' },
    { count: entry.keyHealth.invalid, label: 'invalid', title: 'Invalid keys', color: 'red' },
    { count: entry.keyHealth.error, label: 'error', title: 'Error keys', color: 'red' },
  ].filter(h => h.count > 0)

  const healthTooltip = entry.keyCount > 0
    ? `Keys for ${entry.platform}: ${entry.keyHealth.healthy} healthy, ${entry.keyHealth.rateLimited} rate-limited, ${entry.keyHealth.invalid} invalid, ${entry.keyHealth.error} error`
    : ''

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group px-4 py-4 bg-card ${isDragging ? 'opacity-50' : ''} ${entry.enabled ? '' : 'opacity-60'}`}
    >
      <div className="flex items-start gap-3">
        <button
          {...attributes}
          {...listeners}
          className="mt-1 cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-foreground transition-colors"
          aria-label="Drag to reorder"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" />
            <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
            <circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" />
          </svg>
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-mono text-muted-foreground shrink-0">
              #{index + 1}
            </span>
            <span className="truncate text-sm font-semibold">{entry.displayName}</span>

            <div className="ml-auto flex items-center gap-1.5 shrink-0">
              <span
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] tabular-nums whitespace-nowrap w-[72px] justify-center ${
                  entry.lastUsed !== null
                    ? 'text-muted-foreground'
                    : 'border-muted text-muted-foreground/50'
                }`}
                title={entry.lastUsed ? `Last used: ${entry.lastUsed}` : 'Never used'}
              >
                <span className={`size-1.5 rounded-full shrink-0 ${entry.lastUsed !== null ? 'bg-muted-foreground/40' : 'bg-muted-foreground/20'}`} />
                {entry.lastUsed !== null ? timeAgo(entry.lastUsed) : 'never'}
              </span>

              {(() => {
                const rate = entry.successRate ?? (entry.lastUsed !== null ? null : 0)
                const wasUsed = entry.lastUsed !== null
                const isZeroFromNoUse = rate === 0 && !wasUsed
                return (
                  <span
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium tabular-nums whitespace-nowrap w-[128px] justify-center ${
                      isZeroFromNoUse
                        ? 'border-muted text-muted-foreground/50'
                        : rate >= 90
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                          : rate >= 70
                            ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                            : 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300'
                    }`}
                    title={`${rate}% success rate`}
                  >
                    <span className={`size-1.5 rounded-full shrink-0 ${
                      isZeroFromNoUse ? 'bg-muted-foreground/20' : rate >= 90 ? 'bg-emerald-500' : rate >= 70 ? 'bg-amber-500' : 'bg-red-500'
                    }`} />
                    {rate}% success rate
                  </span>
                )
              })()}

              {healthEntries.map(h => (
                <span
                  key={h.label}
                  className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs tabular-nums whitespace-nowrap w-[72px] justify-center ${
                    h.color === 'emerald'
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                      : h.color === 'amber'
                      ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                      : 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300'
                  }`}
                  title={healthTooltip}
                >
                  <span className={`size-1.5 rounded-full shrink-0 ${
                    h.color === 'emerald' ? 'bg-emerald-500' : h.color === 'amber' ? 'bg-amber-500' : 'bg-red-500'
                  }`} />
                  {h.count} {h.label}
                </span>
              ))}

              <Switch
                checked={entry.enabled}
                onCheckedChange={(checked) => onToggle(entry.modelDbId, checked)}
              />
            </div>
          </div>

          {entry.penalty > 0 && (
            <div className="mt-2 inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
              Penalty {entry.penalty}
            </div>
          )}

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
        </div>
      </div>
    </div>
  )
}

export default function FallbackPage() {
  const queryClient = useQueryClient()
  const [localEntries, setLocalEntries] = useState<FallbackEntry[] | null>(null)
  const [platformFilter, setPlatformFilter] = useState<string>('all')

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
    },
  })

  const allEntries = localEntries ?? entries
  const displayEntries = allEntries.filter(e => e.keyCount > 0)
  const unconfiguredPlatforms = [...new Set(allEntries.filter(e => e.keyCount === 0).map(e => e.platform))]

  const totalModels = allEntries.length
  const enabledModels = allEntries.filter(e => e.enabled).length
  const disabledModels = totalModels - enabledModels

  const platforms = [...new Set(displayEntries.map(e => e.platform))].sort()
  const filteredEntries = platformFilter === 'all' ? displayEntries : displayEntries.filter(e => e.platform === platformFilter)

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

  function handleBatchToggle(platform: string | null, enabled: boolean) {
    const updated = allEntries.map(e => {
      if (platform === null) return { ...e, enabled }
      if (e.platform === platform) return { ...e, enabled }
      return e
    })
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
        description="Drag to reorder. Requests try models top-to-bottom until one succeeds."
        actions={
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground mr-2">
              <span className="inline-flex items-center rounded-md border px-2 py-0.5 font-medium tabular-nums">{totalModels} total</span>
              <span className="inline-flex items-center rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-emerald-700 dark:text-emerald-300 font-medium tabular-nums">{enabledModels} on</span>
              <span className="inline-flex items-center rounded-md border border-muted px-2 py-0.5 font-medium tabular-nums">{disabledModels} off</span>
            </div>
            <Select value={platformFilter} onValueChange={setPlatformFilter}>
              <SelectTrigger size="sm">
                <SelectValue placeholder="All platforms" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All platforms</SelectItem>
                {platforms.map(p => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select onValueChange={(v) => {
              if (v === 'enable-all') handleBatchToggle(null, true)
              else if (v === 'disable-all') handleBatchToggle(null, false)
              else if (v.startsWith('enable-')) handleBatchToggle(v.replace('enable-', ''), true)
              else if (v.startsWith('disable-')) handleBatchToggle(v.replace('disable-', ''), false)
            }}>
              <SelectTrigger size="sm">
                <SelectValue placeholder="Batch actions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="enable-all">Enable all</SelectItem>
                <SelectItem value="disable-all">Disable all</SelectItem>
                {platforms.map(p => (
                  <SelectItem key={p} value={`enable-${p}`}>Enable all {p}</SelectItem>
                ))}
                {platforms.map(p => (
                  <SelectItem key={`d-${p}`} value={`disable-${p}`}>Disable all {p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select onValueChange={(v) => sortMutation.mutate(v)} disabled={sortMutation.isPending}>
              <SelectTrigger size="sm">
                <SelectValue placeholder="Sort by..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="intelligence">Sort by intelligence</SelectItem>
                <SelectItem value="speed">Sort by speed</SelectItem>
                <SelectItem value="budget">Sort by budget</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
      />

      <div className="space-y-6">
        {tokenUsage && tokenUsage.totalBudget > 0 && (
          <TokenUsageBar data={tokenUsage} />
        )}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : filteredEntries.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No models available. Add API keys on the <a href="/keys" className="underline text-foreground">Keys page</a> first.
            </p>
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
                  items={filteredEntries.map(e => e.modelDbId)}
                  strategy={verticalListSortingStrategy}
                >
                  {filteredEntries.map((entry, index) => (
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
