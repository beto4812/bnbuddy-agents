"""Pre-flight checks — validate credentials and dependencies before running.

Catches missing GCP credentials, API keys, and tooling before the pipeline
burns tokens on expensive steps. Called early in run_sprint.py.

Credential resolution order:
1. Environment variables (GCP_PROJECT, GOOGLE_APPLICATION_CREDENTIALS, EXA_API_KEY)
2. BnBuddy config directory (~/.config/bnbuddy/)
3. Application Default Credentials (~/.config/gcloud/)

The BnBuddy config directory is the canonical location for credentials:
  ~/.config/bnbuddy/
  ├── bnbuddy-agents-service-account.json   ← GCP service account
  ├── dataforseo.env                        ← DataForSEO API creds
  └── exa.env                               ← Exa API key
"""

import os
import shutil
import sys
from pathlib import Path


# BnBuddy config directory — canonical credential location
BNBUDDY_CONFIG_DIR = Path.home() / ".config" / "bnbuddy"
SA_KEY_FILENAME = "bnbuddy-agents-service-account.json"
EXA_ENV_FILENAME = "exa.env"
DATAFORSEO_ENV_FILENAME = "dataforseo.env"


def _load_env_file(path: Path) -> dict[str, str]:
    """Parse a simple KEY=VALUE env file, ignoring comments and blank lines."""
    env = {}
    if not path.exists():
        return env
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            key, _, value = line.partition("=")
            env[key.strip()] = value.strip()
    return env


def _auto_load_credentials() -> None:
    """Auto-load credentials from ~/.config/bnbuddy/ into environment if not already set."""

    # --- GCP Service Account ---
    if not os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"):
        sa_path = BNBUDDY_CONFIG_DIR / SA_KEY_FILENAME
        if sa_path.exists():
            os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(sa_path)

    # --- GCP Project (read from service account JSON if not set) ---
    if not os.environ.get("GCP_PROJECT"):
        gac = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "")
        if gac and Path(gac).exists():
            import json
            try:
                sa_data = json.loads(Path(gac).read_text())
                project_id = sa_data.get("project_id", "")
                if project_id:
                    os.environ["GCP_PROJECT"] = project_id
            except (json.JSONDecodeError, KeyError):
                pass

    # --- Google GenAI / ADK Vertex AI configuration ---
    # ADK's Gemini backend uses these env vars to route to Vertex AI
    # instead of the Gemini API (which requires a separate API key).
    os.environ.setdefault("GOOGLE_GENAI_USE_VERTEXAI", "true")
    if os.environ.get("GCP_PROJECT"):
        os.environ.setdefault("GOOGLE_CLOUD_PROJECT", os.environ["GCP_PROJECT"])
    os.environ.setdefault("GOOGLE_CLOUD_LOCATION", "us-east5")

    # --- Exa API Key ---
    if not os.environ.get("EXA_API_KEY"):
        exa_env = _load_env_file(BNBUDDY_CONFIG_DIR / EXA_ENV_FILENAME)
        if "EXA_API_KEY" in exa_env:
            os.environ["EXA_API_KEY"] = exa_env["EXA_API_KEY"]

    # --- DataForSEO (loaded but not strictly required for v2 pipeline) ---
    if not os.environ.get("DATAFORSEO_LOGIN"):
        dfs_env = _load_env_file(BNBUDDY_CONFIG_DIR / DATAFORSEO_ENV_FILENAME)
        for key in ("DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD"):
            if key in dfs_env and not os.environ.get(key):
                os.environ[key] = dfs_env[key]


def run_preflight_checks(config: dict, pipeline_root: str) -> None:
    """Validate that all required credentials and dependencies are available.

    Auto-loads credentials from ~/.config/bnbuddy/ first, then validates.
    Prints warnings for non-blocking issues and exits with an error message
    for blocking ones.

    Args:
        config: Parsed config.yaml.
        pipeline_root: Absolute path to the pipeline v2 directory.
    """
    # Auto-load credentials from BnBuddy config dir
    _auto_load_credentials()

    errors: list[str] = []
    warnings: list[str] = []

    root = Path(pipeline_root)

    # --- GCP Project ---
    gcp_project = os.environ.get("GCP_PROJECT", "")
    config_project = config.get("gcp", {}).get("project", "")
    if not gcp_project and "${GCP_PROJECT}" in config_project:
        errors.append(
            "GCP_PROJECT env var is not set and could not be auto-loaded.\n"
            "  Options:\n"
            "  1. Place service account key at: ~/.config/bnbuddy/bnbuddy-agents-service-account.json\n"
            "  2. Set GCP_PROJECT env var manually\n"
            "  3. Replace ${GCP_PROJECT} in config.yaml with your project ID"
        )
    elif gcp_project:
        print(f"  📋 GCP Project: {gcp_project}")

    # --- GCP Credentials ---
    gcp_creds = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "")
    if gcp_creds:
        creds_path = Path(gcp_creds)
        if not creds_path.exists():
            errors.append(
                f"GOOGLE_APPLICATION_CREDENTIALS points to a missing file: {gcp_creds}"
            )
        else:
            # Show which credential file is being used
            source = "auto-loaded" if str(BNBUDDY_CONFIG_DIR) in gcp_creds else "env var"
            print(f"  🔑 Credentials: {creds_path.name} ({source})")
    else:
        # Check for Application Default Credentials
        adc_path = Path.home() / ".config" / "gcloud" / "application_default_credentials.json"
        if adc_path.exists():
            print(f"  🔑 Credentials: Application Default Credentials")
        else:
            warnings.append(
                "No GCP credentials found. Checked:\n"
                f"  1. GOOGLE_APPLICATION_CREDENTIALS env var (not set)\n"
                f"  2. {BNBUDDY_CONFIG_DIR / SA_KEY_FILENAME} (not found)\n"
                f"  3. {adc_path} (not found)\n"
                "  Vertex AI calls will fail."
            )

    # --- Exa API key ---
    exa_key = os.environ.get("EXA_API_KEY", "")
    if exa_key:
        print(f"  🔍 Exa API: configured ({exa_key[:8]}...)")
    else:
        warnings.append(
            "EXA_API_KEY is not set. SERP research will be skipped.\n"
            f"  Set it in: {BNBUDDY_CONFIG_DIR / EXA_ENV_FILENAME}"
        )

    # --- Writer model format ---
    writer_model = config.get("models", {}).get("writer", "")
    if writer_model and not writer_model.startswith(("vertex_ai/", "gemini-")):
        warnings.append(
            f"Writer model '{writer_model}' does not start with 'vertex_ai/' or 'gemini-'. "
            "LiteLlm routing may not work correctly."
        )

    # --- v1 data directory ---
    v1_data_rel = config.get("paths", {}).get("v1_data", "")
    if v1_data_rel:
        v1_data = root / v1_data_rel
        if not v1_data.exists():
            errors.append(
                f"v1 data directory not found: {v1_data}\n"
                "  The DataPull agent needs this directory for npm script output files."
            )

    # --- Node.js and npm ---
    if not shutil.which("node"):
        errors.append(
            "Node.js is not installed or not in PATH. "
            "The DataPull agent requires Node.js 20+ for npm scripts."
        )
    if not shutil.which("npm"):
        errors.append(
            "npm is not installed or not in PATH. "
            "The DataPull agent requires npm for running data-pull scripts."
        )

    # --- Git ---
    if not shutil.which("git"):
        errors.append(
            "git is not installed or not in PATH. "
            "The Committer agent requires git for committing and pushing."
        )

    # --- Print results ---
    if warnings:
        print(f"\n{'='*60}")
        print("  ⚠️  Pre-flight Warnings")
        print(f"{'='*60}")
        for w in warnings:
            print(f"  ⚠️  {w}")
        print()

    if errors:
        print(f"\n{'='*60}")
        print("  ❌  Pre-flight Failed")
        print(f"{'='*60}")
        for e in errors:
            print(f"  ❌  {e}")
        print(f"\nFix the errors above before running a sprint.\n")
        sys.exit(1)

    print("  ✅  Pre-flight checks passed")
