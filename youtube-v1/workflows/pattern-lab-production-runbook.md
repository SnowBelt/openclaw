# Pattern Lab Production Runbook

Status: local production-grade runbook; public YouTube mutation remains blocked until exact owner approval.

## 1. Topic Selection

1. Generate or select the city-history topic.
2. Reject weak or generic topics before rendering.
3. Required brief fields: city, topic, click question, emotional tension, proof object, required source type, exact thumbnail text, forbidden elements, and first-30-second payoff.

Stop point: do not render if the hook cannot be paid off in the first 30 seconds.

## 2. Source Packet

```bash
youtube-v1/.venv-youtube/bin/python youtube-v1/scripts/build_real_city_test_package.py --video-id <video-id> --city <City>
```

Requirements:

- Rights ledger exists.
- Source asset report passes.
- Source provider health report is written.
- No paid/pro/unclear stock is selected.
- First-time cities may use geocode fallback; if geocoding/source fetch fails, write a blocker report and stop.

## 3. Thumbnail Rendering

Primary route when available: approved Canva no-AI templates only, replacing text/image slots and preserving template fonts.

Fallback route when Canva export is unavailable:

```bash
youtube-v1/.venv-youtube/bin/python youtube-v1/scripts/patternlab_chrome_thumbnail_renderer.py --video-id <video-id> --city <City> --candidate-count 5
```

Requirements:

- Five 1920x1080 production candidates.
- Five 1280x720 RGB JPEG `_chat.jpg` owner-review previews.
- Lower-half visual integrity passes 5/5.
- Topic-source match passes.
- First-30-second payoff passes.
- No public labels like `SOURCE PHOTO`, `RECEIPT`, or generic `SOURCE FILE`.

## 4. Local QA Gates

```bash
youtube-v1/.venv-youtube/bin/python youtube-v1/scripts/patternlab_quality_gates.py --video-id <video-id>
youtube-v1/.venv-youtube/bin/python youtube-v1/scripts/patternlab_shorts_followup_packet.py --video-id <video-id>
youtube-v1/.venv-youtube/bin/python youtube-v1/scripts/patternlab_title_thumbnail_pair_packet.py --video-id <video-id>
youtube-v1/.venv-youtube/bin/python youtube-v1/scripts/patternlab_performance_learning_scaffold.py --video-id <video-id>
youtube-v1/.venv-youtube/bin/python youtube-v1/scripts/generate_owner_review_packet.py --video-id <video-id>
youtube-v1/.venv-youtube/bin/python youtube-v1/scripts/patternlab_dashboard_server.py --check --video-id <video-id>
```

Stop point: if any local gate is blocked, do not upload, replace thumbnails, publish, or use paid/pro assets.

## 5. Owner Review

Send only chat-safe `_chat.jpg` previews in chat. Keep production PNG paths in the owner packet for final candidate selection.

Owner packet must show city, topic, hook, selected source, proof object, rights status, topic-source match, first-30-second payoff, chat-safe preview paths, production PNG paths, and blockers.

## 6. Private Upload Approval

Private/unlisted upload remains blocked until explicit owner approval. Approval template:

> I approve OpenClaw Pattern Lab to upload Pattern Lab Video [exact local video path] to YouTube as private/unlisted. I do not authorize public publish or any other YouTube mutation.

## 7. Thumbnail Replacement Approval

Thumbnail replacement remains blocked until exact owner approval names the video and local candidate path:

> I approve replacing the YouTube thumbnail for Pattern Lab Video [exact YouTube video ID] with [exact local file path]. I do not authorize public publish or any other YouTube mutation.

## 8. Public Publish Approval

Public publish requires a separate exact approval:

> I approve setting Pattern Lab Video [exact YouTube video ID] public on YouTube. I do not authorize any other YouTube mutation.

Default publish cadence after approval:

- Long-form: Tuesday / Thursday / Saturday.
- Time: 11:00 AM America/New_York.
- Shorts: 2-3 per long-form, same day and following day.

## 9. Analytics Learning Loop

Use local scaffold checkpoints at 24h, 72h, 7d, and 30d. If YouTube Analytics OAuth is unavailable, write a blocker report and keep the learning loop local until reauthorized.

```bash
youtube-v1/.venv-youtube/bin/python youtube-v1/scripts/patternlab_fetch_youtube_analytics.py --video-id <video-id> --checkpoint-hours 24 --live
youtube-v1/.venv-youtube/bin/python youtube-v1/scripts/patternlab_performance_learning_scaffold.py --video-id <video-id>
```

Decision rule: judge title-thumbnail tests by watch-time share first, then CTR and retention.
