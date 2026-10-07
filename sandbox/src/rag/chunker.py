"""Split plain text into overlapping windows for the sandbox index."""

from __future__ import annotations


def _collapse(text: str) -> str:
    """Join whitespace so windows do not start or end on blank runs."""
    return " ".join(text.split())


def chunk_text(text: str, size: int = 240, overlap: int = 40) -> list[str]:
    """Return trimmed windows. The last window may be shorter than size."""
    if size <= 0:
        raise ValueError("size must be positive")
    if overlap < 0 or overlap >= size:
        raise ValueError("overlap must be smaller than size")

    cleaned = _collapse(text)
    if not cleaned:
        return []
    if len(cleaned) <= size:
        return [cleaned]

    step = size - overlap
    chunks: list[str] = []
    start = 0
    while start < len(cleaned):
        end = min(start + size, len(cleaned))
        window = cleaned[start:end].strip()
        if window:
            chunks.append(window)
        if end == len(cleaned):
            break
        start += step
    return chunks


def chunk_count(text: str, size: int = 240, overlap: int = 40) -> int:
    """How many windows chunk_text would emit for the same arguments."""
    return len(chunk_text(text, size=size, overlap=overlap))
