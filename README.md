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
npm run pull-ranking-data    # Pull fresh Search Console data
npm run compare-rankings     # Pre-compute ranking deltas
npm run pull-keyword-data    # Fetch keywords from DataForSEO
npm run generate-brief       # Generate weekly content brief
```

## Setup

```bash
npm install
```

Required environment variables (see `.env.example`):
- Google Search Console service account credentials
- DataForSEO API credentials

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
