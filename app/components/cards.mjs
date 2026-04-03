import { contextLabel, quarantineReason, severityLabel } from '../../shared/alert-view-model.mjs';
import { laneLabels } from '../../shared/ui-data.mjs';
import { escapeHtml } from '../utils/text.mjs';

export function responderCardMarkup(alert, watched) {
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
      <div class="meta-row"><span>${escapeHtml(alert.source)}</span><span>${escapeHtml(alert.status)}</span><span>${Number(alert.corroborationCount || 0)} corroborating</span></div>
    </article>`;
}

export function contextCardMarkup(alert) {
  return `<article class="context-pill actionable" data-context="${alert.id}"><h4>${escapeHtml(alert.title)}</h4><p>${escapeHtml(contextLabel(alert))} | ${escapeHtml(alert.source)}</p></article>`;
}

export function quarantineCardMarkup(alert) {
  return `
    <article class="quarantine-card actionable" data-quarantine="${alert.id}">
      <div class="section-heading">
        <h4>${escapeHtml(alert.title)}</h4>
        <span class="quarantine-badge">Quarantine</span>
      </div>
      <p>${escapeHtml(alert.summary)}</p>
      <div class="meta-row">
        <span>${escapeHtml(alert.source)}</span>
        <span>${escapeHtml(quarantineReason(alert))}</span>
        <span>${escapeHtml(alert.time)}</span>
      </div>
    </article>`;
}

export function watchlistCardMarkup(alert) {
  return `<article class="feed-card actionable" data-watch="${alert.id}"><div class="feed-top"><div><h4>${escapeHtml(alert.title)}</h4><p>${escapeHtml(alert.location)}</p></div><span class="severity severity-${escapeHtml(alert.severity)}">${escapeHtml(laneLabels[alert.lane])}</span></div><p>${escapeHtml(alert.summary)}</p></article>`;
}
