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
  'consecutiveBlockedFailures',
  'consecutiveDeadUrlFailures',
  'replacementSuggestion',
  'reviewBy',
  'lastFailureAt',
  'lastCheckedAt'
]);

const FEED_WORKFLOW_FILENAME = 'update-live-feed.yml';
const RESTORE_AUDIT_PATH = 'data/restore-audit.json';
const RESTORE_AUDIT_HISTORY_LIMIT = 20;

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
    const sourceId = ensureValidSourceId(body.sourceId);
    const replacementUrl = validateAbsoluteHttpUrl(body.replacementUrl);

    const [quarantinedFile, sourcesFile] = await Promise.all([
      loadJsonFile('data/quarantined-sources.json'),
      loadJsonFile('data/sources.json')
    ]);

    const quarantinedSources = Array.isArray(quarantinedFile.data?.sources) ? quarantinedFile.data.sources : [];
    const activeSources = Array.isArray(sourcesFile.data?.sources) ? sourcesFile.data.sources : [];

    const quarantineIndex = quarantinedSources.findIndex((entry) => entry?.id === sourceId);
    if (quarantineIndex < 0) {
      throw new ApiError('source-not-found', `Quarantined source "${sourceId}" was not found.`, 404);
    }

    if (detectDuplicateConflict(activeSources, sourceId, replacementUrl)) {
      throw new ApiError(
        'duplicate-conflict',
        'Replacement URL already exists on a different active source.',
        409
      );
    }

    const quarantinedSource = quarantinedSources[quarantineIndex];
    const restoredSource = cleanupRestoredSource(quarantinedSource, replacementUrl);
    let previousRestoreAudit = null;
    try {
      previousRestoreAudit = (await loadJsonFile(RESTORE_AUDIT_PATH)).data;
    } catch {}
    const restoreAuditEntry = {
      at: new Date().toISOString(),
      sourceId,
      provider: String(restoredSource?.provider || quarantinedSource?.provider || ''),
      replacementUrl
    };
    const nextRestoreAuditPayload = buildRestoreAuditPayload(previousRestoreAudit, restoreAuditEntry);

    const nextActiveSources = [...activeSources];
    const activeIndex = nextActiveSources.findIndex((entry) => entry?.id === sourceId);
    if (activeIndex >= 0) {
      nextActiveSources[activeIndex] = {
        ...nextActiveSources[activeIndex],
        ...restoredSource
      };
    } else {
      nextActiveSources.push(restoredSource);
    }

    const nextQuarantinedSources = quarantinedSources.filter((entry) => entry?.id !== sourceId);
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

    const shardPaths = await listSourceShardPaths(quarantinedFile.config);
    const shardResolution = await resolveShardPath(quarantinedFile.config, restoredSource, shardPaths);
    const nextShardPayload = shardResolution.shardFile?.data
      ? { ...shardResolution.shardFile.data }
      : { sources: [] };
    const shardSources = Array.isArray(nextShardPayload.sources) ? [...nextShardPayload.sources] : [];
    if (shardResolution.sourceIndex >= 0) {
      shardSources[shardResolution.sourceIndex] = {
        ...shardSources[shardResolution.sourceIndex],
        ...restoredSource
      };
    } else {
      shardSources.push(restoredSource);
    }
    nextShardPayload.sources = shardSources;

    await commitJsonFilesAtomically(
      quarantinedFile.config,
      {
        'data/quarantined-sources.json': nextQuarantinePayload,
        'data/sources.json': nextSourcesPayload,
        [shardResolution.shardPath]: nextShardPayload,
        [RESTORE_AUDIT_PATH]: nextRestoreAuditPayload
      },
      `Restore quarantined source ${sourceId}`
    );

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

    return response.status(200).json({
      ok: true,
      restoredSource,
      workflowTriggered,
      workflowMessage,
      message: workflowTriggered
        ? 'Source restored and live feed refresh triggered.'
        : 'Source restored successfully.'
    });
  } catch (error) {
    return sendError(response, error);
  }
}
