import { reportBackgroundError } from './logger.mjs';

let storageWarningShown = false;

/**
 * Show a transient user-visible banner when localStorage writes fail.
 * Only fires once per session to avoid spamming the user.
 */
function notifyStorageFailure() {
  if (storageWarningShown) return;
  storageWarningShown = true;
  try {
    if (typeof document === 'undefined') return;
    const banner = document.createElement('div');
    banner.setAttribute('role', 'alert');
    banner.setAttribute('aria-live', 'assertive');
    banner.textContent = 'Storage full — some data could not be saved. Try clearing old notes or watchlist items.';
    Object.assign(banner.style, {
      position: 'fixed',
      bottom: '0',
      left: '0',
      right: '0',
      zIndex: '9999',
      background: '#d53d2f',
      color: '#fff',
      padding: '10px 16px',
      fontSize: '14px',
      textAlign: 'center',
      fontFamily: 'system-ui, sans-serif'
    });
    document.body.appendChild(banner);
    setTimeout(() => { banner.remove(); }, 8000);
  } catch {
    // If we can't show the banner, fail silently — we already logged the error.
  }
}

export function loadSet(key) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = JSON.parse(raw || '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter(Boolean) : []);
  } catch (error) {
    reportBackgroundError('persistence', `loadSet failed for ${key}`, error, { key, operation: 'loadSet' });
    return new Set();
  }
}

export function saveSet(key, values) {
  try {
    localStorage.setItem(key, JSON.stringify([...values]));
    return true;
  } catch (error) {
    reportBackgroundError('persistence', `saveSet failed for ${key}`, error, { key, operation: 'saveSet' });
    notifyStorageFailure();
    return false;
  }
}

export function loadArray(key, fallback = []) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = JSON.parse(raw || 'null');
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch (error) {
    reportBackgroundError('persistence', `loadArray failed for ${key}`, error, { key, operation: 'loadArray' });
  }
  return Array.isArray(fallback) ? [...fallback] : [];
}

export function saveArray(key, values) {
  try {
    localStorage.setItem(key, JSON.stringify(values));
    return true;
  } catch (error) {
    reportBackgroundError('persistence', `saveArray failed for ${key}`, error, { key, operation: 'saveArray' });
    notifyStorageFailure();
    return false;
  }
}

export function loadBoolean(key) {
  try {
    return localStorage.getItem(key) === 'true';
  } catch (error) {
    reportBackgroundError('persistence', `loadBoolean failed for ${key}`, error, { key, operation: 'loadBoolean' });
    return false;
  }
}

export function saveBoolean(key, value) {
  try {
    localStorage.setItem(key, String(value));
    return true;
  } catch (error) {
    reportBackgroundError('persistence', `saveBoolean failed for ${key}`, error, { key, operation: 'saveBoolean' });
    notifyStorageFailure();
    return false;
  }
}

export function nextAlbertQuote(quotes, currentIndex) {
  if (!quotes.length) return { quote: '', index: -1 };
  if (quotes.length === 1) {
    return { quote: quotes[0], index: 0 };
  }
  let nextIndex = Math.floor(Math.random() * quotes.length);
  while (nextIndex === currentIndex) {
    nextIndex = Math.floor(Math.random() * quotes.length);
  }
  return { quote: quotes[nextIndex], index: nextIndex };
}

export function dailyBriefingQuote(quotes, now = new Date()) {
  if (!quotes || !quotes.length) return '';
  const start = new Date(now.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((now - start) / 86_400_000);
  return quotes[dayOfYear % quotes.length];
}

export function setActiveTab(next, elements, callbacks) {
  const { tabbar } = elements;
  tabbar.querySelectorAll('.tab').forEach((item) => item.classList.toggle('active', item.dataset.tab === next));
  document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === next));
  if (typeof callbacks?.onTabChange === 'function') callbacks.onTabChange(next);
}

export function applyBriefingMode(briefingMode, elements, callbacks) {
  const { screen } = elements;
  screen.classList.toggle('briefing-mode', briefingMode);
  if (briefingMode) {
    callbacks?.setActiveTab?.('firstalert');
    callbacks?.closeDetailPanel?.();
  }
}
