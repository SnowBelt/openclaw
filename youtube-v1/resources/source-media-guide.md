# Pattern Lab Source Media Guide

Pattern Lab should look premium without becoming generic. Use free media strategically: historical media proves the story, modern stock footage supports pacing, and original graphics explain the system.

Canonical agent policy: `youtube-v1/resources/source-media-policy.json`.

OpenClaw agents should read that JSON policy before sourcing or approving Pattern Lab images or video. This markdown guide explains the practical editorial use of the same source classes.

## Preferred Free Video Sources

### Pexels

- Use for modern city B-roll, streets, traffic, offices, industrial textures, skyline atmosphere, people walking, light leaks, and generic context shots.
- Strength: clean cinematic clips, simple no-attribution license, good for YouTube pacing.
- Rule: never use a Pexels clip as historical proof. It is context footage unless it documents the exact place/event being discussed and the source claim is separately verified.
- License reference: https://www.pexels.com/license/

### Pixabay

- Use for free stock video, motion graphics, nature/city inserts, abstract backgrounds, and occasional 4K clips.
- Strength: large library and multiple media types.
- Rule: avoid clips with recognizable trademarks, logos, brands, people in sensitive contexts, or anything that would imply endorsement.
- License reference: https://pixabay.com/service/license-summary/

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

## Preferred Free Photo Sources

- Pexels: modern stock photos and texture/backgrounds.
- Pixabay: photos, illustrations, vectors, and occasional public-domain/CC0 items.
- Unsplash: polished modern stills and atmospheric backgrounds.
- Wikimedia Commons: historical or modern images only when the file license permits YouTube/commercial use and attribution terms are logged.
- Library of Congress: historical photos, maps, posters, and no-known-restrictions/public-domain items when item-level rights are clear.
- Local archives/libraries: use only when reuse rights are explicit or permission is obtained.

## Production Rules

- Every final asset needs a rights-ledger row before owner review.
- Record the source URL, creator, archive/platform, license or rights basis, attribution text, commercial-use status, modification status, recognizable people/property/trademark risk, local path, and source class.
- Do not use watermarked previews, editorial-only stock clips, unlicensed YouTube footage, TikTok/Instagram reposts, random image-search files, or stock footage that implies endorsement.
- Do not let stock video carry the story. It supports pace and mood; maps, archival materials, source boards, and original graphics carry proof.
- Prefer a premium mix per long-form video:
  - 40-55% historical evidence, maps, documents, and original graphics.
  - 20-35% modern B-roll/context footage.
  - 10-20% then/now comparisons and source boards.
  - 5-10% James/avatar/brand cards and transitions.

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
