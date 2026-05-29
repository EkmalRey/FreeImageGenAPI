import { getDb } from '../db/index.js';
import { getProvider } from '../providers/index.js';
import { decrypt } from '../lib/crypto.js';
import type { Platform, KeyStatus } from '@freeimagegenapi/shared/types.js';

const MIN_INTERVAL_MS = 8 * 60 * 1000;  // 8 minutes minimum
const MAX_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes maximum
const CONSECUTIVE_FAILURES_TO_DISABLE = 3;

// Track consecutive failures per key
const failureCount = new Map<number, number>();

export async function checkKeyHealth(keyId: number): Promise<KeyStatus> {
  const db = getDb();
  const row = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(keyId) as any;
  if (!row) return 'error';

  const provider = getProvider(row.platform as Platform);
  if (!provider) return 'error';

  try {
    const apiKey = decrypt(row.encrypted_key, row.iv, row.auth_tag);
    const isValid = await provider.validateKey(apiKey);

    const status: KeyStatus = isValid ? 'healthy' : 'invalid';

    db.prepare("UPDATE api_keys SET status = ?, last_checked_at = datetime('now') WHERE id = ?")
      .run(status, keyId);

    if (isValid) {
      failureCount.delete(keyId);
      // Sync models asynchronously
      provider.syncModels(apiKey, db).catch(err => console.error(`[Health] Failed to sync models for key ${keyId}:`, err));
    } else {
      const count = (failureCount.get(keyId) ?? 0) + 1;
      failureCount.set(keyId, count);

      if (count >= CONSECUTIVE_FAILURES_TO_DISABLE) {
        db.prepare('UPDATE api_keys SET enabled = 0 WHERE id = ?').run(keyId);
        console.log(`[Health] Auto-disabled key ${keyId} after ${count} consecutive failures`);
      }
    }

    return status;
  } catch (err: any) {
    // Transport errors (DNS/timeout/TLS) — provider unreachable, not necessarily
    // a bad key. Mark status='error' but do NOT increment failure counter — auto-
    // disable is reserved for confirmed 401/403 (returned by validateKey as false).
    console.error(`[Health] Key ${keyId} transport error:`, err.message);
    db.prepare("UPDATE api_keys SET status = ?, last_checked_at = datetime('now') WHERE id = ?")
      .run('error', keyId);
    return 'error';
  }
}

export async function checkAllKeys(): Promise<void> {
  const db = getDb();
  const keys = db.prepare('SELECT id, platform FROM api_keys WHERE enabled = 1').all() as { id: number; platform: string }[];

  console.log(`[Health] Checking ${keys.length} keys...`);

  for (const key of keys) {
    await checkKeyHealth(key.id);
  }

  console.log(`[Health] Check complete.`);
}

let timeoutId: ReturnType<typeof setTimeout> | null = null;

function getRandomInterval(): number {
  return MIN_INTERVAL_MS + Math.random() * (MAX_INTERVAL_MS - MIN_INTERVAL_MS);
}

async function scheduleNextCheck(): Promise<void> {
  const interval = getRandomInterval();
  const minutes = Math.round(interval / 60000);
  console.log(`[Health] Next check in ~${minutes} minutes`);
  timeoutId = setTimeout(async () => {
    await checkAllKeys().catch(err => console.error('[Health] Check failed:', err));
    await scheduleNextCheck();
  }, interval);
}

export function startHealthChecker(): void {
  if (timeoutId) return;
  const interval = getRandomInterval();
  const minutes = Math.round(interval / 60000);
  console.log(`[Health] Starting health checker (first check in ~${minutes} minutes, then random 8-15 min)`);
  timeoutId = setTimeout(async () => {
    await checkAllKeys().catch(err => console.error('[Health] Check failed:', err));
    await scheduleNextCheck();
  }, interval);
}

export function stopHealthChecker(): void {
  if (timeoutId) {
    clearTimeout(timeoutId);
    timeoutId = null;
  }
}
