/**
 * pull-exa-research.js
 *
 * Fetches competitor content via Exa semantic search for target keywords.
 *
 * Reads keywords from the keyword queue (in-progress first, then first 3 pending)
 * and runs Exa searches to discover competitor articles, extracting highlights
 * (token-efficient snippets) for each result.
 *
 * Output:
 *   pipelines/seo-content-pipeline/data/exa-research.json
 *
 * Credentials: ~/.config/bnbuddy/exa.env  (EXA_API_KEY=exa-xxxx)
 *
 * Usage:
 *   node pull-exa-research.js                     # process queue keywords
 *   node pull-exa-research.js --dry-run            # preview without API calls
 *   node pull-exa-research.js --keyword "airbnb…"  # search a specific keyword
 *   node pull-exa-research.js --max-results 5      # override results per keyword
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ─── Paths ────────────────────────────────────────────────────────────────────

const REPO_ROOT      = path.resolve(__dirname, '../../..');
const DATA_DIR       = path.join(REPO_ROOT, 'pipelines/seo-content-pipeline/data');
const DATAFORSEO_DIR = path.join(DATA_DIR, 'dataforseo');
const QUEUE_FILE     = path.join(DATAFORSEO_DIR, 'keyword-queue.json');
const OUTPUT_FILE    = path.join(DATA_DIR, 'exa-research.json');
const CREDS_FILE     = path.join(os.homedir(), '.config/bnbuddy/exa.env');

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_MAX_RESULTS   = 10;
const MAX_KEYWORDS_PER_RUN  = 3;
const DELAY_BETWEEN_MS      = 1000;

// Exa search date filter — last 12 months from today
function startPublishedDate() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

// ─── CLI arg parsing ──────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { dryRun: false, keyword: null, maxResults: DEFAULT_MAX_RESULTS };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--keyword':
        opts.keyword = args[++i];
        if (!opts.keyword) {
          console.error('❌  --keyword requires a value');
          process.exit(1);
        }
        break;
      case '--max-results':
        opts.maxResults = parseInt(args[++i], 10);
        if (isNaN(opts.maxResults) || opts.maxResults < 1) {
          console.error('❌  --max-results must be a positive integer');
          process.exit(1);
        }
        break;
      default:
        console.error(`❌  Unknown argument: ${args[i]}`);
        console.error('    Usage: node pull-exa-research.js [--dry-run] [--keyword "..."] [--max-results N]');
        process.exit(1);
    }
  }

  return opts;
}

// ─── Credentials ──────────────────────────────────────────────────────────────

function loadCreds() {
  if (!fs.existsSync(CREDS_FILE)) {
    console.error(`❌  Credentials file not found at ${CREDS_FILE}`);
    console.error('    Create it with:\n    EXA_API_KEY=exa-xxxx');
    process.exit(1);
  }
  const lines = fs.readFileSync(CREDS_FILE, 'utf8').split('\n');
  const env = {};
  for (const line of lines) {
    const [key, ...rest] = line.trim().split('=');
    if (key && !key.startsWith('#')) env[key.trim()] = rest.join('=').trim();
  }
  if (!env.EXA_API_KEY) {
    console.error('❌  EXA_API_KEY missing in credentials file.');
    process.exit(1);
  }
  return env;
}

// ─── Keyword queue ────────────────────────────────────────────────────────────

function loadKeywordsFromQueue() {
  if (!fs.existsSync(QUEUE_FILE)) {
    console.error(`❌  Keyword queue not found at ${QUEUE_FILE}`);
    console.error('    Run "npm run pull-keyword-data" first to populate the queue.');
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
  const keywords = Array.isArray(data.keywords) ? data.keywords : [];

  // Collect in-progress keywords first
  const inProgress = keywords.filter(k => k.status === 'in-progress');
  // Then fill up to MAX_KEYWORDS_PER_RUN with pending keywords
  const pending    = keywords.filter(k => k.status === 'pending');
  const slotsLeft  = Math.max(0, MAX_KEYWORDS_PER_RUN - inProgress.length);
  const selected   = [...inProgress, ...pending.slice(0, slotsLeft)];

  return selected.map(k => k.keyword);
}

// ─── Search query expansion ───────────────────────────────────────────────────

/**
 * Expands a raw keyword into a richer semantic query for Exa.
 * Adds context words (tools, strategies, guide, best, for hosts, vacation rental)
 * so Exa's neural search returns more relevant competitor content.
 */
function expandQuery(keyword) {
  const kw = keyword.toLowerCase();

  // Context words to consider appending
  const expansions = [];

  // Add "best" prefix if not already present
  if (!kw.startsWith('best ')) {
    expansions.push('best');
  }

  // Keep the original keyword as the core
  expansions.push(keyword);

  // Add domain-relevant suffixes based on keyword content
  if (!kw.includes('tool') && !kw.includes('software') && !kw.includes('app')) {
    expansions.push('tools and strategies');
  }
  if (!kw.includes('host') && !kw.includes('anfitrión')) {
    expansions.push('for vacation rental hosts');
  }

  // Add current year for freshness
  const year = new Date().getFullYear();
  expansions.push(String(year));

  return expansions.join(' ');
}

// ─── Sleep helper ─────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts  = parseArgs();
  const today = new Date().toISOString().slice(0, 10);

  console.log(`\n🔍  Exa Research Pull — ${today}\n`);

  // ── Determine target keywords ──────────────────────────────────────────────
  let targetKeywords;
  if (opts.keyword) {
    targetKeywords = [opts.keyword];
    console.log(`📌  Single keyword mode: "${opts.keyword}"`);
  } else {
    targetKeywords = loadKeywordsFromQueue();
    if (targetKeywords.length === 0) {
      console.log('⚠️  No in-progress or pending keywords found in the queue.');
      console.log('    Run "npm run pull-keyword-data" to populate, or use --keyword "..."');
      process.exit(0);
    }
    console.log(`📋  Keywords from queue (${targetKeywords.length}):`);
    targetKeywords.forEach(kw => console.log(`    • ${kw}`));
  }

  // ── Build expanded queries ─────────────────────────────────────────────────
  const searches = targetKeywords.map(kw => ({
    keyword: kw,
    searchQuery: expandQuery(kw),
  }));

  console.log(`\n🧠  Expanded search queries:`);
  searches.forEach(s => {
    console.log(`    "${s.keyword}"`);
    console.log(`     → ${s.searchQuery}`);
  });

  // ── Dry-run exit ───────────────────────────────────────────────────────────
  if (opts.dryRun) {
    console.log(`\n⚠️  --dry-run: would search ${searches.length} keyword(s) with ${opts.maxResults} results each`);
    console.log('    No API calls made.\n');
    process.exit(0);
  }

  // ── Load Exa SDK ───────────────────────────────────────────────────────────
  const creds  = loadCreds();
  const { Exa } = require('exa-js');
  const exa    = new Exa(creds.EXA_API_KEY);

  const publishedAfter = startPublishedDate();
  console.log(`\n📡  Searching Exa (results published after ${publishedAfter})...\n`);

  // ── Run searches ───────────────────────────────────────────────────────────
  const keywordResults = [];
  let searchesUsed = 0;

  for (let i = 0; i < searches.length; i++) {
    const { keyword, searchQuery } = searches[i];
    console.log(`  [${i + 1}/${searches.length}] 🔎  "${keyword}"`);

    try {
      const result = await exa.search(searchQuery, {
        type: 'auto',
        numResults: opts.maxResults,
        contents: { highlights: true },
        excludeDomains: ['bnbuddy.com'],
        startPublishedDate: publishedAfter,
      });

      searchesUsed++;
      const results = (result.results || []).map(r => ({
        url:           r.url || null,
        title:         r.title || null,
        publishedDate: r.publishedDate || null,
        score:         r.score != null ? Math.round(r.score * 1000) / 1000 : null,
        highlights:    r.highlights || [],
      }));

      keywordResults.push({ keyword, searchQuery, results });
      console.log(`       ✅  ${results.length} results`);

    } catch (err) {
      console.error(`       ❌  Error: ${err.message}`);
      keywordResults.push({
        keyword,
        searchQuery,
        results: [],
        error: err.message,
      });
    }

    // Delay between searches (skip after last)
    if (i < searches.length - 1) {
      await sleep(DELAY_BETWEEN_MS);
    }
  }

  // ── Write output ───────────────────────────────────────────────────────────
  const output = {
    generatedAt:  new Date().toISOString(),
    searchesUsed,
    keywords:     keywordResults,
  };

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

  console.log(`\n💾  Results written → data/exa-research.json`);
  console.log(`    Searches used: ${searchesUsed}`);
  console.log(`    Keywords:      ${keywordResults.length}`);

  const totalResults = keywordResults.reduce((sum, k) => sum + k.results.length, 0);
  console.log(`    Total results: ${totalResults}`);

  // Quick summary of top results per keyword
  console.log('\n📊  Summary:\n');
  for (const kr of keywordResults) {
    const topResult = kr.results[0];
    console.log(`  "${kr.keyword}" — ${kr.results.length} results`);
    if (topResult) {
      console.log(`    🥇 ${topResult.title || '(no title)'}`);
      console.log(`       ${topResult.url}`);
    }
    if (kr.error) {
      console.log(`    ❌ ${kr.error}`);
    }
  }

  console.log('\n✅  Done.\n');
}

main().catch(err => {
  console.error('\n❌  Fatal error:', err.message);
  process.exit(1);
});
