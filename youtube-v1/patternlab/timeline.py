"""OTIO timeline generation from validated Pattern Lab visual beats."""
from __future__ import annotations

import opentimelineio as otio

from .schemas import EpisodeManifest


def timeline_from_manifest(manifest: EpisodeManifest) -> otio.schema.Timeline:
    track = otio.schema.Track(name="Pattern Lab Visuals")
    timeline = otio.schema.Timeline(name=f"Pattern Lab Video {manifest.episode_id}")
    timeline.tracks.append(track)
    assets = {asset.asset_id: asset for asset in manifest.assets}
    for beat in sorted(manifest.visual_beats, key=lambda item: item.start_seconds):
        duration = beat.end_seconds - beat.start_seconds
        asset = assets[beat.asset_ids[0]]
        clip = otio.schema.Clip(name=beat.beat_id)
        clip.media_reference = otio.schema.ExternalReference(target_url=asset.relative_path)
        clip.source_range = otio.opentime.TimeRange(
            start_time=otio.opentime.RationalTime(0, 30),
            duration=otio.opentime.RationalTime(duration * 30, 30),
        )
        clip.metadata["patternlab"] = {
            "role": beat.role,
            "claim_ids": list(beat.claim_ids),
            "asset_ids": list(beat.asset_ids),
            "source_ids": [asset.source_id],
            "evidence_fit": asset.evidence_fit,
        }
        track.append(clip)
    return timeline
