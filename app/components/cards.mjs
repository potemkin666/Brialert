import { confidenceScoreLabel, contextLabel, quarantineReason, regionLabel, severityLabel, trustSignal } from '../../shared/alert-view-model.mjs';
import { laneLabels } from '../../shared/ui-data.mjs';
import { escapeHtml } from '../utils/text.mjs';

function canonicalRegionKey(region) {
  const key = String(region || '').toLowerCase().trim();
  if (key === 'eu' || key === 'europe') return 'europe';
  return key;
}

const regionBadgeMeta = {
  london: { key: 'london', css: 'is-london', flag: '🏴', label: 'London' },
  uk: { key: 'uk', css: 'is-uk', flag: '🇬🇧', label: 'UK' },
  europe: { key: 'europe', css: 'is-europe', flag: '🇪🇺', label: 'Europe' },
  us: { key: 'us', css: 'is-us', flag: '🇺🇸', label: 'US' },
  international: { key: 'international', css: 'is-international', flag: '🌐', label: 'International' }
};

const countryMentionMeta = [
  { key: 'us', css: 'is-us', flag: '🇺🇸', label: 'US', patterns: [/\bUnited\s+States\b/i, /\bU\.S\.A\.?\b/i, /\bU\.S\.\b/i, /\bUS\b/, /\bthe\s+us\b/i, /\bAmerican\b/i] },
  { key: 'uk', css: 'is-uk', flag: '🇬🇧', label: 'UK', patterns: [/\bUnited\s+Kingdom\b/i, /\bBritain\b/i, /\bBritish\b/i, /\bEngland\b/i, /\bScotland\b/i, /\bWales\b/i, /\bNorthern\s+Ireland\b/i] },
  { key: 'europe', css: 'is-europe', flag: '🇪🇺', label: 'Europe', patterns: [/\bEurope\b/i, /\bEuropean\s+Union\b/i, /\bEU\b/i] },
  { key: 'france', css: 'is-country', flag: '🇫🇷', label: 'France', patterns: [/\bFrance\b/i, /\bFrench\b/i] },
  { key: 'germany', css: 'is-country', flag: '🇩🇪', label: 'Germany', patterns: [/\bGermany\b/i, /\bGerman\b/i] },
  { key: 'italy', css: 'is-country', flag: '🇮🇹', label: 'Italy', patterns: [/\bItaly\b/i, /\bItalian\b/i] },
  { key: 'spain', css: 'is-country', flag: '🇪🇸', label: 'Spain', patterns: [/\bSpain\b/i, /\bSpanish\b/i] },
  { key: 'belgium', css: 'is-country', flag: '🇧🇪', label: 'Belgium', patterns: [/\bBelgium\b/i, /\bBelgian\b/i] },
  { key: 'netherlands', css: 'is-country', flag: '🇳🇱', label: 'Netherlands', patterns: [/\bNetherlands\b/i, /\bDutch\b/i] },
  { key: 'sweden', css: 'is-country', flag: '🇸🇪', label: 'Sweden', patterns: [/\bSweden\b/i, /\bSwedish\b/i] },
  { key: 'norway', css: 'is-country', flag: '🇳🇴', label: 'Norway', patterns: [/\bNorway\b/i, /\bNorwegian\b/i] },
  { key: 'denmark', css: 'is-country', flag: '🇩🇰', label: 'Denmark', patterns: [/\bDenmark\b/i, /\bDanish\b/i] },
  { key: 'poland', css: 'is-country', flag: '🇵🇱', label: 'Poland', patterns: [/\bPoland\b/i, /\bPolish\b/i] },
  { key: 'austria', css: 'is-country', flag: '🇦🇹', label: 'Austria', patterns: [/\bAustria\b/i, /\bAustrian\b/i] },
  { key: 'switzerland', css: 'is-country', flag: '🇨🇭', label: 'Switzerland', patterns: [/\bSwitzerland\b/i, /\bSwiss\b/i] },
  { key: 'ireland', css: 'is-country', flag: '🇮🇪', label: 'Ireland', patterns: [/\bIreland\b/i, /\bIrish\b/i] },
  { key: 'israel', css: 'is-country', flag: '🇮🇱', label: 'Israel', patterns: [/\bIsrael\b/i, /\bIsraeli\b/i] },
  { key: 'iran', css: 'is-country', flag: '🇮🇷', label: 'Iran', patterns: [/\bIran\b/i, /\bIranian\b/i] },
  { key: 'turkey', css: 'is-country', flag: '🇹🇷', label: 'Turkey', patterns: [/\bTurkey\b/i, /\bTurkish\b/i] },
  { key: 'russia', css: 'is-country', flag: '🇷🇺', label: 'Russia', patterns: [/\bRussia\b/i, /\bRussian\b/i] },
  { key: 'ukraine', css: 'is-country', flag: '🇺🇦', label: 'Ukraine', patterns: [/\bUkraine\b/i, /\bUkrainian\b/i] },
  { key: 'pakistan', css: 'is-country', flag: '🇵🇰', label: 'Pakistan', patterns: [/\bPakistan\b/i, /\bPakistani\b/i] },
  { key: 'india', css: 'is-country', flag: '🇮🇳', label: 'India', patterns: [/\bIndia\b/i, /\bIndian\b/i] },
  { key: 'nigeria', css: 'is-country', flag: '🇳🇬', label: 'Nigeria', patterns: [/\bNigeria\b/i, /\bNigerian\b/i] }
];

function storyGeoText(alert) {
  return String([
    alert?.title,
    alert?.summary,
    alert?.location,
    alert?.sourceExtract
  ].filter(Boolean).join(' '));
}

function badgeMarkup({ css, flag, label }) {
  return `<span class="region-badge ${css}" aria-label="Geo tag: ${escapeHtml(label)}"><span aria-hidden="true">${escapeHtml(flag)}</span><span>${escapeHtml(label)}</span></span>`;
}

function regionBadgeFor(alert) {
  const regionKey = canonicalRegionKey(alert?.region);
  const known = regionBadgeMeta[regionKey];
  if (known) return known;
  return {
    key: regionKey || 'other',
    css: 'is-other',
    flag: '🏳️',
    label: regionLabel(alert?.region)
  };
}

function inferredCountryBadges(alert, primaryRegionKey) {
  const text = storyGeoText(alert);
  if (!text) return [];

  const badges = [];
  for (const badge of countryMentionMeta) {
    if (badge.key === primaryRegionKey) continue;
    if (!badge.patterns.some((pattern) => pattern.test(text))) continue;
    badges.push({ key: badge.key, css: badge.css, flag: badge.flag, label: badge.label });
    if (badges.length >= 3) break;
  }
  return badges;
}

function geoBadgesMarkup(alert) {
  const primary = regionBadgeFor(alert);
  const extras = inferredCountryBadges(alert, primary.key);
  return `<span class="story-geo-tags">${[primary, ...extras].map((badge) => badgeMarkup(badge)).join('')}</span>`;
}

export function responderCardMarkup(alert, watched) {
  const trust = trustSignal(alert);
  const confidence = confidenceScoreLabel(alert);
  const geoBadges = geoBadgesMarkup(alert);
  return `
    <article class="feed-card actionable" data-id="${alert.id}">
      <div class="feed-top">
        <div><h4>${escapeHtml(alert.title)}</h4><p>${escapeHtml(alert.location)}</p></div>
        <div class="feed-actions">
          <button class="star-button ${watched ? 'active' : ''}" data-star="${alert.id}">${watched ? 'Watch' : 'Track'}</button>
          <span class="severity severity-${escapeHtml(alert.severity)}">${escapeHtml(severityLabel(alert.severity))}</span>
        </div>
      </div>
      <p>${escapeHtml(alert.summary)}</p>
      <div class="meta-row">
        <span class="trust-signal trust-signal-${escapeHtml(trust.key)}">${escapeHtml(trust.label)}</span>
        <span>${escapeHtml(confidence)}</span>
        <span>${Number(alert.corroborationCount || 0)} corroborating</span>
      </div>
      <div class="meta-row">
        <span>${escapeHtml(alert.source)}</span>
        ${geoBadges}
        <span>${escapeHtml(alert.status)}</span>
      </div>
    </article>`;
}

export function supportingCardMarkup(alert) {
  const isQuarantine = Boolean(alert.needsHumanReview);
  const badgeLabel = isQuarantine ? 'Quarantine' : (laneLabels[alert.lane] || 'Context');
  const metaReason = isQuarantine ? quarantineReason(alert) : contextLabel(alert);
  const geoBadges = geoBadgesMarkup(alert);
  const timeMeta = String(alert.time || '').trim();
  const metaParts = [
    `<span>${escapeHtml(alert.source)}</span>`,
    geoBadges,
    `<span>${escapeHtml(metaReason)}</span>`,
    timeMeta ? `<span>${escapeHtml(timeMeta)}</span>` : ''
  ].filter(Boolean).join('');

  return `
    <article class="supporting-card ${isQuarantine ? 'is-quarantine' : 'is-context'} actionable" data-supporting="${alert.id}">
      <div class="section-heading">
        <h4>${escapeHtml(alert.title)}</h4>
        <span class="supporting-badge ${isQuarantine ? 'is-quarantine' : 'is-context'}">${escapeHtml(badgeLabel)}</span>
      </div>
      <p>${escapeHtml(alert.summary)}</p>
      <div class="meta-row">${metaParts}</div>
    </article>`;
}

export function watchlistCardMarkup(alert) {
  return `<article class="feed-card actionable" data-watch="${alert.id}"><div class="feed-top"><div><h4>${escapeHtml(alert.title)}</h4><p>${escapeHtml(alert.location)}</p></div><span class="severity severity-${escapeHtml(alert.severity)}">${escapeHtml(laneLabels[alert.lane])}</span></div><p>${escapeHtml(alert.summary)}</p></article>`;
}
