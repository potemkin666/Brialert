import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { XMLParser } from 'fast-xml-parser';
import { clean } from '../../shared/taxonomy.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = path.resolve(__dirname, '..', '..');
export const sourcePath = path.join(repoRoot, 'data', 'sources.json');
export const geoLookupPath = path.join(repoRoot, 'data', 'geo-lookup.json');
export const outputPath = path.join(repoRoot, 'live-alerts.json');

export const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  processEntities: false,
  htmlEntities: false,
  trimValues: true
});

export const DEFAULT_TIMEOUT_MS = 12000;
export const DEFAULT_MAX_RETRIES = 3;
export const MAX_SOURCE_ERRORS_TO_REPORT = 25;
export const FEED_SOURCE_CONCURRENCY = 4;
export const HTML_HYDRATION_CONCURRENCY = 3;
export const MAX_HTML_CANDIDATES_PER_SOURCE = 18;
export const MAX_FEED_CANDIDATES_PER_SOURCE = 10;
export const MAX_HTML_PARSING_THRESHOLD = MAX_HTML_CANDIDATES_PER_SOURCE * 2;
export const MAX_HTML_PREFETCH_ITEMS = 12;
export const MAX_FEED_PREFETCH_ITEMS = 8;
export const SOURCE_ITEM_LIMITS = Object.freeze({
  tabloid: 1,
  incidents: 6,
  context: 4,
  sanctions: 4,
  oversight: 4,
  border: 4,
  prevention: 4,
  default: 3
});
export const MAX_STORED_ALERTS = 120;
export const MAX_FAILING_SOURCES_TO_LOG = 10;
export const EXPECTED_REFRESH_MINUTES = 60;
export const STALE_AFTER_MINUTES = 75;
export const SOURCE_TIMEZONE = 'Europe/London';
export const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
export const HARD_SKIP_SOURCE_IDS = new Set([
  'globalsecurity-terror-news',
  'un-ctitf-news',
  'statewatch-europol',
  'besa-terrorism',
  'icct-main',
  'jamestown-militant-leadership-monitor',
  'jamestown-terrorism-monitor',
  'washington-institute-countering-terrorism',
  'cps-terrorism-news',
  'cps-terrorism-search',
  'kallxo-english-home'
]);

export const severityRank = { critical: 4, high: 3, elevated: 2, moderate: 1 };

export function titleCase(value) {
  return clean(value).replace(/\b\w/g, (match) => match.toUpperCase());
}
