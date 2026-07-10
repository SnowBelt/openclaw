# Pattern Lab YouTube Analytics OAuth Reauthorization Runbook

Generated: 2026-07-09T22:23:39Z
Status: pass
Live analytics: blocked_until_owner_reauthorizes_readonly_oauth

## Required Scope

- `https://www.googleapis.com/auth/yt-analytics.readonly`

## Token Check

- Confirm `YOUTUBE_TOKEN_FILE` points to the authorized user token.
- Confirm the token contains the required scope.
- If refresh fails with `invalid_grant`, the owner must reauthorize; do not treat this as a script failure.

## Commands After Reauthorization

```bash
youtube-v1/.venv-youtube/bin/python youtube-v1/scripts/patternlab_fetch_youtube_analytics.py --video-id <video-id> --checkpoint-hours 24 --live
youtube-v1/.venv-youtube/bin/python youtube-v1/scripts/patternlab_fetch_youtube_analytics.py --video-id <video-id> --checkpoint-hours 72 --live
youtube-v1/.venv-youtube/bin/python youtube-v1/scripts/patternlab_fetch_youtube_analytics.py --video-id <video-id> --checkpoint-hours 168 --live
youtube-v1/.venv-youtube/bin/python youtube-v1/scripts/patternlab_fetch_youtube_analytics.py --video-id <video-id> --checkpoint-hours 720 --live
```

YouTube mutation: not_performed.
