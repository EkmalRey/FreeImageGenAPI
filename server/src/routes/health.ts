import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDb } from '../db/index.js';
import { checkKeyHealth, checkAllKeys } from '../services/health.js';
import { hasProvider } from '../providers/index.js';
import { getRateLimitStatus } from '../services/ratelimit.js';

export const healthRouter = Router();

// Get health status for all platforms
healthRouter.get('/', (_req: Request, res: Response) => {
  const db = getDb();

  const platforms = db.prepare(`
    SELECT
      platform,
      COUNT(*) as total_keys,
      SUM(CASE WHEN status = 'healthy' THEN 1 ELSE 0 END) as healthy_keys,
      SUM(CASE WHEN status = 'rate_limited' THEN 1 ELSE 0 END) as rate_limited_keys,
      SUM(CASE WHEN status = 'invalid' THEN 1 ELSE 0 END) as invalid_keys,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error_keys,
      SUM(CASE WHEN status = 'unknown' THEN 1 ELSE 0 END) as unknown_keys,
      SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) as enabled_keys
    FROM api_keys
    GROUP BY platform
  `).all() as any[];

  const keys = db.prepare(`
    SELECT id, platform, label, status, enabled, created_at, last_checked_at
    FROM api_keys
    ORDER BY platform, created_at DESC
  `).all() as any[];

  res.json({
    platforms: platforms.map(p => ({
      platform: p.platform,
      hasProvider: hasProvider(p.platform),
      totalKeys: p.total_keys,
      healthyKeys: p.healthy_keys,
      rateLimitedKeys: p.rate_limited_keys,
      invalidKeys: p.invalid_keys,
      errorKeys: p.error_keys,
      unknownKeys: p.unknown_keys,
      enabledKeys: p.enabled_keys,
    })),
    keys: keys.map(k => ({
      id: k.id,
      platform: k.platform,
      label: k.label,
      status: k.status,
      enabled: k.enabled === 1,
      createdAt: k.created_at,
      lastCheckedAt: k.last_checked_at,
    })),
  });
});

// Check a specific key
healthRouter.post('/check/:keyId', async (req: Request, res: Response) => {
  const keyId = parseInt(req.params.keyId as string, 10);
  if (isNaN(keyId)) {
    res.status(400).json({ error: { message: 'Invalid key ID' } });
    return;
  }

  const status = await checkKeyHealth(keyId);
  res.json({ keyId, status });
});

// Check all keys
healthRouter.post('/check-all', async (_req: Request, res: Response) => {
  await checkAllKeys();
  res.json({ success: true });
});

// Get rate limit status for all keys
healthRouter.get('/rate-limits', (_req: Request, res: Response) => {
  const db = getDb();
  
  const keys = db.prepare(`
    SELECT ak.id, ak.platform, ak.label, ak.status, ak.enabled,
           GROUP_CONCAT(DISTINCT m.model_id) as model_ids
    FROM api_keys ak
    LEFT JOIN models m ON m.platform = ak.platform AND m.enabled = 1
    WHERE ak.enabled = 1
    GROUP BY ak.id
  `).all() as any[];

  const result = keys.map(k => {
    const modelIds = k.model_ids ? k.model_ids.split(',') : [];
    const modelLimits = modelIds.map((modelId: string) => {
      const model = db.prepare('SELECT rpm_limit, rpd_limit, tpm_limit, tpd_limit FROM models WHERE platform = ? AND model_id = ?').get(k.platform, modelId) as any;
      if (!model) return null;
      const limits = {
        rpm: model.rpm_limit,
        rpd: model.rpd_limit,
        tpm: model.tpm_limit,
        tpd: model.tpd_limit,
      };
      const status = getRateLimitStatus(k.platform, modelId, k.id, limits);
      return { modelId, ...status };
    }).filter(Boolean);

    return {
      keyId: k.id,
      platform: k.platform,
      label: k.label,
      status: k.status,
      models: modelLimits,
    };
  });

  res.json(result);
});
