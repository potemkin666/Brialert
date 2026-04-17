import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const VALID_KINDS = new Set(['rss', 'atom', 'json', 'html', 'playwright_html']);
const VALID_LANES = new Set(['incidents', 'context', 'sanctions', 'oversight', 'border', 'prevention']);
const VALID_REGIONS = new Set(['uk', 'europe', 'london', 'eu', 'international', 'us']);
const LEGACY_HTTP_ALLOWLIST = new Set([
  'http://newsrss.bbc.co.uk/rss/newsonline_uk_edition/front_page/rss.xml',
  'http://newsrss.bbc.co.uk/rss/newsonline_uk_edition/uk_politics/rss.xml',
  'http://newsrss.bbc.co.uk/rss/newsonline_uk_edition/england/rss.xml',
  'http://newsrss.bbc.co.uk/rss/newsonline_uk_edition/world/rss.xml',
  'http://curia.europa.eu/site/rss.jsp?lang=en&secondLang=fr'
]);

function normaliseEndpoint(endpoint) {
  const raw = String(endpoint || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '').toLowerCase();
  } catch {
    return raw.replace(/\/$/, '').toLowerCase();
  }
}

function canonicalHttpsCandidate(endpoint) {
  const raw = String(endpoint || '').trim();
  if (!raw.startsWith('http://')) return '';
  return `https://${raw.slice('http://'.length)}`;
}

function validateSource(source, index) {
  const prefix = `source[${index}] (id=${JSON.stringify(source?.id)})`;
  if (!source || typeof source !== 'object') throw new Error(`${prefix}: not an object`);
  if (typeof source.id !== 'string' || !source.id.trim()) throw new Error(`${prefix}: missing or empty "id"`);
  if (typeof source.provider !== 'string' || !source.provider.trim()) throw new Error(`${prefix}: missing or empty "provider"`);
  if (typeof source.endpoint !== 'string' || !source.endpoint.trim()) throw new Error(`${prefix}: missing or empty "endpoint"`);
  if (!source.endpoint.startsWith('https://') && !source.endpoint.startsWith('http://')) {
    throw new Error(`${prefix}: "endpoint" must be an http/https URL, got ${JSON.stringify(source.endpoint)}`);
  }
  if (source.endpoint.startsWith('http://') && !LEGACY_HTTP_ALLOWLIST.has(source.endpoint)) {
    throw new Error(`${prefix}: "endpoint" must use https:// when available; got ${JSON.stringify(source.endpoint)}`);
  }
  if (!VALID_KINDS.has(source.kind)) {
    throw new Error(`${prefix}: "kind" must be one of [${[...VALID_KINDS].join(', ')}], got ${JSON.stringify(source.kind)}`);
  }
  if (!VALID_LANES.has(source.lane)) {
    throw new Error(`${prefix}: "lane" must be one of [${[...VALID_LANES].join(', ')}], got ${JSON.stringify(source.lane)}`);
  }
  if (!VALID_REGIONS.has(source.region)) {
    throw new Error(`${prefix}: "region" must be one of [${[...VALID_REGIONS].join(', ')}], got ${JSON.stringify(source.region)}`);
  }
  if (typeof source.isTrustedOfficial !== 'boolean') {
    throw new Error(`${prefix}: "isTrustedOfficial" must be a boolean`);
  }
  if (typeof source.requiresKeywordMatch !== 'boolean') {
    throw new Error(`${prefix}: "requiresKeywordMatch" must be a boolean`);
  }
  if (source.quarantined != null && typeof source.quarantined !== 'boolean') {
    throw new Error(`${prefix}: "quarantined" must be a boolean when present`);
  }
  if (source.refreshEveryHours != null) {
    const cadence = Number(source.refreshEveryHours);
    if (!Number.isInteger(cadence) || cadence < 1) {
      throw new Error(`${prefix}: "refreshEveryHours" must be a positive integer when present`);
    }
  }
  if (source.refreshOffset != null) {
    const offset = Number(source.refreshOffset);
    if (!Number.isInteger(offset) || offset < 0) {
      throw new Error(`${prefix}: "refreshOffset" must be a non-negative integer when present`);
    }
  }
}

const targets = [
  {
    label: 'sources catalog',
    relativePath: 'data/sources.json',
    validate(parsed) {
      const sources = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.sources) ? parsed.sources : null;
      if (!sources) throw new Error('expected a top-level array or an object with a sources array');
      const ids = new Set();
      const endpoints = new Map();
      const fieldErrors = [];
      for (let i = 0; i < sources.length; i++) {
        try {
          validateSource(sources[i], i);
        } catch (error) {
          fieldErrors.push(error instanceof Error ? error.message : String(error));
        }
        if (sources[i]?.id) {
          if (ids.has(sources[i].id)) fieldErrors.push(`duplicate source id: ${JSON.stringify(sources[i].id)}`);
          ids.add(sources[i].id);
        }
        if (sources[i]?.endpoint) {
          const key = normaliseEndpoint(sources[i].endpoint);
          if (key) {
            if (!endpoints.has(key)) endpoints.set(key, []);
            endpoints.get(key).push(sources[i].id || `index-${i}`);
            if (sources[i].endpoint.startsWith('http://')) {
              const canonicalCandidate = canonicalHttpsCandidate(sources[i].endpoint);
              if (canonicalCandidate) {
                const canonicalKey = normaliseEndpoint(canonicalCandidate);
                if (endpoints.has(canonicalKey)) {
                  fieldErrors.push(`legacy http endpoint duplicates canonical https endpoint: ${JSON.stringify(sources[i].endpoint)} (ids=${endpoints.get(canonicalKey).join(',')})`);
                }
              }
            }
          }
        }
      }
      for (const [endpoint, endpointIds] of endpoints.entries()) {
        if (endpointIds.length > 1) {
          fieldErrors.push(`duplicate source endpoint: ${JSON.stringify(endpoint)} (ids=${endpointIds.join(', ')})`);
        }
      }
      if (fieldErrors.length) {
        throw new Error(`${fieldErrors.length} source(s) failed validation:\n  ${fieldErrors.join('\n  ')}`);
      }
    }
  },
  {
    label: 'source requests',
    relativePath: 'data/source-requests.json',
    validate(parsed) {
      const requests = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.requests) ? parsed.requests : null;
      if (!requests) {
        throw new Error('expected a top-level array or an object with a requests array');
      }
      const ids = new Set();
      const endpoints = new Map();
      const fieldErrors = [];
      for (let i = 0; i < requests.length; i++) {
        try {
          validateSource(requests[i], i);
        } catch (error) {
          fieldErrors.push(error instanceof Error ? error.message : String(error));
        }
        if (requests[i]?.id) {
          if (ids.has(requests[i].id)) fieldErrors.push(`duplicate requested source id: ${JSON.stringify(requests[i].id)}`);
          ids.add(requests[i].id);
        }
        if (requests[i]?.endpoint) {
          const key = normaliseEndpoint(requests[i].endpoint);
          if (!key) continue;
          if (!endpoints.has(key)) endpoints.set(key, []);
          endpoints.get(key).push(requests[i].id || `index-${i}`);
        }
      }
      for (const [endpoint, endpointIds] of endpoints.entries()) {
        if (endpointIds.length > 1) {
          fieldErrors.push(`duplicate requested source endpoint: ${JSON.stringify(endpoint)} (ids=${endpointIds.join(', ')})`);
        }
      }
      if (fieldErrors.length) {
        throw new Error(`${fieldErrors.length} requested source(s) failed validation:\n  ${fieldErrors.join('\n  ')}`);
      }
    }
  },
  {
    label: 'geo lookup',
    relativePath: 'data/geo-lookup.json',
    validate(parsed) {
      if (!Array.isArray(parsed)) {
        throw new Error('expected a top-level array');
      }

      // Bounding boxes for major ocean areas. Any (lat, lng) falling entirely
      // inside one of these rectangles is almost certainly a data error — all
      // geo-lookup entries should resolve to land coordinates.
      const OCEAN_BOXES = [
        // Mid-Atlantic (between Europe/Africa and Americas)
        { name: 'Mid-Atlantic Ocean', latMin: -50, latMax: 60, lngMin: -60, lngMax: -10 },
        // Central Pacific
        { name: 'Central Pacific Ocean', latMin: -50, latMax: 50, lngMin: -180, lngMax: -120 },
        // South Pacific
        { name: 'South Pacific Ocean', latMin: -60, latMax: -10, lngMin: 150, lngMax: 180 },
        // Indian Ocean core
        { name: 'Indian Ocean', latMin: -50, latMax: 0, lngMin: 50, lngMax: 100 },
        // Southern Ocean
        { name: 'Southern Ocean', latMin: -90, latMax: -60, lngMin: -180, lngMax: 180 }
      ];

      // Punched-out land exclusion zones inside the ocean boxes above.
      // If a coordinate falls inside any of these it is NOT flagged, even
      // when it also falls inside an ocean box.
      const LAND_EXCLUSIONS = [
        // UK & Ireland (sits inside the Mid-Atlantic box)
        { latMin: 49.5, latMax: 61, lngMin: -11, lngMax: 2 },
        // Iceland
        { latMin: 63, latMax: 67, lngMin: -25, lngMax: -13 },
        // Portugal & western Spain
        { latMin: 36, latMax: 44, lngMin: -10, lngMax: -6 },
        // West Africa coast that overlaps Mid-Atlantic box
        { latMin: -35, latMax: 15, lngMin: -18, lngMax: -10 },
        // Eastern Canada / US east coast overlap with Mid-Atlantic box
        { latMin: 25, latMax: 60, lngMin: -60, lngMax: -50 },
        // New Zealand (overlaps South Pacific box)
        { latMin: -48, latMax: -34, lngMin: 165, lngMax: 179 },
        // Eastern Australia (overlaps South Pacific box)
        { latMin: -45, latMax: -10, lngMin: 150, lngMax: 155 }
      ];

      function insideBox(lat, lng, box) {
        return lat >= box.latMin && lat <= box.latMax && lng >= box.lngMin && lng <= box.lngMax;
      }

      function isLikelyOcean(lat, lng) {
        for (const ocean of OCEAN_BOXES) {
          if (!insideBox(lat, lng, ocean)) continue;
          // Check if excluded by a known land zone
          const onLand = LAND_EXCLUSIONS.some((ex) => insideBox(lat, lng, ex));
          if (!onLand) return ocean.name;
        }
        return null;
      }

      const fieldErrors = [];
      const seenTerms = new Map();

      for (let i = 0; i < parsed.length; i++) {
        const entry = parsed[i];
        const prefix = `geo[${i}]`;

        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          fieldErrors.push(`${prefix}: not a plain object`);
          continue;
        }

        // Required fields
        if (!Number.isFinite(entry.lat)) {
          fieldErrors.push(`${prefix}: "lat" must be a finite number, got ${JSON.stringify(entry.lat)}`);
        }
        if (!Number.isFinite(entry.lng)) {
          fieldErrors.push(`${prefix}: "lng" must be a finite number, got ${JSON.stringify(entry.lng)}`);
        }
        if (!Array.isArray(entry.terms) || entry.terms.length === 0) {
          fieldErrors.push(`${prefix}: "terms" must be a non-empty array`);
        } else {
          for (let t = 0; t < entry.terms.length; t++) {
            if (typeof entry.terms[t] !== 'string' || !entry.terms[t].trim()) {
              fieldErrors.push(`${prefix}: terms[${t}] must be a non-empty string`);
            }
          }
          // Duplicate term check
          for (const term of entry.terms) {
            const key = (term || '').trim().toLowerCase();
            if (!key) continue;
            if (seenTerms.has(key)) {
              fieldErrors.push(`${prefix}: duplicate term ${JSON.stringify(term)} (first seen at geo[${seenTerms.get(key)}])`);
            } else {
              seenTerms.set(key, i);
            }
          }
        }
        if (typeof entry.label !== 'string' || !entry.label.trim()) {
          fieldErrors.push(`${prefix}: "label" must be a non-empty string`);
        }

        // kind / precision enum checks
        const VALID_GEO_KINDS = new Set([
          'neighbourhood', 'borough', 'city', 'town', 'airport_area',
          'county', 'region', 'state', 'country', 'country_part', 'continent'
        ]);
        const VALID_GEO_PRECISIONS = new Set(['high', 'medium', 'low']);

        if (entry.kind != null && !VALID_GEO_KINDS.has(entry.kind)) {
          fieldErrors.push(`${prefix}: "kind" must be one of [${[...VALID_GEO_KINDS].join(', ')}], got ${JSON.stringify(entry.kind)}`);
        }
        if (entry.precision != null && !VALID_GEO_PRECISIONS.has(entry.precision)) {
          fieldErrors.push(`${prefix}: "precision" must be one of [${[...VALID_GEO_PRECISIONS].join(', ')}], got ${JSON.stringify(entry.precision)}`);
        }

        // Coordinate range sanity
        if (Number.isFinite(entry.lat) && (entry.lat < -90 || entry.lat > 90)) {
          fieldErrors.push(`${prefix}: "lat" out of range [-90, 90], got ${entry.lat}`);
        }
        if (Number.isFinite(entry.lng) && (entry.lng < -180 || entry.lng > 180)) {
          fieldErrors.push(`${prefix}: "lng" out of range [-180, 180], got ${entry.lng}`);
        }

        // Ocean check
        if (Number.isFinite(entry.lat) && Number.isFinite(entry.lng)) {
          const ocean = isLikelyOcean(entry.lat, entry.lng);
          if (ocean) {
            fieldErrors.push(
              `${prefix}: (${entry.lat}, ${entry.lng}) appears to be in the ${ocean} — expected land coordinates`
            );
          }
        }
      }

      if (fieldErrors.length) {
        throw new Error(`${fieldErrors.length} geo entry/entries failed validation:\n  ${fieldErrors.join('\n  ')}`);
      }
    }
  }
];

function stripBom(text) {
  return typeof text === 'string' ? text.replace(/^\uFEFF/, '') : text;
}

async function validateTarget(target) {
  const filePath = path.join(repoRoot, target.relativePath);
  const raw = stripBom(await fs.readFile(filePath, 'utf8'));

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${target.relativePath}: invalid JSON (${message})`);
  }

  try {
    target.validate(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${target.relativePath}: invalid structure (${message})`);
  }

  return `${target.label} OK`;
}

async function main() {
  for (const target of targets) {
    const result = await validateTarget(target);
    console.log(result);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
