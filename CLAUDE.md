# MFC Social Poster

Express.js microservice that posts media (images + videos) to Twitter and Bluesky. Called by N8N automation, not directly by users.

## Architecture Context

```
Directus (CMS) → N8N (every 15 min) → this service → Twitter + Bluesky
```

- **Directus** (directus.manlyfeet.club) — stores posts in `posts` collection, `publish_at` is in **Eastern Time**
- **N8N** (n8n.manlyfeet.club) — workflow ID `ripj4IRh86Mg7AqjTWcaT`, polls Directus, calls `/post/all`
- **This service** (poster.manlyfeet.club) — receives media URL + caption, posts to both platforms

## API

All POST routes require `X-Api-Key` header. API key is in Coolify env vars.

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Liveness check |
| `POST /post/twitter` | Twitter only |
| `POST /post/bluesky` | Bluesky only |
| `POST /post/all` | Both platforms concurrently |

**Request body:** `{ mediaUrl, caption, isVideo, mediaType }`
- `caption` is optional (defaults to empty string)
- `isVideo` defaults to false
- `mediaType` defaults to `image/jpeg` or `video/mp4`

**Response:** `{ twitter: { success, id }, bluesky: { success, uri, cid } }`
**Status codes:** 200 (all OK), 207 (partial success), 500 (all failed)

## Platform Details

- **Twitter:** OAuth 1.0a, chunked upload for videos (5MB chunks), polls processing up to 5 min
- **Bluesky:** @atproto/api with app password, resolves PDS DID for video auth, RichText for mentions/hashtags

## Environment Variables

See `.env.example`. Requires: `API_KEY`, Twitter OAuth creds (4 values), Bluesky identifier + app password.

## Deployment

- **Coolify UUID:** `n4gckw4gcg4ww8wgc4sskk8c`
- **GitHub:** `buckfoster/mfc-social-poster` (use `gh auth switch --user buckfoster`)
- Dockerfile build on Coolify, restarts pull latest from `main`
- Redeploy: `GET http://76.13.107.141:8000/api/v1/applications/n4gckw4gcg4ww8wgc4sskk8c/restart` with Coolify auth

## Key Fixes (Feb 2026)

- **Null caption handling:** caption defaults to empty string (was returning 400)
- **Bluesky video auth:** PDS DID now resolved correctly (was hardcoded to wrong service)
