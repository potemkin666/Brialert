import fs from 'node:fs/promises';
import path from 'node:path';
import {
  BACKOFF_CAP_MS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT_MS,
  OFFLINE_FIXTURE_MODE,
  offlineFixturesPath,
  sourceUserAgent,
  randomBrowserUserAgent,
  RETRYABLE_STATUS_CODES,
  outputPath,
  repoRoot,
  PROXY_URL,
  PROXY_LIST,
  FEED_DISCOVERY_PATHS,
  HIGH_VALUE_MAX_RETRIES,
  FAST_FEED_TIMEOUT_MS,
  URL_PATH_ALTERNATIVES
} from './config.mjs';
import { clean } from '../../shared/taxonomy.mjs';

const MAX_RETRY_AFTER_MS = 60 * 60 * 1000;
const RESERVED_HEADER_KEYS = new Set([
  'user-agent',
  'accept',
  'accept-language',
  'cache-control',
  'accept-encoding',
  'upgrade-insecure-requests',
  'sec-fetch-site',
  'sec-fetch-mode',
  'sec-fetch-dest'
]);
const BOT_BLOCK_PATTERN = /anti-bot|captcha|cloudflare|javascript and cookies|security check|verify you are human|bot detected/i;
const CIRCUIT_TRIP_PATTERN = /HTTP 429|HTTP 503|HTTP 504|timed out|AbortError|fetch failed|ETIMEDOUT|anti-bot|captcha|cloudflare/i;
export const ERROR_CODE = Object.freeze({
  HTTP_304_EMPTY_CACHE: 'HTTP_304_EMPTY_CACHE',
  HTTP_NOT_FOUND_404: 'HTTP_NOT_FOUND_404',
  HTTP_GONE_410: 'HTTP_GONE_410',
  HTTP_REDIRECT_3XX: 'HTTP_REDIRECT_3XX',
  HTTP_BLOCKED_OR_AUTH: 'HTTP_BLOCKED_OR_AUTH',
  HTTP_STATUS_ERROR: 'HTTP_STATUS_ERROR',
  BLOCKED_ANTI_BOT: 'BLOCKED_ANTI_BOT',
  BLOCKED_ACCESS_PAGE: 'BLOCKED_ACCESS_PAGE',
  FETCH_TIMEOUT: 'FETCH_TIMEOUT',
  FETCH_NETWORK_FAILURE: 'FETCH_NETWORK_FAILURE',
  NETWORK_CIRCUIT_OPEN: 'NETWORK_CIRCUIT_OPEN',
  PLAYWRIGHT_UNAVAILABLE: 'PLAYWRIGHT_UNAVAILABLE',
  PARSER_SELECTOR_OR_JS_RENDERING: 'PARSER_SELECTOR_OR_JS_RENDERING'
});
const ERROR_CODE_VALUES = new Set(Object.values(ERROR_CODE));
const ERROR_CODE_TO_CATEGORY = Object.freeze({
  [ERROR_CODE.HTTP_304_EMPTY_CACHE]: 'http-status-error',
  [ERROR_CODE.HTTP_NOT_FOUND_404]: 'not-found-404',
  [ERROR_CODE.HTTP_GONE_410]: 'dead-or-moved-url',
  [ERROR_CODE.HTTP_BLOCKED_OR_AUTH]: 'blocked-or-auth',
  [ERROR_CODE.BLOCKED_ACCESS_PAGE]: 'blocked-or-auth',
  [ERROR_CODE.BLOCKED_ANTI_BOT]: 'anti-bot-protection',
  [ERROR_CODE.HTTP_STATUS_ERROR]: 'http-status-error',
  [ERROR_CODE.HTTP_REDIRECT_3XX]: 'moved-temporarily',
  [ERROR_CODE.FETCH_TIMEOUT]: 'timeout',
  [ERROR_CODE.FETCH_NETWORK_FAILURE]: 'network-failure',
  [ERROR_CODE.NETWORK_CIRCUIT_OPEN]: 'network-failure',
  [ERROR_CODE.PARSER_SELECTOR_OR_JS_RENDERING]: 'brittle-selectors-or-js-rendering'
});
let offlineFixtureCache = null;

function createBrialertError(message, meta = {}) {
  const error = new Error(message);
  error.__brialertMeta = {
    ...(meta && typeof meta === 'object' ? meta : {})
  };
  return error;
}

function safeErrorMeta(error) {
  const meta = error && typeof error === 'object' ? error.__brialertMeta : null;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  const proto = Object.getPrototypeOf(meta);
  if (proto !== Object.prototype && proto !== null) return null;
  return meta;
}

export function stripBom(text) {
  return typeof text === 'string' ? text.replace(/^\uFEFF/, '') : text;
}

export async function readJsonFile(jsonPath) {
  const raw = stripBom(await fs.readFile(jsonPath, 'utf8'));
  try {
    return JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse JSON at ${path.relative(repoRoot, jsonPath)}: ${message}`);
  }
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function mapWithConcurrency(items, limit, mapper) {
  if (!Array.isArray(items) || !items.length) return [];
  const concurrency = Math.max(1, Math.min(limit || 1, items.length));
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

export function arrayify(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export function absoluteUrl(href, base) {
  try {
    return new URL(href, base).toString();
  } catch {
    return base;
  }
}

export function parseSourceDate(rawDate) {
  if (!rawDate) return null;
  const parsed = new Date(rawDate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function jitteredBackoffMs(attempt, floor = 600) {
  const uncapped = 650 * Math.pow(2, Math.max(0, attempt - 1));
  const base = Math.max(floor, Math.min(BACKOFF_CAP_MS, uncapped));
  const jitter = Math.floor(base * (0.12 + Math.random() * 0.32));
  return base + jitter;
}

function parseRetryAfterMs(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  const asDate = Date.parse(String(value || ''));
  if (Number.isFinite(asDate)) {
    const delta = Math.min((asDate - Date.now()), MAX_RETRY_AFTER_MS);
    if (delta > 0) return delta;
  }
  return null;
}

async function loadOfflineFixtures() {
  if (!OFFLINE_FIXTURE_MODE) return null;
  if (offlineFixtureCache) return offlineFixtureCache;
  const payload = await readJsonFile(offlineFixturesPath);
  offlineFixtureCache = {
    sources: payload?.sources && typeof payload.sources === 'object' ? payload.sources : {},
    endpoints: payload?.endpoints && typeof payload.endpoints === 'object' ? payload.endpoints : {}
  };
  return offlineFixtureCache;
}

async function offlineFixtureResponse(url, options = {}) {
  if (!OFFLINE_FIXTURE_MODE) return null;
  const fixtures = await loadOfflineFixtures();
  const sourceId = clean(options?.source?.id);
  const endpoint = clean(url);
  const fixture = (sourceId && fixtures?.sources?.[sourceId]) || fixtures?.endpoints?.[endpoint];
  if (!fixture || typeof fixture !== 'object') {
    throw createBrialertError(`Offline fixture missing for source ${sourceId || 'unknown'} endpoint ${endpoint}`, {
      errorCode: ERROR_CODE.FETCH_NETWORK_FAILURE,
      finalUrl: endpoint
    });
  }
  if (clean(fixture.errorMessage)) {
    throw createBrialertError(clean(fixture.errorMessage), {
      errorCode: clean(fixture.errorCode) || ERROR_CODE.FETCH_NETWORK_FAILURE,
      finalUrl: clean(fixture.finalUrl || endpoint),
      status: Number.isFinite(Number(fixture.status)) ? Number(fixture.status) : null
    });
  }
  const bodyFile = clean(fixture.bodyFile);
  if (!bodyFile) {
    throw createBrialertError(`Offline fixture bodyFile missing for source ${sourceId || 'unknown'}`, {
      errorCode: ERROR_CODE.FETCH_NETWORK_FAILURE,
      finalUrl: endpoint
    });
  }
  const bodyPath = path.isAbsolute(bodyFile) ? bodyFile : path.join(repoRoot, bodyFile);
  const text = await fs.readFile(bodyPath, 'utf8');
  return {
    text,
    finalUrl: clean(fixture.finalUrl || endpoint),
    status: Number.isFinite(Number(fixture.status)) ? Number(fixture.status) : 200,
    unchanged304: false
  };
}

function endpointDomain(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function normaliseLanguageTag(value) {
  return clean(value).toLowerCase().replace('_', '-');
}

export function isEnglishLanguage(value) {
  const lang = normaliseLanguageTag(value);
  return !lang || lang === 'en' || lang.startsWith('en-');
}

function mergedHeaders(source = null) {
  const userHeaders = source?.headers && typeof source.headers === 'object' ? source.headers : {};
  const customHeaders = Object.fromEntries(
    Object.entries(userHeaders)
      .filter(([key]) => !RESERVED_HEADER_KEYS.has(String(key).toLowerCase()))
      .map(([key, value]) => [String(key).toLowerCase(), clean(value)])
      .filter(([, value]) => Boolean(value))
  );
  return {
    'user-agent': sourceUserAgent(source),
    accept: clean(userHeaders.accept) || 'application/feed+json, application/json;q=0.95, application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8',
    'accept-language': clean(source?.headers?.['accept-language']) || 'en-GB,en;q=0.9',
    'cache-control': clean(source?.headers?.['cache-control']) || 'no-cache',
    'accept-encoding': clean(userHeaders['accept-encoding']) || 'gzip, deflate, br',
    'upgrade-insecure-requests': clean(userHeaders['upgrade-insecure-requests']) || '1',
    'sec-fetch-site': clean(userHeaders['sec-fetch-site']) || 'none',
    'sec-fetch-mode': clean(userHeaders['sec-fetch-mode']) || 'navigate',
    'sec-fetch-dest': clean(userHeaders['sec-fetch-dest']) || 'document',
    ...customHeaders
  };
}

/**
 * Returns null when no block is detected, otherwise
 * returns an object: { message: string, code: ERROR_CODE }.
 */
function classifyBodyBlock(text = '') {
  const lower = String(text).toLowerCase();
  if (!lower) return null;
  if (
    lower.includes('attention required') ||
    lower.includes('cloudflare') ||
    lower.includes('captcha') ||
    lower.includes('cf-challenge') ||
    lower.includes('just a moment') ||
    lower.includes('enable javascript and cookies') ||
    lower.includes('security check') ||
    lower.includes('verify you are human') ||
    lower.includes('browser validation') ||
    lower.includes('ddos protection') ||
    lower.includes('suspicious activity') ||
    lower.includes('bot detected') ||
    lower.includes('please enable javascript')
  ) return { message: 'anti-bot protection', code: ERROR_CODE.BLOCKED_ANTI_BOT };
  if (
    lower.includes('access denied') ||
    lower.includes('request blocked') ||
    lower.includes('forbidden')
  ) return { message: 'blocked access page', code: ERROR_CODE.BLOCKED_ACCESS_PAGE };
  return null;
}

/**
 * Selects a proxy URL from the configured proxy list or single proxy URL.
 * Returns null when no proxy is configured.
 */
function selectProxyUrl() {
  if (PROXY_LIST.length) {
    return PROXY_LIST[Math.floor(Math.random() * PROXY_LIST.length)];
  }
  return PROXY_URL || null;
}

/**
 * Computes an adaptive timeout for a source based on its historical response
 * times and criticality.  High-value sources (incidents, trusted official)
 * get a longer timeout; fast RSS/Atom feeds get a shorter one.
 */
export function adaptiveTimeoutMs(source) {
  const explicit = Number(source?.timeoutMs);
  if (explicit > 0) return explicit;
  const isHighValue = source?.lane === 'incidents' || source?.isTrustedOfficial;
  const isFastFeed = source?.kind === 'rss' || source?.kind === 'atom' || source?.kind === 'json';
  if (isFastFeed && !isHighValue) return FAST_FEED_TIMEOUT_MS;
  return DEFAULT_TIMEOUT_MS;
}

/**
 * Returns the effective max retries for a source.  High-value sources
 * (incidents lane, trusted officials) receive extra retry attempts.
 */
export function adaptiveMaxRetries(source) {
  const explicit = Number(source?.maxRetries);
  if (explicit > 0) return explicit;
  const isHighValue = source?.lane === 'incidents' || source?.isTrustedOfficial;
  return isHighValue ? HIGH_VALUE_MAX_RETRIES : DEFAULT_MAX_RETRIES;
}

/**
 * Probes a list of common feed paths on the same domain to discover an
 * RSS/Atom feed.  Returns { feedUrl, feedKind } when a feed is found,
 * or null when no feed is discovered.
 */
export async function discoverFeedUrl(endpointUrl) {
  let origin;
  try {
    origin = new URL(endpointUrl).origin;
  } catch {
    return null;
  }
  for (const feedPath of FEED_DISCOVERY_PATHS) {
    const candidateUrl = feedPath.startsWith('?')
      ? `${origin}/${feedPath}`
      : `${origin}${feedPath}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(candidateUrl, {
        method: 'HEAD',
        redirect: 'follow',
        credentials: 'omit',
        signal: controller.signal,
        headers: { 'user-agent': randomBrowserUserAgent() }
      });
      clearTimeout(timeout);
      if (!response.ok) continue;
      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      if (
        contentType.includes('xml') ||
        contentType.includes('rss') ||
        contentType.includes('atom') ||
        contentType.includes('feed+json')
      ) {
        const feedKind = contentType.includes('atom') ? 'atom'
          : contentType.includes('feed+json') ? 'json'
            : 'rss';
        return { feedUrl: clean(response.url || candidateUrl), feedKind };
      }
    } catch {
      clearTimeout(timeout);
    }
  }
  // Also look for <link rel="alternate"> in the original HTML page
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const response = await fetch(endpointUrl, {
      redirect: 'follow',
      credentials: 'omit',
      signal: controller.signal,
      headers: { 'user-agent': randomBrowserUserAgent() }
    });
    clearTimeout(timeout);
    if (response.ok) {
      const html = await response.text();
      // Match <link> tags with type="application/rss+xml" or "application/atom+xml"
      // regardless of attribute order (type and href may appear in any sequence).
      const linkTagPattern = /<link\b[^>]*?(?:type=["']application\/(rss\+xml|atom\+xml)["'])[^>]*>/gi;
      const hrefPattern = /href=["']([^"']+)["']/i;
      let linkMatch;
      while ((linkMatch = linkTagPattern.exec(html)) !== null) {
        const hrefMatch = linkMatch[0].match(hrefPattern);
        if (hrefMatch) {
          const feedKind = linkMatch[1].includes('atom') ? 'atom' : 'rss';
          const feedUrl = absoluteUrl(hrefMatch[1], endpointUrl);
          return { feedUrl, feedKind };
        }
      }
    }
  } catch {
    // Discovery is best-effort
  }
  return null;
}

/**
 * Try URL path alternatives for a 404'd endpoint (Improvement 10).
 * Returns the first responding URL or null.
 */
export async function tryUrlAlternatives(endpointUrl) {
  let parsedUrl;
  try {
    parsedUrl = new URL(endpointUrl);
  } catch {
    return null;
  }
  const originalPath = parsedUrl.pathname;
  const candidates = [];

  // www prefix/removal
  if (parsedUrl.hostname.startsWith('www.')) {
    const alt = new URL(endpointUrl);
    alt.hostname = alt.hostname.replace(/^www\./, '');
    candidates.push(alt.toString());
  } else {
    const alt = new URL(endpointUrl);
    alt.hostname = `www.${alt.hostname}`;
    candidates.push(alt.toString());
  }

  // Path reorganisations
  for (const [from, to] of URL_PATH_ALTERNATIVES) {
    if (originalPath.includes(from)) {
      const alt = new URL(endpointUrl);
      alt.pathname = originalPath.replace(from, to);
      candidates.push(alt.toString());
    }
  }

  for (const candidateUrl of candidates) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(candidateUrl, {
        method: 'HEAD',
        redirect: 'follow',
        credentials: 'omit',
        signal: controller.signal,
        headers: { 'user-agent': randomBrowserUserAgent() }
      });
      clearTimeout(timeout);
      if (response.ok) return clean(response.url || candidateUrl);
    } catch {
      clearTimeout(timeout);
    }
  }
  return null;
}

export async function fetchText(url, attempt = 1, options = {}) {
  if (OFFLINE_FIXTURE_MODE) {
    const offlinePayload = await offlineFixtureResponse(url, options);
    return options?.includeMeta ? offlinePayload : offlinePayload.text;
  }
  const source = options?.source || null;
  const timeoutMs = adaptiveTimeoutMs(source);
  const maxAttempts = adaptiveMaxRetries(source);
  const endpoint = clean(url);
  const domain = endpointDomain(endpoint);
  const existingState = options?.requestState && typeof options.requestState === 'object'
    ? options.requestState
    : {};
  const domainState = existingState.domainState && typeof existingState.domainState === 'object'
    ? existingState.domainState
    : {};
  const conditionalHeaders = {};
  const cacheKey = domain || endpoint;
  const disableConditional = source?.disableConditionalHeaders === true || source?.kind === 'html';
  const priorCache = disableConditional ? null : existingState.conditionalCache?.[cacheKey];
  if (priorCache?.etag) conditionalHeaders['if-none-match'] = clean(priorCache.etag);
  if (priorCache?.lastModified) conditionalHeaders['if-modified-since'] = clean(priorCache.lastModified);
  if (domain && domainState[domain]?.circuitOpenUntil && Date.now() < Number(domainState[domain].circuitOpenUntil || 0)) {
    const openUntil = new Date(Number(domainState[domain].circuitOpenUntil)).toISOString();
    throw createBrialertError(`Circuit open for domain ${domain} until ${openUntil}`, {
      errorCode: ERROR_CODE.NETWORK_CIRCUIT_OPEN,
      finalUrl: endpoint
    });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const retryHeaders = attempt > 1 ? { 'user-agent': randomBrowserUserAgent() } : {};
    const response = await fetch(url, {
      headers: {
        ...mergedHeaders(source),
        ...conditionalHeaders,
        ...retryHeaders
      },
      redirect: 'follow',
      // Intentionally avoid ambient cookies/session state to reduce auth-gated/geo/session bot challenges.
      credentials: 'omit',
      signal: controller.signal
    });
    const finalUrl = clean(response.url || url);
    const etag = clean(response.headers.get('etag'));
    const lastModified = clean(response.headers.get('last-modified'));
    if (response.status === 304) {
      const cachedText = typeof priorCache?.text === 'string' ? priorCache.text : '';
      if (!cachedText) {
        throw createBrialertError('HTTP 304 with empty cache', {
          errorCode: ERROR_CODE.HTTP_304_EMPTY_CACHE,
          status: response.status,
          finalUrl
        });
      }
      if (!disableConditional && options?.requestState && cacheKey) {
        if (!options.requestState.conditionalCache || typeof options.requestState.conditionalCache !== 'object') {
          options.requestState.conditionalCache = {};
        }
        const nextEtag = etag || priorCache?.etag || null;
        const nextLastModified = lastModified || priorCache?.lastModified || null;
        options.requestState.conditionalCache[cacheKey] = {
          etag: nextEtag,
          lastModified: nextLastModified,
          text: cachedText,
          updatedAt: new Date().toISOString()
        };
        if (!nextEtag && !nextLastModified) {
          console.warn(`HTTP 304 cache refresh missing validators for ${cacheKey}; reusing cached body only.`);
        }
      }
      const payload = {
        text: cachedText,
        finalUrl,
        status: response.status,
        etag: etag || null,
        lastModified: lastModified || null,
        unchanged304: true
      };
      return options?.includeMeta ? payload : payload.text;
    }

    if (!response.ok) {
      if (RETRYABLE_STATUS_CODES.has(response.status) && attempt < maxAttempts) {
        const retryDelay = parseRetryAfterMs(response.headers.get('retry-after')) ?? jitteredBackoffMs(attempt);

        await sleep(retryDelay);
        return fetchText(url, attempt + 1, options);
      }
      const errorCode = response.status === 404
        ? ERROR_CODE.HTTP_NOT_FOUND_404
        : response.status === 410
          ? ERROR_CODE.HTTP_GONE_410
          : (response.status === 401 || response.status === 403)
            ? ERROR_CODE.HTTP_BLOCKED_OR_AUTH
            : ERROR_CODE.HTTP_STATUS_ERROR;
      throw createBrialertError(`HTTP ${response.status}`, {
        errorCode,
        status: response.status,
        finalUrl
      });
    }

    const text = await response.text();
    const blockedClass = classifyBodyBlock(text);
    if (blockedClass) {
      throw createBrialertError(`Blocked by ${blockedClass.message}`, {
        errorCode: blockedClass.code,
        status: response.status,
        finalUrl
      });
    }

    const payload = {
      text,
      finalUrl,
      status: response.status,
      etag: etag || null,
      lastModified: lastModified || null
    };
    if (!disableConditional && options?.requestState && cacheKey) {
      if (!options.requestState.conditionalCache || typeof options.requestState.conditionalCache !== 'object') {
        options.requestState.conditionalCache = {};
      }
      options.requestState.conditionalCache[cacheKey] = {
        etag: etag || null,
        lastModified: lastModified || null,
        text,
        updatedAt: new Date().toISOString()
      };
    }
    if (domain && options?.requestState?.domainState && options.requestState.domainState[domain]) {
      options.requestState.domainState[domain] = {
        failures: 0,
        circuitOpenUntil: 0
      };
    }
    return options?.includeMeta ? payload : payload.text;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const existingMeta = safeErrorMeta(error);
    const derivedErrorCode = resolveErrorCode(existingMeta, message);
    if (error && typeof error === 'object' && derivedErrorCode && (!existingMeta || !existingMeta.errorCode)) {
      error.__brialertMeta = {
        ...(existingMeta && typeof existingMeta === 'object' ? existingMeta : {}),
        errorCode: derivedErrorCode
      };
    }
    const retryable =
      message.includes('fetch failed') ||
      message.includes('aborted') ||
      message.includes('AbortError') ||
      message.includes('ECONNRESET') ||
      message.includes('ETIMEDOUT');

    if (retryable && attempt < maxAttempts) {
      await sleep(jitteredBackoffMs(attempt));
      return fetchText(url, attempt + 1, options);
    }

    if (domain && options?.requestState) {
      if (!options.requestState.domainState || typeof options.requestState.domainState !== 'object') {
        options.requestState.domainState = {};
      }
      const current = options.requestState.domainState[domain] && typeof options.requestState.domainState[domain] === 'object'
        ? options.requestState.domainState[domain]
        : { failures: 0, circuitOpenUntil: 0 };
      const nextFailures = Number(current.failures || 0) + 1;
      const isBotBlock = BOT_BLOCK_PATTERN.test(message);
      const shouldTrip = nextFailures >= (isBotBlock ? 6 : 4) && CIRCUIT_TRIP_PATTERN.test(message);
      options.requestState.domainState[domain] = {
        failures: nextFailures,
        circuitOpenUntil: shouldTrip ? Date.now() + ((isBotBlock ? 5 : 10) * 60 * 1000) : Number(current.circuitOpenUntil || 0)
      };
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchTextWithPlaywright(url, options = {}) {
  const timeoutMs = Math.max(5000, Number(options?.timeoutMs || DEFAULT_TIMEOUT_MS));
  const playwright = await import('playwright').catch(() => null);
  if (!playwright?.chromium) {
    throw createBrialertError('Playwright fallback unavailable: install optional dependency "playwright" to enable browser fallback', {
      errorCode: ERROR_CODE.PLAYWRIGHT_UNAVAILABLE
    });
  }
  const proxyUrl = selectProxyUrl();
  const launchOptions = { headless: true };
  if (proxyUrl) launchOptions.proxy = { server: proxyUrl };
  const browser = await playwright.chromium.launch(launchOptions);
  try {
    const context = await browser.newContext({
      userAgent: randomBrowserUserAgent(),
      locale: 'en-GB'
    });
    const page = await context.newPage();
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs
    });
    const html = await page.content();
    const blockedClass = classifyBodyBlock(html);
    if (blockedClass) {
      throw createBrialertError(`Blocked by ${blockedClass.message}`, {
        errorCode: blockedClass.code,
        finalUrl: clean(page.url() || url)
      });
    }
    return html;
  } finally {
    await browser.close().catch(() => {});
  }
}

export async function readExisting() {
  try {
    return await readJsonFile(outputPath);
  } catch {
    return null;
  }
}

export function summariseSourceError(source, error) {
  const message = error instanceof Error ? error.message : String(error);
  const meta = safeErrorMeta(error);
  const resolvedErrorCode = resolveErrorCode(meta, message);
  let category = resolvedErrorCode ? (ERROR_CODE_TO_CATEGORY[resolvedErrorCode] || 'unknown') : 'unknown';
  if (category === 'unknown' && /HTTP 304/i.test(message)) category = 'unchanged-304';
  else if (category === 'unknown' && /HTTP 301|HTTP 302|HTTP 307|HTTP 308/i.test(message)) category = 'moved-temporarily';
  else if (category === 'unknown' && /HTTP 403|HTTP 401|access denied|blocked/i.test(message)) category = 'blocked-or-auth';
  else if (category === 'unknown' && /anti-bot|captcha|cloudflare|javascript and cookies/i.test(message)) category = 'anti-bot-protection';
  else if (category === 'unknown' && /HTTP \d{3}/i.test(message)) category = 'http-status-error';
  else if (category === 'unknown' && /abort|timeout|timed out|ETIMEDOUT/i.test(message)) category = 'timeout';
  else if (category === 'unknown' && /fetch failed|ECONNRESET|ENOTFOUND|circuit open/i.test(message)) category = 'network-failure';
  else if (category === 'unknown' && /no items parsed|selector/i.test(message)) category = 'brittle-selectors-or-js-rendering';
  return {
    id: clean(source?.id) || 'unknown-source',
    provider: clean(source?.provider) || 'Unknown provider',
    endpoint: clean(source?.endpoint) || '',
    finalUrl: clean(meta?.finalUrl || ''),
    status: Number.isFinite(Number(meta?.status)) ? Number(meta.status) : null,
    message,
    errorCode: resolvedErrorCode || '',
    category
  };
}

function resolveErrorCode(meta, message) {
  const explicitCode = typeof meta?.errorCode === 'string' ? meta.errorCode : '';
  if (explicitCode && ERROR_CODE_VALUES.has(explicitCode)) return explicitCode;
  const status = Number(meta?.status);
  if (Number.isFinite(status)) {
    if (status === 404) return ERROR_CODE.HTTP_NOT_FOUND_404;
    if (status === 410) return ERROR_CODE.HTTP_GONE_410;
    if (status === 401 || status === 403) return ERROR_CODE.HTTP_BLOCKED_OR_AUTH;
    if ([301, 302, 307, 308].includes(status)) return ERROR_CODE.HTTP_REDIRECT_3XX;
    return ERROR_CODE.HTTP_STATUS_ERROR;
  }
  const text = String(message || '');
  if (/HTTP 304 with empty cache/i.test(text)) return ERROR_CODE.HTTP_304_EMPTY_CACHE;
  if (/HTTP 404/i.test(text)) return ERROR_CODE.HTTP_NOT_FOUND_404;
  if (/HTTP 410/i.test(text)) return ERROR_CODE.HTTP_GONE_410;
  if (/HTTP 301|HTTP 302|HTTP 307|HTTP 308/i.test(text)) return ERROR_CODE.HTTP_REDIRECT_3XX;
  if (/HTTP 403|HTTP 401|access denied|blocked/i.test(text)) return ERROR_CODE.HTTP_BLOCKED_OR_AUTH;
  if (/anti-bot|captcha|cloudflare|javascript and cookies/i.test(text)) return ERROR_CODE.BLOCKED_ANTI_BOT;
  if (/abort|timeout|timed out|ETIMEDOUT/i.test(text)) return ERROR_CODE.FETCH_TIMEOUT;
  if (/fetch failed|ECONNRESET|ENOTFOUND|circuit open/i.test(text)) return ERROR_CODE.FETCH_NETWORK_FAILURE;
  if (/no items parsed|selector/i.test(text)) return ERROR_CODE.PARSER_SELECTOR_OR_JS_RENDERING;
  return '';
}

export function normaliseSourcesPayload(rawSources) {
  const sources = Array.isArray(rawSources)
    ? rawSources
    : Array.isArray(rawSources?.sources)
      ? rawSources.sources
      : null;
  if (!sources) {
    throw new Error('Expected sources.json to contain an array or { sources: [] }.');
  }
  const seen = new Set();
  const seenEndpoints = new Set();
  const duplicates = [];
  const duplicateEndpoints = [];
  const unique = [];
  for (const source of sources) {
    const id = clean(source?.id);
    const endpointKey = normalisedEndpointKey(source?.endpoint);
    if (!id) {
      if (endpointKey && seenEndpoints.has(endpointKey)) {
        duplicateEndpoints.push(endpointKey);
        continue;
      }
      if (endpointKey) seenEndpoints.add(endpointKey);
      unique.push(source);
      continue;
    }
    if (seen.has(id)) {
      duplicates.push(id);
      continue;
    }
    if (endpointKey && seenEndpoints.has(endpointKey)) {
      duplicateEndpoints.push(endpointKey);
      continue;
    }
    seen.add(id);
    if (endpointKey) seenEndpoints.add(endpointKey);
    unique.push(source);
  }
  if (duplicates.length) {
    const uniqueDuplicates = [...new Set(duplicates)];
    console.warn(`Skipped ${duplicates.length} duplicate source entries across ${uniqueDuplicates.length} source id(s): ${uniqueDuplicates.join(', ')}`);
  }
  if (duplicateEndpoints.length) {
    const uniqueEndpointDuplicates = [...new Set(duplicateEndpoints)];
    console.warn(`Skipped ${duplicateEndpoints.length} duplicate source entries across ${uniqueEndpointDuplicates.length} normalized endpoint(s).`);
  }
  return unique;
}

export function normaliseSourceRequestsPayload(rawRequests) {
  if (rawRequests == null) return [];
  const requests = Array.isArray(rawRequests)
    ? rawRequests
    : Array.isArray(rawRequests?.requests)
      ? rawRequests.requests
      : null;
  if (!requests) {
    throw new Error('Expected source-requests.json to contain an array or { requests: [] }.');
  }
  return normaliseSourcesPayload(requests);
}

function normalisedEndpointKey(endpoint) {
  try {
    const url = new URL(clean(endpoint));
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return clean(endpoint).replace(/\/$/, '');
  }
}

export function mergeSourceCatalogs(baseSources, requestedSources) {
  const merged = [];
  const seenIds = new Set();
  const seenEndpoints = new Set();

  for (const source of [...(Array.isArray(baseSources) ? baseSources : []), ...(Array.isArray(requestedSources) ? requestedSources : [])]) {
    const id = clean(source?.id);
    const endpointKey = normalisedEndpointKey(source?.endpoint);
    if ((id && seenIds.has(id)) || (endpointKey && seenEndpoints.has(endpointKey))) continue;
    if (id) seenIds.add(id);
    if (endpointKey) seenEndpoints.add(endpointKey);
    merged.push(source);
  }

  return merged;
}
