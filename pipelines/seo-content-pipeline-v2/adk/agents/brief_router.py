"""Brief Router agent — parses the full cluster plan into per-article state keys.

This ensures each writer agent only sees its own specific brief, preventing
the model from attempting to write all articles sequentially.
"""

import json
from google.genai.types import Content, Part
from google.adk.agents import BaseAgent
from google.adk.events import Event


from typing import AsyncIterator

class BriefRouter(BaseAgent):
    """Parses cluster_plan from state and routes individual briefs to state keys.
    
    This agent does not call an LLM. It simply reads the JSON from `cluster_plan`,
    extracts each article's brief, and saves it to `article_brief_{safe_slug}`.
    """

    def __init__(self):
        # We define output_key so the framework knows we succeeded,
        # but the real work happens by mutating session.state in _run_async_impl
        super().__init__(name="BriefRouter")

    async def _run_async_impl(self, session) -> AsyncIterator[Event]:
        cluster_plan_str = session.state.get("cluster_plan")
        if not cluster_plan_str or cluster_plan_str.startswith("(Cluster"):
            yield Event(
                author=self.name,
                content=Content(parts=[Part(text="No cluster_plan found in state. Skipping.")]),
                turn_complete=True,
            )
            return

        try:
            # Try to parse the JSON. It might have markdown block markers.
            import re
            json_match = re.search(r"```json(.*?)```", cluster_plan_str, re.DOTALL)
            if json_match:
                plan_json = json.loads(json_match.group(1))
            else:
                plan_json = json.loads(cluster_plan_str)

            articles = plan_json.get("enrichedArticles", [])
            routed_count = 0

            for article in articles:
                slug = article.get("slug")
                if not slug:
                    continue
                safe_slug = slug.replace("-", "_")
                
                # Convert the individual article back to formatted JSON string
                article_str = json.dumps(article, indent=2)
                
                # Write to state
                state_key = f"article_brief_{safe_slug}"
                session.state[state_key] = article_str
                routed_count += 1

            yield Event(
                author=self.name,
                content=Content(parts=[Part(text=f"Successfully routed {routed_count} briefs to per-article state keys.")]),
                turn_complete=True,
            )

        except Exception as e:
            yield Event(
                author=self.name,
                content=Content(parts=[Part(text=f"Failed to parse cluster_plan: {str(e)}")]),
                error_code="PARSE_ERROR",
                error_message=str(e),
                turn_complete=True,
            )
