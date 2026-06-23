"""Planner agent — generates enriched cluster plan from research data.

Uses Gemini Flash to read the pre-planned cluster definition + fresh research
and produce per-article briefs with outlines, keywords, and IG assignments.
"""

from pathlib import Path

from google.adk.agents import LlmAgent

from adk.tools.file_ops import read_file


def build_planner_agent(
    cluster_path: str,
    ig_checklist_path: str,
    planner_prompt_path: str,
    model: str,
) -> LlmAgent:
    """Build the Planner agent.

    Args:
        cluster_path: Path to the cluster definition JSON.
        ig_checklist_path: Path to ig-checklist.json.
        planner_prompt_path: Path to prompts/planner.md.
        model: Model identifier (Gemini Flash).

    Returns:
        LlmAgent configured to generate enriched cluster briefs.
    """
    # Load the planner system prompt from markdown
    planner_md = Path(planner_prompt_path).read_text(encoding="utf-8")

    # Inject file paths into the instruction
    instruction = f"""{planner_md}

## File Paths (use read_file tool to access these)
- Cluster definition: {cluster_path}
- IG Checklist: {ig_checklist_path}

## Research Data (from DataPull agent)
The following research data was gathered from Reddit, Exa, and DataForSEO.
Use it to inform your secondary keyword selection and competitor analysis:

{{{{research_data}}}}

## Output
Store your enriched cluster plan as structured JSON in your response.
The plan must include for each article:
- slug, title, primaryKeyword
- secondaryKeywords (3-5)
- suggestedOutline (list of H2/H3 headings)
- igCategories (2+ from the checklist)
- competitorAngles (key differentiators from SERP research)
- productFocus (which BnBuddy product to highlight)
"""

    return LlmAgent(
        name="ClusterPlanner",
        model=model,
        instruction=instruction,
        tools=[read_file],
        output_key="cluster_plan",
    )
