function enabled() {
  try {
    if (typeof globalThis?.BRIALERT_DEBUG !== 'undefined') return Boolean(globalThis.BRIALERT_DEBUG);
    return typeof localStorage !== 'undefined' && localStorage.getItem('brialert.debug') === 'true';
  } catch {
    return false;
  }
}

export function debugLog(scope, message, detail = null) {
  if (!enabled()) return;
  const suffix = detail ? ` | ${String(detail)}` : '';
  console.debug(`[${scope}] ${message}${suffix}`);
}
