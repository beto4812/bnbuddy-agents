"""Shell command execution tool for ADK agents.

Allows agents to run shell commands (primarily npm scripts and git)
via subprocess. Used by DataPull and Committer agents.

Security: Only commands matching the ALLOWED_COMMANDS prefix list are
permitted. This prevents LLM prompt injection from running arbitrary
shell commands.
"""

import subprocess
from typing import Optional


# Commands the agents are allowed to run (prefix-matched).
# Add new prefixes here when new scripts are introduced.
ALLOWED_COMMANDS = [
    "npm run pull-reddit-research",
    "npm run pull-exa-research",
    "npm run pull-keyword-data",
    "git add",
    "git commit",
    "git push",
    "git pull",
    "git status",
    "git diff",
]


def _is_allowed(command: str) -> bool:
    """Check if a command matches the allowlist (prefix match)."""
    stripped = command.strip()
    return any(stripped.startswith(prefix) for prefix in ALLOWED_COMMANDS)


def run_shell_command(
    command: str,
    cwd: Optional[str] = None,
    timeout: int = 300,
) -> str:
    """Run a shell command and return its stdout output.

    Only commands matching the ALLOWED_COMMANDS prefix list are permitted.

    Args:
        command: The shell command to execute.
        cwd: Working directory. Defaults to repo root.
        timeout: Max seconds before killing the process.

    Returns:
        Combined stdout and stderr as a string, prefixed with exit code.
    """
    if not _is_allowed(command):
        return (
            f"[error] Command not allowed: {command}\n"
            f"Allowed command prefixes: {ALLOWED_COMMANDS}"
        )

    try:
        # Use Popen to stream output in real-time to the console
        process = subprocess.Popen(
            command,
            shell=True,
            cwd=cwd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1, # Line buffered
        )
        
        output_lines = []
        # Read line by line as they are emitted
        if process.stdout:
            for line in process.stdout:
                # Print to the user's terminal so they see progress
                print(f"    [shell] {line}", end="")
                output_lines.append(line)
                
        # Wait for the process to finish, applying the timeout
        process.wait(timeout=timeout)
        output = "".join(output_lines)
        return f"[exit code: {process.returncode}]\n{output}".strip()
        
    except subprocess.TimeoutExpired:
        if process:
            process.kill()
        return f"[error] Command timed out after {timeout}s: {command}"
    except Exception as e:
        return f"[error] Failed to run command: {e}"
