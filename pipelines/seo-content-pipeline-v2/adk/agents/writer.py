"""Writer agent factory — creates per-article content writing agents.

Each writer uses Claude Sonnet to produce a high-quality SEO article
with proper frontmatter, internal linking, and IG compliance.
"""

import json
from datetime import date
from pathlib import Path

from google.adk.agents import LlmAgent
from google.adk.models.lite_llm import LiteLlm

from adk.tools.file_ops import write_file


def make_writer(
    article_config: dict,
    cluster_config: dict,
    writer_prompt_path: str,
    content_dir: str,
    model: str,
    fallback_model: str | None = None,
) -> LlmAgent:
    """Create a writer agent for a single article.

    Args:
        article_config: Article definition from cluster JSON
                        (slug, title, primaryKeyword, etc.).
        cluster_config: Full cluster definition (for cross-linking context).
        writer_prompt_path: Path to prompts/writer.md.
        content_dir: Directory where articles are written.
        model: Model identifier (Claude Sonnet via LiteLlm).
        fallback_model: Optional fallback model if primary is unavailable.

    Returns:
        LlmAgent that writes a complete SEO article.
    """
    writer_md = Path(writer_prompt_path).read_text(encoding="utf-8")

    slug = article_config["slug"]
    safe_slug = slug.replace("-", "_")  # ADK requires valid Python identifiers
    pillar_slug = cluster_config["pillar"]["slug"]
    cluster_id = cluster_config["id"]
    today = date.today().isoformat()

    # Build sibling context for cross-linking
    all_slugs = [cluster_config["pillar"]["slug"]] + [
        a["slug"] for a in cluster_config["articles"]
    ]
    sibling_slugs = article_config.get("siblingLinks", [])
    content_type = article_config.get("contentType", "blog-post")
    word_target = article_config.get("wordCountTarget", 1800)
    product_focus = article_config.get("productFocus", "all")
    ig_categories = article_config.get("suggestedIgCategories", [])

    # The state key for this article's SERP research (set by Researcher_{safe_slug})
    serp_state_key = f"serp_results_{safe_slug}"

    # Article-specific context injected into the writer prompt.
    # Uses ADK {{key}} template syntax (doubled braces escape the f-string).
    article_context = f"""
## Your Assignment

Write a **{content_type}** article with these specifications:

- **Slug:** {slug}
- **Title:** {article_config['title']}
- **Primary Keyword:** {article_config['primaryKeyword']}
- **Word Count Target:** {word_target}+ words
- **Product Focus:** {product_focus}
- **Date:** {today}
- **Cluster:** {cluster_id}
- **Pillar Slug:** {pillar_slug}

### Internal Linking Context
- **Pillar page to link to:** /{pillar_slug}/ (MUST link in first 2 paragraphs)
- **Sibling articles to cross-link:** {json.dumps(sibling_slugs)}
- **All cluster slugs:** {json.dumps(all_slugs)}

### Information Gain Categories to Use
{json.dumps(ig_categories)}
(Include at least 2 IG items. See the writer instructions for details.)

### Enriched Brief (from Planner)
The cluster planner produced the following enriched brief. Use the outline,
secondary keywords, and IG guidance for your article:

{{{{cluster_plan}}}}

### SERP Research
The following competitor analysis was gathered for your keyword. Use it
to differentiate your article:

{{{{{serp_state_key}}}}}

### Output
Use the write_file tool to save your article to:
{content_dir}/{slug}.md

The file must include YAML frontmatter followed by the full markdown article.
"""

    # Determine the model object — use LiteLlm for Vertex AI models,
    # with optional fallback model support
    if isinstance(model, str) and model.startswith("vertex_ai/"):
        litellm_kwargs = {"model_name": model}
        if fallback_model:
            litellm_kwargs["fallback_models"] = [fallback_model]
        model_obj = LiteLlm(**litellm_kwargs)
    else:
        model_obj = model

    return LlmAgent(
        name=f"Writer_{safe_slug}",
        model=model_obj,
        instruction=writer_md + "\n\n" + article_context,
        tools=[write_file],
        output_key=f"article_{safe_slug}",
    )
