import test from 'node:test';
import assert from 'node:assert/strict';

import { createModalRuntime } from '../app/render/modal.mjs';

function createTestElements() {
  return {
    generateExpandedBrief: { disabled: false, textContent: 'Generate Long Brief' },
    modalExpandedBrief: { textContent: '' },
    copyExpandedBrief: { disabled: true, dataset: {} },
    longBriefFallbackNotice: { textContent: '', hidden: true }
  };
}

function createTestController(alert) {
  return {
    getCurrentAlert() { return alert; },
    setExpandedBrief() {}
  };
}

// ── Persist after remote generation ─────────────────────────────────

test('generateLongBrief saves remote brief to cache', async () => {
  const alert = { id: 'alert-99', title: 'Test' };
  const elements = createTestElements();
  const saved = [];

  const modalController = {
    ...createTestController(alert),
    setExpandedBrief() {}
  };

  const runtime = createModalRuntime(elements, {
    modalController,
    requestRemoteLongBrief: async () => 'remote brief text',
    buildLocalLongBrief: () => 'fallback',
    mapAlertToLongBriefPayload: () => ({}),
    saveLongBrief: (id, text) => saved.push({ id, text })
  });

  await runtime.generateLongBrief();

  assert.equal(saved.length, 1);
  assert.equal(saved[0].id, 'alert-99');
  assert.equal(saved[0].text, 'remote brief text');
});

// ── Persist after local fallback ────────────────────────────────────

test('generateLongBrief saves local fallback brief to cache', async () => {
  const alert = { id: 'alert-77', title: 'Test' };
  const elements = createTestElements();
  const saved = [];

  const modalController = {
    ...createTestController(alert),
    setExpandedBrief() {}
  };

  const runtime = createModalRuntime(elements, {
    modalController,
    requestRemoteLongBrief: async () => { throw new Error('offline'); },
    buildLocalLongBrief: () => 'local brief text',
    mapAlertToLongBriefPayload: () => ({}),
    saveLongBrief: (id, text) => saved.push({ id, text })
  });

  await runtime.generateLongBrief();

  assert.equal(saved.length, 1);
  assert.equal(saved[0].id, 'alert-77');
  assert.equal(saved[0].text, 'local brief text');
});

// ── No persist when both fail ───────────────────────────────────────

test('generateLongBrief does not save to cache when both generators fail', async () => {
  const alert = { id: 'alert-55', title: 'Test' };
  const elements = createTestElements();
  const saved = [];

  const modalController = {
    ...createTestController(alert),
    setExpandedBrief() {}
  };

  const runtime = createModalRuntime(elements, {
    modalController,
    requestRemoteLongBrief: async () => { throw new Error('offline'); },
    buildLocalLongBrief: () => { throw new Error('also broken'); },
    mapAlertToLongBriefPayload: () => ({}),
    saveLongBrief: (id, text) => saved.push({ id, text })
  });

  await runtime.generateLongBrief();

  assert.equal(saved.length, 0);
});

// ── No persist when alert has no id ─────────────────────────────────

test('generateLongBrief does not persist when alert has no id', async () => {
  const alert = { title: 'No ID' };
  const elements = createTestElements();
  const saved = [];

  const modalController = {
    ...createTestController(alert),
    setExpandedBrief() {}
  };

  const runtime = createModalRuntime(elements, {
    modalController,
    requestRemoteLongBrief: async () => 'brief',
    buildLocalLongBrief: () => 'fallback',
    mapAlertToLongBriefPayload: () => ({}),
    saveLongBrief: (id, text) => saved.push({ id, text })
  });

  await runtime.generateLongBrief();

  assert.equal(saved.length, 0);
});
