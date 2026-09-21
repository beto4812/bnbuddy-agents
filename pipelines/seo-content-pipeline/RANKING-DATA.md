# Google Search Console Ranking Data Guide

Documentation and troubleshooting reference for pulling, processing, and consuming Google Search Console ranking data in the BnBuddy SEO pipeline.

---

## 1. Quick Start

```bash
# 1. Pull latest 28-day performance data from Google Search Console
npm run pull-ranking-data

# 2. Pre-compute deltas, gains, drops, and keyword alerts
npm run compare-rankings
```

- **Data source:** Google Search Console API v1 (`webmasters.readonly` scope)
- **Target property:** `sc-domain:bnbuddy.com`
- **Primary raw output:** `pipelines/seo-content-pipeline/data/ranking-data.json`
- **Downstream summary output:** `pipelines/seo-content-pipeline/data/ranking-comparison.json`

---

## 2. Authentication & Credentials

The script (`pipelines/seo-content-pipeline/scripts/pull-ranking-data.js`) uses Google Cloud Service Account authentication via `googleapis`.

### Key Discovery Order
The script checks for credentials in the following order:

1. **`process.env.GSC_KEY_PATH`** — Explicit file path override.
2. **`~/.config/bnbuddy/gsc-service-account.json`** — Canonical key file path.
3. **`~/.config/bnbuddy/bnbuddy-agents-service-account.json`** — Local default repository key.

### Active Service Account
- **Email:** `bnbuddy-agents-servcie-account@bnbuddy-agents.iam.gserviceaccount.com`
- **GCP Project:** `bnbuddy-agents`
- **Required GSC Permission:** The service account email must be added as a user under **[Google Search Console](https://search.google.com/search-console) → Settings → Users and permissions** on the property `sc-domain:bnbuddy.com` with at least **Restricted** (read-only) or **Full** permissions.

---

## 3. Environment Variables & Configuration

All environment variables are optional with sensible defaults:

| Variable | Default | Purpose |
|----------|---------|---------|
| `GSC_KEY_PATH` | (Auto-detected, see above) | Custom path to the service account JSON key file |
| `GSC_SITE` | `sc-domain:bnbuddy.com` | Google Search Console property identifier |
| `GSC_DAYS` | `28` | Number of lookback days to fetch performance metrics for |

### Example custom run:
```bash
GSC_DAYS=14 GSC_SITE="sc-domain:bnbuddy.com" npm run pull-ranking-data
```

---

## 4. File Lifecycle & Data Flow

```
Google Search Console API
         │
         ▼
[npm run pull-ranking-data]
   ├── 1. Archives existing ranking-data.json ──▶ data/archive/ranking-data-YYYY-MM-DD.json
   └── 2. Writes fresh data ────────────────────▶ data/ranking-data.json (~100KB raw)
         │
         ▼
[npm run compare-rankings]
   ├── Reads data/ranking-data.json
   ├── Reads data/archive/ranking-data-*.json
   └── Writes structured summary ───────────────▶ data/ranking-comparison.json (~20KB)
         │
         ├──▶ Monitor Agent reads ranking-comparison.json ──▶ data/reports/ranking-report-YYYY-MM-DD.md
         └──▶ Research Agent reads comparison for drop alerts and low-hanging fruit keywords
```

### Data Schema (`ranking-data.json`)
```json
{
  "pulledAt": "2026-09-21T19:57:46.000Z",
  "siteUrl": "sc-domain:bnbuddy.com",
  "period": {
    "startDate": "2026-08-24",
    "endDate": "2026-09-20",
    "days": 28
  },
  "byPageAndQuery": [
    {
      "keys": ["https://bnbuddy.com/es/administracion-renta-vacacional-toluca/", "administracion renta vacacional toluca"],
      "clicks": 1,
      "impressions": 14,
      "ctr": 0.0714,
      "position": 3.85
    }
  ],
  "byPage": [
    {
      "keys": ["https://bnbuddy.com/es/administracion-renta-vacacional-toluca/"],
      "clicks": 5,
      "impressions": 120,
      "ctr": 0.0416,
      "position": 5.2
    }
  ],
  "byDateAndPage": [
    {
      "keys": ["2026-08-24", "https://bnbuddy.com/es/administracion-renta-vacacional-toluca/"],
      "clicks": 0,
      "impressions": 4,
      "ctr": 0,
      "position": 4.0
    }
  ]
}
```

> **Why does the date period end yesterday (`T-1`)?**
> Search Console data has a 48 to 72 hour collection latency. Querying the current day yields 0 or incomplete metrics. The script automatically sets `endDate` to yesterday to retrieve complete metrics.

---

## 5. Agent Instructions & Rules

1. **Never parse `ranking-data.json` directly for reports:**
   `ranking-data.json` contains hundreds of unorganized rows. Always run `npm run compare-rankings` and read `data/ranking-comparison.json`. It provides structured deltas, alerts, top gainers, droppers, and CTR stats.
2. **Weekly cadence:**
   - Run on **Mondays** (Jules/Data Day) or **Tuesdays** (after Monday content deployments).
   - Can also be run on-demand before generating a research brief or content audit.
3. **Graceful degradation:**
   If `pull-ranking-data` fails (e.g. temporary API downtime or offline agent environment):
   - Check if `data/ranking-data.json` exists.
   - If it exists and is less than 14 days old, continue with the existing data.
   - Prepend an alert in the output report or brief:
     `⚠️ Search Console API pull failed. Using existing snapshot from YYYY-MM-DD.`

---

## 6. Agent Troubleshooting FAQ

### Q1: `❌ Service account key not found at: ...`
- **Cause:** No service account JSON file was found at `GSC_KEY_PATH`, `~/.config/bnbuddy/gsc-service-account.json`, or `~/.config/bnbuddy/bnbuddy-agents-service-account.json`.
- **Fix:** Ensure `bnbuddy-agents-service-account.json` or `gsc-service-account.json` exists in `~/.config/bnbuddy/`, or pass the exact path via `GSC_KEY_PATH=/path/to/key.json npm run pull-ranking-data`.

### Q2: `❌ Failed to pull Search Console data: 403 Forbidden` / `User does not have sufficient permissions`
- **Cause:** The authenticated service account has not been added to Google Search Console for `sc-domain:bnbuddy.com`.
- **Fix:** Note the client email printed in the log (e.g. `bnbuddy-agents-servcie-account@bnbuddy-agents.iam.gserviceaccount.com`), navigate to [Google Search Console](https://search.google.com/search-console) → **Settings** → **Users and permissions**, and add this email with **Restricted** or **Full** access.

### Q3: `❌ No ranking-data.json found. Run pull-ranking-data first.`
- **Cause:** Running `npm run compare-rankings` before running `pull-ranking-data`.
- **Fix:** Execute `npm run pull-ranking-data` first to generate `ranking-data.json`.

### Q4: Does running `pull-ranking-data` overwrite my history?
- **No.** Before writing fresh data, the script automatically backs up the existing `ranking-data.json` to `data/archive/ranking-data-<prevEndDate>.json`. Previous snapshots are preserved indefinitely for trend analysis.

### Q5: Can I run this in a headless CI / Jules environment?
- **Yes.** In containerized or CI environments where `~/.config/` is not persistent, provide the credentials as a secret string or file, set `GSC_KEY_PATH=/path/to/secret.json`, and run `npm run pull-ranking-data`.
