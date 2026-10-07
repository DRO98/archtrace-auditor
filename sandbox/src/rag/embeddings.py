"""Tiny bag-of-words embedder used by the classroom RAG pipeline.

Vectors are deterministic hashes into a fixed width. They are not a model.
"""

from __future__ import annotations

from collections import Counter


def normalize(token: str) -> str:
    """Lowercase a token and drop characters that are not letters or digits."""
    kept = []
    for char in token.lower():
        if char.isalnum():
            kept.append(char)
    return "".join(kept)


class Embedder:
    """Map text to a dense vector of `dimensions` buckets."""

    def __init__(self, dimensions: int = 32) -> None:
        if dimensions <= 0:
            raise ValueError("dimensions must be positive")
        self.dimensions = dimensions

    def embed(self, text: str) -> list[float]:
        """Count normalized tokens into the configured number of buckets."""
        counts: Counter[int] = Counter()
        for raw in text.split():
            token = normalize(raw)
            if not token:
                continue
            counts[hash(token) % self.dimensions] += 1

        total = sum(counts.values())
        if total == 0:
            return [0.0] * self.dimensions

        vector = [0.0] * self.dimensions
        for bucket, seen in counts.items():
            vector[bucket] = seen / total
        return vector

    def embed_many(self, texts: list[str]) -> list[list[float]]:
        """Embed each text independently, preserving order."""
        return [self.embed(text) for text in texts]
