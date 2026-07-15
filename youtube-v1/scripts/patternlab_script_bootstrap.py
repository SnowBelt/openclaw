"""Make Pattern Lab packages importable for scripts launched from the repo root.

Python adds the script directory, not its parent, to ``sys.path`` when a file is
executed directly. Canonical production commands intentionally run from the
repository root, so every standalone script that imports ``patternlab`` loads
this tiny bootstrap before importing the package.
"""
from __future__ import annotations

import sys
from pathlib import Path


YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))
