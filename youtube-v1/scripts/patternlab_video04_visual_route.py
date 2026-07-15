#!/usr/bin/env python3
"""Compile the reviewed Video 04 narration-to-visual route.

The route is code-generated so every beat remains explicit, reviewable, and
deterministic. Cross-claim foreshadowing must state why the asset supports the
nearby narration; the evidence builder independently verifies that claim.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))

from patternlab_common import display_path, launch_root


def entry(
    asset_id: str,
    *,
    role: str = "context_only",
    callout: str = "",
    claim_id: str = "",
    narration_fit: str = "",
    clip_start: float | None = None,
) -> dict[str, Any]:
    value: dict[str, Any] = {"asset_id": asset_id, "role": role}
    if callout:
        value["callout"] = callout
    if claim_id:
        value["claim_id"] = claim_id
    if narration_fit:
        value["narration_fit"] = narration_fit
    if clip_start is not None:
        value["clip_start"] = clip_start
    return value


def segment(
    start: float,
    end: float,
    claim_id: str,
    narration_intent: str,
    *entries: dict[str, Any],
) -> dict[str, Any]:
    return {
        "start": start,
        "end": end,
        "claim_id": claim_id,
        "narration_intent": narration_intent,
        "entries": list(entries),
    }


def claim(
    claim_id: str,
    text: str,
    entities: list[str],
    role: str,
    start: float,
    end: float,
) -> dict[str, Any]:
    return {
        "claim_id": claim_id,
        "text": text,
        "required_entity_terms": entities,
        "role": role,
        "start": start,
        "end": end,
    }


def build_route() -> dict[str, Any]:
    black = "black-bottom-neighborhood"
    hastings = "hastings-st-antoine-network"
    housing = "housing-restrictions"
    paradise = "paradise-valley-businesses"
    clearance = "clearance-redevelopment"
    i375 = "i-375-route"
    relocation = "relocation-consequence"
    footprint = "then-now-footprint"
    claims = [
        claim(black, "Black Bottom was a living Detroit neighborhood, not empty land.", ["black bottom", "detroit"], "source_proof", 0, 60),
        claim(hastings, "Hastings Street and St. Antoine connected the neighborhood's daily and cultural life.", ["hastings street", "st antoine", "detroit"], "source_proof", 60, 90),
        claim(housing, "Housing restrictions shaped where Black Detroiters could live and build community.", ["detroit", "housing"], "document_detail", 90, 140),
        claim(paradise, "Paradise Valley held a dense network of Black-owned businesses and cultural life.", ["paradise valley", "detroit"], "source_proof", 140, 220),
        claim(clearance, "Clearance and redevelopment displaced Black Bottom and changed the land beneath it.", ["black bottom", "detroit", "redevelopment"], "map_system", 220, 270),
        claim(i375, "The I-375 route cut through Paradise Valley and its surrounding street network.", ["i-375", "paradise valley", "detroit"], "map_system", 270, 300),
        claim(relocation, "The change was a human relocation with consequences beyond a line on a map.", ["black bottom", "paradise valley", "detroit"], "source_proof", 300, 350),
        claim(footprint, "The present-day footprint still shows the pattern created by those decisions.", ["i-375", "black bottom", "detroit"], "then_now", 350, 499.322),
    ]
    segments = [
        segment(0, 10, black, "Proof hook: neighborhood, Black businesses, cultural life, and the freeway promise",
            entry("sanborn-1950-sheet-13", role="source_proof", callout="BLACK BOTTOM WAS NOT EMPTY"),
            entry("neh-black-bottom-business-relocation-document", role="source_proof", callout="300+ BLACK-OWNED BUSINESSES", claim_id=paradise, narration_fit="The hook explicitly introduces the documented Paradise Valley business count."),
            entry("loc-zoot-suit-1942", callout="A LIVING BUSINESS DISTRICT", claim_id=paradise, narration_fit="The Detroit business-district photograph supports the narrated public life beside Black Bottom."),
            entry("loc-duke-ellington-1943", callout="AMERICAN LEGENDS PLAYED HERE", claim_id=paradise, narration_fit="The hook names American music legends associated with Paradise Theater-era culture.")),
        segment(10, 20, black, "The I-375 footprint and replacement landscape preview the map change",
            entry("fhwa-i375-official-route-map", role="map_system", callout="THE FREEWAY FOOTPRINT", claim_id=i375, narration_fit="The hook explicitly promises the freeway footprint."),
            entry("commons-i375-current-view-2023", callout="I-375 TODAY", claim_id=i375, narration_fit="The present-day corridor shows the visible freeway footprint named in narration."),
            entry("commons-lafayette-over-black-bottom", role="then_now", callout="THE REPLACEMENT FOOTPRINT", claim_id=clearance, narration_fit="The narration promises the clearance and replacement footprint."),
            entry("commons-detroit-river-cobo-film", callout="DETROIT AFTER REDEVELOPMENT", clip_start=0.0)),
        segment(20, 30, black, "Lived neighborhood to replacement city and Pattern Lab source-first identity",
            entry("commons-detroit-views-film", callout="THE DISTRICT LOOKED ERASED", claim_id=footprint, narration_fit="Modern Detroit context supports the narrated appearance that the district vanished.", clip_start=10.0),
            entry("openverse-bethel-ame-st-antoine", callout="A LIVED COMMUNITY", claim_id=hastings, narration_fit="The surviving St. Antoine church site represents the community institutions named in the hook."),
            entry("video-04-visual-rebuild-loc-mi0175", callout="THE FISHER BUILDING • DETROIT", claim_id=footprint, narration_fit="The verified Detroit Fisher Building establishes the city while the narration pivots into James's source-first introduction."),
            entry("ia-detroit-home-movies-1955", callout="ARCHIVES BEFORE LEGENDS", claim_id=footprint, narration_fit="Verified Detroit home-movie footage directly introduces Pattern Lab's source-first archive method instead of adding another generic city-establishing shot.", clip_start=0.0)),
        segment(30, 40, black, "Archives and the near-east-side map open the source trail",
            entry("ia-detroit-news-1917", callout="DETROIT ON FILM • 1917", narration_fit="Verified early Detroit film continues James's spoken archive-and-photograph method before the map appears.", clip_start=30.0),
            entry("sanborn-1950-sheet-17", role="context_only", callout="HASTINGS • ST. ANTOINE ON THE MAP", narration_fit="The period Sanborn sheet visibly identifies Hastings and St. Antoine inside the mapped Black Bottom source trail.")),
        segment(40, 50, black, "Downtown proximity, streets, homes, churches, stores, and rail lines",
            entry("video-04-visual-rebuild-loc-2017826075", callout="CLOSE TO DOWNTOWN", claim_id=footprint, narration_fit="The rights-clear period Detroit street scene provides honest city-scale context for the spoken downtown proximity; the adjacent Sanborn map and railroad photograph carry the neighborhood and rail evidence."),
            entry("video-04-visual-rebuild-loc-2016816220", callout="DETROIT'S OLD RAIL LINES", claim_id=i375, narration_fit="The verified Detroit railroad-tunnel photograph matches the spoken reference to the old rail lines beside the mapped neighborhood.")),
        segment(50, 60, black, "Clubs, churches, stores, music, memory, and the episode question",
            entry("commons-generic-public-square", callout="ILLUSTRATIVE PUBLIC LIFE", claim_id=paradise, narration_fit="The narration names clubs, stores, music, and public life; this rights-cleared generic public-square clip is disclosed context while the adjacent church carries Detroit place evidence.", clip_start=0.0),
            entry("openverse-bethel-ame-st-antoine", callout="CHURCH • BUSINESS • MEMORY", claim_id=hastings, narration_fit="Bethel AME on St. Antoine supports the narrated church and neighborhood-memory network.")),
        segment(60, 70, hastings, "The Black Bottom name predates the Black neighborhood",
            entry("sanborn-1950-sheet-08", role="source_proof", callout="HASTINGS • ST. ANTOINE"),
            entry("loc-detroit-black-church-1942", callout="A BLACK DETROIT NEIGHBORHOOD")),
        segment(70, 80, hastings, "Bottomland and river history add an earlier geographic layer",
            entry("loc-detroit-downtown-from-black-neighborhood-1942", callout="IT BECAME A BLACK NEIGHBORHOOD", claim_id=black, narration_fit="The Detroit Black-neighborhood photograph matches the exact sentence about the neighborhood's later Black identity."),
            entry("commons-detroit-river-cobo-film", callout="DETROIT RIVER GEOGRAPHY", claim_id=black, narration_fit="Verified Detroit river motion supports the river and bottomland geography without claiming River Savoyard proof.", clip_start=15.0)),
        segment(80, 90, hastings, "St. Antoine, earlier settlement, and rapid city change",
            entry("openverse-st-antoine-marker-a", callout="ST. ANTOINE STREET"),
            entry("ia-detroit-news-1917", callout="DETROIT CHANGED FAST", claim_id=black, narration_fit="The Detroit 1917 film supports the early-century city-change transition.", clip_start=100.0)),
        segment(90, 100, housing, "Black migration, industrial work, and restrictive housing",
            entry("loc-black-residential-fronts-1942", callout="HOUSING CHOICE WAS RESTRICTED"),
            entry("video-04-visual-rebuild-loc-2017813226", callout="DETROIT NEEDED WORKERS", narration_fit="The rights-clear Detroit-area defense-plant pay line makes the industrial demand for workers visible beside the housing constraints described by James.")),
        segment(100, 110, housing, "A Black Detroit neighborhood grows near the industrial city",
            entry("loc-detroit-family-sojourner-truth-1942", callout="A PLACE TO BUILD A LIFE", narration_fit="The rights-clear Detroit family portrait makes the neighborhood's human purpose visible between the industrial-work and housing-policy beats."),
            entry("commons-c1940-metro-detroit-film", callout="COMMUNITY NEAR INDUSTRY", claim_id=black, narration_fit="Verified period Detroit motion supplies city context while the surrounding Black-neighborhood photographs carry the housing proof.", clip_start=510.0)),
        segment(110, 120, housing, "Workers, families, and the contradiction between labor demand and housing exclusion",
            entry("video-04-visual-rebuild-loc-2017858657", callout="THE CITY NEEDED WORKERS", narration_fit="The rights-clear Parke-Davis worker photograph shows Detroit's labor demand while the following mother-and-child image carries the housing exclusion consequence."),
            entry("loc-detroit-mother-child-sojourner-truth-1942", callout="THE SYSTEM LIMITED THEM")),
        segment(120, 130, housing, "Overcrowding and aging blocks become an institutional accusation",
            entry("commons-city-of-neighbors-film", callout="A LIVED COMMUNITY", clip_start=180.0),
            entry("loc-sojourner-truth-multiple-unit-1942", role="context_only", callout="SOJOURNER TRUTH HOMES • 1942", narration_fit="The rights-clear Detroit federal-housing-project exterior turns the institutional housing system into visible evidence without substituting another map for the people and buildings affected.")),
        segment(130, 140, housing, "Housing systems require evidence, not a confident internet vibe",
            entry("nps-housing-discrimination-document", role="document_detail", callout="HOUSING WAS A SYSTEM"),
            entry("loc-sojourner-truth-homes-1942", callout="DETROIT FEDERAL HOUSING • 1942", narration_fit="The rights-clear Sojourner Truth Homes exterior continues the housing-policy evidence with a visible Detroit residential system rather than generic filler.")),
        segment(140, 150, paradise, "Residential Black Bottom and overlapping business-centered Paradise Valley",
            entry("loc-black-residential-fronts-1942", callout="BLACK BOTTOM: HOME", claim_id=housing, narration_fit="The narration explicitly contrasts residential Black Bottom with nearby Paradise Valley."),
            entry("openverse-virgil-carr-cultural-center", callout="PARADISE VALLEY: PUBLIC LIFE")),
        segment(150, 160, paradise, "Restaurants, clubs, theaters, stores, and visible public life",
            entry("loc-zoot-suit-1942", callout="A VISIBLE BLACK ECONOMY"),
            entry("commons-c1940-metro-detroit-film", callout="DETROIT PUBLIC LIFE", clip_start=360.0)),
        segment(160, 167.5, paradise, "Visible Black commerce, culture, and public life",
            entry("loc-detroit-black-church-1942", callout="BUSINESS • CULTURE • COMMUNITY"),
            entry("commons-generic-public-square", callout="ILLUSTRATIVE PUBLIC LIFE", clip_start=10.0)),
        segment(167.5, 175, paradise, "The documented scale of more than 300 Black-owned businesses",
            entry("neh-black-bottom-business-relocation-document", role="source_proof", callout="300+ BLACK-OWNED BUSINESSES"),
            entry("loc-detroit-grocery-black-district-1942", callout="BLACK DETROIT BUSINESS LIFE", narration_fit="The rights-clear Black Detroit storefront supplies truthful business context immediately after the documented count.")),
        segment(175, 180, paradise, "A commercial ecosystem rather than an empty district",
            entry("video-04-visual-rebuild-loc-2017702476", callout="A LIVING COMMERCIAL ECOSYSTEM", narration_fit="A rights-clear period Detroit storefront makes the spoken commercial ecosystem visible without claiming that this individual storefront stood inside Paradise Valley.")),
        segment(180, 190, paradise, "Named venues and a source-grounded district network",
            entry("sanborn-1950-sheet-13", role="source_proof", callout="FLAME • HORSESHOE • CLUB HARLEM", narration_fit="The narration explicitly asks for the sourced venue names on screen while the district map keeps the geography visible."),
            entry("sanborn-1950-sheet-08", role="source_proof", callout="PARADISE THEATER", narration_fit="The narration explicitly names Paradise Theater while the second district map reveals the surrounding business network.")),
        segment(190, 200, paradise, "Duke Ellington and Billie Holiday in the Paradise Theater-era music network",
            entry("loc-duke-ellington-1943", callout="DUKE ELLINGTON"),
            entry("loc-billie-holiday-carnegie-1946", callout="BILLIE HOLIDAY")),
        segment(200, 203, paradise, "Louis Armstrong and Dizzy Gillespie in American music history",
            entry("commons-louis-armstrong-gottlieb", callout="LOUIS ARMSTRONG"),
            entry("loc-dizzy-gillespie-1955", callout="DIZZY GILLESPIE")),
        segment(203, 210, paradise, "A generic skyline is not evidence of Paradise Valley",
            entry("commons-detroit-skyline-cc0", callout="A SKYLINE IS NOT DISTRICT PROOF", claim_id=footprint, narration_fit="The narration explicitly presents a generic Detroit skyline as the wrong kind of evidence."),
            entry("openverse-st-antoine-marker-b", callout="PUT THE DISTRICT EVIDENCE ON SCREEN", claim_id=hastings, narration_fit="The narration explicitly asks for a street marker or district-specific source instead of a generic skyline.")),
        segment(210, 220, paradise, "Paradise Valley needs district evidence, not a generic skyline",
            entry("openverse-st-antoine-marker-a", callout="ST. ANTOINE STREET", claim_id=hastings, narration_fit="The narration asks for a street view or marker that points to the district."),
            entry("openverse-bethel-ame-st-antoine", callout="A ST. ANTOINE COMMUNITY LANDMARK", claim_id=hastings, narration_fit="The narration asks for a district street view, listing, or photograph rather than a skyline.")),
        segment(220, 230, clearance, "The hidden chain from classification to demolition",
            entry("sanborn-1950-sheet-18", role="source_proof", callout="VACANT BLOCKS ON THE MAP"),
            entry("sanborn-1950-sheet-11", role="source_proof", callout="BLOCKS MARKED FOR REMOVAL")),
        segment(230, 240, clearance, "Segregation, aging housing, decline labels, and clearance language",
            entry("nps-housing-discrimination-document", role="document_detail", callout="SEGREGATION LIMITED CHOICE", claim_id=housing, narration_fit="The narration explicitly recaps housing segregation as the first link in the clearance chain."),
            entry("video-04-visual-rebuild-loc-2017813174", callout="DEFENSE-WORKER HOUSING CONDITIONS", claim_id=housing, narration_fit="The rights-clear Detroit-area trailer-park laundry photograph shows lived wartime housing conditions; the adjacent document carries the system proof.")),
        segment(240, 250, clearance, "Federal authority and the map change",
            entry("fhwa-i375-workshop-page-06", role="source_proof", callout="FEDERAL TOOLS CHANGED THE MAP"),
            entry("video-04-visual-rebuild-loc-2017702476", callout="THE BUILT CITY BEFORE CLEARANCE", claim_id=housing, narration_fit="A rights-clear Detroit storefront supports the built-city context while the federal source carries the clearance proof.")),
        segment(250, 260, clearance, "Urban-renewal and highway funding turn plans into demolition",
            entry("federal-acts-1949-1956-source-card", role="source_proof", callout="1949 • 1956 • FEDERAL TOOLS", narration_fit="The source-cited card directly names the two federal laws in the narration; the following 1964 Detroit construction photograph carries the local physical consequence."),
            entry("fhwa-detroit-chrysler-freeway-1964", callout="DETROIT FREEWAY CONSTRUCTION • 1964")),
        segment(260, 270, clearance, "Lafayette Park and freeway-era redevelopment replace the neighborhood",
            entry("commons-lafayette-over-black-bottom", role="then_now", callout="LAFAYETTE PARK OVER BLACK BOTTOM"),
            entry("commons-lafayette-park-modern", role="then_now", callout="THE REPLACEMENT LANDSCAPE", claim_id=footprint, narration_fit="Present-day Lafayette Park shows the replacement footprint named in narration.")),
        segment(270, 280, i375, "I-375 in plan view and at street level",
            entry("fhwa-i375-official-route-map", role="map_system", callout="THE I-375 CORRIDOR"),
            entry("commons-i375-current-view-2023", role="then_now", callout="AT STREET LEVEL")),
        segment(280, 290, i375, "The source trail before the freeway and the surviving street reference",
            entry("sanborn-1950-sheet-11", role="source_proof", callout="THE STREET GRID BEFORE THE LINE", claim_id=clearance, narration_fit="The narration recaps the pre-freeway restriction and clearance trail."),
            entry("openverse-st-antoine-street-view", role="then_now", callout="ST. ANTOINE TODAY")),
        segment(290, 300, i375, "Freeway construction and the addresses erased beneath the line",
            entry("fhwa-detroit-chrysler-freeway-1964", callout="A FREEWAY IS NEVER JUST A LINE"),
            entry("loc-detroit-family-sojourner-truth-1942", callout="ADDRESSES BECOME DISPLACEMENT", claim_id=relocation, narration_fit="The family portrait gives the narrated erased addresses a truthful human consequence without claiming I-375 location proof.")),
        segment(300, 310, relocation, "Families receive notice and businesses lose walk-by customers",
            entry("loc-sojourner-truth-moving-1942", callout="A FAMILY IS TOLD TO MOVE"),
            entry("commons-generic-foot-traffic", callout="ILLUSTRATIVE CUSTOMER FOOT TRAFFIC", clip_start=7.0)),
        segment(310, 311.3, relocation, "Clearance creates a new geography",
            entry("fhwa-i375-workshop-page-06", role="map_system", callout="A NEW GEOGRAPHY", claim_id=i375, narration_fit="The official corridor source matches the new geography created by clearance.")),
        segment(311.3, 315, relocation, "A musician's club-to-club route changes",
            entry("loc-dizzy-gillespie-1955", callout="THE CLUB-TO-CLUB ROUTE CHANGES", claim_id=paradise, narration_fit="The narration explicitly describes a musician's changed route through the club district.")),
        segment(315, 320, relocation, "A child must learn a different part of the city",
            entry("commons-city-of-neighbors-film", callout="A CHILD'S FAMILIAR CITY CHANGES", clip_start=570.0)),
        segment(320, 330, relocation, "The next generation must prove the place and the relocation record",
            entry("loc-detroit-grocery-black-district-1942", callout="THE CORNER STORE BECOMES A MEMORY"),
            entry("neh-black-bottom-business-relocation-document", role="source_proof", callout="THE RELOCATION RECORD", claim_id=relocation, narration_fit="The federal source directly documents the relocation consequence and preserves the erased place in the record.")),
        segment(330, 340, relocation, "Minimal assistance and relocation into public housing",
            entry("commons-frederick-douglass-towers-2010", callout="BREWSTER-DOUGLASS"),
            entry("commons-frederick-douglass-homes", callout="PUBLIC-HOUSING RELOCATION")),
        segment(340, 350, relocation, "Family consequence and the community network that clearance disrupted",
            entry("loc-detroit-mother-child-sojourner-truth-1942", callout="THE HUMAN COST"),
            entry("loc-detroit-black-church-1942", callout="A COMMUNITY NETWORK STRETCHED APART")),
        segment(350, 360, footprint, "The explicit payoff begins with the old map and named streets",
            entry("sanborn-1950-sheet-08", role="source_proof", callout="THE OLD DISTRICT MAP", claim_id=hastings, narration_fit="The narration explicitly instructs the edit to show the old district map and this reviewed sheet carries Hastings and St. Antoine geography."),
            entry("openverse-st-antoine-street-view", callout="HASTINGS • ST. ANTOINE • PARADISE", narration_fit="The narration explicitly asks for a street view after the old map; this reviewed St. Antoine view supplies honest present-day context without claiming a matched historical viewpoint.")),
        segment(360, 370, footprint, "The official freeway map crosses the later redevelopment footprint",
            entry("fhwa-i375-official-route-map", role="map_system", callout="THE OFFICIAL MAP"),
            entry("commons-lafayette-over-black-bottom", role="then_now", callout="THE REPLACEMENT MAP")),
        segment(370, 380, footprint, "Real material conditions existed in the neighborhood",
            entry("loc-black-residential-fronts-1942", callout="REAL HOUSING CONDITIONS"),
            entry("loc-detroit-black-neighborhood-houses-1942", callout="OVERCROWDING • POVERTY • AGING HOMES", claim_id=housing, narration_fit="The rights-clear period Black Detroit housing photograph matches the exact list of material housing conditions.")),
        segment(380, 390, footprint, "Two truths: material hardship and irreplaceable cultural value",
            entry("loc-detroit-downtown-from-black-neighborhood-1942", callout="TWO TRUTHS AT ONCE"),
            entry("openverse-virgil-carr-cultural-center", role="then_now", callout="A CULTURAL AND BUSINESS DISTRICT")),
        segment(390, 400, footprint, "Lafayette Park and traffic are the simple version, not the whole story",
            entry("commons-lafayette-park-modern", role="then_now", callout="THE REPLACEMENT LANDSCAPE"),
            entry("commons-generic-street-traffic", callout="ILLUSTRATIVE TRAFFIC CONTEXT", clip_start=10.0)),
        segment(400, 410, footprint, "Who defined the neighborhood, benefited, and was forced to move",
            entry("loc-detroit-family-sojourner-truth-1942", callout="WHO WAS FORCED TO MOVE?"),
            entry("commons-generic-foot-traffic", callout="ILLUSTRATIVE STREET-LIFE CONTEXT", clip_start=13.0)),
        segment(410, 420, footprint, "Present-day landmarks and Lafayette Park cover parts of the old geography",
            entry("commons-detroit-views-film", callout="DETROIT TODAY", clip_start=80.0),
            entry("commons-renaissance-center-flags-film", callout="PRESENT-DAY LANDMARKS", clip_start=0.0),
            entry("commons-mies-residential-district", role="then_now", callout="LAFAYETTE PARK")),
        segment(420, 430, footprint, "Ford Field and the surviving Orchestra Hall landmark",
            entry("loc-ford-field-aerial-2020", role="then_now", callout="FORD FIELD FOOTPRINT • 2020"),
            entry("wikimedia-orchestra-hall-c1970", role="then_now", callout="ORCHESTRA HALL SURVIVES")),
        segment(430, 440, footprint, "One surviving building is not a surviving neighborhood network",
            entry("commons-ford-field-comerica-public-domain", role="then_now", callout="ONE LANDMARK IS NOT A NEIGHBORHOOD"),
            entry("loc-sojourner-truth-moving-1942", callout="A DENSE HUMAN NETWORK VANISHED", claim_id=relocation, narration_fit="The moving-family photograph represents the people and relationships lost beyond architecture.")),
        segment(440, 450, footprint, "Businesses, housing, churches, customers, workers, and memory",
            entry("loc-detroit-grocery-black-district-1942", callout="BUSINESS • HOUSING • CHURCH • MEMORY", claim_id=paradise, narration_fit="The rights-clear Black Detroit storefront directly matches the first part of the closing neighborhood-network list."),
            entry("commons-c1940-metro-detroit-film", callout="DETROIT ARCHIVE FILM", clip_start=200.0)),
        segment(450, 460, footprint, "The archive holds the longer story behind the shortened map",
            entry("ia-detroit-news-1917", callout="THE ARCHIVE HOLDS THE LONGER STORY", claim_id=black, narration_fit="The Detroit News title card visibly identifies the archive source behind the longer story.", clip_start=0.0),
            entry("commons-renaissance-center-flags-film", callout="THE SHORT VERSION LEFT THIS OUT", claim_id=footprint, narration_fit="Modern Detroit motion carries the reflective transition without being presented as historical proof.", clip_start=15.0)),
        segment(460, 470, footprint, "The districts were part of Detroit's cultural engine",
            entry("loc-zoot-suit-1942", callout="THE DISTRICTS WERE NOT EMPTY", claim_id=paradise, narration_fit="The Detroit Black-business-district photograph directly supports the statement that the districts were living places, not empty obstacles."),
            entry("openverse-virgil-carr-cultural-center", callout="DETROIT'S CULTURAL ENGINE", claim_id=paradise, narration_fit="The reviewed Paradise Valley-area cultural institution supports the closing cultural-engine conclusion while Orchestra Hall remains reserved for the earlier line that names it explicitly.")),
        segment(470, 480, footprint, "Local memories become leads for the next source trail",
            entry("commons-city-of-neighbors-film", callout="DETROIT LOCAL MEMORY", claim_id=relocation, narration_fit="Historic Detroit community footage supports the local-memory invitation without claiming Black Bottom location proof.", clip_start=400.0),
            entry("openverse-st-antoine-marker-b", callout="WHAT DOES YOUR FAMILY REMEMBER?", claim_id=hastings, narration_fit="The St. Antoine marker matches the local-memory invitation naming Hastings Street and Paradise Valley.")),
        segment(480, 490, footprint, "The earned subscribe ask returns to modern Detroit and the visible footprint",
            entry("commons-detroit-views-film", callout="THE NEXT CITY FILE", clip_start=140.0),
            entry("commons-i375-current-view-2023", role="then_now", callout="THE MAP KEEPS RECEIPTS")),
        segment(490, 499.322, footprint, "City, source, and system close on archive footage and the official map",
            entry("ia-detroit-home-movies-1955", callout="SHOW THE PLACE • SHOW THE SOURCE", claim_id=relocation, narration_fit="A distinct later excerpt from the verified Detroit family archive film supports the closing source-first method and the remembered human place.", clip_start=300.0),
            entry("fhwa-i375-workshop-page-06", role="map_system", callout="CITY • SOURCE • SYSTEM")),
    ]
    return {
        "version": 9,
        "video_id": "04",
        "city": "Detroit",
        "purpose": "Owner-rejected long-form visual rebuild with explicit narration binding and no silent claim reassignment.",
        "claims": claims,
        "chapter_labels": {
            black: ["DETROIT", "THE NEIGHBORHOOD ERASED"],
            hastings: ["THE STREET GRID", "HASTINGS + ST. ANTOINE"],
            housing: ["THE HIDDEN SYSTEM", "HOUSING RESTRICTIONS"],
            paradise: ["PARADISE VALLEY", "300+ BLACK-OWNED BUSINESSES"],
            clearance: ["THE CLEARANCE", "BLOCKS MARKED FOR REMOVAL"],
            i375: ["THE ROUTE", "I-375 CHANGED THE MAP"],
            relocation: ["THE HUMAN COST", "A COMMUNITY DISPLACED"],
            footprint: ["THE PATTERN REMAINS", "THE MAP KEEPS RECEIPTS"],
        },
        "requirements": {
            "minimum_unique_assets": 52,
            "minimum_unique_asset_ratio": 0.8,
            "maximum_uses_per_asset": 2,
            "maximum_runtime_share_per_asset": 0.06,
            "maximum_adjacent_same_asset": 0,
            "maximum_same_source_family_run": 2,
            "caption_mode": "closed_captions_plus_selective_editorial_text",
            "split_screen_allowed": False,
            "ai_visuals_allowed": True,
            "maximum_ai_support_share": 0.15,
            "maximum_uses_per_static_asset": 1,
            "maximum_uses_per_proof_static_asset": 2,
            "minimum_static_asset_reuse_gap_seconds": 180.0,
            "minimum_proof_reprise_gap_seconds": 180.0,
            "maximum_map_document_share": 0.2,
            "minimum_moving_image_share": 0.2,
            "minimum_unique_presentation_ratio": 0.8,
            "minimum_historical_motion_assets": 3,
            "target_historical_motion_assets": 4,
            "strict_claim_binding": True,
            "cross_claim_rationale_required": True,
        },
        "segments": segments,
    }


def write_route(video_id: str) -> Path:
    if video_id != "04":
        raise ValueError(f"video04_route_only:{video_id}")
    path = launch_root(video_id) / "long-form-visual-routing.json"
    path.write_text(json.dumps(build_route(), indent=2) + "\n", encoding="utf-8")
    return path


def main() -> None:
    parser = argparse.ArgumentParser(description="Compile the reviewed Video 04 narration-to-visual route.")
    parser.add_argument("--video-id", default="04")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    video_id = args.video_id.zfill(2)
    path = launch_root(video_id) / "long-form-visual-routing.json"
    rendered = json.dumps(build_route(), indent=2) + "\n"
    if args.check:
        if not path.is_file() or path.read_text(encoding="utf-8") != rendered:
            raise SystemExit("video04_visual_route_generated_file_stale")
        print(f"Route is current: {display_path(path)}")
        return
    path.write_text(rendered, encoding="utf-8")
    print(f"Route written: {display_path(path)}")


if __name__ == "__main__":
    main()
