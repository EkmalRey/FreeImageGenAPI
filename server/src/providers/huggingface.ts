import type { ImageGenerationResponse } from '@freellmapi/shared/types.js';
import { BaseProvider, type ImageGenerationOptions } from './base.js';

export class HuggingFaceProvider extends BaseProvider {
  readonly platform = 'huggingface';
  readonly name = 'Hugging Face Inference';

  async generateImage(
    apiKey: string,
    prompt: string,
    modelId: string,
    options?: ImageGenerationOptions,
  ): Promise<ImageGenerationResponse> {
    const url = `https://api-inference.huggingface.co/models/${modelId}`;
    
    const data = [];
    const n = options?.n ?? 1;

    for (let i = 0; i < n; i++) {
      const res = await this.fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ inputs: prompt }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => 'No error body');
        throw new Error(`HuggingFace failed: ${res.status} ${text}`);
      }

      const buffer = await res.arrayBuffer();
      const b64 = Buffer.from(buffer).toString('base64');
      const mime = 'image/jpeg'; 

      if (options?.response_format === 'url') {
        data.push({ url: `data:${mime};base64,${b64}` });
      } else {
        data.push({ b64_json: b64 });
      }
    }

    return {
      created: Math.floor(Date.now() / 1000),
      data,
    };
  }

  async validateKey(apiKey: string): Promise<boolean> {
    try {
      const url = 'https://huggingface.co/api/whoami-v2';
      const res = await this.fetchWithTimeout(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
      }, 5000);
      return res.ok;
    } catch {
      return false;
    }
  }

  async syncModels(_apiKey: string, db: import('better-sqlite3').Database): Promise<void> {
    const staticModels = [
      { model_id: 'black-forest-labs/FLUX.1-schnell', display_name: 'FLUX.1-schnell (HF)', intelligence_rank: 1, speed_rank: 3, size_label: 'Standard', monthly_token_budget: 'Free Tier' }
    ];

    try {
      const disableOld = db.prepare(`UPDATE models SET enabled = 0 WHERE platform = 'huggingface'`);
      const insertModel = db.prepare(`
        INSERT INTO models (platform, model_id, display_name, intelligence_rank, speed_rank, size_label, monthly_token_budget, enabled)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT(platform, model_id) DO UPDATE SET enabled = 1
      `);
      const insertFallback = db.prepare(`
        INSERT INTO fallback_config (model_db_id, priority, enabled)
        SELECT id, (SELECT COALESCE(MAX(priority), 0) + 1 FROM fallback_config), 1
        FROM models 
        WHERE platform = ? AND model_id = ?
        AND id NOT IN (SELECT model_db_id FROM fallback_config)
      `);

      const syncAll = db.transaction(() => {
        disableOld.run();
        for (const m of staticModels) {
          insertModel.run('huggingface', m.model_id, m.display_name, m.intelligence_rank, m.speed_rank, m.size_label, m.monthly_token_budget);
          insertFallback.run('huggingface', m.model_id);
        }
      });

      syncAll();
      console.log(`[Hugging Face] Synced ${staticModels.length} static image models.`);
    } catch (e) {
      console.error('[Hugging Face] Failed to sync models:', e);
    }
  }
}
