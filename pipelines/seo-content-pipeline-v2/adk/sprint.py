"""Sprint pipeline builder — assembles the full ADK agent graph.

Reads a cluster definition and config, then constructs a SequentialAgent
pipeline: DataPull → Planner → ResearchPool → WriterPool → ValidatorPool → Aggregator → Committer.
"""

import json
import shutil
from pathlib import Path
from typing import Any

from google.adk.agents import SequentialAgent, ParallelAgent, BaseAgent

from adk.agents.data_pull import build_data_pull_agent
from adk.agents.planner import build_planner_agent
from adk.agents.researcher import make_researcher
from adk.agents.writer import make_writer
from adk.agents.validator import make_article_validator, build_validation_aggregator
from adk.agents.committer import build_committer_agent


def build_sprint_pipeline(
    cluster_config: dict,
    app_config: dict,
    pipeline_root: str,
    skip_data_pull: bool = False,
    skip_reddit_research: bool = False,
) -> SequentialAgent:
    """Build the complete cluster sprint pipeline.

    The pipeline runs up to 7 steps sequentially:
    1. DataPull — fetch research data via npm scripts (skippable)
    2. Planner — generate enriched per-article briefs
    3. ResearchPool — SERP research per article (parallel)
    4. WriterPool — write all articles (parallel)
    5. ValidatorPool — per-article quality checks (parallel)
    6. ValidationAggregator — collect results, final PASS/FAIL
    7. Committer — git commit and push

    Args:
        cluster_config: Parsed cluster definition JSON.
        app_config: Parsed config.yaml.
        pipeline_root: Absolute path to the pipeline v2 directory.
        skip_data_pull: If True, omit the DataPull step (use existing data).
        skip_reddit_research: If True, tell DataPull to skip pull-reddit-research
            and use the cached reddit-research.json instead.

    Returns:
        Root SequentialAgent representing the full sprint.
    """
    root = Path(pipeline_root)
    repo_root = str(root / app_config["paths"]["repo_root"])
    content_dir = str(root / app_config["paths"]["content_dir"])
    content_output_dir = str(root / app_config["paths"]["content_output_dir"])
    prompts_dir = str(root / app_config["paths"]["prompts_dir"])
    data_dir = str(root / app_config["paths"]["data_dir"])
    clusters_dir = str(root / app_config["paths"]["clusters_dir"])
    v1_data = str(root / app_config["paths"]["v1_data"])

    # Model references
    cheap_model = app_config["models"]["planner"]
    research_model = app_config["models"]["researcher"]
    writer_model = app_config["models"]["writer"]
    writer_fallback = app_config["models"].get("writer_fallback")

    # --- Step 1: Data Pull (skippable) ---
    data_pull = build_data_pull_agent(
        repo_root=repo_root,
        v1_data_dir=v1_data,
        prompt_path=str(root / prompts_dir / "data-pull.md"),
        model=cheap_model,
        skip_reddit_research=skip_reddit_research,
    )

    # --- Step 2: Planner ---
    cluster_id = cluster_config["id"]
    cluster_path = str(root / clusters_dir / f"{cluster_id}.json")
    ig_path = str(root / data_dir / "ig-checklist.json")

    planner = build_planner_agent(
        cluster_path=cluster_path,
        ig_checklist_path=ig_path,
        planner_prompt_path=str(root / prompts_dir / "planner.md"),
        model=cheap_model,
    )

    # --- Step 3: Research Pool (parallel) ---
    # Create one researcher per article (pillar + supporting)
    all_articles = [cluster_config["pillar"]] + cluster_config["articles"]
    researcher_prompt = str(root / prompts_dir / "researcher.md")
    researchers = [
        make_researcher(
            slug=article["slug"],
            keyword=article["primaryKeyword"],
            prompt_path=researcher_prompt,
            model=research_model,
        )
        for article in all_articles
    ]

    research_pool = ParallelAgent(
        name="ResearchPool",
        sub_agents=researchers,
    )

    # --- Step 4: Writer Pool (parallel) ---
    writer_prompt = str(root / prompts_dir / "writer.md")
    writers = [
        make_writer(
            article_config=article,
            cluster_config=cluster_config,
            writer_prompt_path=writer_prompt,
            content_dir=content_dir,
            model=writer_model,
            fallback_model=writer_fallback,
        )
        for article in all_articles
    ]

    writer_pool = ParallelAgent(
        name="WriterPool",
        sub_agents=writers,
    )

    # --- Step 5: Validator Pool (parallel per-article checks) ---
    article_validator_prompt = str(root / prompts_dir / "article-validator.md")
    article_validators = [
        make_article_validator(
            article_config=article,
            cluster_config=cluster_config,
            content_dir=content_dir,
            prompt_path=article_validator_prompt,
            model=cheap_model,
        )
        for article in all_articles
    ]

    validator_pool = ParallelAgent(
        name="ValidatorPool",
        sub_agents=article_validators,
    )

    # --- Step 6: Validation Aggregator ---
    aggregator = build_validation_aggregator(
        cluster_config=cluster_config,
        prompt_path=str(root / prompts_dir / "validator.md"),
        model=cheap_model,
    )

    # --- Step 7: Committer ---
    # The committer operates on the final output directory (v1 content path)
    # so that the build pipeline picks up the content.
    committer = build_committer_agent(
        content_dir=content_output_dir,
        cluster_name=cluster_config["name"],
        repo_root=repo_root,
        prompt_path=str(root / prompts_dir / "committer.md"),
        model=cheap_model,
    )

    # --- Root Pipeline ---
    steps: list[BaseAgent] = []
    if not skip_data_pull:
        steps.append(data_pull)
    steps.extend([planner, research_pool, writer_pool, validator_pool, aggregator, committer])

    return SequentialAgent(
        name="ClusterSprint",
        sub_agents=steps,
    )


def copy_staging_to_output(staging_dir: str, output_dir: str) -> list[str]:
    """Copy validated articles from staging to the final output directory.

    Called by run_sprint.py after the pipeline completes successfully.
    Only copies .md files, preserving existing files in the output dir.

    Args:
        staging_dir: Path to the staging content directory.
        output_dir: Path to the final output content directory.

    Returns:
        List of copied file paths.
    """
    staging = Path(staging_dir)
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)

    copied = []
    for md_file in sorted(staging.glob("*.md")):
        dest = output / md_file.name
        shutil.copy2(md_file, dest)
        copied.append(str(dest))

    return copied
