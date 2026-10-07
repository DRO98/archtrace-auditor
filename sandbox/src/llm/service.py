"""Stand-in language model used by the sandbox pipeline.

`complete` echoes a short, deterministic reply so the rest of the graph can
run without an API key. `stream_tokens` only splits that reply for the UI.
"""

from __future__ import annotations

from llm.prompts import PROMPT, build_prompt


class LlmService:
    """Produce a fixed style of answer from a finished prompt."""

    def __init__(self, name: str = "sandbox") -> None:
        self.name = name

    def complete(self, prompt: str) -> str:
        """Return a short reply that quotes the prompt length."""
        text = prompt.strip()
        if not text:
            raise ValueError("prompt is required")
        if not text.startswith(PROMPT):
            text = build_prompt(text, "")
        preview = text.replace("\n", " ")[:80]
        return f"[{self.name}] {len(text)} chars :: {preview}"


def stream_tokens(text: str) -> list[str]:
    """Yield whitespace-separated pieces, keeping a trailing space on each."""
    parts = text.split(" ")
    tokens: list[str] = []
    for index, part in enumerate(parts):
        if not part:
            continue
        if index < len(parts) - 1:
            tokens.append(part + " ")
        else:
            tokens.append(part)
    return tokens
