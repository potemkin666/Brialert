import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import {
  AUTO_QUARANTINE_BLOCKED_HTML_THRESHOLD,
  AUTO_QUARANTINE_DEAD_URL_THRESHOLD,
  AUTO_QUARANTINE_RECHECK_HOURS,
  AUTO_SKIP_EMPTY_THRESHOLD,
  AUTO_SKIP_FAILURE_THRESHOLD,
  BLOCKED_NON_CONTENT_COOLDOWN_HOURS,
  BLOCKED_NON_CONTENT_FAIL_THRESHOLD,
  CONTROL_MAX_HTML_SOURCES_PER_RUN,
  DEFAULT_FETCH_STAGGER_MS,
  FEED_SOURCE_CONCURRENCY,
  GUARDRAIL_MAX_FAILED_SOURCE_RATE,
  GUARDRAIL_MAX_RUNTIME_MS,
  GUARDRAIL_MIN_SUCCESSFUL_SOURCES,
  HARD_SKIP_SOURCE_IDS,
  HTML_DOMAIN_CAP_PER_RUN,
  MAX_HTML_SOURCES_PER_RUN,
  MAX_FAILING_SOURCES_TO_LOG,
  MAX_FEED_PREFETCH_ITEMS,
  MAX_SOURCE_ERRORS_TO_REPORT,
  MAX_HTML_PREFETCH_ITEMS,
  MAX_FETCH_STAGGER_JITTER_MS,
  MAX_STORED_ALERTS,
  PLAYWRIGHT_FALLBACK_ALLOWLIST_SOURCE_IDS,
  PLAYWRIGHT_FALLBACK_DOMAINS,
  PLAYWRIGHT_FALLBACK_AGGRESSIVE,
  PLAYWRIGHT_FALLBACK_MAX_ATTEMPTS_PER_RUN,
  PLAYWRIGHT_FALLBACK_TIMEOUT_MS,
  PLAYWRIGHT_SUSPECT_MIN_HTML_CHARS,
  FAIL_ON_GUARDRAIL_VIOLATION,
  SCHEDULER_MODE,
  SOURCE_EMPTY_COOLDOWN_HOURS,
  SOURCE_PROTECTED_FAILURE_COOLDOWN_HOURS,
  SOURCE_BLOCKED_FAILURE_COOLDOWN_HOURS,
  SOURCE_FAILURE_COOLDOWN_HOURS,
  TARGET_SUCCESSFUL_SOURCES_PER_RUN,
  SOURCE_ITEM_LIMITS,
  AUTO_QUARANTINE_FAILURE_THRESHOLD,
  isMachineReadableSourceKind,
  sourceDeterministicHash,
  sourceScheduleNextFetchAfterRun,
  sourceScheduleNextFetchAt,
  shouldRefreshSourceThisRun,
  outputPath,
  quarantinedSourcesPath,
  quarantinedSourcesReviewPath,
  sourceRemediationSweepPath,
  sqlitePath,
  topSourceRemediationPath,
  restoreAuditPath,
  sourcePath,
  sourceRequestsPath
} from './build-live-feed/config.mjs';
import {
  buildAlert,
  discardReasonForItem,
  dedupeAndSortAlerts,
  selectStoredAlerts
} from './build-live-feed/alerts.mjs';
import {
  geoLookupSnapshot,
  safeLoadGeoLookup
} from './build-live-feed/geo.mjs';
import { buildHealthBlock } from './build-live-feed/health.mjs';
import {
  mapWithConcurrency,
  readExisting,
  readJsonFile,
  mergeSourceCatalogs,
  normaliseSourcesPayload,
  normaliseSourceRequestsPayload,
  sleep,
  summariseSourceError,
  ERROR_CODE,
  fetchText,
  fetchTextWithPlaywright
} from './build-live-feed/io.mjs';
import {
  enrichHtmlItems,
  parseFeedItems,
  parseHtmlItems
} from './build-live-feed/parsing.mjs';
import {
  clean,
  inferReliabilityProfile,
  inferSourceTier,
  sourceLooksEnglish
} from '../shared/taxonomy.mjs';

export { buildHealthBlock } from './build-live-feed/health.mjs';
const execFile = promisify(execFileCallback);

function parseIsoMs(value) {
  const ms = new Date(value || '').getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function normaliseRestoreAudit(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const lastRestore = payload.lastRestore && typeof payload.lastRestore === 'object'
    ? payload.lastRestore
    : null;
  if (!lastRestore || typeof lastRestore.at !== 'string' || !lastRestore.at.trim()) return null;
  return {
    generatedAt: typeof payload.generatedAt === 'string' ? payload.generatedAt : null,
    lastRestore: {
      at: lastRestore.at,
      sourceId: typeof lastRestore.sourceId === 'string' ? lastRestore.sourceId : '',
      provider: typeof lastRestore.provider === 'string' ? lastRestore.provider : '',
      replacementUrl: typeof lastRestore.replacementUrl === 'string' ? lastRestore.replacementUrl : ''
    }
  };
}

async function safeLoadRestoreAudit() {
  try {
    const raw = await readJsonFile(restoreAuditPath);
    return normaliseRestoreAudit(raw);
  } catch {
    return null;
  }
}

function sourceHealthEntry(previousHealth, sourceId) {
  const sourceHealth = previousHealth?.sourceHealth;
  if (!sourceHealth || typeof sourceHealth !== 'object') return null;
  const entry = sourceHealth[sourceId];
  return entry && typeof entry === 'object' ? entry : null;
}

function sourceCriticality(source) {
  if (source?.lane === 'incidents') return 'critical';
  if (source?.isTrustedOfficial) return 'high';
  return 'normal';
}

function isBlockedFailureCategory(category) {
  return category === 'blocked-or-auth' || category === 'anti-bot-protection';
}

function isDeadUrlFailureCategory(category) {
  return category === 'dead-or-moved-url';
}

function isNotFoundFailureCategory(category) {
  return category === 'not-found-404';
}

function sourceFailureCooldownHours(source, errorCategory) {
  const criticality = sourceCriticality(source);
  if (isBlockedFailureCategory(errorCategory)) return SOURCE_BLOCKED_FAILURE_COOLDOWN_HOURS;
  if (criticality === 'critical' || criticality === 'high') return SOURCE_PROTECTED_FAILURE_COOLDOWN_HOURS;
  return SOURCE_FAILURE_COOLDOWN_HOURS;
}

function sourceMayAutoCooldown(source, previousEntry, buildDate) {
  if (!previousEntry) return null;
  if (previousEntry.quarantined) {
    const quarantinedAtMs = parseIsoMs(previousEntry.quarantinedAt);
    const quarantineRecheckAt = quarantinedAtMs + (AUTO_QUARANTINE_RECHECK_HOURS * 3600000);
    if (quarantinedAtMs && buildDate.getTime() >= quarantineRecheckAt) {
      return null;
    }
    return {
      reason: 'review-quarantine',
      until: null
    };
  }
  const cooldownUntilMs = parseIsoMs(previousEntry.cooldownUntil);
  if (!cooldownUntilMs || buildDate.getTime() >= cooldownUntilMs) return null;
  if (previousEntry.autoSkipReason === 'blocked-cooldown') {
    return {
      reason: 'blocked-cooldown',
      until: previousEntry.cooldownUntil
    };
  }

  const consecutiveFailures = Number(previousEntry.consecutiveFailures || 0);
  const consecutiveEmptyRuns = Number(previousEntry.consecutiveEmptyRuns || 0);
  const isProtected = source?.lane === 'incidents' || source?.isTrustedOfficial;

  if (consecutiveFailures >= AUTO_SKIP_FAILURE_THRESHOLD) {
    return {
      reason: 'failure-cooldown',
      until: previousEntry.cooldownUntil
    };
  }

  if (!isProtected && consecutiveEmptyRuns >= AUTO_SKIP_EMPTY_THRESHOLD) {
    return {
      reason: 'empty-cooldown',
      until: previousEntry.cooldownUntil
    };
  }

  return null;
}

function nextSourceHealthEntry(source, stat, previousEntry, generatedAt) {
  const prior = previousEntry && typeof previousEntry === 'object' ? previousEntry : {};
  const priorBlockedFailures = Number(prior.consecutiveBlockedFailures || 0);
  const priorDeadUrlFailures = Number(prior.consecutiveDeadUrlFailures || 0);
  const generatedAtMs = Date.parse(generatedAt);
  const scheduleBaseDate = Number.isFinite(generatedAtMs) ? new Date(generatedAtMs) : new Date();
  const scheduledNextFetchAt = sourceScheduleNextFetchAfterRun(source, scheduleBaseDate);
  const next = {
    provider: source.provider,
    lane: source.lane,
    kind: source.kind,
    lastCheckedAt: generatedAt,
    lastBuiltCount: Number(stat?.built || 0),
    successfulRuns: Number(prior.successfulRuns || 0),
    emptyRuns: Number(prior.emptyRuns || 0),
    failedRuns: Number(prior.failedRuns || 0),
    consecutiveFailures: Number(prior.consecutiveFailures || 0),
    consecutiveEmptyRuns: Number(prior.consecutiveEmptyRuns || 0),
    consecutiveBlockedFailures: priorBlockedFailures,
    consecutiveDeadUrlFailures: priorDeadUrlFailures,
    lastSuccessfulAt: prior.lastSuccessfulAt || null,
    lastFailureAt: prior.lastFailureAt || null,
    lastEmptyAt: prior.lastEmptyAt || null,
    lastErrorCategory: prior.lastErrorCategory || null,
    lastErrorMessage: prior.lastErrorMessage || null,
    cooldownUntil: null,
    autoSkipReason: null,
    quarantined: Boolean(prior.quarantined),
    quarantinedAt: prior.quarantinedAt || null,
    quarantineReason: prior.quarantineReason || null,
    nextFetchAt: scheduledNextFetchAt
  };

  if ((stat?.built || 0) > 0) {
    next.successfulRuns += 1;
    next.consecutiveFailures = 0;
    next.consecutiveEmptyRuns = 0;
    next.consecutiveBlockedFailures = 0;
    next.consecutiveDeadUrlFailures = 0;
    next.lastErrorCategory = null;
    next.lastErrorMessage = null;
    next.lastSuccessfulAt = generatedAt;
    return next;
  }

  if ((stat?.errors || 0) > 0) {
    const blockedFailure = source?.kind === 'html' && isBlockedFailureCategory(stat?.lastErrorCategory);
    const blockedNonContent = stat?.statusKind === 'blocked_non_content' || blockedFailure;
    const deadUrlFailure = isDeadUrlFailureCategory(stat?.lastErrorCategory);
    const notFoundFailure = isNotFoundFailureCategory(stat?.lastErrorCategory);
    next.failedRuns += 1;
    next.consecutiveFailures += 1;
    next.consecutiveEmptyRuns = 0;
    next.consecutiveBlockedFailures = blockedNonContent ? priorBlockedFailures + 1 : 0;
    next.consecutiveDeadUrlFailures = deadUrlFailure ? priorDeadUrlFailures + 1 : 0;
    next.lastFailureAt = generatedAt;
    next.lastErrorCategory = stat?.lastErrorCategory || null;
    next.lastErrorMessage = stat?.lastErrorMessage || null;
    if (blockedNonContent && next.consecutiveBlockedFailures >= BLOCKED_NON_CONTENT_FAIL_THRESHOLD) {
      next.cooldownUntil = new Date(Date.parse(generatedAt) + BLOCKED_NON_CONTENT_COOLDOWN_HOURS * 3600000).toISOString();
      next.autoSkipReason = 'blocked-cooldown';
      next.nextFetchAt = next.cooldownUntil;
      return next;
    }
    if (!next.quarantined && notFoundFailure) {
      next.quarantined = true;
      next.quarantinedAt = generatedAt;
      next.quarantineReason = 'HTTP 404 not found; needs manual source URL review';
      next.autoSkipReason = 'review-quarantine';
      next.cooldownUntil = null;
      next.nextFetchAt = new Date(Date.parse(generatedAt) + AUTO_QUARANTINE_RECHECK_HOURS * 3600000).toISOString();
      return next;
    }
    if (!next.quarantined && source?.kind === 'html' && next.consecutiveBlockedFailures >= AUTO_QUARANTINE_BLOCKED_HTML_THRESHOLD) {
      next.quarantined = true;
      next.quarantinedAt = generatedAt;
      next.quarantineReason = 'Repeated blocked-or-auth failures on html source';
      next.autoSkipReason = 'review-quarantine';
      next.cooldownUntil = null;
      next.nextFetchAt = new Date(Date.parse(generatedAt) + AUTO_QUARANTINE_RECHECK_HOURS * 3600000).toISOString();
      return next;
    }
    if (!next.quarantined && next.consecutiveDeadUrlFailures >= AUTO_QUARANTINE_DEAD_URL_THRESHOLD) {
      next.quarantined = true;
      next.quarantinedAt = generatedAt;
      next.quarantineReason = 'Repeated dead-or-moved-url failures';
      next.autoSkipReason = 'review-quarantine';
      next.cooldownUntil = null;
      next.nextFetchAt = new Date(Date.parse(generatedAt) + AUTO_QUARANTINE_RECHECK_HOURS * 3600000).toISOString();
      return next;
    }
    if (!next.quarantined && next.consecutiveFailures >= AUTO_QUARANTINE_FAILURE_THRESHOLD) {
      next.quarantined = true;
      next.quarantinedAt = generatedAt;
      next.quarantineReason = `Repeated failures (${next.consecutiveFailures}) need manual review`;
      next.autoSkipReason = 'review-quarantine';
      next.cooldownUntil = null;
      next.nextFetchAt = new Date(Date.parse(generatedAt) + AUTO_QUARANTINE_RECHECK_HOURS * 3600000).toISOString();
      return next;
    }
    if (next.consecutiveFailures >= AUTO_SKIP_FAILURE_THRESHOLD) {
      const cooldownHours = sourceFailureCooldownHours(source, stat?.lastErrorCategory || '');
      next.cooldownUntil = new Date(Date.parse(generatedAt) + cooldownHours * 3600000).toISOString();
      next.autoSkipReason = 'failure-cooldown';
      next.nextFetchAt = next.cooldownUntil;
    }
    return next;
  }

  next.emptyRuns += 1;
  next.consecutiveEmptyRuns += 1;
  next.consecutiveFailures = 0;
  next.consecutiveBlockedFailures = 0;
  next.consecutiveDeadUrlFailures = 0;
  next.lastErrorCategory = null;
  next.lastErrorMessage = null;
  next.lastEmptyAt = generatedAt;
  if (!source.isTrustedOfficial && source.lane !== 'incidents' && next.consecutiveEmptyRuns >= AUTO_SKIP_EMPTY_THRESHOLD) {
    next.cooldownUntil = new Date(Date.parse(generatedAt) + SOURCE_EMPTY_COOLDOWN_HOURS * 3600000).toISOString();
    next.autoSkipReason = 'empty-cooldown';
    next.nextFetchAt = next.cooldownUntil;
  }
  return next;
}

function alertKey(alert) {
  return clean(alert?.fusedIncidentId) || clean(alert?.id);
}

function buildAlertChurnRows(previousAlerts, nextAlerts) {
  const previousMap = new Map(
    (Array.isArray(previousAlerts) ? previousAlerts : [])
      .map((alert) => [alertKey(alert), alert])
      .filter(([key]) => key)
  );
  const nextMap = new Map(
    (Array.isArray(nextAlerts) ? nextAlerts : [])
      .map((alert) => [alertKey(alert), alert])
      .filter(([key]) => key)
  );

  const rows = [];

  for (const [key, alert] of nextMap.entries()) {
    if (!previousMap.has(key)) {
      rows.push({
        action: 'entered',
        alertId: clean(alert?.id),
        fusedIncidentId: clean(alert?.fusedIncidentId),
        title: clean(alert?.title),
        lane: clean(alert?.lane),
        region: clean(alert?.region),
        source: clean(alert?.source),
        publishedAt: clean(alert?.publishedAt),
        retentionScore: Number.isFinite(alert?.priorityScore) ? alert.priorityScore : null
      });
    }
  }

  for (const [key, alert] of previousMap.entries()) {
    if (!nextMap.has(key)) {
      rows.push({
        action: 'evicted',
        alertId: clean(alert?.id),
        fusedIncidentId: clean(alert?.fusedIncidentId),
        title: clean(alert?.title),
        lane: clean(alert?.lane),
        region: clean(alert?.region),
        source: clean(alert?.source),
        publishedAt: clean(alert?.publishedAt),
        retentionScore: Number.isFinite(alert?.priorityScore) ? alert.priorityScore : null
      });
    }
  }

  return rows;
}

function sourceSchedulingPriority(source) {
  if (isMachineReadableSourceKind(source?.kind)) {
    if (source?.lane === 'incidents') return 100;
    if (source?.isTrustedOfficial) return 90;
    return 80;
  }

  let score = 10;
  if (source?.lane === 'incidents') score += 15;
  if (source?.isTrustedOfficial) score += 10;
  if (source?.lane === 'prevention') score += 4;
  return score;
}

function schedulingTier(source) {
  const priority = sourceSchedulingPriority(source);
  if (priority >= 90) return 'high';
  if (priority >= 25) return 'medium';
  return 'low';
}

function sourceDomain(source) {
  try {
    return new URL(source?.endpoint || '').hostname.toLowerCase();
  } catch {
    return '';
  }
}

function selectHtmlSourcesForRun(rankedHtmlEntries, buildDate, maxSources) {
  const safeEntries = Array.isArray(rankedHtmlEntries) ? rankedHtmlEntries : [];
  const runSeed = Math.floor(buildDate.getTime() / 3600000);
  const ROTATION_WEIGHT_BUCKETS = 7;
  const runCap = Math.max(0, Number(maxSources || 0));
  const domainUse = new Map();
  const domainCappedSourceIds = new Set();
  const selected = [];

  const high = [];
  const medium = [];
  const low = [];
  for (const entry of safeEntries) {
    const tier = schedulingTier(entry?.source);
    if (tier === 'high') high.push(entry);
    else if (tier === 'medium') medium.push(entry);
    else low.push(entry);
  }

  const rotateTier = (entries, weighted = false) => {
    const sorted = [...entries].sort((left, right) => {
      const leftSource = left?.source || {};
      const rightSource = right?.source || {};
      const leftWeight = weighted
        ? sourceDeterministicHash(`${leftSource.id || leftSource.endpoint}|${runSeed}`) % ROTATION_WEIGHT_BUCKETS
        : 0;
      const rightWeight = weighted
        ? sourceDeterministicHash(`${rightSource.id || rightSource.endpoint}|${runSeed}`) % ROTATION_WEIGHT_BUCKETS
        : 0;
      if (rightWeight !== leftWeight) return rightWeight - leftWeight;
      return left.index - right.index;
    });
    if (!sorted.length) return [];
    const offset = runSeed % sorted.length;
    return [...sorted.slice(offset), ...sorted.slice(0, offset)];
  };

  const ordered = [
    ...rotateTier(high, false),
    ...rotateTier(medium, false),
    ...rotateTier(low, true)
  ];

  for (const entry of ordered) {
    if (selected.length >= runCap) break;
    const source = entry?.source;
    if (!source) continue;
    const domain = sourceDomain(source);
    const currentDomainCount = domain ? (domainUse.get(domain) || 0) : 0;
    if (domain && currentDomainCount >= HTML_DOMAIN_CAP_PER_RUN) {
      if (source?.id) domainCappedSourceIds.add(source.id);
      continue;
    }
    selected.push(source);
    if (domain) domainUse.set(domain, currentDomainCount + 1);
  }

  return {
    selected,
    domainUsage: Object.fromEntries(domainUse.entries()),
    domainCappedSourceIds
  };
}

function freshnessMinutes(entry, nowMs) {
  const lastSuccessfulMs = parseIsoMs(entry?.lastSuccessfulAt);
  if (!lastSuccessfulMs) return null;
  return Math.max(0, Math.round((nowMs - lastSuccessfulMs) / 60000));
}

function buildFetchError(message, category) {
  const error = new Error(message);
  error.__brialertCategory = category;
  if (category === 'brittle-selectors-or-js-rendering') {
    error.__brialertMeta = {
      errorCode: ERROR_CODE.PARSER_SELECTOR_OR_JS_RENDERING
    };
  }
  return error;
}

function classifyFetchFailure(summary) {
  const category = clean(summary?.category || '').toLowerCase();
  if (category === 'unchanged-304') return 'unchanged';
  if (category === 'anti-bot-protection') return 'bot-block';
  if (category === 'blocked-or-auth') return 'bot-block';
  if (category === 'not-found-404') return 'stale-endpoint';
  if (category === 'timeout') return 'timeout';
  if (category === 'brittle-selectors-or-js-rendering') return 'parser-failure';
  if (category === 'dead-or-moved-url') return 'http-error';
  if (category === 'http-status-error') return 'http-error';
  if (category === 'network-failure') return 'timeout';
  return 'unknown';
}

function statusKindFromCategory(category) {
  const normalized = clean(category).toLowerCase();
  if (normalized === 'blocked-or-auth' || normalized === 'anti-bot-protection') return 'blocked_non_content';
  if (normalized === 'not-found-404' || normalized === 'dead-or-moved-url' || normalized === 'moved-temporarily') return 'stale';
  return '';
}

/**
 * Returns a redirected final URL as a replacement candidate when it differs
 * from the configured endpoint; otherwise returns an empty string.
 */
function fallbackReplacementUrl(error) {
  const finalUrl = clean(error?.finalUrl);
  const endpoint = clean(error?.endpoint);
  if (finalUrl && endpoint && finalUrl !== endpoint) return finalUrl;
  return '';
}

function reviewByTimestamp(entry, hours = 48) {
  const base = clean(entry?.lastFailureAt || entry?.quarantinedAt);
  if (!base) return '';
  const baseMs = Date.parse(base);
  if (!Number.isFinite(baseMs)) return '';
  return new Date(baseMs + (hours * 3600000)).toISOString();
}

function shouldTryPlaywrightFallback(source, summary, playwrightBudget) {
  if (!source || source.kind !== 'html') return false;
  if (!summary) return false;
  if ((playwrightBudget?.attempts || 0) >= (playwrightBudget?.maxAttempts || 0)) return false;
  const reason = classifyFetchFailure(summary);
  if (reason !== 'bot-block' && reason !== 'parser-failure') return false;
  const domain = sourceDomain(source);
  return PLAYWRIGHT_FALLBACK_ALLOWLIST_SOURCE_IDS.has(source.id)
    || (domain && PLAYWRIGHT_FALLBACK_DOMAINS.has(domain))
    || PLAYWRIGHT_FALLBACK_AGGRESSIVE;
}

function shouldTryPlaywrightForThinHtml(source, body, playwrightBudget) {
  if (!source || source.kind !== 'html') return false;
  if ((playwrightBudget?.attempts || 0) >= (playwrightBudget?.maxAttempts || 0)) return false;
  if (!PLAYWRIGHT_SUSPECT_MIN_HTML_CHARS || PLAYWRIGHT_SUSPECT_MIN_HTML_CHARS <= 0) return false;
  const bodySize = typeof body === 'string' ? body.trim().length : 0;
  if (bodySize >= PLAYWRIGHT_SUSPECT_MIN_HTML_CHARS) return false;
  const domain = sourceDomain(source);
  return PLAYWRIGHT_FALLBACK_ALLOWLIST_SOURCE_IDS.has(source.id)
    || (domain && PLAYWRIGHT_FALLBACK_DOMAINS.has(domain))
    || PLAYWRIGHT_FALLBACK_AGGRESSIVE;
}

async function attemptSourceBuild(source, requestState, playwrightBudget) {
  const localErrors = [];
  const builtAlerts = [];
  let body;
  let usedPlaywrightFallback = false;
  let finalUrl = clean(source?.endpoint);
  let responseStatus = null;
  let fetchOutcome = 'unknown';
  try {
    const fetched = await fetchText(source.endpoint, 1, { source, requestState, includeMeta: true });
    if (typeof fetched === 'string') {
      body = fetched;
      fetchOutcome = 'success';
    } else {
      body = fetched.text;
      finalUrl = clean(fetched.finalUrl || source.endpoint);
      responseStatus = Number.isFinite(Number(fetched.status)) ? Number(fetched.status) : null;
      fetchOutcome = (responseStatus === 304 || fetched.unchanged304) ? 'unchanged' : 'success';
    }
  } catch (error) {
    const summary = summariseSourceError(source, error);
    if (shouldTryPlaywrightFallback(source, summary, playwrightBudget)) {
      playwrightBudget.attempts += 1;
      body = await fetchTextWithPlaywright(source.endpoint, {
        source,
        timeoutMs: PLAYWRIGHT_FALLBACK_TIMEOUT_MS,
        contentSelectors: source?.playwright?.contentSelectors
      });
      usedPlaywrightFallback = true;
      playwrightBudget.successes += 1;
      fetchOutcome = 'success';
    } else {
      throw error;
    }
  }

  let parsed = source.kind === 'rss' || source.kind === 'atom' || source.kind === 'json'
    ? parseFeedItems(source, body)
    : parseHtmlItems(source, body);
  if (!parsed.length && source.kind === 'html' && !usedPlaywrightFallback && shouldTryPlaywrightForThinHtml(source, body, playwrightBudget)) {
    try {
      playwrightBudget.attempts += 1;
      body = await fetchTextWithPlaywright(source.endpoint, {
        source,
        timeoutMs: PLAYWRIGHT_FALLBACK_TIMEOUT_MS,
        contentSelectors: source?.playwright?.contentSelectors
      });
      usedPlaywrightFallback = true;
      playwrightBudget.successes += 1;
      parsed = parseHtmlItems(source, body);
    } catch (error) {
      // ignore, handled below
    }
  }

  if (!parsed.length) {
    localErrors.push(summariseSourceError(
      source,
      buildFetchError('No items parsed from source payload', 'brittle-selectors-or-js-rendering')
    ));
  }
  const statusKind = (() => {
    const category = localErrors[0]?.category;
    const mapped = statusKindFromCategory(category);
    if (mapped) return mapped;
    if (fetchOutcome === 'success' && isMachineReadableSourceKind(source?.kind)) return 'feed_preferred';
    return '';
  })();

  const preLimit = source.kind === 'html' ? MAX_HTML_PREFETCH_ITEMS : MAX_FEED_PREFETCH_ITEMS;
  const preLimited = parsed.slice(0, preLimit);
  const hydrated = source.kind === 'html' ? await enrichHtmlItems(source, preLimited) : preLimited;
  const reliabilityProfile = inferReliabilityProfile(source, inferSourceTier(source));
  const itemLimit = reliabilityProfile === 'tabloid'
    ? SOURCE_ITEM_LIMITS.tabloid
    : SOURCE_ITEM_LIMITS[source.lane] || SOURCE_ITEM_LIMITS.default;
  const filtered = hydrated.filter((item) => {
    try {
      return discardReasonForItem(source, item) === null;
    } catch (error) {
      localErrors.push(summariseSourceError(source, error));
      return false;
    }
  });
  const kept = filtered.slice(0, itemLimit);

  kept.forEach((item, idx) => {
    try {
      builtAlerts.push(buildAlert(source, item, idx));
    } catch (error) {
      localErrors.push(summariseSourceError(source, error));
    }
  });

  return {
    alerts: builtAlerts,
    sourceErrors: localErrors,
    sourceStat: {
      id: source.id,
      provider: source.provider,
      lane: source.lane,
      kind: source.kind,
      parsed: parsed.length,
      hydrated: hydrated.length,
      filtered: filtered.length,
      kept: kept.length,
      built: builtAlerts.length,
      errors: localErrors.length,
      lastErrorCategory: localErrors[0]?.category || null,
      lastErrorMessage: localErrors[0]?.message || null,
      statusKind,
      usedPlaywrightFallback,
      finalUrl,
      status: responseStatus,
      fetchOutcome
    }
  };
}

function buildQuarantinedSourceEntries(sources, sourceHealth) {
  const healthMap = sourceHealth && typeof sourceHealth === 'object' ? sourceHealth : {};
  return (Array.isArray(sources) ? sources : [])
    .map((source) => {
      const health = healthMap[source.id] && typeof healthMap[source.id] === 'object' ? healthMap[source.id] : {};
      const manuallyQuarantined = Boolean(source?.quarantined);
      const autoQuarantined = Boolean(health?.quarantined);
      if (!manuallyQuarantined && !autoQuarantined) return null;
      return {
        id: clean(source?.id),
        provider: clean(source?.provider),
        endpoint: clean(source?.endpoint),
        kind: clean(source?.kind),
        lane: clean(source?.lane),
        region: clean(source?.region),
        status: manuallyQuarantined ? 'catalog-quarantined' : 'auto-quarantined',
        reason: manuallyQuarantined
          ? 'Marked quarantined in sources catalog'
          : clean(health?.quarantineReason || health?.autoSkipReason || 'Needs review'),
        quarantinedAt: clean(health?.quarantinedAt),
        lastErrorCategory: clean(health?.lastErrorCategory),
        lastErrorMessage: clean(health?.lastErrorMessage),
        consecutiveFailures: Number(health?.consecutiveFailures || 0),
        consecutiveBlockedFailures: Number(health?.consecutiveBlockedFailures || 0),
        consecutiveDeadUrlFailures: Number(health?.consecutiveDeadUrlFailures || 0),
        replacementSuggestion: clean(source?.replacementEndpoint || source?.fallbackEndpoint || source?.canonicalEndpoint || ''),
        reviewBy: reviewByTimestamp(health, 48),
        lastFailureAt: clean(health?.lastFailureAt),
        lastCheckedAt: clean(health?.lastCheckedAt)
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      const rightMs = parseIsoMs(right.quarantinedAt || right.lastFailureAt || right.lastCheckedAt);
      const leftMs = parseIsoMs(left.quarantinedAt || left.lastFailureAt || left.lastCheckedAt);
      return rightMs - leftMs;
    });
}

function renderQuarantinedSourcesHtml(generatedAt, entries) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Brialert Source Quarantine Review</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #070d1a;
      --panel: rgba(19, 27, 45, 0.94);
      --panel-border: rgba(127, 156, 203, 0.26);
      --text: #e8eef9;
      --muted: #b9c6de;
      --pill-bg: rgba(159, 208, 255, 0.09);
      --pill-border: rgba(159, 208, 255, 0.2);
      --danger: #ffb4b4;
      --ok: #9ff5bc;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font: 15px/1.5 Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      background: radial-gradient(circle at 12% -10%, #122445, #070d1a 48%);
      color: var(--text);
    }
    main { max-width: 1480px; margin: 0 auto; padding: 28px 16px 42px; }
    h1 { margin: 0 0 8px; font-size: clamp(26px, 3vw, 34px); line-height: 1.15; }
    p { margin: 0 0 18px; color: var(--muted); max-width: 1050px; }
    .meta { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 18px; }
    .pill {
      padding: 7px 11px;
      border-radius: 999px;
      background: var(--pill-bg);
      border: 1px solid var(--pill-border);
      color: #d8e7ff;
      font-size: 13px;
      font-weight: 600;
    }
    .pill.warn {
      background: rgba(255, 196, 122, 0.13);
      border-color: rgba(255, 196, 122, 0.33);
      color: #ffdda8;
    }
    .pill.suggest {
      background: rgba(159, 245, 188, 0.14);
      border-color: rgba(159, 245, 188, 0.4);
      color: #b8ffd2;
    }
    .auth-panel {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
      margin: 0 0 12px;
      padding: 10px 12px;
      border-radius: 12px;
      border: 1px solid rgba(127, 156, 203, 0.26);
      background: rgba(19, 27, 45, 0.6);
    }
    .auth-note {
      font-size: 13px;
      color: #cfe0ff;
    }
    .auth-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .auth-actions button {
      border: 0;
      border-radius: 10px;
      padding: 8px 11px;
      font: inherit;
      font-size: 13px;
      font-weight: 700;
      color: #09101c;
      background: #9fd0ff;
      cursor: pointer;
    }
    .auth-actions button.secondary {
      color: #dceaff;
      background: rgba(97, 125, 168, 0.45);
      border: 1px solid rgba(163, 190, 228, 0.38);
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--panel-border);
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 16px 38px rgba(0, 0, 0, 0.24);
    }
    .table-scroll { overflow: auto; max-height: calc(100vh - 220px); }
    table { width: 100%; border-collapse: collapse; min-width: 1220px; }
    th, td { text-align: left; padding: 10px 10px; vertical-align: top; border-bottom: 1px solid rgba(112, 138, 179, 0.14); }
    th {
      position: sticky;
      top: 0;
      z-index: 1;
      background: #12203a;
      color: #aac0e7;
      font-size: 11px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      white-space: nowrap;
    }
    td { font-size: 14px; }
    a { color: #9fd0ff; text-decoration: none; word-break: break-all; }
    a:hover { text-decoration: underline; }
    .action { display: grid; gap: 8px; min-width: 290px; }
    .url-input {
      width: 100%;
      min-width: 240px;
      padding: 9px 11px;
      border-radius: 10px;
      border: 1px solid rgba(112, 138, 179, 0.3);
      background: rgba(8, 13, 24, 0.76);
      color: var(--text);
      font: inherit;
    }
    .url-input::placeholder { color: #8ea2c7; }
    .url-input:focus { outline: none; border-color: rgba(159, 208, 255, 0.5); box-shadow: 0 0 0 3px rgba(159, 208, 255, 0.12); }
    .url-input:disabled { opacity: 0.75; cursor: wait; }
    .action button {
      border: 0;
      border-radius: 10px;
      padding: 9px 10px;
      font: inherit;
      font-weight: 700;
      color: #09101c;
      background: #9fd0ff;
      cursor: pointer;
    }
    .action button:hover { filter: brightness(1.04); }
    .action button:disabled { cursor: wait; opacity: 0.72; }
    .action button.approve {
      background: #9ff5bc;
      color: #09101c;
    }
    .suggestion-row td {
      background: rgba(159, 245, 188, 0.08);
    }
    .suggestion-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 999px;
      border: 1px solid rgba(159, 245, 188, 0.45);
      background: rgba(159, 245, 188, 0.16);
      color: #caffdc;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .tag-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 6px;
    }
    .tag {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      border-radius: 999px;
      border: 1px solid rgba(127, 156, 203, 0.35);
      background: rgba(159, 208, 255, 0.12);
      color: #d8e7ff;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .audit {
      margin: 18px 0 12px;
      padding: 16px 18px;
      border-radius: 16px;
      border: 1px solid rgba(127, 156, 203, 0.26);
      background: rgba(19, 27, 45, 0.72);
    }
    .audit-header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }
    .audit-title {
      margin: 0;
      font-size: 18px;
    }
    .audit-subtitle {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--muted);
    }
    .audit-grid {
      display: grid;
      gap: 16px;
      grid-template-columns: minmax(240px, 1fr) minmax(240px, 1fr);
    }
    .audit-line {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      font-size: 13px;
      color: #d7e5ff;
    }
    .audit-line strong {
      color: var(--text);
      font-weight: 700;
    }
    .audit-failures {
      display: grid;
      gap: 6px;
    }
    .audit-list {
      margin: 0;
      padding-left: 18px;
      color: #d6e2fb;
      font-size: 13px;
    }
    .helper-note, .status-note { min-height: 18px; font-size: 12px; }
    .helper-note { color: #8ea3c8; }
    .status-note { color: #9fb2d6; }
    .status-note.error { color: var(--danger); }
    .status-note.success { color: var(--ok); }
    .empty { padding: 18px 10px; color: var(--muted); }
    .endpoint-copy { color: #d6e5ff; font-weight: 600; }
    .hidden { display: none; }
    .toast {
      position: fixed;
      right: 14px;
      bottom: 14px;
      background: rgba(8, 21, 33, 0.96);
      border: 1px solid rgba(159, 208, 255, 0.45);
      color: #d8ecff;
      border-radius: 10px;
      padding: 10px 12px;
      font-size: 13px;
      font-weight: 600;
      opacity: 0;
      transform: translateY(8px);
      transition: opacity .16s ease, transform .16s ease;
      pointer-events: none;
    }
    .toast.visible { opacity: 1; transform: translateY(0); }
    @media (max-width: 760px) {
      main { padding: 18px 10px 26px; }
      .card { border-radius: 12px; }
      .table-scroll { max-height: calc(100vh - 160px); }
      .audit-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main>
    <h1>Source Quarantine Review</h1>
    <p>Auto-quarantined or manually quarantined sources that should be reviewed before returning to the hourly feed run. Suggest a replacement URL and Brialert will restore it into the normal source catalog for the next run.</p>
    <div class="auth-panel" id="auth-panel">
      <div id="auth-note" class="auth-note">Checking admin session...</div>
      <div class="auth-actions" id="auth-actions"></div>
    </div>
    <div class="meta" id="meta">
      <span class="pill">Generated: ${clean(generatedAt)}</span>
      <span class="pill">Quarantined sources: ${entries.length}</span>
      <span class="pill suggest">Pending suggestions: 0</span>
      <span class="pill">SLA: review within 48h</span>
    </div>
    <section class="audit" id="audit">
      <div class="audit-header">
        <div>
          <h2 class="audit-title">Feed Audit</h2>
          <div class="audit-subtitle">Refresh + Restore Pulse</div>
        </div>
      </div>
      <div class="audit-grid">
        <div class="audit-summary" id="audit-summary"></div>
        <div class="audit-failures">
          <div class="audit-subtitle">Top Failures</div>
          <ul class="audit-list" id="audit-failures"></ul>
        </div>
      </div>
    </section>
    <div class="card">
      <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Provider</th>
            <th>Type</th>
            <th>Region</th>
            <th>Status</th>
            <th>Reason</th>
            <th>Last Error</th>
            <th>Blocked Runs</th>
            <th>Dead/Moved Runs</th>
          <th>SLA Review By</th>
          <th>Endpoint</th>
          <th>Action</th>
        </tr>
        </thead>
        <tbody id="quarantine-body">
          <tr><td colspan="11" class="empty">Loading quarantined sources...</td></tr>
        </tbody>
      </table>
      </div>
    </div>
  </main>
  <div id="toast" class="toast" aria-live="polite"></div>
  <script>
    const DEFAULT_API_BASE = 'https://brialertbackend.vercel.app';
    function normaliseApiBase(value) {
      const raw = String(value || '').trim();
      return raw ? raw.replace(/\\/$/, '') : '';
    }
    function uniqueValues(values) {
      const seen = new Set();
      const result = [];
      for (const value of values) {
        if (!value || seen.has(value)) continue;
        seen.add(value);
        result.push(value);
      }
      return result;
    }
    const API_BASE_CANDIDATES = uniqueValues([
      normaliseApiBase(globalThis.BRIALERT_API_BASE),
      normaliseApiBase(DEFAULT_API_BASE)
    ]);
    let apiBase = API_BASE_CANDIDATES[0] || '';
    let authState = {
      authenticated: false,
      user: null,
      loginUrl: '',
      logoutUrl: ''
    };
    function apiUrlFor(base, path) {
      return base ? base + path : '';
    }
    function withSessionCredentials(options = {}) {
      return {
        ...options,
        credentials: 'include'
      };
    }
    function resolveAuthUrl(base, value, fallbackFactory) {
      const raw = String(value || '').trim();
      if (!raw) return fallbackFactory(base);
      if (/^https?:\\/\\//i.test(raw)) return raw;
      return apiUrlFor(base, raw.startsWith('/') ? raw : '/' + raw);
    }
    function quarantineUrlFor(base) {
      return apiUrlFor(base, '/api/quarantined-sources');
    }
    function restoreUrlFor(base) {
      return apiUrlFor(base, '/api/restore-source');
    }
    function approveUrlFor(base) {
      return apiUrlFor(base, '/api/approve-source');
    }
    function sessionUrlFor(base) {
      return apiUrlFor(base, '/api/auth/session');
    }
    function resolveQuarantineUrl() {
      const fallbackOrigin = globalThis.location?.origin || DEFAULT_API_BASE;
      try {
        return new URL(globalThis.location?.href || '/source-quarantine.html', fallbackOrigin);
      } catch {
        return new URL('/source-quarantine.html', fallbackOrigin);
      }
    }
    function stripAuthQueryParams(url) {
      const sanitized = new URL(url.toString());
      sanitized.searchParams.delete('auth');
      sanitized.searchParams.delete('error');
      return sanitized;
    }
    function returnToUrlForAuth() {
      const currentUrl = stripAuthQueryParams(resolveQuarantineUrl());
      return currentUrl.toString();
    }
    function loginUrlFor(base) {
      const normalizedBase = normaliseApiBase(base);
      const normalizedActiveBase = normaliseApiBase(apiBase);
      const normalizedDefaultBase = normaliseApiBase(DEFAULT_API_BASE);
      const targetBase = normalizedBase || normalizedActiveBase || normalizedDefaultBase;
      return apiUrlFor(
        targetBase,
        '/api/auth/github/start?returnTo=' + encodeURIComponent(returnToUrlForAuth())
      );
    }
    function logoutUrlFor(base) {
      return apiUrlFor(base, '/api/auth/logout');
    }
    const LOCAL_DATA_URL = 'data/quarantined-sources.json';
    const LIVE_ALERTS_URL = 'live-alerts.json';
    const TOP_FAILURES_URL = 'data/top-20-source-remediation.json';
    const RESTORE_AUDIT_URL = 'data/restore-audit.json';
    const body = document.getElementById('quarantine-body');
    const meta = document.getElementById('meta');
    const toast = document.getElementById('toast');
    const audit = document.getElementById('audit');
    const auditSummary = document.getElementById('audit-summary');
    const auditFailures = document.getElementById('audit-failures');
    const authNote = document.getElementById('auth-note');
    const authActions = document.getElementById('auth-actions');
    let currentEntries = [];
    let currentSuggestions = [];
    let currentDataMode = 'live';
    let restoreEnabled = true;
    let approveEnabled = true;
    const READ_ONLY_NOTE = 'Restore is unavailable in read-only mode because the backend write API is not reachable.';
    const APPROVE_READ_ONLY_NOTE = 'Approval is unavailable in read-only mode because the backend write API is not reachable.';
    const TOAST_DURATION_MS = 1900;
    const LOAD_FETCH_TIMEOUT_MS = 12000;
    const PROBE_FETCH_TIMEOUT_MS = 5000;
    const APPROVE_FETCH_TIMEOUT_MS = 12000;
    // Retry quickly after OAuth redirect to absorb short cookie/session propagation delays.
    const POST_LOGIN_SESSION_RETRY_DELAYS_MS = [0, 250, 750];
    let toastTimer = null;

    function escapeHtml(value) {
      return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function safeDomId(value) {
      return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'source';
    }

    function renderMeta(payload) {
      const modeLabel = currentDataMode === 'snapshot'
        ? 'Data mode: static snapshot (read-only)'
        : restoreEnabled
          ? 'Data mode: live API (restore enabled)'
          : 'Data mode: live read-only (restore unavailable)';
      meta.innerHTML = [
        '<span class="pill">Generated: ' + escapeHtml(payload.generatedAt || '${clean(generatedAt)}') + '</span>',
        '<span class="pill">Quarantined sources: ' + escapeHtml(currentEntries.length) + '</span>',
        '<span class="pill suggest">Pending suggestions: ' + escapeHtml(currentSuggestions.length) + '</span>',
        '<span class="pill">SLA: review within 48h</span>',
        '<span class="pill' + (!restoreEnabled ? ' warn' : '') + '">' +
          modeLabel +
        '</span>'
      ].join('');
    }

    function emptyState(message) {
       body.innerHTML = '<tr><td colspan="11" class="empty">' + escapeHtml(message) + '</td></tr>';
    }

    function formatTimeAgo(timestampMs) {
      if (!Number.isFinite(timestampMs)) return 'unknown';
      const deltaMs = Date.now() - timestampMs;
      if (deltaMs < 0) return 'just now';
      const minutes = Math.floor(deltaMs / 60000);
      if (minutes < 1) return 'just now';
      const hours = Math.floor(minutes / 60);
      const remainingMinutes = minutes % 60;
      if (hours < 1) return minutes + 'm ago';
      return hours + 'h ' + remainingMinutes + 'm ago';
    }

    function formatShortTime(timestampMs) {
      if (!Number.isFinite(timestampMs)) return 'unknown';
      return new Date(timestampMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function renderAudit({ live, remediation, restoreAudit } = {}) {
      if (!audit || !auditSummary || !auditFailures) return;
      const generatedAt = typeof live?.generatedAt === 'string' ? live.generatedAt : '';
      const generatedAtMs = Date.parse(generatedAt || '');
      const refreshTime = Number.isFinite(generatedAtMs) ? formatShortTime(generatedAtMs) : 'unknown';
      const refreshAge = Number.isFinite(generatedAtMs) ? formatTimeAgo(generatedAtMs) : 'unknown';
      const sourceCount = Number.isFinite(Number(live?.sourceCount)) ? Number(live.sourceCount) : 'n/a';
      const lastRestoreAt = restoreAudit?.lastRestore?.at;
      const lastRestoreMs = Date.parse(lastRestoreAt || '');
      const lastRestoreLabel = Number.isFinite(lastRestoreMs)
        ? formatShortTime(lastRestoreMs) + ' (' + formatTimeAgo(lastRestoreMs) + ')'
        : 'none yet';

      auditSummary.innerHTML = [
        '<div class="audit-line">Last refresh: <strong>' + escapeHtml(refreshTime) + '</strong> (' + escapeHtml(refreshAge) + ')</div>',
        '<div class="audit-line">Sources checked: <strong>' + escapeHtml(sourceCount) + '</strong></div>',
        '<div class="audit-line">Last restore: <strong>' + escapeHtml(lastRestoreLabel) + '</strong></div>'
      ].join('');

      const failures = Array.isArray(remediation?.top20) ? remediation.top20.slice(0, 3) : [];
      if (!failures.length) {
        auditFailures.innerHTML = '<li>No failure telemetry yet.</li>';
        return;
      }
      auditFailures.innerHTML = failures.map((entry) => {
        const provider = entry?.provider || entry?.id || 'Unknown source';
        const category = entry?.category || 'unknown';
        const statusLabel = Number.isFinite(Number(entry?.status)) ? 'HTTP ' + entry.status : '';
        const message = entry?.message || '';
        const detail = [statusLabel, message].filter(Boolean).join(' - ');
        const suffix = detail ? ' | ' + detail : '';
        return '<li>' + escapeHtml(provider) + ' - ' + escapeHtml(category) + escapeHtml(suffix) + '</li>';
      }).join('');
    }

    function tagRowMarkup(tags) {
      const safeTags = Array.isArray(tags) ? tags.filter((tag) => tag) : [];
      if (!safeTags.length) return '';
      return '<div class="tag-row">' + safeTags.map((tag) => '<span class="tag">' + escapeHtml(tag) + '</span>').join('') + '</div>';
    }

    function suggestionRowMarkup(entry) {
      const tags = Array.isArray(entry?.tags) ? entry.tags : [];
      const tagMarkup = tagRowMarkup(tags);
      const tagSummary = entry?.tagSummary ? '<div class="helper-note">' + escapeHtml(entry.tagSummary) + '</div>' : '';
      return '<tr class="suggestion-row" data-request-id="' + escapeHtml(entry.id) + '">' +
        '<td>' + escapeHtml(entry.provider || 'Requested source') + '</td>' +
        '<td>' + escapeHtml(entry.kind || 'html') + ' / ' + escapeHtml(entry.lane || 'context') + '</td>' +
        '<td>' + escapeHtml(entry.region || 'uk') + '</td>' +
        '<td><span class="suggestion-pill">New Source Suggestion</span></td>' +
        '<td>' + (tagMarkup || tagSummary || 'Pending review') + '</td>' +
        '<td>n/a</td>' +
        '<td>0</td>' +
        '<td>0</td>' +
        '<td>' + escapeHtml(entry.requestedAt || 'n/a') + '</td>' +
        '<td><a href="' + escapeHtml(entry.endpoint || '') + '" target="_blank" rel="noreferrer">' + escapeHtml(entry.endpoint || '') + '</a></td>' +
        '<td><div class="action">' +
          '<button type="button" class="approve" data-action="approve">Approve into catalog</button>' +
          '<div class="helper-note">Adds this source to the catalog for the next run.</div>' +
          '<div class="status-note status-feedback" aria-live="polite"></div>' +
        '</div></td>' +
      '</tr>';
    }

    function rowMarkup(entry) {
      return '<tr data-source-id="' + escapeHtml(entry.id) + '" id="source-' + safeDomId(entry.id) + '">' +
        '<td>' + escapeHtml(entry.provider) + '</td>' +
        '<td>' + escapeHtml(entry.kind) + ' / ' + escapeHtml(entry.lane) + '</td>' +
        '<td>' + escapeHtml(entry.region) + '</td>' +
        '<td>' + escapeHtml(entry.status) + '</td>' +
        '<td>' + escapeHtml(entry.reason) + '</td>' +
        '<td>' + escapeHtml(entry.lastErrorCategory || 'n/a') + '</td>' +
        '<td>' + escapeHtml(entry.consecutiveBlockedFailures || 0) + '</td>' +
        '<td>' + escapeHtml(entry.consecutiveDeadUrlFailures || 0) + '</td>' +
        '<td>' + escapeHtml(entry.reviewBy || 'n/a') + '</td>' +
        '<td><a href="' + escapeHtml(entry.endpoint) + '" target="_blank" rel="noreferrer">' + escapeHtml(entry.endpoint) + '</a></td>' +
        '<td><div class="action">' +
          '<input class="url-input" type="url" inputmode="url" placeholder="Suggest new URL" value="' + escapeHtml(entry.replacementSuggestion || '') + '" aria-label="Suggest new URL for ' + escapeHtml(entry.provider) + '">' +
          '<button type="button" data-action="restore">Restore source</button>' +
          '<div class="helper-note">If prefilled, suggestion is auto-detected and must be verified.</div>' +
          '<div class="status-note status-feedback" aria-live="polite"></div>' +
        '</div></td>' +
      '</tr>';
    }

    function setRowBusy(row, isBusy) {
      const button = row.querySelector('button[data-action="restore"]');
      const approveButton = row.querySelector('button[data-action="approve"]');
      const input = row.querySelector('.url-input');
      if (button) {
        button.disabled = isBusy || !restoreEnabled;
        button.textContent = isBusy ? 'Restoring...' : 'Restore source';
      }
      if (approveButton) {
        approveButton.disabled = isBusy || !approveEnabled;
        approveButton.textContent = isBusy ? 'Approving...' : 'Approve into catalog';
      }
      if (input) {
        input.disabled = isBusy || !restoreEnabled;
      }
    }

    function getOrCreateRowFeedbackNote(row) {
      if (!row) return null;
      const existing = row.querySelector('.status-feedback');
      if (existing) return existing;
      const container = row.querySelector('.action') || row;
      const note = document.createElement('div');
      note.className = 'status-note status-feedback';
      note.setAttribute('aria-live', 'polite');
      container.appendChild(note);
      return note;
    }

    function renderRows() {
      if (!currentEntries.length && !currentSuggestions.length) {
        emptyState('No quarantined sources currently recorded.');
        return;
      }
      const suggestionMarkup = currentSuggestions.map(suggestionRowMarkup).join('');
      const quarantineMarkup = currentEntries.map(rowMarkup).join('');
      body.innerHTML = suggestionMarkup + quarantineMarkup;
      if (!approveEnabled) {
        for (const row of body.querySelectorAll('tr[data-request-id]')) {
          const button = row.querySelector('button[data-action="approve"]');
          const note = row.querySelector('.status-feedback');
          if (button) {
            button.disabled = true;
            button.title = APPROVE_READ_ONLY_NOTE;
          }
          if (note) {
            note.textContent = APPROVE_READ_ONLY_NOTE;
            note.className = 'status-note error';
          }
        }
      }
      if (!restoreEnabled) {
        for (const row of body.querySelectorAll('tr[data-source-id]')) {
          const button = row.querySelector('button[data-action="restore"]');
          const input = row.querySelector('.url-input');
          const note = row.querySelector('.status-feedback');
          if (button) {
            button.disabled = true;
            button.title = READ_ONLY_NOTE;
          }
          if (input) {
            input.disabled = true;
          }
          if (note) {
            note.textContent = READ_ONLY_NOTE;
            note.className = 'status-note error';
          }
        }
      }
    }

    function serializeError(error) {
      return error instanceof Error ? error.message : String(error);
    }

    function explainError(error) {
      const message = serializeError(error);
      if (/not-authenticated|sign in with github|authorized admin/i.test(message)) {
        return 'Sign in with an authorized GitHub admin account to access quarantine.';
      }
      if (/bad credentials/i.test(message)) {
        return 'Backend authentication failed. Displaying cached snapshot data (restore functionality may be unavailable).';
      }
      return message;
    }

    function renderAuthPanel() {
      if (authNote) {
        authNote.textContent = authState.authenticated
          ? 'Signed in as @' + String(authState.user?.login || 'admin')
          : 'Admin sign-in required for quarantine access.';
      }
      if (!authActions) return;
      authActions.innerHTML = '';
      const signIn = document.createElement('button');
      signIn.type = 'button';
      signIn.textContent = authState.authenticated ? 'Switch account' : 'Sign in with GitHub';
      signIn.addEventListener('click', () => {
        const target = authState.loginUrl || loginUrlFor(apiBase);
        if (target) globalThis.location.href = target;
      });
      authActions.appendChild(signIn);
      if (authState.authenticated) {
        const signOut = document.createElement('button');
        signOut.type = 'button';
        signOut.className = 'secondary';
        signOut.textContent = 'Sign out';
        signOut.addEventListener('click', async () => {
          try {
            await fetch(
              logoutUrlFor(apiBase) || authState.logoutUrl,
              withSessionCredentials({ method: 'POST' })
            );
          } catch {}
          authState = {
            authenticated: false,
            user: null,
            loginUrl: loginUrlFor(apiBase),
            logoutUrl: logoutUrlFor(apiBase)
          };
          renderAuthPanel();
          currentEntries = [];
          restoreEnabled = false;
          approveEnabled = false;
          currentSuggestions = [];
          renderMeta({ generatedAt: new Date().toISOString() });
          renderRows();
          emptyState('Sign in as an admin to view quarantined sources.');
        });
        authActions.appendChild(signOut);
      }
    }

    function normaliseAbsoluteHttpUrl(value) {
      const trimmed = String(value || '').trim();
      if (!trimmed) return '';
      try {
        const parsed = new URL(trimmed);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
        return parsed.toString();
      } catch {
        return '';
      }
    }

    function sanitiseReplacementUrlInput(value) {
      const direct = normaliseAbsoluteHttpUrl(value);
      if (direct) return direct;
      const trimmed = String(value || '').trim();
      if (!trimmed) return '';
      const schemeMatches = Array.from(trimmed.matchAll(/https?:\\/\\//gi));
      if (schemeMatches.length !== 2) return '';
      const splitAt = schemeMatches[1]?.index;
      if (!Number.isInteger(splitAt) || splitAt <= 0) return '';
      const firstCandidate = normaliseAbsoluteHttpUrl(trimmed.slice(0, splitAt));
      const secondCandidate = normaliseAbsoluteHttpUrl(trimmed.slice(splitAt));
      if (!firstCandidate || !secondCandidate) return '';
      return firstCandidate.toLowerCase() === secondCandidate.toLowerCase() ? firstCandidate : '';
    }

    function syncUrlInputState(input) {
      if (!input) return '';
      const raw = String(input.value || '').trim();
      if (!raw) {
        input.setCustomValidity('');
        return '';
      }
      const cleaned = sanitiseReplacementUrlInput(raw);
      if (cleaned) {
        if (input.value !== cleaned) input.value = cleaned;
        input.setCustomValidity('');
        return cleaned;
      }
      const hasMultipleAbsoluteUrls = /https?:\\/\\/\\S*https?:\\/\\//i.test(raw);
      input.setCustomValidity(hasMultipleAbsoluteUrls
        ? 'Paste only one absolute URL.'
        : 'Use a valid absolute http/https URL.'
      );
      return '';
    }

    function showToast(message) {
      if (!toast) return;
      toast.textContent = message;
      toast.classList.add('visible');
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        toast.classList.remove('visible');
      }, TOAST_DURATION_MS);
    }

    async function fetchWithTimeout(url, options, timeoutMs, timeoutLabel) {
      const requestOptions = withSessionCredentials(options || {});
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        return fetch(url, requestOptions);
      }
      if (typeof AbortController !== 'function') {
        return Promise.race([
          fetch(url, requestOptions),
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error(timeoutLabel + ' timed out after ' + timeoutMs + 'ms.')), timeoutMs);
          })
        ]);
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await fetch(url, {
          ...requestOptions,
          signal: controller.signal
        });
      } catch (error) {
        if (error && error.name === 'AbortError') {
          throw new Error(timeoutLabel + ' timed out after ' + timeoutMs + 'ms.');
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }

    async function fetchPayload(url, fallbackError) {
      const response = await fetchWithTimeout(
        url,
        withSessionCredentials({ cache: 'no-store' }),
        LOAD_FETCH_TIMEOUT_MS,
        'Quarantine data request'
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const apiMessage = payload?.message || payload?.detail;
        const error = new Error(apiMessage || fallbackError);
        error.status = response.status;
        throw error;
      }
      return payload;
    }

    async function fetchOptionalJson(url, timeoutLabel) {
      try {
        const response = await fetchWithTimeout(
          url,
          withSessionCredentials({ cache: 'no-store' }),
          PROBE_FETCH_TIMEOUT_MS,
          timeoutLabel
        );
        if (!response.ok) return null;
        return await response.json().catch(() => null);
      } catch {
        return null;
      }
    }

    async function loadAudit(payload) {
      const [live, remediation, restoreAudit] = await Promise.all([
        fetchOptionalJson(LIVE_ALERTS_URL, 'Live feed audit'),
        fetchOptionalJson(TOP_FAILURES_URL, 'Top failure audit'),
        fetchOptionalJson(RESTORE_AUDIT_URL, 'Restore audit')
      ]);
      const fallbackLive = live || {
        generatedAt: payload?.generatedAt || new Date().toISOString(),
        sourceCount: payload?.count || payload?.sources?.length || 'n/a'
      };
      renderAudit({ live: fallbackLive, remediation, restoreAudit });
    }

    function cacheBustedUrl(url, cacheKey) {
      try {
        const candidate = new URL(url);
        candidate.searchParams.set('_brialert_probe', String(cacheKey || Date.now()));
        return candidate.toString();
      } catch {
        return url;
      }
    }

    async function probeRestoreApi() {
      const restoreUrl = restoreUrlFor(apiBase);
      if (!restoreUrl) {
        return {
          reachable: false,
          reason: 'no-api-base'
        };
      }
      try {
        // POST probe intentionally sends invalid payload so backend returns a non-mutating validation/auth response.
        const response = await fetchWithTimeout(
          cacheBustedUrl(restoreUrl, Date.now()),
          withSessionCredentials({
            method: 'POST',
            cache: 'no-store',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ sourceId: '', replacementUrl: '' })
          }),
          PROBE_FETCH_TIMEOUT_MS,
          'Restore API probe (POST)'
        );
        let payload = null;
        try {
          payload = await response.clone().json();
        } catch {}
        // Any HTTP response means the backend write route is reachable.
        // Only fetch-level failures (network/CORS/timeout/transport) should disable restore controls.
        return {
          reachable: true,
          method: 'POST',
          status: response.status,
          reason: String(payload?.error || payload?.message || payload?.detail || 'http-response')
        };
      } catch (error) {
        const message = serializeError(error);
        const normalized = /failed to fetch|networkerror|load failed|cors|timed out/i.test(message)
          ? 'network-or-cors'
          : 'fetch-failure';
        return {
          reachable: false,
          reason: 'POST (invalid-body reachability probe for write route) ' + normalized + ': ' + message
        };
      }
    }

    async function restoreSource(sourceId, replacementUrl) {
      const restoreUrl = restoreUrlFor(apiBase);
      if (!restoreUrl) {
        throw new Error('No restore API base is configured.');
      }
      const response = await fetch(restoreUrl, withSessionCredentials({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sourceId,
          replacementUrl: String(replacementUrl || '').trim()
        })
      }));
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        throw new Error(data.message || 'Restore failed');
      }
      return data.restoredSource;
    }

    async function approveSource(requestId) {
      const approveUrl = approveUrlFor(apiBase);
      if (!approveUrl) {
        throw new Error('No approve API base is configured.');
      }
      const response = await fetchWithTimeout(
        approveUrl,
        withSessionCredentials({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            requestId
          })
        }),
        APPROVE_FETCH_TIMEOUT_MS,
        'Approve source request'
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        throw new Error(data.message || 'Approve failed');
      }
      return data.approvedSource;
    }

    async function loadAuthSession(options = {}) {
      const retryAfterOauth = options.retryAfterOauth === true;
      const delays = retryAfterOauth ? POST_LOGIN_SESSION_RETRY_DELAYS_MS : [0];
      let latestFailures = [];

      for (const delayMs of delays) {
        if (delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        const failures = [];
        for (const candidateBase of API_BASE_CANDIDATES) {
          apiBase = candidateBase;
          const url = sessionUrlFor(candidateBase);
          if (!url) continue;
          try {
            const payload = await fetchPayload(url, 'Failed to load admin session.');
            const authenticated = !!payload?.authenticated;
            authState = {
              authenticated,
              user: authenticated ? payload.user || null : null,
              loginUrl: resolveAuthUrl(candidateBase, payload.loginUrl, loginUrlFor),
              logoutUrl: resolveAuthUrl(candidateBase, payload.logoutUrl, logoutUrlFor)
            };
            renderAuthPanel();
            if (authenticated) return true;
          } catch (error) {
            failures.push(candidateBase + ': ' + serializeError(error));
          }
        }
        latestFailures = failures;
      }
      authState = {
        authenticated: false,
        user: null,
        loginUrl: loginUrlFor(apiBase),
        logoutUrl: logoutUrlFor(apiBase)
      };
      renderAuthPanel();
      if (latestFailures.length) {
        console.warn('Failed to load auth session from configured backends.', { failures: latestFailures });
      }
      return false;
    }

    async function fetchLivePayloadWithFailover() {
      const failures = [];
      for (const candidateBase of API_BASE_CANDIDATES) {
        apiBase = candidateBase;
        try {
          return await fetchPayload(
            quarantineUrlFor(apiBase),
            'Failed to load quarantined sources.'
          );
        } catch (error) {
          failures.push(candidateBase + ': ' + serializeError(error));
        }
      }
      if (!failures.length) {
        throw new Error('No live quarantine API base is configured.');
      }
      throw new Error('Failed to load live quarantine API from all configured backends. ' + failures.join(' | '));
    }

    async function restoreSourceRow(row) {
      if (!row || !restoreEnabled || row.dataset.restoring === 'true') return;
      const sourceId = row.getAttribute('data-source-id');
      const input = row.querySelector('.url-input');
      const note = getOrCreateRowFeedbackNote(row);
      const url = syncUrlInputState(input);

      if (!url) {
        if (note) {
          note.textContent = input && String(input.value || '').trim()
            ? 'Use a valid absolute http/https URL (single URL only).'
            : 'Paste a replacement URL first.';
          note.className = 'status-note error';
        }
        if (input && typeof input.reportValidity === 'function') {
          input.reportValidity();
        }
        return;
      }

      row.dataset.restoring = 'true';
      setRowBusy(row, true);
      if (note) {
        note.textContent = 'Restoring source...';
        note.className = 'status-note';
      }

      try {
        await restoreSource(sourceId, url);
        currentEntries = currentEntries.filter((entry) => entry.id !== sourceId);
        renderMeta({ generatedAt: new Date().toISOString() });
        row.remove();
        if (!body.querySelector('tr[data-source-id]')) {
          emptyState('No quarantined sources currently recorded.');
        }
        showToast('Source restored.');
      } catch (error) {
        if (note) {
          note.textContent = explainError(error);
          note.className = 'status-note error';
        }
        row.dataset.restoring = 'false';
        setRowBusy(row, false);
      }
    }

    async function approveSourceRow(row) {
      if (!row || !approveEnabled || row.dataset.approving === 'true') return;
      const requestId = row.getAttribute('data-request-id');
      const note = getOrCreateRowFeedbackNote(row);

      row.dataset.approving = 'true';
      setRowBusy(row, true);
      if (note) {
        note.textContent = 'Approving source...';
        note.className = 'status-note';
      }

      try {
        await approveSource(requestId);
        currentSuggestions = currentSuggestions.filter((entry) => entry.id !== requestId);
        renderMeta({ generatedAt: new Date().toISOString() });
        row.remove();
        if (!body.querySelector('tr[data-source-id]') && !body.querySelector('tr[data-request-id]')) {
          emptyState('No quarantined sources currently recorded.');
        }
        showToast('Source approved into catalog.');
      } catch (error) {
        if (note) {
          note.textContent = explainError(error);
          note.className = 'status-note error';
        }
        row.dataset.approving = 'false';
        setRowBusy(row, false);
      }
    }

    async function loadEntries() {
      emptyState('Loading quarantined sources...');
      try {
        const authStatus = new URLSearchParams(globalThis.location?.search || '').get('auth');
        const isAuthenticated = await loadAuthSession({ retryAfterOauth: authStatus === 'ok' });
        if (authStatus) {
          const currentUrl = stripAuthQueryParams(resolveQuarantineUrl());
          globalThis.history?.replaceState?.({}, '', currentUrl.toString());
        }
        if (!isAuthenticated) {
          currentDataMode = 'live';
          restoreEnabled = false;
          approveEnabled = false;
          currentEntries = [];
          currentSuggestions = [];
          renderMeta({ generatedAt: new Date().toISOString() });
          renderRows();
          emptyState('Sign in as an admin to view quarantined sources.');
          await loadAudit({ generatedAt: new Date().toISOString(), count: 0, sources: [] });
          return;
        }
        let payload;
        try {
          payload = await fetchLivePayloadWithFailover();
          currentDataMode = 'live';
          if (typeof payload?.restoreAvailable === 'boolean') {
            restoreEnabled = payload.restoreAvailable;
            if (!restoreEnabled) {
              console.warn('Quarantine API reported restore is unavailable; keeping UI in live read-only mode.');
            }
          } else {
            const probe = await probeRestoreApi();
            restoreEnabled = probe.reachable;
            if (!probe.reachable) {
              console.warn('Restore API probe marked backend as unreachable; keeping quarantine UI in live read-only mode.', probe);
            }
          }
        } catch (primaryError) {
          if (primaryError && primaryError.status === 401) {
            throw primaryError;
          }
          console.warn('Failed to load live quarantine API; falling back to static snapshot in read-only mode.', {
            error: serializeError(primaryError)
          });
          payload = await fetchPayload(LOCAL_DATA_URL, 'Failed to load local quarantine snapshot.');
          currentDataMode = 'snapshot';
          restoreEnabled = false;
          approveEnabled = false;
        }
        currentEntries = Array.isArray(payload.sources) ? payload.sources : [];
        currentSuggestions = Array.isArray(payload.sourceRequests) ? payload.sourceRequests : [];
        approveEnabled = restoreEnabled;
        renderMeta(payload);
        renderRows();
        await loadAudit(payload);
      } catch (error) {
        emptyState(explainError(error));
        await loadAudit({ generatedAt: new Date().toISOString(), count: 0, sources: [] });
      }
    }

    body.addEventListener('click', async (event) => {
      const restoreButton = event.target.closest('button[data-action="restore"]');
      if (restoreButton) {
        const row = restoreButton.closest('tr[data-source-id]');
        if (!row) return;
        await restoreSourceRow(row);
        return;
      }
      const approveButton = event.target.closest('button[data-action="approve"]');
      if (approveButton) {
        const row = approveButton.closest('tr[data-request-id]');
        if (!row) return;
        await approveSourceRow(row);
      }
    });

    body.addEventListener('keydown', async (event) => {
      const input = event.target.closest('.url-input');
      if (!input || event.key !== 'Enter') return;
      const row = input.closest('tr[data-source-id]');
      if (!row) return;
      event.preventDefault();
      await restoreSourceRow(row);
    });

    body.addEventListener('blur', (event) => {
      const input = event.target.closest('.url-input');
      if (!input) return;
      syncUrlInputState(input);
    }, true);

    loadEntries();
    globalThis.addEventListener('pageshow', (event) => {
      if (!event?.persisted) return;
      if (authState.authenticated) return;
      loadEntries();
    });
  </script>
</body>
</html>
`;
}

function remediationActionForCategory(category) {
  if (category === 'not-found-404') return 'move source to quarantine and replace endpoint with current live URL';
  if (category === 'dead-or-moved-url') return 'replace endpoint with current feed/listing URL';
  if (category === 'moved-temporarily') return 'update source endpoint to redirected final URL';
  if (category === 'blocked-or-auth' || category === 'anti-bot-protection') return 'downgrade to non-bot-protected endpoint or quarantine if no public feed';
  if (category === 'brittle-selectors-or-js-rendering') return 'switch to known stable RSS/Atom if available or adjust parser selector';
  if (category === 'network-failure' || category === 'timeout') return 'retry later and monitor domain circuit-breaker/failure trend';
  return 'manual source review';
}

function remediationRankScore(category) {
  if (category === 'not-found-404') return 5;
  if (category === 'dead-or-moved-url') return 4;
  if (category === 'moved-temporarily') return 3;
  if (category === 'blocked-or-auth' || category === 'anti-bot-protection') return 2;
  if (category === 'brittle-selectors-or-js-rendering') return 2;
  return 1;
}

function buildSourceRemediationSweep({ generatedAt, sourceErrors, sourceStats }) {
  const statsById = new Map(
    (Array.isArray(sourceStats) ? sourceStats : [])
      .map((stat) => [clean(stat?.id), stat])
      .filter(([id]) => id)
  );

  const entries = (Array.isArray(sourceErrors) ? sourceErrors : []).map((error) => {
    const id = clean(error?.id);
    const stat = statsById.get(id) || null;
    const category = clean(error?.category) || 'unknown';
    const endpoint = clean(error?.endpoint);
    const finalUrl = clean(error?.finalUrl || stat?.finalUrl || '');
    const movedCandidate = finalUrl && endpoint && finalUrl !== endpoint;
    const effectiveCategory = movedCandidate && category !== 'dead-or-moved-url'
      ? 'moved-temporarily'
      : category;
    return {
      id,
      provider: clean(error?.provider),
      endpoint,
      finalUrl: movedCandidate ? finalUrl : '',
      category: effectiveCategory,
      statusKind: clean(stat?.statusKind),
      message: clean(error?.message),
      status: Number.isFinite(Number(error?.status ?? stat?.status)) ? Number(error?.status ?? stat?.status) : null,
      rankScore: remediationRankScore(effectiveCategory) + (movedCandidate ? 1 : 0),
      suggestedAction: remediationActionForCategory(effectiveCategory),
      replacementCandidate: movedCandidate ? finalUrl : fallbackReplacementUrl(error),
      sourceKind: clean(stat?.kind),
      sourceLane: clean(stat?.lane),
      sourceRegion: clean(stat?.region),
      isMachineReadable: isMachineReadableSourceKind(clean(stat?.kind))
    };
  });

  const dedupedById = new Map();
  for (const entry of entries) {
    const key = entry.id || `${entry.endpoint}|${entry.category}`;
    const existing = dedupedById.get(key);
    if (!existing || entry.rankScore > existing.rankScore) dedupedById.set(key, entry);
  }
  const sorted = [...dedupedById.values()].sort((left, right) => {
    if (right.rankScore !== left.rankScore) return right.rankScore - left.rankScore;
    return left.id.localeCompare(right.id);
  });

  return {
    generatedFrom: 'live-alerts.json',
    generatedAt,
    totalSourceErrors: entries.length,
    byCategory: sorted.reduce((acc, entry) => {
      acc[entry.category] = (acc[entry.category] || 0) + 1;
      return acc;
    }, {}),
    // byKind summarizes remediation workload split by source transport kind (rss/atom/json/html).
    byKind: sorted.reduce((acc, entry) => {
      const kind = clean(entry.sourceKind) || 'unknown';
      acc[kind] = (acc[kind] || 0) + 1;
      return acc;
    }, {}),
    machineReadableErrorCount: sorted.filter((entry) => entry.isMachineReadable).length,
    htmlErrorCount: sorted.filter((entry) => !entry.isMachineReadable).length,
    top20: sorted.slice(0, 20),
    sources: sorted
  };
}

async function syncBuilderSQLite(snapshot) {
  const helperPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'build-live-feed', 'sqlite-sync.py');
  const tempPath = path.join(os.tmpdir(), `brialert-sqlite-sync-${Date.now()}-${process.pid}.json`);
  const payload = {
    ...snapshot,
    sqlitePath
  };

  await fs.writeFile(tempPath, JSON.stringify(payload, null, 2), 'utf8');
  const pythonCommands = process.platform === 'win32'
    ? [['py', ['-3', helperPath, tempPath]], ['python', [helperPath, tempPath]]]
    : [['python3', [helperPath, tempPath]], ['python', [helperPath, tempPath]]];

  let lastError = null;
  try {
    for (const [command, args] of pythonCommands) {
      try {
        await execFile(command, args, { windowsHide: true });
        return;
      } catch (error) {
        lastError = error;
      }
    }
  } finally {
    await fs.unlink(tempPath).catch(() => {});
  }

  if (lastError) {
    throw lastError;
  }
}

async function main() {
  const runStartedAtMs = Date.now();
  const CONTINUATION_RUNTIME_HEADROOM_MS = 20_000;
  const buildDate = new Date();
  const existing = await readExisting();
  const geoLookupFallbackNote = await safeLoadGeoLookup(existing);
  const previousHealth = existing?.health && typeof existing.health === 'object' ? existing.health : null;
  const restoreAudit = (await safeLoadRestoreAudit()) || existing?.restoreAudit || null;

  let sources;
  try {
    sources = normaliseSourcesPayload(await readJsonFile(sourcePath));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Source catalog load failed: ${message}`);
    if (existing) {
      const generatedAt = new Date().toISOString();
      const buildWarning = `Source catalog load failed; preserved previous alerts. ${message}`;
      const fallbackPayload = {
        ...existing,
        generatedAt,
        buildWarning,
        restoreAudit,
        sourceErrors: [
          {
            id: 'sources-json',
            provider: 'Brialert builder',
            endpoint: sourcePath,
            message
          }
        ],
        health: buildHealthBlock({
          generatedAt,
          checked: Number(existing?.sourceCount || 0),
          sourceErrors: [{ message }],
          buildWarning,
          previousHealth: existing?.health,
          successfulRefresh: false,
          usedFallback: true
        })
      };
      await fs.writeFile(outputPath, JSON.stringify(fallbackPayload, null, 2) + '\n', 'utf8');
      console.log('Preserved previous live-alerts.json because sources.json could not be loaded.');
      return;
    }
    throw error;
  }

  try {
    const requestedSources = normaliseSourceRequestsPayload(await readJsonFile(sourceRequestsPath));
    if (requestedSources.length) {
      console.log(`Loaded ${requestedSources.length} pending source request(s). Manual approval required before activation.`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Source request catalog load skipped: ${message}`);
  }

  const items = [];
  const sourceErrors = [];
  const sourceStats = [];
  const autoDeferredSources = [];
  const cooldownDeferredSourceIds = new Set();
  const cadenceDeferredSources = [];
  const eligibleSources = sources.filter((source) => {
    if (!sourceLooksEnglish(source)) return false;
    if (source?.quarantined) {
      console.warn(`Skipping quarantined source: ${source.id}`);
      return false;
    }
    if (HARD_SKIP_SOURCE_IDS.has(source.id)) {
      console.warn(`Skipping disabled source: ${source.id}`);
      return false;
    }
    return true;
  });
  const scheduledSources = eligibleSources.filter((source) => {
    const priorEntry = sourceHealthEntry(previousHealth, source.id);
    const autoCooldown = sourceMayAutoCooldown(source, priorEntry, buildDate);
    if (autoCooldown) {
      autoDeferredSources.push({
        id: source.id,
        provider: source.provider,
        reason: autoCooldown.reason,
        until: autoCooldown.until,
        statusKind: 'cooled_down'
      });
      cooldownDeferredSourceIds.add(source.id);
      return false;
    }
    const scheduledThisRun = shouldRefreshSourceThisRun(source, buildDate, priorEntry);
    if (!scheduledThisRun) cadenceDeferredSources.push(source);
    return scheduledThisRun;
  });
  const rankedScheduledSources = scheduledSources
    .map((source, index) => ({
      source,
      index,
      priority: sourceSchedulingPriority(source)
    }))
    .sort((left, right) => {
      if (right.priority !== left.priority) return right.priority - left.priority;
      return left.index - right.index;
    });
  const machineReadableScheduled = rankedScheduledSources
    .filter((entry) => isMachineReadableSourceKind(entry.source?.kind))
    .map((entry) => entry.source);
  const htmlRankedEntries = rankedScheduledSources.filter((entry) => entry.source?.kind === 'html');
  const htmlBudget = SCHEDULER_MODE === 'control' ? CONTROL_MAX_HTML_SOURCES_PER_RUN : MAX_HTML_SOURCES_PER_RUN;
  const htmlSelection = selectHtmlSourcesForRun(htmlRankedEntries, buildDate, htmlBudget);
  const htmlScheduled = htmlSelection.selected;
  const playwrightBudget = {
    attempts: 0,
    successes: 0,
    maxAttempts: PLAYWRIGHT_FALLBACK_MAX_ATTEMPTS_PER_RUN
  };
  const scheduledSourceIds = new Set([...machineReadableScheduled, ...htmlScheduled].map((source) => source.id));
  const scheduledSourcesInitial = [...machineReadableScheduled, ...htmlScheduled];
  const htmlDeferredForBudget = scheduledSources.filter((source) => source?.kind === 'html' && !scheduledSourceIds.has(source.id));
  const continuationOversamplingFactor = 2;
  const htmlDeferredReasonById = new Map();
  for (const source of htmlDeferredForBudget) {
    htmlDeferredReasonById.set(source.id, htmlSelection.domainCappedSourceIds.has(source.id) ? 'domain-cap' : 'html-budget');
  }

  const continuationCandidatesById = new Map();
  for (const source of [...htmlDeferredForBudget, ...cadenceDeferredSources]) {
    if (scheduledSourceIds.has(source.id) || cooldownDeferredSourceIds.has(source.id)) continue;
    if (!continuationCandidatesById.has(source.id)) {
      continuationCandidatesById.set(source.id, { source, index: continuationCandidatesById.size });
    }
  }
  const continuationCandidates = [...continuationCandidatesById.values()]
    .sort((left, right) => {
      const priorityDelta = sourceSchedulingPriority(right.source) - sourceSchedulingPriority(left.source);
      if (priorityDelta !== 0) return priorityDelta;
      return left.index - right.index;
    })
    .map((entry) => entry.source);

  let checked = 0;
  let sourceAttemptOffset = 0;
  let sourcesAttemptedCount = 0;
  const requestState = {
    conditionalCache: {},
    domainState: {}
  };
  const sourceById = new Map(
    Array.isArray(sources) ? sources.map((entry) => [entry?.id, entry]).filter(([id]) => id) : []
  );

  async function processSourceBatch(batch) {
    if (!batch.length) return;
    const sourceResults = await mapWithConcurrency(
      batch,
      FEED_SOURCE_CONCURRENCY,
      async (source, sourceIndex) => {
        const localErrors = [];
        const builtAlerts = [];
        const failureReasonCounts = {
          success: 0,
          unchanged: 0,
          'stale-endpoint': 0,
          'blocked-or-anti-bot': 0,
          'timeout-or-aborted': 0,
          'parser-failure': 0,
          'empty-or-no-items': 0,
          unknown: 0
        };
        const discardReasons = {
          parseNoItems: 0,
          droppedByFilter: 0,
          droppedByMissingOrInvalidDate: 0,
          droppedByItemCap: 0,
          buildFailures: 0
        };

        try {
          const baseDelay = (sourceAttemptOffset + sourceIndex) * DEFAULT_FETCH_STAGGER_MS;
          const jitter = MAX_FETCH_STAGGER_JITTER_MS > 0
            ? Math.floor(Math.random() * (MAX_FETCH_STAGGER_JITTER_MS + 1))
            : 0;
          await sleep(baseDelay + jitter);
          let body;
          let usedPlaywrightFallback = false;
          let finalUrl = clean(source?.endpoint);
          let responseStatus = null;
          let fetchOutcome = 'unknown';
          try {
            const fetched = await fetchText(source.endpoint, 1, { source, requestState, includeMeta: true });
            if (typeof fetched === 'string') {
              body = fetched;
              fetchOutcome = 'success';
            } else {
              body = fetched.text;
              finalUrl = clean(fetched.finalUrl || source.endpoint);
              responseStatus = Number.isFinite(Number(fetched.status)) ? Number(fetched.status) : null;
              fetchOutcome = (responseStatus === 304 || fetched.unchanged304) ? 'unchanged' : 'success';
            }
          } catch (error) {
            const summary = summariseSourceError(source, error);
            const reason = classifyFetchFailure(summary);
            if (reason === 'stale-endpoint') failureReasonCounts['stale-endpoint'] += 1;
            else if (reason === 'bot-block') failureReasonCounts['blocked-or-anti-bot'] += 1;
            else if (reason === 'timeout') failureReasonCounts['timeout-or-aborted'] += 1;
            if (shouldTryPlaywrightFallback(source, summary, playwrightBudget)) {
              playwrightBudget.attempts += 1;
              body = await fetchTextWithPlaywright(source.endpoint, {
                source,
                timeoutMs: PLAYWRIGHT_FALLBACK_TIMEOUT_MS
              });
              usedPlaywrightFallback = true;
              playwrightBudget.successes += 1;
              fetchOutcome = 'success';
            } else {
              throw error;
            }
          }
          let parsed = source.kind === 'rss' || source.kind === 'atom' || source.kind === 'json'
            ? parseFeedItems(source, body)
            : parseHtmlItems(source, body);
          if (!parsed.length && source.kind === 'html' && !usedPlaywrightFallback && shouldTryPlaywrightForThinHtml(source, body, playwrightBudget)) {
            try {
              playwrightBudget.attempts += 1;
              body = await fetchTextWithPlaywright(source.endpoint, {
                source,
                timeoutMs: PLAYWRIGHT_FALLBACK_TIMEOUT_MS,
                contentSelectors: source?.playwright?.contentSelectors
              });
              usedPlaywrightFallback = true;
              playwrightBudget.successes += 1;
              parsed = parseHtmlItems(source, body);
            } catch (error) {
              // fall through to normal empty parse handling
            }
          }
          if (!parsed.length) {
            discardReasons.parseNoItems += 1;
            if (fetchOutcome !== 'unchanged') {
              failureReasonCounts['empty-or-no-items'] += 1;
            }
            localErrors.push(summariseSourceError(
              source,
              buildFetchError('No items parsed from source payload', 'brittle-selectors-or-js-rendering')
            ));
          }
          const preLimit = source.kind === 'html' ? MAX_HTML_PREFETCH_ITEMS : MAX_FEED_PREFETCH_ITEMS;
          const preLimited = parsed.slice(0, preLimit);
          const hydrated = source.kind === 'html' ? await enrichHtmlItems(source, preLimited) : preLimited;
          const reliabilityProfile = inferReliabilityProfile(source, inferSourceTier(source));
          const itemLimit = reliabilityProfile === 'tabloid'
            ? SOURCE_ITEM_LIMITS.tabloid
            : SOURCE_ITEM_LIMITS[source.lane] || SOURCE_ITEM_LIMITS.default;
          const filtered = hydrated.filter((item) => {
            try {
              const discardReason = discardReasonForItem(source, item);
              if (discardReason === 'missing-or-invalid-date') {
                discardReasons.droppedByMissingOrInvalidDate += 1;
              }
              return discardReason === null;
            } catch (error) {
              localErrors.push(summariseSourceError(source, error));
              console.error(`Source item filter failed: ${source.id} - ${error instanceof Error ? error.message : String(error)}`);
              return false;
            }
          });
          const kept = filtered.slice(0, itemLimit);
          discardReasons.droppedByFilter += Math.max(0, hydrated.length - filtered.length);
          discardReasons.droppedByItemCap += Math.max(0, filtered.length - kept.length);

          kept.forEach((item, idx) => {
            try {
              builtAlerts.push(buildAlert(source, item, idx));
            } catch (error) {
              localErrors.push(summariseSourceError(source, error));
              discardReasons.buildFailures += 1;
              console.error(`Alert build failed: ${source.id} - ${error instanceof Error ? error.message : String(error)}`);
            }
          });
          const parserFailures = localErrors
            .map((errorSummary) => classifyFetchFailure(errorSummary))
            .filter((reason) => reason === 'parser-failure').length;
          if (parserFailures > 0) failureReasonCounts['parser-failure'] += parserFailures;
          if (fetchOutcome === 'unchanged') {
            failureReasonCounts.unchanged += 1;
          } else if (builtAlerts.length > 0) {
            failureReasonCounts.success += 1;
          }

          return {
            checked: 1,
            alerts: builtAlerts,
            sourceErrors: localErrors,
            sourceStat: {
              id: source.id,
              provider: source.provider,
              lane: source.lane,
              kind: source.kind,
              parsed: parsed.length,
              hydrated: hydrated.length,
              filtered: filtered.length,
              kept: kept.length,
              built: builtAlerts.length,
              errors: localErrors.length,
              lastErrorCategory: localErrors[0]?.category || null,
              lastErrorMessage: localErrors[0]?.message || null,
              usedPlaywrightFallback,
              finalUrl,
              status: responseStatus,
              fetchOutcome,
              failureReasonCounts,
              discardReasons
            }
          };
        } catch (error) {
          const summary = summariseSourceError(source, error);
          localErrors.push(summary);
          const reason = classifyFetchFailure(summary);
          if (reason === 'stale-endpoint') failureReasonCounts['stale-endpoint'] += 1;
          else if (reason === 'bot-block') failureReasonCounts['blocked-or-anti-bot'] += 1;
          else if (reason === 'timeout') failureReasonCounts['timeout-or-aborted'] += 1;
          else if (reason === 'parser-failure') failureReasonCounts['parser-failure'] += 1;
          else if (reason === 'unknown') {
            failureReasonCounts.unknown += 1;
            console.warn(`Unclassified source failure category: ${summary.id} [${source.kind}/${source.lane}] - ${summary.message}`);
          } else {
            failureReasonCounts['timeout-or-aborted'] += 1;
            console.warn(`Unhandled source failure reason mapped to timeout-or-aborted: ${reason} (${summary.id})`);
          }
          const fallbackIds = Array.isArray(source?.fallbackSourceIds) ? source.fallbackSourceIds : [];
          for (const fallbackId of fallbackIds) {
            const fallbackSource = sourceById.get(fallbackId);
            if (!fallbackSource) continue;
            try {
              const fallbackResult = await attemptSourceBuild(fallbackSource, requestState, playwrightBudget);
              if (!fallbackResult.alerts.length) continue;
              failureReasonCounts.success += 1;
              return {
                checked: 1,
                alerts: fallbackResult.alerts,
                sourceErrors: [...localErrors, ...fallbackResult.sourceErrors],
                sourceStat: {
                  ...fallbackResult.sourceStat,
                  id: source.id,
                  provider: source.provider,
                  lane: source.lane,
                  kind: source.kind,
                  usedFallbackSource: true,
                  fallbackSourceId: fallbackSource.id,
                  fallbackProvider: fallbackSource.provider,
                  failureReasonCounts,
                  discardReasons
                }
              };
            } catch (fallbackError) {
              localErrors.push(summariseSourceError(fallbackSource, fallbackError));
            }
          }
          console.error(`Source failed: ${summary.id} [${source.kind}/${source.lane}] - ${summary.message}`);
          return {
            checked: 0,
            alerts: [],
            sourceErrors: localErrors,
            sourceStat: {
              id: source.id,
              provider: source.provider,
              lane: source.lane,
              kind: source.kind,
              parsed: 0,
              hydrated: 0,
              filtered: 0,
              kept: 0,
              built: 0,
              errors: localErrors.length,
              lastErrorCategory: localErrors[0]?.category || null,
              lastErrorMessage: localErrors[0]?.message || null,
              usedPlaywrightFallback: false,
              finalUrl: clean(source?.endpoint),
              status: null,
              fetchOutcome: 'failed',
              failureReasonCounts,
              discardReasons
            }
          };
        }
      }
    );
    sourceAttemptOffset += batch.length;
    sourcesAttemptedCount += batch.length;
    for (const result of sourceResults) {
      checked += result.checked || 0;
      if (Array.isArray(result.alerts) && result.alerts.length) items.push(...result.alerts);
      if (Array.isArray(result.sourceErrors) && result.sourceErrors.length) sourceErrors.push(...result.sourceErrors);
      if (result.sourceStat) sourceStats.push(result.sourceStat);
    }
  }

  await processSourceBatch(scheduledSourcesInitial);

  let successfulSourcesFound = sourceStats.filter((stat) => stat.built > 0).length;
  while (
    successfulSourcesFound < TARGET_SUCCESSFUL_SOURCES_PER_RUN
    && continuationCandidates.length
  ) {
    const elapsed = Date.now() - runStartedAtMs;
    if (elapsed >= Math.max(0, GUARDRAIL_MAX_RUNTIME_MS - CONTINUATION_RUNTIME_HEADROOM_MS)) {
      break;
    }
    const remainingNeeded = TARGET_SUCCESSFUL_SOURCES_PER_RUN - successfulSourcesFound;
    // Oversample remaining candidates because many source attempts fail or return zero built alerts.
    const nextBatchSize = Math.min(
      continuationCandidates.length,
      Math.max(FEED_SOURCE_CONCURRENCY, remainingNeeded * continuationOversamplingFactor)
    );
    const nextBatch = continuationCandidates.splice(0, nextBatchSize);
    await processSourceBatch(nextBatch);
    successfulSourcesFound = sourceStats.filter((stat) => stat.built > 0).length;
  }

  for (const source of continuationCandidates) {
    autoDeferredSources.push({
      id: source.id,
      provider: source.provider,
      reason: htmlDeferredReasonById.get(source.id) || 'refresh-cadence',
      until: null
    });
  }

  const preDedupeCount = items.length;
  const deduped = dedupeAndSortAlerts(items);
  const dedupeDropped = Math.max(0, preDedupeCount - deduped.length);
  const existingAlerts = Array.isArray(existing?.alerts) ? existing.alerts : [];
  const preservedAlerts = !deduped.length && sourceErrors.length && existingAlerts.length;
  const mergedCandidates = dedupeAndSortAlerts([...deduped, ...existingAlerts]);
  const finalAlerts = preservedAlerts ? existingAlerts : selectStoredAlerts(mergedCandidates, MAX_STORED_ALERTS);
  const sourceOutcomeTally = sourceStats.reduce((acc, stat) => {
    if ((stat?.built || 0) > 0) {
      acc.successfulSources += 1;
      if (stat.fetchOutcome === 'success') acc.updatedSources += 1;
    } else if ((stat?.errors || 0) > 0) {
      acc.failedSources += 1;
    } else {
      acc.emptySources += 1;
    }
    if (stat?.fetchOutcome === 'unchanged') acc.unchangedSources += 1;
    return acc;
  }, {
    successfulSources: 0,
    failedSources: 0,
    emptySources: 0,
    unchangedSources: 0,
    updatedSources: 0
  });
  const {
    successfulSources,
    failedSources,
    emptySources,
    unchangedSources,
    updatedSources
  } = sourceOutcomeTally;
  const sourceRunStats = {
    totalConfiguredSources: sources.length,
    sourcesCheckedThisRun: sourcesAttemptedCount,
    sourcesUpdatedThisRun: updatedSources,
    sourcesFailedThisRun: failedSources,
    sourcesUnchangedThisRun: unchangedSources
  };
  const droppedByFilter = sourceStats.reduce((sum, stat) => sum + (stat.discardReasons?.droppedByFilter || 0), 0);
  const droppedByMissingOrInvalidDate = sourceStats.reduce((sum, stat) => sum + (stat.discardReasons?.droppedByMissingOrInvalidDate || 0), 0);
  const droppedByItemCap = sourceStats.reduce((sum, stat) => sum + (stat.discardReasons?.droppedByItemCap || 0), 0);
  const droppedByBuildFailures = sourceStats.reduce((sum, stat) => sum + (stat.discardReasons?.buildFailures || 0), 0);
  const topFailingSources = sourceStats
    .filter((stat) => stat.errors > 0)
    .sort((a, b) => b.errors - a.errors)
    .slice(0, MAX_FAILING_SOURCES_TO_LOG)
    .map((stat) => `${stat.id}(${stat.errors})`)
    .join(', ');
  const failuresByCategory = sourceErrors.reduce((acc, err) => {
    const category = err?.category || 'unknown';
    acc[category] = (acc[category] || 0) + 1;
    return acc;
  }, {});
  const failingCategorySummary = Object.entries(failuresByCategory)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([category, count]) => `${category}:${count}`)
    .join(', ');
  const runDurationMs = Date.now() - runStartedAtMs;
  const failedRate = sourcesAttemptedCount
    ? failedSources / sourcesAttemptedCount
    : 0;
  const guardrailViolations = [];
  if (runDurationMs > GUARDRAIL_MAX_RUNTIME_MS) guardrailViolations.push('runtime-exceeded');
  if (failedRate > GUARDRAIL_MAX_FAILED_SOURCE_RATE) guardrailViolations.push('failure-rate-exceeded');
  if (successfulSources < GUARDRAIL_MIN_SUCCESSFUL_SOURCES) guardrailViolations.push('successful-source-floor-breached');
  const guardrailMessage = guardrailViolations.length
    ? `Guardrails breached: ${guardrailViolations.join(', ')} (runtime=${runDurationMs}ms, failedRate=${failedRate.toFixed(3)}, successfulSources=${successfulSources})`
    : null;
  const buildWarning = [
    geoLookupFallbackNote,
    autoDeferredSources.length ? `Deferred ${autoDeferredSources.length} low-yield source(s) on health cooldown.` : null,
    preservedAlerts ? 'Build produced no fresh alerts; preserved previous alert set.' : null,
    guardrailMessage
  ].filter(Boolean).join(' | ') || null;
  const generatedAt = new Date().toISOString();
  const nextSourceHealth = {};
  const sourceStatsById = new Map(sourceStats.map((stat) => [stat.id, stat]));

  for (const source of eligibleSources) {
    const priorEntry = sourceHealthEntry(previousHealth, source.id);
    const deferred = autoDeferredSources.find((entry) => entry.id === source.id);
    if (deferred) {
      const quarantineRecheckAt = deferred.reason === 'review-quarantine' && priorEntry?.quarantinedAt
        ? new Date(Date.parse(priorEntry.quarantinedAt) + AUTO_QUARANTINE_RECHECK_HOURS * 3600000).toISOString()
        : null;
      const deferredNextFetchAt = deferred.until
        || quarantineRecheckAt
        || sourceScheduleNextFetchAt(source, buildDate, priorEntry, true);
      nextSourceHealth[source.id] = {
        ...(priorEntry || {}),
        provider: source.provider,
        lane: source.lane,
        kind: source.kind,
        quarantined: deferred.reason === 'review-quarantine' ? true : Boolean(priorEntry?.quarantined),
        quarantinedAt: priorEntry?.quarantinedAt || null,
        quarantineReason: deferred.reason === 'review-quarantine'
          ? clean(priorEntry?.quarantineReason || 'Needs manual review')
          : (priorEntry?.quarantineReason || null),
        autoSkipReason: deferred.reason,
        cooldownUntil: deferred.until,
        lastDeferredAt: generatedAt,
        nextFetchAt: deferredNextFetchAt
      };
      continue;
    }

    const stat = sourceStatsById.get(source.id);
    if (!stat) {
      nextSourceHealth[source.id] = {
        ...(priorEntry || {}),
        provider: source.provider,
        lane: source.lane,
        kind: source.kind,
        autoSkipReason: null,
        nextFetchAt: sourceScheduleNextFetchAt(source, buildDate, priorEntry, true)
      };
      continue;
    }

    nextSourceHealth[source.id] = nextSourceHealthEntry(source, stat, priorEntry, generatedAt);
  }

  const failureReasons = sourceStats.reduce((acc, stat) => {
    const reasonCounts = stat?.failureReasonCounts || {};
    for (const [reason, count] of Object.entries(reasonCounts)) {
      if (!Number.isFinite(Number(count)) || Number(count) <= 0) continue;
      acc[reason] = (acc[reason] || 0) + Number(count);
    }
    return acc;
  }, {});
  const nowMs = Date.now();
  const eligibleSourceById = new Map(eligibleSources.map((source) => [source.id, source]));
  const freshnessByTier = Object.entries(nextSourceHealth).reduce((acc, [sourceId, entry]) => {
    const source = eligibleSourceById.get(sourceId) || entry;
    const tier = schedulingTier(source);
    const minutes = freshnessMinutes(entry, nowMs);
    if (minutes === null) return acc;
    if (!acc[tier]) acc[tier] = [];
    acc[tier].push(minutes);
    return acc;
  }, {});
  const freshnessSlaByTier = Object.fromEntries(
    Object.entries(freshnessByTier).map(([tier, values]) => {
      const sorted = [...values].sort((a, b) => a - b);
      const p95Index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
      return [tier, {
        count: sorted.length,
        avgMinutes: Math.round(sorted.reduce((sum, value) => sum + value, 0) / Math.max(sorted.length, 1)),
        p95Minutes: sorted[p95Index]
      }];
    })
  );
  const coverage = {
    eligible: eligibleSources.length,
    scheduled: sourcesAttemptedCount,
    initialScheduled: scheduledSourcesInitial.length,
    continuationAttempted: Math.max(0, sourcesAttemptedCount - scheduledSourcesInitial.length),
    checked,
    eligibleCheckedRate: eligibleSources.length ? Number((checked / eligibleSources.length).toFixed(3)) : 0,
    scheduledCheckedRate: sourcesAttemptedCount ? Number((checked / sourcesAttemptedCount).toFixed(3)) : 0
  };

  const payload = {
    generatedAt,
    sourceCount: checked,
    alertCount: finalAlerts.length,
    alerts: finalAlerts,
    sourceErrors: sourceErrors.slice(0, MAX_SOURCE_ERRORS_TO_REPORT),
    restoreAudit,
    geoLookupSnapshot: geoLookupSnapshot(),
    buildWarning,
    runMetrics: {
      schedulerMode: SCHEDULER_MODE,
      htmlBudget,
      htmlDomainCapPerRun: HTML_DOMAIN_CAP_PER_RUN,
      htmlDomainUsage: htmlSelection.domainUsage,
      coverage,
      freshnessSlaByTier,
      failureReasons,
      sourceRunStats,
      runDurationMs,
      playwrightFallback: {
        attempts: playwrightBudget.attempts,
        successes: playwrightBudget.successes,
        maxAttempts: playwrightBudget.maxAttempts,
        timeoutMs: PLAYWRIGHT_FALLBACK_TIMEOUT_MS
      },
      guardrails: {
        maxRuntimeMs: GUARDRAIL_MAX_RUNTIME_MS,
        maxFailedSourceRate: GUARDRAIL_MAX_FAILED_SOURCE_RATE,
        minSuccessfulSources: GUARDRAIL_MIN_SUCCESSFUL_SOURCES,
        targetSuccessfulSourcesPerRun: TARGET_SUCCESSFUL_SOURCES_PER_RUN,
        failedSourceRate: Number(failedRate.toFixed(3)),
        successfulSources,
        violations: guardrailViolations
      }
    },
    health: buildHealthBlock({
      generatedAt,
      checked,
      sourceErrors,
      buildWarning,
      previousHealth,
      successfulRefresh: !preservedAlerts,
      usedFallback: preservedAlerts || Boolean(geoLookupFallbackNote),
      sourceHealth: nextSourceHealth,
      autoDeferredSources,
      sourceRunStats,
      extraMetrics: {
        schedulerMode: SCHEDULER_MODE,
        coverage,
        freshnessSlaByTier,
        failureReasons,
        sourceRunStats,
        playwrightFallback: {
          attempts: playwrightBudget.attempts,
          successes: playwrightBudget.successes
        },
        guardrailViolations
      }
    })
  };
  const sqliteSnapshot = {
    generatedAt,
    sourceHealth: nextSourceHealth,
    sourceStats,
    alertChurn: buildAlertChurnRows(existing?.alerts || [], payload.alerts)
  };
  const remediationSweep = buildSourceRemediationSweep({
    generatedAt,
    sourceErrors,
    sourceStats
  });
  const quarantinedEntries = buildQuarantinedSourceEntries(sources, nextSourceHealth);
  const quarantinedPayload = {
    generatedAt,
    count: quarantinedEntries.length,
    sources: quarantinedEntries
  };

  try {
    await syncBuilderSQLite(sqliteSnapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`SQLite sync skipped: ${message}`);
  }

  const currentComparable = JSON.stringify(existing?.alerts || []);
  const nextComparable = JSON.stringify(payload.alerts);
  const hasExistingAlertsSnapshot = Array.isArray(existing?.alerts);
  const existingRuntimeMs = Number(existing?.runMetrics?.runDurationMs || 0);
  const forceFeedWrite = clean(process.env.BRIALERT_FORCE_FEED_WRITE).toLowerCase() === 'true';

  if (hasExistingAlertsSnapshot && currentComparable === nextComparable && !sourceErrors.length && !geoLookupFallbackNote && !forceFeedWrite) {
    if (Number.isFinite(existingRuntimeMs) && existingRuntimeMs > GUARDRAIL_MAX_RUNTIME_MS) {
      console.log(`No alert changes detected, refreshing feed metadata because previous runDurationMs=${existingRuntimeMs} exceeds guardrail=${GUARDRAIL_MAX_RUNTIME_MS}.`);
    } else {
      console.log('No alert changes detected.');
      return;
    }
  } else if (forceFeedWrite && hasExistingAlertsSnapshot && currentComparable === nextComparable) {
    console.log('Force writing feed output despite unchanged alerts.');
  }

  await fs.writeFile(outputPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  await fs.writeFile(quarantinedSourcesPath, JSON.stringify(quarantinedPayload, null, 2) + '\n', 'utf8');
  await fs.writeFile(quarantinedSourcesReviewPath, renderQuarantinedSourcesHtml(generatedAt, quarantinedEntries), 'utf8');
  await fs.writeFile(sourceRemediationSweepPath, JSON.stringify(remediationSweep, null, 2) + '\n', 'utf8');
  await fs.writeFile(topSourceRemediationPath, JSON.stringify({
    generatedFrom: remediationSweep.generatedFrom,
    generatedAt: remediationSweep.generatedAt,
    totalSourceErrors: remediationSweep.totalSourceErrors,
    top20: remediationSweep.top20
  }, null, 2) + '\n', 'utf8');
  console.log([
    'Feed build summary:',
    `eligible=${eligibleSources.length}`,
    `scheduled=${sourcesAttemptedCount}`,
    `initialScheduled=${scheduledSourcesInitial.length}`,
    `continuationAttempted=${Math.max(0, sourcesAttemptedCount - scheduledSourcesInitial.length)}`,
    `deferred=${Math.max(0, eligibleSources.length - sourcesAttemptedCount)}`,
    `cooldownDeferred=${autoDeferredSources.length}`,
    `checked=${checked}`,
    `unchanged=${unchangedSources}`,
    `updated=${updatedSources}`,
    `successfulWithAlerts=${successfulSources}`,
    `failed=${failedSources}`,
    `empty=${emptySources}`,
    `preDedupe=${preDedupeCount}`,
    `postDedupe=${deduped.length}`,
    `stored=${payload.alertCount}`,
    `quarantined=${quarantinedEntries.length}`,
    `droppedByDedupe=${dedupeDropped}`,
    `droppedByFilter=${droppedByFilter}`,
    `droppedByMissingOrInvalidDate=${droppedByMissingOrInvalidDate}`,
    `droppedByItemCap=${droppedByItemCap}`,
    `droppedByBuildFailures=${droppedByBuildFailures}`
  ].join(' | '));
  if (topFailingSources) {
    console.log(`Top failing sources by error count: ${topFailingSources}`);
  }
  if (failingCategorySummary) {
    console.log(`Failure categories: ${failingCategorySummary}`);
  }
  if (guardrailMessage) {
    console.error(`[guardrail] ${guardrailMessage}`);
  }
  if (FAIL_ON_GUARDRAIL_VIOLATION && guardrailViolations.length) {
    throw new Error(`Build failed on guardrail violation: ${guardrailViolations.join(', ')}`);
  }
  console.log(`Scheduler mode=${SCHEDULER_MODE} | htmlBudget=${htmlBudget} | coverage=${coverage.checked}/${coverage.eligible} | playwrightFallback=${playwrightBudget.successes}/${playwrightBudget.attempts} | guardrailViolations=${guardrailViolations.length}`);
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
