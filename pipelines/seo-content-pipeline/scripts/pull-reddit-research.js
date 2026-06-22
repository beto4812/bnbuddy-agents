#!/usr/bin/env node

/**
 * pull-reddit-research.js
 *
 * Discovers top Reddit posts from vacation-rental host subreddits via RSS,
 * crawls full thread content via r.jina.ai, and writes structured research
 * output for the SEO content pipeline.
 *
 * Outputs:
 *   - data/reddit-research.json           — structured summary of all posts
 *   - data/reddit-crawls/[sub]/[slug].md  — full crawled markdown per post
 *
 * Usage:
 *   node pipelines/seo-content-pipeline/scripts/pull-reddit-research.js
 *   node pipelines/seo-content-pipeline/scripts/pull-reddit-research.js --dry-run
 *   node pipelines/seo-content-pipeline/scripts/pull-reddit-research.js --subreddit airbnb_hosts
 *
 * Prerequisites:
 *   - npm install rss-parser (project-level)
 *
 * No authentication required — uses public Reddit RSS + Jina free tier.
 */

'use strict';

const https  = require('https');
const fs     = require('fs');
const path   = require('path');

// ─── Paths ────────────────────────────────────────────────────────────────────

const REPO_ROOT  = path.resolve(__dirname, '../../..');
const DATA_DIR   = path.join(REPO_ROOT, 'pipelines/seo-content-pipeline/data');
const CRAWL_DIR  = path.join(DATA_DIR, 'reddit-crawls');
const OUTPUT_FILE = path.join(DATA_DIR, 'reddit-research.json');

// ─── Config ───────────────────────────────────────────────────────────────────

const USER_AGENT = 'BnBuddy-SEO-Bot/1.0 (contact: hello@bnbuddy.com)';
const RATE_LIMIT_MS = 5000; // 5 seconds between requests
const TOP_N = 5;            // top posts to crawl per subreddit

const SUBREDDITS = [
  {
    name: 'airbnb_hosts',
    rssUrl: 'https://www.reddit.com/r/airbnb_hosts/top/.rss?t=week',
  },
  {
    name: 'AirBnBHosts',
    rssUrl: 'https://www.reddit.com/r/AirBnBHosts/top/.rss?t=week',
  },
  {
    name: 'ShortTermRentals',
    rssUrl: 'https://www.reddit.com/r/ShortTermRentals/top/.rss?t=week',
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
 * Crawl a URL via Jina AI reader and return the markdown content.
 */
async function crawlViaJina(url) {
  const jinaUrl = `https://r.jina.ai/${url}`;
  return httpGet(jinaUrl);
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
    // RSS items from Reddit top/.rss are already sorted by score.
    // Use reverse index as a proxy for ranking (first = highest score).
    sortOrder: index,
    contentSnippet: (item.contentSnippet || '').slice(0, 200),
  }));

  console.log(`   📋 Found ${posts.length} posts in r/${subreddit.name}`);
  return posts;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔍 Reddit Research — Pull top posts from host subreddits');
  console.log(`   Mode: ${DRY_RUN ? '🏜️  DRY RUN (no crawling)' : '🚀 LIVE (will crawl via Jina)'}`);

  if (FILTER_SUB) {
    console.log(`   Filter: only r/${FILTER_SUB}`);
  }

  console.log('');

  // Determine which subreddits to process
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
      // Phase 1: Fetch RSS
      const posts = await fetchSubredditRSS(subreddit);
      await sleep(RATE_LIMIT_MS);

      // Take top N posts (already sorted by Reddit's top ranking)
      const topPosts = posts.slice(0, TOP_N);

      if (DRY_RUN) {
        console.log(`\n   📝 Top ${topPosts.length} posts from r/${subreddit.name}:`);
        for (const post of topPosts) {
          console.log(`      • ${post.title}`);
          console.log(`        ${post.url}`);
          console.log(`        ${formatDate(post.date)}`);
        }
      }

      const crawledPosts = [];

      if (!DRY_RUN) {
        // Phase 2: Crawl top posts via Jina
        const subCrawlDir = path.join(CRAWL_DIR, subreddit.name);
        ensureDir(subCrawlDir);

        for (let i = 0; i < topPosts.length; i++) {
          const post = topPosts[i];
          const slug = slugify(post.title);
          const crawlFile = path.join(subCrawlDir, `${slug}.md`);
          const relativeCrawlFile = path.relative(
            path.join(REPO_ROOT, 'pipelines/seo-content-pipeline'),
            crawlFile
          );

          console.log(`   📖 [${i + 1}/${topPosts.length}] Crawling: ${post.title.slice(0, 60)}...`);

          try {
            const markdown = await crawlViaJina(post.url);

            // Write crawl file in standard format per AGENTS.md
            const crawlContent = [
              `Title: ${post.title}`,
              `URL: ${post.url}`,
              `Publish Time: ${formatDate(post.date)}`,
              '',
              markdown,
            ].join('\n');

            fs.writeFileSync(crawlFile, crawlContent, 'utf8');
            console.log(`   ✅ Saved → ${relativeCrawlFile}`);

            crawledPosts.push({
              title: post.title,
              url: post.url,
              date: formatDate(post.date),
              crawlFile: relativeCrawlFile,
            });
          } catch (crawlErr) {
            console.error(`   ⚠️  Failed to crawl: ${crawlErr.message}`);
            crawledPosts.push({
              title: post.title,
              url: post.url,
              date: formatDate(post.date),
              crawlFile: null,
              error: crawlErr.message,
            });
          }

          // Rate limit between crawl requests
          if (i < topPosts.length - 1) {
            await sleep(RATE_LIMIT_MS);
          }
        }
      }

      results.push({
        name: subreddit.name,
        rssUrl: subreddit.rssUrl,
        postsScanned: posts.length,
        topPosts: DRY_RUN
          ? topPosts.map((p) => ({
              title: p.title,
              url: p.url,
              date: formatDate(p.date),
            }))
          : crawledPosts,
      });
    } catch (subErr) {
      console.error(`\n❌ Error processing r/${subreddit.name}: ${subErr.message}`);
      results.push({
        name: subreddit.name,
        rssUrl: subreddit.rssUrl,
        postsScanned: 0,
        topPosts: [],
        error: subErr.message,
      });
    }

    // Rate limit between subreddits
    if (subreddit !== targetSubs[targetSubs.length - 1]) {
      await sleep(RATE_LIMIT_MS);
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
  console.log(`   Top posts selected:   ${totalTop}`);
  if (errors > 0) {
    console.log(`   ⚠️  Subreddits with errors: ${errors}`);
  }
  console.log(`   Output: ${path.relative(REPO_ROOT, OUTPUT_FILE)}`);
  if (!DRY_RUN) {
    console.log(`   Crawls: ${path.relative(REPO_ROOT, CRAWL_DIR)}/`);
  }
}

main().catch((err) => {
  console.error('❌ Fatal error:', err.message);
  process.exit(1);
});
