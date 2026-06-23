"""Data Pull agent — runs existing Node.js scripts to gather fresh research data.

This agent calls the v1 pipeline's npm scripts via subprocess,
then reads their output JSON files into session state for downstream agents.
"""

from pathlib import Path

from google.adk.agents import LlmAgent

from adk.tools.shell import run_shell_command
from adk.tools.file_ops import read_file


def build_data_pull_agent(
    repo_root: str,
    v1_data_dir: str,
    prompt_path: str,
    model: str,
    skip_reddit_research: bool = False,
) -> LlmAgent:
    """Build the DataPull agent.

    Args:
        repo_root: Absolute path to the bnbuddy-agents repo root.
        v1_data_dir: Absolute path to v1 pipeline data directory.
        prompt_path: Path to prompts/data-pull.md.
        model: Model identifier (Gemini Flash — cheap, just coordinates).
        skip_reddit_research: If True, skip pull-reddit-research and use
            the cached reddit-research.json instead.

    Returns:
        LlmAgent configured to pull research data.
    """
    # Load the system prompt from markdown
    prompt_md = Path(prompt_path).read_text(encoding="utf-8")

    # Build the reddit instruction based on the flag
    if skip_reddit_research:
        reddit_instruction = (
            "- **SKIP** `npm run pull-reddit-research` — Reddit is rate-limiting. "
            "Use the existing cached file at the reddit-research.json path below instead."
        )
    else:
        reddit_instruction = "- Run `npm run pull-reddit-research` → produces reddit-research.json"

    # Append dynamic runtime context
    context = f"""
## Runtime Context

- **Repo root (cwd for npm scripts):** {repo_root}
- **Scripts to run:**
  {reddit_instruction}
  - Run `npm run pull-exa-research` → produces exa-research.json
  - Run `npm run pull-keyword-data` → produces dataforseo/keyword-queue.json
- **Data files to read after scripts complete:**
  - {v1_data_dir}/reddit-research.json
  - {v1_data_dir}/exa-research.json
  - {v1_data_dir}/dataforseo/keyword-queue.json
  - {v1_data_dir}/ranking-comparison.json (if it exists)
"""

    return LlmAgent(
        name="DataPull",
        model=model,
        instruction=prompt_md + "\n\n" + context,
        tools=[run_shell_command, read_file],
        output_key="research_data",
    )
