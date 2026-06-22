# BnBuddy SEO Agent — Plan

**Created:** 2026-03-14
**Author:** Slash ⚡ (with Alberto)
**Status:** Draft
**Branch:** `feature/seo-agent-plan`

---

## 1. Problem Statement

BnBuddy offers property management services for short-term rentals in Toluca, Metepec, and surrounding cities in the State of Mexico. The landing site (`bnbuddy.com`) has **one** geo-targeted Spanish page (`/es/administracion-renta-vacacional-toluca/`) and a handful of Spanish blog posts. This is insufficient to establish local SEO authority and capture search traffic from property owners looking for Airbnb management services in the region.

The competitive landscape is extremely thin — no competitor has built dedicated geo landing pages for these markets. This is a window of opportunity that an automated agent pipeline can exploit systematically.

---

## 2. Research Findings

### 2.1 Current Site State (as of 2026-03-14)

**Spanish geo/service pages:**
| Page | Target |
|------|--------|
| `/es/administracion-renta-vacacional/` | Generic — no city |
| `/es/administracion-renta-vacacional-toluca/` | Toluca |

**Spanish blog posts (3 total):**
- `/es/como-invertir-en-airbnb/`
- `/es/guia-como-iniciar-en-airbnb/`
- `/es/optimizar-anuncio-alquiler-vacacional/`

**Missing:**
- No Metepec page
- No pages for surrounding cities
- No blog content targeting local long-tail keywords
- No topical cluster linking geo pages ↔ blog posts
- Blog index only has 2 pages

### 2.2 Existing Page Quality — Toluca (Template)

The Toluca page is well-built and serves as the **template** for new pages:
- ~1,500 words of locally-relevant content
- Specific landmarks (Cosmovitral, Nevado de Toluca, Centro Histórico, Plaza de los Mártires)
- Local events with dates (Feria del Alfeñique, Festival gastronómico, Maratón Ruta Otomí)
- Statistics from DataTur and AirDNA (occupancy %, avg nightly rate)
- Infrastructure mentions (Tren Interurbano, airport expansion)
- FAQ section
- Proper Rank Math metadata (title, description, canonical, OG tags, hreflang)

### 2.3 SEO Infrastructure

- **Analytics:** Google Analytics G-Y1ZZSX0LQW ✅
- **Sitemaps:** `sitemap_index.xml`, `post-sitemap.xml`, `page-sitemap.xml` ✅
- **Hreflang:** Alternate links for ES/EN ✅
- **Rank Math:** SEO metadata on all pages ✅
- **Interlinking:** JSON-based interlinking system (`interlinking/`) ✅
- **Post-processing scripts:** Full pipeline (`scripts/`) ✅
- **Perplexity API key:** ❌ Pending (Alberto will provide)
- **Google Search Console API:** ❌ Pending (Alberto will provide)

### 2.4 Competitor Analysis — BnBHomeMx

| Signal | BnBHomeMx | BnBuddy |
|--------|-----------|---------|
| Platform | Wix | Firebase (static HTML) |
| Total pages | 4 | 50+ |
| Geo landing pages | 0 | 1 (Toluca) |
| Blog posts | 0 | 6+ (EN + ES) |
| Cities listed | CDMX, QRO, Valle de Bravo, Tequis, Mérida, Tulum | Toluca, Metepec, Querétaro |
| Toluca/Metepec mention | **None** | ✅ |
| SEO sophistication | Minimal (Wix defaults) | Rank Math, hreflang, structured sitemaps |

**Verdict:** Not a meaningful local SEO competitor for State of Mexico markets. The field is open.

---

## 3. Objectives

### 3.1 Primary Goal
Rank BnBuddy on **page 1 of Google** for high-intent property management queries across relevant cities in the State of Mexico within 90 days.

### 3.2 Specific Targets
1. **Geo landing pages:** Dedicated page for each relevant city (identified by Research Agent)
2. **Blog content:** 2-4 locally-targeted blog posts per month (Spanish)
3. **Internal linking:** Topical cluster connecting all geo pages and blog posts
4. **Sitemap freshness:** Updated after every content merge
5. **Ranking tracking:** Monitor target keyword positions weekly

### 3.3 Success Metrics
- Number of geo pages indexed by Google
- Impressions + clicks for target keywords (via Search Console)
- Ranking position for top 10 keywords
- Organic traffic to `/es/` pages

---

## 4. Agent Architecture — Multi-Agent Pipeline

### 4.1 Overview

The SEO system is a **weekly pipeline of 3 agents + 1 script step**, orchestrated by OpenClaw cron with dependencies.

```
Monday AM
    │
    ▼
┌──────────────────────────────────────────────┐
│  AGENT 1: Research Agent                     │
│  - Keyword research (web_search, web_fetch)  │
│  - Competitor monitoring                     │
│  - Identify target cities                    │
│  - Ranking check (when Search Console ready) │
│  Output: pipelines/seo-content-pipeline/data/research-brief.json           │
└──────────────────┬───────────────────────────┘
                   │ triggers
                   ▼
┌──────────────────────────────────────────────┐
│  AGENT 2: Content Agent (runs 2-3x/week)     │
│  - Reads research-brief.json                 │
│  - Generates 1 geo page OR 1 blog post       │
│  - Updates interlinking JSON                 │
│  - Commits + pushes to branch                │
│  Output: new HTML + updated interlinking     │
└──────────────────┬───────────────────────────┘
                   │ Alberto merges PR
                   ▼
┌──────────────────────────────────────────────┐
│  STEP 3: Post-Processing (npm scripts)       │
│  - npm run postprocess                       │
│  - Sitemaps, meta pixel, clarity, hreflang   │
│  - firebase deploy (manual by Alberto)       │
│  Output: production-ready site               │
└──────────────────┬───────────────────────────┘
                   │ after deploy
                   ▼
┌──────────────────────────────────────────────┐
│  AGENT 4: Monitor Agent (weekly)             │
│  - Pull Search Console data                  │
│  - Track indexed pages                       │
│  - Track ranking changes                     │
│  - Alert on drops or wins                    │
│  Output: pipelines/seo-content-pipeline/data/ranking-report.md + alert     │
│  ⚠️  Requires Search Console API (Phase 3)   │
└──────────────────────────────────────────────┘
```

### 4.2 Dependency Chain

```
Research Agent ──triggers──▶ Content Agent (run 1)
                            Content Agent (run 2)  ← reads same brief
                            Content Agent (run 3)  ← reads same brief
                                    │
                            Alberto merges PR
                                    │
                            Post-Processing (manual or GH Action)
                                    │
                            Monitor Agent (next week)
```

The Research Agent runs **once per week** and produces a brief. The Content Agent consumes that brief across **2-3 runs** in the same week. Each Content Agent run generates **one piece of content** (either a geo page or a blog post), keeping PRs small and reviewable.

The Monitor Agent runs independently on its own weekly schedule (once Search Console is available).

### 4.3 Agent Specifications

Each agent has its own instruction file — these are what the agents actually read at runtime:

| Agent | Instructions | Schedule | Model |
|-------|-------------|----------|-------|
| Research Agent | `pipelines/seo-content-pipeline/agents/research-agent.md` | Monday 9 AM CST | Sonnet |
| Content Agent | `pipelines/seo-content-pipeline/agents/content-agent.md` | Tue/Thu/Sat 10 AM CST | Opus |
| Monitor Agent | `pipelines/seo-content-pipeline/agents/monitor-agent.md` | Friday 9 AM CST | Sonnet |

See the instruction files for full details on each agent's responsibilities, inputs, outputs, and rules.

#### Post-Processing (Not an Agent)

This is **not** an AI agent. It's the existing `npm run postprocess` pipeline that runs after Alberto merges a content PR.

```bash
cd bnbuddy-landing
npm run postprocess       # interlinking, sitemaps, hreflang, trailing slashes, etc.
npm run meta-pixel       # analytics snippets
npm run clarity          # clarity snippets
firebase deploy          # manual by Alberto
```

This can be automated as a **GitHub Action on merge to main** in the future.

### 4.4 State Management — No Shared State

There is **no shared mutable state file**. Each agent is self-contained and determines what's been done by reading the other agents' output files and checking what content already exists on disk.

```
Research Agent:
  reads:  previous pipelines/seo-content-pipeline/data/research-brief.json (if exists)
          public/es/administracion-renta-vacacional-*/  (what geo pages exist)
          public/es/blog-es/  (what blog posts exist)
  writes: pipelines/seo-content-pipeline/data/research-brief.json  →  committed to git

Content Agent:
  reads:  pipelines/seo-content-pipeline/data/research-brief.json  (what to do this week)
          public/es/administracion-renta-vacacional-*/  (what already exists)
  writes: new HTML page in public/es/  →  committed to git
          updated interlinking/spanish-posts.json  →  committed to git
  tracks progress by: checking which contentPlan items already have files on disk

Monitor Agent:
  reads:  public/es/*  (what pages exist)
          Search Console API  (ranking data)
          previous pipelines/seo-content-pipeline/data/ranking-report.md  (for comparison)
  writes: pipelines/seo-content-pipeline/data/ranking-report.md  →  committed to git
```

**Why no shared state file:**
- Eliminates merge conflicts between agents
- No stale state if a run fails mid-way
- No noisy JSON commits cluttering PR reviews
- Each agent is independently testable — just run it and it figures out what to do
- Progress is implicit: if `public/es/administracion-renta-vacacional-metepec/index.html` exists, Metepec is done

**How the Content Agent tracks weekly progress:**
The `research-brief.json` has a `contentPlan` array (e.g., 3 items). The Content Agent checks which items already have corresponding files in `public/es/`. If item 1 says `"type": "geo-page", "city": "metepec"` and `public/es/administracion-renta-vacacional-metepec/index.html` exists, it skips to item 2. When all items have files, it reports "weekly plan complete" and exits.

---

## 5. Build Plan

### Phase 0 — Prerequisites
| # | Task | Owner | Status |
|---|------|-------|--------|
| 0.1 | Configure Perplexity API key in OpenClaw | Alberto | ❌ Pending |
| 0.2 | Extract Toluca page as HTML template → `pipelines/seo-content-pipeline/page-template.html` | Slash | ❌ Pending |
| 0.3 | Create Research Agent cron job | Slash | ❌ Pending |
| 0.5 | Create Content Agent cron job | Slash | ❌ Pending |
| 0.6 | Test: run Research Agent manually, review brief | Both | ❌ Pending |
| 0.7 | Test: run Content Agent manually, review output | Both | ❌ Pending |
| 0.8 | Configure Google Search Console API | Alberto | ❌ Pending (Phase 3) |

### Phase 1 — Core Pipeline (Week 1-2)
| # | Task | Agent |
|---|------|-------|
| 1.1 | First research run → identify top 5 cities + keywords | Research |
| 1.2 | Generate Metepec landing page | Content |
| 1.3 | Generate first blog post | Content |
| 1.4 | Generate 3rd city landing page | Content |
| 1.5 | Alberto reviews + merges PRs | Manual |
| 1.6 | Run post-processing + deploy | Manual |

### Phase 2 — Content Expansion (Week 3-6)
| # | Task | Agent |
|---|------|-------|
| 2.1 | Weekly research → expanding city list | Research |
| 2.2 | Generate remaining city pages (Research Agent determines which) | Content |
| 2.3 | Generate 2-4 blog posts per month | Content |
| 2.4 | Add FAQ schema markup (JSON-LD) to geo pages | Content |
| 2.5 | Refresh Toluca page with 2026 data | Content |

### Phase 3 — Monitor & Optimize (Week 7+)
| # | Task | Agent |
|---|------|-------|
| 3.1 | Enable Monitor Agent with Search Console API | Slash |
| 3.2 | Weekly ranking reports | Monitor |
| 3.3 | Research Agent incorporates ranking data into briefs | Research |
| 3.4 | Content Agent prioritizes pages/keywords based on ranking performance | Content |
| 3.5 | Refresh pages with outdated stats/events (60-day cycle) | Content |

---

## 6. Cron Job Definitions

### Research Agent
```yaml
name: "seo-research-weekly"
schedule:
  kind: cron
  expr: "0 15 * * 1"          # Monday 9:00 AM CST
  tz: "America/Mexico_City"
payload:
  kind: agentTurn
  message: "Read your instructions at bnbuddy-landing/pipelines/seo-content-pipeline/agents/research-agent.md and execute."
  model: anthropic/claude-3.5-sonnet
  timeoutSeconds: 600
sessionTarget: isolated
delivery:
  mode: announce
  channel: discord
  to: "<BNBUDDY_DISCORD_CHANNEL_ID>"
```

### Content Agent
```yaml
name: "seo-content-generate"
schedule:
  kind: cron
  expr: "0 16 * * 2,4,6"      # Tue/Thu/Sat 10:00 AM CST
  tz: "America/Mexico_City"
payload:
  kind: agentTurn
  message: "Read your instructions at bnbuddy-landing/pipelines/seo-content-pipeline/agents/content-agent.md and execute."
  model: anthropic/claude-opus-4-6
  timeoutSeconds: 600
sessionTarget: isolated
delivery:
  mode: announce
  channel: discord
  to: "<BNBUDDY_DISCORD_CHANNEL_ID>"
```

### Monitor Agent (Phase 3 — disabled until Search Console ready)
```yaml
name: "seo-monitor-weekly"
schedule:
  kind: cron
  expr: "0 15 * * 5"          # Friday 9:00 AM CST
  tz: "America/Mexico_City"
payload:
  kind: agentTurn
  message: "Read your instructions at bnbuddy-landing/pipelines/seo-content-pipeline/agents/monitor-agent.md and execute."
  model: anthropic/claude-3.5-sonnet
  timeoutSeconds: 300
sessionTarget: isolated
enabled: false
delivery:
  mode: announce
  channel: discord
  to: "<BNBUDDY_DISCORD_CHANNEL_ID>"
```

---

## 7. Content Generation Details

### 7.1 Geo Landing Pages

Each city page follows the Toluca page structure:

1. **Intro paragraph** — city overview + why it's good for vacation rentals
2. **"¿Por qué [city] es excelente para un Airbnb?"** — local market data, occupancy stats
3. **"Lugares populares que atraen huéspedes"** — 4-5 specific landmarks/attractions with descriptions
4. **"Eventos y tendencias"** — local events calendar, infrastructure projects
5. **"¿Cómo te ayuda un administrador profesional?"** — service benefits (bullet list)
6. **FAQ section** — 4-5 locally-relevant questions
7. **CTA** — contact BnBuddy

**URL pattern:** `/es/administracion-renta-vacacional-[city]/`

**Metadata:**
- Title: `Administración de renta vacacional en [City] - BnBuddy`
- Description: Unique per city, 150-160 chars, includes city name + service keyword
- Canonical: `https://bnbuddy.com/es/administracion-renta-vacacional-[city]/`

### 7.2 Blog Posts

Targeted at informational queries that funnel readers to service pages:
- "¿Es rentable un Airbnb en [City] en 2026?"
- "Mejores zonas para invertir en Airbnb en el Estado de México"
- "Regulaciones de renta vacacional en [City]: lo que necesitas saber"
- "Cómo elegir un administrador de Airbnb en [City]"

Each blog post links to 2-3 geo landing pages (interlinking cluster).

### 7.3 Quality Guardrails

- **Minimum 1,200 words** per geo page
- **Unique content** per city — real landmarks, events, stats (NOT find-replace of city name)
- **Research-backed** — agent must `web_fetch` actual city data before writing
- **Natural keyword density** — target keyword in title, H1, first paragraph, 2-3 H2s, FAQ
- **All generated HTML** must match the template structure exactly (head metadata, CSS includes, GA/pixel scripts)
- **Language:** Spanish only

---

## 8. Git Workflow

1. All agent work happens on branch `seo-agent/content`
2. Each Content Agent run commits with a descriptive message: `seo: add metepec landing page`
3. Research Agent commits brief updates: `seo: update research brief 2026-03-17`
4. Alberto reviews the branch periodically and creates a PR to merge to `main`
5. After merge: run `npm run postprocess` + `firebase deploy`
6. **No auto-deploy.** Alberto controls what goes live.

---

## 9. File Structure (After Build)

```
bnbuddy-landing/
├── pipelines/
│   ├── SEO-AGENT.md              ← This plan (for humans)
│   ├── agents/
│   │   ├── research-agent.md     ← Research Agent instructions (read by agent)
│   │   ├── content-agent.md      ← Content Agent instructions (read by agent)
│   │   └── monitor-agent.md      ← Monitor Agent instructions (read by agent)
│   ├── data/
│   │   ├── research-brief.json       ← Weekly brief (Research Agent output)
│   │   ├── ranking-report.md         ← Weekly rankings (Monitor Agent)
│   │   ├── ranking-data.json         ← Search Console data
│   │   ├── content-status.json       ← Content plan status
│   │   └── archive/                  ← Previous briefs + ranking data
│   └── page-template.html        ← Extracted from Toluca page
├── public/es/
│   ├── administracion-renta-vacacional-toluca/index.html     (existing)
│   ├── administracion-renta-vacacional-metepec/index.html    (generated)
│   ├── administracion-renta-vacacional-lerma/index.html      (generated)
│   ├── administracion-renta-vacacional-[city]/index.html     (generated)
│   └── blog-es/
│       ├── es-rentable-airbnb-metepec-2026/index.html        (generated)
│       └── ...
├── interlinking/
│   └── spanish-posts.json        (updated by Content Agent)
└── public/
    ├── sitemap.xml               (regenerated by post-processing)
    └── post-sitemap.xml          (regenerated by post-processing)
```

---

## 10. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| AI content flagged by Google | Pages deindexed | Agent researches real local data; unique stats/events/landmarks per city; Alberto reviews before publish |
| Thin/duplicate content across cities | Low ranking | 1,200 word minimum; content must be unique (not city-name swap) |
| Stale content | Rankings decay | Content Agent refreshes pages on 60-day cycle |
| Research Agent produces bad brief | Wasted Content Agent runs | Alberto can review `research-brief.json` before content runs |
| No Perplexity key | Research Agent crippled | **Blocker** — must be configured before Phase 1 |
| No Search Console | Can't track rankings | Monitor Agent deferred to Phase 3; manual GSC checks meanwhile |
| Over-optimization | Google penalty | Natural keyword density; varied anchor text in interlinking |
| Agent generates broken HTML | Broken pages | Template-based generation; Alberto reviews PR before merge |

---

## 11. Open Items / Decisions Log

| # | Item | Status | Decision |
|---|------|--------|----------|
| 1 | Deploy workflow | ✅ Decided | PR review → Alberto merges → manual deploy |
| 2 | Perplexity API key | ⏳ Pending | Alberto will provide |
| 3 | Search Console API | ⏳ Pending | Alberto will provide (Phase 3) |
| 4 | Target cities | ✅ Decided | Research Agent identifies relevant State of Mexico cities each week |
| 5 | Auto-deploy | ✅ Decided | No. Manual only. |
| 6 | Content language | ✅ Decided | Spanish only |
| 7 | Content frequency | ✅ Decided | 3x/week (Tue/Thu/Sat), 1 piece per run |
| 8 | Model for Research Agent | ✅ Decided | Sonnet (cost-efficient) |
| 9 | Model for Content Agent | ✅ Decided | Opus (quality matters for content) |
| 10 | GitHub Action for post-processing? | 💡 Future | Could automate `npm run postprocess` on merge |
