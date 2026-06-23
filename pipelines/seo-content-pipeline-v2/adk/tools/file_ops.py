"""File operation tools for ADK agents.

Provides read, write, and list operations for the pipeline's
content and data directories.
"""

import os
from pathlib import Path
from typing import Optional


def read_file(path: str) -> str:
    """Read the contents of a file.

    Args:
        path: Absolute or relative path to the file.

    Returns:
        File contents as a string, or an error message.
    """
    try:
        return Path(path).read_text(encoding="utf-8")
    except FileNotFoundError:
        return f"[error] File not found: {path}"
    except Exception as e:
        return f"[error] Failed to read {path}: {e}"


def write_file(path: str, content: str) -> str:
    """Write content to a file, creating parent directories if needed.

    Args:
        path: Absolute or relative path for the output file.
        content: The full file content to write.

    Returns:
        Confirmation message with the file path and byte count.
    """
    try:
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")
        print(f"    [write] {path} ({len(content):,} bytes)")
        return f"[ok] Written {len(content)} bytes to {path}"
    except Exception as e:
        return f"[error] Failed to write {path}: {e}"


def list_directory(path: str, pattern: Optional[str] = "*.md") -> str:
    """List files in a directory matching a glob pattern.

    Args:
        path: Directory path to list.
        pattern: Glob pattern to filter files. Defaults to '*.md'.

    Returns:
        Newline-separated list of matching file paths.
    """
    try:
        p = Path(path)
        if not p.is_dir():
            return f"[error] Not a directory: {path}"
        files = sorted(p.glob(pattern))
        if not files:
            return f"[info] No files matching '{pattern}' in {path}"
        return "\n".join(str(f) for f in files)
    except Exception as e:
        return f"[error] Failed to list {path}: {e}"
