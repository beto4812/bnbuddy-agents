#!/usr/bin/env python3
"""CLI entry point for the SEO Content Pipeline v2.

Usage:
    # Full cluster sprint
    python run_sprint.py --cluster vacation-rental-mgmt-software

    # Dry run (show plan only, don't write articles)
    python run_sprint.py --cluster vacation-rental-mgmt-software --dry-run

    # Skip data pull entirely (use existing research data)
    python run_sprint.py --cluster vacation-rental-mgmt-software --skip-data-pull

    # Skip only the Reddit research step (use cached reddit-research.json)
    python run_sprint.py --cluster vacation-rental-mgmt-software --skip-reddit-research
"""

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

import yaml
from dotenv import load_dotenv

# IMPORTANT: Auto-load credentials BEFORE importing ADK modules.
# The Google GenAI client reads GOOGLE_GENAI_USE_VERTEXAI, GOOGLE_CLOUD_PROJECT,
# and GOOGLE_CLOUD_LOCATION at import time, so they must be set first.
from adk.preflight import run_preflight_checks, _auto_load_credentials
_auto_load_credentials()

from google.adk.runners import InMemoryRunner
from google.genai import types as genai_types

from adk.run_logger import RunLogger
from adk.sprint import build_sprint_pipeline, copy_staging_to_output

# Suppress noisy OpenTelemetry context warnings
os.environ.setdefault("OTEL_PYTHON_LOG_LEVEL", "ERROR")


PIPELINE_ROOT = Path(__file__).parent.resolve()
REPO_ROOT = PIPELINE_ROOT.parent.parent

# Load environment variables from repo root .env if it exists
dotenv_path = REPO_ROOT / ".env"
if dotenv_path.exists():
    load_dotenv(dotenv_path)


def load_config() -> dict:
    """Load pipeline configuration from config.yaml."""
    config_path = PIPELINE_ROOT / "config.yaml"
    if not config_path.exists():
        print(f"[error] Config not found: {config_path}")
        sys.exit(1)
    with open(config_path) as f:
        return yaml.safe_load(f)


def load_cluster(cluster_id: str) -> dict:
    """Load a cluster definition by ID."""
    cluster_path = PIPELINE_ROOT / "clusters" / f"{cluster_id}.json"
    if not cluster_path.exists():
        print(f"[error] Cluster not found: {cluster_path}")
        available = list((PIPELINE_ROOT / "clusters").glob("*.json"))
        if available:
            print(f"Available clusters: {[f.stem for f in available]}")
        sys.exit(1)
    with open(cluster_path) as f:
        return json.load(f)


async def run_sprint(
    cluster_id: str,
    dry_run: bool = False,
    skip_data_pull: bool = False,
    skip_reddit_research: bool = False,
) -> None:
    """Execute a cluster sprint.

    Args:
        cluster_id: ID of the cluster to process (matches JSON filename).
        dry_run: If True, build the pipeline and show the plan but don't execute.
        skip_data_pull: If True, skip npm data-pull scripts (use existing data).
        skip_reddit_research: If True, skip only pull-reddit-research (use cached
            reddit-research.json). Useful when Reddit is rate-limiting.
    """
    print(f"\n{'='*60}")
    print(f"  SEO Cluster Sprint — {cluster_id}")
    print(f"{'='*60}\n")

    # Load configuration
    config = load_config()
    cluster = load_cluster(cluster_id)

    # Validate credentials and dependencies before burning tokens
    run_preflight_checks(config, pipeline_root=str(PIPELINE_ROOT))

    print(f"Cluster: {cluster['name']}")
    print(f"Pillar:  {cluster['pillar']['title']}")
    print(f"Articles: {len(cluster['articles'])} supporting")
    print(f"Models:  planner={config['models']['planner']}, "
          f"writer={config['models']['writer']}")
    if skip_data_pull:
        print("Mode:    --skip-data-pull (using existing research data)")
    if skip_reddit_research:
        print("Mode:    --skip-reddit-research (using cached reddit-research.json)")
    print()

    # Build the pipeline
    pipeline = build_sprint_pipeline(
        cluster_config=cluster,
        app_config=config,
        pipeline_root=str(PIPELINE_ROOT),
        skip_data_pull=skip_data_pull,
        skip_reddit_research=skip_reddit_research,
    )

    if dry_run:
        print("[dry-run] Pipeline built successfully. Steps:")
        for i, agent in enumerate(pipeline.sub_agents, 1):
            sub_count = ""
            if hasattr(agent, "sub_agents"):
                sub_count = f" ({len(agent.sub_agents)} sub-agents)"
            print(f"  {i}. {agent.name}{sub_count}")
        print("\n[dry-run] No articles will be written.")
        return

    # Run the pipeline
    print("Starting sprint...\n")

    runner = InMemoryRunner(
        agent=pipeline,
        app_name="seo-cluster-sprint",
    )

    # Build initial session state
    initial_state = {"cluster_config": json.dumps(cluster)}

    # When skipping data pull, seed empty defaults for state keys that
    # downstream agents reference via ADK {key} templates. Without these,
    # ADK raises KeyError when it tries to substitute missing keys.
    if skip_data_pull:
        initial_state["research_data"] = "(No research data — data pull was skipped)"
    # Seed empty SERP results for each article (Researchers populate these)
    all_articles = [cluster["pillar"]] + cluster["articles"]
    for article in all_articles:
        safe_slug = article["slug"].replace("-", "_")
        serp_key = f"serp_results_{safe_slug}"
        if serp_key not in initial_state:
            initial_state[serp_key] = "(SERP research pending)"

    # Seed state keys referenced by downstream agents via ADK templates.
    # These get overwritten as each agent runs, but must exist to avoid KeyError.
    initial_state.setdefault("cluster_plan", "(Cluster plan pending)")
    initial_state.setdefault("validation_report", "(Validation pending)")

    # Seed per-article validation state keys (ValidatorPool populates these)
    for article in all_articles:
        safe_slug = article["slug"].replace("-", "_")
        val_key = f"article_validation_{safe_slug}"
        initial_state.setdefault(val_key, "(Validation pending)")

    # Create session with initial state
    session = await runner.session_service.create_session(
        app_name="seo-cluster-sprint",
        user_id="pipeline",
        state=initial_state,
    )

    # Initialize run logger
    runs_dir = str(PIPELINE_ROOT / config["paths"]["data_dir"] / "runs")
    logger = RunLogger(
        cluster_id=cluster["id"],
        runs_dir=runs_dir,
        writer_model=config["models"]["writer"],
        planner_model=config["models"]["planner"],
    )

    # Execute the pipeline with structured logging
    async for event in runner.run_async(
        user_id="pipeline",
        session_id=session.id,
        new_message=genai_types.Content(
            role="user",
            parts=[genai_types.Part(text=f"Execute cluster sprint for: {cluster['name']}")],
        ),
    ):
        logger.process_event(event)

    # Finalize logging
    logger.finalize()

    # Copy validated articles from staging to output directory
    staging_dir = str(PIPELINE_ROOT / config["paths"]["content_dir"])
    output_dir = str(PIPELINE_ROOT / config["paths"]["content_output_dir"])
    copied = copy_staging_to_output(staging_dir, output_dir)

    # Print run summary
    logger.print_summary()
    print(f"  Articles staged: {staging_dir}")
    print(f"  Articles deployed: {output_dir} ({len(copied)} files)")
    print(f"{'=' * 60}\n")


def main():
    parser = argparse.ArgumentParser(
        description="SEO Content Pipeline v2 — Cluster Sprint Runner"
    )
    parser.add_argument(
        "--cluster",
        required=True,
        help="Cluster ID (matches JSON filename in clusters/ directory)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Build the pipeline and show the plan without executing",
    )
    parser.add_argument(
        "--skip-data-pull",
        action="store_true",
        help="Skip npm data-pull scripts (use existing research data)",
    )

    parser.add_argument(
        "--skip-reddit-research",
        action="store_true",
        help="Skip pull-reddit-research npm script (use cached reddit-research.json). "
             "Useful when Reddit is rate-limiting.",
    )

    args = parser.parse_args()
    asyncio.run(run_sprint(
        args.cluster,
        args.dry_run,
        args.skip_data_pull,
        args.skip_reddit_research,
    ))


if __name__ == "__main__":
    main()
