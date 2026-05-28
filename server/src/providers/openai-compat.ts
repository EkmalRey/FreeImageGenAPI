import type { Platform, ImageGenerationResponse } from '@freellmapi/shared/types.js';
import { BaseProvider, type ImageGenerationOptions } from './base.js';

export interface OpenAICompatModel {
  model_id: string;
  display_name: string;
  intelligence_rank: number;
  speed_rank: number;
  size_label: string;
  monthly_token_budget: string;
}

export interface OpenAICompatConfig {
  platform: Platform;
  name: string;
  baseUrl: string;
  extraHeaders?: Record<string, string>;
  staticModels?: OpenAICompatModel[];
}

export class OpenAICompatProvider extends BaseProvider {
  readonly platform: Platform;
  readonly name: string;
  private readonly baseUrl: string;
  private readonly extraHeaders: Record<string, string>;
  private readonly staticModels: OpenAICompatModel[];

  constructor(config: OpenAICompatConfig) {
    super();
    this.platform = config.platform;
    this.name = config.name;
    this.baseUrl = config.baseUrl;
    this.extraHeaders = config.extraHeaders ?? {};
    this.staticModels = config.staticModels ?? [];
  }

  async generateImage(
    apiKey: string,
    prompt: string,
    modelId: string,
    options?: ImageGenerationOptions,
  ): Promise<ImageGenerationResponse> {
    const url = `${this.baseUrl}/images/generations`;

    const body = {
      model: modelId,
      prompt,
      n: options?.n ?? 1,
      size: options?.size ?? '1024x1024',
      response_format: options?.response_format ?? 'url',
    };

    const res = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...this.extraHeaders,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      let errText = await res.text().catch(() => 'No error body');
      throw new Error(`API error ${res.status}: ${errText}`);
    }

    const data = await res.json();
    return data as ImageGenerationResponse;
  }

  async validateKey(apiKey: string): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/models`;
      const res = await this.fetchWithTimeout(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
      }, 5000);
      return res.ok;
    } catch {
      return false;
    }
  }

  async syncModels(apiKey: string, db: import('better-sqlite3').Database): Promise<void> {
    if (this.staticModels.length === 0) return;

    try {
      const disableOld = db.prepare(`UPDATE models SET enabled = 0 WHERE platform = ?`);
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
        disableOld.run(this.platform);
        for (const m of this.staticModels) {
          insertModel.run(this.platform, m.model_id, m.display_name, m.intelligence_rank, m.speed_rank, m.size_label, m.monthly_token_budget);
          insertFallback.run(this.platform, m.model_id);
        }
      });

      syncAll();
      console.log(`[${this.name}] Synced ${this.staticModels.length} static image models.`);
    } catch (e) {
      console.error(`[${this.name}] Failed to sync static models:`, e);
    }
  }
}
