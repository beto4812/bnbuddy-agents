# BnBuddy Agents — Agent Instructions

## Project

Centralized repository for all BnBuddy agent pipelines, instructions, and automation. Contains the SEO content pipeline that powers automated keyword research, content generation, ranking monitoring, and reporting for [bnbuddy.com](https://bnbuddy.com).

## Agent Roles

| Agent | Instructions | Purpose |
|-------|-------------|---------|
| Research Agent | `pipelines/seo-content-pipeline/agents/research-agent.md` | Run `generate-brief` script, commit weekly content brief |
| Content Agent | `pipelines/seo-content-pipeline/agents/content-agent.md` | Write content markdown from brief (blog posts, comparison posts) |
| Monitor Agent | `pipelines/seo-content-pipeline/agents/monitor-agent.md` | Track rankings via Google Search Console |

Provider-to-agent mapping and schedules are in `pipelines/seo-content-pipeline/ORCHESTRATORS.md`.

## Environment

- macOS / Linux
- Node.js 20+
- Git (push access to `seo-agent/content` branch)

## Commands

- `npm run pull-ranking-data` — Pull fresh Search Console data
- `npm run compare-rankings` — Pre-compute ranking deltas
- `npm run pull-keyword-data` — Fetch keyword data from DataForSEO
- `npm run generate-brief` — Generate weekly content brief

## Coding Standards

- Commit messages: `seo: [action] [target]` (e.g., `seo: add blog — airbnb automation guide`)
- Content files: YAML frontmatter + Markdown body
- English is the primary content language. Spanish content uses proper accents (á, é, í, ó, ú, ñ, ü)
- Do NOT generate HTML — only markdown. Build scripts handle HTML conversion.

## Web Research

When agent instructions say "fetch", "research", or "verify" a URL, use whatever HTTP/search tool is available in your environment. Different platforms provide different tools — use what's available.

**All products, pricing, features, statistics, and claims must be verified via web research.** Do not hallucinate data.

## Git Workflow

- `git pull` before starting any work
- Commit related changes together
- Push to `seo-agent/content` branch
- If direct push is not available, create a Pull Request instead
- If push fails (non-fast-forward), pull, re-read state files, and retry

## Key Directories

```
pipelines/seo-content-pipeline/
├── agents/              ← Agent instruction files
├── content/             ← Content Agent output (markdown files)
├── data/                ← Runtime data (briefs, ranking data, reports)
│   ├── briefs/          ← Research Agent output (date-stamped)
│   ├── dataforseo/      ← Keyword queue + raw API data
│   ├── reports/         ← Monitor Agent reports (date-stamped)
│   └── archive/         ← Previous ranking snapshots
├── scripts/             ← Node.js scripts (ranking, keywords)
└── page-template.html   ← HTML template for content pages
```

> **Note:** Geo pages (Toluca, Metepec) are frozen as of 2026-05-02. No new geo pages.

## Gemini / Jules Instructions

- Use shell commands (`curl`, `wget`) or built-in browsing for HTTP requests
- Use shell for git operations and running npm scripts
- Submit changes as Pull Requests (Jules cloud VM workflow)
- PR title format: `seo: [action] [target]`
- Include a summary of changes in the PR description
- Jules handles the **technical/data** tasks (Research Agent, Monitor Agent)
- See `pipelines/seo-content-pipeline/ORCHESTRATORS.md` for the full schedule

## BnBuddy Context

**Product:** SaaS platform for vacation rental hosts. Core digital products:
- **AI Guest Assistant** — 24/7 automated guest communication
- **Digital Guidebooks** — interactive property guides with QR codes
- **Direct Booking Portal** — branded booking pages that skip OTA fees

**Secondary service:** Full-service co-hosting/management in Toluca and Metepec (Mexico).

**Credibility signals:**
- Superhost status
- 100% 5-star reviews
- Airbnb Top 5%
- 80%+ occupancy across managed properties
