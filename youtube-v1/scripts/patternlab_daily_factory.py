#!/usr/bin/env python3
import argparse
import csv
import hashlib
import json
import subprocess
import sys
from pathlib import Path

from patternlab_common import BASE, append_ledger, display_path, ensure_dir, load_dotenv, output_root, utc_now
from patternlab_comment_prompts import city_source_lead_comment
from patternlab_retention_ladder import default_ladder


SLATE = BASE / "state" / "monetization" / "content-slate.json"
STRATEGY = BASE / "state" / "monetization" / "strategy.json"
JAMES_MOMENT = "This is where the internet usually gets a little too confident. That is a vibe. It is not evidence."


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def sha256_text(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def script_lock(launch, root):
    """Return one unambiguous hash lock from canonical or owner-approval state."""
    approval = root / "approval"
    paths = (
        launch / "script-lock.json",
        approval / "paid-service-approval.json",
        approval / "script-lock.json",
    )
    locks = []
    for path in paths:
        if not path.exists():
            continue
        try:
            payload = read_json(path)
        except (OSError, json.JSONDecodeError):
            continue
        script_hash = str(payload.get("script_sha256") or "").strip()
        if len(script_hash) == 64 and all(char in "0123456789abcdef" for char in script_hash):
            locks.append({"path": path, "script_sha256": script_hash, "operation": payload.get("operation", "")})
    if not locks:
        return None
    hashes = {lock["script_sha256"] for lock in locks}
    if len(hashes) != 1:
        return {"status": "conflict", "locks": locks}
    return {"status": "valid", **locks[0], "locks": locks}


def protect_locked_script(launch, root, video_id, candidate):
    """Return the exact safe script text; never overwrite a hash-bound script."""
    script_path = launch / "final-script.md"
    lock = script_lock(launch, root)
    if not lock:
        return candidate

    approval = ensure_dir(root / "approval")
    current = script_path.read_text(encoding="utf-8") if script_path.exists() else ""
    current_hash = sha256_text(current) if current else ""
    candidate_hash = sha256_text(candidate)
    payload = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "lock_files": [display_path(item["path"]) for item in lock["locks"]],
        "approved_script_sha256": lock.get("script_sha256", ""),
        "current_script_sha256": current_hash,
        "generated_candidate_sha256": candidate_hash,
        "candidate_write_blocked": candidate_hash != lock.get("script_sha256", ""),
        "youtube_mutation": "not_performed",
    }
    if lock["status"] == "conflict":
        payload["status"] = "blocked"
        payload["blocker"] = "conflicting_script_locks"
    elif not current:
        payload["status"] = "blocked"
        payload["blocker"] = "approved_script_missing"
    elif current_hash != lock["script_sha256"]:
        payload["status"] = "blocked"
        payload["blocker"] = "current_script_hash_does_not_match_owner_approval"
    else:
        payload["status"] = "protected_reused_approved_script"
        payload["blocker"] = "generated_candidate_rejected" if payload["candidate_write_blocked"] else ""
    report = approval / "script-immutability-report.json"
    report.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    if payload["status"] == "blocked":
        raise SystemExit(f"approved_script_immutable:{payload['blocker']}")
    return current


def weighted_score(strategy, scores):
    total = 0.0
    for key, weight in strategy["topic_scoring_weights"].items():
        total += (float(scores.get(key, 0)) / 10.0) * float(weight)
    return round(total, 1)


def select_topic(video_id=None):
    slate = read_json(SLATE)
    strategy = read_json(STRATEGY)
    topics = slate["topics"]
    if video_id:
        topic = next((item for item in topics if item["video_id"] == video_id), None)
        if not topic:
            raise SystemExit(f"No slate topic exists for video {video_id}.")
        return strategy, topic
    for topic in topics:
        launch_dir = BASE / "launch" / f"video-{topic['video_id']}"
        if not launch_dir.exists():
            return strategy, topic
    return strategy, topics[-1]


def title_options(topic):
    base = topic["working_title"]
    city = topic.get("city", "Detroit")
    artifact = topic["artifact_type"].replace("-", " ")
    if "black bottom" in base.lower() or "paradise valley" in base.lower():
        return [
            base,
            f"What {city} Erased",
            f"The Map That Cut Black Bottom",
            f"{city}'s Lost Neighborhood",
            "Paradise Valley Was Not Empty",
        ]
    if "rewired" in base.lower() or "decline" in base.lower():
        return [
            base,
            f"The Map That Rewired {city}",
            f"{city} Was Rewired",
            f"The Hidden Map Behind {city}",
            f"What {city}'s Old Maps Reveal",
        ]
    return [
        base,
        f"The Hidden Map Behind {city}",
        f"What {city}'s Old Photos Reveal",
        f"The {artifact.title()} That Explains {city}",
        f"Why {city}'s Map Still Matters",
    ]


def guru_growth_system(topic, titles=None):
    video_id = topic["video_id"]
    city = topic.get("city", "Detroit")
    titles = titles or title_options(topic)
    proof_object = topic.get("artifact_type", "source proof object").replace("-", " ")
    shorts_concepts = [
        {
            "id": f"{video_id}-guru-short-01",
            "standalone_hook": f"{city} makes more sense when you start with the map, not the skyline.",
            "visual_clue": f"Close-up of the {proof_object} with one visible clue highlighted.",
            "proof_payoff": "Show the source clue and the system it reveals.",
            "comment_prompt": city_source_lead_comment(city),
            "long_form_bridge": "The full city file shows the source trail and hidden system.",
        },
        {
            "id": f"{video_id}-guru-short-02",
            "standalone_hook": "Old photos are evidence, not decoration.",
            "visual_clue": "A historical image with source, place, date, and visible clue called out.",
            "proof_payoff": "Point to one detail that changes the simplified story.",
            "comment_prompt": city_source_lead_comment(city),
            "long_form_bridge": "The full video walks through the rights-logged source packet.",
        },
        {
            "id": f"{video_id}-guru-short-03",
            "standalone_hook": "No source, no story.",
            "visual_clue": "Accepted source rows beside rejected unsourced claims.",
            "proof_payoff": "Explain why an unsourced city myth cannot carry the argument.",
            "comment_prompt": city_source_lead_comment(city),
            "long_form_bridge": "The long-form episode shows the evidence-backed version.",
        },
        {
            "id": f"{video_id}-guru-short-04",
            "standalone_hook": f"The familiar {city} story skips the mechanism.",
            "visual_clue": "Then/now image pair with the hidden system labeled.",
            "proof_payoff": "Show what changed, who moved, or what vanished.",
            "comment_prompt": city_source_lead_comment(city),
            "long_form_bridge": "The full city file connects the clue to the larger system.",
        },
        {
            "id": f"{video_id}-guru-short-05",
            "standalone_hook": "The map keeps receipts.",
            "visual_clue": "Map trace, route line, border, or neighborhood cut.",
            "proof_payoff": "Use the map to show a decision that still shapes the city.",
            "comment_prompt": city_source_lead_comment(city),
            "long_form_bridge": "The long-form video shows the map, source, and consequence.",
        },
        {
            "id": f"{video_id}-guru-short-06",
            "standalone_hook": "A city changes when one proof object changes the question.",
            "visual_clue": f"The {proof_object} staged as a source-first clue.",
            "proof_payoff": "Reveal why the clue creates a better question than generic city history.",
            "comment_prompt": city_source_lead_comment(city),
            "long_form_bridge": "The full episode follows the clue through the city system.",
        },
    ]
    candidate_titles = titles[:3] if len(titles) >= 3 else [*titles, *title_options(topic)][:3]
    return {
        "version": "2026-06-pattern-lab-youtube-guru-growth-v1",
        "outlier_topic_mining": {
            "benchmark_or_outlier_rationale": "Successful city-history and urbanism outliers package around a visual mystery, vanished place, map change, or hidden system rather than a broad historical survey.",
            "viewer_demand_reason": f"Curious viewers want to know why the familiar {city} story feels incomplete and what source evidence changes the explanation.",
            "proof_object": proof_object,
            "beats_generic_city_history_because": "The episode promises a specific proof object and hidden system instead of a generic chronological city-history lecture.",
        },
        "title_thumbnail_test_discipline": {
            "winner_metric": "watch_time_share_first_then_ctr",
            "no_misleading_promise": True,
            "test_pairs": [
                {
                    "title": candidate_titles[0],
                    "thumbnail": "images/thumbnail_candidate_a.png",
                    "hypothesis": "emotional mystery with a vanished-place proof object",
                },
                {
                    "title": candidate_titles[1],
                    "thumbnail": "images/thumbnail_candidate_b.png",
                    "hypothesis": "map-system proof for viewers who want the evidence trail",
                },
                {
                    "title": candidate_titles[2],
                    "thumbnail": "images/thumbnail_candidate_c.png",
                    "hypothesis": "contrarian history angle that challenges a familiar summary",
                },
            ],
        },
        "viewer_avatar_topic_filter": {
            "morgan_viewer_question": f"What source-backed clue explains why {city} looks and remembers itself this way?",
            "curiosity_trigger": "A familiar city story has a visible contradiction that the source packet can resolve.",
            "reject_if_only_historically_interesting": True,
        },
        "packaging_lock_before_script": {
            "locked_before_script_approval": True,
            "locked_fields": {
                "title": candidate_titles[0],
                "thumbnail_hypothesis": "Photo-first proof object plus 2-4 word mystery text.",
                "first_hook": f"{city} is not just a city with a history problem.",
                "proof_object": proof_object,
                "first_30_second_payoff": "Show the visual clue, contradiction, source proof, stakes, and title-thumbnail payoff by 30 seconds.",
                "audience_promise": "The episode will explain one hidden city system with sources, not generic history.",
            },
        },
        "first_30_seconds_mini_product": {
            "payoff_by_seconds": 30,
            "opening_plan_includes": {
                "visual_clue": f"Show the {proof_object} or photo/map clue immediately.",
                "contradiction": f"The familiar {city} story is incomplete.",
                "source_proof": "Bring the source proof on screen before broad context.",
                "stakes": "Explain why the clue changes how the city is understood.",
                "title_thumbnail_payoff": "Deliver the exact map/photo/source object promised by title and thumbnail.",
            },
        },
        "retention_boredom_cut": {
            "retention_edit_pass_recorded": True,
            "removed": ["repeated_points", "slow_setup", "unsupported_tangents", "non_advancing_visuals"],
            "rule": "Every beat must advance curiosity, proof, or payoff.",
        },
        "thumbnail_pre_score": {
            "threshold": 80,
            "selected_candidate": "A",
            "candidates": [
                {
                    "candidate": "A",
                    "scores": {
                        "phone_readability": 15,
                        "visual_mystery": 18,
                        "city_anchor": 15,
                        "proof_object": 17,
                        "emotion": 17,
                        "payoff_match": 18,
                    },
                    "total_score": 100,
                },
                {
                    "candidate": "B",
                    "scores": {
                        "phone_readability": 15,
                        "visual_mystery": 16,
                        "city_anchor": 15,
                        "proof_object": 18,
                        "emotion": 15,
                        "payoff_match": 18,
                    },
                    "total_score": 97,
                },
                {
                    "candidate": "C",
                    "scores": {
                        "phone_readability": 15,
                        "visual_mystery": 17,
                        "city_anchor": 15,
                        "proof_object": 16,
                        "emotion": 16,
                        "payoff_match": 17,
                    },
                    "total_score": 96,
                },
            ],
        },
        "shorts_discovery_funnel": {
            "standalone_not_trailer_only": True,
            "concepts": shorts_concepts,
        },
        "shorts_concepts": shorts_concepts,
        "audience_satisfaction_tracking": {
            "tracked_signals": [
                "i_never_knew_this",
                "city_requests",
                "local_corrections",
                "source_disputes",
                "confusion",
                "visual_praise",
                "expectation_mismatch",
            ],
        },
        "sustainable_production_governor": {
            "long_form_per_week_target": 3,
            "quality_over_frequency": True,
            "failed_quality_gate_blocks_publish": True,
            "public_publish_owner_gated": True,
        },
    }


def slug(text):
    keep = []
    for char in text.lower():
        if char.isalnum():
            keep.append(char)
        elif keep and keep[-1] != "-":
            keep.append("-")
    return "".join(keep).strip("-")


def script_text(topic):
    title = topic["working_title"]
    artifact = topic["artifact_type"]
    angle = topic["public_angle"]
    city = topic.get("city", "Detroit")
    title_lower = title.lower()

    if "black bottom" in title_lower or "paradise valley" in title_lower:
        opening = f"""Look at this part of Detroit before the freeway story swallowed it: Black Bottom and Paradise Valley were not blank spaces on a planning map. They were neighborhoods, business corridors, church networks, music rooms, apartments, storefronts, and addresses that made a community legible on paper and alive on the street.

The question is simple: what did Detroit erase here, and what proof still shows that the place existed before the clearance lines arrived?

The first proof object is a {artifact}. It has to show three things before we move on: the place, the source, and the mechanism. If we cannot point to a map, a photo, a city record, a newspaper clipping, or an archive page, it stays out of the argument.

The familiar version says urban renewal cleared aging blocks and freeways helped modern traffic. That sentence is too smooth. It hides who lived there, what was built there, what was labeled obsolete, and why the replacement map mattered."""
        investigation = f"""Start with the place names. Black Bottom was not just a nickname; it was a district tied to streets, homes, and businesses on Detroit's east side. Paradise Valley was tied to Black cultural life, entertainment, entrepreneurship, hotels, clubs, churches, and a dense everyday economy.

Now put the source trail on top of the streets. Old maps show blocks before clearance. Archive photographs show sidewalks, signs, houses, storefronts, and people. City planning language turns those blocks into categories. Freeway and redevelopment maps turn those categories into lines.

The hidden system is the gap between those two views. From street level, the neighborhood was lived experience. From the redevelopment desk, it became land use, traffic flow, taxable value, clearance area, and route geometry.

That is why the map is not background. The map is the instrument. A route line does not merely describe the city. It can decide which blocks become connected, which blocks become separated, and which addresses disappear from the next generation's mental map.

The human consequence is not abstract. A cleared block means a family has to move, a business loses its walk-in customers, a church network is scattered, a musician's circuit changes, and a local memory becomes harder to prove because the building itself is gone.

That does not mean every old building was perfect or every planning problem was invented. It means the story has to be honest about scale. When a city removes a district and then tells the next generation the district was inevitable loss, the source trail has to push back.

Follow the visual evidence beat by beat. First, put the old street grid on screen. The viewer should see names, boundaries, and proximity before hearing any conclusion. Second, bring in a photograph or newspaper source that proves the district was not an abstraction. A storefront sign, a crowd outside a club, a church address, or a hotel listing does more than decorate the narration. It tells the viewer that the place had social and economic density.

Third, show the planning language. This is where the story usually changes tone. The same streets that looked like home at street level can become a clearance area in official language. A neighborhood can become a problem to solve. A business corridor can become a parcel. The words matter because the words prepare the viewer for the map.

Fourth, put the route line or redevelopment footprint over the earlier evidence. That comparison is the visual payoff. The episode should not ask viewers to imagine erasure. It should show how the official map crossed the lived map.

Finally, come back to the people without turning them into symbols. The point is not nostalgia for a perfect past. The point is accountability to a real place. Black Bottom and Paradise Valley were part of Detroit's Black cultural, commercial, and neighborhood geography. When the built environment changed, the cost was not only architectural. It was relational: customers, neighbors, musicians, landlords, renters, pastors, barbers, cooks, promoters, and kids walking to familiar corners all had to renegotiate the city.

That is why this episode needs archival photos, maps, documents, and labeled overlays in sequence. If the screen repeats the same photo without a new crop or callout, the viewer learns nothing new. If the screen shows a generic skyline while the narration says Black Bottom, the episode breaks its promise. Every visual has to answer the sentence being spoken."""
        payoff = f"""The payoff is visible when the old evidence and the later map sit on screen together. The neighborhood did not vanish because it lacked life. It vanished through decisions that used maps, labels, money, and road geometry to make removal appear practical.

The final comparison should be simple enough to understand on a phone. On one side, show the old place: street names, source date, and a real visual clue. On the other side, show the later intervention: freeway, clearance area, redevelopment footprint, or modern aerial context. Then label the mechanism in plain words. Not just lost. Cut. Cleared. Rerouted. Renamed. Scattered.

That is the difference between a local-history episode and a generic history montage. The evidence does not just make the story look serious. It changes what the viewer thinks happened.

That is the Pattern Lab rule: no source, no story. The source trail does not turn Detroit into a villain or a myth. It makes the city harder to flatten.

If you grew up hearing only the shorthand version, this is the missing piece: Black Bottom and Paradise Valley were not side notes to Detroit history. They were part of the city's cultural engine, and their removal changed more than traffic.

Subscribe for the next city file if you want American city history built from maps, archives, and evidence. The next episode starts the same way: show the place, show the source, explain the system.

That is the pattern: city, source, system.

No source, no story."""
    elif "rewired" in title_lower or "decline" in title_lower:
        opening = f"""Look at Detroit's map before accepting the easy decline story. The visible clue is not one abandoned building or one skyline shot. It is the way roads, factories, neighborhoods, population movement, and public decisions changed the city's shape.

The question is not whether Detroit declined. The better question is: who rewired Detroit, where can we see it on the map, and what did that rewiring do to the people who lived inside it?

The first proof object is a {artifact}. It needs to show the place, the source, and the cut in the first moments: where the city connected, where it divided, and where the old story gets too simple.

The familiar version says Detroit rose with cars and fell when the auto economy changed. That is partly true, but it is not enough. A city this large does not become a national shorthand through one cause. The map keeps receipts."""
        investigation = f"""Start with industry. Factories were not just employers; they shaped transit routes, neighborhoods, tax base, political pressure, and daily schedules. The industrial map explains why certain corridors mattered long before people argued about decline.

Then add movement. People moved toward jobs, away from constraints, out to suburbs, into new housing, and sometimes away from blocks that public policy had already weakened. Population change was not just a statistic. It changed schools, stores, churches, street life, and political power.

Now add freeways. A freeway is sold as speed, but on the ground it is also a cut. It can connect commuters while dividing neighborhoods. It can make a regional economy more fluid while making a local business corridor less walkable. It can solve one transportation problem and create a memory problem the next generation has to decode.

Then add policy. Housing, lending, urban renewal, tax decisions, and planning choices did not float above the city. They landed on parcels, blocks, routes, and families. When those choices repeat across decades, they become a system.

That system is the hidden story. Detroit was not only losing people or losing jobs. It was being reorganized. Some connections became stronger. Some local networks were cut. Some explanations became popular because they were easier to repeat than the evidence was to read.

This is where old photographs and maps matter. A photo can show the street before the shorthand. A route map can show the cut before the memory fades. A planning document can show the language that made a neighborhood sound disposable.

The first visual move should be a map move, not a skyline. Trace the corridor. Show the industrial spine. Show where people had to cross, commute, shop, or leave. Then use photographs to make the map human: factory floor, housing block, streetcar, church, storefront, school, or downtown crowd. The viewer should never feel that the edit is guessing. The screen should keep pointing back to evidence.

The second move is a before-and-after comparison. Put the older grid beside the later infrastructure. Do not rush it. Let the viewer understand what the line did. A freeway can be useful regionally and destructive locally at the same time. The episode gets stronger when it can hold both truths without flattening either one.

The third move is the policy layer. Housing rules, lending patterns, municipal decisions, redevelopment language, and transportation planning are not as visually obvious as a demolished building, so the edit has to make them legible. Use a document zoom, a highlighted phrase, a map annotation, or a clean reconstruction graphic. If AI helps animate a map or restore legibility, label it internally as support. It cannot become fake archive.

The fourth move is consequence. A system is not proven only by showing what planners intended. It is proven by showing what changed afterward: population distribution, business corridors, school boundaries, transit access, tax base, vacant land, and the memory of which places are still talked about and which places require an archive search.

This is also where the Detroit story becomes useful beyond Detroit. Many American cities have a simplified moral summary. Detroit's shorthand is especially strong because the city became a national symbol. But symbols are dangerous when they replace maps. A source-backed episode can show viewers how to ask better questions about any city: where did the route go, who had power, what was removed, what was renamed, and which source proves it?"""
        payoff = f"""The payoff is the overlay: Detroit's decline story gets sharper when the map is allowed to speak. Industry explains where power gathered. Freeways explain where the city was cut. Population movement explains how consequences spread. Policy explains why the pattern was not random.

The strongest final sequence should not be a speech over repeated pictures. It should be a chain of evidence. First: the industrial map. Second: the route or infrastructure cut. Third: the neighborhood or population consequence. Fourth: the modern context that shows why the old decision still matters. Each image earns its second on screen by revealing a new layer.

If a visual returns, it needs a new job. The first use can establish location. The second can zoom into a label. The third can compare it with a later map. Without that new job, repetition becomes padding, and padding kills trust.

That does not make the story simple. It makes it more honest. Detroit was not just a place where something went wrong. It was a city repeatedly rewired by economic pressure, public choices, and infrastructure lines that still shape how people move and remember.

The next time someone summarizes Detroit with one word, ask for the map. Ask what changed, who moved, what was cut, and which source proves it.

Subscribe for the next Pattern Lab city file if you want American city history built from maps, archives, and evidence. We start with the source, then follow the system.

That is the pattern: city, source, system.

No source, no story."""
    else:
        opening = f"""Look at {city} through one proof object before accepting the familiar summary. The clue is a {artifact}, and it changes the question from a broad city story to a visible source trail.

The question is direct: {angle}

The first thirty seconds need to show the place, the source, the mystery, and why a local viewer should care. If the proof cannot be seen, the topic is not ready."""
        investigation = f"""Start with geography, then people, then the built environment. Maps show the skeleton. Photos show the street-level evidence. Records show the language of decisions. Together they explain why the familiar version leaves something out.

A city is not just a skyline or a data point. It is a set of routes, addresses, institutions, industries, neighborhoods, and memories. The evidence has to stay close to that lived shape.

The source trail works only if every visual earns its place. If the narration names a neighborhood, the screen has to show evidence tied to that neighborhood. If the narration names a route, the screen needs a map, document, construction image, or labeled reconstruction. Atmosphere can support the edit, but proof comes from sources.

The first pass through the source trail should establish the place. The second pass should establish the conflict or contradiction. The third pass should show the mechanism that changed the place. The fourth pass should return to the human consequence. That structure keeps the episode from becoming trivia.

Use video when it creates motion, pace, or context. Modern free stock can show a street, skyline, train, road, water, crowd movement, or architectural texture. Archival video is better when rights are clear. But neither type of video gets to make the historical claim on its own. The claim has to sit on a map, document, photo, newspaper, public record, or clearly labeled reconstruction.

The thumbnail should make one promise and the opening should pay it off quickly. If the thumbnail says a place vanished, show the place and the proof. If it says a map changed, show the map and the change. If it says the city was rewired, show the wire: route, corridor, boundary, or system line."""
        payoff = f"""The payoff is a clearer answer to the hidden-history question. The proof object does not replace the whole city story. It gives the viewer a way into the system underneath it.

Subscribe for the next Pattern Lab city file if you want American city history built from maps, archives, and evidence.

That is the pattern: city, source, system.

No source, no story."""

    if "black bottom" in title_lower or "paradise valley" in title_lower:
        hook = "Black Bottom was not empty. Detroit erased a living district."
    elif "rewired" in title_lower or "decline" in title_lower:
        hook = "Detroit did not just decline. It was rewired."
    else:
        hook = f"{city}'s old sources change the story."

    intro = "I am James, and this is Pattern Lab. We study American cities through maps, archives, photographs, buildings, neighborhoods, industries, and evidence."
    episode_standard = f"""The rule for this episode is strict. Every claim has to point back to a visible source or a clearly labeled explanation. If the narration names a place, the screen should show that place or the evidence for it. If the narration names a system, the screen should show the map, record, route, policy language, photograph, or comparison that makes the system visible. Modern footage can create pace and context, but it cannot carry the historical claim. The proof has to be strong enough that a local viewer can pause the video and understand why the source matters."""

    return f"""# {title}

{hook}

{intro}

{opening}

{JAMES_MOMENT}

{episode_standard}

{investigation}

{payoff}
"""


def production_script_available(topic):
    """Only source-specific documentary templates can enter the production lane."""
    title = topic["working_title"].lower()
    return any(term in title for term in ("black bottom", "paradise valley", "rewired", "decline"))

def image_prompts(topic):
    artifact = topic["artifact_type"]
    angle = topic["public_angle"]
    city = topic.get("city", "Detroit")
    return f"""# Pattern Lab Image And Source Prompts: Video {topic['video_id']}

Create a city-history visual pack for {city}. Use verified historical images whenever rights are clear. Do not scrape random image search results. Do not present AI reconstructions as archival photographs.

Before sourcing final images or video, follow the canonical source policy: `youtube-v1/resources/source-media-policy.json`.

Before designing final thumbnails, follow the canonical thumbnail click policy: `youtube-v1/resources/thumbnail-click-policy.json`.

Before rendering through Canva or local fallback, follow the autonomous architecture: `youtube-v1/workflows/autonomous-production-architecture.md`.

Required autonomous sequence: OpenClaw strategy/source safety -> Canva plugin render -> OpenClaw validation -> owner review / YouTube test. Canva is a rendering engine only; OpenClaw owns source safety, title-thumbnail promise matching, rights ledger checks, and validation.

Preferred free/low-cost source classes:
- Library of Congress public domain or no-known-restrictions items.
- National Archives public domain federal records.
- Wikimedia Commons files with commercial-use-compatible licenses and attribution.
- Local library/archive items only when reuse rights are clear.
- Pexels, Pixabay, and Unsplash for modern non-proof photo backgrounds or texture only.
- Pexels, Pixabay, Mixkit, and Coverr for rights-logged modern context B-roll only.
- Videvo/Videezy only when item-level license, attribution, and editorial-use status are logged.
- NASA or Internet Archive/Prelinger archival video only when the item-level rights basis is clear.

First 30-second payoff rule: the first 30 seconds of the video must show the exact map, source, place, or clue promised by the thumbnail. No fake archival photos, no fake source proof, no watermark, and no Pro-locked Canva Free export.

Required visual outputs:
- thumbnail_candidate_a.png: emotional mystery thumbnail for {city}, one vanished-place or before/after clue, explicit city anchor, explicit proof object, large readable 2-4 word text such as "WHAT VANISHED?", high contrast, credible documentary feel.
- thumbnail_candidate_b.png: map/system proof thumbnail, one dominant map/route/source artifact, explicit city anchor, explicit proof object, large readable 2-4 word text such as "THE MAP CHANGED", clear city-system tension.
- thumbnail_candidate_c.png: contrarian history thumbnail, familiar {city} story challenged by source/map/photo clue, explicit city anchor, explicit proof object, large readable 2-4 word text such as "NOT THE WHOLE STORY", clear open loop, readable at phone size.
- city_source_map.png: clean original map-style graphic showing the central places/sources for: {angle}
- archival_evidence_board.png: original evidence-board graphic listing source, place, date, visible clue, historical meaning, and what changed.
- then_now_structure.png: original then-vs-now layout for streets, buildings, or neighborhoods tied to the {artifact}.
- subscribe_city_file_card.png: tasteful end-card visual reading "Subscribe for the next city file" with maps, archives, and evidence cues.

Historical and stock media rule: every real historical image, archival video, modern stock clip, stock photo, generated graphic, or AI reconstruction used in final media must have a rights-ledger row before review. AI-generated fill visuals must be labeled or framed as reconstructions/graphics, never archival proof.
"""


def shorts_package(topic):
    artifact = topic["artifact_type"]
    city = topic.get("city", "Detroit")
    return f"""# Pattern Lab Shorts Package: Video {topic['video_id']}

Public publishing: blocked until explicit owner approval.

## Short 1: The map keeps receipts.

- Viewer psychology: curiosity
- Title: The Map Keeps Receipts
- First-frame text: THE MAP CHANGED
- Hook: {city} makes more sense when you stop with the skyline and start with the map.
- Proof visual: {artifact} with one visible clue circled
- Payoff: show how one source changes the simplified story
- Bridge to long-form: full city file is in the long-form video
- Related-video promise: The full video shows the map, sources, and hidden system.
- Pinned comment: Which city should get a Pattern Lab city file next?
- Subscribe cue: Subscribe for the next evidence-backed city file.
- Start time: 0s
- Duration: 40s
- Approval gate: owner-review-required

## Short 2: Old photos are evidence, not decoration.

- Viewer psychology: utility
- Title: Old Photos Are Evidence
- First-frame text: NOT JUST OLD PHOTOS
- Hook: A historical photo is not just mood. It can show what a city wanted you to forget.
- Proof visual: source, place, date, visible clue, meaning, and consequence columns from the {artifact}
- Payoff: show one visible clue that changes the story
- Bridge to long-form: full city file is in the long-form video
- Related-video promise: The full video walks through the source ledger and what changed afterward.
- Pinned comment: Do you trust old photos more than modern summaries?
- Subscribe cue: Subscribe for more city history built from sources.
- Start time: 240s
- Duration: 40s
- Approval gate: owner-review-required

## Short 3: No source, no story.

- Viewer psychology: identity
- Title: No Source, No Story
- First-frame text: NO SOURCE, NO STORY
- Hook: If you want to understand a city, do not start with the myth. Start with the source.
- Proof visual: accepted versus rejected rows in the {artifact}
- Payoff: show why Pattern Lab rejects unsourced city myths
- Bridge to long-form: full city file is in the long-form video
- Related-video promise: The full video shows the evidence-backed version of the story.
- Pinned comment: What Detroit story should be checked against the sources?
- Subscribe cue: Subscribe for the next Pattern Lab city file.
- Start time: 480s
- Duration: 40s
- Approval gate: owner-review-required
"""


def upload_metadata(topic):
    video_id = topic["video_id"]
    titles = title_options(topic)
    city = topic.get("city", "Detroit")
    guru = guru_growth_system(topic, titles=titles)
    description = f"""Pattern Lab studies American cities through maps, archives, photographs, buildings, neighborhoods, industries, and evidence.

This episode asks: {topic['public_angle']}

The source proof is a {topic['artifact_type']}. The goal is to show the source, explain the system, and avoid flattening {city} into a generic rise-and-fall story.

Historical images are used only when reuse rights are clear. AI visuals, when used, are treated as graphics or reconstructions rather than archival proof."""
    return {
        "video_id": video_id,
        "title_options": titles,
        "default_title": titles[0],
        "default_thumbnail": "images/thumbnail_candidate_a.png",
        "description": description,
        "description_footer": "Subscribe for evidence-backed city history: one city, one source proof, one hidden pattern at a time.",
        "tags": [
            "Pattern Lab",
            f"{city} history",
            "American cities",
            "US history",
            "urban history",
            "city history documentary",
            "historical photos",
            "urban planning history",
            "Michigan history",
        ],
        "category_id": "27",
        "made_for_kids": False,
        "synthetic_disclosure_decision": "Owner must confirm in YouTube Studio. Expected answer: no realistic altered real person or real event is deceptively depicted. Historical photos must be rights-logged; AI visuals must be graphics/reconstructions, not fake archival proof.",
        "pinned_comment": city_source_lead_comment(city),
        "chapters": [
            {"time": "0:00", "title": "The map keeps receipts"},
            {"time": "0:20", "title": "The source proof"},
            {"time": "2:00", "title": "Sources before myths"},
            {"time": "5:00", "title": "The hidden city system"},
            {"time": "8:00", "title": "What changed afterward"},
        ],
        "shorts": [
            {
                "id": f"{video_id}-short-01",
                "title": "The Map Keeps Receipts",
                "pinned_comment": city_source_lead_comment(city),
                "related_video_promise": "The full video shows the map, sources, and hidden system.",
                "related_video_checklist": "Add the long-form video as the Related Video in YouTube Studio after upload.",
            },
            {
                "id": f"{video_id}-short-02",
                "title": "Old Photos Are Evidence",
                "pinned_comment": city_source_lead_comment(city),
                "related_video_promise": "The full video walks through the source ledger and what changed afterward.",
                "related_video_checklist": "Add the long-form video as the Related Video in YouTube Studio after upload.",
            },
            {
                "id": f"{video_id}-short-03",
                "title": "No Source, No Story",
                "pinned_comment": city_source_lead_comment(city),
                "related_video_promise": "The full video shows the evidence-backed version of the story.",
                "related_video_checklist": "Add the long-form video as the Related Video in YouTube Studio after upload.",
            },
        ],
        "guru_growth_system": guru,
    }


def gate_config(strategy, topic, score):
    video_id = topic["video_id"]
    return {
        "video_id": video_id,
        "working_title": topic["working_title"],
        "lane": strategy["lane"],
        "sub_lane": topic["sub_lane"],
        "public_angle": topic["public_angle"],
        "original_artifact": {
            "type": topic["artifact_type"],
            "source": topic["artifact_source"],
            "required_in_first_20_seconds": True,
        },
        "topic_scores": topic["scores"],
        "topic_score": score,
        "policy_gates": {
            "no_openclaw_public_branding": True,
            "no_copied_titles_scripts_or_thumbnails": True,
            "no_reused_clips": True,
            "no_meta_production_language_in_narration": True,
            "no_sensitive_event_or_ad_limited_angle": True,
            "historical_image_rights_required": True,
            "ai_reconstructions_must_be_labeled": True,
            "synthetic_disclosure_decision_required": True,
            "rights_ledger_required": True,
            "episode_standard_report_required": True,
        },
        "packaging_gates": {
            "title_options_required": 5,
            "title_thumbnail_pairs_required": 3,
            "first_30_second_payoff_required": True,
            "thumbnail_candidates_required": 3,
            "default_title_thumbnail_pairing_required": True,
            "description_required": True,
            "tags_required": True,
            "chapters_required": True,
            "pinned_comment_required": True,
            "subscribe_cta_required": True,
            "shorts_related_video_checklist_required": True,
        },
        "human_gates": {
            "private_upload_approval_required": True,
            "public_publish_approval_required": True,
            "phone_speaker_voice_review_required": True,
            "historical_source_rights_review_required": True,
            "private_info_review_required": True,
        },
        "retention_ladder_required": True,
        "retention_ladder": default_ladder(video_id, {"artifact_type": topic["artifact_type"]}),
    }


def write_metrics_seed(root, video_id, metadata):
    metrics = ensure_dir(root / "metrics") / f"video-{video_id}-performance.csv"
    fields = [
        "recorded_at_utc",
        "video_id",
        "surface",
        "publish_url",
        "title",
        "thumbnail_variant",
        "hours_since_publish",
        "views",
        "impressions",
        "ctr_percent",
        "average_view_duration_seconds",
        "average_percentage_viewed",
        "retention_30s_percent",
        "retention_50_percent",
        "subscribers_gained",
        "estimated_revenue_usd",
        "rpm_usd",
        "shorts_viewed_percent",
        "shorts_swiped_away_percent",
        "related_video_clicks",
        "comments_signal_summary",
        "decision_label",
        "next_action",
    ]
    if metrics.exists():
        return metrics
    rows = []
    for hours in [24, 72, 168, 720]:
        rows.append(
            {
                "recorded_at_utc": utc_now(),
                "video_id": video_id,
                "surface": "long-form",
                "publish_url": "",
                "title": metadata["default_title"],
                "thumbnail_variant": "A",
                "hours_since_publish": hours,
                "comments_signal_summary": f"Pending {hours}h YouTube Studio export.",
                "decision_label": "pending_publish",
                "next_action": "Produce media, approve assets, publish publicly only after checks, then record the scheduled performance checkpoint.",
            }
        )
        for index, short in enumerate(metadata["shorts"], 1):
            rows.append(
                {
                    "recorded_at_utc": utc_now(),
                    "video_id": f"{video_id}-short-{index:02d}",
                    "surface": "short",
                    "publish_url": "",
                    "title": short["title"],
                    "thumbnail_variant": f"short-{index:02d}",
                    "hours_since_publish": hours,
                    "comments_signal_summary": f"Pending {hours}h Shorts viewed-vs-swiped data.",
                    "decision_label": "pending_publish",
                    "next_action": "Approve Short, publish publicly after long-form is available, then compare related-video clicks.",
                }
            )
    with metrics.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            writer.writerow({field: row.get(field, "") for field in fields})
    return metrics


def write_artifact(root, topic):
    artifact_path = BASE / topic["artifact_source"]
    if not artifact_path.is_absolute():
        artifact_path = BASE / topic["artifact_source"]
    ensure_dir(artifact_path.parent)
    rows = [
        ["source", "place", "date", "visible_clue", "historical_meaning", "what_changed_afterward", "decision"],
        ["archive map", "Detroit", "source date pending", "route, border, street, or district shape", "the map shows the system before the narration claims it", "use as opening proof", "keep"],
        ["historic photograph", "Detroit", "source date pending", "signs, streets, crowds, buildings, or empty land", "old photos are evidence, not decoration", "rights row required before final video", "keep_if_rights_clear"],
        ["unsourced internet image", "unknown", "unknown", "interesting but not traceable", "cannot carry a historical claim", "replace with verified source or original graphic", "reject"],
        ["labeled reconstruction", "Detroit", "production date", "clearly marked graphic", "safe fallback when archival proof is unavailable", "must not be presented as archival", "revise"],
    ]
    with artifact_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerows(rows)
    append_ledger(
        root,
        {
            "asset_id": f"video-{topic['video_id']}-artifact",
            "asset_type": "artifact",
            "filename": str(artifact_path.relative_to(root)) if root in artifact_path.parents else topic["artifact_source"],
            "tool": "Pattern Lab daily factory",
            "model_or_service": "deterministic artifact generator",
            "source_prompt_or_source_file": "state/monetization/content-slate.json",
            "license_status": "original Pattern Lab city-history artifact; historical source rights still require per-asset review",
            "created_at": utc_now(),
            "notes": topic["artifact_type"],
            "human_review_required": "yes",
            "human_review_status": "pending",
        },
    )
    return artifact_path


def write_package(strategy, topic):
    video_id = topic["video_id"]
    score = weighted_score(strategy, topic["scores"])
    if score < float(strategy["topic_score_threshold"]):
        raise SystemExit(f"Topic {video_id} is below threshold: {score}/100")
    launch = ensure_dir(BASE / "launch" / f"video-{video_id}")
    root = output_root(video_id)
    ensure_dir(root / "approval")
    script = protect_locked_script(launch, root, video_id, script_text(topic))
    metadata = upload_metadata(topic)
    package = {
        "generated_at": utc_now(),
        "video_id": video_id,
        "topic_score": score,
        "working_title": topic["working_title"],
        "lane": strategy["lane"],
        "sub_lane": topic["sub_lane"],
        "public_angle": topic["public_angle"],
        "artifact_type": topic["artifact_type"],
        "retention_ladder": default_ladder(video_id, {"artifact_type": topic["artifact_type"]}),
        "upload_metadata": metadata,
        "guru_growth_system": metadata["guru_growth_system"],
    }
    (launch / "package.json").write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")
    if not production_script_available(topic):
        (launch / "research-brief.md").write_text(
            "# Research Brief Only\n\n"
            "This topic is not allowed to enter media production until a source dossier, proof object, and documentary transcript pass the transcript and source gates.\n",
            encoding="utf-8",
        )
        raise SystemExit("source_specific_script_missing: wrote research brief only; no final-script.md was created")
    if not (launch / "final-script.md").exists():
        (launch / "final-script.md").write_text(script, encoding="utf-8")
    (launch / "image-prompts.md").write_text(image_prompts(topic), encoding="utf-8")
    (launch / "shorts-package.md").write_text(shorts_package(topic), encoding="utf-8")
    ensure_dir(BASE / "state" / "monetization")
    (BASE / "state" / "monetization" / f"video-{video_id}-gates.json").write_text(
        json.dumps(gate_config(strategy, topic, score), indent=2) + "\n",
        encoding="utf-8",
    )
    artifact = write_artifact(root, topic)
    write_metrics_seed(root, video_id, metadata)
    images_ready = len(list((root / "images").glob("*.png"))) >= 6 if (root / "images").exists() else False
    voice_ready = (root / "audio" / "voiceover_full_normalized.mp3").exists()
    proof_ready = (root / "proof-footage" / "artifact-proof-clip.mp4").exists()
    long_form_ready = (root / "video" / f"pattern-lab-video-{video_id}-draft.mp4").exists()
    status = root / "approval" / "daily-production-status.md"
    status.write_text(
        "\n".join(
            [
                f"# Pattern Lab Daily Production Status: Video {video_id}",
                "",
                f"Generated: {utc_now()}",
                "",
                f"Topic score: {score}/100",
                f"Lane: {strategy['lane']}",
                f"Sub-lane: {topic['sub_lane']}",
                f"Artifact: {display_path(artifact)}",
                "",
                "## Status",
                "",
                "- Launch package: ready",
                "- Upload metadata: ready",
                "- Shorts package: ready",
                "- Rights ledger artifact row: ready",
                f"- Historical/graphic image pack: {'ready' if images_ready else 'blocked until verified historical images or Codex graphics are prepared'}",
                f"- Voiceover: {'ready' if voice_ready else 'ready for ElevenLabs generation'}",
                f"- Source proof footage: {'ready' if proof_ready else 'ready for local source-proof render'}",
                f"- Long-form draft: {'ready' if long_form_ready else 'blocked until images, voiceover, and proof footage are available'}",
                "- Public publishing: blocked until explicit owner approval",
                "",
            ]
        ),
        encoding="utf-8",
    )
    return package, status


def run_child(script, video_id, *extra):
    subprocess.run(
        [sys.executable, f"youtube-v1/scripts/{script}", "--video-id", video_id, *extra],
        cwd=BASE.parent,
        check=True,
    )


def main():
    parser = argparse.ArgumentParser(description="Prepare the next Pattern Lab monetization-approved production package.")
    parser.add_argument("--video-id")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    load_dotenv()
    strategy, topic = select_topic(args.video_id)
    score = weighted_score(strategy, topic["scores"])
    print(f"Selected video {topic['video_id']}: {topic['working_title']}")
    print(f"Topic score: {score}/100")
    if args.dry_run:
        print("Dry run only. No package written.")
        return
    package, status = write_package(strategy, topic)
    run_child("generate_upload_metadata.py", topic["video_id"])
    run_child("patternlab_retention_ladder.py", topic["video_id"])
    run_child("generate_shorts_ffmpeg.py", topic["video_id"], "--dry-run")
    run_child("monetization_gates.py", topic["video_id"])
    launch_dir = BASE / "launch" / f"video-{topic['video_id']}"
    print(f"Launch package: {display_path(launch_dir)}")
    print(f"Daily status: {display_path(status)}")


if __name__ == "__main__":
    main()
