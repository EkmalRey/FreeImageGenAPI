import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, getDb } from '../../db/index.js';
import { encrypt } from '../../lib/crypto.js';
import { routeRequest } from '../../services/router.js';

const HIGH_PRIORITY_MODEL = 'black-forest-labs/FLUX.1-schnell';
const LOW_PRIORITY_MODEL = 'stabilityai/stable-diffusion-xl-base-1.0';
const PLATFORM = 'together';

function seedTestModels() {
  const db = getDb();
  db.prepare('DELETE FROM fallback_config').run();
  db.prepare('DELETE FROM models').run();

  db.prepare(`INSERT INTO models (platform, model_id, display_name, intelligence_rank, speed_rank, enabled)
    VALUES (?, ?, 'Flux Schnell', 1, 4, 1)`).run(PLATFORM, HIGH_PRIORITY_MODEL);
  db.prepare(`INSERT INTO models (platform, model_id, display_name, intelligence_rank, speed_rank, enabled)
    VALUES (?, ?, 'SDXL', 2, 4, 1)`).run(PLATFORM, LOW_PRIORITY_MODEL);

  const highId = db.prepare('SELECT id FROM models WHERE model_id = ?').get(HIGH_PRIORITY_MODEL).id;
  const lowId = db.prepare('SELECT id FROM models WHERE model_id = ?').get(LOW_PRIORITY_MODEL).id;

  db.prepare('INSERT INTO fallback_config (model_db_id, priority, enabled) VALUES (?, 1, 1)').run(highId);
  db.prepare('INSERT INTO fallback_config (model_db_id, priority, enabled) VALUES (?, 2, 1)').run(lowId);
}

describe('Router', () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
  });

  beforeEach(() => {
    const db = getDb();
    db.prepare('DELETE FROM api_keys').run();
    seedTestModels();
  });

  it('should throw when no keys are configured', () => {
    expect(() => routeRequest()).toThrow(/exhausted/i);
  });

  it('should route to highest priority model with available key', () => {
    const db = getDb();
    const { encrypted, iv, authTag } = encrypt('test-key');
    db.prepare(`
      INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(PLATFORM, 'test', encrypted, iv, authTag, 'healthy', 1);

    const result = routeRequest();
    expect(result.platform).toBe(PLATFORM);
    expect(result.modelId).toBe(HIGH_PRIORITY_MODEL);
    expect(result.apiKey).toBe('test-key');
  });

  it('should skip disabled keys and use an enabled one', () => {
    const db = getDb();

    const disabledKey = encrypt('disabled-key');
    db.prepare(`
      INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(PLATFORM, 'disabled', disabledKey.encrypted, disabledKey.iv, disabledKey.authTag, 'healthy', 0);

    const enabledKey = encrypt('enabled-key');
    db.prepare(`
      INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(PLATFORM, 'enabled', enabledKey.encrypted, enabledKey.iv, enabledKey.authTag, 'healthy', 1);

    const result = routeRequest();
    expect(result.platform).toBe(PLATFORM);
    expect(result.apiKey).toBe('enabled-key');
  });

  it('should skip invalid status keys and use a healthy one', () => {
    const db = getDb();

    const invalidKey = encrypt('invalid-key');
    db.prepare(`
      INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(PLATFORM, 'invalid', invalidKey.encrypted, invalidKey.iv, invalidKey.authTag, 'invalid', 1);

    const healthyKey = encrypt('healthy-key');
    db.prepare(`
      INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(PLATFORM, 'healthy', healthyKey.encrypted, healthyKey.iv, healthyKey.authTag, 'healthy', 1);

    const result = routeRequest();
    expect(result.platform).toBe(PLATFORM);
    expect(result.apiKey).toBe('healthy-key');
  });

  it('should skip keys that cannot be decrypted and use a valid fallback key', () => {
    const db = getDb();

    // Insert a key with tampered auth tag that will fail decryption
    const badKey = encrypt('some-value');
    db.prepare(`
      INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(PLATFORM, 'corrupt', badKey.encrypted, badKey.iv, '00000000000000000000000000000000', 'healthy', 1);

    const validKey = encrypt('valid-key');
    db.prepare(`
      INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(PLATFORM, 'valid', validKey.encrypted, validKey.iv, validKey.authTag, 'healthy', 1);

    const result = routeRequest();
    expect(result.platform).toBe(PLATFORM);
    expect(result.apiKey).toBe('valid-key');
    // The corrupt key's status may or may not be updated to 'error' depending on
    // round-robin ordering (module-level state shared across tests). The core
    // contract — that a decryptable key is used — is verified above.
  });
});
