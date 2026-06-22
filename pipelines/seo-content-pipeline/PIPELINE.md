# SEO Pipeline — Full Orchestration

**Created:** 2026-03-14
**Updated:** 2026-05-02
**Author:** Slash ⚡ (with Alberto)
**Status:** Active — **SaaS/product-led content focus** (geo pages frozen since 2026-05-02)

This document describes the complete end-to-end flow of the BnBuddy SEO pipeline: from keyword discovery to published pages to ranking tracking and back.

---

## 1. Pipeline Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                   MONDAY — FULL PIPELINE DAY                            │
│                                                                         │
│  08:00 CST ──▶ pull-keyword-data.js                                    │
│                   │ reads: DataForSEO API                               │
│                   ▼                                                     │
│                data/dataforseo/keyword-queue.json                       │
│                   │                                                     │
│  09:00 CST ──▶ Research Agent (Sonnet)                                 │
│                   │ reads: keyword-queue.json (PRIMARY)                 │
│                   │ reads: ranking-comparison.json (SECONDARY)          │
│                   ▼                                                     │
│                data/briefs/research-brief-YYYY-MM-DD.json               │
│                   │                                                     │
│  12:00 CST ──▶ Content Agent run 1 (Opus) ──▶ content/X.md            │
│  15:00 CST ──▶ Content Agent run 2 (Opus) ──▶ content/Y.md            │
│  18:00 CST ──▶ Content Agent run 3 (Opus) ──▶ content/Z.md            │
│                   │                                                     │
│                   ▼                                                     │
│                Alberto reviews PR                                       │
│                   │                                                     │
│                   ▼                                                     │
│                Build Script                                             │
│                  ├─ new pages  ──▶ public/[slug]/index.html (EN, create) │
│                  └─ refreshes  ──▶ public/[slug]/index.html (overwrite)│
│                Post-Processing ──▶ sitemaps, pixel, clarity            │
│                Deploy ──▶ firebase deploy                               │
│                   │                                                     │
│  TUESDAY 9:00 ──▶ Monitor Agent (Sonnet)                               │
│                   │ reads: Search Console API                           │
│                   ▼                                                     │
│                data/ranking-comparison.json ◀──────────────────────┐   │
│                data/reports/ranking-report-YYYY-MM-DD.md           │   │
│                   │                                                 │   │
│                   └─── feeds back into Research Agent (next Monday) ┘   │
│                                                                         │
│  ◀── repeat weekly ──────────────────────────────────────────────────── │
└─────────────────────────────────────────────────────────────────────────┘
```

> **Geo Pages Frozen (2026-05-02):** Existing geo pages (Toluca, Metepec) remain live and
> are monitored, but **no new geo pages will be created**. This pipeline now handles
> **product-led EN blog content** + **comparison posts** + **content refreshes** only.

All agent runs happen across two days — **Monday (data)** and **Thursday (writing)** —
to maximize token budgets across providers. See `ORCHESTRATORS.md` for provider assignments.
The Content Agent runs 3 times on Thursday — each run picks the next uncompleted item from
the research brief automatically.

---

## 2. Agents & Scripts

| Component | Type | Purpose | Schedule | Instructions |
|-----------|------|---------|----------|-------------|
| **pull-keyword-data.js** | Script | Fetch keyword ideas + search volume from DataForSEO | Monday 8:00 AM CST | `scripts/pull-keyword-data.js` |
| **Research Agent** | Agent | Read keyword queue + ranking data, produce content brief | Monday 9:00 AM CST | `agents/research-agent.md` |
| **Content Agent** | Agent | Write content markdown from brief | Monday 12:00, 15:00, 18:00 CST | `agents/content-agent.md` |
| **Monitor Agent** | Agent | Track rankings via Search Console | Tuesday 9:00 AM CST | `agents/monitor-agent.md` |

All agents run as **isolated cron jobs**. Each run is independent — agents determine what to do by reading files on disk, not shared state. Provider assignments are in `ORCHESTRATORS.md`.

---

## 3. Artifacts

Each step in the pipeline produces an artifact that the next step consumes:

```
pull-keyword-data.js ──reads──▶ DataForSEO API (Keyword Ideas + Search Volume)
                     ──writes──▶ data/dataforseo/keyword-queue.json
                     ──writes──▶ data/dataforseo/raw-YYYY-MM-DD.json (archived)
                                      │
Research Agent ──reads────────────────┘ (PRIMARY INPUT)
               ──reads──▶ data/ranking-comparison.json (SECONDARY — refresh signals)
               ──writes──▶ data/briefs/research-brief-YYYY-MM-DD.json
               ──writes──▶ data/dataforseo/keyword-queue.json (marks selected → "in-progress")
                                      │
Content Agent  ──reads────────────────┘
               ──writes──▶ content/[slug].md          (blog post or geo page)
               ──writes──▶ content/[slug]-refresh-YYYY-MM-DD.md  (content refresh)
               ──writes──▶ interlinking/spanish-posts.json (updated, new pages only)
                                      │
Build Script   ──reads────────────────┘
               ──reads───▶ page-template.html
               ──writes──▶ public/es/[slug]/index.html  (create for new, overwrite for refresh)
                                      │
Post-Processing ──reads───────────────┘
                ──writes──▶ public/sitemap.xml (updated)
                ──writes──▶ public/post-sitemap.xml (updated)
                ──writes──▶ hreflang, meta pixel, clarity injected
                                      │
Monitor Agent  ──reads────────────────┘
               ──reads───▶ Search Console API (via pull-ranking-data.js)
               ──writes──▶ data/ranking-comparison.json  ◀── Research Agent reads this next week
               ──writes──▶ data/reports/ranking-report-YYYY-MM-DD.md
```

### Artifact Details

| Artifact | Path | Producer | Consumer | Format |
|----------|------|----------|----------|--------|
| Keyword queue | `data/dataforseo/keyword-queue.json` | `pull-keyword-data.js` | Research Agent | JSON (keywords with vol + difficulty) |
| Raw API data | `data/dataforseo/raw-YYYY-MM-DD.json` | `pull-keyword-data.js` | Archival only | JSON (full DataForSEO response) |
| Research brief | `data/briefs/research-brief-YYYY-MM-DD.json` | Research Agent | Content Agent | JSON |
| Content status | `data/content-status.json` | Research Agent (init) / Content Agent (update) | Content Agent | JSON |
| Content files | `content/[slug].md` | Content Agent | Build Script | Markdown + YAML frontmatter |
| Refresh files | `content/[slug]-refresh-YYYY-MM-DD.md` | Content Agent | Build Script | Markdown + `type: content-refresh` frontmatter |
| Interlinking | `interlinking/spanish-posts.json` | Content Agent (new pages only) | Post-processing | JSON array of paths |
| Page template | `page-template.html` | Manual | Build Script | HTML with placeholders |
| Built pages | `public/es/[slug]/` | Build Script | Firebase, Monitor Agent | Static HTML |
| Ranking data | `data/ranking-data.json` | `pull-ranking-data.js` | `compare-rankings.js` | JSON (~100KB) |
| Ranking comparison | `data/ranking-comparison.json` | `compare-rankings.js` | Monitor Agent, Research Agent | JSON (~20KB deltas) |
| Ranking report | `data/reports/ranking-report-YYYY-MM-DD.md` | Monitor Agent | Humans | Markdown |

---

## 4. How Agents Find Their Work

No shared mutable state. Each agent determines what to do by reading files on disk.

### Keyword Discovery Script (Monday 8:00 AM)

```
1. Load credentials from ~/.config/bnbuddy/dataforseo.env
2. POST to /v3/dataforseo_labs/google/keyword_ideas/live (EN seeds, US market)
3. POST to /v3/keywords_data/google_ads/search_volume/live (ES templates, MX market)
4. Filter, deduplicate, score, and sort by priority_score
5. Merge new keywords into data/dataforseo/keyword-queue.json (preserving existing statuses)
6. Archive full API response to data/dataforseo/raw-YYYY-MM-DD.json
```

### Research Agent (Monday 9:00 AM)

```
1. git pull
2. npm run generate-brief
   Script reads: keyword-queue.json + ranking-comparison.json
   Script applies: priority waterfall (P0 brand → P1 quick win → P2 trending → P3 commercial → default)
   Script writes: briefs/research-brief-YYYY-MM-DD.json + content-status.json
   Script updates: keyword-queue.json (marks selected as "in-progress")
3. Agent verifies output (3 items, no slug conflicts)
4. git add + commit + push
```

### Content Agent (Thursday 12:00, 15:00, 18:00 CST)

```
1. git pull
2. Read latest data/briefs/research-brief-*.json  → this week's plan
3. Read data/content-status.json                  → what's claimed/done
4. For each contentPlan item (by run order):
     if status is "completed" or "in-progress" → skip
     if status is "pending" → CLAIM IT:
       set status to "in-progress", commit + push
       if push fails → git pull, re-read status, retry from step 4
5. Execute the task by type:
     "blog-post"       → research, write content/[slug].md, update EN interlinking
     "comparison-post" → research competitors, write content/[slug].md, update EN interlinking
6. Set status to "completed", commit + push all changes
   (or "failed" with reason if something went wrong)
```

The claim-then-push pattern acts as an optimistic lock — if two agents race for the same
item, only one push succeeds. The other pulls, sees the claim, and moves to the next pending item.

### Build Script (after PR merge)

```
1. Scan content/*.md
2. For each .md file:
     read frontmatter
     if public/[slug]/ exists → skip (page already built)
     else → build new page from template
3. Write HTML to public/[slug]/
```

### Monitor Agent (Tuesday 9:00 AM)

```
1. npm run pull-ranking-data   → fresh SC data (archives previous)
2. npm run compare-rankings    → pre-computes all deltas and alerts
3. Read data/ranking-comparison.json  (NOT ranking-data.json directly)
4. Write data/reports/ranking-report-YYYY-MM-DD.md
   (ranking-comparison.json is consumed by Research Agent next Monday)
```

---

## 5. Dependencies

```
pull-keyword-data.js ──────────▶ Research Agent
                                  (must have keyword queue before brief runs)

Research Agent ─────────────────▶ Content Agent
                                  (must have brief before content runs)

Content Agent ──────────────────▶ Build Script
                                  (must have .md files before build)

Build Script ───────────────────▶ Post-Processing
                                  (must have HTML before sitemap/pixel injection)

Post-Processing ────────────────▶ Deploy
                                  (must be processed before going live)

Deploy ─────────────────────────▶ Monitor Agent
                                  (must be live for Search Console to track)

Monitor Agent ──────────────────▶ Research Agent (next week)
                                  (ranking-comparison.json feeds next brief)
```

### Failure Modes

| Failure | Impact | Recovery |
|---------|--------|----------|
| DataForSEO API down | keyword-queue.json stale | Research Agent uses existing queue (still valid if < 14 days) |
| Research Agent fails | Content Agent has no brief → exits cleanly | Re-run Research Agent manually |
| Content Agent fails mid-run | No .md file written → next run picks up same task | Automatic — agent retries same task |
| Content Agent writes bad content | Bad .md file exists → skipped on next run | Delete the .md file, agent will redo it |
| Build script fails | No HTML generated | Fix script, re-run |
| Post-processing breaks page | Broken HTML in public/ | Revert git commit, fix |
| Monitor Agent has no Search Console | Reports "no data" | Check gsc-service-account.json path |

---

## 6. Notifications (Discord)

Every agent run sends a summary to Discord channel `1471630388144111772`.

### Research Agent notification:
```
📊 SEO Research Brief — Week of 2026-04-28

Keyword queue: 43 pending keywords available
Ranking data: 2026-04-22 — 2 declining pages, 3 low-hanging fruit

Content plan for this week:
1. 📝 Blog post — "airbnb property management" (vol:3,600 diff:30 score:252 ↑21%)
2. 🔄 Content refresh — /vacation-rental-website-builder/ (-6.2 positions, 3 weeks)
3. 📝 Blog post — "short term rental management" (vol:1,000 diff:26 score:74)

Keywords marked in-progress: airbnb property management, short term rental management
Brief committed to: data/briefs/research-brief-2026-04-28.json
```

### Content Agent notification:
```
✍️ SEO Content — airbnb property management

Type: Blog post (informational)
Words: 1,340
Target keyword: airbnb property management (vol:3,600 diff:30)
Language: EN

Files:
  + content/airbnb-property-management-guide.md
  ~ interlinking/spanish-posts.json

Branch: seo-agent/content
Ready for review.
```

### Monitor Agent notification:
```
📈 SEO Rankings — Week of 2026-04-22

⚠️  ALERT: /vacation-rental-website-builder/ — position dropped 6.2 pts (-22% impressions)
🎉  NEW: /es/administracion-renta-vacacional-metepec/ — Position 3 for "administración airbnb metepec"
📊  Low-hanging fruit: /es/optimizar-anuncio-alquiler-vacacional/ — Position 16.5 (13 impressions)

Full report: data/reports/ranking-report-2026-04-22.md
```

---

## 7. Manual Operations

These steps are NOT automated — Alberto does them:

### Review & Merge
1. Check `seo-agent/content` branch on GitHub
2. Review `content/*.md` files — content quality, accuracy, tone
3. For content refreshes, verify the improved sections look correct
4. Merge to `main` when satisfied

### Build & Deploy
```bash
cd bnbuddy-landing
git checkout main
git pull
npm run build-content    # converts content/*.md → public/es/ HTML
                            # content-refresh files are auto-detected and overwrite existing pages
npm run postprocess         # sitemaps, interlinking, meta pixel, clarity, hreflang
firebase deploy
```

### Correcting Bad Content
- Edit `content/[slug].md` directly, or delete and let the Content Agent regenerate
- For a bad refresh: delete `content/[slug]-refresh-*.md` before running `build-content`

---

## 8. Cron Jobs

> **Provider-specific configurations live in `ORCHESTRATORS.md`.**
> The schedule below shows timing only. See `ORCHESTRATORS.md` for which provider runs each agent.

### Keyword Discovery (Monday 8:00 AM — before Research Agent)
```yaml
name: "seo-keyword-discovery-weekly"
schedule:
  kind: cron
  expr: "0 8 * * 1"               # Monday 8:00 AM CST
  tz: "America/Mexico_City"
payload:
  kind: script
  command: "npm run pull-keyword-data"
  cwd: "/Users/albertovazquez/beto4812/bnbuddy-landing"
```

### Research Agent (Monday 9:00 AM)
```yaml
name: "seo-research-weekly"
schedule: "0 9 * * 1"              # Monday 9:00 AM CST
tz: "America/Mexico_City"
prompt: "Read your instructions at pipelines/seo-content-pipeline/agents/research-agent.md and execute."
timeoutSeconds: 300
```

### Monitor Agent (Monday 14:00)
```yaml
name: "seo-monitor-weekly"
schedule: "0 14 * * 1"             # Monday 14:00 CST
tz: "America/Mexico_City"
prompt: "Read your instructions at pipelines/seo-content-pipeline/agents/monitor-agent.md and execute."
timeoutSeconds: 300
```

### Content Agent (Thursday 10:00, 13:00, 16:00 — 3 runs)
```yaml
name: "seo-content-generate"
schedule: "0 10,13,16 * * 4"       # Thursday 10:00, 13:00, 16:00 CST
tz: "America/Mexico_City"
prompt: "Read your instructions at pipelines/seo-content-pipeline/agents/content-agent.md and execute."
timeoutSeconds: 600
```

---

## 9. File Structure

```
bnbuddy-landing/
├── AGENTS.md                                ← Universal agent context (provider-agnostic)
├── CLAUDE.md                                ← Claude Code-specific wrapper
├── GEMINI.md                                ← Gemini/Jules-specific wrapper
├── pipelines/
│   └── seo-content-pipeline/             ← Everything for this pipeline
│       ├── PIPELINE.md                   ← This document (full orchestration)
│       ├── ORCHESTRATORS.md              ← Provider assignments + schedule (Mon/Thu)
│       ├── SEO-AGENT.md                  ← Architecture & research background
│       ├── CONTENT-AGENT.md              ← Content Agent design decisions
│       ├── agents/
│       │   ├── research-agent.md         ← Research Agent instructions (v3.0 — data-driven)
│       │   ├── content-agent.md          ← Content Agent instructions (supports refresh type)
│       │   ├── monitor-agent.md          ← Monitor Agent instructions
│       │   └── refresh-agent.md          ← Refresh Agent instructions
│       ├── scripts/
│       │   ├── pull-ranking-data.js      ← Pulls SC data into data/ranking-data.json
│       │   ├── compare-rankings.js       ← Pre-computes deltas → data/ranking-comparison.json
│       │   └── pull-keyword-data.js      ← Fetches DataForSEO → data/dataforseo/keyword-queue.json
│       ├── content/                      ← Content Agent output (markdown files)
│       │   ├── valle-de-bravo.md         ← (geo page, generated)
│       │   ├── some-blog-post.md         ← (blog post, generated)
│       │   └── toluca-refresh-2026-04-28.md  ← (content refresh, generated)
│       ├── data/                         ← All runtime data (JSON, reports, archives)
│       │   ├── briefs/                   ← Research Agent output (date-stamped)
│       │   │   └── research-brief-YYYY-MM-DD.json
│       │   ├── dataforseo/               ← DataForSEO vendor data
│       │   │   ├── keyword-queue.json    ← Current keyword queue (updated weekly)
│       │   │   └── raw-YYYY-MM-DD.json  ← Archived full API response
│       │   ├── reports/                  ← Monitor Agent reports (date-stamped)
│       │   │   └── ranking-report-YYYY-MM-DD.md
│       │   ├── archive/                  ← Previous ranking data snapshots
│       │   │   └── ranking-data-YYYY-MM-DD.json
│       │   ├── content-status.json       ← Content plan status (pending/in-progress/completed)
│       │   ├── ranking-data.json         ← Search Console data (~100KB, overwritten weekly)
│       │   ├── ranking-comparison.json   ← Pre-computed deltas (~20KB, overwritten weekly)
│       │   └── research-brief.schema.json ← Brief validation schema
│       ├── validate_brief.py             ← Brief validation script
│       └── page-template.html            ← HTML template (extracted from Toluca)
├── scripts/
│   └── build-content.js                ← Markdown → HTML builder (refresh-aware)
├── public/es/
│   ├── administracion-renta-vacacional-toluca/       (existing, manual)
│   ├── administracion-renta-vacacional-valle-de-bravo/ (built)
│   └── administracion-renta-vacacional-metepec/        (built)
├── interlinking/
│   └── spanish-posts.json                (updated by Content Agent for new pages)
└── public/
    ├── sitemap.xml                       (updated by post-processing)
    └── post-sitemap.xml                  (updated by post-processing)
```

---

## 10. Prerequisites

| # | Prerequisite | Status | Blocker For |
|---|-------------|--------|-------------|
| 1 | Perplexity API key configured | ✅ Done | Research Agent (fallback web_fetch) |
| 2 | Extract page template from Toluca page | ✅ Done — `page-template.html` | Build Script |
| 3 | `scripts/build-content.js` written + refresh-aware | ✅ Done | Build → Deploy |
| 4 | Update `content-agent.md` for markdown output + refresh type | ✅ Done | Content Agent |
| 5 | Create Content Agent cron job | ❌ Pending | Automated runs |
| 6 | Discord channel allowlisted in cron config | ❌ Pending | Notifications |
| 7 | Google Search Console API access | ✅ Done — `pull-ranking-data.js` + `~/.config/bnbuddy/gsc-service-account.json` | Monitor Agent |
| 8 | DataForSEO API credentials | ✅ Done — `~/.config/bnbuddy/dataforseo.env` + `pull-keyword-data.js` | Keyword Discovery |
| 9 | Keyword queue populated | ✅ Done — `data/dataforseo/keyword-queue.json` (59 keywords) | Research Agent |
| 10 | Test: manual content → build → verify | ❌ Pending | Confidence |
