# BnBuddy Agents

Centralized home for all BnBuddy agent pipelines, automation scripts, and AI agent instructions.

## Overview

This repository contains the **SEO Content Pipeline** — an automated system that coordinates AI agents for keyword research, content generation, and ranking monitoring for [bnbuddy.com](https://bnbuddy.com).

## Pipelines

### SEO Content Pipeline (`pipelines/seo-content-pipeline/`)

A multi-agent pipeline with three active agents:

| Agent | Schedule | Provider | Purpose |
|-------|----------|----------|---------|
| **Research Agent** | Monday | Jules (Gemini) | Runs keyword data scripts, generates weekly content brief |
| **Content Agent** | Thursday | Claude (Opus) | Writes blog posts and comparison posts from briefs |
| **Monitor Agent** | Monday | Jules (Gemini) | Pulls Search Console data, produces ranking reports |

See [ORCHESTRATORS.md](pipelines/seo-content-pipeline/ORCHESTRATORS.md) for detailed scheduling and provider configuration.

## Commands

```bash
npm run pull-ranking-data      # Pull fresh Search Console data
npm run compare-rankings       # Pre-compute ranking deltas
npm run pull-keyword-data      # Fetch keywords from DataForSEO
npm run pull-exa-research      # Semantic competitor search via Exa AI
npm run pull-reddit-research   # Fetch top Reddit posts from host subreddits
npm run generate-brief         # Generate weekly content brief
npm run generate-content       # Write content via Claude (Vertex AI)
```

## Setup

```bash
npm install
```

### Credentials

All credentials live in `~/.config/bnbuddy/` (outside the repo, never committed).

#### Google Search Console — Service Account Key

Used by: `npm run pull-ranking-data`

The script automatically searches for credentials in this order:
1. `GSC_KEY_PATH` (environment variable override)
2. `~/.config/bnbuddy/gsc-service-account.json` (canonical default)
3. `~/.config/bnbuddy/bnbuddy-agents-service-account.json` (automatic fallback)

Standard GCP service account JSON key. The service account (`bnbuddy-agents-servcie-account@bnbuddy-agents.iam.gserviceaccount.com`) must be added as a user with Read permissions in [Google Search Console](https://search.google.com/search-console) for `sc-domain:bnbuddy.com`.

See [RANKING-DATA.md](pipelines/seo-content-pipeline/RANKING-DATA.md) for full ranking data documentation and troubleshooting.

```json
{
  "type": "service_account",
  "project_id": "bnbuddy-agents",
  "private_key_id": "...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "bnbuddy-agents-servcie-account@bnbuddy-agents.iam.gserviceaccount.com",
  "client_id": "...",
  "auth_uri": "https://oauth2.googleapis.com/auth",
  "token_uri": "https://oauth2.googleapis.com/token"
}
```

#### DataForSEO — `dataforseo.env`

Used by: `npm run pull-keyword-data`

```
~/.config/bnbuddy/dataforseo.env
```

```env
DATAFORSEO_LOGIN=your@email.com
DATAFORSEO_PASSWORD=your-api-password
```

Get credentials at [app.dataforseo.com](https://app.dataforseo.com/register).

#### Exa AI — `exa.env`

Used by: `npm run pull-exa-research`

```
~/.config/bnbuddy/exa.env
```

```env
EXA_API_KEY=exa-xxxxxxxxxxxx
```

Get your API key at [dashboard.exa.ai](https://dashboard.exa.ai/api-keys).

#### GCP Vertex AI (Application Default Credentials)

Used by: `npm run generate-content` (Claude via Vertex AI)

No file needed — uses `gcloud` ADC:

```bash
gcloud auth application-default login
```

#### Reddit / Jina (no credentials)

Used by: `npm run pull-reddit-research`

No API keys required — uses public RSS feeds + `r.jina.ai` free tier.

## Directory Structure

```
├── AGENTS.md                              ← Agent instructions (read by AI)
├── pipelines/
│   └── seo-content-pipeline/
│       ├── agents/                        ← Per-agent instruction files
│       ├── content/                       ← Generated markdown content
│       ├── data/                          ← Runtime data (briefs, rankings, reports)
│       ├── scripts/                       ← Node.js automation scripts
│       ├── ORCHESTRATORS.md               ← Provider scheduling config
│       ├── PIPELINE.md                    ← Pipeline architecture docs
│       └── page-template.html             ← HTML template for content pages
└── package.json
```
