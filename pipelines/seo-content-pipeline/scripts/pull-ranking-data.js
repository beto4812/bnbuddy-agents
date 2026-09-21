#!/usr/bin/env node

/**
 * pull-ranking-data.js
 *
 * Pulls Google Search Console performance data for bnbuddy.com and writes
 * it to ranking-data.json. Archives the previous data file before overwriting.
 *
 * Usage:
 *   node pipelines/seo-content-pipeline/scripts/pull-ranking-data.js
 *
 * Prerequisites:
 *   - npm install googleapis (project-level)
 *   - Service account key at ~/.config/bnbuddy/gsc-service-account.json
 *   - Service account added as user in Google Search Console for bnbuddy.com
 *
 * Environment variables (optional overrides):
 *   GSC_KEY_PATH  — path to service account JSON key
 *   GSC_SITE      — Search Console property (default: sc-domain:bnbuddy.com)
 *   GSC_DAYS      — number of days to look back (default: 28)
 */

const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");
const os = require("os");

// ── Config ───────────────────────────────────────────────────────────────────

function resolveKeyPath() {
  if (process.env.GSC_KEY_PATH) {
    return process.env.GSC_KEY_PATH;
  }
  const defaultPath = path.join(
    os.homedir(),
    ".config",
    "bnbuddy",
    "gsc-service-account.json"
  );
  if (fs.existsSync(defaultPath)) {
    return defaultPath;
  }
  const fallbackPath = path.join(
    os.homedir(),
    ".config",
    "bnbuddy",
    "bnbuddy-agents-service-account.json"
  );
  if (fs.existsSync(fallbackPath)) {
    return fallbackPath;
  }
  return defaultPath;
}

const KEY_PATH = resolveKeyPath();

const SITE_URL = process.env.GSC_SITE || "sc-domain:bnbuddy.com";
const DAYS = parseInt(process.env.GSC_DAYS || "28", 10);

const PIPELINE_DIR = path.resolve(
  __dirname,
  ".."
);
const DATA_DIR = path.join(PIPELINE_DIR, "data");
const OUTPUT_PATH = path.join(DATA_DIR, "ranking-data.json");
const ARCHIVE_DIR = path.join(DATA_DIR, "archive");

// ── Helpers ──────────────────────────────────────────────────────────────────

function dateString(d) {
  return d.toISOString().split("T")[0];
}

function getDateRange(days) {
  const end = new Date();
  end.setDate(end.getDate() - 1); // SC data lags ~2 days, use yesterday
  const start = new Date(end);
  start.setDate(start.getDate() - days + 1);
  return {
    startDate: dateString(start),
    endDate: dateString(end),
    days,
  };
}

async function querySearchConsole(searchconsole, siteUrl, request) {
  const res = await searchconsole.searchanalytics.query({
    siteUrl,
    requestBody: request,
  });
  return res.data.rows || [];
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // 1. Load service account key
  if (!fs.existsSync(KEY_PATH)) {
    console.error(`❌ Service account key not found at: ${KEY_PATH}`);
    console.error(
      "   Place the GSC service account JSON key there, or set GSC_KEY_PATH."
    );
    process.exit(1);
  }

  const keyFile = JSON.parse(fs.readFileSync(KEY_PATH, "utf-8"));
  console.log(`🔑 Using service account: ${keyFile.client_email}`);

  // 2. Authenticate
  const auth = new google.auth.GoogleAuth({
    credentials: keyFile,
    scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
  });
  const searchconsole = google.searchconsole({ version: "v1", auth });

  // 3. Calculate date range
  const period = getDateRange(DAYS);
  console.log(`📅 Period: ${period.startDate} → ${period.endDate} (${period.days} days)`);

  // 4. Pull three data views (matching existing ranking-data.json format)
  console.log("📊 Pulling byPageAndQuery...");
  const byPageAndQuery = await querySearchConsole(searchconsole, SITE_URL, {
    startDate: period.startDate,
    endDate: period.endDate,
    dimensions: ["page", "query"],
    rowLimit: 5000,
  });
  console.log(`   → ${byPageAndQuery.length} rows`);

  console.log("📊 Pulling byPage...");
  const byPage = await querySearchConsole(searchconsole, SITE_URL, {
    startDate: period.startDate,
    endDate: period.endDate,
    dimensions: ["page"],
    rowLimit: 1000,
  });
  console.log(`   → ${byPage.length} rows`);

  console.log("📊 Pulling byDateAndPage...");
  const byDateAndPage = await querySearchConsole(searchconsole, SITE_URL, {
    startDate: period.startDate,
    endDate: period.endDate,
    dimensions: ["date", "page"],
    rowLimit: 5000,
  });
  console.log(`   → ${byDateAndPage.length} rows`);

  // 5. Archive previous data if it exists
  if (fs.existsSync(OUTPUT_PATH)) {
    if (!fs.existsSync(ARCHIVE_DIR)) {
      fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
    }

    const prev = JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf-8"));
    const prevDate = prev.period?.endDate || "unknown";
    const archivePath = path.join(
      ARCHIVE_DIR,
      `ranking-data-${prevDate}.json`
    );

    // Don't overwrite an existing archive for the same date
    if (!fs.existsSync(archivePath)) {
      fs.copyFileSync(OUTPUT_PATH, archivePath);
      console.log(`📦 Archived previous data → archive/ranking-data-${prevDate}.json`);
    } else {
      console.log(`📦 Archive already exists for ${prevDate}, skipping`);
    }
  }

  // 6. Write new data
  const output = {
    generatedAt: new Date().toISOString(),
    period,
    site: SITE_URL,
    byPageAndQuery,
    byPage,
    byDateAndPage,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));

  // 7. Summary
  const totalImpressions = byPage.reduce(
    (sum, r) => sum + (r.impressions || 0),
    0
  );
  const totalClicks = byPage.reduce((sum, r) => sum + (r.clicks || 0), 0);
  const pagesTracked = byPage.length;

  console.log("\n✅ ranking-data.json updated");
  console.log(`   Pages tracked: ${pagesTracked}`);
  console.log(`   Total impressions: ${totalImpressions.toLocaleString()}`);
  console.log(`   Total clicks: ${totalClicks.toLocaleString()}`);
  console.log(`   Unique queries: ${byPageAndQuery.length}`);
}

main().catch((err) => {
  console.error("❌ Failed to pull Search Console data:");
  console.error(err.message);

  if (err.message.includes("403") || err.message.includes("Forbidden")) {
    console.error(
      "\n💡 The service account may not have access to the Search Console property."
    );
    console.error(
      `   Add ${JSON.parse(fs.readFileSync(KEY_PATH, "utf-8")).client_email} as a user in:`
    );
    console.error(
      "   https://search.google.com/search-console → Settings → Users and permissions"
    );
  }

  process.exit(1);
});
