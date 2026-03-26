# ToolheadScanner Cloudflare Cron Instructions

This guide walks through deploying and operating ToolheadScanner as a Cloudflare Worker with cron triggers.

## 1. Prerequisites

- Cloudflare account with Workers enabled
- Node.js 20+
- npm

## 2. Install dependencies

```bash
npm install
```

## 3. Create KV namespaces

Create both production and preview namespaces.

```bash
npx wrangler kv namespace create HASH_CACHE
npx wrangler kv namespace create SCANNER_STATE
npx wrangler kv namespace create HASH_CACHE --preview
npx wrangler kv namespace create SCANNER_STATE --preview
```

Copy the returned IDs into `wrangler.jsonc`:

- `HASH_CACHE`: stores README SHA-256 hashes for unchanged-scan skipping
- `SCANNER_STATE`: stores last-run reports and extra GitHub locations

## 4. Configure schedule (cron trigger)

Edit `wrangler.jsonc` and set the desired cron expression under `triggers.crons`.

Example (daily at 08:00 UTC):

```json
"triggers": {
  "crons": ["0 8 * * *"]
}
```

## 5. Configure local dev variables

Copy `.dev.vars.example` to `.dev.vars` and set values:

- `MANUAL_RUN_TOKEN`: bearer token for API/dashboard operations
- `RESEND_API_KEY`: Resend API key
- `NOTIFY_EMAIL_FROM`: sender address/domain configured in Resend
- `NOTIFY_EMAIL_TO`: one or more recipient emails (comma-separated)
- `TOOLHEAD_DATA_SOURCE_BASE` (optional): alternate upstream JSON source
- `GITHUB_TOKEN` (optional for scanning, required for dashboard PR creation)

Important: `.dev.vars` is only used by local development (`wrangler dev`). It is not used by the deployed Worker.

## 6. Configure production secrets

```bash
npx wrangler secret put MANUAL_RUN_TOKEN
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put NOTIFY_EMAIL_FROM
npx wrangler secret put NOTIFY_EMAIL_TO
npx wrangler secret put GITHUB_TOKEN
```

Set `NOTIFY_EMAIL_FROM` to a valid sender format, for example:

- `Toolhead Scanner <sender@yourdomain.com>`
- `sender@yourdomain.com`

Then verify secrets were saved in Cloudflare:

```bash
npx wrangler secret list
```

Expected result: at least `MANUAL_RUN_TOKEN`, `RESEND_API_KEY`, `NOTIFY_EMAIL_FROM`, and `NOTIFY_EMAIL_TO` are listed.

If you want dashboard PR creation, `GITHUB_TOKEN` must also be listed.

If `wrangler secret list` returns `[]`, dashboard buttons and protected API calls will fail in production.

If needed, also set environment variables in Wrangler for non-secret values.

## 7. Validate and deploy

```bash
npm run check
npm run deploy
```

## 8. How cron execution works

On each cron run, the Worker:

1. Loads reference toolhead data from upstream JSON (or seed fallback).
2. Loads extra GitHub locations from KV.
3. Fetches README/content candidates from configured URLs.
4. Skips unchanged content using HASH_CACHE hashes.
5. Parses for new extruders, hotends, probes, boards, fan data, and filament cutter support.
6. Stores a full run report in SCANNER_STATE under `last-run`.
7. Sends notification email when changes are detected and email settings are configured.

## 9. Manual operations

You can run the same flow manually through API or dashboard.

### Dashboard

- Open `/dashboard`
- Paste `MANUAL_RUN_TOKEN`
- Use:
  - Run Scan (normal hash-aware run)
  - Run Full Recheck (ignores hash cache)
  - Extra location add/delete controls
  - Toolhead Editor tab to modify toolhead metadata and create PRs

If buttons appear to do nothing, check:

- `npx wrangler secret list` is not empty
- The token pasted in the dashboard matches the deployed `MANUAL_RUN_TOKEN` secret
- You redeployed after updating config/secrets (`npm run deploy`)
- For PR creation, verify `GITHUB_TOKEN` exists and has repo access to create forks/branches/PRs

### API

All protected endpoints require:

```http
Authorization: Bearer <MANUAL_RUN_TOKEN>
```

Trigger a manual recheck:

```bash
curl -X POST "https://YOUR_WORKER_DOMAIN/run?recheck=1" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Fetch last run:

```bash
curl -X GET "https://YOUR_WORKER_DOMAIN/last-run" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## 10. Endpoint reference

- `GET /health`: health check
- `GET /dashboard`: web UI for operational tasks
- `POST /run`: trigger scan
- `GET /last-run`: retrieve latest report
- `GET /extra-locations`: list extra locations
- `POST /extra-locations`: add one location
- `DELETE /extra-locations`: remove one location
- `PUT /extra-locations`: replace full location list
- `GET /api/reference-data`: get reference data used by dashboard editor
- `POST /api/create-pr`: create ToolheadBuilder PR from dashboard edits

## 11. Troubleshooting

- 401 Unauthorized:
  - Missing or wrong `MANUAL_RUN_TOKEN`
- 503 MANUAL_RUN_TOKEN is not configured:
  - Secret not set in deployed environment
- Dashboard buttons not working in production:
  - Run `npx wrangler secret list`; if it returns `[]`, set required secrets and redeploy
  - Ensure the dashboard token matches deployed `MANUAL_RUN_TOKEN`
- No email notifications:
  - Ensure `RESEND_API_KEY`, `NOTIFY_EMAIL_FROM`, and `NOTIFY_EMAIL_TO` are configured
- No changes detected unexpectedly:
  - Run `/run?recheck=1` to bypass hash skipping
- PR creation returns `GITHUB_TOKEN is not configured`:
  - Set `GITHUB_TOKEN` as a Worker secret and redeploy
- PR creation fails with GitHub API errors:
  - Ensure token has sufficient permissions for fork, branch, commit, and pull request operations