"""HTTP-shaped entry points for the ArchTrace sandbox.

These handlers stay synchronous and in-memory so the canvas can point at
real functions without standing up a server.
"""

from __future__ import annotations

from llm.service import LlmService, stream_tokens
from rag.pipeline import RagPipeline


def _slug(title: str) -> str:
    """Turn a title into a stable document id."""
    pieces: list[str] = []
    for char in title.strip().lower():
        if char.isalnum():
            pieces.append(char)
        elif pieces and pieces[-1] != "-":
            pieces.append("-")
    slug = "".join(pieces).strip("-")
    if not slug:
        raise ValueError("title is required")
    return slug


def ingest_document(pipeline: RagPipeline, title: str, body: str) -> int:
    """Store one document and return how many chunks were indexed."""
    if not body.strip():
        raise ValueError("body is required")
    document_id = _slug(title)
    written = pipeline.ingest(document_id, body)
    if written == 0:
        raise ValueError("document produced no chunks")
    return written


def ask_question(pipeline: RagPipeline, service: LlmService, question: str) -> str:
    """Retrieve supporting chunks and ask the language model for an answer."""
    cleaned = " ".join(question.split())
    if not cleaned:
        raise ValueError("question is required")

    hits = pipeline.retrieve(cleaned, limit=4)
    if not hits:
        return "No matching notes were found."

    lines = [f"({score:.2f}) {text}" for text, score in hits]
    prompt = pipeline.answer(cleaned, "\n".join(lines))
    reply = service.complete(prompt)
    return "".join(stream_tokens(reply))
