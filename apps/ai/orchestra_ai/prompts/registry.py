# ============================================================================
# Orchestra Part 7 — Prompt Registry (file-based)
# Source of truth: Part 7 § "The prompt registry"
# ============================================================================

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

PROMPTS_DIR = Path(__file__).parent.parent.parent / "prompts"  # apps/ai/prompts


@dataclass(frozen=True)
class PromptRef:
    id: str
    version: str
    content: str


class PromptRegistry:
    """Registry of versioned prompts loaded from files."""

    def __init__(self) -> None:
        self._cache: dict[str, dict[str, str]] = {}

    def _load(self, prompt_id: str) -> dict[str, str]:
        """Load all versions of a prompt from the prompts directory."""
        if prompt_id in self._cache:
            return self._cache[prompt_id]

        versions: dict[str, str] = {}
        parts = prompt_id.split("/")
        name = parts[-1]
        nested = Path(*parts[:-1]) if len(parts) > 1 else Path()
        search_dirs = [PROMPTS_DIR, PROMPTS_DIR / nested, Path(__file__).resolve().parents[2] / "prompts"]
        for search_dir in search_dirs:
            if not search_dir.exists():
                continue
            for f in search_dir.glob(f"{name}_v*.txt"):
                stem = f.stem
                if "_v" in stem:
                    version = stem.split("_v")[-1]
                    versions[f"v{version}"] = f.read_text(encoding="utf-8")
            for f in search_dir.glob(f"**/{prompt_id.replace('/', '_')}_v*.txt"):
                stem = f.stem
                if "_v" in stem:
                    version = stem.split("_v")[-1]
                    versions[f"v{version}"] = f.read_text(encoding="utf-8")

        self._cache[prompt_id] = versions
        return versions

    def render(
        self,
        prompt_id: str,
        version: str = "v1",
        variables: dict[str, str] | None = None,
    ) -> str:
        """Render a prompt with variable substitution."""
        versions = self._load(prompt_id)

        template = versions.get(version)
        if not template:
            # Fallback to any available version
            if versions:
                template = next(iter(versions.values()))
            else:
                raise ValueError(f"PROMPT_NOT_FOUND: {prompt_id}@{version}")

        result = template
        if variables:
            for key, value in variables.items():
                placeholder = "{{" + key + "}}"
                result = result.replace(placeholder, value)

        # Check for unresolved placeholders
        unresolved = re.findall(r"\{\{(\w+)\}\}", result)
        if unresolved and variables:
            missing = set(unresolved) - set(variables.keys())
            if missing:
                raise ValueError(f"MISSING_VARIABLES: {missing} in prompt {prompt_id}")

        return result

    def get_ref(self, prompt_id: str, version: str = "v1") -> PromptRef:
        """Get a prompt reference for logging."""
        versions = self._load(prompt_id)
        content = versions.get(version, "")
        return PromptRef(id=prompt_id, version=version, content=content)

    def versions(self, prompt_id: str) -> list[str]:
        """List available versions for a prompt."""
        return list(self._load(prompt_id).keys())
