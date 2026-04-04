import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  AUTO_SKIP_EMPTY_THRESHOLD,
  AUTO_SKIP_FAILURE_THRESHOLD,
  FEED_SOURCE_CONCURRENCY,
  HARD_SKIP_SOURCE_IDS,
  MAX_FAILING_SOURCES_TO_LOG,
  MAX_FEED_PREFETCH_ITEMS,
  MAX_SOURCE_ERRORS_TO_REPORT,
  MAX_HTML_PREFETCH_ITEMS,
  MAX_STORED_ALERTS,
  SOURCE_EMPTY_COOLDOWN_HOURS,
  SOURCE_FAILURE_COOLDOWN_HOURS,
  SOURCE_ITEM_LIMITS,
  shouldRefreshSourceThisRun,
  outputPath,
  sourcePath,
  sourceRequestsPath
} from './build-live-feed/config.mjs';
import {
  buildAlert,
  dedupeAndSortAlerts,
  selectStoredAlerts,
  shouldKeepItem
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
  fetchText
} from './build-live-feed/io.mjs';
import {
  enrichHtmlItems,
  parseFeedItems,
  parseHtmlItems
} from './build-live-feed/parsing.mjs';
import {
  inferReliabilityProfile,
  inferSourceTier,
  sourceLooksEnglish
} from '../shared/taxonomy.mjs';

export { buildHealthBlock } from './build-live-feed/health.mjs';

function parseIsoMs(value) {
  const ms = new Date(value || '').getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function sourceHealthEntry(previousHealth, sourceId) {
  const sourceHealth = previousHealth?.sourceHealth;
  if (!sourceHealth || typeof sourceHealth !== 'object') return null;
  const entry = sourceHealth[sourceId];
  return entry && typeof entry === 'object' ? entry : null;
}

function sourceMayAutoCooldown(source, previousEntry, buildDate) {
  if (!previousEntry) return null;
  const cooldownUntilMs = parseIsoMs(previousEntry.cooldownUntil);
  if (!cooldownUntilMs || buildDate.getTime() >= cooldownUntilMs) return null;

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
    lastSuccessfulAt: prior.lastSuccessfulAt || null,
    lastFailureAt: prior.lastFailureAt || null,
    lastEmptyAt: prior.lastEmptyAt || null,
    cooldownUntil: null,
    autoSkipReason: null
  };

  if ((stat?.built || 0) > 0) {
    next.successfulRuns += 1;
    next.consecutiveFailures = 0;
    next.consecutiveEmptyRuns = 0;
    next.lastSuccessfulAt = generatedAt;
    return next;
  }

  if ((stat?.errors || 0) > 0) {
    next.failedRuns += 1;
    next.consecutiveFailures += 1;
    next.consecutiveEmptyRuns = 0;
    next.lastFailureAt = generatedAt;
    if (next.consecutiveFailures >= AUTO_SKIP_FAILURE_THRESHOLD) {
      next.cooldownUntil = new Date(Date.parse(generatedAt) + SOURCE_FAILURE_COOLDOWN_HOURS * 3600000).toISOString();
      next.autoSkipReason = 'failure-cooldown';
    }
    return next;
  }

  next.emptyRuns += 1;
  next.consecutiveEmptyRuns += 1;
  next.consecutiveFailures = 0;
  next.lastEmptyAt = generatedAt;
  if (!source.isTrustedOfficial && source.lane !== 'incidents' && next.consecutiveEmptyRuns >= AUTO_SKIP_EMPTY_THRESHOLD) {
    next.cooldownUntil = new Date(Date.parse(generatedAt) + SOURCE_EMPTY_COOLDOWN_HOURS * 3600000).toISOString();
    next.autoSkipReason = 'empty-cooldown';
  }
  return next;
}

async function main() {
  const buildDate = new Date();
  const existing = await readExisting();
  const geoLookupFallbackNote = await safeLoadGeoLookup(existing);
  const previousHealth = existing?.health && typeof existing.health === 'object' ? existing.health : null;

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
      sources = mergeSourceCatalogs(sources, requestedSources);
      console.log(`Merged ${requestedSources.length} requested source(s) into the active source catalog.`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Source request catalog load skipped: ${message}`);
  }

  const items = [];
  const sourceErrors = [];
  const sourceStats = [];
  const autoDeferredSources = [];
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
    const autoCooldown = sourceMayAutoCooldown(source, sourceHealthEntry(previousHealth, source.id), buildDate);
    if (autoCooldown) {
      autoDeferredSources.push({
        id: source.id,
        provider: source.provider,
        reason: autoCooldown.reason,
        until: autoCooldown.until
      });
      return false;
    }
    return shouldRefreshSourceThisRun(source, buildDate);
  });
  const deferredSources = Math.max(0, eligibleSources.length - scheduledSources.length);

  const sourceResults = await mapWithConcurrency(
    scheduledSources,
    FEED_SOURCE_CONCURRENCY,
    async (source, sourceIndex) => {
      const localErrors = [];
      const builtAlerts = [];
      const discardReasons = {
        parseNoItems: 0,
        droppedByFilter: 0,
        droppedByItemCap: 0,
        buildFailures: 0
      };

      try {
        await sleep(sourceIndex * 60);
        const body = await fetchText(source.endpoint, 1, { source });
        const parsed = source.kind === 'rss' || source.kind === 'atom'
          ? parseFeedItems(source, body)
          : parseHtmlItems(source, body);
        if (!parsed.length) {
          discardReasons.parseNoItems += 1;
          localErrors.push(summariseSourceError(source, new Error('No items parsed from source endpoint')));
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
            return shouldKeepItem(source, item);
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
            discardReasons
          }
        };
      } catch (error) {
        const summary = summariseSourceError(source, error);
        localErrors.push(summary);
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
            discardReasons
          }
        };
      }
    }
  );

  let checked = 0;
  for (const result of sourceResults) {
    checked += result.checked || 0;
    if (Array.isArray(result.alerts) && result.alerts.length) items.push(...result.alerts);
    if (Array.isArray(result.sourceErrors) && result.sourceErrors.length) sourceErrors.push(...result.sourceErrors);
    if (result.sourceStat) sourceStats.push(result.sourceStat);
  }

  const preDedupeCount = items.length;
  const deduped = dedupeAndSortAlerts(items);
  const dedupeDropped = Math.max(0, preDedupeCount - deduped.length);
  const preservedAlerts = !deduped.length && sourceErrors.length && Array.isArray(existing?.alerts) && existing.alerts.length;
  const finalAlerts = preservedAlerts ? existing.alerts : selectStoredAlerts(deduped, MAX_STORED_ALERTS);
  const successfulSources = sourceStats.filter((stat) => stat.built > 0).length;
  const failedSources = sourceStats.filter((stat) => stat.built === 0 && stat.errors > 0).length;
  const emptySources = sourceStats.filter((stat) => stat.built === 0 && stat.errors === 0).length;
  const droppedByFilter = sourceStats.reduce((sum, stat) => sum + (stat.discardReasons?.droppedByFilter || 0), 0);
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
  const buildWarning = [
    geoLookupFallbackNote,
    autoDeferredSources.length ? `Deferred ${autoDeferredSources.length} low-yield source(s) on health cooldown.` : null,
    preservedAlerts ? 'Build produced no fresh alerts; preserved previous alert set.' : null
  ].filter(Boolean).join(' | ') || null;
  const generatedAt = new Date().toISOString();
  const nextSourceHealth = {};
  const sourceStatsById = new Map(sourceStats.map((stat) => [stat.id, stat]));

  for (const source of eligibleSources) {
    const priorEntry = sourceHealthEntry(previousHealth, source.id);
    const deferred = autoDeferredSources.find((entry) => entry.id === source.id);
    if (deferred) {
      nextSourceHealth[source.id] = {
        ...(priorEntry || {}),
        provider: source.provider,
        lane: source.lane,
        kind: source.kind,
        autoSkipReason: deferred.reason,
        cooldownUntil: deferred.until,
        lastDeferredAt: generatedAt
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
        autoSkipReason: null
      };
      continue;
    }

    nextSourceHealth[source.id] = nextSourceHealthEntry(source, stat, priorEntry, generatedAt);
  }

  const payload = {
    generatedAt,
    sourceCount: checked,
    alertCount: finalAlerts.length,
    alerts: finalAlerts,
    sourceErrors: sourceErrors.slice(0, MAX_SOURCE_ERRORS_TO_REPORT),
    geoLookupSnapshot: geoLookupSnapshot(),
    buildWarning,
    health: buildHealthBlock({
      generatedAt,
      checked,
      sourceErrors,
      buildWarning,
      previousHealth,
      successfulRefresh: !preservedAlerts,
      usedFallback: preservedAlerts || Boolean(geoLookupFallbackNote),
      sourceHealth: nextSourceHealth,
      autoDeferredSources
    })
  };

  const currentComparable = JSON.stringify(existing?.alerts || []);
  const nextComparable = JSON.stringify(payload.alerts);

  if (currentComparable === nextComparable && !sourceErrors.length && !geoLookupFallbackNote) {
    console.log('No alert changes detected.');
    return;
  }

  await fs.writeFile(outputPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log([
    'Feed build summary:',
    `eligible=${eligibleSources.length}`,
    `scheduled=${scheduledSources.length}`,
    `deferred=${deferredSources}`,
    `cooldownDeferred=${autoDeferredSources.length}`,
    `checked=${checked}`,
    `successfulWithAlerts=${successfulSources}`,
    `failed=${failedSources}`,
    `empty=${emptySources}`,
    `preDedupe=${preDedupeCount}`,
    `postDedupe=${deduped.length}`,
    `stored=${payload.alertCount}`,
    `droppedByDedupe=${dedupeDropped}`,
    `droppedByFilter=${droppedByFilter}`,
    `droppedByItemCap=${droppedByItemCap}`,
    `droppedByBuildFailures=${droppedByBuildFailures}`
  ].join(' | '));
  if (topFailingSources) {
    console.log(`Top failing sources by error count: ${topFailingSources}`);
  }
  if (failingCategorySummary) {
    console.log(`Failure categories: ${failingCategorySummary}`);
  }
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
