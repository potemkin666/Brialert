import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { XMLParser } from 'fast-xml-parser';
import { clean } from '../../shared/taxonomy.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = path.resolve(__dirname, '..', '..');
export const geoLookupPath = path.join(repoRoot, 'data', 'geo-lookup.json');
export const outputPath = path.join(repoRoot, 'live-alerts.json');
export const sqlitePath = path.join(repoRoot, 'data', 'albertalert.sqlite');
export const quarantinedSourcesPath = path.join(repoRoot, 'data', 'quarantined-sources.json');
export const quarantinedSourcesReviewPath = path.join(repoRoot, 'source-quarantine.html');
export const topSourceRemediationPath = path.join(repoRoot, 'data', 'top-20-source-remediation.json');
export const sourceRemediationSweepPath = path.join(repoRoot, 'data', 'source-remediation-sweep.json');
export const restoreAuditPath = path.join(repoRoot, 'data', 'restore-audit.json');

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

function envString(name) {
  const raw = process.env[name];
  if (raw == null) return '';
  return String(raw).trim();
}

function envPath(name, fallbackPath) {
  // Paths should not use `clean()` because it inserts ". " into CamelCase strings
  // (e.g. "OneDrive" -> "One. Drive"), which breaks valid Windows paths.
  const raw = envString(name);
  if (!raw) return fallbackPath;
  return path.isAbsolute(raw) ? raw : path.join(repoRoot, raw);
}

export const sourcePath = envPath('ALBERTALERT_SOURCE_PATH', path.join(repoRoot, 'data', 'sources.json'));
export const sourceRequestsPath = envPath('ALBERTALERT_SOURCE_REQUESTS_PATH', path.join(repoRoot, 'data', 'source-requests.json'));

export const DEFAULT_TIMEOUT_MS = envInt('ALBERTALERT_FETCH_TIMEOUT_MS', 12000, 1000);
export const DEFAULT_MAX_RETRIES = envInt('ALBERTALERT_FETCH_MAX_RETRIES', 2, 1);
export const DEFAULT_FETCH_STAGGER_MS = envInt('ALBERTALERT_FETCH_STAGGER_MS', 60, 0);
export const MAX_FETCH_STAGGER_JITTER_MS = envInt('ALBERTALERT_FETCH_STAGGER_JITTER_MS', 90, 0);
export const BACKOFF_CAP_MS = envInt('ALBERTALERT_FETCH_BACKOFF_CAP_MS', 16000, 1000);
/** Maximum total stagger delay (ms) any single source may incur before its fetch starts. */
export const MAX_STAGGER_CAP_MS = envInt('ALBERTALERT_MAX_STAGGER_CAP_MS', 3000, 0);
export const MAX_SOURCE_ERRORS_TO_REPORT = 25;
export const FEED_SOURCE_CONCURRENCY = envInt('ALBERTALERT_FEED_SOURCE_CONCURRENCY', 4, 1);
export const HTML_HYDRATION_CONCURRENCY = 3;
export const MAX_HTML_CANDIDATES_PER_SOURCE = 18;
export const MAX_FEED_CANDIDATES_PER_SOURCE = 10;
export const MAX_HTML_PARSING_THRESHOLD = MAX_HTML_CANDIDATES_PER_SOURCE * 2;
export const MAX_HTML_PREFETCH_ITEMS = envInt('ALBERTALERT_MAX_HTML_PREFETCH_ITEMS', 12, 1);
export const MAX_FEED_PREFETCH_ITEMS = envInt('ALBERTALERT_MAX_FEED_PREFETCH_ITEMS', 8, 1);
export const MAX_HTML_SOURCES_PER_RUN = envInt('ALBERTALERT_MAX_HTML_SOURCES_PER_RUN', 40, 1);
export const CONTROL_MAX_HTML_SOURCES_PER_RUN = envInt('ALBERTALERT_CONTROL_MAX_HTML_SOURCES_PER_RUN', 30, 1);
export const HTML_DOMAIN_CAP_PER_RUN = 3;
export const SCHEDULER_MODE = clean(process.env.ALBERTALERT_SCHEDULER_AB_MODE || 'candidate').toLowerCase() === 'control'
  ? 'control'
  : 'candidate';
export const PLAYWRIGHT_FALLBACK_ALLOWLIST_SOURCE_IDS = new Set([
  'met-police-news',
  'ct-policing-london',
  ...clean(process.env.ALBERTALERT_PLAYWRIGHT_ALLOWLIST || '')
    .split(',')
    .map((value) => clean(value))
    .filter(Boolean)
]);
export const PLAYWRIGHT_FALLBACK_DOMAINS = new Set(
  clean(process.env.ALBERTALERT_PLAYWRIGHT_DOMAINS || '')
    .split(',')
    .map((value) => clean(value).toLowerCase())
    .filter(Boolean)
);
export const PLAYWRIGHT_SUSPECT_MIN_HTML_CHARS = envInt('ALBERTALERT_PLAYWRIGHT_MIN_HTML_CHARS', 1200, 200);
export const PLAYWRIGHT_FALLBACK_MAX_ATTEMPTS_PER_RUN = Math.max(
  0,
  Number.isFinite(Number(process.env.ALBERTALERT_PLAYWRIGHT_MAX_ATTEMPTS_PER_RUN))
    ? Math.floor(Number(process.env.ALBERTALERT_PLAYWRIGHT_MAX_ATTEMPTS_PER_RUN))
    : 4
);
export const PLAYWRIGHT_FALLBACK_AGGRESSIVE = clean(process.env.ALBERTALERT_PLAYWRIGHT_AGGRESSIVE || 'true').toLowerCase() === 'true';
export const PLAYWRIGHT_FALLBACK_TIMEOUT_MS = Math.max(
  5000,
  Number.isFinite(Number(process.env.ALBERTALERT_PLAYWRIGHT_TIMEOUT_MS))
    ? Math.floor(Number(process.env.ALBERTALERT_PLAYWRIGHT_TIMEOUT_MS))
    : 12000
);
export const GUARDRAIL_MAX_RUNTIME_MS = Math.max(
  60_000,
  Number.isFinite(Number(process.env.ALBERTALERT_GUARDRAIL_MAX_RUNTIME_MS))
    ? Math.floor(Number(process.env.ALBERTALERT_GUARDRAIL_MAX_RUNTIME_MS))
    : 12 * 60_000
);
export const GUARDRAIL_MAX_FAILED_SOURCE_RATE = Math.max(
  0,
  Math.min(
    1,
    Number.isFinite(Number(process.env.ALBERTALERT_GUARDRAIL_MAX_FAILED_SOURCE_RATE))
      ? Number(process.env.ALBERTALERT_GUARDRAIL_MAX_FAILED_SOURCE_RATE)
      : 0.65
  )
);
export const GUARDRAIL_MIN_SUCCESSFUL_SOURCES = Math.max(
  1,
  Number.isFinite(Number(process.env.ALBERTALERT_GUARDRAIL_MIN_SUCCESSFUL_SOURCES))
    ? Math.floor(Number(process.env.ALBERTALERT_GUARDRAIL_MIN_SUCCESSFUL_SOURCES))
    : 8
);
// ---------------------------------------------------------------------------
// Mid-run adaptive guardrail thresholds
// ---------------------------------------------------------------------------
/** Fraction of GUARDRAIL_MAX_RUNTIME_MS at which we switch to fast-fail mode. */
export const MIDRUN_RUNTIME_WARNING_RATIO = Math.max(
  0.1,
  Math.min(
    0.99,
    Number.isFinite(Number(process.env.ALBERTALERT_MIDRUN_RUNTIME_WARNING_RATIO))
      ? Number(process.env.ALBERTALERT_MIDRUN_RUNTIME_WARNING_RATIO)
      : 0.8
  )
);
/** Fraction of GUARDRAIL_MAX_FAILED_SOURCE_RATE at which we start throttling. */
export const MIDRUN_FAILURE_RATE_WARNING_RATIO = Math.max(
  0.1,
  Math.min(
    0.99,
    Number.isFinite(Number(process.env.ALBERTALERT_MIDRUN_FAILURE_RATE_WARNING_RATIO))
      ? Number(process.env.ALBERTALERT_MIDRUN_FAILURE_RATE_WARNING_RATIO)
      : 0.6
  )
);
/**
 * Minimum sources processed before the failure-rate warning can trigger.
 * Avoids reacting to 1-of-2 failures at the very start of a run.
 */
export const MIDRUN_MIN_SOURCES_FOR_RATE_CHECK = envInt('ALBERTALERT_MIDRUN_MIN_SOURCES_FOR_RATE_CHECK', 6, 2);
/** Per-source timeout used in fast-fail mode (ms). */
export const MIDRUN_FAST_FAIL_TIMEOUT_MS = envInt('ALBERTALERT_MIDRUN_FAST_FAIL_TIMEOUT_MS', 5000, 1000);
/**
 * Safety margin (ms) subtracted from the runtime guardrail when computing
 * whether a continuation batch has enough time to complete.
 */
export const CONTINUATION_SAFETY_MARGIN_MS = envInt('ALBERTALERT_CONTINUATION_SAFETY_MARGIN_MS', 30_000, 5000);
/**
 * Floor for the observed success rate used when computing the dynamic
 * continuation oversample factor.  Prevents division-by-tiny-number spikes.
 */
export const CONTINUATION_MIN_OVERSAMPLE_RATE = Math.max(
  0.01,
  Math.min(
    1,
    Number.isFinite(Number(process.env.ALBERTALERT_CONTINUATION_MIN_OVERSAMPLE_RATE))
      ? Number(process.env.ALBERTALERT_CONTINUATION_MIN_OVERSAMPLE_RATE)
      : 0.1
  )
);

export const TARGET_SUCCESSFUL_SOURCES_PER_RUN = Math.max(
  1,
  Number.isFinite(Number(process.env.ALBERTALERT_TARGET_SUCCESSFUL_SOURCES_PER_RUN))
    ? Math.floor(Number(process.env.ALBERTALERT_TARGET_SUCCESSFUL_SOURCES_PER_RUN))
    : 60
);
/** Base lane caps – used as the starting point before dynamic adjustments. */
const BASE_LANE_LIMITS = Object.freeze({
  incidents: 6,
  context: 4,
  sanctions: 4,
  oversight: 4,
  border: 4,
  prevention: 4,
  default: 3
});

/** Reliability-profile multipliers applied to the base lane cap. */
const RELIABILITY_MULTIPLIERS = Object.freeze({
  official_ct: 1.5,
  official_general: 1.25,
  official_context: 1.0,
  major_media: 1.0,
  specialist_research: 0.85,
  general_media: 0.75,
  tabloid: 0.35
});

/**
 * Compute a per-source item limit dynamically based on the source's
 * reliability profile, lane, health history, and current event density.
 *
 * @param {object} options
 * @param {string} options.reliabilityProfile - from inferReliabilityProfile()
 * @param {string} options.lane - source lane (incidents, context, etc.)
 * @param {object|null} [options.sourceHealth] - health entry from previous run
 * @param {number} [options.filteredCount] - items that passed content filters this run
 * @returns {number} positive integer item limit (minimum 1)
 */
export function computeDynamicItemLimit({ reliabilityProfile, lane, sourceHealth, filteredCount } = {}) {
  const baseCap = BASE_LANE_LIMITS[lane] || BASE_LANE_LIMITS.default;
  const multiplier = RELIABILITY_MULTIPLIERS[reliabilityProfile] || RELIABILITY_MULTIPLIERS.general_media;

  // --- health-based adjustment ---------------------------------------------------
  // Sources with a strong track record get a small bonus; sources with recent
  // failures are throttled down.
  let healthFactor = 1.0;
  if (sourceHealth && typeof sourceHealth === 'object') {
    const successfulRuns = Number(sourceHealth.successfulRuns || 0);
    const failedRuns = Number(sourceHealth.failedRuns || 0);
    const totalRuns = successfulRuns + failedRuns;
    if (totalRuns >= 3) {
      const successRate = successfulRuns / totalRuns;
      // successRate 1.0 → +15 %; successRate 0.5 → −10 %; successRate 0 → −25 %
      healthFactor = 0.75 + successRate * 0.4; // range 0.75 – 1.15
    }
    const consecutiveFailures = Number(sourceHealth.consecutiveFailures || 0);
    if (consecutiveFailures >= 3) {
      healthFactor *= 0.8;
    }
  }

  // --- event-density adjustment --------------------------------------------------
  // When a source returns many filtered items (fast-moving event), allow slightly
  // more through for high-reliability profiles; constrain noisy sources.
  let densityFactor = 1.0;
  const fc = Number(filteredCount);
  if (Number.isFinite(fc) && fc > 0) {
    const effectiveCap = Math.max(1, Math.round(baseCap * multiplier * healthFactor));
    if (fc > effectiveCap * 2) {
      // High density – boost reliable sources, throttle unreliable ones.
      if (multiplier >= 1.0) {
        densityFactor = 1.25;
      } else if (multiplier < 0.75) {
        densityFactor = 0.8;
      }
    }
  }

  const raw = baseCap * multiplier * healthFactor * densityFactor;
  return Math.max(1, Math.round(raw));
}
export const MAX_STORED_ALERTS = 120;
export const MAX_FAILING_SOURCES_TO_LOG = 10;
export const EXPECTED_REFRESH_MINUTES = 30;
export const STALE_AFTER_MINUTES = 50;
export const SOURCE_TIMEZONE = 'Europe/London';
export const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
export const FEED_BOT_USER_AGENT = 'Mozilla/5.0 (compatible; AlbertAlertFeedBot/1.0; +https://potemkin666.github.io/AlbertAlert/)';
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
export const SOURCE_REFRESH_TIER_WINDOWS_MINUTES = Object.freeze({
  critical: [30, 60],
  important: [120, 240],
  background: [720, 1440]
});
export const SOURCE_FAILURE_COOLDOWN_HOURS = 24;
export const SOURCE_EMPTY_COOLDOWN_HOURS = 12;
export const SOURCE_PROTECTED_FAILURE_COOLDOWN_HOURS = 6;
export const SOURCE_BLOCKED_FAILURE_COOLDOWN_HOURS = 12;
export const BLOCKED_NON_CONTENT_FAIL_THRESHOLD = envInt('ALBERTALERT_BLOCKED_NON_CONTENT_FAIL_THRESHOLD', 3, 1);
export const BLOCKED_NON_CONTENT_COOLDOWN_HOURS = envInt('ALBERTALERT_BLOCKED_NON_CONTENT_COOLDOWN_HOURS', 6, 1);
export const AUTO_QUARANTINE_RECHECK_HOURS = 7 * 24;
export const AUTO_SKIP_EMPTY_THRESHOLD = 10;
export const AUTO_QUARANTINE_BLOCKED_HTML_THRESHOLD = envInt('ALBERTALERT_AUTO_QUARANTINE_BLOCKED_HTML_THRESHOLD', 4, 1);
export const AUTO_QUARANTINE_DEAD_URL_THRESHOLD = envInt('ALBERTALERT_AUTO_QUARANTINE_DEAD_URL_THRESHOLD', 2, 1);
export const AUTO_QUARANTINE_FAILURE_THRESHOLD = envInt('ALBERTALERT_AUTO_QUARANTINE_FAILURE_THRESHOLD', 6, 1);
export const HEALTH_SCORE_INITIAL = envInt('ALBERTALERT_HEALTH_SCORE_INITIAL', 80, 0);
export const HEALTH_SCORE_DEPRIORITISE_THRESHOLD = envInt('ALBERTALERT_HEALTH_SCORE_DEPRIORITISE_THRESHOLD', 40, 0);
export const HEALTH_SCORE_REVIEW_THRESHOLD = envInt('ALBERTALERT_HEALTH_SCORE_REVIEW_THRESHOLD', 25, 0);
export const HEALTH_SCORE_SUCCESS_BOOST = envInt('ALBERTALERT_HEALTH_SCORE_SUCCESS_BOOST', 10, 1);
export const HEALTH_SCORE_FAILURE_PENALTY = envInt('ALBERTALERT_HEALTH_SCORE_FAILURE_PENALTY', 15, 1);
export const HEALTH_SCORE_CRITICAL_FAILURE_PENALTY = envInt('ALBERTALERT_HEALTH_SCORE_CRITICAL_FAILURE_PENALTY', 30, 1);
export const HEALTH_SCORE_EMPTY_PENALTY = envInt('ALBERTALERT_HEALTH_SCORE_EMPTY_PENALTY', 3, 0);
export const HEALTH_SCORE_LOW_INTERVAL_HOURS = envInt('ALBERTALERT_HEALTH_SCORE_LOW_INTERVAL_HOURS', 24, 1);
export const ROLLING_ERROR_WINDOW_SIZE = envInt('ALBERTALERT_ROLLING_ERROR_WINDOW_SIZE', 5, 1);
// ---------------------------------------------------------------------------
// Domain circuit-breaker ↔ health-score integration
// ---------------------------------------------------------------------------
/** Health penalty applied to sibling sources when a domain's circuit breaker trips. */
export const CIRCUIT_BREAKER_DOMAIN_PENALTY = envInt('ALBERTALERT_CIRCUIT_BREAKER_DOMAIN_PENALTY', 10, 0);
/** Health boost for sibling sources when a probe succeeds on a tripped domain. */
export const CIRCUIT_BREAKER_PROBE_BOOST = envInt('ALBERTALERT_CIRCUIT_BREAKER_PROBE_BOOST', 5, 0);
/** Number of probe requests allowed per half-open cooldown interval. */
export const CIRCUIT_BREAKER_HALF_OPEN_PROBE_COUNT = envInt('ALBERTALERT_CIRCUIT_BREAKER_HALF_OPEN_PROBE_COUNT', 1, 1);
export const FAIL_ON_GUARDRAIL_VIOLATION = clean(process.env.ALBERTALERT_FAIL_ON_GUARDRAIL_VIOLATION).toLowerCase() === 'true';
export const OFFLINE_FIXTURE_MODE = clean(process.env.ALBERTALERT_OFFLINE_FIXTURE_MODE).toLowerCase() === 'true';
export const offlineFixturesPath = envPath(
  'ALBERTALERT_OFFLINE_FIXTURES_PATH',
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

function parseIsoMs(value) {
  const ms = new Date(value || '').getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function normaliseRefreshTier(value) {
  const raw = clean(value).toLowerCase();
  if (!raw) return '';
  if (['critical', 'tier1', 'tier-1', 'high', 'p0'].includes(raw)) return 'critical';
  if (['important', 'tier2', 'tier-2', 'medium', 'p1'].includes(raw)) return 'important';
  if (['background', 'tier3', 'tier-3', 'low', 'p2'].includes(raw)) return 'background';
  return '';
}

export function sourceRefreshTier(source) {
  const explicit = normaliseRefreshTier(source?.refreshTier);
  if (explicit) return explicit;
  if (source?.lane === 'incidents' || source?.isTrustedOfficial) return 'critical';
  if (['context', 'sanctions', 'oversight', 'border', 'prevention'].includes(source?.lane)) return 'important';
  return 'background';
}

export function sourceRefreshWindowMinutes(source) {
  const tier = sourceRefreshTier(source);
  const window = SOURCE_REFRESH_TIER_WINDOWS_MINUTES[tier] || SOURCE_REFRESH_TIER_WINDOWS_MINUTES.background;
  return {
    tier,
    min: window[0],
    max: window[1]
  };
}

export function sourceScheduleIntervalMinutes(source) {
  const explicitHours = Number(source?.refreshEveryHours);
  if (Number.isFinite(explicitHours) && explicitHours >= 0.25) {
    return Math.max(1, Math.round(explicitHours * 60));
  }
  const { min, max } = sourceRefreshWindowMinutes(source);
  const sourceKey = source?.id || source?.endpoint || source?.provider || '';
  const range = Math.max(1, Math.floor(max - min + 1));
  const offset = sourceKey ? sourceDeterministicHash(sourceKey) % range : 0;
  return Math.max(1, min + offset);
}

export function sourceScheduleOffsetMinutes(source, intervalMinutes) {
  const normalizedInterval = Math.max(1, Math.floor(intervalMinutes || 1));
  const explicitOffset = Number(source?.refreshOffset);
  if (Number.isFinite(explicitOffset) && explicitOffset >= 0) {
    return Math.floor((explicitOffset * 60) % normalizedInterval);
  }
  const sourceKey = source?.id || source?.endpoint || source?.provider || '';
  const hashSeed = sourceKey ? `offset:${sourceKey}` : 'offset';
  return sourceKey ? sourceDeterministicHash(hashSeed) % normalizedInterval : 0;
}

export function sourceScheduleNextFetchAt(source, buildDate = new Date(), previousEntry = null, preferExisting = true) {
  const nowMs = buildDate.getTime();
  const existingMs = parseIsoMs(previousEntry?.nextFetchAt);
  if (preferExisting && existingMs && nowMs < existingMs) return new Date(existingMs).toISOString();
  const intervalMinutes = sourceScheduleIntervalMinutes(source);
  const offsetMinutes = sourceScheduleOffsetMinutes(source, intervalMinutes);
  const nowMinutes = Math.floor(nowMs / 60000);
  const remainder = ((nowMinutes % intervalMinutes) + intervalMinutes) % intervalMinutes;
  const base = nowMinutes - remainder;
  let nextMinutes = base + offsetMinutes;
  if (nextMinutes <= nowMinutes) nextMinutes += intervalMinutes;
  return new Date(nextMinutes * 60000).toISOString();
}

export function sourceScheduleNextFetchAfterRun(source, buildDate = new Date()) {
  const intervalMinutes = sourceScheduleIntervalMinutes(source);
  return new Date(buildDate.getTime() + intervalMinutes * 60000).toISOString();
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

export function shouldRefreshSourceThisRun(source, buildDate = new Date(), previousEntry = null) {
  const explicitHours = Number(source?.refreshEveryHours);
  if (source?.lane === 'incidents' || (Number.isFinite(explicitHours) && explicitHours <= 0.25)) {
    return true;
  }
  const nextFetchAtMs = parseIsoMs(previousEntry?.nextFetchAt);
  if (nextFetchAtMs) return buildDate.getTime() >= nextFetchAtMs;
  const intervalMinutes = sourceScheduleIntervalMinutes(source);
  const offsetMinutes = sourceScheduleOffsetMinutes(source, intervalMinutes);
  const nowMinutes = Math.floor(buildDate.getTime() / 60000);
  return intervalMinutes ? (nowMinutes % intervalMinutes) === offsetMinutes : true;
}
