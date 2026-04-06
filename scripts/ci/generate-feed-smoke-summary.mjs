import fs from 'node:fs';
import path from 'node:path';

const payloadPath = process.argv[2] || 'live-alerts.json';
const outPath = process.argv[3] || '.ci-artifacts/feed-smoke-summary.json';

if (!fs.existsSync(payloadPath)) {
  process.exit(0);
}

const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
const metrics = payload?.runMetrics || {};
const summary = {
  generatedAt: payload.generatedAt,
  sourceCount: payload.sourceCount,
  alertCount: payload.alertCount,
  runDurationMs: metrics.runDurationMs ?? null,
  coverage: metrics.coverage ?? null,
  failureReasons: metrics.failureReasons ?? {},
  guardrails: metrics.guardrails ?? {},
  buildWarning: payload.buildWarning || null
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(summary, null, 2) + '\n');
