"""Pydantic contracts at Pattern Lab's external production boundaries."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


VisualRole = Literal[
    "source_proof",
    "map_system",
    "archive_evidence",
    "document_detail",
    "then_now",
    "context_only",
    "labeled_reconstruction",
    "city_file_cta",
]

PROOF_VISUAL_ROLES = {"source_proof", "map_system", "archive_evidence", "document_detail", "then_now"}


class EvidenceAsset(BaseModel):
    model_config = ConfigDict(extra="forbid")

    asset_id: str = Field(min_length=1)
    source_id: str = Field(min_length=1)
    source_class: Literal["historical_evidence", "modern_context", "original_graphic", "ai_reconstruction"]
    rights_status: Literal["approved", "blocked", "pending"]
    evidence_fit: Literal["direct", "supporting", "context_only", "rejected"]
    visual_fit: Literal["approved", "pending", "rejected"]
    relative_path: str = Field(min_length=1)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    entity_terms: tuple[str, ...] = ()
    asset_kind: Literal["photo", "map", "document", "film", "modern_video", "source_motion", "graphic"] = "photo"
    editorial_role: Literal["proof", "context_only", "system", "reconstruction", "unclassified"] = "unclassified"
    geographic_scope: Literal["city_specific", "generic", "not_applicable"] = "not_applicable"
    may_imply_named_city: bool = False
    context_action: str = ""
    context_emotion: str = ""
    on_screen_disclosure: str = ""
    derivative_source_sha256: str = ""
    motion_receipt_sha256: str = ""

    @model_validator(mode="after")
    def enforce_proof_rules(self):
        if self.evidence_fit == "direct" and self.source_class != "historical_evidence":
            raise ValueError("direct evidence requires historical_evidence source class")
        if self.source_class == "ai_reconstruction" and self.evidence_fit == "direct":
            raise ValueError("AI reconstruction cannot be direct evidence")
        if self.source_class == "modern_context" and self.geographic_scope == "generic":
            if self.source_class != "modern_context" or self.evidence_fit != "context_only":
                raise ValueError("generic media must be modern_context with context_only evidence fit")
            if self.editorial_role != "context_only" or self.may_imply_named_city:
                raise ValueError("generic media must be context_only and cannot imply a named city")
            if not self.context_action.strip() or not self.context_emotion.strip():
                raise ValueError("generic media requires action and emotional-function metadata")
        if self.source_class == "ai_reconstruction":
            if self.editorial_role != "reconstruction":
                raise ValueError("AI reconstruction requires reconstruction editorial role")
            if self.geographic_scope != "generic" or self.may_imply_named_city:
                raise ValueError("AI reconstruction must remain generic and cannot imply a named city")
            if self.on_screen_disclosure != "Dramatic reconstruction — not archival footage":
                raise ValueError("AI reconstruction requires exact on-screen disclosure")
        if self.asset_kind == "source_motion":
            if self.source_class != "historical_evidence" or self.evidence_fit != "direct":
                raise ValueError("source motion must remain a direct presentation of historical evidence")
            if len(self.derivative_source_sha256) != 64 or len(self.motion_receipt_sha256) != 64:
                raise ValueError("source motion requires exact source and motion-receipt hashes")
        return self


class Claim(BaseModel):
    model_config = ConfigDict(extra="forbid")

    claim_id: str = Field(min_length=1)
    text: str = Field(min_length=12)
    fact_checker_status: Literal["verified", "pending", "rejected"]
    source_ids: tuple[str, ...] = ()
    required_entity_terms: tuple[str, ...] = ()

    @model_validator(mode="after")
    def verified_claim_requires_sources(self):
        if self.fact_checker_status == "verified" and not self.source_ids:
            raise ValueError("verified claim requires at least one source")
        return self


class VisualBeat(BaseModel):
    model_config = ConfigDict(extra="forbid")

    beat_id: str = Field(min_length=1)
    claim_ids: tuple[str, ...] = ()
    segment_claim_id: str = ""
    asset_ids: tuple[str, ...] = ()
    role: VisualRole
    start_seconds: float = Field(ge=0)
    end_seconds: float = Field(gt=0)
    reuse_reason: str = ""
    presentation_variant: str = ""
    focus_x: float = Field(default=0.5, ge=0.0, le=1.0)
    focus_y: float = Field(default=0.5, ge=0.0, le=1.0)
    zoom_start: float = Field(default=1.02, ge=1.0, le=2.0)
    zoom_end: float = Field(default=1.08, ge=1.0, le=2.0)
    clip_start_seconds: float | None = Field(default=None, ge=0.0)
    clip_end_seconds: float | None = Field(default=None, gt=0.0)
    editorial_callout: str = ""
    narration_fit: str = ""

    @model_validator(mode="after")
    def validate_timing_and_proof(self):
        if self.end_seconds <= self.start_seconds:
            raise ValueError("visual beat end_seconds must exceed start_seconds")
        if self.role in PROOF_VISUAL_ROLES and not self.claim_ids:
            raise ValueError("proof-oriented beat requires claim_ids")
        if not self.asset_ids:
            raise ValueError("visual beat requires asset_ids")
        if self.segment_claim_id and self.segment_claim_id not in self.claim_ids and not self.narration_fit.strip():
            raise ValueError("cross-claim visual beat requires narration_fit")
        if self.zoom_end < self.zoom_start:
            raise ValueError("visual beat zoom_end must be at least zoom_start")
        if self.clip_end_seconds is not None and self.clip_start_seconds is None:
            raise ValueError("visual beat clip_end_seconds requires clip_start_seconds")
        if (
            self.clip_start_seconds is not None
            and self.clip_end_seconds is not None
            and self.clip_end_seconds <= self.clip_start_seconds
        ):
            raise ValueError("visual beat clip_end_seconds must exceed clip_start_seconds")
        return self


class EpisodeManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    episode_id: str = Field(pattern=r"^\d{2}$")
    title: str = Field(min_length=8)
    claims: tuple[Claim, ...]
    assets: tuple[EvidenceAsset, ...]
    visual_beats: tuple[VisualBeat, ...]

    @field_validator("claims", "assets", "visual_beats")
    @classmethod
    def reject_empty_collections(cls, value):
        if not value:
            raise ValueError("collection cannot be empty")
        return value

    @model_validator(mode="after")
    def validate_references(self):
        claim_ids = {claim.claim_id for claim in self.claims}
        asset_ids = {asset.asset_id for asset in self.assets}
        direct_asset_ids = {asset.asset_id for asset in self.assets if asset.evidence_fit == "direct"}
        proof_by_claim: dict[str, set[str]] = {claim_id: set() for claim_id in claim_ids}
        seen_asset_ids: set[str] = set()
        presentation_variants: dict[str, set[str]] = {}
        use_history: dict[str, list[VisualBeat]] = {}
        assets_by_id = {asset.asset_id: asset for asset in self.assets}
        for beat in self.visual_beats:
            unknown_claims = set(beat.claim_ids) - claim_ids
            unknown_assets = set(beat.asset_ids) - asset_ids
            if unknown_claims or unknown_assets:
                raise ValueError(f"unknown references claims={sorted(unknown_claims)} assets={sorted(unknown_assets)}")
            if beat.role in PROOF_VISUAL_ROLES:
                for claim_id in beat.claim_ids:
                    proof_by_claim[claim_id].update(set(beat.asset_ids) & direct_asset_ids)
            repeated = set(beat.asset_ids) & seen_asset_ids
            if repeated and not beat.reuse_reason.strip():
                raise ValueError(f"reused visual assets require reuse_reason: {sorted(repeated)}")
            if repeated and not beat.presentation_variant.strip():
                raise ValueError(f"reused visual assets require presentation_variant: {sorted(repeated)}")
            for asset_id in beat.asset_ids:
                variant = beat.presentation_variant.strip()
                if asset_id in seen_asset_ids and variant in presentation_variants.get(asset_id, set()):
                    raise ValueError(f"reused visual assets require a new presentation_variant: {asset_id}:{variant}")
                if variant:
                    presentation_variants.setdefault(asset_id, set()).add(variant)
                use_history.setdefault(asset_id, []).append(beat)
            seen_asset_ids.update(beat.asset_ids)
        for asset_id, uses in use_history.items():
            if len(uses) <= 1:
                continue
            asset = assets_by_id[asset_id]
            if asset.source_class in {"modern_context", "ai_reconstruction"}:
                raise ValueError(f"non-proof visual asset cannot be reused: {asset_id}")
            if asset.asset_kind in {"film", "modern_video", "source_motion"}:
                if len(uses) > 2:
                    raise ValueError(f"video source cannot be used more than twice: {asset_id}")
                clip_starts = sorted(float(beat.clip_start_seconds or 0.0) for beat in uses)
                if any(current - prior < 30.0 for prior, current in zip(clip_starts, clip_starts[1:])):
                    raise ValueError(f"reused video source requires distinct clip windows: {asset_id}")
                continue
            if len(uses) > 2:
                raise ValueError(f"static proof asset cannot be used more than twice: {asset_id}")
            if any(beat.role not in PROOF_VISUAL_ROLES for beat in uses):
                raise ValueError(f"only a proof visual may receive one deliberate reprise: {asset_id}")
            ordered = sorted(uses, key=lambda beat: beat.start_seconds)
            gap = ordered[1].start_seconds - ordered[0].end_seconds
            if gap < 180.0:
                raise ValueError(f"proof visual reprise requires a 180 second gap: {asset_id}")
        missing = [claim.claim_id for claim in self.claims if claim.fact_checker_status == "verified" and not proof_by_claim[claim.claim_id]]
        if missing:
            raise ValueError(f"verified claims missing direct visual proof: {missing}")
        return self
