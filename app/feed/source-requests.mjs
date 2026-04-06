import { reportBackgroundError } from '../../shared/logger.mjs';

const SOURCE_REQUEST_TIMEOUT_MS = 12_000;
const SOURCE_REQUEST_WINDOW_MS = 5 * 60 * 1000;
const SOURCE_REQUEST_MAX_PER_WINDOW = 3;
const SOURCE_REQUEST_COOLDOWN_MS = 15_000;

const sourceRequestRateState = {
  recentAttemptsMs: [],
  lastAttemptAtMs: 0
};

function clean(value) {
  return String(value || '').trim();
}

function normaliseRequestUrl(value) {
  let parsed;
  try {
    parsed = new URL(clean(value));
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
  sourceRequestRateState.recentAttemptsMs = sourceRequestRateState.recentAttemptsMs.filter(
    (attemptMs) => nowMs - attemptMs < SOURCE_REQUEST_WINDOW_MS
  );

  if (
    sourceRequestRateState.lastAttemptAtMs
    && (nowMs - sourceRequestRateState.lastAttemptAtMs) < SOURCE_REQUEST_COOLDOWN_MS
  ) {
    throw new Error('Please wait a few seconds before sending another source request.');
  }

  if (sourceRequestRateState.recentAttemptsMs.length >= SOURCE_REQUEST_MAX_PER_WINDOW) {
    throw new Error('Too many source requests sent from this browser. Please try again in a few minutes.');
  }

  sourceRequestRateState.lastAttemptAtMs = nowMs;
  sourceRequestRateState.recentAttemptsMs.push(nowMs);
}

function normalisedEndpointKey(endpoint) {
  try {
    const url = new URL(clean(endpoint));
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return clean(endpoint).replace(/\/$/, '');
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
  try {
    const response = await fetch(`${apiUrl}?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const requests = Array.isArray(payload?.requests) ? payload.requests : [];
    state.sourceRequests = mergeRequests(state.sourceRequests, requests);
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

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: controller.signal,
    body: JSON.stringify({ url: normalizedUrl, regionHint })
  }).catch((error) => {
    if (error?.name === 'AbortError') {
      throw new Error('Source request timed out. Please try again.');
    }
    throw error;
  }).finally(() => {
    clearTimeout(timeout);
  });

  const payload = await response.json().catch((error) => {
    reportBackgroundError('source-requests', `submitSourceRequest response parsing failed for ${apiUrl}`, error, {
      apiUrl,
      operation: 'submitSourceRequest.parseResponse'
    });
    return {};
  });
  if (!response.ok) {
    throw new Error(clean(payload?.detail) || `HTTP ${response.status}`);
  }

  const requests = Array.isArray(payload?.requests)
    ? payload.requests
    : (payload?.request ? [payload.request] : []);
  state.sourceRequests = mergeRequests(state.sourceRequests, requests);
  return payload;
}
