import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import {
  AUTO_QUARANTINE_BLOCKED_HTML_THRESHOLD,
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
  quarantinedSourcesPath,
  quarantinedSourcesReviewPath,
  sqlitePath,
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

function sourceHealthEntry(previousHealth, sourceId) {
  const sourceHealth = previousHealth?.sourceHealth;
  if (!sourceHealth || typeof sourceHealth !== 'object') return null;
  const entry = sourceHealth[sourceId];
  return entry && typeof entry === 'object' ? entry : null;
}

function isBlockedFailureCategory(category) {
  return category === 'blocked-or-auth' || category === 'anti-bot-protection';
}

function sourceMayAutoCooldown(source, previousEntry, buildDate) {
  if (!previousEntry) return null;
  if (previousEntry.quarantined) {
    return {
      reason: 'review-quarantine',
      until: null
    };
  }
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
  const priorBlockedFailures = Number(prior.consecutiveBlockedFailures || 0);
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
    lastSuccessfulAt: prior.lastSuccessfulAt || null,
    lastFailureAt: prior.lastFailureAt || null,
    lastEmptyAt: prior.lastEmptyAt || null,
    lastErrorCategory: prior.lastErrorCategory || null,
    lastErrorMessage: prior.lastErrorMessage || null,
    cooldownUntil: null,
    autoSkipReason: null,
    quarantined: Boolean(prior.quarantined),
    quarantinedAt: prior.quarantinedAt || null,
    quarantineReason: prior.quarantineReason || null
  };

  if ((stat?.built || 0) > 0) {
    next.successfulRuns += 1;
    next.consecutiveFailures = 0;
    next.consecutiveEmptyRuns = 0;
    next.consecutiveBlockedFailures = 0;
    next.lastErrorCategory = null;
    next.lastErrorMessage = null;
    next.lastSuccessfulAt = generatedAt;
    return next;
  }

  if ((stat?.errors || 0) > 0) {
    const blockedFailure = source?.kind === 'html' && isBlockedFailureCategory(stat?.lastErrorCategory);
    next.failedRuns += 1;
    next.consecutiveFailures += 1;
    next.consecutiveEmptyRuns = 0;
    next.consecutiveBlockedFailures = blockedFailure ? priorBlockedFailures + 1 : 0;
    next.lastFailureAt = generatedAt;
    next.lastErrorCategory = stat?.lastErrorCategory || null;
    next.lastErrorMessage = stat?.lastErrorMessage || null;
    if (!next.quarantined && blockedFailure && next.consecutiveBlockedFailures >= AUTO_QUARANTINE_BLOCKED_HTML_THRESHOLD) {
      next.quarantined = true;
      next.quarantinedAt = generatedAt;
      next.quarantineReason = `Repeated ${stat.lastErrorCategory} failures on html source`;
      next.autoSkipReason = 'review-quarantine';
      next.cooldownUntil = null;
      return next;
    }
    if (next.consecutiveFailures >= AUTO_SKIP_FAILURE_THRESHOLD) {
      next.cooldownUntil = new Date(Date.parse(generatedAt) + SOURCE_FAILURE_COOLDOWN_HOURS * 3600000).toISOString();
      next.autoSkipReason = 'failure-cooldown';
    }
    return next;
  }

  next.emptyRuns += 1;
  next.consecutiveEmptyRuns += 1;
  next.consecutiveFailures = 0;
  next.consecutiveBlockedFailures = 0;
  next.lastErrorCategory = null;
  next.lastErrorMessage = null;
  next.lastEmptyAt = generatedAt;
  if (!source.isTrustedOfficial && source.lane !== 'incidents' && next.consecutiveEmptyRuns >= AUTO_SKIP_EMPTY_THRESHOLD) {
    next.cooldownUntil = new Date(Date.parse(generatedAt) + SOURCE_EMPTY_COOLDOWN_HOURS * 3600000).toISOString();
    next.autoSkipReason = 'empty-cooldown';
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
        consecutiveBlockedFailures: Number(health?.consecutiveBlockedFailures || 0),
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
  const rows = entries.length
    ? entries.map((entry) => `
      <tr>
        <td>${clean(entry.provider)}</td>
        <td>${clean(entry.kind)} / ${clean(entry.lane)}</td>
        <td>${clean(entry.region)}</td>
        <td>${clean(entry.status)}</td>
        <td>${clean(entry.reason)}</td>
        <td>${clean(entry.lastErrorCategory || 'n/a')}</td>
        <td>${clean(entry.consecutiveBlockedFailures || 0)}</td>
        <td><a href="${clean(entry.endpoint)}" target="_blank" rel="noreferrer">${clean(entry.endpoint)}</a></td>
      </tr>`).join('\n')
    : '<tr><td colspan="8">No quarantined sources currently recorded.</td></tr>';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Brialert Source Quarantine Review</title>
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; font: 16px/1.5 system-ui, sans-serif; background: #0b1220; color: #e8eef9; }
    main { max-width: 1200px; margin: 0 auto; padding: 32px 20px 48px; }
    h1 { margin: 0 0 8px; font-size: 32px; }
    p { margin: 0 0 16px; color: #b9c6de; }
    .card { background: rgba(19, 27, 45, 0.92); border: 1px solid rgba(112, 138, 179, 0.28); border-radius: 18px; padding: 18px; overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; min-width: 980px; }
    th, td { text-align: left; padding: 12px 10px; vertical-align: top; border-bottom: 1px solid rgba(112, 138, 179, 0.18); }
    th { color: #9fb2d6; font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; }
    a { color: #9fd0ff; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .meta { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 20px; }
    .pill { padding: 8px 12px; border-radius: 999px; background: rgba(159, 208, 255, 0.08); border: 1px solid rgba(159, 208, 255, 0.18); }
  </style>
</head>
<body>
  <main>
    <h1>Source Quarantine Review</h1>
    <p>Auto-quarantined or manually quarantined sources that should be reviewed before returning to the hourly feed run.</p>
    <div class="meta">
      <span class="pill">Generated: ${clean(generatedAt)}</span>
      <span class="pill">Quarantined sources: ${entries.length}</span>
    </div>
    <div class="card">
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
            <th>Endpoint</th>
          </tr>
        </thead>
        <tbody>${rows}
        </tbody>
      </table>
    </div>
  </main>
</body>
</html>
`;
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
        const parsed = source.kind === 'rss' || source.kind === 'atom' || source.kind === 'json'
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
            lastErrorCategory: localErrors[0]?.category || null,
            lastErrorMessage: localErrors[0]?.message || null,
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
            lastErrorCategory: localErrors[0]?.category || null,
            lastErrorMessage: localErrors[0]?.message || null,
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
        quarantined: deferred.reason === 'review-quarantine' ? true : Boolean(priorEntry?.quarantined),
        quarantinedAt: priorEntry?.quarantinedAt || null,
        quarantineReason: deferred.reason === 'review-quarantine'
          ? clean(priorEntry?.quarantineReason || 'Needs manual review')
          : (priorEntry?.quarantineReason || null),
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
  const sqliteSnapshot = {
    generatedAt,
    sourceHealth: nextSourceHealth,
    sourceStats,
    alertChurn: buildAlertChurnRows(existing?.alerts || [], payload.alerts)
  };
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

  if (currentComparable === nextComparable && !sourceErrors.length && !geoLookupFallbackNote) {
    console.log('No alert changes detected.');
    return;
  }

  await fs.writeFile(outputPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  await fs.writeFile(quarantinedSourcesPath, JSON.stringify(quarantinedPayload, null, 2) + '\n', 'utf8');
  await fs.writeFile(quarantinedSourcesReviewPath, renderQuarantinedSourcesHtml(generatedAt, quarantinedEntries), 'utf8');
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
    `quarantined=${quarantinedEntries.length}`,
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
