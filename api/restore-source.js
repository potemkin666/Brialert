import {
  ApiError,
  commitJsonFilesAtomically,
  dispatchWorkflow,
  listSourceShardPaths,
  loadJsonFile,
  normaliseEndpoint,
  validateAbsoluteHttpUrl
} from './_lib/github-persistence.js';
import { applyCorsHeaders, requireAdminSession } from './_lib/admin-session.js';

const QUARANTINE_ONLY_FIELDS = new Set([
  'status',
  'reason',
  'quarantinedAt',
  'lastErrorCategory',
  'lastErrorMessage',
  'consecutiveFailures',
  'consecutiveBlockedFailures',
  'consecutiveDeadUrlFailures',
  'replacementSuggestion',
  'reviewBy',
  'lastFailureAt',
  'lastCheckedAt',
  'healthScore'
]);

const FEED_WORKFLOW_FILENAME = 'update-live-feed.yml';
const RESTORE_AUDIT_PATH = 'data/restore-audit.json';
const RESTORE_AUDIT_HISTORY_LIMIT = 20;
const BULK_RESTORE_LIMIT = 50;
const URL_HEALTH_CHECK_TIMEOUT_MS = 8000;

function sendError(response, error) {
  const status = error instanceof ApiError ? error.status : 500;
  const code = error instanceof ApiError ? error.code : 'persistence-failure';
  const message = error instanceof Error ? error.message : String(error);
  response.status(status).json({
    ok: false,
    error: code,
    message
  });
}

async function checkUrlHealth(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), URL_HEALTH_CHECK_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Brialert-HealthCheck/1.0' }
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, error: message };
  } finally {
    clearTimeout(timeout);
  }
}

function applyRefreshPolicy(source) {
  if (!source || typeof source !== 'object') return source;
  const isCritical = source.lane === 'incidents' || source.isTrustedOfficial === true;
  if (!isCritical) return source;

  const explicit = Number(source.refreshEveryHours);
  const hourlyCadence = 1;
  const next = { ...source };

  if (!Number.isFinite(explicit)) {
    next.refreshEveryHours = hourlyCadence;
    return next;
  }

  next.refreshEveryHours = Math.min(explicit, hourlyCadence);
  return next;
}

function parseRequestBody(request) {
  if (request.body && typeof request.body === 'object') return request.body;
  if (typeof request.body === 'string' && request.body.trim()) {
    try {
      return JSON.parse(request.body);
    } catch {
      throw new ApiError('invalid-body', 'Request body must be valid JSON.', 400);
    }
  }
  throw new ApiError('invalid-body', 'Request body is required.', 400);
}

function cleanupRestoredSource(source, replacementUrl) {
  const restored = {};
  for (const [key, value] of Object.entries(source || {})) {
    if (QUARANTINE_ONLY_FIELDS.has(key)) continue;
    restored[key] = value;
  }
  restored.endpoint = replacementUrl;
  return applyRefreshPolicy(restored);
}

function ensureValidSourceId(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) {
    throw new ApiError('source-not-found', 'A valid sourceId is required.', 400);
  }
  return value;
}

function detectDuplicateConflict(sources, excludedSourceId, replacementUrl) {
  const candidate = normaliseEndpoint(replacementUrl);
  if (!candidate) return false;
  for (const entry of Array.isArray(sources) ? sources : []) {
    if (!entry || typeof entry !== 'object' || entry.id === excludedSourceId) continue;
    if (normaliseEndpoint(entry.endpoint) === candidate) return true;
  }
  return false;
}

function normaliseRestoreAuditHistory(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry) => entry && typeof entry === 'object');
}

function buildRestoreAuditPayload(previous, entry) {
  const history = normaliseRestoreAuditHistory(previous?.history);
  const nextHistory = [entry, ...history].slice(0, RESTORE_AUDIT_HISTORY_LIMIT);
  return {
    generatedAt: entry.at,
    lastRestore: entry,
    history: nextHistory
  };
}

/**
 * Resolve which shard file must be updated for a restored source.
 * It first checks the expected region/lane shard, then scans all shards for the source id.
 * If the source is not found in any existing shard, it falls back to creating/inserting into
 * the expected region/lane shard path so persistence still completes atomically.
 */
async function resolveShardPath(config, restoredSource, shardPaths) {
  const targetId = restoredSource.id;
  if (!targetId) {
    throw new ApiError('persistence-failure', 'Restored source is missing an id.', 500);
  }

  const preferredPath = restoredSource.region && restoredSource.lane
    ? `data/sources/${restoredSource.region}/${restoredSource.lane}.json`
    : '';
  if (preferredPath && shardPaths.includes(preferredPath)) {
    const preferredFile = await loadJsonFile(preferredPath);
    const preferredSources = Array.isArray(preferredFile.data?.sources) ? preferredFile.data.sources : [];
    const index = preferredSources.findIndex((entry) => entry?.id === targetId);
    if (index >= 0) {
      return { shardPath: preferredPath, shardFile: preferredFile, sourceIndex: index };
    }
  }

  for (const shardPath of shardPaths) {
    const file = await loadJsonFile(shardPath);
    const sources = Array.isArray(file.data?.sources) ? file.data.sources : [];
    const index = sources.findIndex((entry) => entry?.id === targetId);
    if (index >= 0) {
      return { shardPath, shardFile: file, sourceIndex: index };
    }
  }

  if (!preferredPath) {
    throw new ApiError(
      'persistence-failure',
      'Cannot determine target source shard path for restore persistence.',
      500
    );
  }

  return {
    shardPath: preferredPath,
    shardFile: null,
    sourceIndex: -1
  };
}

function parseBulkSources(body) {
  if (!Array.isArray(body.sources)) return null;
  if (body.sources.length === 0) {
    throw new ApiError('invalid-body', 'sources array must not be empty.', 400);
  }
  if (body.sources.length > BULK_RESTORE_LIMIT) {
    throw new ApiError('invalid-body', `sources array exceeds maximum of ${BULK_RESTORE_LIMIT}.`, 400);
  }
  return body.sources.map((entry) => ({
    sourceId: ensureValidSourceId(entry?.sourceId),
    replacementUrl: validateAbsoluteHttpUrl(entry?.replacementUrl)
  }));
}

export default async function handler(request, response) {
  applyCorsHeaders(request, response, 'POST,OPTIONS');
  if (request.method === 'OPTIONS') {
    response.setHeader('Allow', 'POST,OPTIONS');
    return response.status(204).end();
  }
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST,OPTIONS');
    return response.status(405).json({
      ok: false,
      error: 'method-not-allowed',
      message: 'Only POST is supported.'
    });
  }
  if (!requireAdminSession(request, response)) {
    return response;
  }

  try {
    const body = parseRequestBody(request);
    const skipHealthCheck = body.skipHealthCheck === true;
    const bulkItems = parseBulkSources(body);
    const restoreItems = bulkItems || [{
      sourceId: ensureValidSourceId(body.sourceId),
      replacementUrl: validateAbsoluteHttpUrl(body.replacementUrl)
    }];

    if (!skipHealthCheck) {
      const uniqueUrls = [...new Set(restoreItems.map((item) => item.replacementUrl))];
      const healthResults = await Promise.all(uniqueUrls.map((url) => checkUrlHealth(url)));
      const failures = uniqueUrls
        .map((url, i) => ({ url, ...healthResults[i] }))
        .filter((r) => !r.ok);
      if (failures.length > 0) {
        const details = failures.map((f) => f.error
          ? `${f.url} — ${f.error}`
          : `${f.url} — HTTP ${f.status}`
        ).join('; ');
        throw new ApiError(
          'url-health-check-failed',
          `Replacement URL(s) did not respond successfully: ${details}. Pass skipHealthCheck: true to override.`,
          422
        );
      }
    }

    const [quarantinedFile, sourcesFile] = await Promise.all([
      loadJsonFile('data/quarantined-sources.json'),
      loadJsonFile('data/sources.json')
    ]);

    const quarantinedSources = Array.isArray(quarantinedFile.data?.sources) ? quarantinedFile.data.sources : [];
    const activeSources = Array.isArray(sourcesFile.data?.sources) ? sourcesFile.data.sources : [];

    const restoredSources = [];
    const restoredIds = new Set();
    const nextActiveSources = [...activeSources];
    let previousRestoreAudit = null;
    try {
      previousRestoreAudit = (await loadJsonFile(RESTORE_AUDIT_PATH)).data;
    } catch (auditLoadErr) {
      console.warn(`[restore-source] Failed to load ${RESTORE_AUDIT_PATH}: ${auditLoadErr?.message || auditLoadErr}`);
    }
    let auditPayload = previousRestoreAudit;

    const shardPaths = await listSourceShardPaths(quarantinedFile.config);
    const shardUpdates = {};

    for (const item of restoreItems) {
      const { sourceId, replacementUrl } = item;
      const quarantineIndex = quarantinedSources.findIndex((entry) => entry?.id === sourceId);
      if (quarantineIndex < 0) {
        throw new ApiError('source-not-found', `Quarantined source "${sourceId}" was not found.`, 404);
      }

      if (detectDuplicateConflict(nextActiveSources, sourceId, replacementUrl)) {
        throw new ApiError(
          'duplicate-conflict',
          `Replacement URL for "${sourceId}" already exists on a different active source.`,
          409
        );
      }

      const quarantinedSource = quarantinedSources[quarantineIndex];
      const restoredSource = cleanupRestoredSource(quarantinedSource, replacementUrl);
      restoredSources.push(restoredSource);
      restoredIds.add(sourceId);

      const restoreAuditEntry = {
        at: new Date().toISOString(),
        sourceId,
        provider: String(restoredSource?.provider || quarantinedSource?.provider || ''),
        replacementUrl
      };
      auditPayload = buildRestoreAuditPayload(auditPayload, restoreAuditEntry);

      const activeIndex = nextActiveSources.findIndex((entry) => entry?.id === sourceId);
      if (activeIndex >= 0) {
        nextActiveSources[activeIndex] = {
          ...nextActiveSources[activeIndex],
          ...restoredSource
        };
      } else {
        nextActiveSources.push(restoredSource);
      }

      const shardResolution = await resolveShardPath(quarantinedFile.config, restoredSource, shardPaths);
      const shardPath = shardResolution.shardPath;
      if (!shardUpdates[shardPath]) {
        shardUpdates[shardPath] = shardResolution.shardFile?.data
          ? { ...shardResolution.shardFile.data }
          : { sources: [] };
        shardUpdates[shardPath].sources = Array.isArray(shardUpdates[shardPath].sources)
          ? [...shardUpdates[shardPath].sources]
          : [];
      }
      const shardSources = shardUpdates[shardPath].sources;
      const shardIndex = shardSources.findIndex((entry) => entry?.id === sourceId);
      if (shardIndex >= 0) {
        shardSources[shardIndex] = { ...shardSources[shardIndex], ...restoredSource };
      } else {
        shardSources.push(restoredSource);
      }
    }

    const nextQuarantinedSources = quarantinedSources.filter((entry) => !restoredIds.has(entry?.id));
    const nextQuarantinePayload = {
      ...quarantinedFile.data,
      generatedAt: new Date().toISOString(),
      count: nextQuarantinedSources.length,
      sources: nextQuarantinedSources
    };
    const nextSourcesPayload = {
      ...sourcesFile.data,
      sources: nextActiveSources
    };

    const commitFiles = {
      'data/quarantined-sources.json': nextQuarantinePayload,
      'data/sources.json': nextSourcesPayload,
      [RESTORE_AUDIT_PATH]: auditPayload,
      ...shardUpdates
    };
    const commitLabel = restoredIds.size === 1
      ? `Restore quarantined source ${[...restoredIds][0]}`
      : `Bulk restore ${restoredIds.size} quarantined sources`;
    await commitJsonFilesAtomically(quarantinedFile.config, commitFiles, commitLabel);

    const autoTrigger = String(process.env.BRIALERT_AUTO_TRIGGER_FEED || 'true').toLowerCase() !== 'false';
    let workflowTriggered = false;
    let workflowMessage = null;
    if (autoTrigger) {
      try {
        await dispatchWorkflow(quarantinedFile.config, FEED_WORKFLOW_FILENAME);
        workflowTriggered = true;
      } catch (error) {
        workflowMessage = error instanceof Error ? error.message : String(error);
      }
    }

    const isBulk = bulkItems !== null;
    const restoredPayload = isBulk ? { restoredSources } : { restoredSource: restoredSources[0] };
    const countLabel = isBulk ? `${restoredSources.length} sources` : 'Source';
    return response.status(200).json({
      ok: true,
      ...restoredPayload,
      workflowTriggered,
      workflowMessage,
      message: workflowTriggered
        ? `${countLabel} restored and live feed refresh triggered.`
        : `${countLabel} restored successfully.`
    });
  } catch (error) {
    return sendError(response, error);
  }
}
