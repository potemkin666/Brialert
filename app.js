import { watchLayerLabels, watchGeographySites, laneLabels, albertQuotes, defaultNotes } from './shared/ui-data.mjs';
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
  isStrictTopAlertCandidate,
  contextLabel,
  renderSceneClock,
  buildAuditBlock,
  renderCorroboratingSources,
  buildBriefing,
  normaliseAlert
} from './shared/alert-view-model.mjs';

const LIVE_FEED_URL = 'live-alerts.json';
const GEO_LOOKUP_URL = 'data/geo-lookup.json';
const POLL_INTERVAL_MS = 60_000;
const SOURCE_PULL_MINUTES = 15;
const WATCHED_STORAGE_KEY = 'brialert.watched';
const NOTES_STORAGE_KEY = 'brialert.notes';
const BRIEFING_MODE_STORAGE_KEY = 'brialert.briefingMode';
const STRICT_RESPONDER_MODE_STORAGE_KEY = 'brialert.strictResponderMode';
let alerts = [];
let activeRegion = 'all';
let activeLane = 'all';
let activeWatchLayers = new Set(Object.keys(watchLayerLabels));
let watched = new Set();
let lastBrowserPollAt = new Date();
let liveFeedGeneratedAt = null;
let liveSourceCount = 0;
let albertIndex = -1;
let notes = [];
let briefingMode = false;
let strictResponderMode = false;
let activeTab = 'firstalert';
let liveMap = null;
let liveMarkers = [];
let watchSiteMarkers = [];
let lastMapSignature = '';
let geoLookup = [];

const priorityCard = document.getElementById('priority-card');
const screen = document.querySelector('.screen');
const feedList = document.getElementById('feed-list');
const contextList = document.getElementById('context-list');
const quarantineList = document.getElementById('quarantine-list');
const watchlistList = document.getElementById('watchlist-list');
const notesList = document.getElementById('notes-list');
const watchedCount = document.getElementById('watched-count');
const contextCount = document.getElementById('context-count');
const quarantineCount = document.getElementById('quarantine-count');
const watchlistSummary = document.getElementById('watchlist-summary');
const heroRegion = document.getElementById('hero-region');
const heroUpdated = document.getElementById('hero-updated');
const heroPolling = document.getElementById('hero-polling');
const mapElement = document.getElementById('leaflet-map');
const mapSummary = document.getElementById('map-summary');
const mapLayerSummary = document.getElementById('map-layer-summary');
const mapZoomIn = document.getElementById('map-zoom-in');
const mapZoomOut = document.getElementById('map-zoom-out');
const mapReset = document.getElementById('map-reset');
const mapLayerToggles = document.getElementById('map-layer-toggles');
const filters = document.getElementById('filters');
const laneFilters = document.getElementById('lane-filters');
const tabbar = document.getElementById('tabbar');
const briefingModeToggle = document.getElementById('briefing-mode-toggle');
const strictResponderModeToggle = document.getElementById('strict-responder-mode-toggle');
const briefingModePanel = document.getElementById('briefing-mode-panel');
const briefingModeTitle = document.getElementById('briefing-mode-title');
const briefingModeMeta = document.getElementById('briefing-mode-meta');
const briefingModeSummary = document.getElementById('briefing-mode-summary');
const briefingModeCopy = document.getElementById('briefing-mode-copy');
const albertCard = document.getElementById('albert-card');
const albertQuote = document.getElementById('albert-quote');
const albertNote = document.getElementById('albert-note');
const modal = document.getElementById('detail-modal');
const closeModal = document.getElementById('close-modal');
const copyBriefing = document.getElementById('copy-briefing');
const modalBackdrop = document.getElementById('modal-backdrop');
const modalTitle = document.getElementById('modal-title');
const modalMeta = document.getElementById('modal-meta');
const modalAiSummary = document.getElementById('modal-ai-summary');
const modalSummary = document.getElementById('modal-summary');
const modalSceneClock = document.getElementById('modal-scene-clock');
const modalAudit = document.getElementById('modal-audit');
const modalCorroboration = document.getElementById('modal-corroboration');
const sceneClockPanel = document.getElementById('scene-clock-panel');
const auditPanel = document.getElementById('audit-panel');
const corroborationPanel = document.getElementById('corroboration-panel');
const modalSeverity = document.getElementById('modal-severity');
const modalStatus = document.getElementById('modal-status');
const modalSource = document.getElementById('modal-source');
const modalRegion = document.getElementById('modal-region');
const modalBriefing = document.getElementById('modal-briefing');
const modalLink = document.getElementById('modal-link');

function loadWatched() {
  try {
    const raw = localStorage.getItem(WATCHED_STORAGE_KEY);
    const parsed = JSON.parse(raw || '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter(Boolean) : []);
  } catch {
    return new Set();
  }
}
function saveWatched() {
  try {
    localStorage.setItem(WATCHED_STORAGE_KEY, JSON.stringify([...watched]));
  } catch {}
}
function loadNotes() {
  try {
    const raw = localStorage.getItem(NOTES_STORAGE_KEY);
    const parsed = JSON.parse(raw || 'null');
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch {}
  return [...defaultNotes];
}
function loadBriefingMode() {
  try {
    return localStorage.getItem(BRIEFING_MODE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}
function loadStrictResponderMode() {
  try {
    return localStorage.getItem(STRICT_RESPONDER_MODE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}
function saveNotes() {
  try {
    localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(notes));
  } catch {}
}
function saveBriefingMode() {
  try {
    localStorage.setItem(BRIEFING_MODE_STORAGE_KEY, String(briefingMode));
  } catch {}
}
function saveStrictResponderMode() {
  try {
    localStorage.setItem(STRICT_RESPONDER_MODE_STORAGE_KEY, String(strictResponderMode));
  } catch {}
}
async function loadGeoLookup() {
  try {
    const response = await fetch(`${GEO_LOOKUP_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    geoLookup = Array.isArray(data) ? data : [];
  } catch {
    geoLookup = [];
  }
}
function visibleWatchSites() {
  return watchGeographySites.filter((site) =>
    activeWatchLayers.has(site.category) &&
    (activeRegion === 'all' || site.region === activeRegion)
  );
}
function filteredAlerts() {
  return alerts.filter((alert) =>
    (activeRegion === 'all' || alert.region === activeRegion) &&
    (activeLane === 'all' || alert.lane === activeLane)
  );
}
function deriveView() {
  const filtered = filteredAlerts();
  const responder = sortAlertsByFreshness(filtered.filter(isLiveIncidentCandidate));
  const context = sortAlertsByFreshness(filtered.filter((alert) => {
    if (isQuarantineCandidate(alert)) return false;
    if (alert.lane === 'incidents' && !isTerrorRelevant(alert)) return false;
    return !isLiveIncidentCandidate(alert);
  }));
  const quarantine = sortAlertsByFreshness(filtered.filter(isQuarantineCandidate)).slice(0, 6);
  const topPriority = strictResponderMode
    ? responder.filter(isStrictTopAlertCandidate)[0] || null
    : (responder[0] || context[0] || null);

  return { filtered, responder, context, quarantine, topPriority };
}

function setActiveTab(next) {
  activeTab = next;
  tabbar.querySelectorAll('.tab').forEach((item) => item.classList.toggle('active', item.dataset.tab === next));
  document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === next));
  if (next === 'map') {
    setTimeout(() => {
      ensureMap();
      renderMap(deriveView(), true);
    }, 60);
  }
}

function applyBriefingMode() {
  screen.classList.toggle('briefing-mode', briefingMode);
  briefingModeToggle.classList.toggle('active', briefingMode);
  briefingModeToggle.setAttribute('aria-pressed', briefingMode ? 'true' : 'false');
  briefingModeToggle.textContent = briefingMode ? 'Briefing mode on' : 'Briefing mode off';
  if (briefingMode) {
    setActiveTab('firstalert');
    closeDetailPanel();
  }
}

function applyStrictResponderMode() {
  strictResponderModeToggle.classList.toggle('active', strictResponderMode);
  strictResponderModeToggle.setAttribute('aria-pressed', strictResponderMode ? 'true' : 'false');
  strictResponderModeToggle.textContent = strictResponderMode ? 'Strict responder on' : 'Strict responder off';
}

async function loadLiveFeed() {
  try {
    const response = await fetch(`${LIVE_FEED_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    alerts = Array.isArray(data.alerts) ? data.alerts.map((alert, index) => normaliseAlert(alert, index, geoLookup)) : [];
    liveFeedGeneratedAt = data.generatedAt ? new Date(data.generatedAt) : new Date();
    liveSourceCount = Number(data.sourceCount || 0);
  } catch {
    alerts = [];
    liveFeedGeneratedAt = null;
    liveSourceCount = 0;
  }
  lastBrowserPollAt = new Date();
  renderAll();
}

function renderPriority(view) {
  const alert = view.topPriority;
  if (!alert) {
    priorityCard.classList.remove('context-priority');
    priorityCard.innerHTML = `
      <div class="eyebrow">Live Feed Status</div>
      <h2>Waiting for a verified source pull</h2>
      <p class="muted">${strictResponderMode ? 'Strict responder mode is on, so only trigger-tier official CT sources can drive this top alert.' : 'The app is not showing placeholder incidents anymore. Once the feed builder publishes live items, responder candidates will appear here automatically.'}</p>
      <div class="meta-row">
        <span>${activeRegion === 'all' ? 'All feeds' : `${regionLabel(activeRegion)} feeds`}</span>
        <span>${activeLane === 'all' ? 'All lanes' : laneLabels[activeLane]}</span>
        <span>${strictResponderMode ? 'Strict responder gate on' : (liveSourceCount ? `${liveSourceCount} sources checked` : 'No live feed yet')}</span>
      </div>`;
    priorityCard.onclick = null;
    return;
  }
  const liveCandidate = isLiveIncidentCandidate(alert);
  const matches = keywordMatches(alert);
  priorityCard.classList.toggle('context-priority', !liveCandidate);
  priorityCard.innerHTML = `
    <div class="eyebrow">${liveCandidate ? 'Live Terror Incident Trigger' : 'Context Item'}</div>
    <h2>${alert.title}</h2>
    <p class="muted">${laneLabels[alert.lane]} | ${alert.location} | ${alert.status}</p>
    <p>${alert.summary}</p>
    <div class="meta-row">
      <span>${alert.source}</span>
      <span>${matches.length ? `${matches.length} keyword hits` : 'No incident keyword hit'}</span>
      <span>${alert.time}</span>
    </div>`;
  priorityCard.onclick = () => openDetail(alert);
}
function renderBriefingMode(view) {
  if (!briefingMode) {
    briefingModePanel.classList.add('hidden');
    return;
  }

  briefingModePanel.classList.remove('hidden');
  const alert = view.topPriority;
  if (!alert) {
    briefingModeTitle.textContent = 'Waiting for a verified source pull';
    briefingModeMeta.textContent = strictResponderMode
      ? 'Strict responder mode is active, so this view waits for a trigger-tier official CT alert.'
      : 'The briefing screen will lock onto the top live responder item as soon as one arrives.';
    briefingModeSummary.textContent = strictResponderMode
      ? 'No trigger-tier official CT candidate is available yet, so the app is holding a clean standby state instead of promoting broader corroboration or media-led material.'
      : 'No live responder candidate is available yet, so the app is holding on a clean standby state rather than surfacing stale or placeholder material.';
    briefingModeCopy.disabled = true;
    briefingModeCopy.dataset.briefing = '';
    return;
  }

  const summaryText = effectiveSummary(alert);
  briefingModeTitle.textContent = alert.title;
  briefingModeMeta.textContent = `${alert.location} | ${alert.time} | ${alert.source}`;
  briefingModeSummary.textContent = summaryText;
  briefingModeCopy.disabled = false;
  briefingModeCopy.dataset.briefing = buildBriefing(alert, summaryText);
}

function responderCardMarkup(alert) {
  return `
    <article class="feed-card actionable" data-id="${alert.id}">
      <div class="feed-top">
        <div><h4>${alert.title}</h4><p>${alert.location}</p></div>
        <div class="feed-actions">
          <button class="star-button ${watched.has(alert.id) ? 'active' : ''}" data-star="${alert.id}">${watched.has(alert.id) ? 'Watch' : 'Track'}</button>
          <span class="severity severity-${alert.severity}">${severityLabel(alert.severity)}</span>
        </div>
        </div>
        <p>${alert.summary}</p>
        <div class="meta-row"><span>${alert.source}</span><span>${alert.status}</span><span>${Number(alert.corroborationCount || 0)} corroborating</span></div>
      </article>`;
}

function renderFeed(view) {
  const items = view.responder;
  feedList.innerHTML = items.length ? items.map(responderCardMarkup).join('') : "<p class='panel-copy'>No verified responder triggers are currently in this filter.</p>";
  watchedCount.textContent = `${watched.size} watched`;
  feedList.querySelectorAll('.feed-card').forEach((card) => card.addEventListener('click', () => openDetail(alerts.find((item) => item.id === card.dataset.id))));
  feedList.querySelectorAll('.star-button').forEach((button) => button.addEventListener('click', (event) => { event.stopPropagation(); const id = button.dataset.star; watched.has(id) ? watched.delete(id) : watched.add(id); saveWatched(); renderAll(); }));
}

function renderContext(view) {
  const items = view.context.slice(0, 4);
  contextCount.textContent = `${items.length} contextual items`;
  contextList.innerHTML = items.length ? items.map((alert) => `<article class="context-pill actionable" data-context="${alert.id}"><h4>${alert.title}</h4><p>${contextLabel(alert)} | ${alert.source}</p></article>`).join('') : "<p class='panel-copy'>No contextual items have been published into this filter yet.</p>";
  contextList.querySelectorAll('[data-context]').forEach((card) => card.addEventListener('click', () => openDetail(alerts.find((item) => item.id === card.dataset.context))));
}
function renderQuarantine(view) {
  const items = view.quarantine;
  quarantineCount.textContent = `${items.length} doubtful items`;
  quarantineList.innerHTML = items.length ? items.map((alert) => `
    <article class="quarantine-card actionable" data-quarantine="${alert.id}">
      <div class="section-heading">
        <h4>${alert.title}</h4>
        <span class="quarantine-badge">Quarantine</span>
      </div>
      <p>${alert.summary}</p>
      <div class="meta-row">
        <span>${alert.source}</span>
        <span>${quarantineReason(alert)}</span>
        <span>${alert.time}</span>
      </div>
    </article>`).join('') : "<p class='panel-copy'>No doubtful items are parked in quarantine for this filter.</p>";
  quarantineList.querySelectorAll('[data-quarantine]').forEach((card) => card.addEventListener('click', () => openDetail(alerts.find((item) => item.id === card.dataset.quarantine))));
}

function ensureMap() {
  if (liveMap || !mapElement || typeof L === 'undefined') return;
  liveMap = L.map(mapElement, {
    center: [20, 10],
    zoom: 2,
    minZoom: 2,
    maxZoom: 8,
    zoomControl: false,
    worldCopyJump: true,
    attributionControl: true
  });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(liveMap);
}

function mapIconForSeverity(severity) {
  const safeSeverity = ['critical', 'high', 'elevated', 'moderate'].includes(severity) ? severity : 'moderate';
  return L.divIcon({
    className: 'map-pin-icon',
    html: `<span class="map-pin map-pin--${safeSeverity}"></span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 22],
    popupAnchor: [0, -16]
  });
}
function watchSiteIcon(category) {
  return L.divIcon({
    className: 'watch-site-icon',
    html: `<span class="watch-site-marker watch-site-marker--${category}"></span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    popupAnchor: [0, -8]
  });
}

function renderMap(view, forceFit = false) {
  ensureMap();
  if (!liveMap) return;
  liveMarkers.forEach((marker) => marker.remove());
  watchSiteMarkers.forEach((marker) => marker.remove());
  liveMarkers = [];
  watchSiteMarkers = [];

  const items = view.filtered.filter((alert) => Number.isFinite(alert.lat) && Number.isFinite(alert.lng));
  const sites = visibleWatchSites();
  const signature = [
    items.map((alert) => `${alert.id}:${alert.lat.toFixed(3)},${alert.lng.toFixed(3)}`).join('|'),
    sites.map((site) => `${site.id}:${site.category}`).join('|')
  ].join('::');
  const bounds = [];

  items.forEach((alert) => {
    const marker = L.marker([alert.lat, alert.lng], {
      icon: mapIconForSeverity(alert.severity),
      keyboard: true,
      title: alert.title
    });
    marker.on('click', () => openDetail(alert));
    marker.addTo(liveMap);
    liveMarkers.push(marker);
    bounds.push([alert.lat, alert.lng]);
  });

  sites.forEach((site) => {
    const marker = L.marker([site.lat, site.lng], {
      icon: watchSiteIcon(site.category),
      keyboard: true,
      title: site.name
    });
    marker.bindPopup(`<div class="watch-site-popup"><strong>${site.name}</strong><p>${watchLayerLabels[site.category]} | ${site.note}</p></div>`);
    marker.addTo(liveMap);
    watchSiteMarkers.push(marker);
    bounds.push([site.lat, site.lng]);
  });

  mapSummary.textContent = `${view.responder.length} responder items | ${view.context.length} context | ${view.quarantine.length} quarantine | ${items.length} plotted alerts`;
  mapLayerSummary.textContent = `${sites.length} watch sites visible`;

  if (items.length && (forceFit || signature !== lastMapSignature)) {
    liveMap.fitBounds(bounds, {
      padding: [28, 28],
      maxZoom: items.length === 1 ? 6 : 5
    });
  } else if (!items.length && sites.length && (forceFit || signature !== lastMapSignature)) {
    liveMap.fitBounds(bounds, {
      padding: [28, 28],
      maxZoom: 5
    });
  } else if (!items.length && (forceFit || lastMapSignature)) {
    liveMap.setView([20, 10], 2);
  }

  lastMapSignature = signature;
  requestAnimationFrame(() => liveMap.invalidateSize());
}

function renderWatchlist() {
  const tracked = alerts.filter((alert) => watched.has(alert.id));
  watchlistSummary.textContent = tracked.length ? `${tracked.length} tracked incidents` : 'No tracked incidents';
  watchlistList.innerHTML = tracked.length ? tracked.map((alert) => `<article class="feed-card actionable" data-watch="${alert.id}"><div class="feed-top"><div><h4>${alert.title}</h4><p>${alert.location}</p></div><span class="severity severity-${alert.severity}">${laneLabels[alert.lane]}</span></div><p>${alert.summary}</p></article>`).join('') : "<p class='panel-copy'>Track incidents in F.O.C to pin them here.</p>";
  watchlistList.querySelectorAll('[data-watch]').forEach((card) => card.addEventListener('click', () => openDetail(alerts.find((item) => item.id === card.dataset.watch))));
}

function renderNotes() { notesList.innerHTML = notes.map((note) => `<article class="note-card"><strong>${note.title}</strong><p>${note.body}</p></article>`).join(''); }

function renderHero() {
  const regionCopy = briefingMode ? 'Top alert only' : (activeRegion === 'all' ? 'All feeds' : `${regionLabel(activeRegion)} feeds`);
  const laneCopy = briefingMode ? 'Briefing posture' : (activeLane === 'all' ? 'Responder posture' : laneLabels[activeLane]);
  heroRegion.textContent = `${regionCopy} | ${laneCopy}`;
  const sourceAge = liveFeedGeneratedAt ? formatAgeFrom(liveFeedGeneratedAt) : 'waiting';
  heroPolling.textContent = `UI checks 60s | feed build ~${SOURCE_PULL_MINUTES}m | source age ${sourceAge}${strictResponderMode ? ' | strict trigger gate' : ''}`;
  const stamp = liveFeedGeneratedAt || lastBrowserPollAt;
  const sourceSuffix = liveSourceCount ? ` | ${liveSourceCount} sources` : ' | awaiting live pull';
  heroUpdated.textContent = `${stamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${sourceSuffix}`;
}

function renderAll() {
  const view = deriveView();
  renderHero();
  renderBriefingMode(view);
  renderPriority(view);
  renderFeed(view);
  renderContext(view);
  renderQuarantine(view);
  renderMap(view);
  renderWatchlist();
  renderNotes();
}

function nextAlbertQuote() {
  if (!albertQuotes.length) return '';
  if (albertQuotes.length === 1) {
    albertIndex = 0;
    return albertQuotes[0];
  }
  let nextIndex = Math.floor(Math.random() * albertQuotes.length);
  while (nextIndex === albertIndex) {
    nextIndex = Math.floor(Math.random() * albertQuotes.length);
  }
  albertIndex = nextIndex;
  return albertQuotes[nextIndex];
}

function zoomMap(direction) {
  ensureMap();
  if (!liveMap) return;
  if (direction > 0) liveMap.zoomIn();
  if (direction < 0) liveMap.zoomOut();
}

function openDetail(alert) {
  if (!alert) return;
  const summaryText = effectiveSummary(alert);
  const briefing = buildBriefing(alert, summaryText);
  modalTitle.textContent = alert.title;
  modalMeta.textContent = `${alert.location} | ${alert.time}`;
  modalAiSummary.textContent = summaryText;
  modalSummary.textContent = '';
  modalSummary.hidden = true;
  modalSceneClock.innerHTML = renderSceneClock(alert);
  sceneClockPanel.hidden = false;
  modalAudit.textContent = buildAuditBlock(alert);
  modalCorroboration.innerHTML = renderCorroboratingSources(alert);
  auditPanel.hidden = false;
  corroborationPanel.hidden = false;
  modalSeverity.textContent = severityLabel(alert.severity);
  modalStatus.textContent = alert.status;
  modalSource.textContent = alert.source;
  modalRegion.textContent = alert.region === 'uk' ? 'United Kingdom' : 'Europe';
  modalBriefing.textContent = briefing;
  modalLink.href = alert.sourceUrl;
  copyBriefing.dataset.briefing = briefing;
  document.body.classList.add('modal-open');
  modal.classList.remove('hidden');
}

function closeDetailPanel() {
  document.body.classList.remove('modal-open');
  modal.classList.add('hidden');
}
async function copyTextToButton(text, button, idleLabel) {
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = 'Copied';
  } catch {
    button.textContent = 'Copy failed';
  }
  setTimeout(() => {
    button.textContent = idleLabel;
  }, 1200);
}

filters.addEventListener('click', (event) => { const button = event.target.closest('[data-region]'); if (!button) return; activeRegion = button.dataset.region; filters.querySelectorAll('.filter').forEach((item) => item.classList.remove('active')); button.classList.add('active'); renderAll(); });
laneFilters.addEventListener('click', (event) => { const button = event.target.closest('[data-lane]'); if (!button) return; activeLane = button.dataset.lane; laneFilters.querySelectorAll('.filter').forEach((item) => item.classList.remove('active')); button.classList.add('active'); renderAll(); });
tabbar.addEventListener('click', (event) => {
  const button = event.target.closest('[data-tab]');
  if (!button) return;
  setActiveTab(button.dataset.tab);
});
document.getElementById('note-form')?.addEventListener('submit', (event) => { event.preventDefault(); const title = document.getElementById('note-title'); const body = document.getElementById('note-body'); if (!title || !body) return; notes.unshift({ title: title.value.trim(), body: body.value.trim() }); saveNotes(); title.value = ''; body.value = ''; renderNotes(); });
copyBriefing.addEventListener('click', async () => { const briefing = copyBriefing.dataset.briefing || ''; if (!briefing) return; await copyTextToButton(briefing, copyBriefing, 'Copy Briefing'); });
briefingModeToggle.addEventListener('click', () => { briefingMode = !briefingMode; saveBriefingMode(); applyBriefingMode(); renderAll(); });
strictResponderModeToggle.addEventListener('click', () => { strictResponderMode = !strictResponderMode; saveStrictResponderMode(); applyStrictResponderMode(); renderAll(); });
briefingModeCopy.addEventListener('click', async () => { const briefing = briefingModeCopy.dataset.briefing || ''; if (!briefing) return; await copyTextToButton(briefing, briefingModeCopy, 'Copy Briefing'); });
closeModal.addEventListener('click', closeDetailPanel);
modalBackdrop.addEventListener('click', closeDetailPanel);
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeDetailPanel(); });
mapZoomIn.addEventListener('click', () => zoomMap(1));
mapZoomOut.addEventListener('click', () => zoomMap(-1));
mapReset.addEventListener('click', () => renderMap(deriveView(), true));
mapLayerToggles.addEventListener('click', (event) => {
  const button = event.target.closest('[data-watch-layer]');
  if (!button) return;
  const layer = button.dataset.watchLayer;
  if (activeWatchLayers.has(layer)) {
    activeWatchLayers.delete(layer);
  } else {
    activeWatchLayers.add(layer);
  }
  button.classList.toggle('active', activeWatchLayers.has(layer));
  renderMap(deriveView(), true);
});
window.addEventListener('resize', () => {
  if (!liveMap) return;
  requestAnimationFrame(() => liveMap.invalidateSize());
});
watched = loadWatched();
notes = loadNotes();
briefingMode = loadBriefingMode();
strictResponderMode = loadStrictResponderMode();
albertQuote.textContent = nextAlbertQuote();
albertCard?.addEventListener('click', () => { albertQuote.textContent = nextAlbertQuote(); });
document.querySelector('.bulldog-card')?.addEventListener('dblclick', () => { albertNote.classList.toggle('hidden'); });

applyBriefingMode();
applyStrictResponderMode();
renderAll();
loadGeoLookup().finally(() => {
  loadLiveFeed();
});
setInterval(loadLiveFeed, POLL_INTERVAL_MS);

