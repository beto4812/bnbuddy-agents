"""Committer agent — commits generated content to git.

Only runs if validation passed. Adds all content files,
commits with a descriptive message, and pushes.
"""

from pathlib import Path

from google.adk.agents import LlmAgent

from adk.tools.shell import run_shell_command


def build_committer_agent(
    content_dir: str,
    cluster_name: str,
    repo_root: str,
    prompt_path: str,
    model: str,
) -> LlmAgent:
    """Build the Committer agent.

    Args:
        content_dir: Path to content directory to commit.
        cluster_name: Human-readable cluster name for commit message.
        repo_root: Repo root for git operations.
        prompt_path: Path to prompts/committer.md.
        model: Model identifier (Gemini Flash — cheap coordination).

    Returns:
        LlmAgent that commits and pushes content.
    """
    # Load the system prompt from markdown
    prompt_md = Path(prompt_path).read_text(encoding="utf-8")

    # Append dynamic runtime context with ADK state template for validation_report.
    # {{{{validation_report}}}} → Python f-string renders as {{validation_report}}
    # → ADK substitutes with session state value at runtime.
    context = f"""
## Runtime Context

- **Repo root (cwd for git commands):** {repo_root}
- **Content directory to add:** {content_dir}
- **Commit message:** `seo: add cluster — {cluster_name}`
- **Push target:** `origin seo-agent/content`

### Validation Report
{{{{validation_report}}}}
"""

    return LlmAgent(
        name="Committer",
        model=model,
        instruction=prompt_md + "\n\n" + context,
        tools=[run_shell_command],
        output_key="commit_result",
    )
