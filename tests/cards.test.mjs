import test from 'node:test';
import assert from 'node:assert/strict';

import { responderCardMarkup } from '../app/components/cards.mjs';

function makeAlert(overrides = {}) {
  return {
    id: 'alert-1',
    title: 'Alert title',
    summary: 'Alert summary',
    sourceExtract: '',
    location: 'Paris',
    source: 'Reuters',
    severity: 'high',
    status: 'Threat update',
    corroborationCount: 1,
    confidenceScore: 0.92,
    region: 'europe',
    lane: 'incidents',
    ...overrides
  };
}

test('responder card unifies eu and europe geo tags to Europe with EU emoji', () => {
  const fromEu = responderCardMarkup(makeAlert({ region: 'eu' }), false);
  const fromEurope = responderCardMarkup(makeAlert({ region: 'europe' }), false);

  assert.match(fromEu, /🇪🇺/);
  assert.match(fromEurope, /🇪🇺/);
  assert.match(fromEu, />Europe</);
  assert.doesNotMatch(fromEu, />EU</);
  assert.doesNotMatch(fromEu, /🌍/);
});

test('responder card adds US flag geo tag for lowercase "the us" phrasing', () => {
  const markup = responderCardMarkup(makeAlert({
    region: 'europe',
    summary: 'Officials in the us raised the alert level.'
  }), false);

  assert.match(markup, /🇺🇸/);
});

test('responder card adds US flag geo tag when story text mentions US', () => {
  const markup = responderCardMarkup(makeAlert({
    region: 'europe',
    title: 'US officials investigate plot in Brussels',
    summary: 'The United States embassy issued a security warning.'
  }), false);

  assert.match(markup, /🇺🇸/);
  assert.match(markup, />US</);
});

test('responder card limits inferred country tags to three extras', () => {
  const markup = responderCardMarkup(makeAlert({
    region: 'europe',
    title: 'US France Germany Spain security update',
    summary: 'American, French, German and Spanish teams coordinated.'
  }), false);

  const geoTagCount = (markup.match(/aria-label="Geo tag:/g) || []).length;
  assert.equal(geoTagCount, 4);
});
