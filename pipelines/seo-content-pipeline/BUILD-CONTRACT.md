# Build Contract — `page-template.html`

**Created:** 2026-08-18
**Status:** ⚠️ **Action required in `build-geo-pages.js` before the next build**

`page-template.html` gained three new placeholders and changed the way the page
URL is derived. `build-geo-pages.js` lives outside this repo, so it must be
updated to match or the generated HTML will contain literal `{{...}}` strings.

---

## 1. New / changed placeholders

| Placeholder | Source | Default when absent |
|---|---|---|
| `{{H1}}` | frontmatter `h1` | `` `Administración de Renta Vacacional en ${city}` `` |
| `{{URL_PATH}}` | frontmatter `urlPath` | `` `administracion-renta-vacacional-${slug}` `` |
| `{{FAQ_SCHEMA}}` | generated from the `## Preguntas Frecuentes…` section | `''` (empty string — **not** the literal placeholder) |
| `{{OG_IMAGE}}` | frontmatter `ogImage` | `DEFAULT_OG_IMAGE` constant (see §4) |

`{{CANONICAL_URL}}`, `{{OG_URL}}`, the oEmbed links and the **output directory**
must all now be derived from `URL_PATH`, not from `slug`:

```
public/es/${urlPath}/index.html
https://bnbuddy.com/es/${urlPath}/
```

### Why

`content/cdmx.md` targets the keyword *"administración de Airbnb en CDMX"*. Under
the old template the H1 was hard-coded to `Administración de Renta Vacacional en
{{CITY_NAME}}` and the URL to `administracion-renta-vacacional-${slug}`, so the
title, the H1 and the URL each advertised a different phrase. `h1` and `urlPath`
let a page opt out of the default naming without affecting the other geo pages,
which have neither field set and therefore render exactly as before.

---

## 2. Reference implementation

```js
const DEFAULT_OG_IMAGE =
  'https://bnbuddy.com/wp-content/uploads/2026/08/bnbuddy-og-default.jpg';

function resolveH1(fm) {
  return fm.h1 || `Administración de Renta Vacacional en ${fm.city}`;
}

function resolveUrlPath(fm) {
  return fm.urlPath || `administracion-renta-vacacional-${fm.slug}`;
}

function resolveOgImage(fm) {
  return fm.ogImage && fm.ogImage.trim() ? fm.ogImage : DEFAULT_OG_IMAGE;
}
```

### FAQ schema generator

The FAQ section of every geo page uses the same shape: a bold question line
followed by the answer on the next line(s), separated by blank lines.

```js
function buildFaqSchema(markdownBody) {
  const section = markdownBody.split(/^## .*Preguntas Frecuentes.*$/mi)[1];
  if (!section) return '';

  // stop at the next H2 or the closing --- separator
  const body = section.split(/^(## |---\s*$)/m)[0];

  const faqs = [];
  const re = /^\*\*(.+?)\*\*\s*\n([\s\S]*?)(?=\n\*\*|\n---|\s*$)/gm;
  let m;
  while ((m = re.exec(body)) !== null) {
    const question = m[1].trim();
    const answer = m[2]
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // strip markdown links
      .replace(/\*\*/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (question && answer) faqs.push({ question, answer });
  }
  if (!faqs.length) return '';

  const json = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(f => ({
      '@type': 'Question',
      name: f.question,
      acceptedAnswer: { '@type': 'Answer', text: f.answer },
    })),
  };

  return `<script type="application/ld+json">\n${JSON.stringify(json, null, 2)}\n</script>`;
}
```

Escape `<`, `>` and `&` in the answer text before embedding, per the existing
JSON-LD handling in the build script.

---

## 3. Static schema already added to the template

A `Service` + `LocalBusiness` JSON-LD block is now hard-coded in the template and
needs **no** build-script support — it reuses `{{TITLE}}`, `{{DESCRIPTION}}`,
`{{CANONICAL_URL}}` and `{{CITY_NAME}}`, which the build script already supplies.
The `priceRange` is set to `15%-25%`; update it if the commission range changes.

---

## 4. Outstanding: the default OG image asset

`ogImage` was empty on all four geo pages, so `og:image` and `twitter:image`
rendered blank. All four are now set to:

```
https://bnbuddy.com/wp-content/uploads/2026/08/bnbuddy-og-default.jpg
```

**This asset does not exist yet.** Either upload a 1280×800 branded default at
that path, or change the constant to an existing asset. Per-page images remain
the better long-term answer and are the job of `fetch-geo-images.js` described in
`IMAGE-PLAN.md`, which has not been written yet.

---

## 5. Checklist before the next geo build

- [ ] `build-geo-pages.js` resolves `{{H1}}`, `{{URL_PATH}}`, `{{FAQ_SCHEMA}}`, `{{OG_IMAGE}}`
- [ ] Output path and canonical derive from `urlPath`
- [ ] `bnbuddy-og-default.jpg` uploaded (or constant repointed)
- [ ] `cdmx.md` builds to `/es/administracion-airbnb-cdmx/`
- [ ] Sitemap updater picks up the new path
- [ ] Rendered HTML contains no literal `{{` sequences
- [ ] FAQ block validates in Google's Rich Results Test
