import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

test('shared/map-watch.mjs loads vendored Leaflet assets from the repo', () => {
  const src = readFileSync(new URL('../shared/map-watch.mjs', import.meta.url), 'utf8');

  assert.match(
    src,
    /LEAFLET_JS_URL\s*=\s*['"]\.\/assets\/vendor\/leaflet\/leaflet\.js['"]/,
    'script tag should load the vendored Leaflet bundle'
  );
  assert.match(
    src,
    /LEAFLET_CSS_URL\s*=\s*['"]\.\/assets\/vendor\/leaflet\/leaflet\.css['"]/,
    'stylesheet should load the vendored Leaflet CSS bundle'
  );
});

test('index.html and shared/map-watch.mjs point at the same vendored Leaflet assets', () => {
  const map = readFileSync(new URL('../shared/map-watch.mjs', import.meta.url), 'utf8');
  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  const jsMatch = map.match(/LEAFLET_JS_URL\s*=\s*['"]([^'"]+)['"]/);
  const cssMatch = map.match(/LEAFLET_CSS_URL\s*=\s*['"]([^'"]+)['"]/);
  assert.ok(jsMatch && cssMatch, 'Leaflet asset paths must be defined');

  assert.ok(
    index.includes(jsMatch[1]),
    'Leaflet JS path in shared/map-watch.mjs must match index.html'
  );
  assert.ok(
    index.includes(cssMatch[1]),
    'Leaflet CSS path in shared/map-watch.mjs must match index.html'
  );
});

test('vendored Leaflet assets exist in the repository', () => {
  assert.ok(existsSync(new URL('../assets/vendor/leaflet/leaflet.css', import.meta.url)));
  assert.ok(existsSync(new URL('../assets/vendor/leaflet/leaflet.js', import.meta.url)));
  assert.ok(existsSync(new URL('../assets/vendor/leaflet/LICENSE', import.meta.url)));
});
