import {
  buildBriefing,
  effectiveSummary,
  isLiveIncidentCandidate,
  keywordMatches,
  regionLabel
} from '../../shared/alert-view-model.mjs';
import { laneLabels } from '../../shared/ui-data.mjs';
import {
  supportingCardMarkup,
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

function alertTimeMs(alert) {
  const stamp = alert?.publishedAt || alert?.updatedAt || alert?.firstReportedAt || null;
  const timeMs = stamp ? new Date(stamp).getTime() : NaN;
  return Number.isFinite(timeMs) ? timeMs : 0;
}

function supportingItems(view) {
  return [...view.context, ...view.quarantine].sort((left, right) => alertTimeMs(right) - alertTimeMs(left));
}

export function renderPriority({ state, elements, view, modalController }) {
  const alert = view.topPriority;
  if (!alert) {
    const query = String(state.searchQuery || '').trim();
    const sourceCount = displaySourceCount(state);
    elements.priorityCard.classList.remove('context-priority');
    elements.priorityCard.innerHTML = `
      <div class="eyebrow">Live Feed Status</div>
      <h2>${query ? 'No results found' : 'Waiting for a verified source pull'}</h2>
      <p class="muted">${
        query
          ? `Nothing matched "${escapeHtml(query)}" across incidents, places, sources, or briefing text.`
          : 'The app is not showing placeholder incidents anymore. Once the feed builder publishes live items, responder candidates will appear here automatically.'
      }</p>
      <div class="meta-row">
        <span>${query ? 'Search is active' : (state.activeRegion === 'all' ? 'All feeds' : `${regionLabel(state.activeRegion)} feeds`)}</span>
        <span>${sourceCount ? `${sourceCount} sources checked` : 'No live feed yet'}</span>
      </div>`;
    elements.priorityCard.onclick = null;
    return;
  }

  const liveCandidate = isLiveIncidentCandidate(alert);
  const matches = keywordMatches(alert);
  const timeMeta = String(alert.time || '').trim();
  const priorityMetaParts = [
    `<span>${escapeHtml(alert.source)}</span>`,
    `<span>${matches.length ? `${matches.length} keyword hits` : 'No incident keyword hit'}</span>`,
    timeMeta ? `<span>${escapeHtml(timeMeta)}</span>` : ''
  ].filter(Boolean).join('');
  elements.priorityCard.classList.toggle('context-priority', !liveCandidate);
  elements.priorityCard.innerHTML = `
    <div class="eyebrow">${liveCandidate ? 'Live Terror Incident Trigger' : 'Context Item'}</div>
    <h2>${escapeHtml(alert.title)}</h2>
    <p class="muted">${escapeHtml(laneLabels[alert.lane])} | ${escapeHtml(alert.location)} | ${escapeHtml(alert.status)}</p>
    <p>${escapeHtml(alert.summary)}</p>
    <div class="meta-row">${priorityMetaParts}</div>`;
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
  const briefingTime = String(alert.time || '').trim();
  const briefingMeta = [alert.location, briefingTime, alert.source].map((value) => String(value || '').trim()).filter(Boolean).join(' | ');
  elements.briefingModeTitle.textContent = alert.title;
  elements.briefingModeMeta.textContent = briefingMeta;
  elements.briefingModeSummary.textContent = summaryText;
  elements.briefingModeCopy.disabled = false;
  elements.briefingModeCopy.dataset.briefing = buildBriefing(alert, summaryText);
}

export function renderFeed({ state, elements, view, modalController, invalidateDerivedView, renderAll, saveSet, watchedStorageKey }) {
  const totalItems = view.responder.length;
  const hasSearch = Boolean(String(state.searchQuery || '').trim());
  const visibleCount = hasSearch ? totalItems : Math.max(1, Number(state.feedVisibleCount || 0));
  const items = view.responder.slice(0, visibleCount);
  elements.responderSection?.classList.toggle('hidden', !items.length);
  elements.feedList.innerHTML = items.length ? items.map((alert) => responderCardMarkup(alert, state.watched.has(alert.id))).join('') : '';
  elements.watchedCount.textContent = hasSearch
    ? `${items.length} matching alerts`
    : `${state.watched.size} watched | ${items.length}/${totalItems} shown`;
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

export function renderSupporting({ elements, view, state, modalController }) {
  const itemsPool = supportingItems(view);
  const totalItems = itemsPool.length;
  const hasSearch = Boolean(String(state.searchQuery || '').trim());
  const visibleCount = hasSearch ? totalItems : Math.max(1, Number(state.supportingVisibleCount || 0));
  const items = itemsPool.slice(0, visibleCount);
  elements.supportingCount.textContent = hasSearch
    ? `${items.length} matching items`
    : totalItems
      ? `${items.length}/${totalItems} items`
      : '0 items';
  elements.supportingList.innerHTML = items.length
    ? items.map(supportingCardMarkup).join('')
    : `<p class='panel-copy'>${
      hasSearch
        ? 'No results found.'
        : 'No additional reporting has landed in this filter yet.'
    }</p>`;
  updateLoadMoreButton(elements.supportingLoadMore, items.length, totalItems, 'Load more reporting');
  elements.supportingList.querySelectorAll('[data-supporting]').forEach((card) => {
    card.addEventListener('click', () => modalController.openDetail(state.alerts.find((item) => item.id === card.dataset.supporting)));
  });
}

export function renderHero({ state, elements }) {
  if (elements.heroSearch && elements.heroSearch.value !== state.searchQuery) {
    elements.heroSearch.value = state.searchQuery;
  }
  const healthRefresh = state.liveFeedHealth?.lastSuccessfulRefreshTime;
  const stamp = healthRefresh ? new Date(healthRefresh) : state.liveFeedGeneratedAt;
  const hasValidStamp = stamp instanceof Date && !Number.isNaN(stamp.getTime());
  const sourceCount = displaySourceCount(state);
  const fetchedAlerts = state.liveFetchedAlertCount || 0;
  const renderedAlerts = Array.isArray(state.alerts) ? state.alerts.length : 0;
  const articleCountText = fetchedAlerts > renderedAlerts
    ? `Showing ${renderedAlerts} of ${fetchedAlerts} articles`
    : `${renderedAlerts} articles`;
  elements.heroUpdated.textContent = hasValidStamp
    ? `${stamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} | ${sourceCount} sources | ${articleCountText}`
    : 'Waiting for first live update';
}
