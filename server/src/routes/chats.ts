import crypto from 'crypto';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDb } from '../db/index.js';

export const chatsRouter = Router();

// GET /api/chats — list all sessions
chatsRouter.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT s.id, s.name, s.selected_model, s.created_at, s.updated_at,
      (SELECT COUNT(*) FROM chat_messages WHERE session_id = s.id AND role = 'assistant') as image_count,
      (SELECT image_url FROM chat_messages WHERE session_id = s.id AND role = 'assistant' AND image_url IS NOT NULL ORDER BY created_at DESC LIMIT 1) as last_image
    FROM chat_sessions s
    ORDER BY s.updated_at DESC
  `).all() as any[];

  res.json(rows.map(r => ({
    id: r.id,
    name: r.name,
    selectedModel: r.selected_model,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    imageCount: r.image_count,
    lastImage: r.last_image,
  })));
});

// POST /api/chats — create a new session
chatsRouter.post('/', (req: Request, res: Response) => {
  const db = getDb();
  const id = crypto.randomUUID();
  const name = 'New Chat';
  const selectedModel = req.body?.selectedModel ?? 'auto';
  db.prepare('INSERT INTO chat_sessions (id, name, selected_model) VALUES (?, ?, ?)').run(id, name, selectedModel);
  const row = db.prepare('SELECT created_at, updated_at FROM chat_sessions WHERE id = ?').get(id) as any;
  res.status(201).json({
    id,
    name,
    selectedModel,
    messageCount: 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
});

// GET /api/chats/:id — get a session with all messages
chatsRouter.get('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const session = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(req.params.id) as any;
  if (!session) {
    res.status(404).json({ error: { message: 'Chat session not found' } });
    return;
  }

  const messages = db.prepare(`
    SELECT id, role, prompt, image_url, image_b64, revised_prompt, platform, model, key_id, latency_ms, file_size_kb, dimensions, error, created_at
    FROM chat_messages
    WHERE session_id = ?
    ORDER BY created_at ASC
  `).all(req.params.id) as any[];

  res.json({
    id: session.id,
    name: session.name,
    selectedModel: session.selected_model,
    preferredKeyId: session.preferred_key_id,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
    messages: messages.map(m => ({
      id: m.id,
      role: m.role,
      prompt: m.prompt,
      imageUrl: m.image_url,
      imageB64: m.image_b64,
      revisedPrompt: m.revised_prompt,
      platform: m.platform,
      model: m.model,
      keyId: m.key_id,
      latencyMs: m.latency_ms,
      fileSizeKb: m.file_size_kb,
      dimensions: m.dimensions,
      error: m.error,
      createdAt: m.created_at,
    })),
  });
});

// PATCH /api/chats/:id — rename session or update model/key
chatsRouter.patch('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const { name, selectedModel, preferredKeyId } = req.body;
  const session = db.prepare('SELECT id FROM chat_sessions WHERE id = ?').get(req.params.id) as any;
  if (!session) {
    res.status(404).json({ error: { message: 'Chat session not found' } });
    return;
  }
  if (name && typeof name === 'string') {
    db.prepare("UPDATE chat_sessions SET name = ?, updated_at = datetime('now') WHERE id = ?").run(name, req.params.id);
  }
  if (selectedModel && typeof selectedModel === 'string') {
    db.prepare("UPDATE chat_sessions SET selected_model = ?, updated_at = datetime('now') WHERE id = ?").run(selectedModel, req.params.id);
  }
  if (preferredKeyId !== undefined) {
    db.prepare("UPDATE chat_sessions SET preferred_key_id = ?, updated_at = datetime('now') WHERE id = ?").run(preferredKeyId, req.params.id);
  }
  res.json({ ok: true });
});

// DELETE /api/chats/:id — delete session
chatsRouter.delete('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(req.params.id);
  if (result.changes === 0) {
    res.status(404).json({ error: { message: 'Chat session not found' } });
    return;
  }
  res.json({ ok: true });
});

// POST /api/chats/:sessionId/messages — add a message
chatsRouter.post('/:sessionId/messages', (req: Request, res: Response) => {
  const db = getDb();
  const session = db.prepare('SELECT id FROM chat_sessions WHERE id = ?').get(req.params.sessionId) as any;
  if (!session) {
    res.status(404).json({ error: { message: 'Chat session not found' } });
    return;
  }

  const { role, prompt, imageUrl, imageB64, revisedPrompt, platform, model, keyId, latencyMs, fileSizeKb, dimensions, error } = req.body;
  if (!role || !['user', 'assistant'].includes(role)) {
    res.status(400).json({ error: { message: 'Valid role (user|assistant) is required' } });
    return;
  }

  const result = db.prepare(`
    INSERT INTO chat_messages (session_id, role, prompt, image_url, image_b64, revised_prompt, platform, model, key_id, latency_ms, file_size_kb, dimensions, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.params.sessionId, role,
    prompt ?? null, imageUrl ?? null, imageB64 ?? null,
    revisedPrompt ?? null, platform ?? null, model ?? null, keyId ?? null,
    latencyMs ?? null, fileSizeKb ?? null, dimensions ?? null, error ?? null
  );

  // bump updated_at
  db.prepare('UPDATE chat_sessions SET updated_at = datetime(\'now\') WHERE id = ?').run(req.params.sessionId);

  const msg = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(result.lastInsertRowid) as any;

  res.status(201).json({
    id: msg.id,
    role: msg.role,
    prompt: msg.prompt,
    imageUrl: msg.image_url,
    imageB64: msg.image_b64,
    revisedPrompt: msg.revised_prompt,
    platform: msg.platform,
    model: msg.model,
    keyId: msg.key_id,
    latencyMs: msg.latency_ms,
    fileSizeKb: msg.file_size_kb,
    dimensions: msg.dimensions,
    error: msg.error,
    createdAt: msg.created_at,
  });
});

// DELETE /api/chats/:sessionId/messages/:messageId — delete a message
chatsRouter.delete('/:sessionId/messages/:messageId', (req: Request, res: Response) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM chat_messages WHERE id = ? AND session_id = ?').run(req.params.messageId, req.params.sessionId);
  if (result.changes === 0) {
    res.status(404).json({ error: { message: 'Message not found' } });
    return;
  }
  db.prepare('UPDATE chat_sessions SET updated_at = datetime(\'now\') WHERE id = ?').run(req.params.sessionId);
  res.json({ ok: true });
});