import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PageHeader } from '@/components/page-header'

interface FallbackEntry {
  modelDbId: number
  priority: number
  enabled: boolean
  platform: string
  modelId: string
  displayName: string
  sizeLabel: string
  keyCount: number
}

interface ImageGeneration {
  prompt: string
  url?: string
  b64_json?: string
  error?: string
  meta?: {
    platform?: string
    model?: string
    latency?: number
    fallbackAttempts?: number
  }
}

export default function PlaygroundPage() {
  const [generations, setGenerations] = useState<ImageGeneration[]>([])
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [selectedModel, setSelectedModel] = useState<string>('auto')
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const { data: keyData } = useQuery<{ apiKey: string }>({
    queryKey: ['unified-key'],
    queryFn: () => apiFetch('/api/settings/api-key'),
  })

  const { data: fallbackEntries = [] } = useQuery<FallbackEntry[]>({
    queryKey: ['fallback'],
    queryFn: () => apiFetch('/api/fallback'),
  })

  const availableModels = fallbackEntries.filter(e => e.keyCount > 0 && e.enabled)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [generations])

  const handleGenerate = async () => {
    const text = prompt.trim()
    if (!text || loading) return

    const newGen: ImageGeneration = { prompt: text }
    const updated = [...generations, newGen]
    setGenerations(updated)
    setPrompt('')
    setLoading(true)

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (keyData?.apiKey) headers['Authorization'] = `Bearer ${keyData.apiKey}`

      const body: any = { prompt: text, n: 1, size: '1024x1024', response_format: 'url' }
      if (selectedModel !== 'auto') body.model = selectedModel

      const base = import.meta.env.BASE_URL.replace(/\/$/, '')
      const start = Date.now()
      const res = await fetch(`${base}/v1/images/generations`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })

      const latency = Date.now() - start
      const routedVia = res.headers.get('X-Routed-Via')
      const fallbackAttempts = res.headers.get('X-Fallback-Attempts')

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }))
        updated[updated.length - 1].error = `Error: ${err.error?.message ?? 'Unknown error'}`
        setGenerations([...updated])
        return
      }

      const data = await res.json()
      const image = data.data?.[0]
      const via = data._routed_via ?? (routedVia ? {
        platform: routedVia.split('/')[0],
        model: routedVia.split('/').slice(1).join('/'),
      } : undefined)

      updated[updated.length - 1].url = image?.url
      updated[updated.length - 1].b64_json = image?.b64_json
      updated[updated.length - 1].meta = {
        platform: via?.platform,
        model: via?.model,
        latency,
        fallbackAttempts: fallbackAttempts ? parseInt(fallbackAttempts) : undefined,
      }
      setGenerations([...updated])
    } catch (err: any) {
      updated[updated.length - 1].error = `Error: ${err.message}`
      setGenerations([...updated])
    } finally {
      setLoading(false)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleGenerate()
    }
  }

  const activeModelLabel = selectedModel === 'auto'
    ? 'Auto (fallback chain)'
    : availableModels.find(m => m.modelId === selectedModel)?.displayName ?? selectedModel

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      <PageHeader
        title="Image Playground"
        description="Generate images using the proxy router."
        actions={
          <>
            <Select value={selectedModel} onValueChange={(v) => setSelectedModel(v ?? 'auto')}>
              <SelectTrigger className="w-[260px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto (fallback chain)</SelectItem>
                {availableModels.map(m => (
                  <SelectItem key={m.modelDbId} value={m.modelId}>
                    <span className="flex items-center gap-2">
                      <span>{m.displayName}</span>
                      <span className="text-xs text-muted-foreground">{m.platform}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {generations.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => setGenerations([])}>
                Clear
              </Button>
            )}
          </>
        }
      />

      <div className="flex-1 flex flex-col rounded-lg border bg-card overflow-hidden min-h-0">
        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          {generations.length === 0 ? (
            <div className="flex items-center justify-center h-full text-center">
              <div className="space-y-2 max-w-sm">
                <p className="text-base font-medium">Enter a prompt to generate an image.</p>
                <p className="text-sm text-muted-foreground">
                  Using <span className="text-foreground">{activeModelLabel}</span>
                </p>
              </div>
            </div>
          ) : (
            <>
              {generations.map((gen, i) => (
                <div key={i} className="flex flex-col items-center border rounded-lg p-4 bg-background">
                  <div className="w-full text-center mb-4 text-sm font-medium">"{gen.prompt}"</div>
                  
                  {gen.error ? (
                    <div className="text-destructive text-sm p-4 bg-destructive/10 rounded">{gen.error}</div>
                  ) : !gen.url && !gen.b64_json ? (
                    <div className="animate-pulse bg-muted rounded-md w-[512px] h-[512px] flex items-center justify-center">
                      <span className="text-muted-foreground">Generating...</span>
                    </div>
                  ) : (
                    <img
                      src={gen.url || `data:image/jpeg;base64,${gen.b64_json}`}
                      alt={gen.prompt}
                      className="max-w-full max-h-[512px] rounded-md shadow-md object-contain bg-muted"
                    />
                  )}

                  {gen.meta && (
                    <div className="flex items-center gap-2 mt-4 flex-wrap text-xs text-muted-foreground tabular-nums">
                      {gen.meta.platform && <span className="font-semibold">{gen.meta.platform}</span>}
                      {gen.meta.model && <span className="font-mono">· {gen.meta.model}</span>}
                      {gen.meta.latency != null && <span>· {gen.meta.latency} ms</span>}
                      {gen.meta.fallbackAttempts != null && gen.meta.fallbackAttempts > 0 && (
                        <span>· {gen.meta.fallbackAttempts} fallback{gen.meta.fallbackAttempts > 1 ? 's' : ''}</span>
                      )}
                    </div>
                  )}
                </div>
              ))}
              <div ref={endRef} />
            </>
          )}
        </div>

        <div className="border-t bg-background/50 p-3">
          <div className="flex gap-2 items-end">
            <textarea
              ref={inputRef}
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="A futuristic city cyberpunk style..."
              rows={1}
              className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50 min-h-[40px] max-h-[160px]"
              style={{ height: 'auto', overflow: 'hidden' }}
              onInput={e => {
                const el = e.target as HTMLTextAreaElement
                el.style.height = 'auto'
                el.style.height = Math.min(el.scrollHeight, 160) + 'px'
              }}
            />
            <Button onClick={handleGenerate} disabled={loading || !prompt.trim()} size="default">
              {loading ? 'Generating…' : 'Generate'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
