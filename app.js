const LIVE_FEED_URL = '/Brialert/live-alerts.json';
const POLL_INTERVAL_MS = 60_000;
const SOURCE_PULL_MINUTES = 15;

const laneLabels = { all: 'All lanes', incidents: 'Incidents', sanctions: 'Sanctions', oversight: 'Oversight', border: 'Border', prevention: 'Prevention' };
const incidentKeywords = ['terror','terrorism','attack','attacks','bomb','bombing','explosion','explosive','device','ramming','stabbing','shooting','hostage','plot','suspect','arrest','charged','charged with','parcel','radicalised','extremist','isis','islamic state','al-qaeda','threat'];
const trustedMajorSources = new Set(['Counter Terrorism Policing','Eurojust','GOV.UK','Europol','Reuters','The Guardian','BBC News','Associated Press','INTERPOL','National Crime Agency']);
const albertQuoteOpeners = [
  'Stay steady',
  'Hold your nerve',
  'Keep your footing',
  'Move with intent',
  'Trust your training',
  'Lead with calm',
  'Read the room',
  'Think before you surge',
  'Stand tall',
  'Keep the signal clean',
  'Anchor the team',
  'Breathe and reset',
  'Protect the tempo',
  'Let discipline speak',
  'Be harder to shake',
  'Keep your edge',
  'Stay sharp',
  'Hold the line'
];
const albertQuoteClosers = [
  'clear heads make better decisions.',
  'calm beats noise every time.',
  'clarity is faster than panic.',
  'quiet confidence travels further than fear.',
  'steady people steady everyone else.',
  'good judgement starts with one slow breath.',
  'speed matters most after the picture is clear.',
  'strong teams borrow calm from each other.',
  'discipline turns pressure into structure.',
  'presence matters when the room feels thin.',
  'the best brief is the one people can trust.',
  'facts first, ego never.',
  'you do not need chaos to move quickly.',
  'the next right decision is enough.',
  'clean thinking is operational strength.',
  'composure is part of the toolkit.',
  'being grounded helps everyone think straighter.',
  'the room takes its cue from the calmest person.',
  'patience can save minutes that panic would waste.',
  'the strongest posture is controlled, not loud.',
  'small acts of calm change whole situations.',
  'a steady voice can lower the temperature fast.',
  'good work starts with good footing.',
  'confidence lands best when it is quiet.',
  'pressure reveals habits, so keep yours clean.',
  'the mission gets clearer when the mind does too.',
  'control the pace and the pace stops controlling you.',
  'focus is a force multiplier.',
  'one measured pause can beat ten rushed moves.',
  'clarity gives courage somewhere useful to stand.',
  'there is strength in being unhurried on purpose.',
  'order starts with the person who refuses the wobble.',
  'trust grows where calm and competence meet.',
  'restraint is not weakness; it is control.',
  'solid thinking keeps the rest of the machine honest.',
  'good teams feel safer around calm people.',
  'you are allowed to be steady and formidable at once.'
];
const albertQuotes = Array.from({ length: 666 }, (_, index) => {
  const opener = albertQuoteOpeners[Math.floor(index / albertQuoteClosers.length)];
  const closer = albertQuoteClosers[index % albertQuoteClosers.length];
  return `${opener}. ${closer.charAt(0).toUpperCase()}${closer.slice(1)}`;
});
const notes = [
  { title: 'Morning posture', body: 'Maintain focus on transport hubs, symbolic sites, and fast-moving public order environments with terrorism indicators.' },
  { title: 'Cross-border watch', body: 'Track whether any developing European incidents show common method, travel pathway, or propaganda overlap with UK activity.' }
];

let alerts = [];
let activeRegion = 'all';
let activeLane = 'all';
let watched = new Set(['eurojust-self-igniting-parcels']);
let lastBrowserPollAt = new Date();
let liveFeedGeneratedAt = null;
let liveSourceCount = 0;
let albertIndex = -1;
let mapTransform = { scale: 1, x: 0, y: 0 };
let mapDrag = { active: false, startX: 0, startY: 0, originX: 0, originY: 0 };

const priorityCard = document.getElementById('priority-card');
const feedList = document.getElementById('feed-list');
const contextList = document.getElementById('context-list');
const watchlistList = document.getElementById('watchlist-list');
const notesList = document.getElementById('notes-list');
const watchedCount = document.getElementById('watched-count');
const contextCount = document.getElementById('context-count');
const watchlistSummary = document.getElementById('watchlist-summary');
const heroRegion = document.getElementById('hero-region');
const heroUpdated = document.getElementById('hero-updated');
const heroPolling = document.getElementById('hero-polling');
const mapGrid = document.getElementById('map-grid');
const mapViewport = document.getElementById('map-viewport');
const mapStage = document.getElementById('map-stage');
const mapMarkerLayer = document.getElementById('map-marker-layer');
const mapSummary = document.getElementById('map-summary');
const mapZoomIn = document.getElementById('map-zoom-in');
const mapZoomOut = document.getElementById('map-zoom-out');
const mapReset = document.getElementById('map-reset');
const filters = document.getElementById('filters');
const laneFilters = document.getElementById('lane-filters');
const tabbar = document.getElementById('tabbar');
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
const modalSeverity = document.getElementById('modal-severity');
const modalStatus = document.getElementById('modal-status');
const modalSource = document.getElementById('modal-source');
const modalRegion = document.getElementById('modal-region');
const modalBriefing = document.getElementById('modal-briefing');
const modalLink = document.getElementById('modal-link');

const clean = (value) => String(value || '').trim();
const geoLookup = [
  { terms: ['leeds'], x: 47, y: 27 },
  { terms: ['london', 'golders green'], x: 46, y: 28 },
  { terms: ['manchester'], x: 45, y: 26 },
  { terms: ['birmingham'], x: 46, y: 27 },
  { terms: ['liverpool'], x: 44, y: 26 },
  { terms: ['glasgow'], x: 43, y: 23 },
  { terms: ['belfast'], x: 41, y: 25 },
  { terms: ['northumberland'], x: 47, y: 24 },
  { terms: ['paris', 'france'], x: 48, y: 31 },
  { terms: ['brussels', 'belgium'], x: 49, y: 29 },
  { terms: ['amsterdam', 'netherlands'], x: 49, y: 27 },
  { terms: ['berlin', 'germany'], x: 53, y: 27 },
  { terms: ['madrid', 'spain'], x: 45, y: 38 },
  { terms: ['rome', 'italy'], x: 52, y: 37 },
  { terms: ['athens', 'greece'], x: 58, y: 39 },
  { terms: ['stockholm', 'sweden'], x: 55, y: 19 },
  { terms: ['copenhagen', 'denmark'], x: 52, y: 22 },
  { terms: ['dublin', 'ireland'], x: 40, y: 27 },
  { terms: ['vilnius', 'lithuania'], x: 58, y: 23 },
  { terms: ['warsaw', 'poland'], x: 56, y: 26 },
  { terms: ['kyiv', 'ukraine'], x: 61, y: 29 },
  { terms: ['tehran', 'iran'], x: 68, y: 33 },
  { terms: ['israel', 'tel aviv', 'jerusalem'], x: 61, y: 38 },
  { terms: ['lebanon', 'beirut'], x: 60, y: 37 },
  { terms: ['iraq'], x: 63, y: 35 },
  { terms: ['yemen'], x: 62, y: 42 },
  { terms: ['nigeria'], x: 49, y: 51 },
  { terms: ['pakistan'], x: 68, y: 35 },
  { terms: ['austria', 'vienna'], x: 54, y: 30 },
  { terms: ['switzerland'], x: 50, y: 31 },
  { terms: ['united states', 'us ', 'usa', 'california', 'yosemite'], x: 18, y: 31 },
  { terms: ['canada'], x: 18, y: 18 },
  { terms: ['australia'], x: 84, y: 68 },
  { terms: ['europe'], x: 52, y: 29 },
  { terms: ['united kingdom', 'uk'], x: 45, y: 27 }
];
function severityLabel(severity) { return clean(severity).charAt(0).toUpperCase() + clean(severity).slice(1); }
function regionLabel(region) { return region === 'uk' ? 'UK' : 'EU'; }
function inferGeoPoint(alert) {
  const haystack = `${clean(alert.location)} ${clean(alert.title)} ${clean(alert.summary)}`.toLowerCase();
  const match = geoLookup.find((entry) => entry.terms.some((term) => haystack.includes(term)));
  if (match) return { x: match.x, y: match.y };
  return null;
}
function keywordMatches(alert) { const haystack = `${alert.title} ${alert.summary} ${alert.aiSummary}`.toLowerCase(); return incidentKeywords.filter((keyword) => haystack.includes(keyword)); }
function looksGenericSummary(text) {
  const summary = clean(text).toLowerCase();
  return !summary ||
    summary.includes('matched the incident watch logic') ||
    summary.includes('the immediate value is source validation') ||
    summary.includes('should be read as') ||
    summary.includes('contextual monitoring item');
}
function incidentTypeLabel(alert) {
  const text = `${alert.title} ${alert.summary}`.toLowerCase();
  if (text.includes('charged') || text.includes('sentenced') || text.includes('convicted')) return 'a prosecution-stage development';
  if (text.includes('arrest') || text.includes('raid') || text.includes('disrupt') || text.includes('foiled')) return 'a disrupted plot or enforcement action';
  if (text.includes('attack') || text.includes('bomb') || text.includes('explosion') || text.includes('shooting') || text.includes('stabbing') || text.includes('ramming') || text.includes('hostage')) return 'a reported attack-related development';
  if (text.includes('threat')) return 'a threat-related development';
  return 'a terrorism-related source update';
}
function articleBodyBits(alert) {
  const base = clean(alert.summary && alert.summary !== alert.title ? alert.summary : '');
  return base
    .split(/(?<=[.!?])\s+|\s{2,}/)
    .map((part) => clean(part))
    .filter(Boolean)
    .filter((part, index, all) => all.indexOf(part) === index)
    .slice(0, 8);
}
function buildIncidentSummary(alert) {
  const bodyBits = articleBodyBits(alert);
  if (bodyBits.length) {
    return bodyBits.join(' ');
  }
  return alert.title;
}
function extractPeopleInvolved(alert) {
  const sourceText = clean([alert.title, alert.summary].filter(Boolean).join('. '));
  const sentences = sourceText.split(/(?<=[.!?])\s+/).map((part) => clean(part)).filter(Boolean);
  const blocked = [
    'The Telegraph', 'The Guardian', 'Daily Mail', 'The Sun', 'Reuters', 'Europol', 'Eurojust', 'GOV.UK',
    'Counter Terrorism Policing', 'Crown Prosecution Service', 'Bank Of America', 'United Kingdom', 'Middle East',
    'St James’ Hospital', 'St James Hospital', 'Paris', 'Leeds', 'Europe', 'Iran', 'Lebanon', 'Israel'
  ];
  const matches = [...sourceText.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z'’-]+){1,2})\b/g)]
    .map((match) => clean(match[1]))
    .filter((name, index, all) => all.indexOf(name) === index)
    .filter((name) => !blocked.includes(name));

  const people = matches.slice(0, 4).map((name) => {
    const context = sentences.find((sentence) => sentence.includes(name));
    return context ? `${name}: ${context}` : name;
  });

  return people.length ? people : ['No named individuals were identified in the captured source text.'];
}
function effectiveSummary(alert) { return looksGenericSummary(alert.aiSummary) ? buildIncidentSummary(alert) : alert.aiSummary; }
function incidentScore(alert) { const matches = keywordMatches(alert); let score = matches.length; if (alert.lane === 'incidents') score += 3; if (alert.severity === 'critical') score += 3; if (alert.severity === 'high') score += 2; if (alert.major) score += 2; if (trustedMajorSources.has(alert.source)) score += 2; return score; }
function isLiveIncidentCandidate(alert) { return alert.lane === 'incidents' && incidentScore(alert) >= 6; }
function filteredAlerts() { return alerts.filter((alert) => (activeRegion === 'all' || alert.region === activeRegion) && (activeLane === 'all' || alert.lane === activeLane)); }
function responderAlerts() { return filteredAlerts().filter(isLiveIncidentCandidate); }
function contextAlerts() { return filteredAlerts().filter((alert) => !isLiveIncidentCandidate(alert)); }
function topPriority() { const ranking = { critical: 4, high: 3, elevated: 2, moderate: 1 }; const pool = responderAlerts().length ? responderAlerts() : contextAlerts(); return [...pool].sort((a, b) => { const scoreGap = incidentScore(b) - incidentScore(a); if (scoreGap !== 0) return scoreGap; if (!!a.major !== !!b.major) return a.major ? -1 : 1; return ranking[b.severity] - ranking[a.severity]; })[0]; }

function buildBriefing(alert, summaryText) {
  const matches = keywordMatches(alert);
  const sourceExtract = clean(alert.summary && alert.summary !== alert.title ? alert.summary : '');
  const peopleInvolved = extractPeopleInvolved(alert);
  return [
    `WHAT: ${alert.title}`,
    `WHERE: ${alert.location}`,
    `WHEN: ${alert.happenedWhen || alert.time}`,
    `SOURCE: ${alert.source}`,
    `CONFIDENCE: ${alert.confidence}`,
    `LANE: ${laneLabels[alert.lane] || alert.lane}`,
    '',
    'PEOPLE INVOLVED:',
    ...peopleInvolved,
    '',
    'SUMMARY:',
    summaryText,
    sourceExtract ? ['', 'SOURCE EXTRACT:', sourceExtract] : '',
    '',
    'FLAG REASON:',
    `This item sits in the ${(laneLabels[alert.lane] || alert.lane || 'monitoring').toLowerCase()} lane and should be read as ${isLiveIncidentCandidate(alert) ? 'a live incident responder candidate' : 'a contextual monitoring item'}.`,
    matches.length ? `TRIGGER KEYWORDS: ${matches.join(', ')}` : 'TRIGGER KEYWORDS: none matched',
    '',
    `ORIGINAL LINK: ${alert.sourceUrl}`
  ].flat().filter(Boolean).join('\n');
}

function normaliseAlert(alert, index) {
  const geoPoint = inferGeoPoint(alert);
  return {
    id: clean(alert.id) || `live-${index}`,
    title: clean(alert.title) || 'Untitled source item',
    location: clean(alert.location) || (alert.region === 'uk' ? 'United Kingdom' : 'Europe'),
    region: alert.region === 'uk' ? 'uk' : 'europe',
    lane: ['incidents','sanctions','oversight','border','prevention'].includes(alert.lane) ? alert.lane : 'incidents',
    severity: ['critical','high','elevated','moderate'].includes(alert.severity) ? alert.severity : 'moderate',
    status: clean(alert.status) || 'Update',
    actor: clean(alert.actor) || clean(alert.source),
    subject: clean(alert.subject) || clean(alert.source),
    happenedWhen: clean(alert.happenedWhen) || clean(alert.time),
    confidence: clean(alert.confidence) || 'Source update',
    summary: clean(alert.summary) || clean(alert.title),
    aiSummary: clean(alert.aiSummary) || clean(alert.summary) || clean(alert.title),
    source: clean(alert.source) || 'Unknown source',
    sourceUrl: clean(alert.sourceUrl) || '#',
    time: clean(alert.time) || clean(alert.happenedWhen) || 'Now',
    x: geoPoint?.x ?? (Number.isFinite(alert.x) ? alert.x : (alert.region === 'uk' ? 45 : 52)),
    y: geoPoint?.y ?? (Number.isFinite(alert.y) ? alert.y : (alert.region === 'uk' ? 27 : 29)),
    major: !!alert.major
  };
}

async function loadLiveFeed() {
  try {
    const response = await fetch(`${LIVE_FEED_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    alerts = Array.isArray(data.alerts) ? data.alerts.map(normaliseAlert) : [];
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

function renderPriority() {
  const alert = topPriority();
  if (!alert) {
    priorityCard.classList.remove('context-priority');
    priorityCard.innerHTML = `
      <div class="eyebrow">Live Feed Status</div>
      <h2>Waiting for a verified source pull</h2>
      <p class="muted">The app is not showing placeholder incidents anymore. Once the feed builder publishes live items, responder candidates will appear here automatically.</p>
      <div class="meta-row">
        <span>${activeRegion === 'all' ? 'All feeds' : `${regionLabel(activeRegion)} feeds`}</span>
        <span>${activeLane === 'all' ? 'All lanes' : laneLabels[activeLane]}</span>
        <span>${liveSourceCount ? `${liveSourceCount} sources checked` : 'No live feed yet'}</span>
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
      <div class="meta-row"><span>${alert.source}</span><span>${alert.status}</span></div>
    </article>`;
}

function renderFeed() {
  const items = responderAlerts();
  feedList.innerHTML = items.length ? items.map(responderCardMarkup).join('') : "<p class='panel-copy'>No verified responder triggers are currently in this filter.</p>";
  watchedCount.textContent = `${watched.size} watched`;
  feedList.querySelectorAll('.feed-card').forEach((card) => card.addEventListener('click', () => openDetail(alerts.find((item) => item.id === card.dataset.id))));
  feedList.querySelectorAll('.star-button').forEach((button) => button.addEventListener('click', (event) => { event.stopPropagation(); const id = button.dataset.star; watched.has(id) ? watched.delete(id) : watched.add(id); renderAll(); }));
}

function renderContext() {
  const items = contextAlerts().slice(0, 4);
  contextCount.textContent = `${items.length} contextual items`;
  contextList.innerHTML = items.length ? items.map((alert) => `<article class="context-pill actionable" data-context="${alert.id}"><h4>${alert.title}</h4><p>${laneLabels[alert.lane]} | ${alert.source}</p></article>`).join('') : "<p class='panel-copy'>No contextual items have been published into this filter yet.</p>";
  contextList.querySelectorAll('[data-context]').forEach((card) => card.addEventListener('click', () => openDetail(alerts.find((item) => item.id === card.dataset.context))));
}

function clampMapTransform() {
  const maxX = ((mapTransform.scale - 1) * mapGrid.clientWidth) / 2;
  const maxY = ((mapTransform.scale - 1) * mapGrid.clientHeight) / 2;
  mapTransform.x = Math.max(-maxX, Math.min(maxX, mapTransform.x));
  mapTransform.y = Math.max(-maxY, Math.min(maxY, mapTransform.y));
}

function applyMapTransform() {
  clampMapTransform();
  mapStage.style.transform = `translate(${mapTransform.x}px, ${mapTransform.y}px) scale(${mapTransform.scale})`;
}

function renderMap() {
  mapMarkerLayer.querySelectorAll('.pin').forEach((pin) => pin.remove());
  filteredAlerts().forEach((alert) => {
    const pin = document.createElement('button');
    pin.className = `pin actionable severity-${alert.severity}`;
    pin.style.left = `${alert.x}%`;
    pin.style.top = `${alert.y}%`;
    pin.dataset.pin = alert.id;
    pin.setAttribute('aria-label', alert.title);
    pin.addEventListener('click', () => openDetail(alert));
    mapMarkerLayer.appendChild(pin);
  });
  mapSummary.textContent = `${responderAlerts().length} responder items | ${contextAlerts().length} context`;
  applyMapTransform();
}

function renderWatchlist() {
  const tracked = alerts.filter((alert) => watched.has(alert.id));
  watchlistSummary.textContent = tracked.length ? `${tracked.length} tracked incidents` : 'No tracked incidents';
  watchlistList.innerHTML = tracked.length ? tracked.map((alert) => `<article class="feed-card actionable" data-watch="${alert.id}"><div class="feed-top"><div><h4>${alert.title}</h4><p>${alert.location}</p></div><span class="severity severity-${alert.severity}">${laneLabels[alert.lane]}</span></div><p>${alert.summary}</p></article>`).join('') : "<p class='panel-copy'>Track incidents in F.O.C to pin them here.</p>";
  watchlistList.querySelectorAll('[data-watch]').forEach((card) => card.addEventListener('click', () => openDetail(alerts.find((item) => item.id === card.dataset.watch))));
}

function renderNotes() { notesList.innerHTML = notes.map((note) => `<article class="note-card"><strong>${note.title}</strong><p>${note.body}</p></article>`).join(''); }

function renderHero() {
  const regionCopy = activeRegion === 'all' ? 'All feeds' : `${regionLabel(activeRegion)} feeds`;
  const laneCopy = activeLane === 'all' ? 'Responder posture' : laneLabels[activeLane];
  heroRegion.textContent = `${regionCopy} | ${laneCopy}`;
  heroPolling.textContent = `Phone refresh 60s | source pull ~${SOURCE_PULL_MINUTES}m`;
  const stamp = liveFeedGeneratedAt || lastBrowserPollAt;
  const sourceSuffix = liveSourceCount ? ` | ${liveSourceCount} sources` : ' | awaiting live pull';
  heroUpdated.textContent = `${stamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${sourceSuffix}`;
}

function renderAll() { renderHero(); renderPriority(); renderFeed(); renderContext(); renderMap(); renderWatchlist(); renderNotes(); }

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

function zoomMap(scaleDelta) {
  mapTransform.scale = Math.max(1, Math.min(2.4, mapTransform.scale + scaleDelta));
  applyMapTransform();
}

function openDetail(alert) {
  const summaryText = effectiveSummary(alert);
  modalTitle.textContent = alert.title;
  modalMeta.textContent = `${alert.location} | ${alert.time}`;
  modalAiSummary.textContent = summaryText;
  modalSummary.textContent = '';
  modalSummary.hidden = true;
  modalSeverity.textContent = severityLabel(alert.severity);
  modalStatus.textContent = alert.status;
  modalSource.textContent = alert.source;
  modalRegion.textContent = alert.region === 'uk' ? 'United Kingdom' : 'Europe';
  modalBriefing.textContent = buildBriefing(alert, summaryText);
  modalLink.href = alert.sourceUrl;
  copyBriefing.dataset.briefing = buildBriefing(alert, summaryText);
  modal.classList.remove('hidden');
}

function closeDetailPanel() { modal.classList.add('hidden'); }

filters.addEventListener('click', (event) => { const button = event.target.closest('[data-region]'); if (!button) return; activeRegion = button.dataset.region; filters.querySelectorAll('.filter').forEach((item) => item.classList.remove('active')); button.classList.add('active'); renderAll(); });
laneFilters.addEventListener('click', (event) => { const button = event.target.closest('[data-lane]'); if (!button) return; activeLane = button.dataset.lane; laneFilters.querySelectorAll('.filter').forEach((item) => item.classList.remove('active')); button.classList.add('active'); renderAll(); });
tabbar.addEventListener('click', (event) => { const button = event.target.closest('[data-tab]'); if (!button) return; const next = button.dataset.tab; tabbar.querySelectorAll('.tab').forEach((item) => item.classList.remove('active')); button.classList.add('active'); document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === next)); });
document.getElementById('note-form').addEventListener('submit', (event) => { event.preventDefault(); const title = document.getElementById('note-title'); const body = document.getElementById('note-body'); notes.unshift({ title: title.value.trim(), body: body.value.trim() }); title.value = ''; body.value = ''; renderNotes(); });
copyBriefing.addEventListener('click', async () => { const briefing = copyBriefing.dataset.briefing || ''; try { await navigator.clipboard.writeText(briefing); copyBriefing.textContent = 'Copied'; setTimeout(() => { copyBriefing.textContent = 'Copy Briefing'; }, 1200); } catch { copyBriefing.textContent = 'Copy failed'; setTimeout(() => { copyBriefing.textContent = 'Copy Briefing'; }, 1200); } });
closeModal.addEventListener('click', closeDetailPanel);
modalBackdrop.addEventListener('click', closeDetailPanel);
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeDetailPanel(); });
mapZoomIn.addEventListener('click', () => zoomMap(0.22));
mapZoomOut.addEventListener('click', () => zoomMap(-0.22));
mapReset.addEventListener('click', () => {
  mapTransform = { scale: 1, x: 0, y: 0 };
  applyMapTransform();
});
mapViewport.addEventListener('pointerdown', (event) => {
  mapDrag = { active: true, startX: event.clientX, startY: event.clientY, originX: mapTransform.x, originY: mapTransform.y };
  mapViewport.classList.add('is-dragging');
});
window.addEventListener('pointermove', (event) => {
  if (!mapDrag.active) return;
  mapTransform.x = mapDrag.originX + (event.clientX - mapDrag.startX);
  mapTransform.y = mapDrag.originY + (event.clientY - mapDrag.startY);
  applyMapTransform();
});
window.addEventListener('pointerup', () => {
  mapDrag.active = false;
  mapViewport.classList.remove('is-dragging');
});
albertQuote.textContent = nextAlbertQuote();
albertCard.addEventListener('click', () => { albertQuote.textContent = nextAlbertQuote(); });
document.querySelector('.bulldog-card').addEventListener('dblclick', () => { albertNote.classList.toggle('hidden'); });

renderAll();
loadLiveFeed();
setInterval(loadLiveFeed, POLL_INTERVAL_MS);
