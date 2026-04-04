import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const outputPath = path.join(repoRoot, 'live-alerts.json');

function fail(message) {
  throw new Error(`live-alerts.json integrity failure: ${message}`);
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
  if (!Number.isFinite(Number(parsed.health.lastSuccessfulSourceCount)) || Number(parsed.health.lastSuccessfulSourceCount) < 0) {
    fail('health.lastSuccessfulSourceCount must be a non-negative number');
  }
  if (!parsed.health.lastAttemptedRefreshTime || Number.isNaN(new Date(parsed.health.lastAttemptedRefreshTime).getTime())) {
    fail('health.lastAttemptedRefreshTime must be a valid timestamp');
  }

  console.log(`live-alerts.json integrity OK (alerts=${parsed.alerts.length}, sourceCount=${parsed.sourceCount})`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
