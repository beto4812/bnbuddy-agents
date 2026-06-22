#!/usr/bin/env node

/**
 * compare-rankings.js
 *
 * Pre-computes week-over-week ranking comparison so the Monitor Agent
 * doesn't have to parse and diff two ~100KB JSON files itself.
 *
 * Reads:  data/ranking-data.json  (current)
 *         data/archive/ranking-data-*.json  (previous + oldest for trends)
 *
 * Writes: data/ranking-comparison.json  — compact summary the agent reads
 *
 * Usage:
 *   node pipelines/seo-content-pipeline/scripts/compare-rankings.js
 *   npm run compare-rankings
 */

const fs = require("fs");
const path = require("path");

// ── Config ───────────────────────────────────────────────────────────────────

const DATA_DIR = path.resolve(__dirname, "..", "data");
const ARCHIVE_DIR = path.join(DATA_DIR, "archive");
const OUTPUT_PATH = path.join(DATA_DIR, "ranking-comparison.json");

const BRANDED = [
  "bnbuddy",
  "bnb buddy",
  "site:bnbuddy.co",
  "site:bnbuddy.com",
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function loadJSON(filepath) {
  return JSON.parse(fs.readFileSync(filepath, "utf-8"));
}

function shortPath(url) {
  return url.replace("https://bnbuddy.com", "");
}

function isBranded(query) {
  return BRANDED.includes(query.toLowerCase());
}

function buildPageMap(data) {
  const m = {};
  (data.byPage || []).forEach((r) => {
    m[r.keys[0]] = r;
  });
  return m;
}

function buildKwMap(data) {
  const m = {};
  (data.byPageAndQuery || []).forEach((r) => {
    m[r.keys[0] + "|" + r.keys[1]] = r;
  });
  return m;
}

function findArchives() {
  if (!fs.existsSync(ARCHIVE_DIR)) return [];
  return fs
    .readdirSync(ARCHIVE_DIR)
    .filter((f) => f.startsWith("ranking-data-") && f.endsWith(".json"))
    .sort(); // chronological
}

function pctChange(prev, curr) {
  if (prev === 0) return curr > 0 ? "+∞" : "0%";
  const pct = ((curr - prev) / prev) * 100;
  return (pct >= 0 ? "+" : "") + pct.toFixed(0) + "%";
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  // 1. Load current data
  const currPath = path.join(DATA_DIR, "ranking-data.json");
  if (!fs.existsSync(currPath)) {
    console.error("❌ No ranking-data.json found. Run pull-ranking-data first.");
    process.exit(1);
  }
  const curr = loadJSON(currPath);
  const currPageMap = buildPageMap(curr);
  const currKwMap = buildKwMap(curr);

  // 2. Find archives (skip archive with same endDate as current)
  const archiveFiles = findArchives();
  const currentEndDate = curr.period?.endDate;
  const usableArchives = archiveFiles.filter(
    (f) => !f.includes(currentEndDate)
  );

  const hasPrev = usableArchives.length > 0;
  const hasMultiWeek = usableArchives.length >= 2;

  let prev = null;
  let prevPageMap = {};
  let prevKwMap = {};
  let oldest = null;
  let oldestPageMap = {};

  if (hasPrev) {
    const prevFile = usableArchives[usableArchives.length - 1]; // most recent
    prev = loadJSON(path.join(ARCHIVE_DIR, prevFile));
    prevPageMap = buildPageMap(prev);
    prevKwMap = buildKwMap(prev);
    console.log("📊 Previous data:", prevFile);
  }

  if (hasMultiWeek) {
    const oldestFile = usableArchives[0];
    oldest = loadJSON(path.join(ARCHIVE_DIR, oldestFile));
    oldestPageMap = buildPageMap(oldest);
    console.log("📊 Oldest data:", usableArchives[0]);
  }

  // 3. Compute totals
  const currTotalImp = curr.byPage.reduce((s, r) => s + r.impressions, 0);
  const currTotalClk = curr.byPage.reduce((s, r) => s + r.clicks, 0);
  const prevTotalImp = hasPrev
    ? prev.byPage.reduce((s, r) => s + r.impressions, 0)
    : 0;
  const prevTotalClk = hasPrev
    ? prev.byPage.reduce((s, r) => s + r.clicks, 0)
    : 0;

  // 4. Detect newly indexed and deindexed pages
  const newlyIndexed = [];
  const deindexed = [];

  if (hasPrev) {
    Object.keys(currPageMap).forEach((url) => {
      if (!prevPageMap[url]) {
        const r = currPageMap[url];
        newlyIndexed.push({
          page: shortPath(url),
          impressions: r.impressions,
          clicks: r.clicks,
          position: +r.position.toFixed(1),
        });
      }
    });

    Object.keys(prevPageMap).forEach((url) => {
      if (!currPageMap[url]) {
        const r = prevPageMap[url];
        deindexed.push({
          page: shortPath(url),
          previousImpressions: r.impressions,
          previousPosition: +r.position.toFixed(1),
        });
      }
    });
  }

  // 5. Page-level position changes
  const pageChanges = [];
  curr.byPage.forEach((r) => {
    const url = r.keys[0];
    const short = shortPath(url);
    const entry = {
      page: short,
      position: +r.position.toFixed(1),
      impressions: r.impressions,
      clicks: r.clicks,
      ctr: +(r.ctr * 100).toFixed(1),
    };

    if (prevPageMap[url]) {
      const pr = prevPageMap[url];
      entry.prevPosition = +pr.position.toFixed(1);
      entry.positionDelta = +(pr.position - r.position).toFixed(1); // positive = improved
      entry.prevImpressions = pr.impressions;
      entry.impressionsDelta = r.impressions - pr.impressions;
      entry.impressionsPct = pctChange(pr.impressions, r.impressions);
    } else {
      entry.prevPosition = null;
      entry.positionDelta = null;
      entry.prevImpressions = null;
      entry.impressionsDelta = null;
    }

    // Multi-week trend
    if (oldestPageMap[url]) {
      const or = oldestPageMap[url];
      entry.oldestPosition = +or.position.toFixed(1);
      entry.trendDelta = +(or.position - r.position).toFixed(1);
      entry.oldestImpressions = or.impressions;
      entry.trendImpressionsDelta = r.impressions - or.impressions;
      entry.trendImpressionsPct = pctChange(or.impressions, r.impressions);
    }

    pageChanges.push(entry);
  });

  // Sort: high-impression pages first
  pageChanges.sort((a, b) => b.impressions - a.impressions);

  // 6. Keyword-level changes for each page (non-branded only, top 10 per page)
  const keywordsByPage = {};
  curr.byPageAndQuery.forEach((r) => {
    const url = r.keys[0];
    const query = r.keys[1];
    if (isBranded(query)) return;

    const short = shortPath(url);
    if (!keywordsByPage[short]) keywordsByPage[short] = [];

    const entry = {
      keyword: query,
      position: +r.position.toFixed(1),
      impressions: r.impressions,
      clicks: r.clicks,
    };

    const prevKey = url + "|" + query;
    if (prevKwMap[prevKey]) {
      const pr = prevKwMap[prevKey];
      entry.prevPosition = +pr.position.toFixed(1);
      entry.positionDelta = +(pr.position - r.position).toFixed(1);
      entry.prevImpressions = pr.impressions;
      entry.isNew = false;
    } else {
      entry.prevPosition = null;
      entry.positionDelta = null;
      entry.prevImpressions = null;
      entry.isNew = true;
    }

    keywordsByPage[short].push(entry);
  });

  // Sort keywords by impressions, keep top 10 per page
  Object.keys(keywordsByPage).forEach((page) => {
    keywordsByPage[page].sort((a, b) => b.impressions - a.impressions);
    keywordsByPage[page] = keywordsByPage[page].slice(0, 10);
  });

  // 7. Detect alerts
  const alerts = [];

  // Page 1 wins (non-branded)
  Object.keys(keywordsByPage).forEach((page) => {
    keywordsByPage[page].forEach((kw) => {
      if (kw.position <= 10 && !kw.isNew) {
        alerts.push({
          type: "page1",
          emoji: "🎉",
          page,
          keyword: kw.keyword,
          position: kw.position,
        });
      }
    });
  });

  // Position improvements ≥5 and drops ≥10
  pageChanges.forEach((p) => {
    if (p.positionDelta !== null && p.positionDelta >= 5) {
      alerts.push({
        type: "improvement",
        emoji: "📈",
        page: p.page,
        delta: p.positionDelta,
        from: p.prevPosition,
        to: p.position,
      });
    }
    if (p.positionDelta !== null && p.positionDelta <= -10) {
      alerts.push({
        type: "drop",
        emoji: "⚠️",
        page: p.page,
        delta: p.positionDelta,
        from: p.prevPosition,
        to: p.position,
      });
    }
  });

  // Newly indexed
  newlyIndexed.forEach((p) => {
    alerts.push({
      type: "newlyIndexed",
      emoji: "📊",
      page: p.page,
      position: p.position,
      impressions: p.impressions,
    });
  });

  // Deindexed
  deindexed.forEach((p) => {
    alerts.push({
      type: "deindexed",
      emoji: "🚨",
      page: p.page,
    });
  });

  // New keywords (non-branded, ≥5 impressions)
  const newKeywords = [];
  Object.keys(keywordsByPage).forEach((page) => {
    keywordsByPage[page].forEach((kw) => {
      if (kw.isNew && kw.impressions >= 3) {
        newKeywords.push({ page, keyword: kw.keyword, impressions: kw.impressions, position: kw.position });
        alerts.push({
          type: "newKeyword",
          emoji: "🔍",
          page,
          keyword: kw.keyword,
          position: kw.position,
          impressions: kw.impressions,
        });
      }
    });
  });

  // 8. Identify pages not in SC data
  // Scan public/ for deployed pages to check against SC
  // Skip deprecated pages that should NOT be indexed
  const DEPRECATED_PAGES = ["/es/planes/"];
  const publicEsDir = path.resolve(DATA_DIR, "..", "..", "..", "..", "bnbuddy-landing", "public", "es");
  const deployedNotIndexed = [];
  if (fs.existsSync(publicEsDir)) {
    fs.readdirSync(publicEsDir).forEach((dir) => {
      if (!fs.statSync(path.join(publicEsDir, dir)).isDirectory()) return;
      const urlPath = "/es/" + dir + "/";
      if (DEPRECATED_PAGES.includes(urlPath)) return;
      const fullUrl = "https://bnbuddy.com" + urlPath;
      if (!currPageMap[fullUrl]) {
        deployedNotIndexed.push({ page: urlPath, status: "not in SC data" });
      }
    });
  }

  // 9. Build output
  const output = {
    generatedAt: new Date().toISOString(),
    currentPeriod: curr.period,
    previousPeriod: hasPrev ? prev.period : null,
    archiveCount: usableArchives.length,
    hasMultiWeekTrends: hasMultiWeek,

    summary: {
      pagesTracked: curr.byPage.length,
      previousPagesTracked: hasPrev ? prev.byPage.length : null,
      totalImpressions: currTotalImp,
      prevTotalImpressions: hasPrev ? prevTotalImp : null,
      impressionsDelta: hasPrev ? currTotalImp - prevTotalImp : null,
      impressionsPct: hasPrev ? pctChange(prevTotalImp, currTotalImp) : null,
      totalClicks: currTotalClk,
      prevTotalClicks: hasPrev ? prevTotalClk : null,
      clicksDelta: hasPrev ? currTotalClk - prevTotalClk : null,
    },

    alerts,
    newlyIndexed,
    deindexed,
    newKeywords,
    pageChanges,
    keywordsByPage,
    deployedNotIndexed,
  };

  // 10. Write output
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));

  // 11. Console summary
  console.log("");
  console.log("✅ ranking-comparison.json written");
  console.log(
    `   Pages: ${curr.byPage.length} tracked` +
      (hasPrev ? ` (was ${prev.byPage.length})` : " (baseline)")
  );
  console.log(
    `   Impressions: ${currTotalImp.toLocaleString()}` +
      (hasPrev
        ? ` (Δ${currTotalImp - prevTotalImp >= 0 ? "+" : ""}${(currTotalImp - prevTotalImp).toLocaleString()})`
        : "")
  );
  console.log(
    `   Clicks: ${currTotalClk}` +
      (hasPrev
        ? ` (Δ${currTotalClk - prevTotalClk >= 0 ? "+" : ""}${currTotalClk - prevTotalClk})`
        : "")
  );
  console.log(`   Alerts: ${alerts.length}`);
  console.log(`   Newly indexed: ${newlyIndexed.length}`);
  console.log(`   Deindexed: ${deindexed.length}`);
  console.log(`   New keywords: ${newKeywords.length}`);
  console.log(`   Deployed but not in SC: ${deployedNotIndexed.length}`);
}

main();
