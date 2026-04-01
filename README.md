# Brialert

Brialert is a terrorism monitoring web app built to be fast, blunt, and actually useful on a phone.

The idea is simple: too much of this stuff comes in as noise, half-signals, duplicated reporting, or articles that look urgent but are really just stale courtroom sludge wearing fresh timestamps. Brialert tries to cut through that. It pulls from trusted sources, weighs what matters, pushes likely live incidents to the top, and lets you turn that into a usable briefing block without having to fight the interface.

It is built first for iPhone Safari and home-screen use because that is where it needed to work, not because “mobile-first” sounds nice in a README.

## Live site

https://potemkin666.github.io/Brialert/

## What it does

Brialert monitors a broad UK and Europe-focused source set, with some wider international coverage where it is operationally relevant.

It sorts sources into rough roles:

- trigger
- corroboration
- context
- research

It also keeps explicit reliability profiles so everything is not treated as morally or operationally equivalent, which is a mistake people make constantly:

- official_ct
- official_general
- official_context
- major_media
- general_media
- tabloid
- specialist_research

The app is incident-first. That is the whole point.  
If something looks live, serious, or fast-moving, it should not have to compete visually with slower policy or prosecution-stage material.

There are also lane filters for:

- Incidents
- Sanctions
- Oversight
- Border
- Prevention

Other bits:

- interactive map with alert markers
- persistent local watchlist
- persistent analyst notes
- mobile-friendly PWA shell

## How it works

The flow is intentionally narrow:

1. pull source updates on a schedule
2. rank and filter for likely live incidents
3. open a dense incident summary
4. copy a briefing block for email, notes, or whatever else needs feeding

That is it.  
It is not trying to be a bloated intel platform. It is trying to be the bit you actually reach for.

## Project structure

```text
index.html
  app shell and modal layout

styles.css
  mobile-first styling and map presentation

app.js
  rendering, filtering, briefing generation, persistence

data/sources.json
  active source catalog

data/geo-lookup.json
  location term matching for map placement

scripts/build-live-feed.mjs
  feed build, extraction, ranking, dedupe, and normalisation

live-alerts.json
  generated alert payload consumed by the frontend

.github/workflows/update-live-feed.yml
  scheduled feed refresh workflow


Notes
This is a web app, not a native iOS app.
GitHub Actions refreshes live-alerts.json on a schedule and on relevant pushes.
data/sources.json is the source of truth for lane and source tier metadata.
Incident alerts are split into live vs case tracks so old prosecution-stage material stops clogging the live queue.
UK and Europe are weighted more heavily because that is the actual operational centre of gravity here.
Albert stays.
