import fs from 'node:fs';

const payloadPath = process.argv[2] || 'live-alerts.json';
const maxRuntimeMs = Number(process.argv[3] || process.env.BRIALERT_CI_MAX_RUNTIME_MS || 420000);

if (!fs.existsSync(payloadPath)) {
  throw new Error(`Missing payload file: ${payloadPath}`);
}

const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
const runDurationMs = Number(payload?.runMetrics?.runDurationMs || 0);

if (!Number.isFinite(runDurationMs) || runDurationMs <= 0) {
  throw new Error('Missing runDurationMs in live-alerts.json runMetrics');
}

if (runDurationMs > maxRuntimeMs) {
  throw new Error(`CI smoke runtime budget exceeded: ${runDurationMs}ms > ${maxRuntimeMs}ms`);
}

console.log(`CI smoke runtime budget OK: ${runDurationMs}ms <= ${maxRuntimeMs}ms`);
