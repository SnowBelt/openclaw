"""Exact complete-sentence alignment helpers for Pattern Lab Shorts."""
from __future__ import annotations

import difflib
import re
from typing import Any


def normalize(value: str) -> list[str]:
    value = str(value or "").lower().replace("’", "'")
    value = re.sub(r"'s\b", "", value)
    return re.findall(r"[a-z0-9]+", value)


def locate_sentence(words: list[dict[str, Any]], sentence: str) -> tuple[float, float]:
    wanted = normalize(sentence)
    if not wanted:
        raise ValueError("short_narration_sentence_empty")
    aligned: list[str] = []
    source_indices: list[int] = []
    for source_index, row in enumerate(words):
        for token in normalize(str(row.get("word") or row.get("text") or "")):
            aligned.append(token)
            source_indices.append(source_index)
    for start in range(0, len(aligned) - len(wanted) + 1):
        if aligned[start : start + len(wanted)] == wanted:
            first = source_indices[start]
            last = source_indices[start + len(wanted) - 1]
            return max(0.0, float(words[first]["start"]) - 0.045), float(words[last]["end"]) + 0.08
    best: tuple[float, int, int] | None = None
    for length in range(max(3, len(wanted) - 1), len(wanted) + 2):
        for start in range(0, len(aligned) - length + 1):
            candidate = aligned[start : start + length]
            if candidate[: min(4, len(wanted))] != wanted[: min(4, len(wanted))]:
                continue
            ratio = difflib.SequenceMatcher(a=wanted, b=candidate, autojunk=False).ratio()
            if best is None or ratio > best[0]:
                best = (ratio, start, length)
    if best and best[0] >= 0.86:
        _, start, length = best
        first = source_indices[start]
        last = source_indices[start + length - 1]
        return max(0.0, float(words[first]["start"]) - 0.045), float(words[last]["end"]) + 0.08
    raise ValueError(f"approved_narration_sentence_not_found:{sentence}")


def locate_all(words: list[dict[str, Any]], sentences: list[str]) -> list[tuple[float, float]]:
    return [locate_sentence(words, sentence) for sentence in sentences]
