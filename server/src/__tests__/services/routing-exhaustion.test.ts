import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { routeRequest } from '../../services/router.js';
import * as ratelimit from '../../services/ratelimit.js';
import { getDb, initDb } from '../../db/index.js';
import * as crypto from '../../lib/crypto.js';

// Mock ratelimit to control quota availability
vi.mock('../../services/ratelimit.js', async () => {
  const actual = await vi.importActual('../../services/ratelimit.js');
  return {
    ...actual,
    canMakeRequest: vi.fn(),
    canUseTokens: vi.fn(),
    isOnCooldown: vi.fn(() => false),
  };
});

// Mock crypto to avoid IV errors
vi.mock('../../lib/crypto.js', async () => {
  const actual = await vi.importActual('../../lib/crypto.js');
  return {
    ...actual,
    decrypt: vi.fn(() => 'mocked-api-key'),
  };
});

const ORIGINAL_DEV_MODE = process.env.DEV_MODE;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

function restoreEnv() {
  if (ORIGINAL_DEV_MODE === undefined) {
    delete process.env.DEV_MODE;
  } else {
    process.env.DEV_MODE = ORIGINAL_DEV_MODE;
  }
  if (ORIGINAL_NODE_ENV === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  }
}

const PLATFORM = 'together';
const HIGH_PRIORITY_MODEL = 'black-forest-labs/FLUX.1-schnell';
const LOW_PRIORITY_MODEL = 'stabilityai/stable-diffusion-xl-base-1.0';

describe('Routing Key Exhaustion', () => {
  beforeEach(() => {
    process.env.DEV_MODE = 'true';
    process.env.NODE_ENV = 'test';
    initDb(':memory:');
    const db = getDb();
    
    // Setup: 2 models (High priority and Low priority)
    db.prepare(`INSERT INTO models (platform, model_id, display_name, intelligence_rank, speed_rank, enabled) VALUES (?, ?, 'Flux Schnell', 1, 1, 1)`).run(PLATFORM, HIGH_PRIORITY_MODEL);
    db.prepare(`INSERT INTO models (platform, model_id, display_name, intelligence_rank, speed_rank, enabled) VALUES (?, ?, 'SDXL', 2, 2, 1)`).run(PLATFORM, LOW_PRIORITY_MODEL);
    
    const highId = db.prepare('SELECT id FROM models WHERE model_id = ?').get(HIGH_PRIORITY_MODEL).id;
    const lowId = db.prepare('SELECT id FROM models WHERE model_id = ?').get(LOW_PRIORITY_MODEL).id;
    
    db.prepare('INSERT INTO fallback_config (model_db_id, priority, enabled) VALUES (?, 1, 1)').run(highId);
    db.prepare('INSERT INTO fallback_config (model_db_id, priority, enabled) VALUES (?, 2, 1)').run(lowId);
    
    // Setup: 2 keys for the platform
    db.prepare("INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled) VALUES (?, 'Key A', 'enc', 'iv', 'tag', 'healthy', 1)").run(PLATFORM);
    db.prepare("INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled) VALUES (?, 'Key B', 'enc', 'iv', 'tag', 'healthy', 1)").run(PLATFORM);

    vi.clearAllMocks();
  });

  afterEach(() => {
    restoreEnv();
  });

  it('should skip exhausted Key B and use functional Key A for the same high-priority model', () => {
    const db = getDb();
    const keys = db.prepare("SELECT id, label FROM api_keys").all();
    const keyA = keys.find(k => k.label === 'Key A');
    const keyB = keys.find(k => k.label === 'Key B');

    // Mock behavior:
    // Key B is exhausted (returns false for canMakeRequest)
    // Key A is functional (returns true)
    (ratelimit.canMakeRequest as any).mockImplementation((platform, modelId, keyId) => {
      if (keyId === keyB.id) return false;
      if (keyId === keyA.id) return true;
      return true;
    });
    (ratelimit.canUseTokens as any).mockReturnValue(true);

    // Act: Route request
    const result = routeRequest(100);

    // Assert: It should have picked the high-priority model despite Key B being exhausted
    expect(result.modelId).toBe(HIGH_PRIORITY_MODEL);
    expect(result.keyId).toBe(keyA.id);
    expect(ratelimit.canMakeRequest).toHaveBeenCalled();
  });

  it('should throw 429 when every key on every model is exhausted', () => {
    (ratelimit.canMakeRequest as any).mockReturnValue(false);
    expect(() => routeRequest(100)).toThrow(/All models exhausted/);
  });

  it('should fall back to low-priority model when high-priority is exhausted', () => {
    (ratelimit.canMakeRequest as any).mockImplementation((_platform: string, modelId: string) => {
      if (modelId === HIGH_PRIORITY_MODEL) return false;
      if (modelId === LOW_PRIORITY_MODEL) return true;
      return true;
    });
    (ratelimit.canUseTokens as any).mockReturnValue(true);

    const result = routeRequest(100);
    expect(result.modelId).toBe(LOW_PRIORITY_MODEL);
  });
});
