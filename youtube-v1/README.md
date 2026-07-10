# Pattern Lab YouTube V1

Local-first operating kit for producing Pattern Lab city-history videos and Shorts with approval-gated publishing, rights-safe historical visuals, monetization gates, structured review actions, performance learning, and production-grade public-channel positioning.

## Current Goal

Run the next Pattern Lab private review package:

- choose the next evidence-backed American city-history topic from the channel positioning in `youtube-v1/channel-positioning.md`
- start with Detroit as the pilot city season
- generate upload metadata
- evaluate monetization gates
- evaluate long-form quality gates
- source or generate rights-safe visuals
- generate or verify final voiceover
- assemble long-form draft
- generate three Shorts
- write Shorts upload plan
- write private-upload readiness report
- send the review packet to Discord/dashboard
- upload private or unlisted only after explicit approval
- record performance metrics after public publish
- keep public publishing blocked until owner approval

## Monetization Operating Defaults

- Lane: hidden systems behind American cities.
- Sub-lanes: city origins and turning points, lost neighborhoods and infrastructure, people culture and industry.
- Primary YPP path: 1,000 subscribers and 4,000 valid public long-form watch hours.
- Secondary Shorts path: 1,000 subscribers and 10M valid public Shorts views in 90 days.
- Cadence target: build for 3 high-quality long-form videos/week and a 5-7 Short concept pack per long-form; render at least the strongest 3 Shorts first, and publish only when gates stay green.
- Long-form target: 10-14 minutes with a map, archive, photo, record, building, neighborhood, or source proof visible in the first 20 seconds.
- Retention ladder: first 5 seconds must open a loop, first 20 seconds must show proof, every 45-75 seconds needs a new beat, and every video ends with the city-file promise.
- Benchmark-channel formula: one city, one strange visual clue, one source trail, one hidden system.
- Series packaging: use repeatable families such as The Map Changed, Vanished, Under the City, One Building Explains, Before the Cars, The Street That Moved, or City Myths; never package the video as generic `History of {city}`.
- Subscribe CTA: required, earned, and tied to the next evidence-backed city file; never interrupt the opening hook.
- Shorts target: 30-60 seconds, with 25-45 seconds allowed for dense clips; each Short needs one city-history proof moment, one bridge to the long-form video, and a light subscribe cue.
- Topic score threshold: 80/100.
- Metrics checkpoints: record 24h, 72h, 7d, and 30d performance after public publish.
- Public launch protocol: publish long-form first, then Shorts with the long-form set as Related Video.
- Historical images: preferred when rights are clear; every real historical image needs a rights-ledger row before review.
- Free stock video and photos: allowed for premium context, pacing, and atmosphere when source-logged; they must not carry historical claims unless independently source-verified.
- AI visuals: allowed as graphics/reconstructions only; never present them as archival proof.
- Long-form agent: see `youtube-v1/agents/long-form-agent.md`; every long-form draft must pass the long-form quality report before review delivery.
- Shorts agent: see `youtube-v1/agents/shorts-agent.md`; every Short must pass the Shorts quality report before review delivery.

## Production Identity Docs

- Channel positioning: `youtube-v1/channel-positioning.md`
- Public YouTube profile: `youtube-v1/resources/channel-branding/youtube-public-profile.md`
- Visual brand kit: `youtube-v1/resources/channel-branding/brand-kit.md`
- Channel trailer script: `youtube-v1/resources/channel-branding/trailer-script.md`
- Playlist architecture: `youtube-v1/resources/channel-branding/playlist-architecture.md`
- Production-grade milestones: `youtube-v1/production-grade-milestones.md`
- Autonomous production architecture: `youtube-v1/workflows/autonomous-production-architecture.md`
- Free/source media guide: `youtube-v1/resources/source-media-guide.md`
- Machine-readable source media policy for OpenClaw agents: `youtube-v1/resources/source-media-policy.json`
- Machine-readable thumbnail click policy: `youtube-v1/resources/thumbnail-click-policy.json`
- Machine-readable benchmark growth playbook: `youtube-v1/resources/benchmark-channel-growth-playbook.json`
- Benchmark-channel production workflow: `youtube-v1/workflows/benchmark-channel-production-workflow.md`
- Machine-readable YouTube guru growth policy: `youtube-v1/resources/youtube-guru-growth-policy.json`
- YouTube guru growth workflow: `youtube-v1/workflows/youtube-guru-growth-workflow.md`
- Thumbnail production workflow: `youtube-v1/workflows/thumbnail-production-workflow.md`
- Thumbnail renderer default: `OpenClaw strategy/source safety → Canva plugin render → OpenClaw validation → owner review / YouTube test`, with local generation fallback and no watermarked or Pro-locked Free-plan exports.

## Useful Commands

```bash
python3 youtube-v1/scripts/generate_upload_metadata.py --video-id 03
python3 youtube-v1/scripts/generate_canva_thumbnail_brief.py --video-id 03
python3 youtube-v1/scripts/patternlab_thumbnail_quality.py --video-id 03
python3 youtube-v1/scripts/patternlab_benchmark_growth.py --video-id 03
python3 youtube-v1/scripts/patternlab_guru_growth_gates.py --video-id 03
python3 youtube-v1/scripts/patternlab_source_rights.py --video-id 03
python3 youtube-v1/scripts/monetization_gates.py --video-id 03
python3 youtube-v1/scripts/generate_voiceover.py --video-id 03 --dry-run
python3 youtube-v1/scripts/generate_voiceover.py --video-id 03 --live
python3 youtube-v1/scripts/build_video_ffmpeg.py --video-id 03 --dry-run
python3 youtube-v1/scripts/patternlab_long_form_quality.py --video-id 03
python3 youtube-v1/scripts/generate_shorts_ffmpeg.py --video-id 03 --dry-run
python3 youtube-v1/scripts/patternlab_shorts_quality.py --video-id 03
python3 youtube-v1/scripts/private_upload_readiness.py --video-id 03
python3 youtube-v1/scripts/public_publish_readiness.py --video-id 03
python3 youtube-v1/scripts/patternlab_retention_ladder.py --video-id 03
python3 youtube-v1/scripts/patternlab_monetization_tracker.py
python3 youtube-v1/scripts/patternlab_content_calendar.py
python3 youtube-v1/scripts/run_patternlab_pipeline.py --video-id 03
python3 youtube-v1/scripts/send_daily_review_to_discord.py --video-id 03 --dry-run
python3 youtube-v1/scripts/upload_private_youtube.py --video-id 03 --surface long-form --privacy private
python3 youtube-v1/scripts/analyze_performance.py --video-id 03
```

Generated media and secrets stay local and ignored under `youtube-v1/local-output/` and `youtube-v1/.env`.

## Approval Actions

Dashboard and Discord review actions are intentionally structured:

- `approve`: marks the reviewed asset type approved in the rights ledger.
- `reject`: marks the asset type rejected and queues a repair.
- `regenerate`: queues a new generated variant.
- `repair`: queues a targeted repair such as pacing, voice, source rights, or privacy.
- `revise_hook`: requests a rebuild of the first 30 seconds and Shorts hooks.
- `kill_topic`: stops a weak topic before it turns into inauthentic output.
- `approve_private_upload`: allows private/unlisted upload only.
- `approve_public_publish`: records owner approval after private upload and YouTube checks; it does not publish automatically.
