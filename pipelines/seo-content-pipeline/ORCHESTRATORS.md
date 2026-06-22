# Orchestrator Configurations

**Updated:** 2026-05-02
**Providers:** Google Ultra (Jules) + Claude Pro (Claude Code)
**Focus:** Product-led SaaS content (EN-first). Geo pages frozen.

This is the **only file that references specific providers**. All agent instruction
files (`agents/*.md`) are provider-agnostic.

---

## Weekly Schedule — "Gather, then Create"

Technical/data tasks run early in the week (Jules/Gemini).
Creative writing tasks run later in the week (Claude).
One provider per day eliminates git workflow conflicts (PR vs push).

### Monday — DATA DAY (Jules)

| Time (CST) | Agent | Provider | Notes |
|------------|-------|----------|-------|
| 08:00 | Keyword Script | Local cron | `npm run pull-keyword-data` — no LLM needed |
| 09:00 | Research Agent | Jules (Gemini 3 Pro) | 1M context — ingests entire keyword queue + ranking data |
| 14:00 | Monitor Agent | Jules (Gemini 3 Pro) | Analyze Search Console, produce ranking report |

> Jules PRs are reviewed and merged Monday evening or Tuesday morning.
> Alberto has Tue/Wed to review research brief before content writing begins.

### Thursday — WRITING DAY (Claude)

| Time (CST) | Agent | Provider | Notes |
|------------|-------|----------|-------|
| 10:00 | Content Agent Run 1 | Claude (Opus) | Best long-form creative quality |
| 13:00 | Content Agent Run 2 | Claude (Opus) | Direct push, claim-then-push concurrency |
| 16:00 | Content Agent Run 3 | Claude (Opus) | Direct push |

> All content runs use direct git push. No conflict with Jules (ran Monday).
> Alberto reviews content PRs on Friday.

---

## Why This Split Works

- **Jules excels at**: structured data processing, JSON generation, large-context analysis
- **Claude excels at**: creative writing, tone consistency, natural Spanish prose
- **No mixed git workflows**: Monday is PR-based (Jules), Thursday is push-based (Claude)
- **Review cadence**: Jules PRs on Tuesday, Claude content on Friday

---

## Provider Configurations

### Jules (Monday tasks)

**Platform:** [jules.google.com](https://jules.google.com)
**Subscription:** Google Ultra

Scheduled via Jules dashboard:

1. **Research Agent** — Weekly Monday
   - Prompt: `Read and execute instructions at pipelines/seo-content-pipeline/agents/research-agent.md`
   - Creates: `data/briefs/research-brief-YYYY-MM-DD.json` + updated `keyword-queue.json`

2. **Monitor Agent** — Weekly Monday
   - Prompt: `Read and execute instructions at pipelines/seo-content-pipeline/agents/monitor-agent.md`
   - Creates: `data/reports/ranking-report-YYYY-MM-DD.md` + updated `ranking-comparison.json`

### Claude Code Routines (Thursday tasks)

**Platform:** Claude Code Routines (CLI or dashboard)
**Subscription:** Claude Pro

```yaml
name: "seo-content-generate"
schedule:
  kind: cron
  expr: "0 10,13,16 * * 4"       # Thursday 10:00, 13:00, 16:00 CST
  tz: "America/Mexico_City"
payload:
  kind: agentTurn
  message: "Read your instructions at pipelines/seo-content-pipeline/agents/content-agent.md and execute."
  model: anthropic/claude-opus-4-6
  timeoutSeconds: 600
sessionTarget: isolated
delivery:
  mode: announce
  channel: discord
  to: "1471630388144111772"
```

---

## Fallback Procedures

If either provider is unavailable, run the affected agents on the other provider:

| Scenario | Fallback |
|----------|----------|
| Jules down on Monday | Run Research + Monitor via Claude Code manually on Tuesday |
| Claude down on Thursday | Run Content Agent via Jules (will submit PRs instead of push) |
| Both down | Run agents manually via Gemini CLI: `gemini -p "Read and execute agents/[agent].md"` |

---

## Token Budget

| Day | Provider | Subscription | Runs | Est. Tokens |
|-----|----------|-------------|------|-------------|
| Monday | Google Jules | Ultra | Research + Monitor | ~2M (Gemini 3 Pro, 1M ctx each) |
| Thursday | Claude Code | Pro | Content × 3 | ~600K (Opus, 200K ctx × 3) |
| **Total** | | | **5 agent runs/week** | **~2.6M tokens/week** |

Previous single-provider budget: ~600K tokens/week. **~4× increase.**

---

## Future Expansion

When additional subscriptions are added, consider:

| Platform | Best for |
|----------|----------|
| **OpenAI Codex** | Third content writer or structured output |
| **Cursor Automations** | Event-driven triggers (PR merged → auto-build) |
| **Gemini CLI + GitHub Actions** | Free CI compute for lightweight validation |
