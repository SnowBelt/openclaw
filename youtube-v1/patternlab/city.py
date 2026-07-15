"""Explicit city identity helpers for every Pattern Lab production surface.

Pattern Lab never guesses a city from a video id, title, prior episode, or
global default.  Callers either provide the city in the episode/topic contract
or fail closed before generating public-facing text or media.
"""
from __future__ import annotations

from typing import Any, Iterable


class CityContractError(ValueError):
    """Raised when an episode has no single explicit city identity."""


def normalize_city(value: Any) -> str:
    return " ".join(str(value or "").strip().split())


def require_city(value: Any, *, source: str = "episode") -> str:
    city = normalize_city(value)
    if not city:
        raise CityContractError(f"{source}_city_missing")
    if len(city) > 80 or any(character in city for character in "\r\n\t"):
        raise CityContractError(f"{source}_city_invalid")
    return city


def topic_city(topic: dict[str, Any]) -> str:
    return require_city(topic.get("city"), source="topic")


def city_from_sources(
    sources: Iterable[tuple[str, Any]],
    *,
    required: bool = True,
) -> str:
    """Return one matching city across named sources or raise on ambiguity."""
    values = [(name, normalize_city(value)) for name, value in sources]
    present = [(name, value) for name, value in values if value]
    if not present:
        if required:
            raise CityContractError("episode_city_missing_explicit_field")
        return ""
    normalized = {value.casefold() for _, value in present}
    if len(normalized) != 1:
        details = ",".join(f"{name}={value}" for name, value in present)
        raise CityContractError(f"episode_city_mismatch:{details}")
    return present[0][1]
