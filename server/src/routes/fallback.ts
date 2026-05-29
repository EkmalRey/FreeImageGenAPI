import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { getAllPenalties } from '../services/router.js';

export const fallbackRouter = Router();

// Get fallback chain (with dynamic penalties)
fallbackRouter.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT fc.model_db_id, fc.priority, fc.enabled,
           m.platform, m.model_id, m.display_name, m.intelligence_rank,
           m.speed_rank, m.size_label, m.rpm_limit, m.rpd_limit,
           m.monthly_token_budget
    FROM fallback_config fc
    JOIN models m ON m.id = fc.model_db_id
    WHERE m.enabled = 1
    ORDER BY fc.priority ASC
  `).all() as any[];

  // Count enabled keys per platform and get health breakdown
  const keyDetails = db.prepare(`
    SELECT platform,
      COUNT(*) as total,
      SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) as enabled_count,
      SUM(CASE WHEN status = 'healthy' AND enabled = 1 THEN 1 ELSE 0 END) as healthy,
      SUM(CASE WHEN status = 'rate_limited' AND enabled = 1 THEN 1 ELSE 0 END) as rate_limited,
      SUM(CASE WHEN status = 'invalid' AND enabled = 1 THEN 1 ELSE 0 END) as invalid,
      SUM(CASE WHEN status = 'error' AND enabled = 1 THEN 1 ELSE 0 END) as errored
    FROM api_keys
    GROUP BY platform
  `).all() as { platform: string; total: number; enabled_count: number; healthy: number; rate_limited: number; invalid: number; errored: number }[];
  const keyDetailsMap = new Map(keyDetails.map(k => [k.platform, k]));

  // Get current dynamic penalties
  const penalties = getAllPenalties();
  const penaltyMap = new Map(penalties.map(p => [p.modelDbId, p]));

  res.json(rows.map(r => {
    const penalty = penaltyMap.get(r.model_db_id);
    const kd = keyDetailsMap.get(r.platform);
    return {
      modelDbId: r.model_db_id,
      priority: r.priority,
      effectivePriority: r.priority + (penalty?.penalty ?? 0),
      penalty: penalty?.penalty ?? 0,
      rateLimitHits: penalty?.count ?? 0,
      enabled: r.enabled === 1,
      platform: r.platform,
      modelId: r.model_id,
      displayName: r.display_name,
      intelligenceRank: r.intelligence_rank,
      speedRank: r.speed_rank,
      sizeLabel: r.size_label,
      rpmLimit: r.rpm_limit,
      rpdLimit: r.rpd_limit,
      monthlyTokenBudget: r.monthly_token_budget,
      keyCount: kd?.enabled_count ?? 0,
      keyHealth: {
        healthy: kd?.healthy ?? 0,
        rateLimited: kd?.rate_limited ?? 0,
        invalid: kd?.invalid ?? 0,
        error: kd?.errored ?? 0,
      },
    };
  }));
});

const updateSchema = z.array(z.object({
  modelDbId: z.number(),
  priority: z.number(),
  enabled: z.boolean(),
}));

// Update fallback chain (full replace)
fallbackRouter.put('/', (req: Request, res: Response) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }

  const db = getDb();
  const update = db.prepare(`
    UPDATE fallback_config SET priority = ?, enabled = ? WHERE model_db_id = ?
  `);

  const updateAll = db.transaction(() => {
    for (const entry of parsed.data) {
      update.run(entry.priority, entry.enabled ? 1 : 0, entry.modelDbId);
    }
  });
  updateAll();

  res.json({ success: true });
});

// Sort presets — `orderBy` is selected from a fixed whitelist, never from
// user input directly, so the interpolation below is safe.
const SORT_PRESETS: Record<string, string> = {
  intelligence: 'm.intelligence_rank ASC',
  speed: 'm.speed_rank ASC',
  budget: "CASE m.monthly_token_budget WHEN '~120M' THEN 1 WHEN '~50-100M' THEN 2 WHEN '~30M' THEN 3 WHEN '~18-45M' THEN 4 WHEN '~18M' THEN 5 WHEN '~15M' THEN 6 WHEN '~12M' THEN 7 WHEN '~6M' THEN 8 WHEN '~5-10M' THEN 9 WHEN '~4M' THEN 10 ELSE 11 END ASC",
};

fallbackRouter.post('/sort/:preset', (req: Request, res: Response) => {
  const preset = String(req.params.preset);
  const orderBy = SORT_PRESETS[preset];
  if (!orderBy) {
    res.status(400).json({ error: { message: `Unknown preset: ${preset}. Use: intelligence, speed, budget` } });
    return;
  }

  const db = getDb();
  const models = db.prepare(`SELECT m.id FROM models m ORDER BY ${orderBy}`).all() as { id: number }[];

  const update = db.prepare('UPDATE fallback_config SET priority = ? WHERE model_db_id = ?');
  const reorder = db.transaction(() => {
    for (let i = 0; i < models.length; i++) {
      update.run(i + 1, models[i].id);
    }
  });
  reorder();

  res.json({ success: true, preset });
});

// Token usage per model for the stacked bar
fallbackRouter.get('/token-usage', (_req: Request, res: Response) => {
  const db = getDb();

  // Get platforms that have enabled keys
  const platforms = db.prepare(`
    SELECT DISTINCT ak.platform
    FROM api_keys ak
    WHERE ak.enabled = 1
  `).all() as { platform: string }[];
  const platformSet = new Set(platforms.map(p => p.platform));

  // Get monthly budget per model, ordered by fallback priority
  const models = db.prepare(`
    SELECT m.platform, m.model_id, m.display_name, m.monthly_token_budget,
           fc.priority
    FROM models m
    JOIN fallback_config fc ON fc.model_db_id = m.id
    WHERE m.enabled = 1
    ORDER BY fc.priority ASC
  `).all() as { platform: string; model_id: string; display_name: string; monthly_token_budget: string; priority: number }[];

  function parseBudget(s: string): number {
    const m = s.match(/~?([\d.]+)(?:-([\d.]+))?([MK])?/);
    if (!m) return 0;
    const high = parseFloat(m[2] ?? m[1]);
    const unit = m[3] === 'M' ? 1_000_000 : m[3] === 'K' ? 1_000 : 1;
    return high * unit;
  }

  // Build per-model breakdown (only platforms with keys)
  const modelBudgets: { displayName: string; platform: string; budget: number }[] = [];
  const handledPlatforms = new Set<string>();

  for (const m of models) {
    if (!platformSet.has(m.platform)) continue;
    
    // If it's a shared-limit platform (like Cloudflare), only emit one budget item for the entire platform
    if (m.platform === 'cloudflare') {
      if (!handledPlatforms.has(m.platform)) {
        modelBudgets.push({
          displayName: 'Cloudflare (Shared)',
          platform: m.platform,
          budget: parseBudget(m.monthly_token_budget),
        });
        handledPlatforms.add(m.platform);
      }
    } else {
      modelBudgets.push({
        displayName: m.display_name,
        platform: m.platform,
        budget: parseBudget(m.monthly_token_budget),
      });
    }
  }

  const totalBudget = modelBudgets.reduce((s, m) => s + m.budget, 0);

  // Tokens used this month
  const usage = db.prepare(`
    SELECT
      COALESCE(SUM(input_tokens + output_tokens), 0) as total_used
    FROM requests
    WHERE created_at >= datetime('now', 'start of month')
  `).get() as { total_used: number };

  res.json({
    totalBudget,
    totalUsed: usage.total_used,
    models: modelBudgets,
  });
});
