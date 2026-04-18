import test from 'node:test';
import assert from 'node:assert/strict';

import { saveLongBrief, loadLongBrief } from '../shared/brief-cache.mjs';

function createMockStorage() {
  const data = new Map();
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); },
    _data: data
  };
}

// ── saveLongBrief ───────────────────────────────────────────────────

test('saveLongBrief stores text under the correct key', () => {
  const storage = createMockStorage();
  saveLongBrief('alert-42', 'the long brief', storage);
  assert.equal(storage.getItem('albertalert.longBrief.alert-42'), 'the long brief');
});

test('saveLongBrief is a no-op when alertId is empty', () => {
  const storage = createMockStorage();
  saveLongBrief('', 'text', storage);
  saveLongBrief(null, 'text', storage);
  saveLongBrief(undefined, 'text', storage);
  assert.equal(storage._data.size, 0);
});

test('saveLongBrief is a no-op when briefText is empty', () => {
  const storage = createMockStorage();
  saveLongBrief('alert-42', '', storage);
  saveLongBrief('alert-42', null, storage);
  saveLongBrief('alert-42', undefined, storage);
  assert.equal(storage._data.size, 0);
});

test('saveLongBrief does not throw when storage is unavailable', () => {
  assert.doesNotThrow(() => saveLongBrief('id', 'brief', null));
  assert.doesNotThrow(() => saveLongBrief('id', 'brief', undefined));
});

test('saveLongBrief swallows storage quota errors', () => {
  const storage = {
    setItem() { throw new Error('QuotaExceededError'); }
  };
  assert.doesNotThrow(() => saveLongBrief('id', 'brief', storage));
});

// ── loadLongBrief ───────────────────────────────────────────────────

test('loadLongBrief returns stored text', () => {
  const storage = createMockStorage();
  saveLongBrief('alert-42', 'the long brief', storage);
  assert.equal(loadLongBrief('alert-42', storage), 'the long brief');
});

test('loadLongBrief returns null for missing entry', () => {
  const storage = createMockStorage();
  assert.equal(loadLongBrief('nonexistent', storage), null);
});

test('loadLongBrief returns null for empty/whitespace entry', () => {
  const storage = createMockStorage();
  storage.setItem('albertalert.longBrief.x', '');
  assert.equal(loadLongBrief('x', storage), null);
  storage.setItem('albertalert.longBrief.y', '   ');
  assert.equal(loadLongBrief('y', storage), null);
});

test('loadLongBrief returns null when alertId is empty', () => {
  assert.equal(loadLongBrief('', createMockStorage()), null);
  assert.equal(loadLongBrief(null, createMockStorage()), null);
  assert.equal(loadLongBrief(undefined, createMockStorage()), null);
});

test('loadLongBrief does not throw when storage is unavailable', () => {
  assert.equal(loadLongBrief('id', null), null);
  assert.equal(loadLongBrief('id', undefined), null);
});

test('loadLongBrief swallows storage read errors', () => {
  const storage = {
    getItem() { throw new Error('SecurityError'); }
  };
  assert.equal(loadLongBrief('id', storage), null);
});
