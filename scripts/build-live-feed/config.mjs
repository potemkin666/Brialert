import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { XMLParser } from 'fast-xml-parser';
import { clean } from '../../shared/taxonomy.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = path.resolve(__dirname, '..', '..');
export const geoLookupPath = path.join(repoRoot, 'data', 'geo-lookup.json');
export const outputPath = path.join(repoRoot, 'live-alerts.json');
export const sqlitePath = path.join(repoRoot, 'data', 'brialert.sqlite');
export const quarantinedSourcesPath = path.join(repoRoot, 'data', 'quarantined-sources.json');
export const quarantinedSourcesReviewPath = path.join(repoRoot, 'source-quarantine.html');
export const topSourceRemediationPath = path.join(repoRoot, 'data', 'top-20-source-remediation.json');
export const sourceRemediationSweepPath = path.join(repoRoot, 'data', 'source-remediation-sweep.json');

export const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  processEntities: false,
  htmlEntities: false,
  trimValues: true
});

function envInt(name, fallback, minimum = 0) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === '') return fallback;
  const parsed = Math.floor(Number(raw));
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

function envPath(name, fallbackPath) {
  const raw = clean(process.env[name]);
  if (!raw) return fallbackPath;
  return path.isAbsolute(raw) ? raw : path.join(repoRoot, raw);
}

export const sourcePath = envPath('BRIALERT_SOURCE_PATH', path.join(repoRoot, 'data', 'sources.json'));
export const sourceRequestsPath = envPath('BRIALERT_SOURCE_REQUESTS_PATH', path.join(repoRoot, 'data', 'source-requests.json'));

export const DEFAULT_TIMEOUT_MS = envInt('BRIALERT_FETCH_TIMEOUT_MS', 12000, 1000);
export const DEFAULT_MAX_RETRIES = envInt('BRIALERT_FETCH_MAX_RETRIES', 3, 1);
export const DEFAULT_FETCH_STAGGER_MS = envInt('BRIALERT_FETCH_STAGGER_MS', 60, 0);
export const MAX_FETCH_STAGGER_JITTER_MS = envInt('BRIALERT_FETCH_STAGGER_JITTER_MS', 90, 0);
export const BACKOFF_CAP_MS = envInt('BRIALERT_FETCH_BACKOFF_CAP_MS', 16000, 1000);
export const MAX_SOURCE_ERRORS_TO_REPORT = 25;
export const FEED_SOURCE_CONCURRENCY = envInt('BRIALERT_FEED_SOURCE_CONCURRENCY', 4, 1);
export const HTML_HYDRATION_CONCURRENCY = 3;
export const MAX_HTML_CANDIDATES_PER_SOURCE = 18;
export const MAX_FEED_CANDIDATES_PER_SOURCE = 10;
export const MAX_HTML_PARSING_THRESHOLD = MAX_HTML_CANDIDATES_PER_SOURCE * 2;
export const MAX_HTML_PREFETCH_ITEMS = envInt('BRIALERT_MAX_HTML_PREFETCH_ITEMS', 12, 1);
export const MAX_FEED_PREFETCH_ITEMS = envInt('BRIALERT_MAX_FEED_PREFETCH_ITEMS', 8, 1);
export const MAX_HTML_SOURCES_PER_RUN = envInt('BRIALERT_MAX_HTML_SOURCES_PER_RUN', 32, 1);
export const CONTROL_MAX_HTML_SOURCES_PER_RUN = envInt('BRIALERT_CONTROL_MAX_HTML_SOURCES_PER_RUN', 24, 1);
export const HTML_DOMAIN_CAP_PER_RUN = 3;
export const SCHEDULER_MODE = clean(process.env.BRIALERT_SCHEDULER_AB_MODE || 'candidate').toLowerCase() === 'control'
  ? 'control'
  : 'candidate';
export const PLAYWRIGHT_FALLBACK_ALLOWLIST_SOURCE_IDS = new Set([
  'met-police-news',
  'ct-policing-london',
  ...clean(process.env.BRIALERT_PLAYWRIGHT_ALLOWLIST || '')
    .split(',')
    .map((value) => clean(value))
    .filter(Boolean)
]);
export const PLAYWRIGHT_FALLBACK_MAX_ATTEMPTS_PER_RUN = Math.max(
  0,
  Number.isFinite(Number(process.env.BRIALERT_PLAYWRIGHT_MAX_ATTEMPTS_PER_RUN))
    ? Math.floor(Number(process.env.BRIALERT_PLAYWRIGHT_MAX_ATTEMPTS_PER_RUN))
    : 2
);
export const PLAYWRIGHT_FALLBACK_AGGRESSIVE = clean(process.env.BRIALERT_PLAYWRIGHT_AGGRESSIVE).toLowerCase() === 'true';
export const PLAYWRIGHT_FALLBACK_TIMEOUT_MS = Math.max(
  5000,
  Number.isFinite(Number(process.env.BRIALERT_PLAYWRIGHT_TIMEOUT_MS))
    ? Math.floor(Number(process.env.BRIALERT_PLAYWRIGHT_TIMEOUT_MS))
    : 12000
);
export const GUARDRAIL_MAX_RUNTIME_MS = Math.max(
  60_000,
  Number.isFinite(Number(process.env.BRIALERT_GUARDRAIL_MAX_RUNTIME_MS))
    ? Math.floor(Number(process.env.BRIALERT_GUARDRAIL_MAX_RUNTIME_MS))
    : 12 * 60_000
);
export const GUARDRAIL_MAX_FAILED_SOURCE_RATE = Math.max(
  0,
  Math.min(
    1,
    Number.isFinite(Number(process.env.BRIALERT_GUARDRAIL_MAX_FAILED_SOURCE_RATE))
      ? Number(process.env.BRIALERT_GUARDRAIL_MAX_FAILED_SOURCE_RATE)
      : 0.65
  )
);
export const GUARDRAIL_MIN_SUCCESSFUL_SOURCES = Math.max(
  1,
  Number.isFinite(Number(process.env.BRIALERT_GUARDRAIL_MIN_SUCCESSFUL_SOURCES))
    ? Math.floor(Number(process.env.BRIALERT_GUARDRAIL_MIN_SUCCESSFUL_SOURCES))
    : 8
);
export const TARGET_SUCCESSFUL_SOURCES_PER_RUN = Math.max(
  1,
  Number.isFinite(Number(process.env.BRIALERT_TARGET_SUCCESSFUL_SOURCES_PER_RUN))
    ? Math.floor(Number(process.env.BRIALERT_TARGET_SUCCESSFUL_SOURCES_PER_RUN))
    : 30
);
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
export const EXPECTED_REFRESH_MINUTES = 15;
export const STALE_AFTER_MINUTES = 25;
export const SOURCE_TIMEZONE = 'Europe/London';
export const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
export const FEED_BOT_USER_AGENT = 'Mozilla/5.0 (compatible; BrialertFeedBot/1.0; +https://potemkin666.github.io/Brialert/)';
export const FEED_BOT_USER_AGENTS = Object.freeze([
  FEED_BOT_USER_AGENT,
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36'
]);
export const DEFAULT_SOURCE_REFRESH_HOURS_BY_LANE = Object.freeze({
  incidents: 0.25,
  context: 0.5,
  sanctions: 1,
  oversight: 1,
  border: 0.5,
  prevention: 1,
  default: 1
});
export const SOURCE_FAILURE_COOLDOWN_HOURS = 24;
export const SOURCE_EMPTY_COOLDOWN_HOURS = 24;
export const SOURCE_PROTECTED_FAILURE_COOLDOWN_HOURS = 6;
export const SOURCE_BLOCKED_FAILURE_COOLDOWN_HOURS = 12;
export const AUTO_QUARANTINE_RECHECK_HOURS = 7 * 24;
export const AUTO_SKIP_FAILURE_THRESHOLD = 4;
export const AUTO_SKIP_EMPTY_THRESHOLD = 6;
export const AUTO_QUARANTINE_BLOCKED_HTML_THRESHOLD = envInt('BRIALERT_AUTO_QUARANTINE_BLOCKED_HTML_THRESHOLD', 4, 1);
export const AUTO_QUARANTINE_DEAD_URL_THRESHOLD = envInt('BRIALERT_AUTO_QUARANTINE_DEAD_URL_THRESHOLD', 2, 1);
export const FAIL_ON_GUARDRAIL_VIOLATION = clean(process.env.BRIALERT_FAIL_ON_GUARDRAIL_VIOLATION).toLowerCase() === 'true';
export const OFFLINE_FIXTURE_MODE = clean(process.env.BRIALERT_OFFLINE_FIXTURE_MODE).toLowerCase() === 'true';
export const offlineFixturesPath = envPath(
  'BRIALERT_OFFLINE_FIXTURES_PATH',
  path.join(repoRoot, 'tests', 'fixtures', 'offline-build', 'fixtures.json')
);
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

export function sourceDeterministicHash(value) {
  return deterministicSourceHash(value);
}

export function sourceUserAgent(source) {
  const explicit = clean(source?.headers?.['user-agent']);
  if (explicit) return explicit;
  const sourceKey = clean(source?.id || source?.endpoint || source?.provider);
  const index = sourceKey ? sourceDeterministicHash(sourceKey) % FEED_BOT_USER_AGENTS.length : 0;
  return FEED_BOT_USER_AGENTS[index] || FEED_BOT_USER_AGENT;
}

export function sourceRefreshEveryHours(source) {
  const explicit = Number(source?.refreshEveryHours);
  if (Number.isFinite(explicit) && explicit >= 0.25) return explicit;

  const byLane = DEFAULT_SOURCE_REFRESH_HOURS_BY_LANE[source?.lane] || DEFAULT_SOURCE_REFRESH_HOURS_BY_LANE.default;
  if (source?.lane === 'incidents') return 0.25;
  if (source?.kind === 'html') return Math.max(byLane, 1);
  return byLane;
}

export function isMachineReadableSourceKind(kind) {
  return kind === 'rss' || kind === 'atom' || kind === 'json';
}

export function sourceRefreshOffset(source) {
  const cadence = sourceRefreshEveryHours(source);
  const explicit = Number(source?.refreshOffset);
  if (Number.isFinite(explicit) && explicit >= 0) return explicit % cadence;

  // Compute a deterministic offset based on source identifier
  const sourceKey = source?.id || source?.endpoint || source?.provider || '';
  const hashValue = deterministicSourceHash(sourceKey);
  const hashRange = Math.max(1, Math.floor(cadence));
  const baseOffset = hashValue % hashRange;

  // Scale offset for sub-hour cadences to distribute sources across time slots
  const scalingFactor = cadence < 1 ? cadence : 1;
  return baseOffset * scalingFactor;
}

export function shouldRefreshSourceThisRun(source, buildDate = new Date()) {
  const cadence = sourceRefreshEveryHours(source);
  const offset = sourceRefreshOffset(source);

  // Sub-hour cadences: refresh every run (workflow runs every 15 minutes)
  if (cadence <= 0.25) return true;

  // For cadences up to 1 hour, use 15-minute slots
  if (cadence <= 1) {
    const slotMinutes = 15;
    const currentSlot = Math.floor(buildDate.getTime() / (slotMinutes * 60_000));
    const slotsPerCadence = Math.ceil(cadence * 60 / slotMinutes);
    const offsetSlot = Math.floor(offset * 60 / slotMinutes) % slotsPerCadence;
    return currentSlot % slotsPerCadence === offsetSlot;
  }

  // Multi-hour cadences: use hourly slots
  const hourSlot = Math.floor(buildDate.getTime() / 3600000);
  const cadenceHours = Math.floor(cadence);
  const offsetHours = Math.floor(offset) % cadenceHours;
  return hourSlot % cadenceHours === offsetHours;
}
