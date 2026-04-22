import {
  loadGeoLookup,
  loadLiveFeed,
  loadWatchGeography
} from '../../shared/feed-controller.mjs';
import { reportBackgroundError } from '../../shared/logger.mjs';
import { API_BASE } from '../../shared/api-config.mjs';

const MANUAL_REFRESH_POLL_INTERVAL_MS = 5_000;
const MANUAL_REFRESH_MAX_WAIT_MS = 90_000;

/* ── Exponential backoff constants ──
   On consecutive fetch failures the polling interval doubles each time
   (with jitter) up to a ceiling, then resets after a success. */
const BACKOFF_MAX_MS = 120_000;
const BACKOFF_JITTER_RATIO = 0.25;

export function nextBackoffDelay(baseMs, consecutiveFailures, maxMs = BACKOFF_MAX_MS, jitterRatio = BACKOFF_JITTER_RATIO) {
  const raw = Math.min(baseMs * Math.pow(2, consecutiveFailures), maxMs);
  const jitter = raw * jitterRatio * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(raw + jitter));
}

function currentOriginBase() {
  if (typeof window === 'undefined' || !window.location) return null;
  const origin = window.location.origin.trim();
  return origin.length > 0 ? origin : null;
}

const LIVE_FEED_TRIGGER_API_BASES = [
  API_BASE,
  currentOriginBase()
].filter(Boolean);
const LIVE_FEED_TRIGGER_API_PATHS = [
  '/api/trigger-live-feed',
  '/api/trigger-feed-refresh'
];
const MAX_FAILURE_PREVIEW_COUNT = 2;
const LIVE_FEED_TRIGGER_API_URLS = LIVE_FEED_TRIGGER_API_BASES
  .flatMap((base) => LIVE_FEED_TRIGGER_API_PATHS.map((path) => `${base}${path}`));

async function triggerFeedRunVia(url) {
  let payload = {};
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Albertalert-Csrf': '1'
    },
    credentials: 'include',
    body: JSON.stringify({ source: 'hero-refresh-button' })
  });
  payload = await response.json().catch((error) => {
    reportBackgroundError('feed', `Failed to parse trigger response from ${url}`, error, {
      operation: 'triggerFeedRunVia.parseResponse',
      url
    });
    return {};
  });
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
  let consecutiveFailures = 0;
  let timerId = null;

  function scheduleNext() {
    const delayMs = consecutiveFailures > 0
      ? nextBackoffDelay(pollIntervalMs, consecutiveFailures - 1, BACKOFF_MAX_MS)
      : pollIntervalMs;
    timerId = setTimeout(async () => {
      await loadLiveFeed(state, { liveFeedUrl, normaliseAlert, onAfterLoad });
      if (state.liveFeedFetchState === 'error') {
        consecutiveFailures += 1;
      } else {
        consecutiveFailures = 0;
      }
      scheduleNext();
    }, delayMs);
  }

  scheduleNext();
  return {
    clear() { clearTimeout(timerId); },
    get consecutiveFailures() { return consecutiveFailures; }
  };
}

export function refreshLiveFeedNow(state, liveFeedUrl, normaliseAlert, onAfterLoad) {
  return loadLiveFeed(state, {
    liveFeedUrl,
    normaliseAlert,
    onAfterLoad
  });
}

function feedGeneratedAtMs(state) {
  const value = state?.liveFeedGeneratedAt;
  if (!(value instanceof Date)) return NaN;
  const timeMs = value.getTime();
  return Number.isFinite(timeMs) ? timeMs : NaN;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function refreshLiveFeedUntilUpdated(
  state,
  liveFeedUrl,
  normaliseAlert,
  onAfterLoad,
  options = {}
) {
  const previousGeneratedAt = options.previousGeneratedAt instanceof Date
    ? options.previousGeneratedAt
    : state?.liveFeedGeneratedAt;
  const previousGeneratedAtMs = previousGeneratedAt instanceof Date
    ? previousGeneratedAt.getTime()
    : NaN;
  const pollIntervalMs = Number(options.pollIntervalMs || MANUAL_REFRESH_POLL_INTERVAL_MS);
  const maxWaitMs = Number(options.maxWaitMs || MANUAL_REFRESH_MAX_WAIT_MS);
  const deadline = Date.now() + Math.max(0, maxWaitMs);
  let attempts = 0;
  let consecutiveFailures = 0;

  while (attempts === 0 || Date.now() < deadline) {
    attempts += 1;
    await refreshLiveFeedNow(state, liveFeedUrl, normaliseAlert, onAfterLoad);
    const currentGeneratedAtMs = feedGeneratedAtMs(state);
    if (!Number.isFinite(previousGeneratedAtMs) || (Number.isFinite(currentGeneratedAtMs) && currentGeneratedAtMs > previousGeneratedAtMs)) {
      return {
        updated: true,
        attempts,
        generatedAt: state?.liveFeedGeneratedAt instanceof Date ? state.liveFeedGeneratedAt.toISOString() : null
      };
    }
    if (state.liveFeedFetchState === 'error') {
      consecutiveFailures += 1;
    } else {
      consecutiveFailures = 0;
    }
    if (Date.now() >= deadline) break;
    const waitMs = consecutiveFailures > 0
      ? nextBackoffDelay(pollIntervalMs, consecutiveFailures - 1, MANUAL_REFRESH_MAX_WAIT_MS)
      : pollIntervalMs;
    await delay(waitMs);
  }

  return {
    updated: false,
    attempts,
    generatedAt: state?.liveFeedGeneratedAt instanceof Date ? state.liveFeedGeneratedAt.toISOString() : null
  };
}

export async function triggerLiveFeedRun() {
  const failures = [];
  for (const apiUrl of LIVE_FEED_TRIGGER_API_URLS) {
    console.info(`[feed] Trigger start: ${apiUrl}`);
    try {
      const payload = await triggerFeedRunVia(apiUrl);
      console.info(`[feed] Trigger success: ${apiUrl}`);
      return { apiUrl, payload };
    } catch (error) {
      console.warn(`[feed] Trigger failed: ${apiUrl}`, error);
      failures.push(`${apiUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const previewFailures = failures.slice(0, MAX_FAILURE_PREVIEW_COUNT).join(' | ');
  const extraCount = Math.max(0, failures.length - MAX_FAILURE_PREVIEW_COUNT);
  const technicalMessage = `Unable to trigger live-feed run. ${previewFailures}${extraCount ? ` | +${extraCount} more failures` : ''}`;
  reportBackgroundError('feed', technicalMessage, new Error(technicalMessage), { operation: 'triggerLiveFeedRun' });
  throw new Error('Unable to trigger live-feed run automatically.');
}
