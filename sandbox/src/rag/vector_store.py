"""In-memory vector store used by the ArchTrace sandbox.

This module is sample code so the extension can open, scroll, and highlight
a real file. It is not wired to a model runtime.
"""

from __future__ import annotations

from dataclasses import dataclass
from math import sqrt
from typing import Iterable, Sequence


@dataclass(frozen=True)
class VectorRecord:
    """One embedded chunk kept in the store."""

    record_id: str
    text: str
    values: tuple[float, ...]
    source: str


class VectorStore:
    """Tiny cosine-similarity index for classroom demos."""

    def __init__(self, dimensions: int) -> None:
        if dimensions <= 0:
            raise ValueError("dimensions must be positive")
        self.dimensions = dimensions
        self._records: dict[str, VectorRecord] = {}

    def upsert(self, record: VectorRecord) -> None:
        """Insert or replace a record after checking its width."""
        self._require_width(record.values)
        self._records[record.record_id] = record

    def add_many(self, records: Iterable[VectorRecord]) -> int:
        """Store several records and return how many were written."""
        written = 0
        for record in records:
            self.upsert(record)
            written += 1
        return written

    def delete(self, record_id: str) -> bool:
        """Remove a record. Returns False when the id is unknown."""
        if record_id not in self._records:
            return False
        del self._records[record_id]
        return True

    def get(self, record_id: str) -> VectorRecord | None:
        return self._records.get(record_id)

    def search(self, query: Sequence[float], limit: int = 5) -> list[tuple[VectorRecord, float]]:
        """Return the closest records, highest cosine similarity first."""
        self._require_width(query)
        if limit <= 0:
            return []

        ranked: list[tuple[VectorRecord, float]] = []
        for record in self._records.values():
            score = cosine_similarity(query, record.values)
            ranked.append((record, score))

        ranked.sort(key=lambda item: item[1], reverse=True)
        return ranked[:limit]

    def __len__(self) -> int:
        return len(self._records)

    def _require_width(self, values: Sequence[float]) -> None:
        if len(values) != self.dimensions:
            raise ValueError(
                f"expected {self.dimensions} dimensions, got {len(values)}"
            )


def cosine_similarity(left: Sequence[float], right: Sequence[float]) -> float:
    """Cosine similarity in [0, 1] for non-negative demo vectors."""
    if len(left) != len(right):
        raise ValueError("vectors must share a dimension")

    dot = 0.0
    left_norm = 0.0
    right_norm = 0.0
    for a, b in zip(left, right):
        dot += a * b
        left_norm += a * a
        right_norm += b * b

    if left_norm == 0.0 or right_norm == 0.0:
        return 0.0
    return dot / (sqrt(left_norm) * sqrt(right_norm))
