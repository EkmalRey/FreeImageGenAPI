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

    CREATE INDEX IF NOT EXISTS idx_requests_created_at ON requests(created_at);
    CREATE INDEX IF NOT EXISTS idx_requests_platform ON requests(platform);
    CREATE INDEX IF NOT EXISTS idx_rate_limit_usage_lookup ON rate_limit_usage(platform, model_id, key_id, kind, created_at_ms);
    CREATE INDEX IF NOT EXISTS idx_rate_limit_cooldowns_expires ON rate_limit_cooldowns(expires_at_ms);
    CREATE INDEX IF NOT EXISTS idx_api_keys_platform ON api_keys(platform);
  `);

  ensureRequestKeyIdColumn(db);
}

function ensureRequestKeyIdColumn(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(requests)').all() as { name: string }[];
  if (!columns.some(col => col.name === 'key_id')) {
    db.prepare('ALTER TABLE requests ADD COLUMN key_id INTEGER').run();
  }
  db.prepare('CREATE INDEX IF NOT EXISTS idx_requests_key_id ON requests(key_id)').run();
}

function seedModels(db: Database.Database) {
  const count = db.prepare('SELECT COUNT(*) as cnt FROM models').get() as { cnt: number };
  if (count.cnt > 0) return;

  const insert = db.prepare(`
    INSERT INTO models (platform, model_id, display_name, intelligence_rank, speed_rank, size_label, rpm_limit, rpd_limit, tpm_limit, tpd_limit, monthly_token_budget, context_window)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const models = [
    // Pollinations
    ['pollinations', 'flux', 'Flux (Pollinations)', 1, 1, 'Standard', 30, null, null, null, 'Unlimited', null],
    ['pollinations', 'turbo', 'Turbo (Pollinations)', 2, 2, 'Fast', 30, null, null, null, 'Unlimited', null],
    // Hugging Face
    ['huggingface', 'black-forest-labs/FLUX.1-schnell', 'FLUX.1-schnell (HF)', 1, 3, 'Standard', null, null, null, null, 'Free Tier', null],
    // Cloudflare Workers AI
    ['cloudflare', '@cf/black-forest-labs/flux-schnell', 'Flux Schnell (CF)', 2, 3, 'Standard', null, 10000, null, null, '10K Neurons', null],
    ['cloudflare', '@cf/stabilityai/stable-diffusion-xl-base-1.0', 'SDXL Base (CF)', 3, 3, 'Standard', null, 10000, null, null, '10K Neurons', null],
    // Together AI
    ['together', 'black-forest-labs/FLUX.1-schnell', 'Flux Schnell (Together)', 1, 4, 'Standard', null, null, null, null, '$25 Trial', null],
    ['together', 'stabilityai/stable-diffusion-xl-base-1.0', 'SDXL (Together)', 3, 4, 'Standard', null, null, null, null, '$25 Trial', null],
    // DeepInfra
    ['deepinfra', 'black-forest-labs/FLUX-1-schnell', 'Flux Schnell (DeepInfra)', 1, 5, 'Standard', null, null, null, null, 'Trial', null],
  ];

  const insertMany = db.transaction(() => {
    for (const m of models) {
      insert.run(...m);
    }
  });
  insertMany();

  // Seed default fallback config from models
  const allModels = db.prepare('SELECT id, intelligence_rank FROM models ORDER BY intelligence_rank ASC').all() as { id: number; intelligence_rank: number }[];
  const insertFallback = db.prepare('INSERT INTO fallback_config (model_db_id, priority, enabled) VALUES (?, ?, 1)');
  const insertFallbacks = db.transaction(() => {
    for (let i = 0; i < allModels.length; i++) {
      insertFallback.run(allModels[i].id, i + 1);
    }
  });
  insertFallbacks();

  console.log('Seeded Image Generation models and fallback config');
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
