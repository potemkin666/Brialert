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
    getCurrentAlert() {
      return alert;
    },
    setExpandedBrief() {}
  };
}

test('createModalRuntime uses local fallback and shows warning when remote generation fails', async () => {
  const alert = { title: 'Alert' };
  const elements = createTestElements();
  let localFallbackCalls = 0;
  let setExpandedBriefValue = '';

  const modalController = {
    ...createTestController(alert),
    setExpandedBrief(text) {
      setExpandedBriefValue = text;
    }
  };

  const runtime = createModalRuntime(elements, {
    modalController,
    requestRemoteLongBrief: async () => {
      throw new Error('remote down');
    },
    buildLocalLongBrief: () => {
      localFallbackCalls += 1;
      return 'local brief';
    },
    mapAlertToLongBriefPayload: () => ({})
  });

  await runtime.generateLongBrief();

  assert.equal(localFallbackCalls, 1);
  assert.equal(setExpandedBriefValue, 'local brief');
  assert.equal(elements.longBriefFallbackNotice.hidden, false);
  assert.equal(elements.longBriefFallbackNotice.textContent, 'Vercel agent unavailable. Long brief generated locally on your device.');
});

test('createModalRuntime clears warning and uses remote brief when remote generation succeeds', async () => {
  const alert = { title: 'Alert' };
  const elements = createTestElements();
  elements.longBriefFallbackNotice.hidden = false;
  elements.longBriefFallbackNotice.textContent = 'Vercel agent failed. Using local agent fallback.';
  let setExpandedBriefValue = '';

  const modalController = {
    ...createTestController(alert),
    setExpandedBrief(text) {
      setExpandedBriefValue = text;
    }
  };

  const runtime = createModalRuntime(elements, {
    modalController,
    requestRemoteLongBrief: async () => 'remote brief',
    buildLocalLongBrief: () => 'local brief',
    mapAlertToLongBriefPayload: () => ({})
  });

  await runtime.generateLongBrief();

  assert.equal(setExpandedBriefValue, 'remote brief');
  assert.equal(elements.longBriefFallbackNotice.hidden, true);
  assert.equal(elements.longBriefFallbackNotice.textContent, '');
});

test('createModalRuntime keeps user-facing error when both remote and local long brief generation fail', async () => {
  const alert = { title: 'Alert' };
  const elements = createTestElements();
  let setExpandedBriefCalls = 0;

  const modalController = {
    ...createTestController(alert),
    setExpandedBrief() {
      setExpandedBriefCalls += 1;
    }
  };

  const runtime = createModalRuntime(elements, {
    modalController,
    requestRemoteLongBrief: async () => {
      throw new Error('remote down');
    },
    buildLocalLongBrief: () => {
      throw new Error('local failed');
    },
    mapAlertToLongBriefPayload: () => ({})
  });

  await runtime.generateLongBrief();

  assert.equal(setExpandedBriefCalls, 0);
  assert.equal(elements.longBriefFallbackNotice.hidden, false);
  assert.equal(elements.longBriefFallbackNotice.textContent, 'Long brief generation failed. Please retry.');
});
