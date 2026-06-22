# Image Pipeline Plan — Multi-Source (Wikimedia Commons + Unsplash)

**Created:** 2026-03-20
**Author:** Slash ⚡ (with Alberto)
**Status:** Draft
**Branch:** `seo-content-pipeline-implementation`

---

## 1. Goal

Add 3 relevant, high-quality images per geo page. Images are fetched from **Wikimedia Commons** (primary) with **Unsplash** as a premium fallback. Downloaded to the repo as optimized WebP, injected into HTML by the existing `build-geo-pages.js`. Zero manual effort per city.

**Why Wikimedia Commons first:** Mexican small towns (Metepec, Malinalco, etc.) have excellent coverage on Wikimedia thanks to Wikipedia editors, but near-zero coverage on Unsplash. Bigger tourist cities (Valle de Bravo, Querétaro) have good coverage on both.

---

## 2. How It Fits in the Pipeline

```
Content Agent ──writes──▶ content/[slug].md (with imageHints in frontmatter)
                               │
Image Script   ──reads────────┘
(fetch-geo-images.js)
               ──queries──▶ 1. Wikimedia Commons API (primary)
               ──queries──▶ 2. Unsplash API (fallback for lifestyle/premium shots)
               ──downloads─▶ pipelines/seo-content-pipeline/images/[slug]/
               ──writes────▶ pipelines/seo-content-pipeline/images/[slug]/manifest.json
                               │
Build Script   ──reads────────┘
(build-geo-pages.js — already exists)
               ──reads────▶ manifest.json for each slug
               ──copies───▶ .webp files into public/es/.../images/
               ──injects──▶ <figure> tags into HTML at section boundaries
               ──writes───▶ public/es/administracion-renta-vacacional-[slug]/index.html
```

**When it runs:** After content is merged, before `build-geo-pages.js --force`. Separate script so Alberto can review fetched images before they go into the build.

**Existing scripts this integrates with:**
- `scripts/build-geo-pages.js` — md→HTML builder (reads frontmatter, uses `page-template.html`)
- `scripts/build-hub-cities.js` — hub city index builder
- `scripts/update-sitemap-geo.js` — sitemap updater

---

## 3. Image Sources

### 3a. Wikimedia Commons API (Primary)

- **Endpoint:** `GET https://commons.wikimedia.org/w/api.php`
- **Auth:** None required
- **Rate limit:** No formal limit (be polite — max ~200 req/s, we'll do ~5 per city)
- **License:** Varies per image — CC BY-SA 4.0, CC BY 4.0, CC0/Public Domain
- **Cost:** Free

**Query parameters:**
```
?action=query
&generator=search
&gsrsearch=[City] Estado de México
&gsrnamespace=6              (files only)
&gsrlimit=20                 (results per query)
&prop=imageinfo
&iiprop=url|size|mime|extmetadata
&iiurlwidth=1200             (pre-resized thumbnail)
&format=json
```

**What comes back:**
- Pre-resized thumbnail URL (1200px wide) — no `sharp` needed
- Original dimensions
- Author name (from `extmetadata.Artist`)
- License name (from `extmetadata.LicenseShortName`)
- Description text (from `extmetadata.ImageDescription`)
- GPS coordinates if available

**Filtering:**
- `mime` must be `image/jpeg` or `image/png`
- Original width ≥ 1200
- Landscape aspect ratio (width/height > 1.2)
- License must be one of: `CC BY-SA 4.0`, `CC BY-SA 3.0`, `CC BY 4.0`, `CC BY 3.0`, `CC0`, `Public domain`
- Skip SVGs, diagrams, logos, coat of arms (filter by filename patterns)

**Attribution (required by CC BY-SA):**
```html
<figcaption>
  Foto: Juan Pérez / <a href="https://commons.wikimedia.org/wiki/File:Example.jpg">Wikimedia Commons</a> (CC BY-SA 4.0)
</figcaption>
```

### 3b. Unsplash API (Fallback / Lifestyle shots)

- **Endpoint:** `GET https://api.unsplash.com/search/photos`
- **Auth:** `Authorization: Client-ID <ACCESS_KEY>` header
- **Rate limit:** 50 req/hr (demo), 5,000 req/hr (production)
- **License:** Free, link to photographer + Unsplash
- **Cost:** Free
- **Registration:** <https://unsplash.com/oauth/applications/new>

**When used:**
- As fallback when Wikimedia has < 3 suitable results for a city
- As primary source for the `lifestyle` slot (Airbnb interiors — Wikimedia won't have these)
- For cities with strong Unsplash coverage (Valle de Bravo, Querétaro, San Miguel de Allende)

**Attribution:**
```html
<figcaption>
  Foto: <a href="https://unsplash.com/@photographer">Photographer</a> /
  <a href="https://unsplash.com">Unsplash</a>
</figcaption>
```

### Source Comparison

| | Wikimedia Commons | Unsplash |
|---|---|---|
| API key | None | Required |
| Rate limit | ~200 req/s (polite) | 50/hr (demo) |
| Mexican small town coverage | Excellent | Poor |
| Image quality | Mixed (some excellent, some amateur) | Curated, consistently high |
| Lifestyle / interior shots | Almost none | Good |
| License | CC BY-SA / CC BY / CC0 (varies) | Custom (free, link-back) |
| Attribution strictness | Must show author + license | Must link photographer + Unsplash |
| Pre-resized thumbnails | Yes (via `iiurlwidth`) | Yes (via URL params) |

---

## 4. Search Strategy Per Slot

Each city gets **3 image slots**:

### `hero` — City overview (Wikimedia primary)
| Priority | Source | Search query |
|----------|--------|-------------|
| 1 | Wikimedia | `"[City] Estado de México panorámica"` |
| 2 | Wikimedia | `"[City] pueblo mágico"` |
| 3 | Wikimedia | `"[City] México"` |
| 4 | Unsplash | `"[City] Mexico"` |
| 5 | Unsplash | `"pueblo mágico Mexico landscape"` |

### `landmark` — Key attraction (Wikimedia primary)
| Priority | Source | Search query |
|----------|--------|-------------|
| 1 | Wikimedia | `"[Landmark from imageHints]"` |
| 2 | Wikimedia | `"[City] iglesia"` or `"[City] archaeological"` |
| 3 | Unsplash | `"[City] architecture"` |

### `lifestyle` — Vacation rental feel (Unsplash primary)
| Priority | Source | Search query |
|----------|--------|-------------|
| 1 | Unsplash | `"vacation rental Mexico interior"` |
| 2 | Unsplash | `"airbnb interior Mexico"` |
| 3 | Unsplash | `"cozy apartment interior"` |
| 4 | Wikimedia | `"[City] hotel"` or `"[City] casa"` |

**Selection logic:** For each slot, try queries in order. Pick the first result where:
- Width ≥ 1200 (original)
- Landscape orientation (aspect ratio > 1.2)
- Not already used by another city (dedup via global manifest scan)
- Not a diagram, logo, or coat of arms (filename filter)

---

## 5. Content Agent Changes

Add optional flat `imageHint_*` keys to markdown frontmatter:

```yaml
---
type: geo-page
city: "Metepec"
slug: "metepec"
# ... existing fields ...
imageHint_hero: "Metepec Pueblo Mágico cerro de los magueyes"
imageHint_landmark: "Iglesia del Calvario Metepec"
imageHint_lifestyle: "casa colonial Metepec interior"
---
```

**Why flat keys:** The existing `parseFrontmatter()` in `build-geo-pages.js` is a simple line-by-line YAML parser that doesn't handle nested objects. Flat keys work with zero parser changes.

Update `content-agent.md` to include these in the output format.

**If hints are missing** (older content files), the image script falls back to generic search strategy from section 4.

---

## 6. Image Script — `scripts/fetch-geo-images.js`

```
Usage: node scripts/fetch-geo-images.js [--slug metepec] [--all] [--dry-run]

  --slug <name>   Process a single city
  --all           Process all cities in content/
  --dry-run       Show what would be fetched, don't download
  --force         Re-fetch even if manifest exists
```

### What it does:

1. Read each `content/[slug].md` → parse frontmatter (city name, imageHint_*)
2. Check if `images/[slug]/manifest.json` exists → skip unless `--force`
3. For each image slot (hero, landmark, lifestyle):
   a. Build search query from imageHints or fallback
   b. Try primary source first (Wikimedia for hero/landmark, Unsplash for lifestyle)
   c. If no suitable result → try fallback source
   d. Download the pre-resized image (1200px wide)
   e. If from Wikimedia: already resized by API, just save. Convert to WebP via `sharp` if JPEG/PNG.
   f. If from Unsplash: download `regular` size, convert to WebP via `sharp`
   g. Save as `images/[slug]/hero.webp`, `landmark.webp`, `lifestyle.webp`
4. Write `images/[slug]/manifest.json`:

```json
{
  "slug": "metepec",
  "fetchedAt": "2026-03-20T01:30:00Z",
  "images": {
    "hero": {
      "source": "wikimedia",
      "fileTitle": "File:Cerro_de_los_Magueyes_Metepec.jpg",
      "pageUrl": "https://commons.wikimedia.org/wiki/File:Cerro_de_los_Magueyes_Metepec.jpg",
      "query": "Metepec cerro de los magueyes",
      "author": "Juan Pérez",
      "license": "CC BY-SA 4.0",
      "originalWidth": 4000,
      "originalHeight": 2667,
      "localFile": "hero.webp",
      "alt": "Vista panorámica de Metepec desde el Cerro de los Magueyes"
    },
    "landmark": {
      "source": "wikimedia",
      "fileTitle": "File:Iglesia_Calvario_Metepec.jpg",
      "pageUrl": "https://commons.wikimedia.org/wiki/File:Iglesia_Calvario_Metepec.jpg",
      "query": "Iglesia del Calvario Metepec",
      "author": "María López",
      "license": "CC BY-SA 3.0",
      "originalWidth": 3264,
      "originalHeight": 2448,
      "localFile": "landmark.webp",
      "alt": "Iglesia del Calvario en el Cerro de los Magueyes, Metepec"
    },
    "lifestyle": {
      "source": "unsplash",
      "unsplashId": "xyz789",
      "pageUrl": "https://unsplash.com/photos/xyz789",
      "query": "vacation rental Mexico interior",
      "author": "Carlos García",
      "authorUrl": "https://unsplash.com/@carlosgarcia",
      "license": "Unsplash",
      "originalWidth": 5000,
      "originalHeight": 3333,
      "localFile": "lifestyle.webp",
      "alt": "Interior de propiedad de renta vacacional en México"
    }
  }
}
```

### Dependencies
- `sharp` — image conversion to WebP (needed for both sources)
- Native `fetch` (Node 18+) — HTTP requests
- No API keys needed for Wikimedia; `UNSPLASH_ACCESS_KEY` env var for Unsplash fallback

---

## 7. Build Script Changes — `scripts/build-geo-pages.js`

The existing build script already handles:
- Frontmatter parsing (`parseFrontmatter`)
- Markdown→HTML conversion (`markdownToHtml`) including `![alt](src)` image syntax
- Template variable replacement (`{{CONTENT_HTML}}`, `{{OG_IMAGE}}`, etc.)

**Changes needed:**

1. **After generating `contentHtml`**, read `images/[slug]/manifest.json` if it exists
2. **Inject `<figure>` blocks** at predefined insertion points in the HTML:

| Slot | Injection point (in generated HTML) |
|------|-------------------------------------|
| `hero` | After the first `</p>` |
| `landmark` | After `<h2>` containing "Lugares populares" |
| `lifestyle` | After `<h2>` containing "Cómo te ayuda" |

3. **Build attribution** based on `source` field:
   - `wikimedia` → `Foto: [Author] / Wikimedia Commons ([License])`
   - `unsplash` → `Foto: [Author] / Unsplash`
   - `manual` → no attribution caption

4. **Copy image files** from `images/[slug]/*.webp` → `public/es/administracion-renta-vacacional-[slug]/images/`

5. **Set `{{OG_IMAGE}}`** to the hero image URL if available

**HTML output per image** (uses existing `wp-block-image` styles):

```html
<figure class="wp-block-image size-large geo-img geo-img--hero">
  <img decoding="async" src="images/hero.webp"
       alt="Vista panorámica de Metepec desde el Cerro de los Magueyes"
       width="1200" height="800"
       loading="lazy" class="wp-image lazyload">
  <figcaption>Foto: Juan Pérez /
    <a href="https://commons.wikimedia.org/wiki/File:Example.jpg">Wikimedia Commons</a>
    (CC BY-SA 4.0)</figcaption>
</figure>
```

**If no manifest exists** → build proceeds as-is (graceful degradation).

---

## 8. Alt Text Generation

The image script generates Spanish alt text automatically:

- **Hero:** `"Vista panorámica de [City], [State/descriptor]"`
- **Landmark:** `"[Landmark name] en [City], Estado de México"`
- **Lifestyle:** `"Interior de propiedad de renta vacacional en México"`

If Wikimedia provides a description in `extmetadata.ImageDescription`, use that as a base (clean HTML tags, truncate to ~125 chars).

Stored in manifest. Alberto can edit any alt text before building.

---

## 9. File Structure (new files in bold)

```
pipelines/seo-content-pipeline/
├── content/
│   ├── valle-de-bravo.md        (updated: +imageHint_* in frontmatter)
│   ├── malinalco.md             (updated: +imageHint_* in frontmatter)
│   └── metepec.md               (updated: +imageHint_* in frontmatter)
├── images/                      ← NEW directory
│   ├── valle-de-bravo/
│   │   ├── hero.webp
│   │   ├── landmark.webp
│   │   ├── lifestyle.webp
│   │   └── manifest.json
│   ├── malinalco/
│   │   └── ...
│   └── metepec/
│       └── ...

scripts/
├── fetch-geo-images.js          ← NEW script
├── build-geo-pages.js           (updated: reads manifests, injects <figure>)
├── build-hub-cities.js          (no changes)
├── update-sitemap-geo.js        (no changes)
```

---

## 10. Manual Override

Alberto can replace any auto-fetched image:
1. Drop a custom `.webp` file in `images/[slug]/` (e.g. `hero.webp`)
2. Update `manifest.json` → set `"source": "manual"`, adjust `alt`, clear license fields
3. Build script sees `"source": "manual"` → skips attribution caption

This lets BnBuddy's own property photos override stock images for cities where you have real shoots.

---

## 11. Build & Deploy Flow (updated)

```bash
cd bnbuddy-landing
git checkout main && git pull

# Step 1: Fetch images for any new/updated cities
node scripts/fetch-geo-images.js --all
# (Wikimedia needs no key; set UNSPLASH_ACCESS_KEY in .env for lifestyle fallback)

# Step 2: Review downloaded images in pipelines/seo-content-pipeline/images/
# (swap any you don't like, or add manual overrides)

# Step 3: Build geo pages (now with image injection)
node scripts/build-geo-pages.js --force

# Step 4: Existing post-processing
node scripts/update-sitemap-geo.js
npm run postprocess

# Step 5: Deploy
firebase deploy
```

---

## 12. Implementation Steps

| # | Task | Effort | Depends on |
|---|------|--------|------------|
| 1 | Write `scripts/fetch-geo-images.js` (Wikimedia + Unsplash) | 3-4 hrs | — |
| 2 | Test with `--slug metepec --dry-run` (Wikimedia) | 15 min | #1 |
| 3 | Register Unsplash dev account + get API key | 10 min | — |
| 4 | Add `UNSPLASH_ACCESS_KEY` to `.env` | 2 min | #3 |
| 5 | Test with `--slug valle-de-bravo --dry-run` (Unsplash) | 15 min | #1, #4 |
| 6 | Run `--all`, review downloaded images for all 3 cities | 20 min | #5 |
| 7 | Add `imageHint_*` to existing content files (3 files) | 20 min | — |
| 8 | Update `content-agent.md` to output `imageHint_*` keys | 10 min | — |
| 9 | Update `build-geo-pages.js` to read manifests + inject `<figure>` | 1-2 hrs | #6 |
| 10 | End-to-end test: fetch → build → verify HTML | 30 min | #9 |
| 11 | Apply for Unsplash production rate limit (optional, needs screenshots) | 15 min | #10 |

**Total estimated effort:** ~6-7 hours

---

## 13. Costs

- **Wikimedia Commons API:** Free, no key, no rate limit registration
- **Unsplash API:** Free (50 req/hr demo is plenty — we only need ~5 per city for lifestyle)
- **Storage:** ~100-200 KB per WebP × 3 images × N cities = negligible on Firebase
- **Build time:** `sharp` conversion adds ~1-2s per image

---

## 14. SEO Impact

- **Core Web Vitals:** WebP + lazy loading + explicit width/height = no CLS, fast LCP
- **Image SEO:** Descriptive Spanish alt text, served from same domain (not hotlinked CDN)
- **Uniqueness:** Each page gets location-specific images from Wikimedia → strong unique signals
- **Authenticity:** Real photos of actual landmarks > generic stock photography
- **Rich results:** Images can appear in Google Image Search → additional traffic source
- **OG Image:** Hero image becomes the social sharing preview
- **Attribution:** Proper CC + Unsplash credits = no legal risk
- **Existing styles:** Uses `wp-block-image` classes already in the template

---

## 15. Gotchas & Compatibility Notes

- **`build-geo-pages.js` frontmatter parser** is simple line-by-line — use flat keys (`imageHint_hero`) not nested YAML
- **Wikimedia image quality varies** — the script should prefer images with higher resolution and landscape orientation. Manual review after first fetch is recommended.
- **Wikimedia author field** can contain HTML — strip tags before storing in manifest
- **CC BY-SA propagation** — displaying a CC BY-SA image on your page does NOT make your page CC BY-SA. Attribution + license notice in the figcaption is sufficient.
- **Content Agent branch** is `seo-agent/content` — image hints go there. Script + build changes go on `seo-content-pipeline-implementation`.
- **`hub-cities.json`** can be used to discover all cities without scanning content files.
- **Unsplash demo limit (50/hr)** is fine for our scale — we only need ~5 Unsplash queries per city (lifestyle slot + fallbacks). 50/hr covers 10 cities per run.

---

## 16. Future Enhancements

- **OG Image:** Use hero image as `ogImage` in frontmatter → better social sharing
- **Structured data:** Add `ImageObject` schema to each figure
- **Own photography:** Replace fetched images with BnBuddy photos via manual override
- **AI fallback:** If both Wikimedia + Unsplash have zero results, use image generation as last resort
- **Thumbnails:** Auto-generate smaller versions for blog cards / interlinking widgets
- **Pexels API:** Add as a third source if needed (free, API key required, good Mexico coverage)
