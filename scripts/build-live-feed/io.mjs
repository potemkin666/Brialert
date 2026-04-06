import fs from 'node:fs/promises';
import path from 'node:path';
import {
  BACKOFF_CAP_MS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT_MS,
  sourceUserAgent,
  RETRYABLE_STATUS_CODES,
  outputPath,
  repoRoot
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

function classifyBodyBlock(text = '') {
  const lower = String(text).toLowerCase();
  if (!lower) return '';
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
  ) return 'anti-bot protection';
  if (
    lower.includes('access denied') ||
    lower.includes('request blocked') ||
    lower.includes('forbidden')
  ) return 'blocked access page';
  return '';
}

export async function fetchText(url, attempt = 1, options = {}) {
  const source = options?.source || null;
  const configuredTimeoutMs = Number(source?.timeoutMs);
  const configuredMaxRetries = Number(source?.maxRetries);
  const timeoutMs = configuredTimeoutMs > 0 ? configuredTimeoutMs : DEFAULT_TIMEOUT_MS;
  const maxAttempts = configuredMaxRetries > 0 ? configuredMaxRetries : DEFAULT_MAX_RETRIES;
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
    throw new Error(`Circuit open for domain ${domain} until ${openUntil}`);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        ...mergedHeaders(source),
        ...conditionalHeaders
      },
      redirect: 'follow',
      // Intentionally avoid ambient cookies/session state to reduce auth-gated/geo/session bot challenges.
      credentials: 'omit',
      signal: controller.signal
    });
    const finalUrl = clean(response.url || url);
    const etag = clean(response.headers.get('etag'));
    const lastModified = clean(response.headers.get('last-modified'));
    if (!disableConditional && options?.requestState && cacheKey && (etag || lastModified)) {
      if (!options.requestState.conditionalCache || typeof options.requestState.conditionalCache !== 'object') {
        options.requestState.conditionalCache = {};
      }
      options.requestState.conditionalCache[cacheKey] = {
        etag: etag || null,
        lastModified: lastModified || null,
        updatedAt: new Date().toISOString()
      };
    }

    if (response.status === 304) {
      throw new Error('HTTP 304');
    }

    if (!response.ok) {
      if (RETRYABLE_STATUS_CODES.has(response.status) && attempt < maxAttempts) {
        const retryDelay = parseRetryAfterMs(response.headers.get('retry-after')) ?? jitteredBackoffMs(attempt);

        await sleep(retryDelay);
        return fetchText(url, attempt + 1, options);
      }
      const error = new Error(`HTTP ${response.status}`);
      error.__brialertMeta = {
        status: response.status,
        finalUrl
      };
      throw error;
    }

    const text = await response.text();
    const blockedClass = classifyBodyBlock(text);
    if (blockedClass) {
      throw new Error(`Blocked by ${blockedClass}`);
    }

    const payload = {
      text,
      finalUrl,
      status: response.status,
      etag: etag || null,
      lastModified: lastModified || null
    };
    if (domain && options?.requestState?.domainState && options.requestState.domainState[domain]) {
      options.requestState.domainState[domain] = {
        failures: 0,
        circuitOpenUntil: 0
      };
    }
    return options?.includeMeta ? payload : payload.text;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const retryable =
      message.includes('fetch failed') ||
      message.includes('aborted') ||
      message.includes('AbortError') ||
      message.includes('ECONNRESET') ||
      message.includes('ETIMEDOUT') ||
      message.includes('HTTP 304');

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
    throw new Error('Playwright fallback unavailable: install optional dependency "playwright" to enable browser fallback');
  }
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      userAgent: sourceUserAgent(options?.source),
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
      throw new Error(`Blocked by ${blockedClass}`);
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
  const meta = error && typeof error === 'object' ? error.__brialertMeta : null;
  let category = 'unknown';
  if (/HTTP 404|HTTP 410/i.test(message)) category = 'dead-or-moved-url';
  else if (/HTTP 403|HTTP 401|access denied|blocked/i.test(message)) category = 'blocked-or-auth';
  else if (/anti-bot|captcha|cloudflare|javascript and cookies/i.test(message)) category = 'anti-bot-protection';
  else if (/HTTP 301|HTTP 302|HTTP 307|HTTP 308/i.test(message)) category = 'moved-temporarily';
  else if (/HTTP \d{3}/i.test(message)) category = 'http-status-error';
  else if (/abort|timeout|timed out|ETIMEDOUT/i.test(message)) category = 'timeout';
  else if (/fetch failed|ECONNRESET|ENOTFOUND|circuit open/i.test(message)) category = 'network-failure';
  else if (/no items parsed|selector/i.test(message)) category = 'brittle-selectors-or-js-rendering';
  return {
    id: clean(source?.id) || 'unknown-source',
    provider: clean(source?.provider) || 'Unknown provider',
    endpoint: clean(source?.endpoint) || '',
    finalUrl: clean(meta?.finalUrl || ''),
    status: Number.isFinite(Number(meta?.status)) ? Number(meta.status) : null,
    message,
    category
  };
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
