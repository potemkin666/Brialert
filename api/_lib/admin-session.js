import crypto from 'node:crypto';

import { ApiError } from './github-persistence.js';

const DEFAULT_ALLOWED_ORIGINS = ['https://potemkin666.github.io'];
const SESSION_COOKIE_NAME = process.env.ALBERTALERT_SESSION_COOKIE_NAME || 'albertalert_admin_session';
const STATE_COOKIE_NAME = process.env.ALBERTALERT_OAUTH_STATE_COOKIE_NAME || 'albertalert_admin_oauth_state';
const SESSION_SECRET = String(process.env.ALBERTALERT_SESSION_SECRET || '').trim();

function parseTtlSeconds(envKey, fallback) {
  const parsed = Number.parseInt(process.env[envKey] || String(fallback), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

const SESSION_TTL_SECONDS = Math.max(60, parseTtlSeconds('ALBERTALERT_SESSION_TTL_SECONDS', 28800));
const STATE_TTL_SECONDS = Math.max(60, parseTtlSeconds('ALBERTALERT_OAUTH_STATE_TTL_SECONDS', 600));

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function base64UrlEncode(value) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function base64UrlDecode(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function normaliseOrigin(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).origin;
  } catch {
    return '';
  }
}

export function getAllowedOrigins() {
  const configured = String(process.env.ALBERTALERT_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => normaliseOrigin(value))
    .filter(Boolean);
  return configured.length ? configured : DEFAULT_ALLOWED_ORIGINS;
}

function parseCookies(cookieHeader) {
  const cookies = {};
  for (const part of String(cookieHeader || '').split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function appendSetCookie(response, value) {
  const current = response.getHeader('Set-Cookie');
  if (!current) {
    response.setHeader('Set-Cookie', value);
    return;
  }
  if (Array.isArray(current)) {
    response.setHeader('Set-Cookie', [...current, value]);
    return;
  }
  response.setHeader('Set-Cookie', [String(current), value]);
}

function signToken(encodedPayload) {
  if (!SESSION_SECRET) {
    throw new ApiError('misconfigured-backend', 'Backend is missing ALBERTALERT_SESSION_SECRET configuration.', 503);
  }
  return crypto.createHmac('sha256', SESSION_SECRET).update(encodedPayload).digest('base64url');
}

function createSignedToken(payload) {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = signToken(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

function verifySignedToken(rawToken) {
  if (!SESSION_SECRET) return null;
  const token = String(rawToken || '').trim();
  const dotIndex = token.lastIndexOf('.');
  if (dotIndex <= 0) return null;
  const encodedPayload = token.slice(0, dotIndex);
  const encodedSignature = token.slice(dotIndex + 1);
  const expectedSignature = signToken(encodedPayload);
  const expectedBuffer = Buffer.from(expectedSignature);
  const receivedBuffer = Buffer.from(encodedSignature);
  if (expectedBuffer.length !== receivedBuffer.length) return null;
  if (!crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    if (!payload || typeof payload !== 'object') return null;
    if (!Number.isInteger(payload.exp) || payload.exp <= nowSeconds()) return null;
    return payload;
  } catch {
    return null;
  }
}

function secureCookieFlag(request) {
  const forwardedProto = String(request?.headers?.['x-forwarded-proto'] || '').toLowerCase();
  if (forwardedProto.includes('https')) return true;
  if (forwardedProto.includes('http')) return false;
  return process.env.NODE_ENV !== 'development';
}

function sessionCookieBase(request) {
  const secure = secureCookieFlag(request);
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    `SameSite=${secure ? 'None' : 'Lax'}`
  ];
  if (secure) parts.push('Secure');
  return parts;
}

function stateCookieBase(request) {
  const parts = [
    `${STATE_COOKIE_NAME}=`,
    'Path=/api/auth/github',
    'HttpOnly',
    'SameSite=Lax'
  ];
  if (secureCookieFlag(request)) parts.push('Secure');
  return parts;
}

function serializeCookie(parts, value, maxAgeSeconds) {
  const encodedValue = encodeURIComponent(value);
  const maxAge = Math.max(0, Number(maxAgeSeconds) || 0);
  return `${parts[0]}${encodedValue}; ${parts.slice(1).join('; ')}; Max-Age=${maxAge}`;
}

export function applyCorsHeaders(request, response, methods) {
  const requestOrigin = normaliseOrigin(request?.headers?.origin);
  const allowedOrigins = new Set(getAllowedOrigins());
  if (requestOrigin && allowedOrigins.has(requestOrigin)) {
    response.setHeader('Access-Control-Allow-Origin', requestOrigin);
    response.setHeader('Access-Control-Allow-Credentials', 'true');
    response.setHeader('Vary', 'Origin');
  }
  response.setHeader('Access-Control-Allow-Methods', methods);
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (request?.method === 'OPTIONS') {
    return !requestOrigin || allowedOrigins.has(requestOrigin);
  }
  return true;
}

export function readAdminSession(request) {
  const cookies = parseCookies(request?.headers?.cookie);
  const payload = verifySignedToken(cookies[SESSION_COOKIE_NAME]);
  if (!payload || payload.type !== 'session' || typeof payload.login !== 'string' || !payload.login) {
    return null;
  }
  return {
    login: payload.login,
    name: payload.name || payload.login,
    avatarUrl: payload.avatarUrl || ''
  };
}

export function requireAdminSession(request, response) {
  if (!SESSION_SECRET) {
    response.status(503).json({
      ok: false,
      error: 'misconfigured-backend',
      message: 'Backend is missing ALBERTALERT_SESSION_SECRET configuration.'
    });
    return null;
  }
  const session = readAdminSession(request);
  if (session) return session;
  response.status(401).json({
    ok: false,
    error: 'not-authenticated',
    message: 'Sign in with GitHub as an authorized admin to access quarantine.'
  });
  return null;
}

export function createOauthState(request, returnTo) {
  const nonce = crypto.randomBytes(16).toString('base64url');
  const issuedAt = nowSeconds();
  const token = createSignedToken({
    type: 'oauth-state',
    nonce,
    returnTo,
    iat: issuedAt,
    exp: issuedAt + STATE_TTL_SECONDS
  });
  return { nonce, token };
}

export function readOauthState(request) {
  const cookies = parseCookies(request?.headers?.cookie);
  const payload = verifySignedToken(cookies[STATE_COOKIE_NAME]);
  if (!payload || payload.type !== 'oauth-state' || typeof payload.nonce !== 'string' || !payload.nonce) {
    return null;
  }
  return payload;
}

export function setOauthStateCookie(request, response, token) {
  appendSetCookie(response, serializeCookie(stateCookieBase(request), token, STATE_TTL_SECONDS));
}

export function clearOauthStateCookie(request, response) {
  appendSetCookie(response, serializeCookie(stateCookieBase(request), '', 0));
}

export function setAdminSessionCookie(request, response, user) {
  const issuedAt = nowSeconds();
  const token = createSignedToken({
    type: 'session',
    login: String(user?.login || '').trim(),
    name: String(user?.name || '').trim(),
    avatarUrl: String(user?.avatarUrl || '').trim(),
    iat: issuedAt,
    exp: issuedAt + SESSION_TTL_SECONDS
  });
  appendSetCookie(response, serializeCookie(sessionCookieBase(request), token, SESSION_TTL_SECONDS));
}

export function clearAdminSessionCookie(request, response) {
  appendSetCookie(response, serializeCookie(sessionCookieBase(request), '', 0));
}

export function getAuthRedirectConfig() {
  return {
    successRedirect: String(process.env.ALBERTALERT_AUTH_SUCCESS_REDIRECT || '/source-quarantine.html').trim() || '/source-quarantine.html',
    failureRedirect: String(process.env.ALBERTALERT_AUTH_FAILURE_REDIRECT || '/source-quarantine.html?auth=failed').trim() || '/source-quarantine.html?auth=failed'
  };
}

export function normalizeReturnTo(rawValue) {
  const value = String(rawValue || '').trim();
  const fallback = getAuthRedirectConfig().successRedirect;
  if (!value) return fallback;
  if (value.startsWith('/')) return value;
  try {
    const parsed = new URL(value);
    const allowedOrigins = new Set(getAllowedOrigins());
    return allowedOrigins.has(parsed.origin) ? parsed.toString() : fallback;
  } catch {
    return fallback;
  }
}

export function appendQueryParams(target, values) {
  const entries = Object.entries(values || {}).filter(([, value]) => value != null && value !== '');
  if (!entries.length) return target;
  if (target.startsWith('/')) {
    const temp = new URL(target, 'https://albertalert.local');
    for (const [key, value] of entries) temp.searchParams.set(key, String(value));
    return `${temp.pathname}${temp.search}${temp.hash}`;
  }
  try {
    const parsed = new URL(target);
    for (const [key, value] of entries) parsed.searchParams.set(key, String(value));
    return parsed.toString();
  } catch {
    return target;
  }
}

export function resolveBackendOrigin(request) {
  const host = String(request?.headers?.host || '').trim();
  if (!host) return '';
  const forwardedProto = String(request?.headers?.['x-forwarded-proto'] || '').toLowerCase();
  const protocol = forwardedProto.includes('http') ? forwardedProto.split(',')[0].trim() : 'https';
  return `${protocol}://${host}`;
}

export function getOAuthRedirectUri(request) {
  const configured = String(process.env.ALBERTALERT_GITHUB_OAUTH_REDIRECT_URI || '').trim();
  if (configured) return configured;
  const origin = resolveBackendOrigin(request);
  if (!origin) {
    throw new ApiError(
      'misconfigured-backend',
      'Backend cannot infer OAuth callback origin; set ALBERTALERT_GITHUB_OAUTH_REDIRECT_URI.',
      503
    );
  }
  return `${origin}/api/auth/github/callback`;
}
