function enabled() {
  try {
    if (typeof globalThis?.ALBERTALERT_DEBUG !== 'undefined') return Boolean(globalThis.ALBERTALERT_DEBUG);
    return typeof localStorage !== 'undefined' && localStorage.getItem('albertalert.debug') === 'true';
  } catch {
    return false;
  }
}

export function debugLog(scope, message, detail = null) {
  if (!enabled()) return;
  const suffix = detail ? ` | ${String(detail)}` : '';
  console.debug(`[${scope}] ${message}${suffix}`);
}

function diagnosticsHook() {
  return typeof globalThis?.ALBERTALERT_DIAGNOSTICS_HOOK === 'function'
    ? globalThis.ALBERTALERT_DIAGNOSTICS_HOOK
    : null;
}

export function reportBackgroundError(scope, message, error = null, context = null) {
  const detail = error instanceof Error ? error.message : (error ? String(error) : '');
  debugLog(scope, message, detail || null);
  const hook = diagnosticsHook();
  if (!hook) return;
  try {
    hook({ scope, message, detail, context });
  } catch {
    // Keep diagnostics non-intrusive and never break UI behavior.
  }
}
