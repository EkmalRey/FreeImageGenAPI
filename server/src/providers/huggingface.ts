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
}
