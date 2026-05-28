<div align="center">

# FreeImageGenAPI

**One OpenAI-compatible endpoint. Seven free image generation providers.**

Aggregate free image generation APIs from Pollinations, HuggingFace, Cloudflare Workers AI, Together AI, Fal.ai, DeepInfra, and Segmind behind a single `POST /v1/images/generations` endpoint. API keys are stored encrypted. The router picks the best available model for each request, falls over to the next provider when one is rate-limited, and tracks per-key usage.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

![Fallback chain](repo-assets/fallback-chain.png)

</div>

---

## Contents

- [Supported providers](#supported-providers)
- [Features](#features)
- [Quick start](#quick-start)
- [Using the API](#using-the-api)
- [Playground](#playground)
- [How it works](#how-it-works)
- [Limitations](#limitations)
- [License](#license)

## Supported providers

| Provider | API Key Required | Notes |
|---|---|---|
| **Pollinations** | No | Free, public, no key needed |
| **HuggingFace** | Yes | FLUX.1-schnell via Inference API |
| **Cloudflare Workers AI** | Yes | Needs `ACCOUNT_ID:API_TOKEN` |
| **Together AI** | Yes | Flux Schnell, SDXL |
| **Fal.ai** | Yes | Dynamic model catalog |
| **DeepInfra** | Yes | Flux Schnell |
| **Segmind** | Yes | Dynamic model catalog |

## Features

- **OpenAI-compatible** — `POST /v1/images/generations` and `GET /v1/models` work with the official OpenAI SDKs. Just change `base_url`.
- **Automatic fallover** — If a provider returns a 429, 5xx, or times out, the router skips it, puts the key on a cooldown, and retries the next model in your fallback chain (up to 20 attempts).
- **Per-key rate tracking** — RPM and RPD counters per `(platform, model, key)` so the router always picks a key that's under its caps.
- **Encrypted key storage** — API keys are encrypted with AES-256-GCM before hitting SQLite; decryption happens in-memory just before a request.
- **Unified API key** — Clients authenticate to your proxy with a single `sk-…` bearer token. You never expose upstream provider keys to your apps.
- **Health checks** — Periodic probes mark keys as `healthy`, `rate_limited`, `invalid`, or `error` so the router skips dead ones automatically.
- **Persistent chat sessions** — The built-in playground saves every chat with images, metadata, and timestamps. Sessions persist across page refreshes with auto-rename and per-session model selection.
- **Admin dashboard** — React + Vite UI to manage keys, reorder the fallback chain, inspect analytics, and generate images in a persistent chat playground. Dark mode included.
- **Analytics** — Per-request logging with latency, success rate, and per-provider breakdowns.
- **Runs anywhere Node 20+ runs** — Windows, macOS, Linux, Docker. ~40 MB RSS at idle.

## Not yet supported

- **Text chat** (`/v1/chat/completions`) — this is an image-only proxy
- **Audio / speech** (`/v1/audio/*`)
- **Embeddings** (`/v1/embeddings`)
- **Image editing / variations** (`/v1/images/edits`, `/v1/images/variations`)
- **Multi-tenant auth** — single-user by design

## Quick start

**Prerequisites:** Node.js 20+, npm.

```bash
git clone https://github.com/anomalyco/FreeImageGenAPI.git
cd FreeImageGenAPI
npm install

# Generate an encryption key for at-rest key storage
cp .env.example .env
echo "ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")" >> .env

# Start server + dashboard together
npm run dev
```

Open http://localhost:5173, add your provider keys on the **Keys** page, reorder the **Fallback** chain, and grab your unified API key from the **Keys** page header. Start generating in the **Playground**.

For a production build:

```bash
npm run build
node server/dist/index.js     # server + dashboard both served on :3002
```

Or use Docker:

```bash
docker build -t freeimagegenapi .
docker run -p 3002:3002 -e ENCRYPTION_KEY=<your-key> freeimagegenapi
```

## Using the API

Any OpenAI-compatible client works. Examples:

**Python**

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3002/v1",
    api_key="sk-your-unified-key",
)

resp = client.images.generate(
    model="auto",  # let the router pick; or specify a model ID
    prompt="A futuristic cyberpunk city at night",
    n=1,
    size="1024x1024",
)
print(resp.data[0].url)
```

**curl**

```bash
curl http://localhost:3002/v1/images/generations \
  -H "Authorization: Bearer sk-your-unified-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "prompt": "A serene mountain landscape at sunset, digital art",
    "n": 1,
    "size": "1024x1024"
  }'
```

Every response carries an `X-Routed-Via: <platform>/<model>` header so you can see which provider served the request. If a request fell over between providers, you'll also see `X-Fallback-Attempts: N`.

## Playground

The built-in playground provides a persistent chat interface with:

- **Session management** — create, rename, and delete chat sessions. Each session stores its full message history and selected model.
- **Auto-rename** — sessions are automatically named after the first prompt.
- **Model per session** — each session remembers its chosen model.
- **Metadata display** — each generated image shows its provider, model, latency, and file size.
- **Sidebar** — collapsible sidebar with session list, image count, and relative timestamps.

![Playground page](repo-assets/playground.png)

## How it works

```
┌──────────────────┐   Bearer sk-…         ┌─────────────────────────┐
│  OpenAI SDK /    │ ────────────────────▶  │  Express proxy (:3002)  │
│  curl / any      │ ◀────────────────────  │  /v1/images/generations │
│  OpenAI client   │    image URLs / b64    └────────────┬────────────┘
└──────────────────┘                                     │
                                                          ▼
                    ┌──────────────────────────────────────────────────┐
                    │  Router                                          │
                    │   1. Pick highest-priority model that            │
                    │      (a) has a healthy key and                   │
                    │      (b) is under all rate limits.               │
                    │   2. Decrypt key, call provider API.             │
                    │   3. On 429/5xx → cooldown + retry next model.   │
                    └──────────────────────────────────────────────────┘
                                  │
     ┌─────────┬──────────┬──────┴───────┬──────────┬──────────┐
     ▼         ▼          ▼              ▼          ▼          ▼
  Pollinations  HF    Cloudflare      Together    Fal.ai    DeepInfra
```

- **Router** (`server/src/services/router.ts`) — picks a model per request with sticky sessions and dynamic penalties.
- **Rate-limit ledger** (`server/src/services/ratelimit.ts`) — in-memory RPM/RPD counters backed by SQLite, with escalating cooldowns on 429s.
- **Provider adapters** (`server/src/providers/*.ts`) — one file per provider, implementing `generateImage()`.
- **Health service** (`server/src/services/health.ts`) — periodic probe keeps key status fresh.
- **Dashboard** (`client/`) — React + Vite + shadcn/ui admin surface with persistent chat sessions.
- **Storage** — SQLite (`better-sqlite3`) with AES-256-GCM envelope encryption for keys.

## Limitations

- **No frontier image models.** Free-tier image generation tops out around FLUX.1-schnell and SDXL-class models.
- **Latency is variable.** Providers have different queue times; you get whichever one is available.
- **Free tiers can change without notice.** Providers regularly tighten or remove free access.
- **No SLA.** Run this for yourself; don't expose it to the internet.
- **Local-first.** There's no multi-tenant auth.

## License

[MIT](./LICENSE)
