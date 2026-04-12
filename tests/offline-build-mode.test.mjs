import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");
const fixturesPath = path.join(
  repoRoot,
  "tests",
  "fixtures",
  "offline-build",
  "fixtures.json",
);

test("fetchText uses offline fixture responses when offline mode is enabled", () => {
  const code = `
    import { fetchText } from './scripts/build-live-feed/io.mjs';
    const result = await fetchText('https://fixtures.brialert.local/incidents.rss', 1, {
      source: { id: 'fixture-rss-incidents', endpoint: 'https://fixtures.brialert.local/incidents.rss', kind: 'rss' }
    });
    console.log(result.includes('bomb plot disrupted') ? 'ok' : 'bad');
  `;

  const stdout = execFileSync("node", ["--input-type=module", "-e", code], {
    cwd: repoRoot,
    env: {
      ...process.env,
      BRIALERT_OFFLINE_FIXTURE_MODE: "true",
      BRIALERT_OFFLINE_FIXTURES_PATH: fixturesPath,
    },
    encoding: "utf8",
  }).trim();

  assert.equal(stdout, "ok");
});
