import { reportBackgroundError } from '../../shared/logger.mjs';
import { DEFAULT_API_BASE } from '../../shared/api-base.mjs';

const SOURCE_REQUEST_TIMEOUT_MS = 12_000;
const SOURCE_REQUEST_WINDOW_MS = 5 * 60 * 1000;
const SOURCE_REQUEST_MAX_PER_WINDOW = 30;
const SOURCE_REQUEST_COOLDOWN_MS = 2_000;
const SOURCE_REQUEST_BACKEND_BASE = DEFAULT_API_BASE;

const sourceRequestRateState = {
  recentAttemptsMs: [],
  lastAttemptAtMs: 0
};

/** Trim-only string coercion — intentionally simpler than taxonomy.clean() which also splits camelCase. */
function trimString(value) {
  return String(value || '').trim();
}

function currentOriginBase() {
  if (typeof window === 'undefined' || !window.location) return null;
  const origin = window.location.origin.trim();
  return origin.length > 0 ? origin : null;
}

function resolveApiUrls(apiUrl) {
  const trimmed = trimString(apiUrl);
  if (!trimmed) return [];
  if (/^https?:\/\//i.test(trimmed)) return [trimmed];
  const bases = [SOURCE_REQUEST_BACKEND_BASE, currentOriginBase()].filter(Boolean);
  return bases.map((base) => `${base}${trimmed}`);
}

function normaliseRequestUrl(value) {
  let parsed;
  try {
    parsed = new URL(trimString(value));
  } catch {
    throw new Error('Enter a valid http(s) source link.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Enter a valid http(s) source link.');
  }
  parsed.hash = '';
  return parsed.toString();
}

function enforceClientRateLimit(nowMs = Date.now()) {
  // Discard timestamps from the future (clock skew / backwards adjustment)
  // and timestamps outside the rate-limit window in a single pass.
  sourceRequestRateState.recentAttemptsMs = sourceRequestRateState.recentAttemptsMs.filter(
    (attemptMs) => attemptMs <= nowMs && nowMs - attemptMs < SOURCE_REQUEST_WINDOW_MS
  );

  if (sourceRequestRateState.lastAttemptAtMs > nowMs) {
    // Clock moved backward — reset cooldown so the user isn't locked out.
    sourceRequestRateState.lastAttemptAtMs = 0;
  }

  if (
    sourceRequestRateState.lastAttemptAtMs
    && (nowMs - sourceRequestRateState.lastAttemptAtMs) < SOURCE_REQUEST_COOLDOWN_MS
  ) {
    throw new Error('Please wait a few seconds before sending another source request.');
  }

  if (sourceRequestRateState.recentAttemptsMs.length >= SOURCE_REQUEST_MAX_PER_WINDOW) {
    throw new Error('You have added a lot of sources in a short time. Please wait a couple of minutes and try again.');
  }

  sourceRequestRateState.lastAttemptAtMs = nowMs;
  sourceRequestRateState.recentAttemptsMs.push(nowMs);
}

function normalisedEndpointKey(endpoint) {
  try {
    const url = new URL(trimString(endpoint));
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return trimString(endpoint).replace(/\/$/, '');
  }
}

function sortNewestFirst(items) {
  return [...items].sort((left, right) => {
    const leftMs = new Date(left?.requestedAt || 0).getTime() || 0;
    const rightMs = new Date(right?.requestedAt || 0).getTime() || 0;
    return rightMs - leftMs;
  });
}

function mergeRequests(currentRequests, incomingRequests) {
  const merged = [];
  const seen = new Set();
  for (const item of [...(Array.isArray(incomingRequests) ? incomingRequests : []), ...(Array.isArray(currentRequests) ? currentRequests : [])]) {
    if (!item || typeof item !== 'object') continue;
    const key = normalisedEndpointKey(item.endpoint || item.url || item.sourceUrl || '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return sortNewestFirst(merged);
}

export async function syncSourceRequests(state, apiUrl, onAfterLoad) {
  const apiUrls = resolveApiUrls(apiUrl);
  try {
    let lastError = null;
    for (const url of apiUrls) {
      try {
        const response = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        const requests = Array.isArray(payload?.requests) ? payload.requests : [];
        state.sourceRequests = mergeRequests(state.sourceRequests, requests);
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError) throw lastError;
  } catch (error) {
    reportBackgroundError('source-requests', `syncSourceRequests failed for ${apiUrl}`, error, { apiUrl, operation: 'syncSourceRequests' });
    state.sourceRequests = sortNewestFirst(state.sourceRequests);
  }

  if (typeof onAfterLoad === 'function') onAfterLoad();
}

export async function submitSourceRequest(state, { apiUrl, url, regionHint }) {
  const normalizedUrl = normaliseRequestUrl(url);
  const duplicate = (Array.isArray(state?.sourceRequests) ? state.sourceRequests : []).some((item) => {
    return normalisedEndpointKey(item?.endpoint || item?.url || item?.sourceUrl || '') === normalisedEndpointKey(normalizedUrl);
  });
  if (duplicate) {
    throw new Error('That source link has already been requested.');
  }
  enforceClientRateLimit();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SOURCE_REQUEST_TIMEOUT_MS);
  const apiUrls = resolveApiUrls(apiUrl);
  let lastError = null;
  for (const url of apiUrls) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ url: normalizedUrl, regionHint })
      });

      const payload = await response.json().catch((error) => {
        reportBackgroundError('source-requests', `submitSourceRequest response parsing failed for ${url}`, error, {
          apiUrl: url,
          operation: 'submitSourceRequest.parseResponse'
        });
        return {};
      });
      if (!response.ok) {
        throw new Error(trimString(payload?.detail) || `HTTP ${response.status}`);
      }

      const requests = Array.isArray(payload?.requests)
        ? payload.requests
        : (payload?.request ? [payload.request] : []);
      state.sourceRequests = mergeRequests(state.sourceRequests, requests);
      clearTimeout(timeout);
      return payload;
    } catch (error) {
      if (error?.name === 'AbortError') {
        lastError = new Error('Source request timed out. Please try again.');
        break;
      }
      lastError = error;
    }
  }

  clearTimeout(timeout);
  throw lastError || new Error('Source request failed. Please try again.');
}
