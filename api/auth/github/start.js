import { ApiError } from '../../_lib/github-persistence.js';
import {
  createOauthState,
  getOAuthRedirectUri,
  normalizeReturnTo,
  setOauthStateCookie
} from '../../_lib/admin-session.js';
import { getOAuthClientConfig } from '../../_lib/github-admin-access.js';

function queryValue(request, key) {
  if (request?.query && Object.prototype.hasOwnProperty.call(request.query, key)) {
    return request.query[key];
  }
  try {
    const url = new URL(request.url, 'https://albertalert.local');
    return url.searchParams.get(key);
  } catch {
    return null;
  }
}

function sendError(response, error) {
  const status = error instanceof ApiError ? error.status : 500;
  const code = error instanceof ApiError ? error.code : 'oauth-start-failure';
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
    const { clientId } = getOAuthClientConfig();
    const redirectUri = getOAuthRedirectUri(request);
    const returnTo = normalizeReturnTo(queryValue(request, 'returnTo'));
    const { nonce, token } = createOauthState(request, returnTo);
    setOauthStateCookie(request, response, token);

    const authUrl = new URL('https://github.com/login/oauth/authorize');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', 'read:user read:org');
    authUrl.searchParams.set('state', nonce);
    authUrl.searchParams.set('allow_signup', 'false');

    response.statusCode = 302;
    response.setHeader('Location', authUrl.toString());
    return response.end();
  } catch (error) {
    return sendError(response, error);
  }
}
