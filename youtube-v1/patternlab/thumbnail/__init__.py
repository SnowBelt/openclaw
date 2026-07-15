"""Thumbnail domain boundary shared by Pattern Lab CLI adapters.

The modules in this package deliberately depend only on the Python standard
library.  Renderers and QA scripts stay at the edge of the application; they
consume these contracts instead of each independently interpreting a review
manifest.
"""

from .manifest import (
    THUMBNAIL_REVIEW_MANIFEST_FILENAME,
    ThumbnailCandidateManifest,
    load_thumbnail_candidate_manifest,
    thumbnail_review_manifest_path,
)
from .quality import candidate_issues, quality_status

__all__ = [
    "THUMBNAIL_REVIEW_MANIFEST_FILENAME",
    "ThumbnailCandidateManifest",
    "candidate_issues",
    "load_thumbnail_candidate_manifest",
    "quality_status",
    "thumbnail_review_manifest_path",
]
