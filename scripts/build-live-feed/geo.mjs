import { clean } from '../../shared/taxonomy.mjs';
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

const geoTermRegexCache = new Map();

function geoTermRegex(term) {
  const normalised = normaliseGeoText(term);
  let cached = geoTermRegexCache.get(normalised);
  if (cached) return cached;
  const escaped = escapeRegex(normalised);
  cached = new RegExp(`(^|\\W)${escaped}(?=$|\\W)`, 'i');
  geoTermRegexCache.set(normalised, cached);
  return cached;
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
    else if ((entry.kind || '') === 'country') score += 3;
    else if ((entry.kind || '') === 'continent') score += 1;

    best = Math.max(best, score);
  }

  return best;
}

function fallbackGeoEntryFor(region) {
  return geoLookup.find((entry) =>
    region === 'uk'
      ? (entry.terms || []).includes('united kingdom')
      : (entry.terms || []).includes('europe')
  ) || null;
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

export function inferLocation(source, title, summary = '') {
  const text = `${title || ''} ${summary || ''}`;
  const match = bestGeoEntryFor(text, source.region);
  if (match?.label) return match.label;
  return source.region === 'uk' ? 'United Kingdom' : 'Europe';
}

export function geoFor(location, title, summary, region) {
  const text = `${location || ''} ${title || ''} ${summary || ''}`;
  const match = bestGeoEntryFor(text, region);
  if (match) return { lat: match.lat, lng: match.lng };
  return region === 'uk' ? { lat: 54.5, lng: -2.5 } : { lat: 54, lng: 15 };
}

export function geoLookupSnapshot() {
  return geoLookup;
}
