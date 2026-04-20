const CACHE_KEY_PREFIX = 'albertalert.longBrief.';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_CACHED_BRIEFS = 50;

function cacheKey(alertId) {
  return `${CACHE_KEY_PREFIX}${alertId}`;
}

function metaKey(alertId) {
  return `${CACHE_KEY_PREFIX}${alertId}.__ts`;
}

/**
 * Evict expired or excess brief entries from storage.
 * Called automatically on save to keep localStorage bounded.
 */
function evictStaleBriefs(storage) {
  if (!storage) return;
  try {
    const entries = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && key.startsWith(CACHE_KEY_PREFIX) && key.endsWith('.__ts')) {
        const alertId = key.slice(CACHE_KEY_PREFIX.length, -5);
        const ts = Number(storage.getItem(key));
        entries.push({ alertId, ts: Number.isFinite(ts) ? ts : 0 });
      }
    }
    const now = Date.now();
    // Remove expired entries
    for (const { alertId, ts } of entries) {
      if (now - ts > CACHE_TTL_MS) {
        storage.removeItem(cacheKey(alertId));
        storage.removeItem(metaKey(alertId));
      }
    }
    // If still over limit, remove oldest
    const remaining = entries
      .filter(({ ts }) => now - ts <= CACHE_TTL_MS)
      .sort((a, b) => a.ts - b.ts);
    while (remaining.length > MAX_CACHED_BRIEFS) {
      const oldest = remaining.shift();
      storage.removeItem(cacheKey(oldest.alertId));
      storage.removeItem(metaKey(oldest.alertId));
    }
  } catch {
    // Eviction is best-effort — never break the caller.
  }
}

export function saveLongBrief(alertId, briefText, storage = globalThis?.localStorage) {
  if (!alertId || !briefText) return;
  try {
    evictStaleBriefs(storage);
    storage?.setItem?.(cacheKey(alertId), briefText);
    storage?.setItem?.(metaKey(alertId), String(Date.now()));
  } catch {
    // Ignore quota or write errors — caching is best-effort.
  }
}

export function loadLongBrief(alertId, storage = globalThis?.localStorage) {
  if (!alertId) return null;
  try {
    const ts = Number(storage?.getItem?.(metaKey(alertId)));
    if (Number.isFinite(ts) && Date.now() - ts > CACHE_TTL_MS) {
      // Expired — clean up and return null.
      try {
        storage?.removeItem?.(cacheKey(alertId));
        storage?.removeItem?.(metaKey(alertId));
      } catch { /* ignore */ }
      return null;
    }
    const value = storage?.getItem?.(cacheKey(alertId));
    return typeof value === 'string' && value.trim() ? value : null;
  } catch {
    return null;
  }
}
