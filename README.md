# ToolheadScanner

ToolheadScanner now has two runtime targets:

- Cloudflare Worker at the repository root for scheduled scans via Cloudflare cron triggers.
- Legacy Python app in `legacy_python/` for the original Tkinter UI and local SMTP workflow.

## What changed

The old design relied on:

- local files for hash state and extra GitHub locations
- a long-running Python loop or OS scheduler
- SMTP over Gmail for notifications

The Cloudflare version keeps the same scanning and parsing goals, but changes the runtime model so it works on the platform:

- Cloudflare cron triggers run the scan on a schedule
- KV stores README hashes, last-run state, and extra GitHub locations
- an HTTP endpoint allows manual runs and simple management operations
- email notifications use Resend's HTTP API instead of local SMTP

## Repository layout

- `src/`: Cloudflare Worker source
- `src/data/`: bundled fallback seed data for parsing and reference lists
- `legacy_python/`: original Python implementation moved into a subfolder

## Cloudflare Worker setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create KV namespaces

```bash
npx wrangler kv namespace create HASH_CACHE
npx wrangler kv namespace create SCANNER_STATE
npx wrangler kv namespace create HASH_CACHE --preview
npx wrangler kv namespace create SCANNER_STATE --preview
```

Copy the generated IDs into `wrangler.jsonc`.

### 3. Configure local development variables

Copy `.dev.vars.example` to `.dev.vars` and set values for:

- `MANUAL_RUN_TOKEN`: bearer token for manual API calls
- `RESEND_API_KEY`: API key used for notifications
- `NOTIFY_EMAIL_FROM`: sender address accepted by Resend
- `NOTIFY_EMAIL_TO`: one or more recipient addresses, comma-separated
- `GITHUB_TOKEN`: GitHub personal access token with `contents:write` and `pull_requests:write` scopes (optional, enables automatic PR creation)
- `GITHUB_PR_REPO`: target repository in `owner/repo` format (e.g. `SartorialGrunt0/ToolheadBuilder`)

### 4. Configure production secrets

```bash
npx wrangler secret put MANUAL_RUN_TOKEN
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put NOTIFY_EMAIL_FROM
npx wrangler secret put NOTIFY_EMAIL_TO
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put GITHUB_PR_REPO
```

`GITHUB_TOKEN` and `GITHUB_PR_REPO` are optional. When both are configured, the scanner will automatically open a pull request against the target repository with updated `toolheads.json` whenever new content is detected. If either is missing, PR creation is skipped silently.

If you want to change the upstream ToolheadBuilder data source, set `TOOLHEAD_DATA_SOURCE_BASE` in `wrangler.jsonc` or as an environment variable.

## Run locally

```bash
npm run dev
```

The Worker exposes:

- `GET /dashboard`: web dashboard for runs and location management
- `GET /health`: health response
- `POST /run?recheck=1`: trigger a manual scan
- `GET /last-run`: fetch the last saved scan report
- `GET /extra-locations`: list extra GitHub scan locations
- `POST /extra-locations`: add an extra location
- `DELETE /extra-locations`: remove an extra location
- `PUT /extra-locations`: replace the full extra-location list

All endpoints except `/` and `/health` require:

```http
Authorization: Bearer <MANUAL_RUN_TOKEN>
```

The dashboard calls those secured endpoints and will work once you enter your token in the dashboard page.

### Manual run example

```bash
curl -X POST "http://127.0.0.1:8787/run?recheck=1" \
   -H "Authorization: Bearer YOUR_TOKEN"
```

### Add extra GitHub location example

```bash
curl -X POST "http://127.0.0.1:8787/extra-locations" \
   -H "Authorization: Bearer YOUR_TOKEN" \
   -H "Content-Type: application/json" \
   -d '{"toolhead":"Hypernova","url":"https://github.com/owner/repo/blob/main/docs/readme.md"}'
```

## Deploy

```bash
npm run deploy
```

The default cron expression in `wrangler.jsonc` is:

```cron
0 8 * * *
```

Change it to whatever schedule you want Cloudflare to run.

## Worker behavior

Each scan run does the following:

1. Loads current reference data from the ToolheadBuilder upstream JSON files, with bundled seed data as fallback.
2. Loads extra GitHub locations from KV.
3. Downloads candidate README content for each toolhead and extra location.
4. Skips unchanged README content using SHA-256 hashes stored in KV.
5. Parses new extruders, hotends, probes, boards, fans, and filament cutter support.
6. Stores the last scan report in KV.
7. Sends a notification email when changes are found and notification settings are configured.
8. Opens a pull request with the updated `toolheads.json` on the target repository when changes are found and GitHub settings are configured.

## Legacy Python version

The original app is preserved in `legacy_python/`.

Examples from the repository root:

**Windows**
```bat
python legacy_python\scanner_ui.py
python legacy_python\automated_scanner.py --once
```

**Linux**
```bash
python3 legacy_python/scanner_ui.py
python3 legacy_python/automated_scanner.py --once
```

See `legacy_python/README.md` for the legacy usage notes.

For a dedicated step-by-step cron setup and operations guide, see `instructions.md`.

