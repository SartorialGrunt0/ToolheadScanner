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
- `GITHUB_TOKEN` (optional): GitHub personal access token with `contents:write` and `pull_requests:write` scopes
- `GITHUB_PR_REPO` (optional): target repository for automatic PRs in `owner/repo` format (e.g. `SartorialGrunt0/ToolheadBuilder`)

Important: `.dev.vars` is only used by local development (`wrangler dev`). It is not used by the deployed Worker.

## 6. Configure production secrets

```bash
npx wrangler secret put MANUAL_RUN_TOKEN
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put NOTIFY_EMAIL_FROM
npx wrangler secret put NOTIFY_EMAIL_TO
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put GITHUB_PR_REPO
```

`GITHUB_TOKEN` and `GITHUB_PR_REPO` are optional. When both are set, the scanner will automatically open a pull request with updated `toolheads.json` on the target repository whenever new content is detected. The token needs `contents:write` and `pull_requests:write` scopes. If either variable is missing, PR creation is skipped and logged.

Set `NOTIFY_EMAIL_FROM` to a valid sender format, for example:

- `Toolhead Scanner <sender@yourdomain.com>`
- `sender@yourdomain.com`

Then verify secrets were saved in Cloudflare:

```bash
npx wrangler secret list
```

Expected result: at least `MANUAL_RUN_TOKEN`, `RESEND_API_KEY`, `NOTIFY_EMAIL_FROM`, and `NOTIFY_EMAIL_TO` are listed. `GITHUB_TOKEN` and `GITHUB_PR_REPO` will also appear if you configured automatic PR creation.

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
8. Opens a pull request with the updated `toolheads.json` on the target repository when changes are detected and `GITHUB_TOKEN`/`GITHUB_PR_REPO` are configured.

## 9. Manual operations

You can run the same flow manually through API or dashboard.

### Dashboard

- Open `/dashboard`
- Paste `MANUAL_RUN_TOKEN`
- Use:
  - Run Scan (normal hash-aware run)
  - Run Full Recheck (ignores hash cache)
  - Extra location add/delete controls

If buttons appear to do nothing, check:

- `npx wrangler secret list` is not empty
- The token pasted in the dashboard matches the deployed `MANUAL_RUN_TOKEN` secret
- You redeployed after updating config/secrets (`npm run deploy`)

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
- No pull request created:
  - Ensure both `GITHUB_TOKEN` and `GITHUB_PR_REPO` are set
  - `GITHUB_PR_REPO` must be in `owner/repo` format
  - The token needs `contents:write` and `pull_requests:write` scopes on the target repository
  - Check the `last-run` report logs for detailed PR creation status or error messages