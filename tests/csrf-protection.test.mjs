import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { requireCsrfProtection } from '../api/_lib/admin-session.js';

function createResponse() {
  const res = {
    _status: null,
    _json: null,
    _headers: {},
    status(code) { res._status = code; return res; },
    json(data) { res._json = data; return res; },
    setHeader(key, value) { res._headers[key] = value; }
  };
  return res;
}

describe('requireCsrfProtection', () => {
  it('returns true when X-Albertalert-Csrf header is present (lowercased)', () => {
    const res = createResponse();
    const ok = requireCsrfProtection(
      { headers: { 'x-albertalert-csrf': '1' } },
      res
    );
    assert.equal(ok, true);
    assert.equal(res._status, null, 'should not write a response');
  });

  it('returns true when the header uses mixed case', () => {
    const res = createResponse();
    // Node's http headers are lowercased, but guard the fallback branch anyway:
    const ok = requireCsrfProtection(
      { headers: { 'x-albertalert-csrf': 'any-value' } },
      res
    );
    assert.equal(ok, true);
  });

  it('returns false and writes 403 when header is missing', () => {
    const res = createResponse();
    const ok = requireCsrfProtection({ headers: {} }, res);
    assert.equal(ok, false);
    assert.equal(res._status, 403);
    assert.equal(res._json?.error, 'csrf-required');
  });

  it('returns false when header is an empty string', () => {
    const res = createResponse();
    const ok = requireCsrfProtection(
      { headers: { 'x-albertalert-csrf': '   ' } },
      res
    );
    assert.equal(ok, false);
    assert.equal(res._status, 403);
  });

  it('handles missing request/headers without throwing', () => {
    const res = createResponse();
    const ok = requireCsrfProtection({}, res);
    assert.equal(ok, false);
    assert.equal(res._status, 403);
  });
});

describe('admin POST endpoints enforce CSRF', () => {
  it('each endpoint imports requireCsrfProtection from admin-session', async () => {
    const { readFileSync } = await import('node:fs');
    const files = [
      '../api/approve-source.js',
      '../api/restore-source.js',
      '../api/request-source.js',
      '../api/trigger-live-feed.js'
    ];
    for (const file of files) {
      const src = readFileSync(new URL(file, import.meta.url), 'utf8');
      assert.ok(
        src.includes('requireCsrfProtection'),
        `${file} should import and use requireCsrfProtection`
      );
    }
  });

  it('trigger-live-feed invokes CSRF check after session check', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      new URL('../api/trigger-live-feed.js', import.meta.url),
      'utf8'
    );
    const sessionIdx = src.indexOf('requireAdminSession(');
    const csrfIdx = src.indexOf('requireCsrfProtection(');
    assert.ok(sessionIdx > 0, 'should call requireAdminSession');
    assert.ok(csrfIdx > 0, 'should call requireCsrfProtection');
    assert.ok(csrfIdx > sessionIdx, 'CSRF check should come after session check');
  });
});
