/**
 * Centralised API base URL for the AlbertAlert backend.
 *
 * All frontend modules that need to call the backend should import from here
 * rather than hardcoding the URL.  The value can be overridden at runtime via
 * a `<meta name="albertalert-api-base">` tag in index.html or by setting
 * `globalThis.__ALBERTALERT_API_BASE`.
 *
 * @module api-config
 */

const DEFAULT_API_BASE = 'https://albertalertbackend.vercel.app';

function resolveApiBase() {
  // 1. Explicit global override (useful for tests / staging).
  if (typeof globalThis.__ALBERTALERT_API_BASE === 'string' && globalThis.__ALBERTALERT_API_BASE.trim()) {
    return globalThis.__ALBERTALERT_API_BASE.trim().replace(/\/+$/, '');
  }

  // 2. `<meta name="albertalert-api-base" content="…">` in the document.
  if (typeof document !== 'undefined') {
    const meta = document.querySelector('meta[name="albertalert-api-base"]');
    const value = meta?.getAttribute('content')?.trim();
    if (value) return value.replace(/\/+$/, '');
  }

  return DEFAULT_API_BASE;
}

/** The resolved API base URL (no trailing slash). */
export const API_BASE = resolveApiBase();
