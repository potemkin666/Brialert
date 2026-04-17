import { ApiError } from '../../_lib/github-persistence.js';
import {
  appendQueryParams,
  clearAdminSessionCookie,
  clearOauthStateCookie,
  getAuthRedirectConfig,
  getOAuthRedirectUri,
  readOauthState,
  setAdminSessionCookie
} from '../../_lib/admin-session.js';
import {
  ensureGithubAdminAllowed,
  exchangeOAuthCode,
  fetchGithubUser
} from '../../_lib/github-admin-access.js';

const CALLBACK_RATE_LIMIT_MS = 60_000;
const CALLBACK_RATE_LIMIT_BURST = 10;
const recentCallbacks = [];

function isCallbackRateLimited() {
  const now = Date.now();
  while (recentCallbacks.length > 0 && now - recentCallbacks[0] > CALLBACK_RATE_LIMIT_MS) {
    recentCallbacks.shift();
  }
  if (recentCallbacks.length >= CALLBACK_RATE_LIMIT_BURST) {
    return true;
  }
  recentCallbacks.push(now);
  return false;
}

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

function redirect(response, target) {
  response.statusCode = 302;
  response.setHeader('Location', target);
  response.end();
}

function failRedirectTarget(errorCode) {
  const { failureRedirect } = getAuthRedirectConfig();
  return appendQueryParams(failureRedirect, { auth: 'failed', error: errorCode || 'oauth-failed' });
}

function mapErrorCode(error) {
  if (error instanceof ApiError) return error.code;
  return 'oauth-failed';
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

  if (isCallbackRateLimited()) {
    return redirect(response, failRedirectTarget('rate-limited'));
  }

  const statePayload = readOauthState(request);
  const expectedState = String(statePayload?.nonce || '').trim();
  const receivedState = String(queryValue(request, 'state') || '').trim();
  const receivedCode = String(queryValue(request, 'code') || '').trim();
  const oauthError = String(queryValue(request, 'error') || '').trim();
  const returnTo = statePayload?.returnTo || getAuthRedirectConfig().successRedirect;

  try {
    if (!statePayload || !expectedState || !receivedState || receivedState !== expectedState) {
      throw new ApiError('invalid-oauth-state', 'OAuth state validation failed.', 401);
    }
    if (oauthError) {
      throw new ApiError('oauth-denied', `GitHub OAuth denied access: ${oauthError}`, 401);
    }
    if (!receivedCode) {
      throw new ApiError('missing-oauth-code', 'GitHub OAuth callback is missing code.', 401);
    }

    const redirectUri = getOAuthRedirectUri(request);
    const accessToken = await exchangeOAuthCode(receivedCode, redirectUri);
    const user = await fetchGithubUser(accessToken);
    await ensureGithubAdminAllowed(accessToken, user.login);

    setAdminSessionCookie(request, response, user);
    clearOauthStateCookie(request, response);
    return redirect(response, appendQueryParams(returnTo, { auth: 'ok' }));
  } catch (error) {
    clearAdminSessionCookie(request, response);
    clearOauthStateCookie(request, response);
    return redirect(response, failRedirectTarget(mapErrorCode(error)));
  }
}
