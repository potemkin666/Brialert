import { clean } from '../../shared/taxonomy.mjs';
import { fallbackCoordsForRegion, fallbackLocationLabelForRegion } from '../../shared/geo-fallback-coords.mjs';
import { geoLookupPath } from './config.mjs';
import { readJsonFile } from './io.mjs';

let geoLookup = [];

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normaliseGeoText(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[â€™']/g, "'")
    .replace(/[_/]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s'-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function geoTermRegex(term) {
  const escaped = escapeRegex(normaliseGeoText(term));
  return new RegExp(`(^|\\W)${escaped}(?=$|\\W)`, 'i');
}

function scoreGeoEntryMatch(entry, haystack) {
  let best = 0;

  for (const rawTerm of entry.terms || []) {
    const term = normaliseGeoText(rawTerm);
    if (!term) continue;
    const regex = geoTermRegex(term);
    if (!regex.test(haystack)) continue;

    let score = term.length;
    if ((entry.precision || '') === 'high') score += 40;
    else if ((entry.precision || '') === 'medium') score += 20;
    else if ((entry.precision || '') === 'low') score += 5;

    if ((entry.kind || '') === 'neighbourhood') score += 18;
    else if ((entry.kind || '') === 'borough') score += 16;
    else if ((entry.kind || '') === 'city') score += 14;
    else if ((entry.kind || '') === 'town') score += 12;
    else if ((entry.kind || '') === 'airport_area') score += 11;
    else if ((entry.kind || '') === 'county' || (entry.kind || '') === 'region' || (entry.kind || '') === 'state') score += 8;
    else if ((entry.kind || '') === 'country' || (entry.kind || '') === 'country_part') score += 3;
    else if ((entry.kind || '') === 'continent') score += 1;

    best = Math.max(best, score);
  }

  return best;
}

function fallbackTermForRegion(region) {
  if (region === 'uk') return 'united kingdom';
  if (region === 'london') return 'london';
  if (region === 'us') return 'united states';
  return 'europe';
}

function fallbackGeoEntryFor(region) {
  const term = fallbackTermForRegion(region);
  return geoLookup.find((entry) => (entry.terms || []).includes(term)) || null;
}

function bestGeoEntryFor(text, region) {
  const haystack = normaliseGeoText(text);
  if (!haystack) return fallbackGeoEntryFor(region);

  const scored = geoLookup
    .map((entry) => ({ entry, score: scoreGeoEntryMatch(entry, haystack) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length) return scored[0].entry;
  return fallbackGeoEntryFor(region);
}

export async function safeLoadGeoLookup(existing) {
  try {
    geoLookup = await readJsonFile(geoLookupPath);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Geo lookup load failed: ${message}`);
    if (Array.isArray(existing?.geoLookupSnapshot) && existing.geoLookupSnapshot.length) {
      geoLookup = existing.geoLookupSnapshot;
      console.warn('Falling back to geo lookup snapshot from previous output.');
      return `Geo lookup load failed; reused previous snapshot. ${message}`;
    }
    geoLookup = [];
    return `Geo lookup load failed with no prior snapshot available. ${message}`;
  }
}

const REGION_LOCATION_LABELS = {
  uk: 'United Kingdom',
  london: 'London, UK',
  us: 'United States'
};

export function inferLocation(source, title, summary = '') {
  const text = `${title || ''} ${summary || ''}`;
  const match = bestGeoEntryFor(text, source.region);
  if (match?.label) return match.label;
  return REGION_LOCATION_LABELS[source.region] || 'Europe';
}

const HARD_FALLBACK_COORDS = {
  uk: { lat: 54.5, lng: -2.5 },
  london: { lat: 51.5074, lng: -0.1278 },
  us: { lat: 39.8283, lng: -98.5795 }
};
const DEFAULT_FALLBACK_COORDS = { lat: 50, lng: 10 };

export function geoFor(location, title, summary, region) {
  const text = `${location || ''} ${title || ''} ${summary || ''}`;
  const match = bestGeoEntryFor(text, region);
  if (match) return { lat: match.lat, lng: match.lng };
  const fallback = HARD_FALLBACK_COORDS[region] || DEFAULT_FALLBACK_COORDS;
  return { lat: fallback.lat, lng: fallback.lng };
}

export function geoLookupSnapshot() {
  return geoLookup;
}
