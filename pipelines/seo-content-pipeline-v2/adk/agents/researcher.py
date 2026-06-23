"""Researcher agent factory — creates per-article SERP research agents.

Each researcher uses Exa to find competitor content for a specific keyword
and summarizes their structure, angles, and gaps.
"""

from pathlib import Path

from google.adk.agents import LlmAgent

from adk.tools.exa_search import search_exa


def make_researcher(
    slug: str,
    keyword: str,
    prompt_path: str,
    model: str,
) -> LlmAgent:
    """Create a researcher agent for a single article.

    Args:
        slug: Article slug (used for naming and state key).
        keyword: Primary keyword to research.
        prompt_path: Path to prompts/researcher.md.
        model: Model identifier (Gemini Flash).

    Returns:
        LlmAgent that researches SERP competition for the keyword.
    """
    # Load the system prompt from markdown
    prompt_md = Path(prompt_path).read_text(encoding="utf-8")

    # Append dynamic keyword context
    context = f"""
## Your Assignment

Research the competitive landscape for this keyword:

**Keyword:** "{keyword}"

Search for this exact keyword using the search_exa tool.
"""

    safe_slug = slug.replace("-", "_")

    return LlmAgent(
        name=f"Researcher_{safe_slug}",
        model=model,
        instruction=prompt_md + "\n\n" + context,
        tools=[search_exa],
        output_key=f"serp_results_{safe_slug}",
    )
