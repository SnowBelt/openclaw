# Pattern Lab Source Media Guide

Pattern Lab should look premium without becoming generic. Use free media strategically: historical media proves the story, modern stock footage supports pacing, and original graphics explain the system.

Canonical agent policy: `youtube-v1/resources/source-media-policy.json`.

Acquisition order and exact-item receipt rules:
`youtube-v1/resources/visual-acquisition-routing-policy.json`.

OpenClaw agents should read that JSON policy before sourcing or approving Pattern Lab images or video. This markdown guide explains the practical editorial use of the same source classes.

## Preferred Free Video Sources

### Automation-First Order

1. Pexels API for modern city video and photos.
2. Pixabay API for modern video, photos, illustrations, and vectors.
3. Mixkit exact-item browser fallback.
4. Coverr exact-item browser fallback with attribution preserved
   conservatively.
5. Videvo/Videezy only as a manual exception after item-level review.

Do not store a search/category URL as the source receipt. Cache API metadata,
download the selected file locally, and preserve the exact item page, creator,
license page, attribution, retrieval time, and SHA-256.

Archive API JSON is cached locally for 24 hours. On HTTP 429, Pattern Lab may
use a previously cached response, honor a short provider `Retry-After`, or stop
that provider lane; it must not hammer the endpoint or fill the gap with an
unrelated asset.

If an archive API remains rate-limited, use the sanctioned browser or readable
web fallback only to collect exact item-page leads. The final file still needs
item-level rights, creator, download URL, local hash, and either deterministic
machine acceptance or explicit human acceptance. Final episode approval remains
hash-bound at the package level.

For unattended API acquisition, create free provider keys at
https://www.pexels.com/api/ and https://pixabay.com/api/docs/. Store them under
the Pattern Lab Keychain service `ai.openclaw.patternlab` with accounts
`pexels.api-key` and `pixabay.api-key`; do not put them in source control or
Discord. The acquisition script also accepts temporary `PEXELS_API_KEY` and
`PIXABAY_API_KEY` environment variables.

Plan without network or keys:

```bash
youtube-v1/.venv-youtube-3.12/bin/python youtube-v1/scripts/patternlab_free_stock_acquisition.py --video-id 04
```

The canonical unattended path uses configured providers when available,
downloads a bounded provider-diverse set, and remains plan-only when no key is
configured:

```bash
youtube-v1/.venv-youtube-3.12/bin/python youtube-v1/scripts/patternlab_free_stock_acquisition.py --video-id 04 --auto --download-per-context 1
```

For an explicit live diagnostic query without automatic selection:

```bash
youtube-v1/.venv-youtube-3.12/bin/python youtube-v1/scripts/patternlab_free_stock_acquisition.py --video-id 04 --live
```

### Pexels

- Use for modern city B-roll, streets, traffic, offices, industrial textures, skyline atmosphere, people walking, light leaks, and generic context shots.
- Strength: clean cinematic clips, simple no-attribution license, good for YouTube pacing.
- Rule: never use a Pexels clip as historical proof. It is context footage unless it documents the exact place/event being discussed and the source claim is separately verified.
- License reference: https://www.pexels.com/license/
- API reference: https://www.pexels.com/api/documentation/
- Reliability: respect the returned rate-limit headers. Default access is 200
  requests per hour and 20,000 per month. Credit and link to Pexels and the
  creator when practical even when the license does not require attribution.

### Pixabay

- Use for free stock video, motion graphics, nature/city inserts, abstract backgrounds, and occasional 4K clips.
- Strength: large library and multiple media types.
- Rule: avoid clips with recognizable trademarks, logos, brands, people in sensitive contexts, or anything that would imply endorsement.
- License reference: https://pixabay.com/service/license-summary/
- API reference: https://pixabay.com/api/docs/
- Reliability: respect 100 requests per 60 seconds, cache results for 24 hours,
  download selected media locally, and never systematically mass-download the
  library.

### Mixkit

- Use for cinematic B-roll, vertical clips, transitions, and clean atmosphere shots.
- Strength: polished stock-video library and creator-friendly browsing.
- Rule: verify whether the downloaded item is under the free stock-video license or a restricted license before it enters the edit.
- License reference: https://mixkit.co/license/

### Coverr

- Use for HD/occasional 4K background footage, modern ambience, city-adjacent scenes, texture, and pacing support.
- Strength: professional background-video style.
- Rule: keep attribution requirements and trademark/property caveats in the rights ledger; do not use clips with visible brands or landmarks as commercial proof without extra clearance.
- License reference: https://coverr.co/license
- Conservative rule: current Coverr license text contains inconsistent
  attribution wording. Preserve creator/Coverr credit rather than assuming no
  attribution.

### Videvo And Videezy

- Use selectively for 4K, aerials, specialty footage, and gaps not covered by Pexels/Pixabay/Mixkit/Coverr.
- Strength: broader footage variety.
- Rule: item-level licenses vary. Some free clips require attribution or are editorial-only. Do not use unless the exact clip license is logged and compatible with the intended YouTube upload.

## Preferred Historical And Archival Video Sources

### National Archives

- Use for U.S. government footage, archival films, public records, and historical motion-picture material.
- Strength: source authority.
- Rule: NARA holdings are not automatically public domain. Federal works are often public domain in the U.S., but Special Media items can carry restrictions. Log the item-level rights basis and any NARA warning.
- Rights reference: https://www.archives.gov/research/still-pictures/permissions

### NASA Image And Video Library

- Use for space, satellite, aeronautics, infrastructure, environmental, and Earth-observation context when relevant to a city story.
- Strength: high-quality public media.
- Rule: acknowledge NASA as source, do not imply endorsement, watch logo/employee/personality-right restrictions, and avoid promotional/merchandise use.
- Rights reference: https://www.nasa.gov/nasa-brand-center/images-and-media/

### Internet Archive / Prelinger

- Use for public-domain films, industrial films, educational films, city footage, transportation footage, and historical context.
- Strength: deep archival video library.
- Rule: rights vary by item. Use only when the item page and metadata support public-domain or compatible reuse. Do not treat upload availability as permission.

### Library Of Congress Film Collections

- Use for rights-clear motion pictures, transportation, industry, civic life,
  and documentary footage when the item has a compatible rights statement.
- Rule: use the exact item page. A collection search result is not a license.

### Smithsonian Open Access

- Use for CC0 images, objects, scans, and occasional media relevant to a story.
- Rule: use only assets carrying the CC0 icon. Preserve title, source URL, and
  Smithsonian credit even when attribution is optional.
- Reference: https://www.si.edu/openaccess/faq

### Digital Public Library Of America

- Use as a cross-institution discovery layer for photos, maps, and documents.
- Rule: auto-promote only `Unlimited Re-Use` items with exact item statements;
  otherwise retain the result as a lead.
- Reference: https://dp.la/about/rights-categories

## Preferred Free Photo Sources

- Pexels: modern stock photos and texture/backgrounds.
- Pixabay: photos, illustrations, vectors, and occasional public-domain/CC0 items.
- Unsplash: polished modern stills and atmospheric backgrounds.
- Wikimedia Commons: historical or modern images only when the file license permits YouTube/commercial use and attribution terms are logged.
- Library of Congress: historical photos, maps, posters, and no-known-restrictions/public-domain items when item-level rights are clear.
- Local archives/libraries: use only when reuse rights are explicit or permission is obtained.

## Local Institution Lead Lane

Local collections often have the most compelling city-specific material, but
catalog access does not automatically grant commercial publication rights.
Treat these as high-value permission leads:

- Detroit Public Library Burton Historical Collection and Digital Collections.
- Wayne State Walter P. Reuther Library and Wayne digital collections.
- University of Michigan Bentley Historical Library.
- Detroit Historical Society digital collections.

Record the collection name, item identifier, contact/permission status, and
proposed narration beat. Promote the item only after its exact reuse terms or
written permission are preserved in the ledger.

## What Strong City-History Channels Combine

Use a mixed visual language rather than one stock library:

- exact archival photos, documents, maps, and film for proof;
- current stock or self-shot footage for motion and geographic orientation;
- source-grounded maps, timelines, and labels for explanation;
- matched then/now images for transformation;
- deterministic camera motion on still evidence;
- a small amount of clearly non-proof AI support or labeled reconstruction.

This is more durable than filling a timeline with generic skyline stock. It
also gives each episode materially different substance instead of a repeated
template.

## Production Rules

- Every final asset needs a rights-ledger row before owner review.
- Record the source URL, creator, archive/platform, license or rights basis, attribution text, commercial-use status, modification status, recognizable people/property/trademark risk, local path, and source class.
- Do not use watermarked previews, editorial-only stock clips, unlicensed YouTube footage, TikTok/Instagram reposts, random image-search files, or stock footage that implies endorsement.
- Do not let stock video carry the story. It supports pace and mood; maps, archival materials, source boards, and original graphics carry proof.
- Build at least three viable visual candidates for each narration beat before
  final selection. Historical claim beats need at least one exact proof option.
- Target at least six selected modern context video clips in a long-form source
  pool. Archival video is preferred when available, but never fabricated to
  satisfy a quota.
- Reject dim or low-energy modern thumbnail heroes/insets using pixel-derived
  luma, saturation, and contrast checks. Replace the source; do not rescue it
  with filters.
- Prefer a premium mix per long-form video:
  - 40-55% historical evidence, maps, documents, and original graphics.
  - 20-35% modern B-roll/context footage.
  - 10-20% then/now comparisons and source boards.
  - 0-8% labeled AI support/reconstruction or generated motion.
  - 2-8% James/avatar/brand cards and transitions.

## Making Historical Stills Feel Alive

Use source-preserving presentation before synthesis:

1. subject/background 2.5D parallax from Apple Vision or a reviewed mask;
2. slow focal push, lateral pan, rack-focus simulation, or foreground reveal;
3. source highlights, circles, route traces, address pins, and document zooms;
4. matched then/now wipes and anchored split screens;
5. newspaper/document layer stacks with restrained depth and light;
6. short archival montages cut to narration clauses and sound-design accents.

Keep movements subtle enough that faces, hands, signs, buildings, and source
meaning do not change. A person moving relative to the background is permitted
as camera/depth treatment; making the person blink, speak, gesture, or perform
a new action is generative reconstruction and requires disclosure/owner review.

Generic rights-cleared footage is valuable when it matches a generic action:
foot traffic, moving, assembly work, transit, storefront browsing, traffic, or
neighborhood life. It remains context-only and may never be presented as the
named city/event. Use exact-item Pexels/Pixabay API assets, verified
Mixkit/Coverr items, or the hash-bound reusable context library rather than
redownloading the same clip.

## Source Diversity Requirement For City Thumbnail Packages

Pattern Lab must not depend on one image provider for a city package. The real-city builder should try a provider stack before declaring a city blocked:

1. Wikimedia Commons for CC/public-domain city photos, maps, and landmarks.
2. Library of Congress for historical photos, maps, and no-known-restrictions records.
3. Openverse for commercial/modification-compatible Creative Commons images across indexed collections.
4. OpenStreetMap static maps for map support when no rights-compatible historical map is found.
5. Optional API-key modern context providers: Pexels, Pixabay, and Unsplash. These are modern context only, not historical proof.
6. Local archives and libraries when item-level reuse terms or permission are explicit and ledgered.

Every provider attempt should be reported in the source asset report. A failed Wikimedia lookup must not block the package until the other configured providers have been tried. If all providers fail, the package is blocked as a source shortfall, not silently replaced with AI or ad-hoc mockups.

Photo diversity rule: unique-topic city thumbnail sets should use different relevant photos/maps/documents whenever the source packet allows it. Reusing the same source image is acceptable only for deliberate A/B testing and must be labeled as such.
