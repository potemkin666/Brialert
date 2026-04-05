import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { XMLParser } from 'fast-xml-parser';
import { clean } from '../../shared/taxonomy.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = path.resolve(__dirname, '..', '..');
export const sourcePath = path.join(repoRoot, 'data', 'sources.json');
export const sourceRequestsPath = path.join(repoRoot, 'data', 'source-requests.json');
export const geoLookupPath = path.join(repoRoot, 'data', 'geo-lookup.json');
export const outputPath = path.join(repoRoot, 'live-alerts.json');
export const sqlitePath = path.join(repoRoot, 'data', 'brialert.sqlite');
export const quarantinedSourcesPath = path.join(repoRoot, 'data', 'quarantined-sources.json');
export const quarantinedSourcesReviewPath = path.join(repoRoot, 'source-quarantine.html');

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
export const MAX_HTML_SOURCES_PER_RUN = 24;
export const MAX_PLAYWRIGHT_SOURCES_PER_RUN = 5;
export const DEFAULT_PLAYWRIGHT_TIMEOUT_MS = 15000;
export const DEFAULT_PLAYWRIGHT_PAGE_SETTLE_MS = 1200;
export const MAX_PLAYWRIGHT_RAW_CANDIDATES = 60;
export const PLAYWRIGHT_SCRAPER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
export const MAX_PLAYWRIGHT_ITEM_SUMMARY_CHARS = 420;
export const PLAYWRIGHT_FEATURE_FLAG = 'BRIALERT_ENABLE_PLAYWRIGHT_FALLBACK';
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
export const DEFAULT_SOURCE_REFRESH_HOURS_BY_LANE = Object.freeze({
  incidents: 1,
  context: 2,
  sanctions: 3,
  oversight: 4,
  border: 2,
  prevention: 4,
  default: 3
});
export const SOURCE_FAILURE_COOLDOWN_HOURS = 24;
export const SOURCE_EMPTY_COOLDOWN_HOURS = 24;
export const AUTO_SKIP_FAILURE_THRESHOLD = 4;
export const AUTO_SKIP_EMPTY_THRESHOLD = 6;
export const AUTO_QUARANTINE_BLOCKED_HTML_THRESHOLD = 2;
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

function deterministicSourceHash(value) {
  return clean(value)
    .split('')
    .reduce((sum, char, index) => sum + (char.charCodeAt(0) * (index + 1)), 0);
}

export function sourceRefreshEveryHours(source) {
  const explicit = Math.floor(Number(source?.refreshEveryHours));
  if (Number.isFinite(explicit) && explicit >= 1) return explicit;

  const byLane = DEFAULT_SOURCE_REFRESH_HOURS_BY_LANE[source?.lane] || DEFAULT_SOURCE_REFRESH_HOURS_BY_LANE.default;
  if (source?.lane === 'incidents') return 1;
  if (source?.kind === 'html' || source?.kind === 'playwright_html') return Math.max(byLane, 3);
  return byLane;
}

export function isMachineReadableSourceKind(kind) {
  return kind === 'rss' || kind === 'atom' || kind === 'json';
}

export function sourceRefreshOffset(source) {
  const cadence = sourceRefreshEveryHours(source);
  const explicit = Math.floor(Number(source?.refreshOffset));
  if (Number.isFinite(explicit) && explicit >= 0) return explicit % cadence;
  return deterministicSourceHash(source?.id || source?.endpoint || source?.provider || '') % cadence;
}

export function shouldRefreshSourceThisRun(source, buildDate = new Date()) {
  const cadence = sourceRefreshEveryHours(source);
  if (cadence <= 1) return true;
  const hourSlot = Math.floor(buildDate.getTime() / 3600000);
  return hourSlot % cadence === sourceRefreshOffset(source);
}
