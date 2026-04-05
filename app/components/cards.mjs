import { confidenceScoreLabel, contextLabel, quarantineReason, severityLabel, trustSignal } from '../../shared/alert-view-model.mjs';
import { laneLabels } from '../../shared/ui-data.mjs';
import { escapeHtml } from '../utils/text.mjs';

export function responderCardMarkup(alert, watched) {
  const trust = trustSignal(alert);
  const confidence = confidenceScoreLabel(alert);
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
        <span>${escapeHtml(alert.status)}</span>
      </div>
    </article>`;
}

export function supportingCardMarkup(alert) {
  const isQuarantine = Boolean(alert.needsHumanReview);
  const badgeLabel = isQuarantine ? 'Quarantine' : (laneLabels[alert.lane] || 'Context');
  const metaReason = isQuarantine ? quarantineReason(alert) : contextLabel(alert);
  const timeMeta = String(alert.time || '').trim();
  const metaParts = [
    `<span>${escapeHtml(alert.source)}</span>`,
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
