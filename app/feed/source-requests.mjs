import { reportBackgroundError } from '../../shared/logger.mjs';

function clean(value) {
  return String(value || '').trim();
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
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, regionHint })
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
