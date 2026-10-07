"""Prompt text for the sandbox tutor.

The wording stays short on purpose: the canvas highlights this function
when a lesson jumps into prompt construction.
"""

from __future__ import annotations

PROMPT = (
    "You are a patient programming tutor. Explain the idea in plain language, "
    "then point at the inputs and outputs. Do not invent files that were not provided."
)

_MAX_NOTES = 1200


def _clip(text: str, limit: int) -> str:
    """Keep the start of a note so a prompt cannot grow without bound."""
    collapsed = " ".join(text.split())
    if len(collapsed) <= limit:
        return collapsed
    return collapsed[: limit - 1].rstrip() + "…"


def build_prompt(question: str, context: str) -> str:
    """Combine the standing instructions with one question and its notes."""
    cleaned_question = _clip(question, 400)
    if not cleaned_question:
        raise ValueError("question is required")

    notes = _clip(context, _MAX_NOTES) if context.strip() else "(no matching notes)"
    return (
        f"{PROMPT}\n\n"
        f"Notes:\n{notes}\n\n"
        f"Question: {cleaned_question}\n"
        "Answer:"
    )


def prompt_length(question: str, context: str) -> int:
    """Character count of the prompt that build_prompt would send."""
    return len(build_prompt(question, context))
