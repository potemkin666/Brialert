const memoryStore = new Map();

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function resolveKvConfig() {
  const kvUrl = String(process.env.KV_REST_API_URL || '').trim();
  const kvToken = String(process.env.KV_REST_API_TOKEN || '').trim();
  return kvUrl && kvToken ? { kvUrl, kvToken } : null;
}

export function createJsonKvStore({ kvStore } = {}) {
  if (kvStore) return kvStore;

  const config = resolveKvConfig();
  if (config) {
    return {
      mode: 'kv',
      async getJson(key) {
        const response = await fetch(`${config.kvUrl}/get/${encodeURIComponent(String(key || ''))}`, {
          headers: { Authorization: `Bearer ${config.kvToken}` }
        });
        if (!response.ok) return null;
        const payload = await response.json();
        const result = payload?.result ?? null;
        if (result == null) return null;
        return typeof result === 'string' ? JSON.parse(result) : result;
      },
      async setJson(key, value, options = {}) {
        const encodedValue = encodeURIComponent(JSON.stringify(value));
        const ttlQuery = Number.isFinite(options?.ex) ? `?EX=${Math.max(1, Math.floor(options.ex))}` : '';
        const response = await fetch(`${config.kvUrl}/set/${encodeURIComponent(String(key || ''))}/${encodedValue}${ttlQuery}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${config.kvToken}` }
        });
        if (!response.ok) {
          throw new Error(`KV set failed with HTTP ${response.status}`);
        }
      }
    };
  }

  return {
    mode: 'memory',
    async getJson(key) {
      return cloneJson(memoryStore.get(String(key || '')));
    },
    async setJson(key, value) {
      memoryStore.set(String(key || ''), cloneJson(value));
    }
  };
}
