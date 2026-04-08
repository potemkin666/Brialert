import crypto from 'node:crypto';
import { ApiError } from './github-persistence.js';

const DEFAULT_ALLOWED_ORIGINS = [
  'https://potemkin666.github.io'
];

function parseAllowedOrigins(rawValue) {
  const values = String(rawValue || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const allowed = new Set();
  for (const value of values) {
    try {
      const parsed = new URL(value);
      allowed.add(parsed.origin);
    } catch {
      console.warn(`Ignoring invalid BRIALERT_ALLOWED_ORIGINS value: "${value}"`);
    }
  }
  return allowed;
}

function getAllowedOrigins() {
  const configured = parseAllowedOrigins(process.env.BRIALERT_ALLOWED_ORIGINS);
  if (configured.size > 0) return configured;
  return new Set(DEFAULT_ALLOWED_ORIGINS);
}

function setVaryHeader(response, value) {
  const current = response.getHeader('Vary');
  const existing = String(current || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!existing.includes(value)) {
    response.setHeader('Vary', [...existing, value].join(', '));
  }
}

export function applyRestrictedCors(request, response, methods) {
  const origin = typeof request.headers?.origin === 'string'
    ? request.headers.origin.trim()
    : '';
  const allowedOrigins = getAllowedOrigins();
  if (origin) {
    if (!allowedOrigins.has(origin)) {
      return {
        blocked: true,
        status: 403,
        body: {
          ok: false,
          error: 'origin-not-allowed',
          message: 'Request origin is not allowed.'
        }
      };
    }
    response.setHeader('Access-Control-Allow-Origin', origin);
    setVaryHeader(response, 'Origin');
  }
  response.setHeader('Access-Control-Allow-Methods', methods.join(','));
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return { blocked: false };
}

function getAdminToken() {
  const token = String(process.env.BRIALERT_ADMIN_TOKEN || '').trim();
  if (!token) {
    throw new ApiError(
      'misconfigured-backend',
      'Backend is missing BRIALERT_ADMIN_TOKEN configuration.',
      503
    );
  }
  return token;
}

function extractRequestToken(request) {
  const authorization = typeof request.headers?.authorization === 'string'
    ? request.headers.authorization.trim()
    : '';
  if (!authorization) return '';
  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (bearerMatch) return bearerMatch[1].trim();
  return authorization;
}

function tokensMatch(left, right) {
  const leftDigest = crypto.createHash('sha256').update(String(left || ''), 'utf8').digest();
  const rightDigest = crypto.createHash('sha256').update(String(right || ''), 'utf8').digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest);
}

export function assertAdminAuth(request) {
  const expectedToken = getAdminToken();
  const receivedToken = extractRequestToken(request);
  if (!tokensMatch(receivedToken, expectedToken)) {
    throw new ApiError('admin-auth-required', 'Valid admin authorization is required.', 401);
  }
}
