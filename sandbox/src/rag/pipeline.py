"""Glue between chunking, embeddings, the vector store, and the LLM."""

from __future__ import annotations

from llm.service import LlmService
from rag.chunker import chunk_text
from rag.embeddings import Embedder
from rag.vector_store import VectorRecord, VectorStore


class RagPipeline:
    """Index short documents and answer a question from the nearest chunks."""

    def __init__(self, store: VectorStore, embedder: Embedder, service: LlmService) -> None:
        self.store = store
        self.embedder = embedder
        self.service = service

    def ingest(self, document_id: str, text: str) -> int:
        """Chunk a document, embed each window, and upsert it."""
        written = 0
        for index, chunk in enumerate(chunk_text(text)):
            values = tuple(self.embedder.embed(chunk))
            record = VectorRecord(
                record_id=f"{document_id}:{index}",
                text=chunk,
                values=values,
                source=document_id,
            )
            self.store.upsert(record)
            written += 1
        return written

    def retrieve(self, question: str, limit: int = 4) -> list[tuple[str, float]]:
        """Return the closest chunk texts and their cosine scores."""
        query = self.embedder.embed(question)
        hits = self.store.search(query, limit=limit)
        return [(record.text, score) for record, score in hits]

    def answer(self, question: str, context: str) -> str:
        """Ask the language model to answer using only the given context."""
        prompt = f"Question: {question}\nContext:\n{context}"
        return self.service.complete(prompt)
