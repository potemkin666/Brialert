import {
  applyCorsHeaders,
  getAllowedOrigins,
  readAdminSession
} from '../_lib/admin-session.js';

function inferPrimaryFrontendUrl() {
  const configured = getAllowedOrigins();
  return configured[0] ? `${configured[0]}/Brialert/source-quarantine.html` : '/source-quarantine.html';
}

function startLoginUrlFor(originHint) {
  let returnTo = inferPrimaryFrontendUrl();
  try {
    const parsed = new URL(String(originHint || '').trim());
    returnTo = `${parsed.origin}/Brialert/source-quarantine.html`;
  } catch {}
  return `/api/auth/github/start?returnTo=${encodeURIComponent(returnTo)}`;
}

export default async function handler(request, response) {
  applyCorsHeaders(request, response, 'GET,OPTIONS');
  if (request.method === 'OPTIONS') {
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

  const session = readAdminSession(request);
  const originHint = request.headers.origin;
  if (!session) {
    return response.status(200).json({
      ok: true,
      authenticated: false,
      loginUrl: startLoginUrlFor(originHint)
    });
  }

  return response.status(200).json({
    ok: true,
    authenticated: true,
    user: session,
    loginUrl: startLoginUrlFor(originHint),
    logoutUrl: '/api/auth/logout'
  });
}
