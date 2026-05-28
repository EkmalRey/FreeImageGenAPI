import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'

interface ChatSession {
  id: string
  name: string
  selectedModel: string
  createdAt: string
  updatedAt: string
  imageCount: number
  lastImage: string | null
}

interface ChatMessage {
  id: number
  role: 'user' | 'assistant'
  prompt: string | null
  imageUrl: string | null
  imageB64: string | null
  revisedPrompt: string | null
  platform: string | null
  model: string | null
  latencyMs: number | null
  fileSizeKb: number | null
  dimensions: string | null
  error: string | null
  createdAt: string
}

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

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  return apiFetch<T>(url, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  })
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffHrs = diffMs / (1000 * 60 * 60)
  const diffDays = diffHrs / 24

  if (diffHrs < 1) return `${Math.max(1, Math.round(diffMs / (1000 * 60)))}m ago`
  if (diffHrs < 24) return `${Math.round(diffHrs)}h ago`
  if (diffDays < 2) return 'Yesterday'
  if (diffDays < 7) return d.toLocaleDateString('en', { weekday: 'long' })
  return d.toLocaleDateString('en', { month: 'short', day: 'numeric' })
}

export default function PlaygroundPage() {
  const queryClient = useQueryClient()
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [selectedModel, setSelectedModel] = useState<string>('auto')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const creatingRef = useRef(false)
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

  const { data: sessions = [], isLoading: sessionsLoading } = useQuery<ChatSession[]>({
    queryKey: ['chat-sessions'],
    queryFn: () => apiFetch('/api/chats'),
  })

  const availableModels = fallbackEntries.filter(e => e.keyCount > 0 && e.enabled)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Auto-select first session on initial load
  const didAutoSelect = useRef(false)
  useEffect(() => {
    if (sessions.length > 0 && !activeSessionId && !didAutoSelect.current) {
      didAutoSelect.current = true
      handleSwitchSession(sessions[0].id)
    }
  }, [sessions, activeSessionId])

  const handleSwitchSession = async (id: string) => {
    setActiveSessionId(id)
    try {
      const data = await apiJson<{ messages: ChatMessage[]; selectedModel: string }>(`/api/chats/${id}`)
      setMessages(data.messages)
      setSelectedModel(data.selectedModel ?? 'auto')
    } catch {
      setMessages([])
    }
  }

  const updateSessionModel = async (id: string, model: string) => {
    try {
      await apiJson(`/api/chats/${id}`, { method: 'PATCH', body: JSON.stringify({ selectedModel: model }) })
      queryClient.invalidateQueries({ queryKey: ['chat-sessions'] })
    } catch { /* ignore */ }
  }

  const createSession = useMutation({
    mutationFn: async (model?: string) => {
      const body = model ? { selectedModel: model } : {}
      const res = await apiJson<{ id: string }>('/api/chats', { method: 'POST', body: JSON.stringify(body) })
      return res.id
    },
    onSuccess: (id) => {
      creatingRef.current = false
      queryClient.invalidateQueries({ queryKey: ['chat-sessions'] })
      setActiveSessionId(id)
      setMessages([])
      setTimeout(() => inputRef.current?.focus(), 100)
    },
    onError: () => {
      creatingRef.current = false
    },
  })

  const handleNewChat = () => {
    if (creatingRef.current) return
    creatingRef.current = true
    createSession.mutate(selectedModel)
  }

  const deleteSession = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/chats/${id}`, { method: 'DELETE' }),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['chat-sessions'] })
      if (activeSessionId === id) {
        const remaining = sessions.filter(s => s.id !== id)
        if (remaining.length > 0) {
          handleSwitchSession(remaining[0].id)
        } else {
          setActiveSessionId(null)
          setMessages([])
        }
      }
    },
  })

  const renameSession = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      apiJson(`/api/chats/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chat-sessions'] })
      setEditingId(null)
    },
  })

  const handleAutoRename = async (sessionId: string, userPrompt: string) => {
    const session = sessions.find(s => s.id === sessionId)
    if (session && (session.name === 'New Chat' || session.name.startsWith('New Chat'))) {
      const shortName = userPrompt.length > 40 ? userPrompt.slice(0, 37) + '...' : userPrompt
      try {
        await apiJson(`/api/chats/${sessionId}`, { method: 'PATCH', body: JSON.stringify({ name: shortName }) })
        queryClient.invalidateQueries({ queryKey: ['chat-sessions'] })
      } catch { /* ignore */ }
    }
  }

  const handleModelChange = async (v: string) => {
    setSelectedModel(v)
    if (activeSessionId) {
      await updateSessionModel(activeSessionId, v)
      queryClient.invalidateQueries({ queryKey: ['chat-sessions'] })
    }
  }

  // Wrap for Select's onValueChange type (value may be null)
  const onModelChange = (v: string | null) => {
    if (v) handleModelChange(v)
  }

  const handleGenerate = async () => {
    const text = prompt.trim()
    if (!text || loading) return

    let sessionId = activeSessionId

    if (!sessionId) {
      // No session yet — create one first, then generate
      try {
        const res = await apiJson<{ id: string }>('/api/chats', { method: 'POST', body: JSON.stringify({ selectedModel }) })
        sessionId = res.id
        queryClient.invalidateQueries({ queryKey: ['chat-sessions'] })
        setActiveSessionId(sessionId)
        setMessages([])
      } catch (err: any) {
        return
      }
    }

    await handleGenerateInternal(text, sessionId)
  }

  const handleGenerateInternal = async (text: string, sessionId: string) => {
    setPrompt('')
    setLoading(true)

    await handleAutoRename(sessionId, text)

    // Save user message to DB + add to UI immediately
    try {
      const userMsg = await apiJson<ChatMessage>(`/api/chats/${sessionId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ role: 'user', prompt: text }),
      })
      setMessages(prev => [...prev, userMsg])
    } catch { /* continue */ }

    // Add placeholder for loading state
    const placeholder: ChatMessage = {
      id: Date.now(),
      role: 'assistant',
      prompt: null, imageUrl: null, imageB64: null, revisedPrompt: null,
      platform: null, model: null, latencyMs: null, fileSizeKb: null,
      dimensions: null, error: null, createdAt: new Date().toISOString(),
    }
    setMessages(prev => [...prev, placeholder])

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (keyData?.apiKey) headers['Authorization'] = `Bearer ${keyData.apiKey}`

      const body: Record<string, any> = { prompt: text, n: 1, size: '1024x1024', response_format: 'url' }
      if (selectedModel !== 'auto') body.model = selectedModel

      const base = import.meta.env.BASE_URL.replace(/\/$/, '')
      const start = Date.now()
      const res = await fetch(`${base}/v1/images/generations`, {
        method: 'POST', headers, body: JSON.stringify(body),
      })

      const latency = Date.now() - start
      const routedVia = res.headers.get('X-Routed-Via')

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }))
        const errorMsg = `Error: ${err.error?.message ?? 'Unknown error'}`
        setMessages(prev => prev.map(m => m.id === placeholder.id ? { ...m, error: errorMsg } : m))
        try {
          await apiJson(`/api/chats/${sessionId}/messages`, {
            method: 'POST', body: JSON.stringify({ role: 'assistant', error: errorMsg }),
          })
          queryClient.invalidateQueries({ queryKey: ['chat-sessions'] })
        } catch { /* ignore */ }
        return
      }

      const data = await res.json()
      const image = data.data?.[0]
      const via = data._routed_via ?? (routedVia ? {
        platform: routedVia.split('/')[0],
        model: routedVia.split('/').slice(1).join('/'),
      } : undefined)

      let fileSizeKb: number | null = null
      const b64Data = image?.b64_json || (image?.url?.startsWith('data:') ? image.url.split(',')[1] : null)
      if (b64Data) {
        fileSizeKb = Math.round((Math.floor(b64Data.length * 0.75) / 1024) * 10) / 10
      }

      setMessages(prev => prev.map(m => m.id === placeholder.id ? {
        ...m,
        imageUrl: image?.url ?? null,
        imageB64: image?.b64_json ?? null,
        revisedPrompt: image?.revised_prompt ?? null,
        platform: via?.platform ?? null,
        model: via?.model ?? null,
        latencyMs: latency,
        fileSizeKb,
      } : m))

      try {
        await apiJson(`/api/chats/${sessionId}/messages`, {
          method: 'POST',
          body: JSON.stringify({
            role: 'assistant',
            imageUrl: image?.url ?? null,
            imageB64: image?.b64_json ?? null,
            revisedPrompt: image?.revised_prompt ?? null,
            platform: via?.platform ?? null,
            model: via?.model ?? null,
            latencyMs: latency,
            fileSizeKb,
          }),
        })
        queryClient.invalidateQueries({ queryKey: ['chat-sessions'] })
      } catch { /* ignore */ }
    } catch (err: any) {
      const errorMsg = `Error: ${err.message}`
      setMessages(prev => prev.map(m => m.id === placeholder.id ? { ...m, error: errorMsg } : m))
      try {
        await apiJson(`/api/chats/${sessionId}/messages`, {
          method: 'POST', body: JSON.stringify({ role: 'assistant', error: errorMsg }),
        })
      } catch { /* ignore */ }
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
    <div className="flex h-full min-h-0 relative">
      {/* Sidebar */}
      <div className={`flex shrink-0 transition-all duration-300 ease-in-out overflow-hidden border-r relative ${sidebarOpen ? 'w-80' : 'w-0'}`}>
        {sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(false)}
            className="absolute right-0 top-1/2 -translate-y-1/2 z-10 translate-x-1/3 bg-muted/80 backdrop-blur border rounded-full p-2.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-200 shadow-sm"
            title="Hide sidebar"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/></svg>
          </button>
        )}
        <div className="w-80 min-w-0 bg-muted/30 flex flex-col">
          <div className="p-4 border-b flex items-center gap-2">
            <Button
              variant="outline"
              className="flex-1 justify-start gap-2 h-10 text-sm"
              onClick={handleNewChat}
              disabled={createSession.isPending}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
              New Chat
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-styled">
            {sessionsLoading ? (
              <div className="p-4 text-sm text-muted-foreground">Loading...</div>
            ) : sessions.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground text-center">No chats yet</div>
            ) : (
              sessions.toSorted((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).map(session => (
                <div
                  key={session.id}
                  className={`group flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-accent transition-colors border-b border-border/40 ${
                    activeSessionId === session.id ? 'bg-accent' : ''
                  }`}
                  onClick={() => {
                    if (activeSessionId !== session.id) {
                      handleSwitchSession(session.id)
                      setEditingId(null)
                    }
                  }}
                >
                  {editingId === session.id ? (
                    <div className="flex items-center gap-1 flex-1">
                      <Input
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        className="h-8 text-sm"
                        autoFocus
                        onKeyDown={e => {
                          if (e.key === 'Enter') renameSession.mutate({ id: session.id, name: editName })
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                        onBlur={() => {
                          if (editName.trim()) renameSession.mutate({ id: session.id, name: editName })
                          else setEditingId(null)
                        }}
                      />
                    </div>
                  ) : (
                    <>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate font-medium">{session.name}</div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                          <span>{session.imageCount} image{session.imageCount !== 1 ? 's' : ''}</span>
                          <span>·</span>
                          <span>{formatDate(session.updatedAt)}</span>
                        </div>
                      </div>
                      <div className="hidden group-hover:flex items-center gap-1 shrink-0">
                        <button
                          className="p-1 text-muted-foreground hover:text-foreground rounded"
                          onClick={e => { e.stopPropagation(); setEditingId(session.id); setEditName(session.name) }}
                          title="Rename"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                        </button>
                        <button
                          className="p-1 text-muted-foreground hover:text-destructive rounded"
                          onClick={e => { e.stopPropagation(); deleteSession.mutate(session.id) }}
                          title="Delete"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Floating sidebar toggle when closed */}
      {!sidebarOpen && (
        <button
          onClick={() => setSidebarOpen(true)}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-10 -translate-x-1/3 bg-muted/80 backdrop-blur border rounded-full p-2.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-200 shadow-sm"
          title="Show sidebar"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/></svg>
        </button>
      )}

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto scrollbar-styled">
          {!activeSessionId ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center space-y-4">
                <h1 className="text-2xl font-semibold tracking-tight">Image Playground</h1>
                <p className="text-sm text-muted-foreground max-w-md">
                  Generate images using the proxy router. Sessions are saved automatically.
                </p>
                <Button onClick={handleNewChat} disabled={createSession.isPending}>
                  {createSession.isPending ? 'Creating...' : 'Start a new chat'}
                </Button>
              </div>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center space-y-3">
                <h1 className="text-xl font-semibold tracking-tight">What would you like to generate?</h1>
                <p className="text-sm text-muted-foreground">
                  Using <span className="text-foreground font-medium">{activeModelLabel}</span>
                </p>
              </div>
            </div>
          ) : (
            <div className="max-w-5xl mx-auto px-4 py-6 space-y-8">
              {messages.map((msg) => (
                <div key={msg.id} className="flex flex-col space-y-4">
                  {/* User */}
                  {msg.role === 'user' && (
                    <div className="flex justify-end">
                      <div className="bg-primary text-primary-foreground px-4 py-2.5 rounded-2xl rounded-tr-sm max-w-[80%] text-sm shadow-sm">
                        {msg.prompt}
                      </div>
                    </div>
                  )}

                  {/* Assistant */}
                  {msg.role === 'assistant' && (
                    <div className="flex justify-start w-full">
                      <div className="max-w-full flex flex-col gap-3">
                        {msg.error ? (
                          <div className="text-destructive text-sm p-3 bg-destructive/10 rounded-xl">{msg.error}</div>
                        ) : !msg.imageUrl && !msg.imageB64 ? (
                          <div className="animate-pulse bg-muted rounded-xl w-[280px] h-[280px] sm:w-[420px] sm:h-[420px] md:w-[560px] md:h-[560px] flex items-center justify-center">
                            <span className="text-muted-foreground font-medium flex items-center gap-2">
                              <span className="h-4 w-4 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin"></span>
                              Generating...
                            </span>
                          </div>
                        ) : (
                          <img
                            src={msg.imageUrl || `data:image/jpeg;base64,${msg.imageB64}`}
                            alt={msg.revisedPrompt ?? msg.prompt ?? 'Generated image'}
                            className="max-w-full max-h-[70vh] rounded-xl shadow-sm object-contain bg-background"
                          />
                        )}

                        {(msg.platform || msg.latencyMs || msg.fileSizeKb || msg.dimensions) && (
                          <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground tabular-nums">
                            {msg.platform && <span className="font-medium bg-background px-2 py-0.5 rounded border">{msg.platform}</span>}
                            {msg.model && <span className="font-mono">· {msg.model}</span>}
                            {msg.latencyMs != null && <span>· {msg.latencyMs} ms</span>}
                            {msg.fileSizeKb != null && <span>· {msg.fileSizeKb} KB</span>}
                            {msg.dimensions && <span>· {msg.dimensions}</span>}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
              <div ref={endRef} />
            </div>
          )}
        </div>

        {/* Input bar */}
        <div className="shrink-0 border-t bg-background/50 p-4">
          <div className="max-w-5xl mx-auto flex gap-6 items-center">
            <Select value={selectedModel} onValueChange={onModelChange}>
              <SelectTrigger className="w-fit min-w-[160px] h-[42px] text-sm shrink-0">
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
            <div className="flex-1 flex gap-2 items-end bg-muted/50 border rounded-xl p-2 focus-within:ring-2 focus-within:ring-ring/50 transition-shadow">
              <textarea
                ref={inputRef}
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Describe the image you want to generate..."
                rows={1}
                className="flex-1 resize-none bg-transparent px-2 py-1.5 text-sm focus:outline-none min-h-[24px] max-h-[160px]"
                style={{ height: 'auto', overflow: 'hidden' }}
                onInput={e => {
                  const el = e.target as HTMLTextAreaElement
                  el.style.height = 'auto'
                  el.style.height = Math.min(el.scrollHeight, 160) + 'px'
                }}
              />
              <Button
                onClick={handleGenerate}
                disabled={loading || !prompt.trim()}
                className="shrink-0 rounded-lg h-9"
              >
                {loading ? (
                  <span className="flex items-center gap-1.5">
                    <span className="h-4 w-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                    Generating...
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    Generate
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>
                  </span>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}