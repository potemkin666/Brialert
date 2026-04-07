import { ApiError, loadJsonFile } from './_lib/github-persistence.js';

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

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({
      ok: false,
      error: 'method-not-allowed',
      message: 'Only GET is supported.'
    });
  }

  try {
    const file = await loadJsonFile('data/quarantined-sources.json');
    const sources = Array.isArray(file.data?.sources) ? file.data.sources : [];
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
