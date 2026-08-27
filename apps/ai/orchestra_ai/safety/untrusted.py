# ============================================================================
# Orchestra Part 9 — Untrusted data handling
# Source of truth: Part 9 § "Prompt-injection defence at run time"
# Untrusted data never enters a system prompt. It goes in the user message,
# inside explicit delimiters, framed as data.
# ============================================================================

from __future__ import annotations

import re


def wrap_untrusted(label: str, content: str) -> str:
    """
    Wrap untrusted data in explicit delimiters so it cannot be mistaken
    for instructions. The model sees this as data, not directives.
    """
    safe = content[:100_000]  # Hard limit
    return f"<{label}>\n{safe}\n</{label}>"


# Patterns that suggest exfiltration attempts in model output
EXFILTRATION_PATTERNS = [
    r"(?:ignore|disregard|forget)\s+(?:previous|above|all)\s+(?:instructions?|rules?)",
    r"you\s+are\s+now\s+(?:a|an)\s+",
    r"system\s*:\s*",
    r"<\|system\|>",
    r"\[INST\]",
    r"```.*(?:curl|wget|fetch|eval|exec|import\s+os)",
    r"(?:api[_-]?key|secret|password|token)\s*[:=]\s*\S+",
]


def scan_output(text: str) -> tuple[bool, str | None]:
    """
    Scan model output for exfiltration patterns.
    Returns (safe, reason) — safe=True means output is clean.
    Detection is not a hard block; it's recorded as a flag.
    """
    for pattern in EXFILTRATION_PATTERNS:
        if re.search(pattern, text, re.IGNORECASE):
            return False, f"exfiltration_pattern_matched: {pattern}"
    return True, None
