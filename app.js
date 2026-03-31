import { watchLayerLabels, laneLabels, albertQuotes, defaultNotes } from './shared/ui-data.mjs';
import {
  formatAgeFrom,
  severityLabel,
  regionLabel,
  keywordMatches,
  isTerrorRelevant,
  effectiveSummary,
  sortAlertsByFreshness,
  isLiveIncidentCandidate,
  quarantineReason,
  isQuarantineCandidate,
  contextLabel,
  renderSceneClock,
  renderConfidenceLadder,
  buildAuditBlock,
  renderCorroboratingSources,
  buildBriefing,
  normaliseAlert
} from './shared/alert-view-model.mjs';
import {
  deriveView,
  loadGeoLookup,
  loadWatchGeography,
  loadLiveFeed
} from './shared/feed-controller.mjs';
import { createMapController } from './shared/map-watch.mjs';
import { createModalController } from './shared/modal-briefing.mjs';
import {
  loadSet,
  saveSet,
  loadArray,
  saveArray,
  loadBoolean,
  nextAlbertQuote,
  setActiveTab as applyTabState,
  applyBriefingMode as syncBriefingMode
} from './shared/persistence-ui.mjs';

const LIVE_FEED_URL = 'live-alerts.json';
const GEO_LOOKUP_URL = 'data/geo-lookup.json';
const WATCH_GEOGRAPHY_URL = 'data/watch-geography.json';
const LONG_BRIEF_API_URL = globalThis.BRIALERT_LONG_BRIEF_API_URL || '';
const POLL_INTERVAL_MS = 60_000;
const SOURCE_PULL_MINUTES = 15;
const WATCHED_STORAGE_KEY = 'brialert.watched';
const NOTES_STORAGE_KEY = 'brialert.notes';
const BRIEFING_MODE_STORAGE_KEY = 'brialert.briefingMode';

const state = {
  alerts: [],
  activeRegion: 'all',
  activeLane: 'all',
  mapTimelineWindow: '24h',
  mapFilters: {
    liveOnly: false,
    officialOnly: false
  },
  activeWatchLayers: new Set(Object.keys(watchLayerLabels)),
  watched: new Set(),
  lastBrowserPollAt: new Date(),
  liveFeedGeneratedAt: null,
  liveSourceCount: 0,
  albertIndex: -1,
  notes: [],
  briefingMode: false,
  activeTab: 'firstalert',
  geoLookup: [],
  watchGeographySites: []
};

let derivedViewCache = null;
let derivedViewDirty = true;
let resizeTimer = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cleanTextBlock(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\bAdvertisement\b/gi, ' ')
    .replace(/\bDid you know with a Digital Subscription.*$/i, ' ')
    .replace(/\bSign up to .*?newsletter.*$/i, ' ')
    .trim();
}

function splitLongBriefSentences(value) {
  return cleanTextBlock(value)
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part, index, all) => all.indexOf(part) === index);
}

function buildLocalLongBrief(alert) {
  const summary = cleanTextBlock(effectiveSummary(alert));
  const sourceSentences = splitLongBriefSentences(alert.sourceExtract || alert.summary || '');
  const chosenSentences = sourceSentences
    .filter((sentence) => sentence.length > 35)
    .slice(0, 10);
  const corroborating = Array.isArray(alert.corroboratingSources) ? alert.corroboratingSources : [];
  const people = Array.isArray(alert.peopleInvolved) ? alert.peopleInvolved.filter(Boolean).slice(0, 6) : [];
  const bits = [
    `${alert.source} reported this ${alert.lane} item under the headline "${alert.title}"${alert.location ? `, linked to ${alert.location}` : ''}${alert.time ? `, with the item timestamped ${alert.time}` : ''}. ${summary || 'The captured feed text provides only a thin summary, so the long brief below is built from the extracted source material and the alert metadata.'}`,
    chosenSentences.length
      ? `The source extract gives the following substantive detail: ${chosenSentences.join(' ')}`
      : 'The captured source extract is limited, so this long brief is relying more heavily on the alert metadata, queue classification, and source context than on a rich article body.',
    alert.eventType
      ? `The item is currently classified in the app as ${String(alert.eventType).replace(/_/g, ' ')}, with the alert sitting in the ${alert.lane} lane and carrying a confidence label of ${alert.confidence}.`
      : `The item currently sits in the ${alert.lane} lane with a confidence label of ${alert.confidence}.`,
    people.length
      ? `Named people or entities carried through the alert payload include: ${people.join('; ')}.`
      : '',
    corroborating.length
      ? `There ${corroborating.length === 1 ? 'is' : 'are'} ${corroborating.length} corroborating source${corroborating.length === 1 ? '' : 's'} attached to this fused incident, which should help separate the core facts from outlet-specific wording or emphasis.`
      : 'No corroborating source has been attached to this item yet, so the picture still depends heavily on the primary source currently shown in the incident detail.',
    alert.publishedAt
      ? `From a recency point of view, the app is treating the item as published ${formatAgeFrom(alert.publishedAt)}, which matters for judging whether this is a live operational development, a disrupted plot, or a later-stage prosecution or context update.`
      : '',
    `Original source link: ${alert.sourceUrl || 'Unavailable'}.`
  ].filter(Boolean);

  return [
    'LONG FACTUAL BRIEF',
    '',
    ...bits.map((paragraph) => paragraph.trim()),
    '',
    'NOTE',
    'This version was generated locally from the captured source text and alert metadata because no server-side AI endpoint is configured for the public site.'
  ].join('\n\n');
}

function detectDeviceProfile() {
  const ua = navigator.userAgent || '';
  const isIphone = /iPhone/i.test(ua);
  const isAndroidPhone = /Android/i.test(ua) && /Mobile/i.test(ua);
  if (isIphone) return 'iphone';
  if (isAndroidPhone) return 'android';
  return 'desktop';
}

function applyDeviceProfile() {
  const profile = detectDeviceProfile();
  document.body.dataset.device = profile;
  document.body.classList.remove('device-iphone', 'device-android', 'device-desktop');
  document.body.classList.add(`device-${profile}`);
}

const elements = {
  priorityCard: document.getElementById('priority-card'),
  screen: document.querySelector('.screen'),
  feedList: document.getElementById('feed-list'),
  contextList: document.getElementById('context-list'),
  quarantineList: document.getElementById('quarantine-list'),
  watchlistList: document.getElementById('watchlist-list'),
  notesList: document.getElementById('notes-list'),
  watchedCount: document.getElementById('watched-count'),
  contextCount: document.getElementById('context-count'),
  quarantineCount: document.getElementById('quarantine-count'),
  watchlistSummary: document.getElementById('watchlist-summary'),
  heroRegion: document.getElementById('hero-region'),
  heroUpdated: document.getElementById('hero-updated'),
  heroPolling: document.getElementById('hero-polling'),
  mapElement: document.getElementById('leaflet-map'),
  mapSummary: document.getElementById('map-summary'),
  mapLayerSummary: document.getElementById('map-layer-summary'),
  mapPostureFilters: document.getElementById('map-posture-filters'),
  mapTimelineFilters: document.getElementById('map-timeline-filters'),
  mapZoomIn: document.getElementById('map-zoom-in'),
  mapZoomOut: document.getElementById('map-zoom-out'),
  mapReset: document.getElementById('map-reset'),
  mapLayerToggles: document.getElementById('map-layer-toggles'),
  filters: document.getElementById('filters'),
  laneFilters: document.getElementById('lane-filters'),
  tabbar: document.getElementById('tabbar'),
  briefingModeToggle: document.getElementById('briefing-mode-toggle'),
  briefingModePanel: document.getElementById('briefing-mode-panel'),
  briefingModeTitle: document.getElementById('briefing-mode-title'),
  briefingModeMeta: document.getElementById('briefing-mode-meta'),
  briefingModeSummary: document.getElementById('briefing-mode-summary'),
  briefingModeCopy: document.getElementById('briefing-mode-copy'),
  albertCard: document.getElementById('albert-card'),
  albertQuote: document.getElementById('albert-quote'),
  albertNote: document.getElementById('albert-note'),
  modal: document.getElementById('detail-modal'),
  closeModal: document.getElementById('close-modal'),
  copyBriefing: document.getElementById('copy-briefing'),
  modalBackdrop: document.getElementById('modal-backdrop'),
  modalTitle: document.getElementById('modal-title'),
  modalMeta: document.getElementById('modal-meta'),
  modalAiSummary: document.getElementById('modal-ai-summary'),
  modalSummary: document.getElementById('modal-summary'),
  modalSceneClock: document.getElementById('modal-scene-clock'),
  modalConfidenceLadder: document.getElementById('modal-confidence-ladder'),
  modalAudit: document.getElementById('modal-audit'),
  modalCorroboration: document.getElementById('modal-corroboration'),
  sceneClockPanel: document.getElementById('scene-clock-panel'),
  confidenceLadderPanel: document.getElementById('confidence-ladder-panel'),
  auditPanel: document.getElementById('audit-panel'),
  corroborationPanel: document.getElementById('corroboration-panel'),
  modalSeverity: document.getElementById('modal-severity'),
  modalStatus: document.getElementById('modal-status'),
  modalSource: document.getElementById('modal-source'),
  modalRegion: document.getElementById('modal-region'),
  modalBriefing: document.getElementById('modal-briefing'),
  modalLink: document.getElementById('modal-link'),
  expandedBriefPanel: document.getElementById('expanded-brief-panel'),
  modalExpandedBrief: document.getElementById('modal-expanded-brief'),
  generateExpandedBrief: document.getElementById('generate-expanded-brief'),
  copyExpandedBrief: document.getElementById('copy-expanded-brief'),
  noteForm: document.getElementById('note-form'),
  noteTitle: document.getElementById('note-title'),
  noteBody: document.getElementById('note-body')
};

const feedDeps = {
  sortAlertsByFreshness,
  isLiveIncidentCandidate,
  isQuarantineCandidate,
  isTerrorRelevant
};

const modalController = createModalController({
  modal: elements.modal,
  modalTitle: elements.modalTitle,
  modalMeta: elements.modalMeta,
  modalAiSummary: elements.modalAiSummary,
  modalSummary: elements.modalSummary,
  modalSceneClock: elements.modalSceneClock,
  modalConfidenceLadder: elements.modalConfidenceLadder,
  sceneClockPanel: elements.sceneClockPanel,
  confidenceLadderPanel: elements.confidenceLadderPanel,
  modalAudit: elements.modalAudit,
  modalCorroboration: elements.modalCorroboration,
  auditPanel: elements.auditPanel,
  corroborationPanel: elements.corroborationPanel,
  modalSeverity: elements.modalSeverity,
  modalStatus: elements.modalStatus,
  modalSource: elements.modalSource,
  modalRegion: elements.modalRegion,
  modalBriefing: elements.modalBriefing,
  modalLink: elements.modalLink,
  copyBriefing: elements.copyBriefing,
  expandedBriefPanel: elements.expandedBriefPanel,
  modalExpandedBrief: elements.modalExpandedBrief,
  generateExpandedBrief: elements.generateExpandedBrief,
  copyExpandedBrief: elements.copyExpandedBrief
}, {
  effectiveSummary,
  buildBriefing,
  renderSceneClock,
  renderConfidenceLadder,
  buildAuditBlock,
  renderCorroboratingSources,
  severityLabel
});

const mapController = createMapController({
  mapElement: elements.mapElement,
  mapSummary: elements.mapSummary,
  mapLayerSummary: elements.mapLayerSummary,
  watchLayerLabels,
  openDetail: modalController.openDetail
});

function invalidateDerivedView() {
  derivedViewDirty = true;
}

function currentView() {
  if (!derivedViewDirty && derivedViewCache) return derivedViewCache;
  derivedViewCache = deriveView(state, feedDeps);
  derivedViewDirty = false;
  return derivedViewCache;
}

function setActiveTab(next) {
  state.activeTab = next;
  applyTabState(next, { tabbar: elements.tabbar }, {
    onTabChange(tab) {
      if (tab === 'map') {
        setTimeout(() => {
          mapController.ensureMap();
          mapController.renderMap(state, filteredMapView(currentView()), true);
        }, 60);
      }
    }
  });
}

function applyBriefingMode() {
  syncBriefingMode(state.briefingMode, {
    screen: elements.screen,
    briefingModeToggle: elements.briefingModeToggle
  }, {
    setActiveTab,
    closeDetailPanel: modalController.closeDetailPanel
  });
}

function renderPriority(view) {
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

function renderBriefingMode(view) {
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

function responderCardMarkup(alert) {
  return `
    <article class="feed-card actionable" data-id="${alert.id}">
      <div class="feed-top">
        <div><h4>${escapeHtml(alert.title)}</h4><p>${escapeHtml(alert.location)}</p></div>
        <div class="feed-actions">
          <button class="star-button ${state.watched.has(alert.id) ? 'active' : ''}" data-star="${alert.id}">${state.watched.has(alert.id) ? 'Watch' : 'Track'}</button>
          <span class="severity severity-${escapeHtml(alert.severity)}">${escapeHtml(severityLabel(alert.severity))}</span>
        </div>
      </div>
      <p>${escapeHtml(alert.summary)}</p>
      <div class="meta-row"><span>${escapeHtml(alert.source)}</span><span>${escapeHtml(alert.status)}</span><span>${Number(alert.corroborationCount || 0)} corroborating</span></div>
    </article>`;
}

function renderFeed(view) {
  const items = view.responder;
  elements.feedList.innerHTML = items.length ? items.map(responderCardMarkup).join('') : "<p class='panel-copy'>No verified responder triggers are currently in this filter.</p>";
  elements.watchedCount.textContent = `${state.watched.size} watched`;
  elements.feedList.querySelectorAll('.feed-card').forEach((card) => {
    card.addEventListener('click', () => modalController.openDetail(state.alerts.find((item) => item.id === card.dataset.id)));
  });
  elements.feedList.querySelectorAll('.star-button').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const id = button.dataset.star;
      state.watched.has(id) ? state.watched.delete(id) : state.watched.add(id);
      saveSet(WATCHED_STORAGE_KEY, state.watched);
      invalidateDerivedView();
      renderAll();
    });
  });
}

function renderContext(view) {
  const items = view.context.slice(0, 4);
  elements.contextCount.textContent = `${items.length} contextual items`;
  elements.contextList.innerHTML = items.length
    ? items.map((alert) => `<article class="context-pill actionable" data-context="${alert.id}"><h4>${escapeHtml(alert.title)}</h4><p>${escapeHtml(contextLabel(alert))} | ${escapeHtml(alert.source)}</p></article>`).join('')
    : "<p class='panel-copy'>No contextual items have been published into this filter yet.</p>";
  elements.contextList.querySelectorAll('[data-context]').forEach((card) => {
    card.addEventListener('click', () => modalController.openDetail(state.alerts.find((item) => item.id === card.dataset.context)));
  });
}

function renderQuarantine(view) {
  const items = view.quarantine;
  elements.quarantineCount.textContent = `${items.length} doubtful items`;
  elements.quarantineList.innerHTML = items.length ? items.map((alert) => `
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
    </article>`).join('') : "<p class='panel-copy'>No doubtful items are parked in quarantine for this filter.</p>";
  elements.quarantineList.querySelectorAll('[data-quarantine]').forEach((card) => {
    card.addEventListener('click', () => modalController.openDetail(state.alerts.find((item) => item.id === card.dataset.quarantine)));
  });
}

function renderWatchlist() {
  const tracked = state.alerts.filter((alert) => state.watched.has(alert.id));
  elements.watchlistSummary.textContent = tracked.length ? `${tracked.length} tracked incidents` : 'No tracked incidents';
  elements.watchlistList.innerHTML = tracked.length
    ? tracked.map((alert) => `<article class="feed-card actionable" data-watch="${alert.id}"><div class="feed-top"><div><h4>${escapeHtml(alert.title)}</h4><p>${escapeHtml(alert.location)}</p></div><span class="severity severity-${escapeHtml(alert.severity)}">${escapeHtml(laneLabels[alert.lane])}</span></div><p>${escapeHtml(alert.summary)}</p></article>`).join('')
    : "<p class='panel-copy'>Track incidents in F.O.C to pin them here.</p>";
  elements.watchlistList.querySelectorAll('[data-watch]').forEach((card) => {
    card.addEventListener('click', () => modalController.openDetail(state.alerts.find((item) => item.id === card.dataset.watch)));
  });
}

function renderNotes() {
  elements.notesList.replaceChildren();
  state.notes.forEach((note) => {
    const card = document.createElement('article');
    card.className = 'note-card';
    const title = document.createElement('strong');
    title.textContent = String(note.title || '');
    const body = document.createElement('p');
    body.textContent = String(note.body || '');
    card.append(title, body);
    elements.notesList.append(card);
  });
}

function renderHero() {
  const regionCopy = state.briefingMode ? 'Top alert only' : (state.activeRegion === 'all' ? 'All feeds' : `${regionLabel(state.activeRegion)} feeds`);
  const laneCopy = state.briefingMode ? 'Briefing posture' : (state.activeLane === 'all' ? 'Responder posture' : laneLabels[state.activeLane]);
  elements.heroRegion.textContent = `${regionCopy} | ${laneCopy}`;
  const sourceAge = state.liveFeedGeneratedAt ? formatAgeFrom(state.liveFeedGeneratedAt) : 'waiting';
  elements.heroPolling.textContent = `UI checks 60s | feed build ~${SOURCE_PULL_MINUTES}m | source age ${sourceAge}`;
  const stamp = state.liveFeedGeneratedAt || state.lastBrowserPollAt;
  const sourceSuffix = state.liveSourceCount ? ` | ${state.liveSourceCount} sources` : ' | awaiting live pull';
  elements.heroUpdated.textContent = `${stamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${sourceSuffix}`;
}

function alertTimeMsForMap(alert) {
  const raw = alert.publishedAt || alert.happenedWhen || alert.time;
  if (!raw) return 0;
  const stamp = new Date(raw).getTime();
  return Number.isFinite(stamp) ? stamp : 0;
}

function timelineWindowMs(windowKey) {
  if (windowKey === '24h') return 24 * 60 * 60 * 1000;
  if (windowKey === '72h') return 72 * 60 * 60 * 1000;
  if (windowKey === '7d') return 7 * 24 * 60 * 60 * 1000;
  return Infinity;
}

function timelineLabel(windowKey) {
  if (windowKey === '24h') return 'last 24h';
  if (windowKey === '72h') return 'last 72h';
  if (windowKey === '7d') return 'last 7d';
  return 'all time';
}

function filteredMapView(view) {
  const activeFilters = Object.entries(state.mapFilters)
    .filter(([, enabled]) => enabled)
    .map(([key]) => key);
  const windowMs = timelineWindowMs(state.mapTimelineWindow);
  const now = Date.now();

  const filtered = view.filtered.filter((alert) => {
    if (state.mapFilters.liveOnly && !isLiveIncidentCandidate(alert)) return false;
    if (state.mapFilters.officialOnly && !alert.isOfficial) return false;
    if (windowMs !== Infinity) {
      const stamp = alertTimeMsForMap(alert);
      if (!stamp || now - stamp > windowMs) return false;
    }
    return true;
  });

  return {
    ...view,
    filtered,
    mapFilterLabels: [
      timelineLabel(state.mapTimelineWindow),
      ...activeFilters.map((key) => {
      if (key === 'liveOnly') return 'live only';
      if (key === 'officialOnly') return 'official only';
      return key;
      })
    ]
  };
}

function renderAll() {
  const view = currentView();
  renderHero();
  renderBriefingMode(view);
  renderPriority(view);
  renderFeed(view);
  renderContext(view);
  renderQuarantine(view);
  if (state.activeTab === 'map') {
    mapController.renderMap(state, filteredMapView(view));
  }
  renderWatchlist();
  renderNotes();
}

function longBriefUnavailableMessage(alert) {
  return buildLocalLongBrief(alert);
}

async function generateLongBrief() {
  const alert = modalController.getCurrentAlert();
  if (!alert || !elements.generateExpandedBrief || !elements.modalExpandedBrief || !elements.copyExpandedBrief) return;

  elements.generateExpandedBrief.disabled = true;
  elements.generateExpandedBrief.textContent = 'Generating...';

  if (!LONG_BRIEF_API_URL) {
    modalController.setExpandedBrief(longBriefUnavailableMessage(alert));
    elements.generateExpandedBrief.disabled = false;
    return;
  }

  try {
    const response = await fetch(LONG_BRIEF_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: alert.title,
        location: alert.location,
        region: alert.region,
        source: alert.source,
        sourceUrl: alert.sourceUrl,
        summary: effectiveSummary(alert),
        sourceExtract: alert.sourceExtract,
        confidence: alert.confidence,
        lane: alert.lane,
        eventType: alert.eventType,
        peopleInvolved: alert.peopleInvolved
      })
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const brief = String(payload.brief || payload.longBrief || '').trim();
    modalController.setExpandedBrief(brief || 'Long brief generation returned no text.');
  } catch (error) {
    modalController.setExpandedBrief(`LONG BRIEF FAILED\n\n${error instanceof Error ? error.message : 'Unknown error'}`);
  } finally {
    elements.generateExpandedBrief.disabled = false;
  }
}

function refreshAlbertQuote() {
  const next = nextAlbertQuote(albertQuotes, state.albertIndex);
  state.albertIndex = next.index;
  elements.albertQuote.textContent = next.quote;
}

function bindEvents() {
  elements.filters?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-region]');
    if (!button) return;
    state.activeRegion = button.dataset.region;
    invalidateDerivedView();
    elements.filters.querySelectorAll('.filter').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    renderAll();
  });

  elements.laneFilters?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-lane]');
    if (!button) return;
    state.activeLane = button.dataset.lane;
    invalidateDerivedView();
    elements.laneFilters.querySelectorAll('.filter').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    renderAll();
  });

  elements.tabbar?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-tab]');
    if (!button) return;
    setActiveTab(button.dataset.tab);
  });

  elements.noteForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!elements.noteTitle || !elements.noteBody) return;
    const title = elements.noteTitle.value.trim();
    const body = elements.noteBody.value.trim();
    if (!title || !body) return;
    state.notes.unshift({
      title,
      body
    });
    saveArray(NOTES_STORAGE_KEY, state.notes);
    elements.noteTitle.value = '';
    elements.noteBody.value = '';
    renderNotes();
  });

  elements.copyBriefing?.addEventListener('click', async () => {
    const briefing = elements.copyBriefing.dataset.briefing || '';
    if (!briefing) return;
    await modalController.copyTextToButton(briefing, elements.copyBriefing, 'Copy Briefing');
  });

  elements.generateExpandedBrief?.addEventListener('click', generateLongBrief);
  elements.copyExpandedBrief?.addEventListener('click', async () => {
    const brief = elements.copyExpandedBrief.dataset.brief || '';
    if (!brief) return;
    await modalController.copyTextToButton(brief, elements.copyExpandedBrief, 'Copy Long Brief');
  });

  elements.briefingModeToggle?.addEventListener('click', () => {
    state.briefingMode = !state.briefingMode;
    saveBoolean(BRIEFING_MODE_STORAGE_KEY, state.briefingMode);
    applyBriefingMode();
    renderAll();
  });

  elements.briefingModeCopy?.addEventListener('click', async () => {
    const briefing = elements.briefingModeCopy.dataset.briefing || '';
    if (!briefing) return;
    await modalController.copyTextToButton(briefing, elements.briefingModeCopy, 'Copy Briefing');
  });

  elements.closeModal?.addEventListener('click', modalController.closeDetailPanel);
  elements.modalBackdrop?.addEventListener('click', modalController.closeDetailPanel);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') modalController.closeDetailPanel();
  });

  elements.mapZoomIn?.addEventListener('click', () => mapController.zoomMap(1));
  elements.mapZoomOut?.addEventListener('click', () => mapController.zoomMap(-1));
  elements.mapReset?.addEventListener('click', () => mapController.renderMap(state, filteredMapView(currentView()), true));
  elements.mapPostureFilters?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-map-filter]');
    if (!button) return;
    const filterKey = button.dataset.mapFilter;
    if (!Object.prototype.hasOwnProperty.call(state.mapFilters, filterKey)) return;
    state.mapFilters[filterKey] = !state.mapFilters[filterKey];

    elements.mapPostureFilters.querySelectorAll('[data-map-filter]').forEach((item) => {
      item.classList.toggle('active', !!state.mapFilters[item.dataset.mapFilter]);
    });
    mapController.renderMap(state, filteredMapView(currentView()), true);
  });
  elements.mapTimelineFilters?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-map-window]');
    if (!button) return;
    state.mapTimelineWindow = button.dataset.mapWindow || '24h';
    elements.mapTimelineFilters.querySelectorAll('[data-map-window]').forEach((item) => {
      item.classList.toggle('active', item.dataset.mapWindow === state.mapTimelineWindow);
    });
    mapController.renderMap(state, filteredMapView(currentView()), true);
  });
  elements.mapLayerToggles?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-watch-layer]');
    if (!button) return;
    const layer = button.dataset.watchLayer;
    if (state.activeWatchLayers.has(layer)) {
      state.activeWatchLayers.delete(layer);
    } else {
      state.activeWatchLayers.add(layer);
    }
    button.classList.toggle('active', state.activeWatchLayers.has(layer));
    mapController.renderMap(state, filteredMapView(currentView()), true);
  });

  window.addEventListener('resize', () => {
    applyDeviceProfile();
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      mapController.invalidateSize();
    }, 120);
  });

  elements.albertCard?.addEventListener('click', refreshAlbertQuote);
  document.querySelector('.bulldog-card')?.addEventListener('dblclick', () => {
    elements.albertNote.classList.toggle('hidden');
  });
}

async function initialise() {
  applyDeviceProfile();
  state.watched = loadSet(WATCHED_STORAGE_KEY);
  state.notes = loadArray(NOTES_STORAGE_KEY, defaultNotes);
  state.briefingMode = loadBoolean(BRIEFING_MODE_STORAGE_KEY);

  refreshAlbertQuote();
  applyBriefingMode();
  renderAll();
  bindEvents();

  Promise.allSettled([
    loadGeoLookup(state, GEO_LOOKUP_URL),
    loadWatchGeography(state, WATCH_GEOGRAPHY_URL)
  ]).finally(() => {
    loadLiveFeed(state, {
      liveFeedUrl: LIVE_FEED_URL,
      normaliseAlert,
      onAfterLoad: () => {
        invalidateDerivedView();
        renderAll();
      }
    });
  });

  setInterval(() => {
    loadLiveFeed(state, {
      liveFeedUrl: LIVE_FEED_URL,
      normaliseAlert,
      onAfterLoad: () => {
        invalidateDerivedView();
        renderAll();
      }
    });
  }, POLL_INTERVAL_MS);
}

initialise();
