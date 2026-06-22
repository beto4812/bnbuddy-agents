#!/usr/bin/env node

/**
 * generate-brief.js
 *
 * Deterministic content brief generator for the SEO pipeline.
 * Replaces manual LLM keyword selection with a script that applies
 * the priority waterfall and writes a ready-to-use brief.
 *
 * Reads:
 *   - data/dataforseo/keyword-queue.json  (keyword queue with priority scores)
 *   - data/ranking-comparison.json        (optional — for CTR gap context)
 *   - public/                             (scans for existing pages)
 *
 * Writes:
 *   - data/briefs/research-brief-YYYY-MM-DD.json
 *   - data/content-status.json
 *   - data/dataforseo/keyword-queue.json  (marks selected as "in-progress")
 *
 * Run via: npm run generate-brief
 * No API keys required — reads local files only.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── Paths ────────────────────────────────────────────────────────────────────

const REPO_ROOT      = path.resolve(__dirname, '../../..');
const LANDING_ROOT   = path.resolve(REPO_ROOT, '..', 'bnbuddy-landing');
const DATA_DIR       = path.join(REPO_ROOT, 'pipelines/seo-content-pipeline/data');
const QUEUE_FILE     = path.join(DATA_DIR, 'dataforseo/keyword-queue.json');
const RANKING_FILE   = path.join(DATA_DIR, 'ranking-comparison.json');
const BRIEFS_DIR     = path.join(DATA_DIR, 'briefs');
const STATUS_FILE    = path.join(DATA_DIR, 'content-status.json');
const PUBLIC_DIR     = path.join(LANDING_ROOT, 'public');
const IG_CHECKLIST   = path.join(DATA_DIR, 'ig-checklist.json');
const EXA_RESEARCH   = path.join(DATA_DIR, 'exa-research.json');
const REDDIT_RESEARCH = path.join(DATA_DIR, 'reddit-research.json');
const CONTENT_DIR    = path.join(REPO_ROOT, 'pipelines/seo-content-pipeline/content');

// ─── Config ───────────────────────────────────────────────────────────────────

const PLAN_SIZE = 3; // 3 content items per week

// ─── Selection-time blocklist ─────────────────────────────────────────────────
// Mirrors EN_BLOCKLIST from pull-keyword-data.js but applied at selection time
// to catch keywords that entered the queue before blocklist rules existed.

const SELECTION_BLOCKLIST = [
  // Legal / regulatory
  /\b(ordinances?|permits?|licenses?|zoning|regulations?|laws?|codes?|compliance|tax(?:es|ation)?|agreement|contract|lease|attorney|lawyer)\b/i,
  // Insurance
  /\binsurance\b/i,
  // Competitor brand names (we write comparison posts about these, but don't target their brand terms)
  /\b(vacasa|evolve|turnkey|awning|casago|keyrenter|nomad|guesty|lodgify|hostaway|hospitable)\b/i,
  // Jobs / employment
  /\bjobs?\b/i,
  // Unrelated verticals
  /\b(credit|loan|mortgage|finance|accounting|bookkeeping)\b/i,
  // US-specific geography — states, cities, and popular vacation destinations
  /\b(nyc|new york|florida|california|texas|hawaii|arizona|colorado|tennessee|georgia|chicago|los angeles|san diego|miami|austin|nashville|denver|scottsdale|orlando|seattle|portland|phoenix|san francisco|las vegas|savannah|charleston|gatlinburg|destin|myrtle beach|key west|cape cod|lake tahoe|aspen|park city|sedona|palm springs|maui|big bear|joshua tree|tahoe|outer banks|hilton head|smoky mountains|gulf shores|ocean city|jersey shore|poconos|catskills|napa valley|martha's vineyard|san antonio|virginia beach|atlantic city|daytona|clearwater|sarasota|fort lauderdale|breckenridge|steamboat|vail|whistler|cancun|cabo|tulum|punta cana|bahamas|bermuda|aruba|bali|ibiza|mykonos|santorini|paris|london|rome|barcelona|dubai|tokyo|puerto rico|houston|atlanta|dallas|philadelphia|washington dc|toronto|montreal|vancouver|amsterdam)\b/i,
  // "[location] vacation rentals" or "airbnb [location]" patterns — geo-intent, not product-intent
  /\b(airbnb|vrbo|vacation rentals?)\s+(in|near|at)\s+/i,
  // "near me" queries — local intent, can't target with content
  /\bnear me\b/i,
  // Regional directional geo terms ("southern vacation rentals", "coastal cabins", etc.)
  /^(southern|northern|eastern|western|coastal|mountain|lake|beach|ski|island|tropical)\b/i,
  // Student / consumer discounts
  /\bstudent\b/i,
  // Cancellation / policy (customer support, not content)
  /\b(cancellation|refund)\s+policy\b/i,
  // Definitional queries — Wikipedia-level, zero commercial intent
  /^what\s+is\s+/i,
];

function isBlocklisted(keyword) {
  const k = keyword.toLowerCase();
  for (const pattern of SELECTION_BLOCKLIST) {
    if (pattern.test(k)) return true;
  }
  return false;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadJSON(filepath) {
  if (!fs.existsSync(filepath)) return null;
  return JSON.parse(fs.readFileSync(filepath, 'utf8'));
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function weekOf() {
  // Monday of the current week
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff)).toISOString().slice(0, 10);
}

// ─── Scan existing pages ──────────────────────────────────────────────────────

function buildDoneList() {
  const done = new Set();

  // English pages (root of public/)
  if (fs.existsSync(PUBLIC_DIR)) {
    for (const entry of fs.readdirSync(PUBLIC_DIR)) {
      const full = path.join(PUBLIC_DIR, entry);
      if (fs.statSync(full).isDirectory() && entry !== 'es' && entry !== 'tmp' && entry !== 'wp-content' && entry !== 'wp-includes') {
        done.add(entry);
      }
    }
  }

  // Spanish pages (public/es/)
  const esDir = path.join(PUBLIC_DIR, 'es');
  if (fs.existsSync(esDir)) {
    for (const entry of fs.readdirSync(esDir)) {
      const full = path.join(esDir, entry);
      if (fs.statSync(full).isDirectory()) {
        done.add(entry);
        done.add('es/' + entry);
      }
    }
  }

  // Content markdown files (may not be published yet)
  if (fs.existsSync(CONTENT_DIR)) {
    for (const file of fs.readdirSync(CONTENT_DIR)) {
      if (file.endsWith('.md')) {
        done.add(file.replace('.md', ''));
      }
    }
  }

  return done;
}

// ─── Keyword selection ────────────────────────────────────────────────────────

/**
 * Selects keywords from the queue using the priority waterfall.
 * Returns an array of selected keyword objects (up to `count`).
 */
function selectKeywords(queue, doneList, count) {
  // Filter to eligible keywords
  const eligible = queue.keywords.filter(k => {
    if (k.status !== 'pending') return false;
    if (k.intent === 'service') return false;
    if (isBlocklisted(k.keyword)) return false;
    if (doneList.has(k.keyword.toLowerCase().replace(/\s+/g, '-'))) return false;
    return true;
  });

  if (eligible.length === 0) return [];

  // Priority 0: Product-aligned (brand_relevance >= 1, difficulty < 40, volume >= 100)
  const p0 = eligible
    .filter(k => (k.brand_relevance || 0) >= 1 && (k.difficulty || 40) < 40 && k.search_volume >= 100)
    .sort((a, b) => b.priority_score - a.priority_score);

  // Priority 1: Quick wins (difficulty < 20, volume >= 100)
  const p1 = eligible
    .filter(k => (k.difficulty || 40) < 20 && k.search_volume >= 100)
    .sort((a, b) => b.priority_score - a.priority_score);

  // Priority 2: Trending (quarterly trend > 20%)
  const p2 = eligible
    .filter(k => (k.trend_quarterly || 0) > 20)
    .sort((a, b) => b.priority_score - a.priority_score);

  // Priority 3: Commercial intent (difficulty < 40)
  const p3 = eligible
    .filter(k => k.intent === 'commercial' && (k.difficulty || 40) < 40)
    .sort((a, b) => b.priority_score - a.priority_score);

  // Default: everything by priority_score
  const pDefault = eligible
    .sort((a, b) => b.priority_score - a.priority_score);

  // Fill slots from priority tiers
  const selected = [];
  const usedIds = new Set();

  function fillFrom(tier) {
    for (const kw of tier) {
      if (selected.length >= count) return;
      if (usedIds.has(kw.id)) continue;
      selected.push(kw);
      usedIds.add(kw.id);
    }
  }

  fillFrom(p0);
  fillFrom(p1);
  fillFrom(p2);
  fillFrom(p3);
  fillFrom(pDefault);

  return selected;
}

/**
 * Maps a keyword to a content type based on intent.
 */
function contentType(keyword) {
  if (keyword.intent === 'commercial') return 'comparison-post';
  return 'blog-post';
}

/**
 * Generates a slug from a keyword string.
 */
function keywordToSlug(keyword) {
  return keyword
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Returns a priority tier label for a keyword (for rationale).
 */
function priorityLabel(kw) {
  const brand = kw.brand_relevance || 0;
  const diff = kw.difficulty || 40;
  const vol = kw.search_volume || 0;
  const trend = kw.trend_quarterly || 0;

  if (brand >= 1 && diff < 40) return 'Priority 0 — Product-aligned (brand_relevance: ' + brand + ')';
  if (diff < 20 && vol >= 100) return 'Priority 1 — Quick win (difficulty: ' + diff + ')';
  if (trend > 20) return 'Priority 2 — Trending (+' + trend + '% QoQ)';
  if (kw.intent === 'commercial' && diff < 40) return 'Priority 3 — Commercial intent';
  return 'Default — priority_score: ' + kw.priority_score;
}

// ─── Ranking insights (optional context) ──────────────────────────────────────

function extractRankingInsights(rankingData) {
  if (!rankingData) {
    return {
      dataSource: 'unavailable',
      dataDate: null,
      decliningPages: [],
      lowHangingFruit: [],
      ctrGaps: [],
    };
  }

  const declining = (rankingData.pageChanges || [])
    .filter(p => p.positionDelta !== null && p.positionDelta <= -5)
    .slice(0, 5)
    .map(p => ({
      page: p.page,
      position: p.position,
      positionDelta: p.positionDelta,
      trendDelta: p.trendDelta || null,
    }));

  const lowHanging = (rankingData.pageChanges || [])
    .filter(p => p.position >= 11 && p.position <= 30 && p.impressions >= 10)
    .slice(0, 5)
    .map(p => ({
      page: p.page,
      position: p.position,
      impressions: p.impressions,
    }));

  const ctrGaps = (rankingData.pageChanges || [])
    .filter(p => p.position <= 15 && p.ctr === 0 && p.impressions >= 5)
    .slice(0, 10)
    .map(p => ({
      page: p.page,
      position: p.position,
      ctr: p.ctr,
      action: 'title/meta refresh',
    }));

  return {
    dataSource: 'ranking-comparison.json',
    dataDate: rankingData.generatedAt || null,
    decliningPages: declining,
    lowHangingFruit: lowHanging,
    ctrGaps: ctrGaps,
  };
}

// ─── Existing pages list for the brief ────────────────────────────────────────

// ─── Information Gain matching ────────────────────────────────────────────────

/**
 * Matches IG checklist categories to a keyword based on topic relevance.
 * Uses the 'applicableTo' tags from ig-checklist.json and checks for
 * keyword overlap. Returns top 2-3 most relevant categories.
 */
function matchIGCategories(keyword, checklist) {
  if (!checklist || !checklist.categories) return null;

  const kw = keyword.toLowerCase();

  // Topic detection patterns
  const topicSignals = {
    'property-management': /\b(property.?manag|rental.?manag|vacation.?rental.?manag|manage|management)\b/i,
    'pricing': /\b(pricing|price|cost|rate|revenue|adr|nightly)\b/i,
    'occupancy': /\b(occupancy|booking|reservation|vacancy)\b/i,
    'revenue': /\b(revenue|income|earn|profit|money)\b/i,
    'automation': /\b(automat|ai|chatbot|auto.?reply|smart|tool|software)\b/i,
    'guest-communication': /\b(guest|message|communication|respond|reply|chat)\b/i,
    'listing-optimization': /\b(listing|optimiz|photo|description|title|seo)\b/i,
    'reviews': /\b(review|rating|star|feedback|reputation)\b/i,
    'superhost': /\b(superhost|super.?host|top.?host|best.?host)\b/i,
    'software-comparison': /\b(vs|versus|compar|alternative|best|top\s+\d+)\b/i,
    'tools': /\b(tool|software|app|platform|system|pms)\b/i,
    'channel-management': /\b(channel.?manag|multi.?platform|airbnb|vrbo|booking\.com)\b/i,
    'check-in': /\b(check.?in|arrival|welcome|guidebook|guide)\b/i,
    'ai-assistant': /\b(ai|artificial.?intelligence|chatbot|assistant|auto.?respond)\b/i,
    'hosting-tips': /\b(tip|trick|hack|advice|guide|how.?to|strategy)\b/i,
    'best-practices': /\b(best.?practice|standard|professional|expert)\b/i,
    'airbnb-hosting': /\b(airbnb|host|hosting|vacation.?rental|short.?term)\b/i,
    'investment': /\b(invest|roi|return|profit|passive.?income)\b/i,
    'seasonal-trends': /\b(season|summer|winter|holiday|peak|demand)\b/i,
    'market-analysis': /\b(market|trend|growth|data|statistic|analysis)\b/i,
    'photography': /\b(photo|image|picture|visual|staging)\b/i,
    'pms': /\b(pms|property.?management.?s(ystem|oftware))\b/i,
    'direct-booking': /\b(direct.?book|own.?website|skip.?ota|booking.?portal)\b/i,
    'guest-experience': /\b(guest.?experience|hospitality|amenit|comfort)\b/i,
  };

  // Detect topics in the keyword
  const detectedTopics = new Set();
  for (const [topic, pattern] of Object.entries(topicSignals)) {
    if (pattern.test(kw)) detectedTopics.add(topic);
  }

  // Always include general topics
  detectedTopics.add('airbnb-hosting');

  // Score each IG category by overlap with detected topics
  const scored = checklist.categories.map(cat => {
    const overlap = (cat.applicableTo || []).filter(t => detectedTopics.has(t));
    return { id: cat.id, label: cat.label, score: overlap.length, matchedTopics: overlap };
  });

  // Sort by score descending, take top matches
  scored.sort((a, b) => b.score - a.score);
  const required = checklist.requiredPerArticle || 2;
  const topMatches = scored.filter(s => s.score > 0).slice(0, Math.max(required, 2));

  // If no matches, fall back to superhost-tip (always applicable)
  if (topMatches.length === 0) {
    topMatches.push({ id: 'superhost-tip', label: 'Superhost Experience', score: 1, matchedTopics: ['airbnb-hosting'] });
  }

  return {
    required: required,
    suggestedCategories: topMatches.map(m => m.id),
    categoryLabels: topMatches.map(m => m.label),
    prompt: `Include at least ${required} proprietary data points. Suggested: ${topMatches.map(m => m.label).join(', ')}.`,
  };
}


function listExistingPages() {
  const geoPages = [];
  const blogPosts = [];

  // English pages
  if (fs.existsSync(PUBLIC_DIR)) {
    for (const entry of fs.readdirSync(PUBLIC_DIR)) {
      const full = path.join(PUBLIC_DIR, entry);
      if (fs.statSync(full).isDirectory() && entry !== 'es' && entry !== 'tmp'
          && entry !== 'wp-content' && entry !== 'wp-includes' && entry !== 'blog') {
        blogPosts.push(entry);
      }
    }
  }

  // Spanish pages
  const esDir = path.join(PUBLIC_DIR, 'es');
  if (fs.existsSync(esDir)) {
    for (const entry of fs.readdirSync(esDir)) {
      const full = path.join(esDir, entry);
      if (fs.statSync(full).isDirectory()) {
        if (entry.startsWith('administracion-renta-vacacional-')) {
          geoPages.push(entry.replace('administracion-renta-vacacional-', ''));
        } else {
          blogPosts.push(entry);
        }
      }
    }
  }

  return { geoPages, blogPosts };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const todayStr = today();
  const weekOfStr = weekOf();

  console.log(`\n📋  Generate Brief — ${todayStr}\n`);

  // 1. Load keyword queue
  const queue = loadJSON(QUEUE_FILE);
  if (!queue || !queue.keywords || queue.keywords.length === 0) {
    console.error('❌  No keyword queue found or queue is empty.');
    console.error('    Run: npm run pull-keyword-data');
    process.exit(1);
  }

  const pendingCount = queue.keywords.filter(k => k.status === 'pending').length;
  console.log(`📊  Keyword queue: ${queue.keywords.length} total, ${pendingCount} pending`);

  if (pendingCount === 0) {
    console.error('❌  No pending keywords in queue. All keywords are in-progress, completed, or skipped.');
    console.error('    Run: npm run pull-keyword-data  (to refresh the queue)');
    process.exit(1);
  }

  // 2. Load ranking data (optional)
  const rankingData = loadJSON(RANKING_FILE);
  if (rankingData) {
    console.log(`📊  Ranking data: loaded (${rankingData.generatedAt || 'unknown date'})`);
  } else {
    console.log('⚠️   No ranking-comparison.json found — skipping ranking insights');
  }

  // 3. Build DONE list
  const doneList = buildDoneList();
  console.log(`📊  Existing pages: ${doneList.size} slugs in DONE list`);

  // 4. Select keywords
  const selected = selectKeywords(queue, doneList, PLAN_SIZE);

  if (selected.length === 0) {
    console.error('❌  Could not select any keywords. All pending keywords may conflict with existing pages.');
    process.exit(1);
  }

  if (selected.length < PLAN_SIZE) {
    console.warn(`⚠️   Only ${selected.length} keywords selected (wanted ${PLAN_SIZE}). Queue may be running low.`);
  }

  // 5. Build content plan (with IG requirements)
  const igChecklist = loadJSON(IG_CHECKLIST);
  const contentPlan = selected.map((kw, i) => {
    const item = {
      run: i + 1,
      type: contentType(kw),
      slug: keywordToSlug(kw.keyword),
      keyword: kw.keyword,
      search_volume: kw.search_volume,
      difficulty: kw.difficulty,
      intent: kw.intent,
      priority_score: kw.priority_score,
      trend_quarterly: kw.trend_quarterly || 0,
      language: kw.language,
      brand_relevance: kw.brand_relevance || 0,
      rationale: priorityLabel(kw),
    };

    // Attach Information Gain requirements
    if (igChecklist) {
      item.informationGain = matchIGCategories(kw.keyword, igChecklist);
    }

    return item;
  });

  // 6. Mark selected keywords as in-progress
  for (const item of contentPlan) {
    const kw = queue.keywords.find(k => k.keyword === item.keyword);
    if (kw) {
      kw.status = 'in-progress';
      kw.claimedAt = new Date().toISOString();
    }
  }

  // Update queue summary
  queue.summary.pending = queue.keywords.filter(k => k.status === 'pending').length;
  queue.summary.in_progress = queue.keywords.filter(k => k.status === 'in-progress').length;
  queue.summary.completed = queue.keywords.filter(k => k.status === 'completed').length;
  queue.summary.skipped = queue.keywords.filter(k => k.status === 'skipped').length;

  fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));

  // 7. Build existing pages lists
  const { geoPages, blogPosts } = listExistingPages();

  // 8. Build ranking insights
  const insights = extractRankingInsights(rankingData);

  // 9. Load external research data (if available)
  const exaResearch = loadJSON(EXA_RESEARCH);
  const redditResearch = loadJSON(REDDIT_RESEARCH);

  if (exaResearch) {
    console.log(`📊  Exa research: loaded (${exaResearch.generatedAt || 'unknown date'}, ${exaResearch.searchesUsed || 0} searches)`);
  } else {
    console.log('⚠️   No exa-research.json found — run: npm run pull-exa-research');
  }

  if (redditResearch) {
    const totalPosts = (redditResearch.subreddits || []).reduce((sum, s) => sum + (s.topPosts || []).length, 0);
    console.log(`📊  Reddit research: loaded (${redditResearch.generatedAt || 'unknown date'}, ${totalPosts} posts)`);
  } else {
    console.log('⚠️   No reddit-research.json found — run: npm run pull-reddit-research');
  }

  // 10. Build the brief
  const brief = {
    generatedAt: new Date().toISOString(),
    weekOf: weekOfStr,
    agentVersion: '5.0',
    existingPages: geoPages,
    existingBlogPosts: blogPosts,
    keywordQueue: {
      totalPending: queue.summary.pending,
      selectedThisRun: contentPlan.map(i => i.keyword),
      topPrioritySkipped: 'none',
    },
    rankingInsights: insights,
    contentPlan: contentPlan,
    externalResearch: {
      exa: exaResearch ? {
        generatedAt: exaResearch.generatedAt,
        searchesUsed: exaResearch.searchesUsed || 0,
        keywordsCovered: (exaResearch.keywords || []).map(k => k.keyword),
      } : null,
      reddit: redditResearch ? {
        generatedAt: redditResearch.generatedAt,
        subreddits: (redditResearch.subreddits || []).map(s => ({
          name: s.name,
          postsScanned: s.postsScanned || 0,
          topPostCount: (s.topPosts || []).length,
        })),
      } : null,
    },
    dataQuality: {
      keywordQueueAge: 'fresh (< 7 days)',
      rankingDataAge: rankingData ? 'fresh (< 7 days)' : 'unavailable',
      exaResearchAge: exaResearch ? 'available' : 'unavailable',
      redditResearchAge: redditResearch ? 'available' : 'unavailable',
      keywordsPending: queue.summary.pending,
      keywordsMarkedInProgress: queue.summary.in_progress,
      notes: [],
    },
  };

  // 11. Write the brief
  if (!fs.existsSync(BRIEFS_DIR)) fs.mkdirSync(BRIEFS_DIR, { recursive: true });
  const briefPath = path.join(BRIEFS_DIR, `research-brief-${todayStr}.json`);
  fs.writeFileSync(briefPath, JSON.stringify(brief, null, 2));

  // 12. Write content-status.json
  const status = {
    weekOf: weekOfStr,
    briefRef: `research-brief-${todayStr}.json`,
    items: {},
  };
  for (const item of contentPlan) {
    status.items[item.slug] = { status: 'pending' };
  }
  fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2));

  // 13. Print summary
  console.log(`\n✅  Research brief written → data/briefs/research-brief-${todayStr}.json`);
  console.log(`✅  Content status written → data/content-status.json\n`);
  console.log(`Content plan for week of ${weekOfStr}:`);

  for (const item of contentPlan) {
    const brandFlag = (item.brand_relevance || 0) >= 1 ? ' 🎯' : '';
    console.log(`  Run ${item.run}: ${item.type} — "${item.keyword}" (vol:${item.search_volume} diff:${item.difficulty} brand:${item.brand_relevance}${brandFlag})`);
    console.log(`         ${item.rationale}`);
  }

  console.log(`\nKeywords: ${queue.summary.pending} pending, ${queue.summary.skipped} skipped, ${queue.summary.in_progress} in-progress`);
  console.log('');
}

main();
