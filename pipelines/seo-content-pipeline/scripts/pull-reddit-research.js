#!/usr/bin/env node

/**
 * pull-reddit-research.js
 *
 * Discovers top Reddit posts from vacation-rental host subreddits via RSS
 * and enriches them with Exa web search for related discussions.
 *
 * Strategy:
 *   1. Fetch Reddit RSS to get trending post titles, URLs, dates, and snippets.
 *   2. Use the RSS contentSnippet as the post content (no crawling needed).
 *   3. Run one Exa search per subreddit to find related discussions on the web.
 *
 * Reddit blocks all crawlers (Jina, Exa getContents, etc.), so we rely on
 * RSS data which includes enough signal for the content pipeline.
 *
 * Outputs:
 *   - data/reddit-research.json  — structured post summaries + Exa context
 *
 * Usage:
 *   node pipelines/seo-content-pipeline/scripts/pull-reddit-research.js
 *   node pipelines/seo-content-pipeline/scripts/pull-reddit-research.js --dry-run
 *   node pipelines/seo-content-pipeline/scripts/pull-reddit-research.js --subreddit airbnb_hosts
 *
 * Credentials: ~/.config/bnbuddy/exa.env  (EXA_API_KEY=exa-xxxx)
 */

'use strict';

const os     = require('os');
const https  = require('https');
const fs     = require('fs');
const path   = require('path');

// ─── Credentials ──────────────────────────────────────────────────────────────

function loadCreds() {
  const CREDS_FILE = path.join(os.homedir(), '.config/bnbuddy/exa.env');
  if (!fs.existsSync(CREDS_FILE)) {
    console.error(`❌  Credentials file not found at ${CREDS_FILE}`);
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

// ─── Paths ────────────────────────────────────────────────────────────────────

const REPO_ROOT  = path.resolve(__dirname, '../../..');
const DATA_DIR   = path.join(REPO_ROOT, 'pipelines/seo-content-pipeline/data');
const CRAWL_DIR  = path.join(DATA_DIR, 'reddit-crawls');
const OUTPUT_FILE = path.join(DATA_DIR, 'reddit-research.json');

// ─── Config ───────────────────────────────────────────────────────────────────

const USER_AGENT = 'BnBuddy-SEO-Bot/1.0 (contact: hello@bnbuddy.com)';
const RATE_LIMIT_MS = 5000; // 5 seconds between requests
const TOP_N = 8;            // top posts to collect per subreddit (more since we only use one)

// Primary subreddit — the most active vacation rental host community.
// AirBnBHosts and ShortTermRentals consistently 429 when fetched in sequence,
// and airbnb_hosts alone provides strong enough signal for the pipeline.
const SUBREDDITS = [
  {
    name: 'airbnb_hosts',
    rssUrl: 'https://www.reddit.com/r/airbnb_hosts/top/.rss?t=week',
  },
];

// ─── CLI Args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const subFlagIdx = args.indexOf('--subreddit');
const FILTER_SUB = subFlagIdx !== -1 ? args[subFlagIdx + 1] : null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Sleep for `ms` milliseconds.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate a URL-safe slug from a title string.
 * Lowercase, hyphens only, max 60 characters.
 */
function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Format a date as YYYY-MM-DD.
 */
function formatDate(dateStr) {
  try {
    return new Date(dateStr).toISOString().split('T')[0];
  } catch {
    return 'unknown';
  }
}

/**
 * Ensure a directory exists, creating it recursively if needed.
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Fetch a URL via native https and return the response body as a string.
 * Follows up to 5 redirects.
 */
function httpGet(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const doRequest = (requestUrl, redirectsLeft) => {
      const parsedUrl = new URL(requestUrl);
      const options = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xml,application/rss+xml,*/*',
        },
      };

      const req = https.request(options, (res) => {
        // Handle redirects
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          if (redirectsLeft <= 0) {
            reject(new Error(`Too many redirects for ${url}`));
            return;
          }
          const redirectUrl = res.headers.location.startsWith('http')
            ? res.headers.location
            : new URL(res.headers.location, requestUrl).href;
          doRequest(redirectUrl, redirectsLeft - 1);
          return;
        }

        if (res.statusCode !== 200) {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => reject(new Error(`HTTP ${res.statusCode} for ${requestUrl}: ${body.slice(0, 200)}`)));
          return;
        }

        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve(body));
      });

      req.on('error', reject);
      req.end();
    };

    doRequest(url, maxRedirects);
  });
}

/**
 * Search Exa for discussions related to a subreddit's topic.
 * Reddit is blocked from includeDomains, so we search broadly.
 */
async function searchExaForSubreddit(subredditName, exa) {
  const topicMap = {
    airbnb_hosts:      'airbnb host problems tips vacation rental management',
    AirBnBHosts:       'airbnb host tips reviews guest issues short term rental',
    ShortTermRentals:  'short term rental host strategy pricing Vrbo Airbnb tips',
  };
  const query = topicMap[subredditName]
    || `${subredditName} vacation rental host discussion`;

  try {
    const result = await exa.searchAndContents(query, {
      type: 'auto',
      numResults: 5,
      text: { maxCharacters: 800 },
    });
    return (result.results || []).map(r => ({
      url:   r.url,
      title: r.title,
      text:  r.text,
    }));
  } catch (err) {
    console.error(`   ⚠️  Exa search failed for ${subredditName}: ${err.message}`);
    return [];
  }
}

// ─── RSS Parsing ──────────────────────────────────────────────────────────────

/**
 * Fetch and parse an RSS feed from a subreddit.
 * Returns an array of post objects sorted by engagement (approximated).
 */
async function fetchSubredditRSS(subreddit) {
  const RSSParser = require('rss-parser');
  const parser = new RSSParser({
    customFields: {
      item: [
        ['media:thumbnail', 'thumbnail'],
      ],
    },
    headers: {
      'User-Agent': USER_AGENT,
    },
  });

  console.log(`📡 Fetching RSS: ${subreddit.rssUrl}`);
  const feed = await parser.parseURL(subreddit.rssUrl);

  const posts = (feed.items || []).map((item, index) => ({
    title: item.title || 'Untitled',
    url: item.link || '',
    date: item.isoDate || item.pubDate || '',
    sortOrder: index,
    // RSS includes a decent text preview — use it directly (no crawling needed).
    contentSnippet: (item.contentSnippet || '').slice(0, 800),
  }));

  console.log(`   📋 Found ${posts.length} posts in r/${subreddit.name}`);
  return posts;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const creds = loadCreds();
  const { Exa } = require('exa-js');
  const exa = new Exa(creds.EXA_API_KEY);

  console.log('🔍 Reddit Research — Pull top posts from host subreddits');
  console.log(`   Strategy: RSS snippets + Exa web search (no crawling — Reddit blocks all crawlers)`);
  console.log(`   Mode: ${DRY_RUN ? '🏜️  DRY RUN' : '🚀 LIVE'}`);

  if (FILTER_SUB) {
    console.log(`   Filter: only r/${FILTER_SUB}`);
  }

  console.log('');

  const targetSubs = FILTER_SUB
    ? SUBREDDITS.filter((s) => s.name.toLowerCase() === FILTER_SUB.toLowerCase())
    : SUBREDDITS;

  if (targetSubs.length === 0) {
    console.error(`❌ Unknown subreddit: ${FILTER_SUB}`);
    console.error(`   Available: ${SUBREDDITS.map((s) => s.name).join(', ')}`);
    process.exit(1);
  }

  const results = [];

  for (const subreddit of targetSubs) {
    try {
      // Phase 1: Fetch RSS and extract top posts with their snippets
      const posts = await fetchSubredditRSS(subreddit);
      const topPosts = posts.slice(0, TOP_N);

      const postSummaries = topPosts.map((p) => ({
        title:          p.title,
        url:            p.url,
        date:           formatDate(p.date),
        contentSnippet: p.contentSnippet,
      }));

      console.log(`   📋 Top ${topPosts.length} posts collected from RSS.`);

      // Phase 2: Exa search for related discussions (non-Reddit)
      let exaContext = [];
      if (!DRY_RUN) {
        console.log(`   🔍 Searching Exa for related discussions...`);
        exaContext = await searchExaForSubreddit(subreddit.name, exa);
        console.log(`   ✅ Got ${exaContext.length} Exa results.`);
      }

      if (DRY_RUN) {
        console.log(`\n   📝 Top ${topPosts.length} posts from r/${subreddit.name}:`);
        for (const post of topPosts) {
          console.log(`      • ${post.title}`);
          console.log(`        ${post.url}`);
        }
      }

      results.push({
        name:         subreddit.name,
        rssUrl:       subreddit.rssUrl,
        postsScanned: posts.length,
        topPosts:     postSummaries,
        exaContext,
      });
    } catch (subErr) {
      console.error(`\n❌ Error processing r/${subreddit.name}: ${subErr.message}`);
      results.push({
        name:         subreddit.name,
        rssUrl:       subreddit.rssUrl,
        postsScanned: 0,
        topPosts:     [],
        exaContext:   [],
        error:        subErr.message,
      });
    }

    // Rate limit between subreddits — Reddit 429s if hit too fast
    if (subreddit !== targetSubs[targetSubs.length - 1]) {
      console.log(`   ⏳ Waiting 3s before next subreddit...`);
      await sleep(3000);
    }
  }

  // Write output JSON
  const output = {
    generatedAt: new Date().toISOString(),
    dryRun: DRY_RUN,
    subreddits: results,
  };

  ensureDir(DATA_DIR);
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf8');

  // Summary
  const totalScanned = results.reduce((sum, r) => sum + r.postsScanned, 0);
  const totalTop = results.reduce((sum, r) => sum + r.topPosts.length, 0);
  const errors = results.filter((r) => r.error).length;

  console.log('\n' + '─'.repeat(60));
  console.log('✅ Reddit research complete');
  console.log(`   Subreddits processed: ${results.length}`);
  console.log(`   Posts scanned (RSS):  ${totalScanned}`);
  console.log(`   Top posts collected:  ${totalTop}`);
  if (errors > 0) console.log(`   ⚠️  Subreddits with errors: ${errors}`);
  console.log(`   Output: ${path.relative(REPO_ROOT, OUTPUT_FILE)}`);
}

main().catch((err) => {
  console.error('❌ Fatal error:', err.message);
  process.exit(1);
});
