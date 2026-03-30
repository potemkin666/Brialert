# Brialert

Brialert is a responder-first terrorism monitoring web app built for fast mobile use on iPhone Safari and home-screen install.

The app is designed around a simple operational flow:

- pull trusted source updates on a schedule
- rank and filter likely live incidents
- open a dense incident summary
- copy a briefing block for email or note use

## Live site

- Project Pages URL: `https://potemkin666.github.io/Brialert/`

## Core features

- broad UK + Europe source catalog
- explicit source tiers:
  - `trigger`
  - `corroboration`
  - `context`
  - `research`
- explicit reliability profiles:
  - `official_ct`
  - `official_general`
  - `official_context`
  - `major_media`
  - `general_media`
  - `tabloid`
  - `specialist_research`
- incident-first prioritisation
- lane filtering:
  - `Incidents`
  - `Sanctions`
  - `Oversight`
  - `Border`
  - `Prevention`
- interactive world map with alert markers
- local watchlist and analyst notes persistence
- mobile-friendly PWA shell for iPhone use

## Project structure

- `index.html`
  - app shell and modal layout
- `styles.css`
  - mobile-first styling and map presentation
- `app.js`
  - rendering, filtering, briefing generation, persistence
- `data/sources.json`
  - active source catalog
- `scripts/build-live-feed.mjs`
  - feed build, extraction, ranking, dedupe, and normalization
- `live-alerts.json`
  - generated alert payload consumed by the frontend
- `.github/workflows/update-live-feed.yml`
  - scheduled feed refresh workflow

## Local development

The frontend is static. The feed builder requires Node.js 20+.

Install dependencies:

```bash
npm ci
```

Build the live alert feed:

```bash
npm run build:feeds
```

## Notes

- This repo is web-first, not native iOS.
- GitHub Actions refreshes `live-alerts.json` on a schedule and on relevant pushes.
- `data/sources.json` is the source of truth for lane and `sourceTier` metadata.
- incident alerts are split into `live` vs `case` tracks so prosecution-stage items stop crowding the live queue.
- Albert stays.
