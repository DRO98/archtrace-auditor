"""Composition root: the one place where the sandbox pieces are created."""

from __future__ import annotations

from llm.service import LlmService
from rag.embeddings import Embedder
from rag.pipeline import RagPipeline
from rag.vector_store import VectorStore

DIMENSIONS = 32


def build_pipeline() -> RagPipeline:
    """Create the vector store, the embedder and the model, then wire them together."""
    store = VectorStore(dimensions=DIMENSIONS)
    embedder = Embedder(dimensions=DIMENSIONS)
    service = LlmService(name="sandbox")
    return RagPipeline(store, embedder, service)


def main() -> None:
    """Index a tiny note and answer one question, to show the whole path."""
    pipeline = build_pipeline()
    pipeline.ingest("welcome", "ArchTrace explains code with a guided path.")
    hits = pipeline.retrieve("what explains code?")
    print(hits)


if __name__ == "__main__":
    main()
