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
}
