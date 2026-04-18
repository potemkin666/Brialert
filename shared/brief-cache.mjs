const CACHE_KEY_PREFIX = 'albertalert.longBrief.';

function cacheKey(alertId) {
  return `${CACHE_KEY_PREFIX}${alertId}`;
}

export function saveLongBrief(alertId, briefText, storage = globalThis?.sessionStorage) {
  if (!alertId || !briefText) return;
  try {
    storage?.setItem?.(cacheKey(alertId), briefText);
  } catch {
    // Ignore quota or write errors — caching is best-effort.
  }
}

export function loadLongBrief(alertId, storage = globalThis?.sessionStorage) {
  if (!alertId) return null;
  try {
    const value = storage?.getItem?.(cacheKey(alertId));
    return typeof value === 'string' && value.trim() ? value : null;
  } catch {
    return null;
  }
}
