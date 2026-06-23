"""Pipeline run logger — structured JSONL logging and step-level monitoring.

Processes ADK Event objects to provide:
- Real-time step progress to stdout
- Structured JSONL log file per run
- Per-agent timing and token usage tracking
- Run summary with total cost estimate
"""

import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional


# Approximate cost per 1M tokens (Vertex AI pricing, June 2025)
_COST_PER_1M = {
    "gemini-2.5-flash": {"input": 0.15, "output": 0.60},
    "gemini-2.5-pro": {"input": 1.25, "output": 10.00},
    "vertex_ai/claude-sonnet-4-6": {"input": 3.00, "output": 15.00},
}
_DEFAULT_COST = {"input": 1.00, "output": 5.00}


class RunLogger:
    """Captures ADK pipeline events and writes structured logs.

    Usage:
        logger = RunLogger(cluster_id="vacation-rental-mgmt-software",
                           runs_dir="data/runs", writer_model="gemini-2.5-pro")
        async for event in runner.run_async(...):
            logger.process_event(event)
        logger.print_summary()
    """

    def __init__(
        self,
        cluster_id: str,
        runs_dir: str,
        writer_model: str = "",
        planner_model: str = "",
    ):
        self.cluster_id = cluster_id
        self.writer_model = writer_model
        self.planner_model = planner_model
        self.start_time = time.monotonic()
        self.start_ts = datetime.now(timezone.utc)

        # Per-agent tracking
        self._agent_starts: dict[str, float] = {}
        self._agent_tokens: dict[str, dict[str, int]] = {}
        self._agent_errors: dict[str, list[str]] = {}
        self._active_agent: Optional[str] = None
        self._completed_agents: list[str] = []
        self._event_count = 0
        self._total_input_tokens = 0
        self._total_output_tokens = 0

        # JSONL log file
        runs_path = Path(runs_dir)
        runs_path.mkdir(parents=True, exist_ok=True)
        ts_str = self.start_ts.strftime("%Y%m%d-%H%M%S")
        self._log_path = runs_path / f"{cluster_id}-{ts_str}.jsonl"
        self._log_file = open(self._log_path, "a", encoding="utf-8")

    @property
    def log_path(self) -> str:
        """Return the path to the JSONL log file."""
        return str(self._log_path)

    def process_event(self, event: Any) -> None:
        """Process a single ADK Event and log it."""
        self._event_count += 1

        author = getattr(event, "author", "unknown")
        timestamp = getattr(event, "timestamp", time.time())
        now = time.monotonic()

        # Track agent start/transitions
        if author != self._active_agent and author != "unknown":
            if self._active_agent and self._active_agent not in self._completed_agents:
                # Previous agent is done (or switched)
                elapsed = now - self._agent_starts.get(self._active_agent, now)
                tokens = self._agent_tokens.get(self._active_agent, {})
                self._print_agent_done(self._active_agent, elapsed, tokens)
                self._completed_agents.append(self._active_agent)

            if author not in self._agent_starts:
                self._agent_starts[author] = now
                self._print_agent_start(author)
            self._active_agent = author

        # Extract token usage
        usage = getattr(event, "usage_metadata", None)
        if usage:
            input_tokens = getattr(usage, "prompt_token_count", 0) or 0
            output_tokens = getattr(usage, "candidates_token_count", 0) or 0
            # Also try the genai-style field names
            if not input_tokens:
                input_tokens = getattr(usage, "input_tokens", 0) or 0
            if not output_tokens:
                output_tokens = getattr(usage, "output_tokens", 0) or 0

            if input_tokens or output_tokens:
                if author not in self._agent_tokens:
                    self._agent_tokens[author] = {"input": 0, "output": 0}
                self._agent_tokens[author]["input"] += input_tokens
                self._agent_tokens[author]["output"] += output_tokens
                self._total_input_tokens += input_tokens
                self._total_output_tokens += output_tokens

        # Extract errors
        error_code = getattr(event, "error_code", None)
        error_msg = getattr(event, "error_message", None)
        if error_code or error_msg:
            if author not in self._agent_errors:
                self._agent_errors[author] = []
            self._agent_errors[author].append(
                f"{error_code or 'ERROR'}: {error_msg or 'unknown'}"
            )
            self._print_error(author, error_code, error_msg)

        # Extract text content for log
        text_preview = ""
        content = getattr(event, "content", None)
        if content:
            parts = getattr(content, "parts", None) or []
            for part in parts:
                text = getattr(part, "text", None)
                if text:
                    text_preview = text[:300]
                    # Stream a small snippet to the terminal for visibility
                    preview_line = text_preview.replace("\n", " ")[:80]
                    print(f"    ↳ {author} says: {preview_line}...")
                    break

        # Write JSONL line
        log_entry = {
            "ts": datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat(),
            "agent": author,
            "event_id": getattr(event, "id", ""),
            "turn_complete": getattr(event, "turn_complete", None),
            "tokens": self._agent_tokens.get(author),
            "error": error_code,
            "error_msg": error_msg,
            "text_preview": text_preview[:200] if text_preview else None,
        }
        # Remove None values for cleaner logs
        log_entry = {k: v for k, v in log_entry.items() if v is not None}
        self._log_file.write(json.dumps(log_entry) + "\n")
        self._log_file.flush()

    def _print_agent_start(self, agent: str) -> None:
        """Print agent start message."""
        elapsed = time.monotonic() - self.start_time
        mins, secs = divmod(int(elapsed), 60)
        print(f"  [{mins:02d}:{secs:02d}] ▶ {agent} started")

    def _print_agent_done(self, agent: str, elapsed: float, tokens: dict) -> None:
        """Print agent completion message."""
        run_elapsed = time.monotonic() - self.start_time
        mins, secs = divmod(int(run_elapsed), 60)
        token_str = ""
        if tokens:
            inp = tokens.get("input", 0)
            out = tokens.get("output", 0)
            token_str = f", {_format_tokens(inp)} in / {_format_tokens(out)} out"
        print(f"  [{mins:02d}:{secs:02d}] ✅ {agent} done ({elapsed:.1f}s{token_str})")

    def _print_error(self, agent: str, code: Optional[str], msg: Optional[str]) -> None:
        """Print error message."""
        run_elapsed = time.monotonic() - self.start_time
        mins, secs = divmod(int(run_elapsed), 60)
        print(f"  [{mins:02d}:{secs:02d}] ❌ {agent} error: {code or ''} {msg or ''}")

    def finalize(self) -> None:
        """Mark the final active agent as done and close the log file."""
        now = time.monotonic()
        if self._active_agent and self._active_agent not in self._completed_agents:
            elapsed = now - self._agent_starts.get(self._active_agent, now)
            tokens = self._agent_tokens.get(self._active_agent, {})
            self._print_agent_done(self._active_agent, elapsed, tokens)
            self._completed_agents.append(self._active_agent)

        self._log_file.close()

    def print_summary(self) -> None:
        """Print run summary with total stats."""
        total_elapsed = time.monotonic() - self.start_time
        mins, secs = divmod(int(total_elapsed), 60)

        # Estimate cost
        cost = self._estimate_cost()

        print(f"\n{'═' * 60}")
        print(f"  Run Summary")
        print(f"{'═' * 60}")
        print(f"  Cluster:     {self.cluster_id}")
        print(f"  Duration:    {mins}m {secs}s")
        print(f"  Events:      {self._event_count}")
        print(f"  Agents run:  {len(self._completed_agents)}")
        print(f"  Tokens:      {_format_tokens(self._total_input_tokens)} in / "
              f"{_format_tokens(self._total_output_tokens)} out")
        print(f"  Est. cost:   ${cost:.4f}")
        print(f"  Log file:    {self._log_path}")

        if self._agent_errors:
            print(f"\n  ⚠️  Errors:")
            for agent, errors in self._agent_errors.items():
                for err in errors:
                    print(f"     {agent}: {err}")

        print(f"{'═' * 60}\n")

    def _estimate_cost(self) -> float:
        """Estimate run cost based on token usage and model pricing."""
        cost = 0.0
        for agent, tokens in self._agent_tokens.items():
            # Determine which model this agent likely used
            if "Writer" in agent:
                pricing = _COST_PER_1M.get(self.writer_model, _DEFAULT_COST)
            else:
                pricing = _COST_PER_1M.get(self.planner_model, _DEFAULT_COST)

            cost += tokens.get("input", 0) / 1_000_000 * pricing["input"]
            cost += tokens.get("output", 0) / 1_000_000 * pricing["output"]
        return cost


def _format_tokens(n: int) -> str:
    """Format token count for display (e.g., 1234 -> '1.2K')."""
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M"
    elif n >= 1_000:
        return f"{n / 1_000:.1f}K"
    return str(n)
