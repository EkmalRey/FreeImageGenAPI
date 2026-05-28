import type { Platform } from '@freellmapi/shared/types.js';
import type { BaseProvider } from './base.js';
import { OpenAICompatProvider } from './openai-compat.js';
import { PollinationsProvider } from './pollinations.js';
import { HuggingFaceProvider } from './huggingface.js';
import { CloudflareProvider } from './cloudflare.js';

const providers = new Map<Platform, BaseProvider>();

function register(provider: BaseProvider) {
  providers.set(provider.platform, provider);
}

// Pollinations
register(new PollinationsProvider());

// Hugging Face
register(new HuggingFaceProvider());

// Cloudflare Workers AI
register(new CloudflareProvider());

// Together AI
register(new OpenAICompatProvider({
  platform: 'together',
  name: 'Together AI',
  baseUrl: 'https://api.together.xyz/v1',
}));

// Fal.ai
register(new OpenAICompatProvider({
  platform: 'fal',
  name: 'Fal.ai',
  baseUrl: 'https://fal.run/v1',
}));

// DeepInfra
register(new OpenAICompatProvider({
  platform: 'deepinfra',
  name: 'DeepInfra',
  baseUrl: 'https://api.deepinfra.com/v1/openai',
}));

// Segmind
register(new OpenAICompatProvider({
  platform: 'segmind',
  name: 'Segmind',
  baseUrl: 'https://api.segmind.com/v1',
}));

export function getProvider(platform: Platform): BaseProvider | undefined {
  return providers.get(platform);
}

export function getAllProviders(): BaseProvider[] {
  return Array.from(providers.values());
}

export function hasProvider(platform: Platform): boolean {
  return providers.has(platform);
}
