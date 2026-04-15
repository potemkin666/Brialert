import {
  ApiError,
  commitJsonFilesAtomically,
  dispatchWorkflow,
  listSourceShardPaths,
  loadJsonFile,
  normaliseEndpoint
} from './_lib/github-persistence.js';
import { applyCorsHeaders, requireAdminSession } from './_lib/admin-session.js';

const REQUESTS_PATH = 'data/source-requests.json';
const SOURCES_PATH = 'data/sources.json';
const FEED_WORKFLOW_FILENAME = 'update-live-feed.yml';

const VALID_REGIONS = new Set(['uk', 'europe', 'london', 'eu', 'international', 'us']);
const VALID_LANES = new Set(['incidents', 'context', 'sanctions', 'oversight', 'border', 'prevention']);
const VALID_KINDS = new Set(['rss', 'atom', 'json', 'html', 'playwright_html']);

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

function clean(value) {
  return String(value || '').trim();
}

function normaliseRequestsPayload(raw) {
  if (Array.isArray(raw)) {
    return { requests: raw };
  }
  if (raw && typeof raw === 'object' && Array.isArray(raw.requests)) {
    return raw;
  }
  return { requests: [] };
}

function ensureValidRequestId(raw) {
  const value = clean(raw);
  if (!value) {
    throw new ApiError('source-not-found', 'A valid requestId is required.', 400);
  }
  return value;
}

function ensureValidSourceShape(source) {
  if (!source || typeof source !== 'object') {
    throw new ApiError('invalid-source', 'Source request is missing required fields.', 400);
  }
  if (!clean(source.id)) throw new ApiError('invalid-source', 'Requested source is missing an id.', 400);
  if (!clean(source.provider)) throw new ApiError('invalid-source', 'Requested source is missing a provider.', 400);
  if (!clean(source.endpoint)) throw new ApiError('invalid-source', 'Requested source is missing an endpoint.', 400);
  if (!VALID_KINDS.has(clean(source.kind))) throw new ApiError('invalid-source', 'Requested source kind is invalid.', 400);
  if (!VALID_LANES.has(clean(source.lane))) throw new ApiError('invalid-source', 'Requested source lane is invalid.', 400);
  if (!VALID_REGIONS.has(clean(source.region))) throw new ApiError('invalid-source', 'Requested source region is invalid.', 400);
  if (typeof source.isTrustedOfficial !== 'boolean') {
    throw new ApiError('invalid-source', 'Requested source is missing isTrustedOfficial.', 400);
  }
  if (typeof source.requiresKeywordMatch !== 'boolean') {
    throw new ApiError('invalid-source', 'Requested source is missing requiresKeywordMatch.', 400);
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

function cleanupApprovedSource(source) {
  const approved = { ...source };
  delete approved.status;
  delete approved.validationLabel;
  delete approved.tagSummary;
  delete approved.requestedAt;
  return applyRefreshPolicy(approved);
}

function detectDuplicateConflict(sources, sourceId, endpoint) {
  const candidate = normaliseEndpoint(endpoint);
  if (!candidate) return false;
  return (Array.isArray(sources) ? sources : []).some((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    if (entry.id === sourceId) return false;
    return normaliseEndpoint(entry.endpoint) === candidate;
  });
}

async function resolveShardPath(config, approvedSource, shardPaths) {
  const targetId = approvedSource.id;
  if (!targetId) {
    throw new ApiError('persistence-failure', 'Approved source is missing an id.', 500);
  }

  const preferredPath = approvedSource.region && approvedSource.lane
    ? `data/sources/${approvedSource.region}/${approvedSource.lane}.json`
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
      'Cannot determine target source shard path for approval persistence.',
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
  if (!applyCorsHeaders(request, response, 'POST,OPTIONS')) {
    return response.status(403).json({ ok: false, error: 'origin-not-allowed', detail: 'Cross-origin request from disallowed origin.' });
  }
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
    const requestId = ensureValidRequestId(body.requestId || body.id || body.sourceId);

    const [requestsFile, sourcesFile] = await Promise.all([
      loadJsonFile(REQUESTS_PATH),
      loadJsonFile(SOURCES_PATH)
    ]);

    const requestsPayload = normaliseRequestsPayload(requestsFile.data);
    const requests = Array.isArray(requestsPayload.requests) ? requestsPayload.requests : [];
    const requestIndex = requests.findIndex((entry) => entry?.id === requestId);
    if (requestIndex < 0) {
      throw new ApiError('source-not-found', `Requested source "${requestId}" was not found.`, 404);
    }

    const requestedSource = requests[requestIndex];
    ensureValidSourceShape(requestedSource);
    const approvedSource = cleanupApprovedSource(requestedSource);

    const activeSources = Array.isArray(sourcesFile.data?.sources) ? sourcesFile.data.sources : [];
    if (detectDuplicateConflict(activeSources, approvedSource.id, approvedSource.endpoint)) {
      throw new ApiError(
        'duplicate-conflict',
        'Requested endpoint already exists in the active catalog.',
        409
      );
    }
    if (activeSources.some((entry) => entry?.id === approvedSource.id)) {
      throw new ApiError(
        'duplicate-conflict',
        'Requested source id already exists in the active catalog.',
        409
      );
    }

    const nextActiveSources = [...activeSources, approvedSource];
    const nextRequests = requests.filter((entry) => entry?.id !== requestId);
    const nextRequestsPayload = {
      generatedAt: new Date().toISOString(),
      count: nextRequests.length,
      requests: nextRequests
    };
    const nextSourcesPayload = {
      ...sourcesFile.data,
      sources: nextActiveSources
    };

    const shardPaths = await listSourceShardPaths(requestsFile.config);
    const shardResolution = await resolveShardPath(requestsFile.config, approvedSource, shardPaths);
    const nextShardPayload = shardResolution.shardFile?.data
      ? { ...shardResolution.shardFile.data }
      : { sources: [] };
    const shardSources = Array.isArray(nextShardPayload.sources) ? [...nextShardPayload.sources] : [];
    if (shardResolution.sourceIndex >= 0) {
      shardSources[shardResolution.sourceIndex] = approvedSource;
    } else {
      shardSources.push(approvedSource);
    }
    nextShardPayload.sources = shardSources;

    await commitJsonFilesAtomically(
      requestsFile.config,
      {
        [REQUESTS_PATH]: nextRequestsPayload,
        [SOURCES_PATH]: nextSourcesPayload,
        [shardResolution.shardPath]: nextShardPayload
      },
      `Approve source request ${requestId}`
    );

    const autoTrigger = String(process.env.BRIALERT_AUTO_TRIGGER_FEED || 'true').toLowerCase() !== 'false';
    let workflowTriggered = false;
    let workflowMessage = null;
    if (autoTrigger) {
      try {
        await dispatchWorkflow(requestsFile.config, FEED_WORKFLOW_FILENAME);
        workflowTriggered = true;
      } catch {
        workflowMessage = 'Feed refresh workflow could not be triggered.';
      }
    }

    return response.status(200).json({
      ok: true,
      approvedSource,
      workflowTriggered,
      workflowMessage
    });
  } catch (error) {
    return sendError(response, error);
  }
}
