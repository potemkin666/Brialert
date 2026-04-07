import {
  loadGeoLookup,
  loadLiveFeed,
  loadWatchGeography
} from '../../shared/feed-controller.mjs';
import { reportBackgroundError } from '../../shared/logger.mjs';

const LIVE_FEED_TRIGGER_API_URLS = [
  'https://brialertbackend.vercel.app/api/trigger-live-feed',
  'https://brialertbackend.vercel.app/api/trigger-feed-refresh',
  '/api/trigger-live-feed',
  '/api/trigger-feed-refresh'
];

async function triggerFeedRunVia(url) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'hero-refresh-button' })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(String(payload?.detail || `HTTP ${response.status}`));
    error.status = response.status;
    throw error;
  }
  return payload;
}

export function loadInitialResources(state, urls, normaliseAlert, onAfterLoad) {
  Promise.allSettled([
    loadGeoLookup(state, urls.geoLookupUrl),
    loadWatchGeography(state, urls.watchGeographyUrl)
  ]).finally(() => {
    loadLiveFeed(state, {
      liveFeedUrl: urls.liveFeedUrl,
      normaliseAlert,
      onAfterLoad
    });
  });
}

export function startFeedPolling(state, pollIntervalMs, liveFeedUrl, normaliseAlert, onAfterLoad) {
  return setInterval(() => {
    loadLiveFeed(state, {
      liveFeedUrl,
      normaliseAlert,
      onAfterLoad
    });
  }, pollIntervalMs);
}

export function refreshLiveFeedNow(state, liveFeedUrl, normaliseAlert, onAfterLoad) {
  return loadLiveFeed(state, {
    liveFeedUrl,
    normaliseAlert,
    onAfterLoad
  });
}

export async function triggerLiveFeedRun() {
  const failures = [];
  for (const apiUrl of LIVE_FEED_TRIGGER_API_URLS) {
    try {
      const payload = await triggerFeedRunVia(apiUrl);
      return { apiUrl, payload };
    } catch (error) {
      failures.push(`${apiUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const message = `Unable to trigger live-feed run. ${failures.join(' | ')}`;
  reportBackgroundError('feed', message, new Error(message), { operation: 'triggerLiveFeedRun' });
  throw new Error(message);
}
