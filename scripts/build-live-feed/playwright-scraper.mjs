import { chromium } from 'playwright';
import { clean, plainText } from '../../shared/taxonomy.mjs';
import {
  DEFAULT_PLAYWRIGHT_TIMEOUT_MS,
  MAX_HTML_CANDIDATES_PER_SOURCE
} from './config.mjs';
import { absoluteUrl } from './io.mjs';

function collectCandidateFromElement(endpoint, element) {
  const href = clean(element?.href);
  const title = plainText(element?.title || element?.text || '');
  if (!href || !title || title.length < 18) return null;

  const summary = plainText(element?.summary || element?.containerText || '').slice(0, 420);
  const published = clean(element?.published || '');
  return {
    title,
    link: absoluteUrl(href, endpoint),
    summary,
    published
  };
}

export async function scrapePlaywrightHtmlItems(source) {
  const configuredTimeoutMs = Number(source?.timeoutMs);
  const timeoutMs = configuredTimeoutMs > 0 ? configuredTimeoutMs : DEFAULT_PLAYWRIGHT_TIMEOUT_MS;
  const endpoint = clean(source?.endpoint);
  if (!endpoint) return [];

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      userAgent: clean(source?.headers?.['user-agent']) || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 900 },
      locale: 'en-GB'
    });
    const page = await context.newPage();
    await page.goto(endpoint, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs
    });
    await page.waitForTimeout(1200);

    const rawCandidates = await page.evaluate((selectors) => {
      const unique = new Set();
      const result = [];
      for (const selector of selectors) {
        const nodes = Array.from(document.querySelectorAll(selector));
        for (const node of nodes) {
          const anchor = node instanceof HTMLAnchorElement ? node : node.querySelector('a[href]');
          if (!anchor) continue;
          const href = (anchor.getAttribute('href') || '').trim();
          const text = (anchor.textContent || '').trim();
          if (!href || !text) continue;
          if (href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) continue;
          const container = anchor.closest('article,li,section,div') || anchor.parentElement;
          const containerText = (container?.textContent || '').trim();
          const publishedNode = container?.querySelector('time');
          const published = (publishedNode?.getAttribute('datetime') || publishedNode?.textContent || '').trim();
          const key = `${text}|${href}`;
          if (unique.has(key)) continue;
          unique.add(key);
          result.push({ href, text, containerText, published });
          if (result.length >= 60) return result;
        }
      }
      return result;
    }, Array.isArray(source?.selectors) && source.selectors.length
      ? source.selectors
      : [
          'article a[href]',
          '[class*="article"] a[href]',
          '[class*="story"] a[href]',
          '[class*="post"] a[href]',
          'main a[href]',
          'h2 a[href]',
          'h3 a[href]',
          'a[href]'
        ]);

    const candidates = [];
    for (const raw of rawCandidates) {
      const item = collectCandidateFromElement(endpoint, raw);
      if (!item) continue;
      candidates.push(item);
      if (candidates.length >= MAX_HTML_CANDIDATES_PER_SOURCE) break;
    }

    await context.close();
    return candidates;
  } finally {
    await browser.close();
  }
}
