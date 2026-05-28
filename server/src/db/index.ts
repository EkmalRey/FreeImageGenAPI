import crypto from 'crypto';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initEncryptionKey } from '../lib/crypto.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../../data/freeapi.db');

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

export function initDb(dbPath?: string): Database.Database {
  const resolvedPath = dbPath ?? DB_PATH;
  const isMemory = resolvedPath === ':memory:';

  if (!isMemory) {
    const dataDir = path.dirname(resolvedPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }

  db = new Database(resolvedPath);
  if (!isMemory) db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  createTables(db);
  initEncryptionKey(db);
  seedModels(db);
  migrateModelIds(db);
  
  // Note: Migration functions removed for FreeImageGenAPI as it's a fresh schema
  
  ensureUnifiedKey(db);

  console.log(`Database initialized at ${resolvedPath}`);
  return db;
}

function createTables(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      model_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      intelligence_rank INTEGER NOT NULL,
      speed_rank INTEGER NOT NULL,
      size_label TEXT NOT NULL DEFAULT '',
      rpm_limit INTEGER,
      rpd_limit INTEGER,
      tpm_limit INTEGER,
      tpd_limit INTEGER,
      monthly_token_budget TEXT NOT NULL DEFAULT '',
      context_window INTEGER,
      enabled INTEGER NOT NULL DEFAULT 1,
      UNIQUE(platform, model_id)
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      encrypted_key TEXT NOT NULL,
      iv TEXT NOT NULL,
      auth_tag TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unknown',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_checked_at TEXT
    );

    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      model_id TEXT NOT NULL,
      key_id INTEGER,
      status TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS rate_limit_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      model_id TEXT NOT NULL,
      key_id INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('request', 'tokens')),
      tokens INTEGER NOT NULL DEFAULT 0,
      created_at_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS rate_limit_cooldowns (
      platform TEXT NOT NULL,
      model_id TEXT NOT NULL,
      key_id INTEGER NOT NULL,
      expires_at_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (platform, model_id, key_id)
    );

    CREATE TABLE IF NOT EXISTS fallback_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_db_id INTEGER NOT NULL REFERENCES models(id),
      priority INTEGER NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      UNIQUE(model_db_id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      selected_model TEXT NOT NULL DEFAULT 'auto',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      prompt TEXT,
      image_url TEXT,
      image_b64 TEXT,
      revised_prompt TEXT,
      platform TEXT,
      model TEXT,
      latency_ms INTEGER,
      file_size_kb REAL,
      dimensions TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at);
    CREATE INDEX IF NOT EXISTS idx_requests_created_at ON requests(created_at);
    CREATE INDEX IF NOT EXISTS idx_requests_platform ON requests(platform);
    CREATE INDEX IF NOT EXISTS idx_rate_limit_usage_lookup ON rate_limit_usage(platform, model_id, key_id, kind, created_at_ms);
    CREATE INDEX IF NOT EXISTS idx_rate_limit_cooldowns_expires ON rate_limit_cooldowns(expires_at_ms);
    CREATE INDEX IF NOT EXISTS idx_api_keys_platform ON api_keys(platform);
  `);

  ensureRequestKeyIdColumn(db);
  ensureChatSessionsModelColumn(db);
}

function ensureChatSessionsModelColumn(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(chat_sessions)').all() as { name: string }[];
  if (!columns.some(col => col.name === 'selected_model')) {
    db.prepare("ALTER TABLE chat_sessions ADD COLUMN selected_model TEXT NOT NULL DEFAULT 'auto'").run();
  }
}

function ensureRequestKeyIdColumn(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(requests)').all() as { name: string }[];
  if (!columns.some(col => col.name === 'key_id')) {
    db.prepare('ALTER TABLE requests ADD COLUMN key_id INTEGER').run();
  }
  db.prepare('CREATE INDEX IF NOT EXISTS idx_requests_key_id ON requests(key_id)').run();
}

function seedModels(db: Database.Database) {
  // Models are no longer hardcoded. They are dynamically synced when API keys are checked.
  // Fallback config is also generated dynamically during model sync.
}

function migrateModelIds(db: Database.Database) {
  // Fix incorrect model IDs from older seed data
  const fixes: [string, string][] = [
    ['@cf/black-forest-labs/flux-schnell', '@cf/black-forest-labs/flux-1-schnell'],
  ];
  const check = db.prepare('SELECT id FROM models WHERE platform = ? AND model_id = ?');
  const delFallback = db.prepare('DELETE FROM fallback_config WHERE model_db_id = ?');
  const del = db.prepare('DELETE FROM models WHERE platform = ? AND model_id = ?');
  const update = db.prepare('UPDATE models SET model_id = ?, display_name = ? WHERE platform = ? AND model_id = ?');
  for (const [oldId, newId] of fixes) {
    const oldRow = check.get('cloudflare', oldId) as { id: number } | undefined;
    if (!oldRow) continue;
    const newExists = check.get('cloudflare', newId);
    if (newExists) {
      // New ID already exists — remove fallback ref then the old model
      delFallback.run(oldRow.id);
      del.run('cloudflare', oldId);
    } else {
      const displayName = newId.split('/').pop() || newId;
      update.run(newId, displayName, 'cloudflare', oldId);
    }
  }
}

function ensureUnifiedKey(db: Database.Database) {
  const exists = db.prepare('SELECT value FROM settings WHERE key = ?').get('UNIFIED_API_KEY') as { value: string } | undefined;
  if (!exists) {
    const key = 'sk-' + crypto.randomBytes(24).toString('hex');
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('UNIFIED_API_KEY', key);
    console.log('Generated initial UNIFIED_API_KEY:', key);
  }
}

export function getUnifiedApiKey(): string {
  if (!db) return '';
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('UNIFIED_API_KEY') as { value: string } | undefined;
  return row?.value ?? '';
}

export function regenerateUnifiedKey(): string {
  if (!db) return '';
  const key = 'sk-' + crypto.randomBytes(24).toString('hex');
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run('UNIFIED_API_KEY', key);
  return key;
}
