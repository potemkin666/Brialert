import {
  ApiError,
  commitJsonFilesAtomically,
  listSourceShardPaths,
  loadJsonFile,
  normaliseEndpoint,
  validateAbsoluteHttpUrl
} from './_lib/github-persistence.js';

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
  return restored;
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
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({
      ok: false,
      error: 'method-not-allowed',
      message: 'Only POST is supported.'
    });
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
        [shardResolution.shardPath]: nextShardPayload
      },
      `Restore quarantined source ${sourceId}`
    );

    return response.status(200).json({
      ok: true,
      restoredSource,
      message: 'Source restored successfully.'
    });
  } catch (error) {
    return sendError(response, error);
  }
}
