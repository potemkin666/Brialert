const LIVE_FEED_URL = 'live-alerts.json';
const POLL_INTERVAL_MS = 60_000;
const SOURCE_PULL_MINUTES = 15;
const WATCHED_STORAGE_KEY = 'brialert.watched';
const NOTES_STORAGE_KEY = 'brialert.notes';

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
const defaultNotes = [
  { title: 'Morning posture', body: 'Maintain focus on transport hubs, symbolic sites, and fast-moving public order environments with terrorism indicators.' },
  { title: 'Cross-border watch', body: 'Track whether any developing European incidents show common method, travel pathway, or propaganda overlap with UK activity.' }
];

let alerts = [];
let activeRegion = 'all';
let activeLane = 'all';
let watched = new Set();
let lastBrowserPollAt = new Date();
let liveFeedGeneratedAt = null;
let liveSourceCount = 0;
let albertIndex = -1;
let notes = [];
let liveMap = null;
let liveMarkers = [];
let lastMapSignature = '';

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
const mapElement = document.getElementById('leaflet-map');
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
function formatAgeFrom(dateLike) {
  if (!dateLike) return 'age unknown';
  const stamp = dateLike instanceof Date ? dateLike : new Date(dateLike);
  if (Number.isNaN(stamp.getTime())) return 'age unknown';
  const diffMinutes = Math.max(0, Math.round((Date.now() - stamp.getTime()) / 60000));
  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const hours = Math.floor(diffMinutes / 60);
  const minutes = diffMinutes % 60;
  if (hours < 24) return minutes ? `${hours}h ${minutes}m ago` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
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
function saveNotes() {
  try {
    localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(notes));
  } catch {}
}
const geoLookup = [
  { terms: ['leeds'], lat: 53.8008, lng: -1.5491 },
  { terms: ['london', 'golders green'], lat: 51.5074, lng: -0.1278 },
  { terms: ['manchester'], lat: 53.4808, lng: -2.2426 },
  { terms: ['birmingham'], lat: 52.4862, lng: -1.8904 },
  { terms: ['liverpool'], lat: 53.4084, lng: -2.9916 },
  { terms: ['glasgow'], lat: 55.8642, lng: -4.2518 },
  { terms: ['belfast'], lat: 54.5973, lng: -5.9301 },
  { terms: ['northumberland'], lat: 55.2083, lng: -2.0784 },
  { terms: ['paris', 'france'], lat: 48.8566, lng: 2.3522 },
  { terms: ['brussels', 'belgium'], lat: 50.8503, lng: 4.3517 },
  { terms: ['amsterdam', 'netherlands'], lat: 52.3676, lng: 4.9041 },
  { terms: ['berlin', 'germany'], lat: 52.52, lng: 13.405 },
  { terms: ['madrid', 'spain'], lat: 40.4168, lng: -3.7038 },
  { terms: ['rome', 'italy'], lat: 41.9028, lng: 12.4964 },
  { terms: ['athens', 'greece'], lat: 37.9838, lng: 23.7275 },
  { terms: ['stockholm', 'sweden'], lat: 59.3293, lng: 18.0686 },
  { terms: ['copenhagen', 'denmark'], lat: 55.6761, lng: 12.5683 },
  { terms: ['dublin', 'ireland'], lat: 53.3498, lng: -6.2603 },
  { terms: ['vilnius', 'lithuania'], lat: 54.6872, lng: 25.2797 },
  { terms: ['warsaw', 'poland'], lat: 52.2297, lng: 21.0122 },
  { terms: ['kyiv', 'ukraine'], lat: 50.4501, lng: 30.5234 },
  { terms: ['tehran', 'iran'], lat: 35.6892, lng: 51.389 },
  { terms: ['israel', 'tel aviv'], lat: 32.0853, lng: 34.7818 },
  { terms: ['jerusalem'], lat: 31.7683, lng: 35.2137 },
  { terms: ['lebanon', 'beirut'], lat: 33.8938, lng: 35.5018 },
  { terms: ['iraq', 'baghdad'], lat: 33.3152, lng: 44.3661 },
  { terms: ['yemen', 'sanaa'], lat: 15.3694, lng: 44.191 },
  { terms: ['nigeria', 'abuja'], lat: 9.0765, lng: 7.3986 },
  { terms: ['pakistan', 'islamabad'], lat: 33.6844, lng: 73.0479 },
  { terms: ['austria', 'vienna'], lat: 48.2082, lng: 16.3738 },
  { terms: ['switzerland'], lat: 46.8182, lng: 8.2275 },
  { terms: ['united states', 'us ', 'usa'], lat: 39.8283, lng: -98.5795 },
  { terms: ['california', 'yosemite'], lat: 37.8651, lng: -119.5383 },
  { terms: ['canada'], lat: 56.1304, lng: -106.3468 },
  { terms: ['australia'], lat: -25.2744, lng: 133.7751 },
  { terms: ['europe'], lat: 54, lng: 15 },
  { terms: ['united kingdom', 'uk'], lat: 54.5, lng: -2.5 }
];
function severityLabel(severity) { return clean(severity).charAt(0).toUpperCase() + clean(severity).slice(1); }
function regionLabel(region) { return region === 'uk' ? 'UK' : 'EU'; }
function inferGeoPoint(alert) {
  const haystack = `${clean(alert.location)} ${clean(alert.title)} ${clean(alert.summary)}`.toLowerCase();
  const match = geoLookup.find((entry) => entry.terms.some((term) => haystack.includes(term)));
  if (match) return { lat: match.lat, lng: match.lng };
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
  const base = clean(alert.sourceExtract || (alert.summary && alert.summary !== alert.title ? alert.summary : ''));
  return base
    .split(/(?<=[.!?])\s+|\s{2,}/)
    .map((part) => clean(part))
    .filter(Boolean)
    .filter((part, index, all) => all.indexOf(part) === index)
    .slice(0, 14);
}
function buildIncidentSummary(alert) {
  const bodyBits = articleBodyBits(alert);
  if (bodyBits.length) {
    return bodyBits.join(' ');
  }
  return alert.title;
}
function extractPeopleInvolved(alert) {
  if (Array.isArray(alert.peopleInvolved) && alert.peopleInvolved.length) {
    return alert.peopleInvolved;
  }
  const sourceText = clean(alert.sourceExtract || alert.summary || '');
  const sentences = sourceText.split(/(?<=[.!?])\s+/).map((part) => clean(part)).filter(Boolean);
  const blocked = [
    'The Telegraph', 'The Guardian', 'Daily Mail', 'The Sun', 'Reuters', 'Europol', 'Eurojust', 'GOV.UK',
    'Counter Terrorism Policing', 'Crown Prosecution Service', 'Bank Of America', 'United Kingdom', 'Middle East',
    'St James’ Hospital', 'St James Hospital', 'Paris', 'Leeds', 'Europe', 'Iran', 'Lebanon', 'Israel',
    'France', 'Iranian', 'Proxies', 'Foiled', 'Terror', 'Attack'
  ];
  const matches = [...sourceText.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z'’-]+){1,2})\b/g)]
    .map((match) => clean(match[1]))
    .filter((name, index, all) => all.indexOf(name) === index)
    .filter((name) => !blocked.includes(name))
    .filter((name) => name.split(' ').every((word) => !blocked.includes(word)));

  const people = matches.slice(0, 4).map((name) => {
    const context = sentences.find((sentence) => sentence.includes(name));
    return context ? `${name}: ${context}` : name;
  });

  return people.length ? people : [];
}
function effectiveSummary(alert) { return looksGenericSummary(alert.aiSummary) ? buildIncidentSummary(alert) : alert.aiSummary; }
function incidentScore(alert) {
  if (Number.isFinite(alert.priorityScore)) return alert.priorityScore;
  const matches = keywordMatches(alert);
  let score = matches.length;
  if (alert.lane === 'incidents') score += 3;
  if (alert.severity === 'critical') score += 3;
  if (alert.severity === 'high') score += 2;
  if (alert.major) score += 2;
  if (trustedMajorSources.has(alert.source)) score += 2;
  return score;
}
function isLiveIncidentCandidate(alert) {
  if (alert.lane !== 'incidents') return false;
  if (alert.freshUntil) {
    const freshUntil = new Date(alert.freshUntil);
    if (!Number.isNaN(freshUntil.getTime()) && freshUntil.getTime() < Date.now()) return false;
  }
  if (alert.eventType && ['sanctions_update', 'oversight_update', 'border_security_update', 'prevention_update'].includes(alert.eventType)) return false;
  if (alert.needsHumanReview && !alert.isOfficial && (alert.confidenceScore || 0) < 0.75) return false;
  return incidentScore(alert) >= 6;
}
function filteredAlerts() { return alerts.filter((alert) => (activeRegion === 'all' || alert.region === activeRegion) && (activeLane === 'all' || alert.lane === activeLane)); }
function responderAlerts() { return filteredAlerts().filter(isLiveIncidentCandidate); }
function contextAlerts() { return filteredAlerts().filter((alert) => !isLiveIncidentCandidate(alert)); }
function topPriority() { const ranking = { critical: 4, high: 3, elevated: 2, moderate: 1 }; const pool = responderAlerts().length ? responderAlerts() : contextAlerts(); return [...pool].sort((a, b) => { const scoreGap = incidentScore(b) - incidentScore(a); if (scoreGap !== 0) return scoreGap; if (!!a.major !== !!b.major) return a.major ? -1 : 1; return ranking[b.severity] - ranking[a.severity]; })[0]; }

function buildBriefing(alert, summaryText) {
  const matches = keywordMatches(alert);
  const peopleInvolved = extractPeopleInvolved(alert);
  return [
    `WHAT: ${alert.title}`,
    `WHERE: ${alert.location}`,
    `WHEN: ${alert.happenedWhen || alert.time}`,
    `SOURCE: ${alert.source}`,
    `CONFIDENCE: ${alert.confidence}`,
    `LANE: ${laneLabels[alert.lane] || alert.lane}`,
    alert.eventType ? `EVENT TYPE: ${clean(alert.eventType).replace(/_/g, ' ')}` : '',
    alert.geoPrecision ? `GEO PRECISION: ${alert.geoPrecision}` : '',
    '',
    peopleInvolved.length ? ['PEOPLE INVOLVED:', ...peopleInvolved, ''] : [],
    'SUMMARY:',
    summaryText,
    '',
    matches.length ? `TRIGGER KEYWORDS: ${matches.join(', ')}` : '',
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
    sourceExtract: clean(alert.sourceExtract),
    peopleInvolved: Array.isArray(alert.peopleInvolved) ? alert.peopleInvolved.filter(Boolean) : [],
    source: clean(alert.source) || 'Unknown source',
    sourceUrl: clean(alert.sourceUrl) || '#',
    time: clean(alert.time) || clean(alert.happenedWhen) || 'Now',
    lat: Number.isFinite(alert.lat) ? alert.lat : (geoPoint?.lat ?? (alert.region === 'uk' ? 54.5 : 54)),
    lng: Number.isFinite(alert.lng) ? alert.lng : (geoPoint?.lng ?? (alert.region === 'uk' ? -2.5 : 15)),
    major: !!alert.major,
    eventType: clean(alert.eventType),
    geoPrecision: clean(alert.geoPrecision),
    isOfficial: !!alert.isOfficial,
    isDuplicateOf: clean(alert.isDuplicateOf),
    freshUntil: clean(alert.freshUntil),
    needsHumanReview: !!alert.needsHumanReview,
    priorityScore: Number.isFinite(alert.priorityScore) ? alert.priorityScore : null,
    confidenceScore: Number.isFinite(alert.confidenceScore) ? alert.confidenceScore : null
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
  feedList.querySelectorAll('.star-button').forEach((button) => button.addEventListener('click', (event) => { event.stopPropagation(); const id = button.dataset.star; watched.has(id) ? watched.delete(id) : watched.add(id); saveWatched(); renderAll(); }));
}

function renderContext() {
  const items = contextAlerts().slice(0, 4);
  contextCount.textContent = `${items.length} contextual items`;
  contextList.innerHTML = items.length ? items.map((alert) => `<article class="context-pill actionable" data-context="${alert.id}"><h4>${alert.title}</h4><p>${laneLabels[alert.lane]} | ${alert.source}</p></article>`).join('') : "<p class='panel-copy'>No contextual items have been published into this filter yet.</p>";
  contextList.querySelectorAll('[data-context]').forEach((card) => card.addEventListener('click', () => openDetail(alerts.find((item) => item.id === card.dataset.context))));
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

function renderMap(forceFit = false) {
  ensureMap();
  if (!liveMap) return;
  liveMarkers.forEach((marker) => marker.remove());
  liveMarkers = [];

  const items = filteredAlerts().filter((alert) => Number.isFinite(alert.lat) && Number.isFinite(alert.lng));
  const signature = items.map((alert) => `${alert.id}:${alert.lat.toFixed(3)},${alert.lng.toFixed(3)}`).join('|');
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

  mapSummary.textContent = `${responderAlerts().length} responder items | ${contextAlerts().length} context | ${items.length} plotted`;

  if (items.length && (forceFit || signature !== lastMapSignature)) {
    liveMap.fitBounds(bounds, {
      padding: [28, 28],
      maxZoom: items.length === 1 ? 6 : 5
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
  const regionCopy = activeRegion === 'all' ? 'All feeds' : `${regionLabel(activeRegion)} feeds`;
  const laneCopy = activeLane === 'all' ? 'Responder posture' : laneLabels[activeLane];
  heroRegion.textContent = `${regionCopy} | ${laneCopy}`;
  const sourceAge = liveFeedGeneratedAt ? formatAgeFrom(liveFeedGeneratedAt) : 'waiting';
  heroPolling.textContent = `UI checks 60s | feed build ~${SOURCE_PULL_MINUTES}m | source age ${sourceAge}`;
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

function zoomMap(direction) {
  ensureMap();
  if (!liveMap) return;
  if (direction > 0) liveMap.zoomIn();
  if (direction < 0) liveMap.zoomOut();
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
tabbar.addEventListener('click', (event) => {
  const button = event.target.closest('[data-tab]');
  if (!button) return;
  const next = button.dataset.tab;
  tabbar.querySelectorAll('.tab').forEach((item) => item.classList.remove('active'));
  button.classList.add('active');
  document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === next));
  if (next === 'map') {
    setTimeout(() => {
      ensureMap();
      renderMap(true);
    }, 60);
  }
});
document.getElementById('note-form').addEventListener('submit', (event) => { event.preventDefault(); const title = document.getElementById('note-title'); const body = document.getElementById('note-body'); notes.unshift({ title: title.value.trim(), body: body.value.trim() }); saveNotes(); title.value = ''; body.value = ''; renderNotes(); });
copyBriefing.addEventListener('click', async () => { const briefing = copyBriefing.dataset.briefing || ''; try { await navigator.clipboard.writeText(briefing); copyBriefing.textContent = 'Copied'; setTimeout(() => { copyBriefing.textContent = 'Copy Briefing'; }, 1200); } catch { copyBriefing.textContent = 'Copy failed'; setTimeout(() => { copyBriefing.textContent = 'Copy Briefing'; }, 1200); } });
closeModal.addEventListener('click', closeDetailPanel);
modalBackdrop.addEventListener('click', closeDetailPanel);
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeDetailPanel(); });
mapZoomIn.addEventListener('click', () => zoomMap(1));
mapZoomOut.addEventListener('click', () => zoomMap(-1));
mapReset.addEventListener('click', () => renderMap(true));
window.addEventListener('resize', () => {
  if (!liveMap) return;
  requestAnimationFrame(() => liveMap.invalidateSize());
});
watched = loadWatched();
notes = loadNotes();
albertQuote.textContent = nextAlbertQuote();
albertCard.addEventListener('click', () => { albertQuote.textContent = nextAlbertQuote(); });
document.querySelector('.bulldog-card').addEventListener('dblclick', () => { albertNote.classList.toggle('hidden'); });

renderAll();
loadLiveFeed();
setInterval(loadLiveFeed, POLL_INTERVAL_MS);
