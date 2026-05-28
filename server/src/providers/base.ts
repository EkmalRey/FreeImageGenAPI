import type {
  Platform,
  ImageGenerationResponse,
} from '@freellmapi/shared/types.js';

export interface ImageGenerationOptions {
  n?: number;
  size?: string;
  response_format?: 'url' | 'b64_json';
  quality?: 'standard' | 'hd';
  style?: 'vivid' | 'natural';
}

export abstract class BaseProvider {
  abstract readonly platform: Platform;
  abstract readonly name: string;

  abstract generateImage(
    apiKey: string,
    prompt: string,
    modelId: string,
    options?: ImageGenerationOptions,
  ): Promise<ImageGenerationResponse>;

  abstract validateKey(apiKey: string): Promise<boolean>;

  protected async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs = 60000, // image generation takes longer
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }
}
