import type { ImageGenerationResponse } from '@freeimagegenapi/shared/types.js';
import type { Database } from 'better-sqlite3';
import { BaseProvider, type ImageGenerationOptions } from './base.js';

export class CloudflareProvider extends BaseProvider {
  readonly platform = 'cloudflare';
  readonly name = 'Cloudflare Workers AI';

  private readonly staticModels = [
    { id: '@cf/black-forest-labs/flux-2-klein-9b', name: 'flux-2-klein-9b', int: 1, spd: 4, label: 'Standard', tpd: 10000, cost: 1364, taskType: 'img2img' as const },
    { id: '@cf/runwayml/stable-diffusion-v1-5-inpainting', name: 'stable-diffusion-v1-5-inpainting', int: 4, spd: 1, label: 'Standard', tpd: 10000, cost: 10, taskType: 'img2img' as const },
    { id: '@cf/black-forest-labs/flux-1-schnell', name: 'flux-1-schnell', int: 2, spd: 2, label: 'Standard', tpd: 10000, cost: 172.8, taskType: 'text-to-image' as const },
    { id: '@cf/bytedance/stable-diffusion-xl-lightning', name: 'stable-diffusion-xl-lightning', int: 3, spd: 1, label: 'Standard', tpd: 10000, cost: 20, taskType: 'text-to-image' as const },
    { id: '@cf/lykon/dreamshaper-8-lcm', name: 'dreamshaper-8-lcm', int: 3, spd: 1, label: 'Standard', tpd: 10000, cost: 15, taskType: 'text-to-image' as const },
    { id: '@cf/stabilityai/phoenix-1.0', name: 'phoenix-1.0', int: 2, spd: 3, label: 'Standard', tpd: 10000, cost: 20, taskType: 'text-to-image' as const },
    { id: '@cf/stabilityai/stable-diffusion-xl-base-1.0', name: 'stable-diffusion-xl-base-1.0', int: 3, spd: 3, label: 'Standard', tpd: 10000, cost: 20, taskType: 'text-to-image' as const },
    { id: '@cf/black-forest-labs/flux-2-klein-4b', name: 'flux-2-klein-4b', int: 2, spd: 3, label: 'Standard', tpd: 10000, cost: 31, taskType: 'img2img' as const },
    { id: '@cf/black-forest-labs/flux-2-dev', name: 'flux-2-dev', int: 1, spd: 5, label: 'Standard', tpd: 10000, cost: 56, taskType: 'img2img' as const },
    { id: '@cf/runwayml/stable-diffusion-v1-5-img2img', name: 'stable-diffusion-v1-5-img2img', int: 4, spd: 2, label: 'Standard', tpd: 10000, cost: 10, taskType: 'img2img' as const },
    { id: '@cf/lucid-origin/lucid-origin', name: 'lucid-origin', int: 2, spd: 3, label: 'Standard', tpd: 10000, cost: 20, taskType: 'text-to-image' as const },
  ];

  async generateImage(
    apiKey: string,
    prompt: string,
    modelId: string,
    options?: ImageGenerationOptions,
  ): Promise<ImageGenerationResponse> {
    const parts = apiKey.split(':');
    if (parts.length !== 2) {
      throw new Error('Cloudflare key must be in format "ACCOUNT_ID:API_TOKEN"');
    }
    const accountId = parts[0].trim();
    const token = parts[1].trim();

    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${modelId}`;
    const isFlux2 = modelId.includes('flux-2-');

    const data = [];
    const n = options?.n ?? 1;

    for (let i = 0; i < n; i++) {
      let res: Response;

      if (options?.image && isFlux2) {
        // Flux-2 models use multipart form data with input_image_0
        const form = new FormData();
        form.append('prompt', prompt);
        const imageBuffer = Buffer.from(options.image, 'base64');
        const imageBlob = new Blob([imageBuffer], { type: 'image/png' });
        form.append('input_image_0', imageBlob);
        res = await this.fetchWithTimeout(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        });
      } else if (options?.image) {
        // Stable Diffusion models use JSON with image_b64
        res = await this.fetchWithTimeout(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ prompt, image_b64: options.image }),
        });
      } else {
        // Text-to-image: JSON with prompt only
        res = await this.fetchWithTimeout(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ prompt }),
        });
      }

      if (!res.ok) {
        const text = await res.text().catch(() => 'No error body');
        throw new Error(`Cloudflare failed: ${res.status} ${text}`);
      }

      // Cloudflare may return binary image or JSON containing the base64 image
      const contentType = res.headers.get('content-type') || '';
      let b64: string;
      let mime = 'image/png'; // Default fallback

      if (contentType.includes('application/json')) {
        const json = await res.json() as any;
        if (!json.success) {
          throw new Error(`Cloudflare failed: ${JSON.stringify(json.errors)}`);
        }
        b64 = json.result?.image || '';
        // Sometimes Cloudflare provides format info, or we just assume jpeg for flux
        mime = 'image/jpeg';
      } else {
        const buffer = await res.arrayBuffer();
        b64 = Buffer.from(buffer).toString('base64');
        mime = contentType || 'image/png';
      }

      if (options?.response_format === 'url') {
        data.push({ url: `data:${mime};base64,${b64}` });
      } else {
        data.push({ b64_json: b64 });
      }
    }

    const modelObj = this.staticModels.find(m => m.id === modelId || m.name === modelId);
    const costPerImage = modelObj ? modelObj.cost : 20;

    return {
      created: Math.floor(Date.now() / 1000),
      data,
      _usage: {
        total_tokens: costPerImage * n,
      }
    };
  }

  async validateKey(apiKey: string): Promise<boolean> {
    try {
      const parts = apiKey.split(':');
      if (parts.length !== 2) return false;
      const accountId = parts[0].trim();
      const token = parts[1].trim();
      const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/models/search`;
      const res = await this.fetchWithTimeout(url, {
        headers: { Authorization: `Bearer ${token}` },
      }, 5000);
      return res.ok;
    } catch {
      return false;
    }
  }

  async syncModels(apiKey: string, db: Database): Promise<void> {
    const parts = apiKey.split(':');
    if (parts.length !== 2) return;
    const accountId = parts[0].trim();
    const token = parts[1].trim();

    try {
      const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/models/search`;
      const res = await this.fetchWithTimeout(url, {
        headers: { Authorization: `Bearer ${token}` },
      }, 10000);

      if (!res.ok) return;

      const data = await res.json() as any;
      if (!data.success || !Array.isArray(data.result)) return;

      const imageModels = data.result.filter((m: any) => m.task && m.task.name === 'Text-to-Image');
      
      const disableOld = db.prepare(`UPDATE models SET enabled = 0 WHERE platform = 'cloudflare'`);
      const insertModel = db.prepare(`
        INSERT INTO models (platform, model_id, display_name, intelligence_rank, speed_rank, size_label, task_type, tpd_limit, monthly_token_budget, enabled)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT(platform, model_id) DO UPDATE SET 
          enabled = 1, 
          intelligence_rank = excluded.intelligence_rank,
          speed_rank = excluded.speed_rank,
          size_label = excluded.size_label,
          task_type = excluded.task_type,
          tpd_limit = excluded.tpd_limit, 
          monthly_token_budget = excluded.monthly_token_budget
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
        for (const m of imageModels) {
          const modelIdStr = m.name;
          const staticMeta = this.staticModels.find(s => s.id === modelIdStr || s.name === modelIdStr);
          
          const int = staticMeta ? staticMeta.int : 3;
          const spd = staticMeta ? staticMeta.spd : 3;
          const label = staticMeta ? staticMeta.label : 'Standard';
          const taskType = staticMeta ? staticMeta.taskType : 'text-to-image';
          const tpd = 10000;
          
          insertModel.run('cloudflare', modelIdStr, modelIdStr.split('/').pop() || modelIdStr, int, spd, label, taskType, tpd, '10K Tokens/Day');
          insertFallback.run('cloudflare', modelIdStr);
        }
      });
      
      syncAll();
      console.log(`[Cloudflare] Synced ${imageModels.length} dynamic image generation models with static metadata.`);
    } catch (e) {
      console.error('[Cloudflare] Failed to sync models:', e);
    }
  }
}
