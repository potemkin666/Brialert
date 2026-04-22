import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('shared/map-watch.mjs injects Leaflet <script> with SRI integrity + crossOrigin', () => {
  const src = readFileSync(new URL('../shared/map-watch.mjs', import.meta.url), 'utf8');

  // JS asset
  assert.match(src, /LEAFLET_JS_INTEGRITY\s*=\s*['"]sha(256|384|512)-/);
  assert.match(
    src,
    /script\.integrity\s*=\s*LEAFLET_JS_INTEGRITY/,
    'script tag must set integrity attribute'
  );
  assert.match(
    src,
    /script\.crossOrigin\s*=\s*['"]anonymous['"]/,
    'script tag must set crossOrigin=anonymous (required by SRI)'
  );

  // CSS asset too, for parity with index.html
  assert.match(src, /LEAFLET_CSS_INTEGRITY\s*=\s*['"]sha(256|384|512)-/);
  assert.match(src, /link\.integrity\s*=\s*LEAFLET_CSS_INTEGRITY/);
});

test('shared/map-watch.mjs SRI hashes match those in index.html', () => {
  const map = readFileSync(new URL('../shared/map-watch.mjs', import.meta.url), 'utf8');
  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  const jsMatch = map.match(/LEAFLET_JS_INTEGRITY\s*=\s*['"](sha[^'"]+)['"]/);
  const cssMatch = map.match(/LEAFLET_CSS_INTEGRITY\s*=\s*['"](sha[^'"]+)['"]/);
  assert.ok(jsMatch && cssMatch, 'hash constants must be defined');

  assert.ok(
    index.includes(jsMatch[1]),
    'Leaflet JS SRI hash in shared/map-watch.mjs must match index.html'
  );
  assert.ok(
    index.includes(cssMatch[1]),
    'Leaflet CSS SRI hash in shared/map-watch.mjs must match index.html'
  );
});
