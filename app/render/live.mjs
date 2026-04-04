import {
  buildBriefing,
  effectiveSummary,
  isLiveIncidentCandidate,
  keywordMatches,
  regionLabel
} from '../../shared/alert-view-model.mjs';
import { laneLabels } from '../../shared/ui-data.mjs';
import {
  contextCardMarkup,
  quarantineCardMarkup,
  responderCardMarkup
} from '../components/cards.mjs';
import { escapeHtml } from '../utils/text.mjs';

function displaySourceCount(state) {
  const liveCount = Number(state.liveSourceCount);
  if (Number.isFinite(liveCount) && liveCount > 0) return liveCount;
  const lastSuccessfulCount = Number(state.liveFeedHealth?.lastSuccessfulSourceCount);
  if (Number.isFinite(lastSuccessfulCount) && lastSuccessfulCount > 0) return lastSuccessfulCount;
  return 0;
}

function updateLoadMoreButton(button, shown, total, label) {
  if (!button) return;
  const hasMore = shown < total;
  button.classList.toggle('hidden', !hasMore);
  if (hasMore) {
    button.textContent = `${label} (${total - shown} remaining)`;
  }
}

export function renderPriority({ state, elements, view, modalController }) {
  const alert = view.topPriority;
  if (!alert) {
    const sourceCount = displaySourceCount(state);
    elements.priorityCard.classList.remove('context-priority');
    elements.priorityCard.innerHTML = `
      <div class="eyebrow">Live Feed Status</div>
      <h2>Waiting for a verified source pull</h2>
      <p class="muted">The app is not showing placeholder incidents anymore. Once the feed builder publishes live items, responder candidates will appear here automatically.</p>
      <div class="meta-row">
        <span>${state.activeRegion === 'all' ? 'All feeds' : `${regionLabel(state.activeRegion)} feeds`}</span>
        <span>${state.activeLane === 'all' ? 'All lanes' : laneLabels[state.activeLane]}</span>
        <span>${sourceCount ? `${sourceCount} sources checked` : 'No live feed yet'}</span>
      </div>`;
    elements.priorityCard.onclick = null;
    return;
  }

  const liveCandidate = isLiveIncidentCandidate(alert);
  const matches = keywordMatches(alert);
  elements.priorityCard.classList.toggle('context-priority', !liveCandidate);
  elements.priorityCard.innerHTML = `
    <div class="eyebrow">${liveCandidate ? 'Live Terror Incident Trigger' : 'Context Item'}</div>
    <h2>${escapeHtml(alert.title)}</h2>
    <p class="muted">${escapeHtml(laneLabels[alert.lane])} | ${escapeHtml(alert.location)} | ${escapeHtml(alert.status)}</p>
    <p>${escapeHtml(alert.summary)}</p>
    <div class="meta-row">
      <span>${escapeHtml(alert.source)}</span>
      <span>${matches.length ? `${matches.length} keyword hits` : 'No incident keyword hit'}</span>
      <span>${escapeHtml(alert.time)}</span>
    </div>`;
  elements.priorityCard.onclick = () => modalController.openDetail(alert);
}

export function renderBriefingMode({ state, elements, view, modalController }) {
  if (!state.briefingMode) {
    elements.briefingModePanel.classList.add('hidden');
    return;
  }

  elements.briefingModePanel.classList.remove('hidden');
  const alert = view.topPriority;
  if (!alert) {
    elements.briefingModeTitle.textContent = 'Waiting for a verified source pull';
    elements.briefingModeMeta.textContent = 'The briefing screen will lock onto the top live responder item as soon as one arrives.';
    elements.briefingModeSummary.textContent = 'No live responder candidate is available yet, so the app is holding on a clean standby state rather than surfacing stale or placeholder material.';
    elements.briefingModeCopy.disabled = true;
    elements.briefingModeCopy.dataset.briefing = '';
    return;
  }

  const summaryText = effectiveSummary(alert);
  elements.briefingModeTitle.textContent = alert.title;
  elements.briefingModeMeta.textContent = `${alert.location} | ${alert.time} | ${alert.source}`;
  elements.briefingModeSummary.textContent = summaryText;
  elements.briefingModeCopy.disabled = false;
  elements.briefingModeCopy.dataset.briefing = buildBriefing(alert, summaryText);
}

export function renderFeed({ state, elements, view, modalController, invalidateDerivedView, renderAll, saveSet, watchedStorageKey }) {
  const totalItems = view.responder.length;
  const visibleCount = Math.max(1, Number(state.feedVisibleCount || 0));
  const items = view.responder.slice(0, visibleCount);
  elements.responderSection?.classList.toggle('hidden', !items.length);
  elements.feedList.innerHTML = items.length ? items.map((alert) => responderCardMarkup(alert, state.watched.has(alert.id))).join('') : '';
  elements.watchedCount.textContent = `${state.watched.size} watched | ${items.length}/${totalItems} shown`;
  updateLoadMoreButton(elements.feedLoadMore, items.length, totalItems, 'Load more alerts');
  elements.feedList.querySelectorAll('.feed-card').forEach((card) => {
    card.addEventListener('click', () => modalController.openDetail(state.alerts.find((item) => item.id === card.dataset.id)));
  });
  elements.feedList.querySelectorAll('.star-button').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const id = button.dataset.star;
      state.watched.has(id) ? state.watched.delete(id) : state.watched.add(id);
      saveSet(watchedStorageKey, state.watched);
      invalidateDerivedView();
      renderAll();
    });
  });
}

export function renderContext({ elements, view, state, modalController }) {
  const totalItems = view.context.length;
  const visibleCount = Math.max(1, Number(state.contextVisibleCount || 0));
  const items = view.context.slice(0, visibleCount);
  elements.contextCount.textContent = `${items.length}/${totalItems} contextual items`;
  elements.contextList.innerHTML = items.length
    ? items.map(contextCardMarkup).join('')
    : "<p class='panel-copy'>No contextual items have been published into this filter yet.</p>";
  updateLoadMoreButton(elements.contextLoadMore, items.length, totalItems, 'Load more context');
  elements.contextList.querySelectorAll('[data-context]').forEach((card) => {
    card.addEventListener('click', () => modalController.openDetail(state.alerts.find((item) => item.id === card.dataset.context)));
  });
}

export function renderQuarantine({ elements, view, state, modalController }) {
  const totalItems = view.quarantine.length;
  const visibleCount = Math.max(1, Number(state.quarantineVisibleCount || 0));
  const items = view.quarantine.slice(0, visibleCount);
  elements.quarantineCount.textContent = `${items.length}/${totalItems} doubtful items`;
  elements.quarantineList.innerHTML = items.length
    ? items.map(quarantineCardMarkup).join('')
    : "<p class='panel-copy'>No doubtful items are parked in quarantine for this filter.</p>";
  updateLoadMoreButton(elements.quarantineLoadMore, items.length, totalItems, 'Load more quarantine');
  elements.quarantineList.querySelectorAll('[data-quarantine]').forEach((card) => {
    card.addEventListener('click', () => modalController.openDetail(state.alerts.find((item) => item.id === card.dataset.quarantine)));
  });
}

export function renderHero({ state, elements }) {
  const regionCopy = state.briefingMode
    ? 'Top alert only'
    : (state.activeRegion === 'all'
      ? (state.userLocationLabel ? `${state.userLocationLabel} feeds` : 'All feeds')
      : `${regionLabel(state.activeRegion)} feeds`);
  const locationCopy = state.userLocationLabel || 'Local user';
  elements.heroRegion.textContent = `${regionCopy} | ${locationCopy}`;
  const healthRefresh = state.liveFeedHealth?.lastSuccessfulRefreshTime;
  const stamp = healthRefresh ? new Date(healthRefresh) : state.liveFeedGeneratedAt;
  const hasValidStamp = stamp instanceof Date && !Number.isNaN(stamp.getTime());
  const sourceCount = displaySourceCount(state);
  elements.heroUpdated.textContent = hasValidStamp
    ? `${stamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} | ${sourceCount} sources`
    : 'Waiting for first live update';
}
