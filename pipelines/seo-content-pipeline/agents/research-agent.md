# BnBuddy SEO Research Agent

You are the Research Agent. Run a script that generates this week's content brief,
then commit and push the results.

## Steps

1. **Pull latest code:**
   ```bash
   cd /Users/albertovazquez/beto4812/bnbuddy-landing
   git pull
   ```

2. **Run brief generation:**
   ```bash
   npm run generate-brief
   ```
   This reads the keyword queue + ranking data, applies the selection logic,
   and writes the brief + content status files. No API keys needed.

3. **Verify the output:**
   - Read the brief file path printed in the script output
   - Confirm `contentPlan` has 3 items (all `blog-post` or `comparison-post`)
   - Confirm no slug conflicts with existing pages
   - If the script reported errors, stop and report them

4. **Brand-fit review (reasoning step):**

   For each of the 3 selected keywords, apply the **host/traveler test**:

   > *"Is the person searching this keyword a vacation rental HOST managing properties — or a TRAVELER looking for a place to stay?"*

   Use this decision matrix:

   **✅ Auto-approve — do NOT veto:**
   - Searcher is a host (managing, automating, optimizing, earning from a rental)
   - About host tools: automation, messaging, communication, pricing, management software
   - About guest experience *from the host's perspective* — e.g. `airbnb customer service`
     means a host wants to automate how they handle guests; BnBuddy's AI Assistant does this
   - About host income, occupancy, listing optimization, or becoming a host
   - About direct booking, skipping OTA fees, or building a rental website

   **❌ Veto and replace — mark `"skipped"`, re-run `generate-brief` once:**
   - Searcher is a TRAVELER seeking a place to stay (e.g. `airbnb vacation rentals`,
     `long term airbnb`, `airbnb monthly rentals`, `short term vacation rental`)
   - About Airbnb platform features a *guest* uses: booking, cancellation, refunds
   - Legal, tax, or regulatory topics (no product hook for BnBuddy)
   - Geo-destination queries: `airbnb in [city]`, `vacation rentals near me`, `[city] rentals`

   **⚠️ Accept with a note (even if `brand_relevance: 0`):**
   - High-volume, low-difficulty keyword with a clear host-audience angle where BnBuddy
     can add a product CTA naturally. Flag it in your summary report.

   **To veto:**
   - Open `pipelines/seo-content-pipeline/data/dataforseo/keyword-queue.json`
   - Find the offending keyword, change `status` from `"pending"` to `"skipped"`
   - Rerun `npm run generate-brief` once to get a replacement
   - **Do NOT edit the brief manually.** Let the script pick the replacement.
   - Accept the replacement even if imperfect — only veto clear traveler-intent misfits.

5. **Commit and push:**
   ```bash
   git add pipelines/seo-content-pipeline/data/
   git commit -m "chore(seo): research brief YYYY-MM-DD"
   git push
   ```
   Replace `YYYY-MM-DD` with today's date.
   If push fails (non-fast-forward), `git pull` and retry.

6. **Report** a summary of what was planned (copy the script's console output).

## Rules

- **Do NOT write helper scripts.** The `generate-brief` script handles everything.
- **Do NOT modify the selection logic** or manually edit the brief output.
- **Do NOT modify any agent instruction files** (`agents/*.md`).
- If `npm run generate-brief` fails, report the error and stop.
- If push fails after 2 retries, report the error and stop.