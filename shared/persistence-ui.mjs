import { debugLog } from './logger.mjs';

export function loadSet(key) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = JSON.parse(raw || '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter(Boolean) : []);
  } catch (error) {
    debugLog('persistence', `loadSet failed for ${key}`, error instanceof Error ? error.message : String(error));
    return new Set();
  }
}

export function saveSet(key, values) {
  try {
    localStorage.setItem(key, JSON.stringify([...values]));
  } catch (error) {
    debugLog('persistence', `saveSet failed for ${key}`, error instanceof Error ? error.message : String(error));
  }
}

export function loadArray(key, fallback = []) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = JSON.parse(raw || 'null');
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch (error) {
    debugLog('persistence', `loadArray failed for ${key}`, error instanceof Error ? error.message : String(error));
  }
  return Array.isArray(fallback) ? [...fallback] : [];
}

export function saveArray(key, values) {
  try {
    localStorage.setItem(key, JSON.stringify(values));
  } catch (error) {
    debugLog('persistence', `saveArray failed for ${key}`, error instanceof Error ? error.message : String(error));
  }
}

export function loadBoolean(key) {
  try {
    return localStorage.getItem(key) === 'true';
  } catch (error) {
    debugLog('persistence', `loadBoolean failed for ${key}`, error instanceof Error ? error.message : String(error));
    return false;
  }
}

export function saveBoolean(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch (error) {
    debugLog('persistence', `saveBoolean failed for ${key}`, error instanceof Error ? error.message : String(error));
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
