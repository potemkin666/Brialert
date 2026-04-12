import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const outputPath = path.join(repoRoot, 'live-alerts.json');

function fail(message) {
  throw new Error(`live-alerts.json integrity failure: ${message}`);
}

function validUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

async function main() {
  const raw = await fs.readFile(outputPath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`invalid JSON (${message})`);
  }

  if (!parsed || typeof parsed !== 'object') fail('payload is not an object');
  if (parsed.schemaVersion != null && parsed.schemaVersion !== '2026-04-live-feed-v1') {
    fail('schemaVersion must be 2026-04-live-feed-v1 when provided');
  }
  if (!Array.isArray(parsed.alerts)) fail('alerts must be an array');
  if (!Number.isFinite(Number(parsed.sourceCount)) || Number(parsed.sourceCount) < 0) {
    fail('sourceCount must be a non-negative number');
  }
  if (!parsed.generatedAt || Number.isNaN(new Date(parsed.generatedAt).getTime())) {
    fail('generatedAt must be a valid timestamp');
  }
  if (!parsed.health || typeof parsed.health !== 'object') {
    fail('health block is required');
  }
  if (parsed.schemaVersion === '2026-04-live-feed-v1') {
    if (!parsed.runMetrics || typeof parsed.runMetrics !== 'object') {
      fail('runMetrics block is required for schemaVersion 2026-04-live-feed-v1');
    }
    if (!parsed.runMetrics.coverage || typeof parsed.runMetrics.coverage !== 'object') {
      fail('runMetrics.coverage block is required for schemaVersion 2026-04-live-feed-v1');
    }
  }
  if (!Number.isFinite(Number(parsed.health.lastSuccessfulSourceCount)) || Number(parsed.health.lastSuccessfulSourceCount) < 0) {
    fail('health.lastSuccessfulSourceCount must be a non-negative number');
  }
  if (!parsed.health.lastAttemptedRefreshTime || Number.isNaN(new Date(parsed.health.lastAttemptedRefreshTime).getTime())) {
    fail('health.lastAttemptedRefreshTime must be a valid timestamp');
  }
  parsed.alerts.forEach((alert, index) => {
    if (!alert || typeof alert !== 'object') fail(`alerts[${index}] must be an object`);
    if (!String(alert.id || '').trim()) fail(`alerts[${index}].id is required`);
    if (!String(alert.title || '').trim()) fail(`alerts[${index}].title is required`);
    if (!String(alert.lane || '').trim()) fail(`alerts[${index}].lane is required`);
    if (!String(alert.region || '').trim()) fail(`alerts[${index}].region is required`);
    const sourceUrl = String(alert.sourceUrl || '').trim();
    if (/^https?:\/\//i.test(sourceUrl) && !validUrl(sourceUrl)) {
      fail(`alerts[${index}].sourceUrl must be a valid http(s) URL when provided`);
    }
    if (!sourceUrl && !String(alert.source || '').trim()) fail(`alerts[${index}] requires sourceUrl or source`);
    if (alert.queueBucket != null && !String(alert.queueBucket).trim()) fail(`alerts[${index}].queueBucket must be non-empty when provided`);
  });

  console.log(`live-alerts.json integrity OK (alerts=${parsed.alerts.length}, sourceCount=${parsed.sourceCount})`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
