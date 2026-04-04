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

export function renderPriority({ state, elements, view, modalController }) {
  const alert = view.topPriority;
  if (!alert) {
    elements.priorityCard.classList.remove('context-priority');
    elements.priorityCard.innerHTML = `
      <div class="eyebrow">Live Feed Status</div>
      <h2>Waiting for a verified source pull</h2>
      <p class="muted">The app is not showing placeholder incidents anymore. Once the feed builder publishes live items, responder candidates will appear here automatically.</p>
      <div class="meta-row">
        <span>${state.activeRegion === 'all' ? 'All feeds' : `${regionLabel(state.activeRegion)} feeds`}</span>
        <span>${state.activeLane === 'all' ? 'All lanes' : laneLabels[state.activeLane]}</span>
        <span>${state.liveSourceCount ? `${state.liveSourceCount} sources checked` : 'No live feed yet'}</span>
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
  const items = view.responder;
  elements.responderSection?.classList.toggle('hidden', !items.length);
  elements.feedList.innerHTML = items.length ? items.map((alert) => responderCardMarkup(alert, state.watched.has(alert.id))).join('') : '';
  elements.watchedCount.textContent = `${state.watched.size} watched`;
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
  const items = view.context.slice(0, 4);
  elements.contextCount.textContent = `${items.length} contextual items`;
  elements.contextList.innerHTML = items.length
    ? items.map(contextCardMarkup).join('')
    : "<p class='panel-copy'>No contextual items have been published into this filter yet.</p>";
  elements.contextList.querySelectorAll('[data-context]').forEach((card) => {
    card.addEventListener('click', () => modalController.openDetail(state.alerts.find((item) => item.id === card.dataset.context)));
  });
}

export function renderQuarantine({ elements, view, state, modalController }) {
  const items = view.quarantine;
  elements.quarantineCount.textContent = `${items.length} doubtful items`;
  elements.quarantineList.innerHTML = items.length
    ? items.map(quarantineCardMarkup).join('')
    : "<p class='panel-copy'>No doubtful items are parked in quarantine for this filter.</p>";
  elements.quarantineList.querySelectorAll('[data-quarantine]').forEach((card) => {
    card.addEventListener('click', () => modalController.openDetail(state.alerts.find((item) => item.id === card.dataset.quarantine)));
  });
}

export function renderHero({ state, elements }) {
  const regionCopy = state.briefingMode ? 'Top alert only' : (state.activeRegion === 'all' ? 'All feeds' : `${regionLabel(state.activeRegion)} feeds`);
  const laneCopy = state.briefingMode ? 'Briefing posture' : (state.activeLane === 'all' ? 'Responder posture' : laneLabels[state.activeLane]);
  elements.heroRegion.textContent = `${regionCopy} | ${laneCopy}`;
  const stamp = state.liveFeedGeneratedAt || state.lastBrowserPollAt;
  const sourceSuffix = state.liveSourceCount ? ` | ${state.liveSourceCount} sources` : ` | it's time`;
  elements.heroUpdated.textContent = stamp
    ? `${stamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${sourceSuffix}`
    : `Loading${sourceSuffix}`;
}
