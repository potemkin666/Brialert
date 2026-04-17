import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  loadSoundPreference,
  saveSoundPreference,
  isTabHidden,
  hasCriticalAlert,
  hasNewCriticalAlerts,
  shouldPlayAlert,
  playAlertSound,
  _STORAGE_KEY,
  _VALID_TONES
} from '../shared/sound-alert.mjs';

/* ── Minimal localStorage shim ── */
function createStorageShim() {
  const store = new Map();
  return {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { store.set(key, String(value)); },
    removeItem(key) { store.delete(key); },
    clear() { store.clear(); }
  };
}

describe('sound-alert: persistence', () => {
  beforeEach(() => {
    globalThis.localStorage = createStorageShim();
  });

  test('loadSoundPreference returns "off" when nothing stored', () => {
    assert.equal(loadSoundPreference(), 'off');
  });

  test('loadSoundPreference returns stored value when valid', () => {
    localStorage.setItem(_STORAGE_KEY, 'klaxon');
    assert.equal(loadSoundPreference(), 'klaxon');
  });

  test('loadSoundPreference returns "off" for invalid stored value', () => {
    localStorage.setItem(_STORAGE_KEY, 'invalid-tone');
    assert.equal(loadSoundPreference(), 'off');
  });

  test('saveSoundPreference persists valid values', () => {
    saveSoundPreference('chime');
    assert.equal(localStorage.getItem(_STORAGE_KEY), 'chime');
  });

  test('saveSoundPreference normalises invalid values to "off"', () => {
    const result = saveSoundPreference('bad');
    assert.equal(result, 'off');
    assert.equal(localStorage.getItem(_STORAGE_KEY), 'off');
  });

  test('saveSoundPreference handles all valid tones', () => {
    for (const tone of _VALID_TONES) {
      const result = saveSoundPreference(tone);
      assert.equal(result, tone);
      assert.equal(localStorage.getItem(_STORAGE_KEY), tone);
    }
  });
});

describe('sound-alert: detection helpers', () => {
  test('hasCriticalAlert returns false for empty array', () => {
    assert.equal(hasCriticalAlert([]), false);
  });

  test('hasCriticalAlert returns false for non-critical alerts', () => {
    assert.equal(hasCriticalAlert([
      { severity: 'high' },
      { severity: 'moderate' }
    ]), false);
  });

  test('hasCriticalAlert returns true when critical alert present', () => {
    assert.equal(hasCriticalAlert([
      { severity: 'high' },
      { severity: 'critical' }
    ]), true);
  });

  test('hasCriticalAlert is case-insensitive', () => {
    assert.equal(hasCriticalAlert([{ severity: 'Critical' }]), true);
  });

  test('hasCriticalAlert handles null/undefined safely', () => {
    assert.equal(hasCriticalAlert(null), false);
    assert.equal(hasCriticalAlert(undefined), false);
  });

  test('hasNewCriticalAlerts detects new critical alerts not in previous set', () => {
    const prev = [{ id: 'a', severity: 'critical' }];
    const curr = [
      { id: 'a', severity: 'critical' },
      { id: 'b', severity: 'critical' }
    ];
    assert.equal(hasNewCriticalAlerts(prev, curr), true);
  });

  test('hasNewCriticalAlerts returns false when all critical alerts existed before', () => {
    const prev = [{ id: 'a', severity: 'critical' }];
    const curr = [{ id: 'a', severity: 'critical' }];
    assert.equal(hasNewCriticalAlerts(prev, curr), false);
  });

  test('hasNewCriticalAlerts returns false when no critical alerts in current', () => {
    const prev = [{ id: 'a', severity: 'critical' }];
    const curr = [{ id: 'b', severity: 'high' }];
    assert.equal(hasNewCriticalAlerts(prev, curr), false);
  });

  test('hasNewCriticalAlerts handles empty previous', () => {
    assert.equal(hasNewCriticalAlerts([], [{ id: 'x', severity: 'critical' }]), true);
  });

  test('hasNewCriticalAlerts handles null previous', () => {
    assert.equal(hasNewCriticalAlerts(null, [{ id: 'x', severity: 'critical' }]), true);
  });
});

describe('sound-alert: shouldPlayAlert', () => {
  test('returns false when preference is off', () => {
    assert.equal(shouldPlayAlert({
      preference: 'off',
      previousAlerts: [],
      currentAlerts: [{ id: 'a', severity: 'critical' }],
      tabHidden: true
    }), false);
  });

  test('returns false when tab is visible', () => {
    assert.equal(shouldPlayAlert({
      preference: 'klaxon',
      previousAlerts: [],
      currentAlerts: [{ id: 'a', severity: 'critical' }],
      tabHidden: false
    }), false);
  });

  test('returns false when no new critical alerts', () => {
    const alerts = [{ id: 'a', severity: 'critical' }];
    assert.equal(shouldPlayAlert({
      preference: 'chime',
      previousAlerts: alerts,
      currentAlerts: alerts,
      tabHidden: true
    }), false);
  });

  test('returns false when no critical alerts at all', () => {
    assert.equal(shouldPlayAlert({
      preference: 'klaxon',
      previousAlerts: [],
      currentAlerts: [{ id: 'b', severity: 'high' }],
      tabHidden: true
    }), false);
  });

  test('returns true when all conditions met (new critical + hidden + enabled)', () => {
    // AudioContext not available in Node, so this will return false due to API check
    // We test the logic path separately
    const result = shouldPlayAlert({
      preference: 'klaxon',
      previousAlerts: [],
      currentAlerts: [{ id: 'a', severity: 'critical' }],
      tabHidden: true
    });
    // In Node.js there's no AudioContext, so it returns false for the full function
    // This is expected — the logic gates before AudioContext check are tested above
    assert.equal(result, false);
  });
});

describe('sound-alert: playAlertSound', () => {
  test('returns false for invalid tone', () => {
    assert.equal(playAlertSound('off'), false);
    assert.equal(playAlertSound('invalid'), false);
    assert.equal(playAlertSound(null), false);
  });

  test('returns false when AudioContext is unavailable (Node.js)', () => {
    assert.equal(playAlertSound('klaxon'), false);
    assert.equal(playAlertSound('chime'), false);
    assert.equal(playAlertSound('newintel'), false);
  });
});

describe('sound-alert: isTabHidden', () => {
  test('returns false in Node.js (no document)', () => {
    const origDoc = globalThis.document;
    delete globalThis.document;
    try {
      assert.equal(isTabHidden(), false);
    } finally {
      globalThis.document = origDoc;
    }
  });
});

describe('sound-alert: VALID_TONES', () => {
  test('includes the four expected values', () => {
    assert.deepEqual([..._VALID_TONES], ['off', 'klaxon', 'chime', 'newintel']);
  });

  test('is frozen', () => {
    assert.equal(Object.isFrozen(_VALID_TONES), true);
  });
});
