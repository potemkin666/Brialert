import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const runE2E = process.env.BRIALERT_RUN_E2E === 'true';

let server;
let baseUrl = '';

function contentTypeFor(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) return 'image/jpeg';
  if (filePath.endsWith('.webmanifest')) return 'application/manifest+json; charset=utf-8';
  return 'text/plain; charset=utf-8';
}

async function startStaticServer() {
  server = http.createServer(async (req, res) => {
    try {
      const requestPath = new URL(req.url || '/', 'http://localhost').pathname;
      const safePath = requestPath === '/' ? '/index.html' : requestPath;
      const fullPath = path.join(repoRoot, decodeURIComponent(safePath));
      const normalized = path.normalize(fullPath);
      if (!normalized.startsWith(repoRoot)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      const data = await fs.readFile(normalized);
      res.writeHead(200, { 'content-type': contentTypeFor(normalized) });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
}

async function stopStaticServer() {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
  server = null;
}

test.before(async () => {
  if (!runE2E) return;
  await startStaticServer();
});

test.after(async () => {
  await stopStaticServer();
});

test('e2e dashboard/map/watchlists flow renders and updates', { skip: !runE2E }, async (t) => {
  let browser;
  try {
    browser = await chromium.launch();
  } catch (error) {
    t.skip(`Playwright browser unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route('**/live-alerts.json*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: '2026-04-live-feed-v1',
        generatedAt: '2026-04-04T10:00:00.000Z',
        sourceCount: 12,
        alertCount: 1,
        alerts: [{
          id: 'test-alert-1',
          fusedIncidentId: 'fusion-test-1',
          title: 'Responder alert',
          location: 'London',
          region: 'uk',
          lane: 'incidents',
          severity: 'high',
          status: 'Update',
          source: 'CT Policing',
          sourceUrl: 'https://example.test/a1',
          queueBucket: 'responder',
          queueReason: 'Trigger-tier terrorism incident candidate',
          summary: 'Responder alert summary',
          time: '04 Apr 2026, 10:00',
          publishedAt: '2026-04-04T10:00:00.000Z',
          lat: 51.5,
          lng: -0.12
        }],
        runMetrics: { coverage: { checked: 12 } },
        health: {
          lastSuccessfulSourceCount: 12,
          lastAttemptedRefreshTime: '2026-04-04T10:00:00.000Z'
        }
      })
    });
  });

  await page.goto(`${baseUrl}/index.html`);
  await page.waitForSelector('#feed-list .feed-card');
  await page.click('#feed-list .star-button');
  await page.click('[data-tab="watchlists"]');
  await page.waitForSelector('#watchlist-list [data-watch]');
  const summaryText = await page.locator('#watchlist-summary').textContent();
  assert.match(summaryText || '', /tracked/i);

  await page.click('[data-tab="map"]');
  await page.waitForSelector('#map-status-line');
  const mapStatus = await page.locator('#map-status-line').textContent();
  assert.match(mapStatus || '', /alert/i);

  await browser.close();
});

test('e2e quarantine restore flow loads and restores source', { skip: !runE2E }, async (t) => {
  let browser;
  try {
    browser = await chromium.launch();
  } catch (error) {
    t.skip(`Playwright browser unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route('**/api/auth/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        authenticated: true,
        user: { login: 'admin' },
        loginUrl: '/api/auth/github/start',
        logoutUrl: '/api/auth/logout'
      })
    });
  });
  await page.route('**/api/quarantined-sources', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        restoreAvailable: true,
        generatedAt: '2026-04-04T10:00:00.000Z',
        count: 1,
        sources: [{
          id: 'source-1',
          provider: 'Test source',
          endpoint: 'https://example.test/feed',
          kind: 'rss',
          lane: 'context',
          region: 'uk',
          status: 'auto-quarantined',
          reason: 'Needs review',
          replacementSuggestion: 'https://example.test/new-feed'
        }]
      })
    });
  });
  await page.route('**/api/restore-source', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, restoredSource: { id: 'source-1' } })
    });
  });

  await page.goto(`${baseUrl}/source-quarantine.html`);
  await page.waitForSelector('tr[data-source-id="source-1"]');
  await page.click('tr[data-source-id="source-1"] button[data-action="restore"]');
  await page.waitForSelector('#toast.visible');
  const toast = await page.locator('#toast').textContent();
  assert.match(toast || '', /restored/i);

  await browser.close();
});
