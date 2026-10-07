"""Small file-backed note database for the ArchTrace sandbox."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterator


@dataclass
class Note:
    note_id: str
    title: str
    body: str
    pinned: bool = False


class Database:
    """JSON document store with an explicit load/save cycle."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._notes: dict[str, Note] = {}

    def load(self) -> None:
        """Read notes from disk. A missing file starts an empty store."""
        if not self.path.exists():
            self._notes = {}
            return
        raw = json.loads(self.path.read_text(encoding="utf-8"))
        self._notes = {item["note_id"]: Note(**item) for item in raw}

    def save(self) -> None:
        """Persist the current notes, creating parent folders if needed."""
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = [asdict(note) for note in self._notes.values()]
        self.path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    def insert(self, note: Note) -> None:
        if note.note_id in self._notes:
            raise KeyError(f"note already exists: {note.note_id}")
        self._notes[note.note_id] = note

    def update(self, note: Note) -> None:
        if note.note_id not in self._notes:
            raise KeyError(f"unknown note: {note.note_id}")
        self._notes[note.note_id] = note

    def delete(self, note_id: str) -> None:
        if note_id not in self._notes:
            raise KeyError(f"unknown note: {note_id}")
        del self._notes[note_id]

    def get(self, note_id: str) -> Note | None:
        return self._notes.get(note_id)

    def list_notes(self) -> Iterator[Note]:
        """Yield pinned notes first, then the rest by title."""
        notes = list(self._notes.values())
        notes.sort(key=lambda note: (not note.pinned, note.title.lower()))
        yield from notes

    def __len__(self) -> int:
        return len(self._notes)
