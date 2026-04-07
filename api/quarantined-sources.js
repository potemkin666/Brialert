import { ApiError, loadJsonFile } from './_lib/github-persistence.js';

function setCorsHeaders(response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

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

export default async function handler(request, response) {
  setCorsHeaders(response);
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

  try {
    const file = await loadJsonFile('data/quarantined-sources.json');
    const {
      sources,
      droppedCount
    } = sanitiseSources(file.data?.sources);
    if (droppedCount > 0) {
      console.warn(
        `quarantined-sources GET skipped ${droppedCount} invalid source entr${droppedCount === 1 ? 'y' : 'ies'}.`
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
      sources
    });
  } catch (error) {
    return sendError(response, error);
  }
}
