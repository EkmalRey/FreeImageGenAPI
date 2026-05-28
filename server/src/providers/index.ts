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
  staticModels: [
    { model_id: 'black-forest-labs/FLUX.1-schnell', display_name: 'Flux Schnell (Together)', intelligence_rank: 1, speed_rank: 4, size_label: 'Standard', monthly_token_budget: '$25 Trial' },
    { model_id: 'stabilityai/stable-diffusion-xl-base-1.0', display_name: 'SDXL (Together)', intelligence_rank: 3, speed_rank: 4, size_label: 'Standard', monthly_token_budget: '$25 Trial' }
  ]
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
  staticModels: [
    { model_id: 'black-forest-labs/FLUX-1-schnell', display_name: 'Flux Schnell (DeepInfra)', intelligence_rank: 1, speed_rank: 5, size_label: 'Standard', monthly_token_budget: 'Trial' }
  ]
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
