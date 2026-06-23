"""Exa API search tool for ADK agents.

Provides web search capabilities for competitive SEO research.
Uses the Exa API (exa.ai) to find relevant SERP-style results.
"""

import os
from typing import Optional


def search_exa(
    query: str,
    num_results: int = 5,
    text_length: int = 1000,
) -> str:
    """Search the web using Exa API for competitive SEO research.

    Finds pages that would rank for the given keyword, returns
    their titles, URLs, and text excerpts for analysis.

    Args:
        query: Search query (typically the target keyword).
        num_results: Number of results to return.
        text_length: Max characters of text content per result.

    Returns:
        Formatted search results with title, URL, and text snippet.
    """
    api_key = os.environ.get("EXA_API_KEY")
    if not api_key:
        return (
            "[warning] EXA_API_KEY not set. Skipping Exa search.\n"
            "Set the EXA_API_KEY environment variable to enable web research."
        )

    try:
        from exa_py import Exa

        exa = Exa(api_key=api_key)
        results = exa.search_and_contents(
            query=query,
            type="auto",
            num_results=num_results,
            text={"max_characters": text_length},
        )

        if not results.results:
            return f"[info] No results found for: {query}"

        output_parts = [f"## Exa SERP Results for: {query}\n"]
        for i, r in enumerate(results.results, 1):
            output_parts.append(
                f"### {i}. {r.title}\n"
                f"**URL:** {r.url}\n"
                f"**Excerpt:**\n{r.text[:text_length]}\n"
            )

        return "\n".join(output_parts)
    except ImportError:
        return "[error] exa-py not installed. Run: pip install exa-py"
    except Exception as e:
        return f"[error] Exa search failed: {e}"
