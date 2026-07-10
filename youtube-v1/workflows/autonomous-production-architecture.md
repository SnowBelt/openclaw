# Pattern Lab Autonomous Production Architecture

This is the canonical operating architecture for autonomous Pattern Lab production.

Required sequence:

`OpenClaw strategy/source safety → Canva plugin render → OpenClaw validation → owner review / YouTube test`

OpenClaw must remain the system of record. Canva is a rendering and polish engine, not the source of strategy, truth, rights, or final approval.

## Architecture

### 1. OpenClaw Strategy And Source Safety

OpenClaw owns:

- city-history topic framing
- target-audience promise
- James/source-first voice
- title-thumbnail click hypothesis
- source media policy enforcement
- thumbnail click policy enforcement
- rights-ledger completeness
- first-30-second payoff match
- owner review package

Inputs:

- `youtube-v1/channel-positioning.md`
- `youtube-v1/resources/source-media-policy.json`
- `youtube-v1/resources/thumbnail-click-policy.json`
- `youtube-v1/resources/benchmark-channel-growth-playbook.json`
- `youtube-v1/workflows/benchmark-channel-production-workflow.md`
- `youtube-v1/workflows/thumbnail-production-workflow.md`
- active video script, source packet, rights ledger, and upload metadata

OpenClaw must reject production if safe source material does not exist. The fallback is an original Pattern Lab map, photo-backed explanation graphic, timeline, or labeled reconstruction, not an unsourced image or fake archival visual. Thumbnails must not look like internal source boards; they must use one dominant real source photo/map/document, one proof mark, and large phone-readable text.

### Benchmark-Channel Growth Mechanics

Pattern Lab should adapt the mechanics of high-performing city-history, urbanism, construction, abandoned-place, and public-history channels without copying their creative work.

Canonical target:

`Bright Sun Films mystery + The B1M polish + Not Just Bikes clarity + Here Grows New York map proof`

Every production package must follow:

`One city. One strange visual clue. One source trail. One hidden system.`

Required behavior:

- sell a mystery, contradiction, vanished place, map change, or hidden system rather than a generic `History of {city}` topic
- use a repeatable series family such as `The Map Changed`, `Vanished`, `Under the City`, `One Building Explains`, `Before the Cars`, `The Street That Moved`, or `City Myths`
- open with a visible source/photo/map clue before any Pattern Lab branding
- pay off the title-thumbnail promise in the first 30 seconds
- use real people, buildings, attractions, neighborhoods, industry, maps, documents, transit, aerials, and modern context footage when those are relevant to the narration
- prepare a 5-7 Short concept pack for each long-form episode, even when only the strongest three are rendered first
- use YouTube title/thumbnail testing when available and learn from watch-time share, CTR by surface, first-30-second retention, and expectation-match comments
- never copy another channel's thumbnail layout, wording, host style, music bed, pacing fingerprint, or distinctive design system

### Visual Density And Narration Match

Pattern Lab videos should feel full of real pictures and video, not generated filler.

For every production-grade long-form city file, OpenClaw must:

- build a rights-ledgered visual source pack before assembly
- use real historical photos, archival footage, maps, documents, and modern context stock as the default visual layer
- source more rights-safe images/video before assembly if the source pack is thin
- keep generated graphics limited to overlays on real source media or photo-backed composites
- target at least 90% real-media or photo-backed visual runtime after the opening source-proof clip
- keep full-screen generated-only slide runtime at 0%
- keep the full-screen non-picture slide count at 0
- change visuals at least every 12 seconds outside the opening proof clip
- match each picture or clip to nearby narration using source title, filename, role, and keyword relevance
- never use modern stock/context footage as proof of a historical claim

If these checks cannot pass, the video is not production-ready. OpenClaw must find more safe source media or rewrite/restructure the visual plan before owner review.

### Motion And AI Visual Priority

Canonical policy: `youtube-v1/workflows/motion-ai-visual-policy.md`.

Pattern Lab should use motion to make source media more engaging without weakening trust. The required visual priority order is:

1. real source media
2. deterministic motion on real media
3. source-grounded maps and graphics
4. labeled AI text-to-image reconstruction
5. labeled AI text/image-to-video reconstruction

Deterministic motion includes Ken Burns pans/zooms, map zooms, document closeups, source highlights, then/now reveals, and subtle parallax. AI can illustrate. It cannot prove.

Local model strategy:

- LTX is the first local smoke-test candidate for text-to-video and image-to-video.
- Wan2.2-TI2V-5B is the production candidate only after local proof that quality, runtime, and workflow stability are acceptable.
- Wan2.2-I2V-A14B is research/premium only and requires explicit manual approval before use.

Real historical figures may be animated only as clearly labeled reconstruction and owner-approved. Fake lip-sync, fake quotes, realistic unlabeled fake archival footage, and AI output presented as source proof are invalid.

### 2. Canva Plugin Render

When the Canva plugin is connected, OpenClaw should use it as the preferred autonomous thumbnail renderer.

OpenClaw sends Canva a structured brief for each thumbnail:

- candidate role: emotional mystery, map/system proof, or contrarian history angle
- 2-4 word thumbnail text
- city anchor
- proof object
- visual contradiction
- source media files or safe uploaded assets
- Pattern Lab brand colors and layout constraints
- dominant real photo/map/document base
- one major proof mark: route line, circle, arrow, tear line, or simple split
- rejection of source-board clutter, tiny captions, multiple boxes, thin grids, and small labels
- explicit no-watermark/no-Pro-locked-Free-export instruction

Canva returns:

- rendered design
- exportable clean PNG/JPG
- design URL or id for review provenance

Canva must not choose historical claims, invent source material, select unclear stock, or override OpenClaw rights rules.

### 3. OpenClaw Validation

OpenClaw validates every rendered output before owner review:

- correct file name and output path
- clean PNG/JPG export
- no Canva watermark
- no Pro-locked element in a Free-plan export
- no unclear Canva stock asset
- readable at phone size
- one dominant focal point
- one dominant real photo/map/document
- no source-board clutter or tiny unreadable labels
- one major proof mark instead of several competing boxes/lines
- 2-4 words
- clear city anchor
- clear proof object
- clear visual mystery
- title-thumbnail promise match
- first-30-second payoff match
- rights-ledger rows complete
- no fake archival proof
- no copied or generic template feel

If any check fails, OpenClaw must regenerate, repair, or fall back to local generation plus Photopea/GIMP polish.

### 4. Owner Review / YouTube Test

OpenClaw prepares the owner review packet with:

- all three thumbnail candidates
- Canva design URL or id for each Canva-rendered candidate
- title pairing for each candidate
- source/rights summary
- default recommendation
- A/B testing notes

Owner approval is still required before private/unlisted upload or public publish.

After publish, OpenClaw should use YouTube Test & Compare when available and learn from:

- watch-time-share winner
- browse CTR
- suggested CTR
- first-30-second retention
- average view duration
- subscriber conversion
- comments showing expectation match or mismatch

## Non-Negotiable Rule

The strategy is fixed unless the owner explicitly changes it:

`OpenClaw strategy/source safety → Canva plugin render → OpenClaw validation → owner review / YouTube test`

Any autonomous Pattern Lab workflow that skips OpenClaw source safety, OpenClaw validation, or owner review is invalid.
