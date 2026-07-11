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
    asset_kind: Literal["photo", "map", "document", "film", "modern_video", "graphic"] = "photo"

    @model_validator(mode="after")
    def enforce_proof_rules(self):
        if self.evidence_fit == "direct" and self.source_class != "historical_evidence":
            raise ValueError("direct evidence requires historical_evidence source class")
        if self.source_class == "ai_reconstruction" and self.evidence_fit == "direct":
            raise ValueError("AI reconstruction cannot be direct evidence")
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
    asset_ids: tuple[str, ...] = ()
    role: VisualRole
    start_seconds: float = Field(ge=0)
    end_seconds: float = Field(gt=0)
    reuse_reason: str = ""

    @model_validator(mode="after")
    def validate_timing_and_proof(self):
        if self.end_seconds <= self.start_seconds:
            raise ValueError("visual beat end_seconds must exceed start_seconds")
        if self.role in {"source_proof", "map_system", "archive_evidence", "document_detail"} and not self.claim_ids:
            raise ValueError("proof-oriented beat requires claim_ids")
        if not self.asset_ids:
            raise ValueError("visual beat requires asset_ids")
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
        for beat in self.visual_beats:
            unknown_claims = set(beat.claim_ids) - claim_ids
            unknown_assets = set(beat.asset_ids) - asset_ids
            if unknown_claims or unknown_assets:
                raise ValueError(f"unknown references claims={sorted(unknown_claims)} assets={sorted(unknown_assets)}")
            if beat.role in {"source_proof", "map_system", "archive_evidence", "document_detail"}:
                for claim_id in beat.claim_ids:
                    proof_by_claim[claim_id].update(set(beat.asset_ids) & direct_asset_ids)
            repeated = set(beat.asset_ids) & seen_asset_ids
            if repeated and not beat.reuse_reason.strip():
                raise ValueError(f"reused visual assets require reuse_reason: {sorted(repeated)}")
            seen_asset_ids.update(beat.asset_ids)
        missing = [claim.claim_id for claim in self.claims if claim.fact_checker_status == "verified" and not proof_by_claim[claim.claim_id]]
        if missing:
            raise ValueError(f"verified claims missing direct visual proof: {missing}")
        return self
