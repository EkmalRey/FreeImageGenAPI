import type { ImageGenerationResponse } from '@freellmapi/shared/types.js';
import { BaseProvider, type ImageGenerationOptions } from './base.js';

export class PollinationsProvider extends BaseProvider {
  readonly platform = 'pollinations';
  readonly name = 'Pollinations';

  async generateImage(
    _apiKey: string, // Pollinations is free, no key required, but we'll accept it
    prompt: string,
    modelId: string,
    options?: ImageGenerationOptions,
  ): Promise<ImageGenerationResponse> {
    const size = options?.size ?? '1024x1024';
    const [widthStr, heightStr] = size.split('x');
    const width = parseInt(widthStr, 10) || 1024;
    const height = parseInt(heightStr, 10) || 1024;
    const n = options?.n ?? 1;

    const data = [];

    for (let i = 0; i < n; i++) {
      const seed = Math.floor(Math.random() * 1000000000);
      const encodedPrompt = encodeURIComponent(prompt);
      let url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&nologo=true&seed=${seed}`;
      
      if (modelId && modelId !== 'auto') {
        url += `&model=${modelId}`;
      }

      if (options?.response_format === 'b64_json') {
        const res = await this.fetchWithTimeout(url, {});
        if (!res.ok) {
          throw new Error(`Pollinations failed: ${res.status}`);
        }
        const buffer = await res.arrayBuffer();
        const b64 = Buffer.from(buffer).toString('base64');
        data.push({ b64_json: b64 });
      } else {
        data.push({ url });
      }
    }

    return {
      created: Math.floor(Date.now() / 1000),
      data,
    };
  }

  async validateKey(_apiKey: string): Promise<boolean> {
    // Pollinations doesn't require a key
    return true;
  }

  async syncModels(_apiKey: string, db: import('better-sqlite3').Database): Promise<void> {
    try {
      const res = await this.fetchWithTimeout('https://image.pollinations.ai/models', {}, 10000);
      if (!res.ok) return;

      const models = await res.json() as string[];
      
      const disableOld = db.prepare(`UPDATE models SET enabled = 0 WHERE platform = 'pollinations'`);
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
        for (const modelId of models) {
          const displayName = modelId.charAt(0).toUpperCase() + modelId.slice(1) + ' (Pollinations)';
          insertModel.run('pollinations', modelId, displayName, 1, 1, 'Standard', 'Unlimited');
          insertFallback.run('pollinations', modelId);
        }
      });
      
      syncAll();
      console.log(`[Pollinations] Synced ${models.length} image generation models.`);
    } catch (e) {
      console.error('[Pollinations] Failed to sync models:', e);
    }
  }
}
