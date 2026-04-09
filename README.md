# Brialert

[![Feed validation](https://github.com/potemkin666/Brialert/actions/workflows/ci-feed-validation.yml/badge.svg)](https://github.com/potemkin666/Brialert/actions/workflows/ci-feed-validation.yml)
[![Update live feeds](https://github.com/potemkin666/Brialert/actions/workflows/update-live-feed.yml/badge.svg)](https://github.com/potemkin666/Brialert/actions/workflows/update-live-feed.yml)

Brialert is a GitHub Pages web app for fast terrorism monitoring (UK/EU bias)

## Live site

[https://potemkin666.github.io/Brialert/](https://potemkin666.github.io/Brialert/)

## What it does

- pulls from a curated source catalog - all human reviewed 
- ranks likely live incidents above slower context and case-stage material
- keeps source-tier, reliability, incident-track, and queue-reason decisions upstream in the feed builder 
- provides a mobile-first live dashboard, map, watchlists, notes, and briefing modal
- refreshes the generated feed on an hourly GitHub Actions schedule

## Architecture

### Frontend

- `index.html`
  App shell and modal layout.
- `styles.css`
  Site styling, mobile layout, and map presentation.
- `app/`
  Frontend boot, state, render, and utility modules.
- `shared/`
  Shared view-model, taxonomy, fusion, and feed-derivation logic used by the browser.

### Feed pipeline

- `data/sources.json`
  Source catalog and source metadata.
- `data/geo-lookup.json`
  Location term lookup for map placement and geographic enrichment.
- `data/brialert.sqlite`
  SQLite persistence for source state, cooldown history, and alert churn written by the hourly builder.
- `scripts/build-live-feed/`
  Feed builder modules for config, IO, parsing, alert assembly, and health metadata.
- `scripts/build-live-feed.mjs`
  Feed build orchestration entrypoint.
- `live-alerts.json`
  Generated alert payload consumed by the frontend.

### Validation and automation

- `.github/workflows/ci-feed-validation.yml`
  CI validation for feed data, source health, tests, and builder smoke path.
- `.github/workflows/update-live-feed.yml`
  Scheduled feed refresh workflow that rebuilds and commits `live-alerts.json`.
- `tests/`
  Lightweight decision-logic and feed-health regression tests.

## Local development

Requires Node `20.18.1` or newer.

```bash
npm ci
npm run compile:sources
npm run check:sources:freshness
npm run validate:feed-data
npm run validate:source-health
npm test
npm run build:feeds
```

## Operational notes

- Quarantine admin access now uses GitHub OAuth plus an HttpOnly session cookie (no manual token entry in the quarantine UI).
- Backend env vars required for quarantine admin auth:
  - `BRIALERT_SESSION_SECRET` (strong random secret for signing session/state cookies)
  - optional: `BRIALERT_SESSION_TTL_SECONDS` (defaults to `28800`, i.e. 8h), `BRIALERT_OAUTH_STATE_TTL_SECONDS` (defaults to `600`, i.e. 10m)
  - `GITHUB_OAUTH_CLIENT_ID`
  - `GITHUB_OAUTH_CLIENT_SECRET`
  - at least one allowlist: `BRIALERT_ADMIN_ALLOWED_USERS` (comma-separated logins), `BRIALERT_ADMIN_ALLOWED_ORGS` (comma-separated orgs), or `BRIALERT_ADMIN_ALLOWED_TEAMS` (comma-separated `org/team-slug`)
  - optional: `BRIALERT_ALLOWED_ORIGINS` (comma-separated frontend origins), `BRIALERT_GITHUB_OAUTH_REDIRECT_URI`, `BRIALERT_AUTH_SUCCESS_REDIRECT`, `BRIALERT_AUTH_FAILURE_REDIRECT`
- The browser should trust upstream lane and queue decisions in the feed payload rather than re-inferring terrorism relevance, source reliability, or incident classification.
- The feed builder is designed to fail soft per source, skip duplicate source IDs at runtime with a warning, and preserve last-known-good output when possible.
- The feed builder now writes a SQLite sidecar for source reputation, cooldown memory, and alert churn history so source intelligence can persist across runs.
- London-focused HTML sources are validated in CI so dead or empty pages are easier to catch before they pollute the catalog.
- Feed validation CI runs source health in a critical-only scope (`BRIALERT_SOURCE_HEALTH_SCOPE=critical`) with a curated high-value London source list (`BRIALERT_SOURCE_HEALTH_CRITICAL_IDS`) and runs feed build in a bounded smoke configuration; scheduled hourly refresh keeps full-depth source checks.
- Both CI and the hourly workflow now run `validate:live-feed-output` after feed generation to fail fast on malformed publish output.
- CI now enforces source-catalog freshness (`npm run check:sources:freshness`) so shard edits must be compiled into `data/sources.json`.
- The hourly publish step retries once after rebasing `origin/main` if `git push` hits a non-fast-forward race.
- If a refresh preserves prior alerts and reports `sourceCount: 0`, the app now falls back to `health.lastSuccessfulSourceCount` so the hero source count does not stick at zero.
- Source catalog can be managed in sharded files under `data/sources/<region>/<lane>.json`; `npm run compile:sources` rebuilds `data/sources.json`.
- Build runs now emit `data/source-remediation-sweep.json` and `data/top-20-source-remediation.json` to prioritize dead/moved URLs and replacement actions.
- Build/runtime knobs (timeouts, retries, prefetch counts, html budget, guardrail fail behavior) are configurable through `BRIALERT_*` environment variables for CI fast-mode tuning.

## Source catalog contribution rules

- Every source entry must include: `id`, `provider`, `endpoint`, `kind`, `lane`, `region`, `isTrustedOfficial`, `requiresKeywordMatch`.
- Prefer canonical `https://` endpoints; `http://` is only allowed for explicit legacy feeds that have no stable HTTPS equivalent.
- Endpoints must be unique after normalization (scheme/host/path normalization and trailing slash handling).
- New source proposals should include freshness intent (e.g., lane/cadence relevance), reliability rationale (official vs non-official), and fallback strategy (machine-readable preferred; HTML requires selector/fallback plan).
- Avoid adding duplicate aliases for the same endpoint unless there is a documented and necessary functional distinction.

## Status

The repo currently deploys directly from `main` to GitHub Pages and refreshes feed data through GitHub Actions. If you are inspecting the live app and the data looks stale, check the latest `Update live feeds` workflow run first.
