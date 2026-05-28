import type { Platform, ImageGenerationResponse } from '@freellmapi/shared/types.js';
import { BaseProvider, type ImageGenerationOptions } from './base.js';

export interface OpenAICompatConfig {
  platform: Platform;
  name: string;
  baseUrl: string;
  extraHeaders?: Record<string, string>;
}

export class OpenAICompatProvider extends BaseProvider {
  readonly platform: Platform;
  readonly name: string;
  private readonly baseUrl: string;
  private readonly extraHeaders: Record<string, string>;

  constructor(config: OpenAICompatConfig) {
    super();
    this.platform = config.platform;
    this.name = config.name;
    this.baseUrl = config.baseUrl;
    this.extraHeaders = config.extraHeaders ?? {};
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
}
