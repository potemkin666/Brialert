import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { _markerPopup, _clusterPopup } from '../shared/map-watch.mjs';

describe('markerPopup accessibility', () => {
  const alert = {
    id: 'a1',
    title: 'Explosion in Soho',
    location: 'London, UK',
    source: 'Met Police',
    time: '12:00'
  };

  it('contains role="dialog"', () => {
    const html = _markerPopup(alert);
    assert.ok(html.includes('role="dialog"'), 'Expected role="dialog" in markerPopup HTML');
  });

  it('contains aria-label with the alert title', () => {
    const html = _markerPopup(alert);
    assert.ok(
      html.includes('aria-label="Explosion in Soho"'),
      'Expected aria-label matching alert title'
    );
  });

  it('escapes special characters in aria-label', () => {
    const xssAlert = { ...alert, title: '<script>alert("xss")</script>' };
    const html = _markerPopup(xssAlert);
    assert.ok(!html.includes('<script>'), 'Title should be HTML-escaped in aria-label');
    assert.ok(html.includes('aria-label="'), 'Should still have aria-label attribute');
  });
});

describe('clusterPopup accessibility', () => {
  const entry = {
    items: [
      { id: 'a1', title: 'Alert 1', location: 'London, UK' },
      { id: 'a2', title: 'Alert 2', location: 'London, UK' },
      { id: 'a3', title: 'Alert 3', location: 'Manchester, UK' }
    ]
  };

  it('contains role="dialog"', () => {
    const html = _clusterPopup(entry);
    assert.ok(html.includes('role="dialog"'), 'Expected role="dialog" in clusterPopup HTML');
  });

  it('contains aria-label with alert count', () => {
    const html = _clusterPopup(entry);
    assert.ok(
      html.includes('aria-label="3 alerts'),
      `Expected aria-label starting with "3 alerts", got: ${html.match(/aria-label="[^"]*"/)?.[0]}`
    );
  });

  it('includes country name in aria-label when available', () => {
    const html = _clusterPopup(entry);
    // Dominant country is United Kingdom
    assert.ok(
      html.includes('aria-label="3 alerts in United Kingdom"'),
      `Expected country in aria-label, got: ${html.match(/aria-label="[^"]*"/)?.[0]}`
    );
  });

  it('handles entries with no country gracefully', () => {
    const noCountryEntry = {
      items: [
        { id: 'a1', title: 'Alert 1', location: '' },
        { id: 'a2', title: 'Alert 2' }
      ]
    };
    const html = _clusterPopup(noCountryEntry);
    assert.ok(
      html.includes('aria-label="2 alerts"'),
      `Expected aria-label without country, got: ${html.match(/aria-label="[^"]*"/)?.[0]}`
    );
  });
});
