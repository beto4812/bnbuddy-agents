/**
 * pull-keyword-data.js
 *
 * Fetches keyword data from DataForSEO and writes:
 *   - pipelines/seo-content-pipeline/data/dataforseo/keyword-queue.json   (current queue)
 *   - pipelines/seo-content-pipeline/data/dataforseo/raw-YYYY-MM-DD.json  (archived raw API response)
 *
 * Credentials: ~/.config/bnbuddy/dataforseo.env
 * Run via: npm run pull-keyword-data
 *
 * Two-pass strategy:
 *   Pass 1 (English) — keyword_ideas endpoint with brand-adjacent seeds
 *   Pass 2 (Spanish) — search_volume endpoint with manually-seeded keyword templates
 *                      (DataForSEO has sparse index for MX Spanish niche terms)
 */

'use strict';

const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const crypto = require('crypto');

// ─── Paths ────────────────────────────────────────────────────────────────────

const REPO_ROOT      = path.resolve(__dirname, '../../..');
const DATA_DIR       = path.join(REPO_ROOT, 'pipelines/seo-content-pipeline/data');
const DATAFORSEO_DIR = path.join(DATA_DIR, 'dataforseo');
const QUEUE_FILE     = path.join(DATAFORSEO_DIR, 'keyword-queue.json');
const CREDS_FILE     = path.join(os.homedir(), '.config/bnbuddy/dataforseo.env');

// ─── Credentials ─────────────────────────────────────────────────────────────

function loadCreds() {
  if (!fs.existsSync(CREDS_FILE)) {
    console.error(`❌  Credentials file not found at ${CREDS_FILE}`);
    console.error('    Create it with:\n    DATAFORSEO_LOGIN=your@email.com\n    DATAFORSEO_PASSWORD=yourpassword');
    process.exit(1);
  }
  const lines = fs.readFileSync(CREDS_FILE, 'utf8').split('\n');
  const env = {};
  for (const line of lines) {
    const [key, ...rest] = line.trim().split('=');
    if (key && !key.startsWith('#')) env[key.trim()] = rest.join('=').trim();
  }
  if (!env.DATAFORSEO_LOGIN || !env.DATAFORSEO_PASSWORD) {
    console.error('❌  DATAFORSEO_LOGIN or DATAFORSEO_PASSWORD missing in credentials file.');
    process.exit(1);
  }
  return env;
}

// ─── API helper ───────────────────────────────────────────────────────────────

function apiPost(authHeader, endpoint, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.dataforseo.com',
      path: endpoint,
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, (res) => {
      let out = '';
      res.on('data', c => (out += c));
      res.on('end', () => {
        try { resolve(JSON.parse(out)); }
        catch (e) { reject(new Error('JSON parse failed: ' + out.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ─── Seed definitions ─────────────────────────────────────────────────────────

/**
 * English seeds: brand-adjacent vacation rental / Airbnb management topics.
 * We use keyword_ideas to discover related terms we haven't thought of.
 */
const EN_SEEDS = [
  // AI Guest Assistant — BnBuddy's core product
  'airbnb ai guest assistant',
  'automated airbnb guest messaging',
  'airbnb chatbot for hosts',
  'ai response airbnb guests',
  'airbnb auto reply messages',
  // Digital Guidebook — interactive property guides
  'airbnb digital guidebook',
  'vacation rental welcome book',
  'airbnb house manual template',
  'qr code check-in airbnb',
  'airbnb guest guide app',
  // Direct Booking — skip OTA fees
  'direct booking website vacation rental',
  'airbnb alternative booking site',
  'vacation rental website builder',
  'direct booking for hosts',
  // Host Automation / General
  'airbnb automation tools',
  'how to automate airbnb hosting',
  'airbnb host tools free',
  'short term rental management software',
  'airbnb property management tips',
];

/**
 * Spanish templates: DataForSEO's keyword_ideas index is sparse for Mexican
 * Spanish niche terms, so we explicitly enumerate the templates and use the
 * search_volume endpoint to enrich them with real Google Ads data.
 *
 * Template patterns follow the Research Agent's known keyword families.
 */
/**
 * Spanish: only monitor existing markets — no new city expansion.
 * Geo pages are frozen (only Toluca and Metepec are live).
 */
const ES_CITIES_EXISTING = [
  'toluca', 'metepec',
];

function buildSpanishKeywords() {
  const allCities = [...ES_CITIES_EXISTING];
  const keywords = [];

  for (const city of allCities) {
    keywords.push(
      `administración airbnb ${city}`,
      `administración renta vacacional ${city}`,
      `coanfitrión airbnb ${city}`,
      `es rentable airbnb en ${city}`,
      `cuánto se gana con airbnb en ${city}`,
    );
  }

  // Evergreen non-geo Spanish topics
  keywords.push(
    'administración de renta vacacional',
    'cómo poner mi casa en airbnb',
    'cuánto cobra airbnb de comisión',
    'invertir en airbnb mexico',
    'como rentar propiedad en airbnb',
    'airbnb superanfitrión requisitos',
    'guia para ser anfitrion airbnb',
  );

  // Product-focused Spanish keywords (SaaS pivot)
  keywords.push(
    'asistente ai para airbnb',
    'guía digital para huéspedes airbnb',
    'automatizar mensajes airbnb',
    'página de reservas directas airbnb',
    'chatbot para airbnb',
    'manual digital para huéspedes',
  );

  return keywords;
}

// ─── Relevance filter (English) ───────────────────────────────────────────────

const EN_BLOCKLIST = [
  // Legal / regulatory (BnBuddy doesn't cover legal topics)
  /\b(ordinances?|permits?|licenses?|zoning|regulations?|laws?|codes?|compliance|tax(?:es|ation)?|agreement|contract|lease|attorney|lawyer)\b/i,
  // Insurance (not a service BnBuddy sells)
  /\binsurance\b/i,
  // Competitor brand names
  /\b(vacasa|evolve|turnkey|awning|casago|keyrenter|nomad|guesty|lodgify|hostaway|hospitable)\b/i,
  // Jobs / employment
  /\bjobs?\b/i,
  // Unrelated verticals
  /\b(credit|loan|mortgage|finance|accounting|bookkeeping)\b/i,
  // US/international geography — states, cities, and vacation destinations
  // BnBuddy is a global SaaS product, not a local service tied to any region
  /\b(nyc|new york|florida|california|texas|hawaii|arizona|colorado|tennessee|georgia|chicago|los angeles|san diego|miami|austin|nashville|denver|scottsdale|orlando|seattle|portland|phoenix|san francisco|las vegas|savannah|charleston|gatlinburg|destin|myrtle beach|key west|cape cod|lake tahoe|aspen|park city|sedona|palm springs|maui|big bear|joshua tree|tahoe|outer banks|hilton head|smoky mountains|gulf shores|ocean city|jersey shore|poconos|catskills|napa valley|san antonio|virginia beach|atlantic city|daytona|clearwater|sarasota|fort lauderdale|breckenridge|steamboat|vail|whistler|cancun|cabo|tulum|punta cana|bahamas|bermuda|aruba|bali|ibiza|mykonos|santorini|paris|london|rome|barcelona|dubai|tokyo|puerto rico|houston|atlanta|dallas|philadelphia|washington dc|toronto|montreal|vancouver|amsterdam|london)\b/i,
  // Geo-intent patterns: "[thing] near me", "airbnb in [place]", "[place] vacation rentals"
  /\bnear me\b/i,
  /\b(airbnb|vrbo|vacation rentals?)\s+(in|near|at)\s+/i,
  // Student / consumer discounts (not a B2B SaaS topic)
  /\bstudent\b/i,
  // Cancellation / policy questions (customer support, not content)
  /\b(cancellation|refund)\s+policy\b/i,
  // Regional directional geo terms ("southern vacation rentals", "coastal cabins", etc.)
  /^(southern|northern|eastern|western|coastal|mountain|lake|beach|ski|island|tropical)\b/i,
  // Definitional queries — Wikipedia-level, zero commercial intent for SaaS
  /^what\s+is\s+/i,
];

function isEnRelevant(keyword) {
  const k = keyword.toLowerCase();
  if (!/(airbnb|vacation rental|short.?term rental|vrbo|property management|host|rental management)/.test(k)) return false;
  for (const pattern of EN_BLOCKLIST) {
    if (pattern.test(k)) return false;
  }
  return true;
}

// ─── Brand relevance scoring ──────────────────────────────────────────────────
// Maps keywords to BnBuddy's 5 service pillars (from bnbuddy.com landing page).
// Each matching pillar adds 1 point. Max score = 3 (capped).
// Keywords scoring 0 are still included but deprioritized.

const BRAND_PILLARS = [
  // Pillar 1: AI Guest Assistant — 24/7 AI guest comms, auto-responses
  { name: 'ai-assistant', pattern: /\b(chatbot|ai.?(guest|host|assistant|messaging|reply|response|chatbot|automation|auto.?reply|automat)|guest.?(communication|messaging|support|response|service)|customer.?service|host.?support|auto.?respond|automated.?message|smart.?host)/i },
  // Pillar 2: Digital Guidebook — QR property guides, welcome books
  { name: 'guidebook', pattern: /\b(guidebook|welcome.?book|guest.?(guide|manual|book)|check.?in.?(instruction|guide)|house.?rules|qr.?code|digital.?guide|property.?guide)/i },
  // Pillar 3: Direct Booking — booking portal, skip OTA fees
  { name: 'direct-booking', pattern: /\b(direct.?booking|book.?direct|own.?website|booking.?portal|skip.?airbnb|airbnb.?fee|ota.?fee|vacation.?rental.?website|rental.?website.?builder|property.?showcase)/i },
  // Pillar 4: Co-hosting — listing optimization, calendar management
  { name: 'cohosting', pattern: /\b(co.?host|cohost|co.?hosting|listing.?optimiz|calendar.?manag|airbnb.?manag|superhost|super.?host|occupancy|response.?rate|airbnb.?host(?:ing)?|become.{0,10}host)/i },
  // Pillar 5: Property Management — full-service, cleaning, pricing, photography
  { name: 'management', pattern: /\b(property.?manag|rental.?manag|vacation.?rental.?manag|cleaning|turnover|dynamic.?pricing|professional.?photo|airbnb.?photo|revenue.?manag|passive.?income|hands.?off|autopilot)/i },
];

function brandRelevance(keyword) {
  const k = keyword.toLowerCase();
  let score = 0;
  const matched = [];
  for (const pillar of BRAND_PILLARS) {
    if (pillar.pattern.test(k)) {
      score++;
      matched.push(pillar.name);
    }
  }
  return { score: Math.min(score, 3), pillars: matched };
}

// ─── Intent classification ─────────────────────────────────────────────────────

function classifyIntent(keyword) {
  const k = keyword.toLowerCase();
  if (/\b(contratar|precio|costo|cuánto cobra|coanfitrión|administrador airbnb|management company|hire|property manager for|services|servicio de administraci)/i.test(k)) return 'service';
  if (/\b(software|app|tool|platform|system|comparison|vs |review|best.*software|mejor.*app|pms|channel manager)\b/i.test(k)) return 'commercial';
  return 'informational';
}

// ─── Priority score ───────────────────────────────────────────────────────────
// Base: (volume / 10) × (1 - difficulty / 100)
// Brand boost: ×1.5 per brand_relevance point (max ×2.5 at score 3)
// This ensures on-brand keywords consistently outrank generic STR topics.

function priorityScore(volume, difficulty, brandScore = 0) {
  const d = difficulty !== null && difficulty !== undefined ? difficulty : 40;
  const base = (volume / 10) * (1 - d / 100);
  const multiplier = 1 + (brandScore * 0.5); // 0→1x, 1→1.5x, 2→2x, 3→2.5x
  return Math.round((base * multiplier) * 100) / 100;
}

// ─── Load existing queue ───────────────────────────────────────────────────────

function loadExistingQueue() {
  if (!fs.existsSync(QUEUE_FILE)) return [];
  try {
    const { keywords } = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
    return Array.isArray(keywords) ? keywords : [];
  } catch { return []; }
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  console.log(`\n🔑  DataForSEO Keyword Pull — ${today}\n`);

  const creds = loadCreds();
  const authHeader = 'Basic ' + Buffer.from(`${creds.DATAFORSEO_LOGIN}:${creds.DATAFORSEO_PASSWORD}`).toString('base64');

  // ── Pass 1: English keyword ideas ──────────────────────────────────────────
  console.log('📡  Pass 1 — English keyword ideas (US market)...');
  const enIdeasRes = await apiPost(authHeader, '/v3/dataforseo_labs/google/keyword_ideas/live', [
    {
      keywords: EN_SEEDS,
      location_code: 2840,   // United States
      language_code: 'en',
      limit: 100,
    },
  ]);

  if (enIdeasRes.tasks?.[0]?.status_code !== 20000) {
    console.error('❌  keyword_ideas EN failed:', enIdeasRes.tasks?.[0]?.status_message);
    process.exit(1);
  }

  const enRawItems = enIdeasRes.tasks[0].result?.[0]?.items ?? [];
  const enFiltered = enRawItems.filter(i => isEnRelevant(i.keyword));
  console.log(`    ${enRawItems.length} ideas returned → ${enFiltered.length} after relevance filter`);

  // ── Pass 2: Spanish keyword volume enrichment ───────────────────────────────
  console.log('📡  Pass 2 — Spanish keyword volume (Mexico market)...');
  const esKeywords = buildSpanishKeywords();

  const esVolumeRes = await apiPost(authHeader, '/v3/keywords_data/google_ads/search_volume/live', [
    {
      keywords: esKeywords,
      location_code: 2484,   // Mexico
      language_code: 'es',
    },
  ]);

  if (esVolumeRes.tasks?.[0]?.status_code !== 20000) {
    console.error('❌  search_volume ES failed:', esVolumeRes.tasks?.[0]?.status_message);
    process.exit(1);
  }

  const esRawItems = esVolumeRes.tasks[0].result ?? [];
  console.log(`    ${esRawItems.length} Spanish keywords enriched with real volume`);

  // ── Save raw responses ──────────────────────────────────────────────────────
  const rawPayload = {
    pulledAt: new Date().toISOString(),
    en_keyword_ideas: enIdeasRes,
    es_search_volume: esVolumeRes,
  };
  const rawFile = path.join(DATAFORSEO_DIR, `raw-${today}.json`);
  fs.writeFileSync(rawFile, JSON.stringify(rawPayload, null, 2));
  console.log(`\n💾  Raw API responses saved → data/dataforseo/raw-${today}.json`);

  // ── Merge and normalize ─────────────────────────────────────────────────────
  const existingQueue  = loadExistingQueue();
  const existingKeywords = new Set(existingQueue.map(k => k.keyword.toLowerCase()));
  // Never re-add keywords that have already been completed through the pipeline
  const completedKeywords = new Set(
    existingQueue.filter(k => k.status === 'completed').map(k => k.keyword.toLowerCase())
  );

  const newItems = [];
  let scheduledOffset = existingQueue.filter(k => k.status === 'pending').length;

  // Process English items
  for (const item of enFiltered) {
    if (existingKeywords.has(item.keyword.toLowerCase())) continue;
    if (completedKeywords.has(item.keyword.toLowerCase())) continue; // already ran through pipeline

    const vol  = item.keyword_info?.search_volume ?? 0;
    const diff = item.keyword_properties?.keyword_difficulty ?? null;
    if (vol === 0) continue;

    const scheduledDate = new Date();
    scheduledDate.setDate(scheduledDate.getDate() + scheduledOffset);
    scheduledOffset++;

    const brand = brandRelevance(item.keyword);

    newItems.push({
      id: crypto.randomUUID(),
      keyword: item.keyword,
      language: 'en',
      location: 'United States',
      search_volume: vol,
      difficulty: diff,
      competition_level: item.keyword_info?.competition_level ?? null,
      cpc: item.keyword_info?.cpc ?? null,
      trend_quarterly: item.keyword_info?.search_volume_trend?.quarterly ?? null,
      seasonal_monthly: (item.keyword_info?.monthly_searches ?? []).slice(0, 12).map(m => ({
        year: m.year, month: m.month, volume: m.search_volume,
      })),
      intent: classifyIntent(item.keyword),
      brand_relevance: brand.score,
      brand_pillars: brand.pillars,
      priority_score: priorityScore(vol, diff, brand.score),
      status: 'pending',
      created_at: new Date().toISOString(),
      local_scheduled_date: scheduledDate.toISOString().split('T')[0],
    });
  }

  // Process Spanish items
  for (const item of esRawItems) {
    if (existingKeywords.has(item.keyword.toLowerCase())) continue;
    if (completedKeywords.has(item.keyword.toLowerCase())) continue; // already ran through pipeline

    const vol = item.search_volume ?? 0;
    // Note: search_volume endpoint doesn't return keyword_difficulty
    // We'll null it and let the Research Agent treat it as unknown
    if (vol === 0) continue;

    const scheduledDate = new Date();
    scheduledDate.setDate(scheduledDate.getDate() + scheduledOffset);
    scheduledOffset++;

    const brand = brandRelevance(item.keyword);

    newItems.push({
      id: crypto.randomUUID(),
      keyword: item.keyword,
      language: 'es',
      location: 'Mexico',
      search_volume: vol,
      difficulty: null,         // not available from search_volume endpoint
      competition_level: item.competition_level ?? null,
      cpc: item.cpc ?? null,
      trend_quarterly: null,    // not available from search_volume endpoint
      seasonal_monthly: (item.monthly_searches ?? []).slice(0, 12).map(m => ({
        year: m.year, month: m.month, volume: m.search_volume,
      })),
      intent: classifyIntent(item.keyword),
      brand_relevance: brand.score,
      brand_pillars: brand.pillars,
      priority_score: priorityScore(vol, null, brand.score),
      status: 'pending',
      created_at: new Date().toISOString(),
      local_scheduled_date: scheduledDate.toISOString().split('T')[0],
    });
  }

  // Sort new items by priority score descending
  newItems.sort((a, b) => b.priority_score - a.priority_score);

  // Merge: existing (preserving status) + new
  const merged = [...existingQueue, ...newItems];

  const queuePayload = {
    generatedAt: new Date().toISOString(),
    pulledDate: today,
    summary: {
      total: merged.length,
      pending: merged.filter(k => k.status === 'pending').length,
      in_progress: merged.filter(k => k.status === 'in-progress').length,
      completed: merged.filter(k => k.status === 'completed').length,
      new_this_run: newItems.length,
      en_keywords: merged.filter(k => k.language === 'en').length,
      es_keywords: merged.filter(k => k.language === 'es').length,
      brand_aligned: merged.filter(k => (k.brand_relevance ?? 0) > 0).length,
      brand_unaligned: merged.filter(k => (k.brand_relevance ?? 0) === 0).length,
    },
    keywords: merged,
  };

  fs.writeFileSync(QUEUE_FILE, JSON.stringify(queuePayload, null, 2));

  // ── Console summary ─────────────────────────────────────────────────────────
  console.log('\n📊  Keyword queue written → data/dataforseo/keyword-queue.json');
  console.log(`\n    Total in queue : ${queuePayload.summary.total}`);
  console.log(`    New this run   : ${queuePayload.summary.new_this_run}`);
  console.log(`    Pending        : ${queuePayload.summary.pending}`);
  console.log(`    EN keywords    : ${queuePayload.summary.en_keywords}`);
  console.log(`    ES keywords    : ${queuePayload.summary.es_keywords}`);
  console.log(`    🎯 Brand-aligned: ${queuePayload.summary.brand_aligned}`);
  console.log(`    ⚪ Generic       : ${queuePayload.summary.brand_unaligned}`);

  // Top 10 by priority
  const top10 = newItems.slice(0, 10);
  if (top10.length) {
    console.log('\n🏆  Top 10 new keywords by priority score:\n');
    console.log('  Keyword'.padEnd(48) + 'Vol'.padEnd(7) + 'Diff'.padEnd(6) + 'Brand'.padEnd(7) + 'Score'.padEnd(10) + 'Lang');
    console.log('  ' + '-'.repeat(85));
    top10.forEach(k => {
      const brandLabel = (k.brand_relevance ?? 0) > 0 ? `🎯 ${k.brand_relevance}` : '  0';
      console.log(
        '  ' + k.keyword.substring(0, 45).padEnd(48) +
        String(k.search_volume).padEnd(7) +
        String(k.difficulty ?? '—').padEnd(6) +
        brandLabel.padEnd(7) +
        String(k.priority_score).padEnd(10) +
        k.language.toUpperCase(),
      );
    });
  }

  // Low-hanging fruit
  const quickWins = newItems.filter(k => k.search_volume >= 50 && (k.difficulty === null || k.difficulty < 20));
  if (quickWins.length) {
    console.log(`\n🍑  Quick wins (vol ≥ 50, diff < 20): ${quickWins.length} keywords`);
    quickWins.slice(0, 5).forEach(k => {
      console.log(`    - ${k.keyword} (vol:${k.search_volume} diff:${k.difficulty ?? 'unknown'})`);
    });
  }

  // Trending
  const trending = newItems.filter(k => k.trend_quarterly !== null && k.trend_quarterly > 20);
  if (trending.length) {
    console.log(`\n📈  Trending up >20% QoQ: ${trending.length} keywords`);
    trending.slice(0, 5).forEach(k => {
      console.log(`    - ${k.keyword} (+${k.trend_quarterly}% | vol:${k.search_volume})`);
    });
  }

  console.log('\n✅  Done.\n');
}

main().catch(err => {
  console.error('\n❌  Fatal error:', err.message);
  process.exit(1);
});
