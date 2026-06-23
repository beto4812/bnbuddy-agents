"""Validator agents — per-article validation and aggregate checker.

Architecture:
  ValidatorPool (parallel) → ValidationAggregator (sequential)

Each article gets its own validator agent that reads the file and checks
quality standards. The aggregator collects all results and produces
the final PASS/FAIL decision.
"""

import json
from pathlib import Path

from google.adk.agents import LlmAgent

from adk.tools.file_ops import read_file, list_directory


def make_article_validator(
    article_config: dict,
    cluster_config: dict,
    content_dir: str,
    prompt_path: str,
    model: str,
) -> LlmAgent:
    """Build a per-article Validator agent.

    Args:
        article_config: Single article definition (slug, title, etc.).
        cluster_config: Full cluster definition.
        content_dir: Path to the content output directory.
        prompt_path: Path to prompts/article-validator.md.
        model: Model identifier (Gemini Flash — cheap validation).

    Returns:
        LlmAgent that validates one article.
    """
    prompt_md = Path(prompt_path).read_text(encoding="utf-8")

    slug = article_config["slug"]
    safe_slug = slug.replace("-", "_")
    pillar_slug = cluster_config["pillar"]["slug"]
    is_pillar = article_config.get("type", "blog-post") == "pillar" or slug == pillar_slug
    word_target = article_config.get("wordCountTarget", 3000 if is_pillar else 1800)

    # Build sibling context
    all_slugs = [pillar_slug] + [a["slug"] for a in cluster_config["articles"]]
    sibling_slugs = [s for s in all_slugs if s != slug]

    context = f"""
## Your Assignment

Validate this article:
- **Slug:** {slug}
- **File path:** {content_dir}/{slug}.md
- **Type:** {"pillar" if is_pillar else "supporting"}
- **Word count target:** {word_target}+ words
- **Pillar slug:** {pillar_slug}
- **Expected sibling links (need ≥2):** {json.dumps(sibling_slugs)}
"""

    return LlmAgent(
        name=f"ArticleValidator_{safe_slug}",
        model=model,
        instruction=prompt_md + "\n\n" + context,
        tools=[read_file],
        output_key=f"article_validation_{safe_slug}",
    )


def build_validation_aggregator(
    cluster_config: dict,
    prompt_path: str,
    model: str,
) -> LlmAgent:
    """Build the Validation Aggregator agent.

    Reads all per-article validation results from state and produces
    the final PASS/FAIL decision.

    Args:
        cluster_config: Full cluster definition.
        prompt_path: Path to prompts/validator.md (aggregator prompt).
        model: Model identifier.

    Returns:
        LlmAgent that aggregates validation results.
    """
    prompt_md = Path(prompt_path).read_text(encoding="utf-8")

    pillar_slug = cluster_config["pillar"]["slug"]
    all_articles = [cluster_config["pillar"]] + cluster_config["articles"]
    expected_slugs = [a["slug"] for a in all_articles]

    # Build state key references using ADK {{key}} template syntax
    # Each per-article validator writes to article_validation_{safe_slug}
    validation_refs = []
    for slug in expected_slugs:
        safe_slug = slug.replace("-", "_")
        state_key = f"article_validation_{safe_slug}"
        validation_refs.append(f"### {slug}\n{{{{{{{{{state_key}}}}}}}}}")

    context = f"""
## Runtime Context

- **Expected articles:** {', '.join(expected_slugs)}
- **Pillar slug:** {pillar_slug}

## Per-Article Validation Results

{chr(10).join(validation_refs)}
"""

    return LlmAgent(
        name="ValidationAggregator",
        model=model,
        instruction=prompt_md + "\n\n" + context,
        tools=[],  # No tools needed — reads from state only
        output_key="validation_report",
    )
