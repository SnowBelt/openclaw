#!/usr/bin/env python3
"""Shared Pattern Lab local source-lead comment prompts."""

LOCAL_SOURCE_LEAD_TERMS = (
    "street",
    "business",
    "church",
    "club",
    "building",
    "school",
    "theater",
    "factory",
    "map",
    "photo",
    "neighborhood",
    "family story",
    "family",
)

GENERIC_COMMENT_PROMPTS = (
    "what do you think",
    "thoughts?",
    "comment below",
    "let us know",
    "which city should get a pattern lab city file next",
    "do you trust old photos more than modern summaries",
)


def city_source_lead_comment(city, places=None):
    city = str(city or "").strip()
    if not city:
        raise ValueError("comment_prompt_city_missing")
    places = [str(place).strip() for place in (places or []) if str(place).strip()]
    place_text = ", ".join(places[:4])
    if place_text:
        return (
            f"{city} source hunt: did your family remember {place_text}, a club, church, business, "
            "school, theater, factory, street, photo, map, or building that disappeared from this story? "
            "Leave the name below. Pattern Lab may use viewer memories as leads for a future source trail."
        )
    return (
        f"{city} source hunt: did your family remember a street, business, church, club, building, school, "
        "theater, factory, map, photo, neighborhood, or family story tied to this place? Leave the name below. "
        "Pattern Lab may use viewer memories as leads for a future source trail."
    )


def video04_script_comment_ask():
    return (
        "Detroit locals: if your family remembers Black Bottom, Paradise Valley, Hastings Street, "
        "St. Antoine, or a business that disappeared from this map, leave the name below. "
        "Pattern Lab may follow your lead in a future source trail."
    )


def is_generic_comment_prompt(text):
    lower = str(text or "").lower()
    return any(prompt in lower for prompt in GENERIC_COMMENT_PROMPTS)


def local_source_lead_terms_present(text):
    lower = str(text or "").lower()
    return [term for term in LOCAL_SOURCE_LEAD_TERMS if term in lower]
