import { ApiError, loadJsonFile } from './_lib/github-persistence.js';
import { applyCorsHeaders, requireAdminSession } from './_lib/admin-session.js';

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

function sanitiseSources(rawSources) {
  const entries = Array.isArray(rawSources) ? rawSources : [];
  const seenIds = new Set();
  const sources = [];
  let droppedCount = 0;

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') {
      droppedCount += 1;
      continue;
    }
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    if (!id) {
      droppedCount += 1;
      continue;
    }
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    sources.push(entry);
  }

  return { sources, droppedCount };
}

function sanitiseRequests(rawRequests) {
  const entries = Array.isArray(rawRequests) ? rawRequests : [];
  const seenIds = new Set();
  const requests = [];
  let droppedCount = 0;

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') {
      droppedCount += 1;
      continue;
    }
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    if (!id) {
      droppedCount += 1;
      continue;
    }
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    requests.push(entry);
  }

  return { requests, droppedCount };
}

export default async function handler(request, response) {
  applyCorsHeaders(request, response, 'GET,OPTIONS');
  if (request.method === 'OPTIONS') {
    response.setHeader('Allow', 'GET,OPTIONS');
    return response.status(204).end();
  }
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET,OPTIONS');
    return response.status(405).json({
      ok: false,
      error: 'method-not-allowed',
      message: 'Only GET is supported.'
    });
  }
  if (!requireAdminSession(request, response)) {
    return response;
  }

  try {
    const [file, requestsFile] = await Promise.all([
      loadJsonFile('data/quarantined-sources.json'),
      loadJsonFile('data/source-requests.json')
    ]);
    const {
      sources,
      droppedCount
    } = sanitiseSources(file.data?.sources);
    const {
      requests,
      droppedCount: droppedRequests
    } = sanitiseRequests(requestsFile.data?.requests || requestsFile.data);
    if (droppedCount > 0) {
      console.warn(
        `quarantined-sources GET skipped ${droppedCount} invalid source entr${droppedCount === 1 ? 'y' : 'ies'}.`
      );
    }
    if (droppedRequests > 0) {
      console.warn(
        `quarantined-sources GET skipped ${droppedRequests} invalid source request entr${droppedRequests === 1 ? 'y' : 'ies'}.`
      );
    }
    const generatedAt = typeof file.data?.generatedAt === 'string'
      ? file.data.generatedAt
      : new Date().toISOString();
    return response.status(200).json({
      ok: true,
      mode: 'live',
      restoreAvailable: true,
      generatedAt,
      count: Number.isFinite(Number(file.data?.count)) ? Number(file.data.count) : sources.length,
      sources,
      sourceRequests: requests
    });
  } catch (error) {
    return sendError(response, error);
  }
}
