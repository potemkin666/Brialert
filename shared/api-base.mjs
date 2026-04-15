/**
 * Centralised backend base URL for client-side API calls.
 *
 * Every frontend module that needs to talk to the Brialert backend should
 * import DEFAULT_API_BASE from here instead of hardcoding the URL.
 *
 * To point the frontend at a different backend, change this single constant.
 * The CSP connect-src in index.html must also be kept in sync.
 */
export const DEFAULT_API_BASE = 'https://brialertbackend.vercel.app';
