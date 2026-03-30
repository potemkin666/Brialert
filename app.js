const LIVE_FEED_URL = 'live-alerts.json';
const GEO_LOOKUP_URL = 'data/geo-lookup.json';
const POLL_INTERVAL_MS = 60_000;
const SOURCE_PULL_MINUTES = 15;
const WATCHED_STORAGE_KEY = 'brialert.watched';
const NOTES_STORAGE_KEY = 'brialert.notes';
const BRIEFING_MODE_STORAGE_KEY = 'brialert.briefingMode';

const laneLabels = { all: 'All lanes', incidents: 'Incidents', sanctions: 'Sanctions', oversight: 'Oversight', border: 'Border', prevention: 'Prevention' };
const incidentKeywords = ['terror','terrorism','attack','attacks','bomb','bombing','explosion','explosive','device','ramming','stabbing','shooting','hostage','plot','suspect','arrest','charged','charged with','parcel','radicalised','extremist','isis','islamic state','al-qaeda','threat'];
const terrorismKeywords = ['terror','terrorism','counter-terror','counter terrorism','terrorist','extremist','extremism','radicalised','radicalized','radicalisation','radicalization','jihadist','jihad','isis','islamic state','al-qaeda','far-right extremist','far right extremist','neo-nazi','proscribed organisation','proscribed organization','bomb hoax','ira','dissident republican','loyalist paramilitary','terror offences','terrorism offences','terrorist propaganda'];
const majorMediaSources = new Set(['Reuters','The Guardian','BBC News','Associated Press','AP News','The Telegraph','Financial Times','France 24','DW','Politico Europe','Euronews','Brussels Times','The Independent','Irish Times','Politico','Kyiv Post','RFE/RL']);
const tabloidSources = new Set(['The Sun','Daily Mail','Daily Record','Belfast Telegraph','iNews']);
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
let briefingMode = false;
let activeTab = 'firstalert';
let liveMap = null;
let liveMarkers = [];
let lastMapSignature = '';
let geoLookup = [];

const priorityCard = document.getElementById('priority-card');
const screen = document.querySelector('.screen');
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
const briefingModeToggle = document.getElementById('briefing-mode-toggle');
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
function loadBriefingMode() {
  try {
    return localStorage.getItem(BRIEFING_MODE_STORAGE_KEY) === 'true';
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
function severityLabel(severity) { return clean(severity).charAt(0).toUpperCase() + clean(severity).slice(1); }
function regionLabel(region) { return region === 'uk' ? 'UK' : 'EU'; }
function inferGeoPoint(alert) {
  const haystack = `${clean(alert.location)} ${clean(alert.title)} ${clean(alert.summary)}`.toLowerCase();
  const match = geoLookup.find((entry) => entry.terms.some((term) => haystack.includes(term)));
  if (match) return { lat: match.lat, lng: match.lng };
  return null;
}
function keywordMatches(alert) { const haystack = `${alert.title} ${alert.summary} ${alert.aiSummary}`.toLowerCase(); return incidentKeywords.filter((keyword) => haystack.includes(keyword)); }
function terrorismMatches(alert) {
  const haystack = `${alert.title} ${alert.summary} ${alert.aiSummary} ${alert.sourceExtract}`.toLowerCase();
  return terrorismKeywords.filter((keyword) => haystack.includes(keyword));
}
function sourceHasTerrorTopic(alert) {
  const text = `${clean(alert.sourceUrl)} ${clean(alert.title)}`.toLowerCase();
  return [
    'counterterrorism.police.uk',
    'actioncounters',
    'terrorism-threat-levels',
    '/terrorism',
    '/counter-terrorism',
    '/counterterrorism',
    '/terrorist',
    'counter-terrorism-register',
    'terrorism-convictions-monitor',
    'proscribed-terror',
    'sanctions-against-terrorism',
    'terrorist-list',
    'terror offences',
    'terrorism offences'
  ].some((term) => text.includes(term));
}
function isTerrorRelevant(alert) {
  if (typeof alert.isTerrorRelevant === 'boolean') return alert.isTerrorRelevant;
  if (alert.lane !== 'incidents') return true;
  const terrorHits = terrorismMatches(alert);
  if (terrorHits.length) return true;
  return sourceHasTerrorTopic(alert) && keywordMatches(alert).length >= 1;
}
function looksGenericSummary(text) {
  const summary = clean(text).toLowerCase();
  return !summary ||
    summary.includes('matched the incident watch logic') ||
    summary.includes('the immediate value is source validation') ||
    summary.includes('should be read as') ||
    summary.includes('contextual monitoring item');
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
function alertPublishedTime(alert) {
  const raw = clean(alert.publishedAt || alert.happenedWhen || alert.time);
  if (!raw) return 0;
  const stamp = new Date(raw);
  return Number.isNaN(stamp.getTime()) ? 0 : stamp.getTime();
}
function alertAgeHours(alert) {
  const publishedTime = alertPublishedTime(alert);
  if (!publishedTime) return Infinity;
  return Math.max(0, (Date.now() - publishedTime) / 3600000);
}
function freshnessBucketForAlert(alert) {
  if (Number.isFinite(alert.freshnessBucket)) return alert.freshnessBucket;
  const ageHours = alertAgeHours(alert);
  if (alert.lane === 'incidents') {
    if (ageHours <= 2) return 5;
    if (ageHours <= 6) return 4;
    if (ageHours <= 12) return 3;
    if (ageHours <= 24) return 2;
    if (ageHours <= 72) return 1;
    return 0;
  }
  if (ageHours <= 24) return 3;
  if (ageHours <= 72) return 2;
  if (ageHours <= 168) return 1;
  return 0;
}
function sourceTierRank(alert) {
  const tier = normaliseSourceTier(alert.sourceTier);
  if (tier === 'trigger') return 4;
  if (tier === 'corroboration') return 3;
  if (tier === 'context') return 2;
  if (tier === 'research') return 1;
  return 0;
}
function normaliseSourceTier(value) {
  const tier = clean(value).toLowerCase();
  return ['trigger', 'corroboration', 'context', 'research'].includes(tier) ? tier : '';
}
function normaliseReliabilityProfile(value) {
  const profile = clean(value).toLowerCase();
  return ['official_ct', 'official_general', 'official_context', 'major_media', 'general_media', 'tabloid', 'specialist_research'].includes(profile) ? profile : '';
}
function inferReliabilityProfile(alert) {
  const declared = normaliseReliabilityProfile(alert.reliabilityProfile);
  if (declared) return declared;
  const tier = normaliseSourceTier(alert.sourceTier);
  if (tier === 'trigger') return 'official_ct';
  if (alert.isOfficial && alert.lane === 'incidents') return 'official_general';
  if (alert.isOfficial) return 'official_context';
  if (tabloidSources.has(alert.source)) return 'tabloid';
  if (majorMediaSources.has(alert.source)) return 'major_media';
  if (tier === 'research' || alert.lane === 'prevention') return 'specialist_research';
  return 'general_media';
}
function normaliseIncidentTrack(value) {
  const track = clean(value).toLowerCase();
  return ['live', 'case'].includes(track) ? track : '';
}
function inferIncidentTrack(alert) {
  const declared = normaliseIncidentTrack(alert.incidentTrack);
  if (declared) return declared;
  const eventType = clean(alert.eventType).toLowerCase();
  if (['charge', 'arrest', 'sentencing', 'recognition', 'feature'].includes(eventType)) return 'case';
  if (['active_attack', 'disrupted_plot', 'threat_update'].includes(eventType)) return 'live';
  return '';
}
function incidentScore(alert) {
  if (Number.isFinite(alert.priorityScore)) return alert.priorityScore;
  if (!isTerrorRelevant(alert)) return -1;
  const matches = keywordMatches(alert);
  let score = matches.length;
  if (alert.lane === 'incidents') score += 3;
  if (alert.severity === 'critical') score += 3;
  if (alert.severity === 'high') score += 2;
  if (alert.major) score += 2;
  const profile = inferReliabilityProfile(alert);
  if (profile === 'official_ct') score += 3;
  else if (profile === 'official_general') score += 2.5;
  else if (profile === 'major_media') score += 1.5;
  else if (profile === 'tabloid') score -= 1;
  return score;
}
function incidentTrackRank(alert) {
  const track = inferIncidentTrack(alert);
  if (track === 'live') return 2;
  if (track === 'case') return 1;
  return 0;
}
function isLiveIncidentCandidate(alert) {
  if (alert.lane !== 'incidents') return false;
  if (!isTerrorRelevant(alert)) return false;
  const tier = normaliseSourceTier(alert.sourceTier);
  if (tier === 'context' || tier === 'research') return false;
  const incidentTrack = inferIncidentTrack(alert);
  if (incidentTrack && incidentTrack !== 'live') return false;
  if (alertAgeHours(alert) > 72) return false;
  if (alert.freshUntil) {
    const freshUntil = new Date(alert.freshUntil);
    if (!Number.isNaN(freshUntil.getTime()) && freshUntil.getTime() < Date.now()) return false;
  }
  if (alert.eventType && ['sanctions_update', 'oversight_update', 'border_security_update', 'prevention_update'].includes(alert.eventType)) return false;
  if (alert.needsHumanReview && !alert.isOfficial && (alert.confidenceScore || 0) < 0.75) return false;
  return incidentScore(alert) >= 6;
}
function filteredAlerts() { return alerts.filter((alert) => (activeRegion === 'all' || alert.region === activeRegion) && (activeLane === 'all' || alert.lane === activeLane)); }
function sortAlertsByFreshness(alertList) {
  const ranking = { critical: 4, high: 3, elevated: 2, moderate: 1 };
  return [...alertList].sort((a, b) => {
    const freshnessGap = freshnessBucketForAlert(b) - freshnessBucketForAlert(a);
    if (freshnessGap !== 0) return freshnessGap;
    const trackGap = incidentTrackRank(b) - incidentTrackRank(a);
    if (trackGap !== 0) return trackGap;
    const tierGap = sourceTierRank(b) - sourceTierRank(a);
    if (tierGap !== 0) return tierGap;
    const timeGap = alertPublishedTime(b) - alertPublishedTime(a);
    if (timeGap !== 0) return timeGap;
    const scoreGap = incidentScore(b) - incidentScore(a);
    if (scoreGap !== 0) return scoreGap;
    if (!!a.major !== !!b.major) return a.major ? -1 : 1;
    return ranking[b.severity] - ranking[a.severity];
  });
}
function responderAlerts() { return sortAlertsByFreshness(filteredAlerts().filter(isLiveIncidentCandidate)); }
function contextAlerts() {
  return sortAlertsByFreshness(filteredAlerts().filter((alert) => {
    if (alert.lane === 'incidents' && !isTerrorRelevant(alert)) return false;
    return !isLiveIncidentCandidate(alert);
  }));
}
function contextLabel(alert) {
  if (alert.lane === 'incidents' && inferIncidentTrack(alert) === 'case') return 'Case / Prosecution';
  return laneLabels[alert.lane] || alert.lane;
}
function reliabilityLabel(profile) {
  const labels = {
    official_ct: 'Official CT',
    official_general: 'Official',
    official_context: 'Official context',
    major_media: 'Major media',
    general_media: 'General media',
    tabloid: 'Tabloid',
    specialist_research: 'Specialist research'
  };
  return labels[profile] || 'Unknown';
}
function clockDisplay(dateLike) {
  if (!dateLike) return 'unconfirmed';
  const stamp = dateLike instanceof Date ? dateLike : new Date(dateLike);
  if (Number.isNaN(stamp.getTime())) return 'unconfirmed';
  const diffMinutes = Math.max(0, Math.round((Date.now() - stamp.getTime()) / 60000));
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const hours = Math.floor(diffMinutes / 60);
  const minutes = diffMinutes % 60;
  if (hours < 24) return minutes ? `${hours}h ${minutes}m ago` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours ? `${days}d ${remHours}h ago` : `${days}d ago`;
}
function sceneClockStamp(dateLike) {
  if (!dateLike) return 'Timestamp unconfirmed';
  const stamp = dateLike instanceof Date ? dateLike : new Date(dateLike);
  if (Number.isNaN(stamp.getTime())) return 'Timestamp unconfirmed';
  return stamp.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}
function isOfficialProfile(profile) {
  return clean(profile).startsWith('official_');
}
function sourceStack(alert) {
  const corroborating = Array.isArray(alert.corroboratingSources) ? alert.corroboratingSources : [];
  return [
    {
      source: alert.source,
      sourceUrl: alert.sourceUrl,
      publishedAt: alert.publishedAt,
      reliabilityProfile: inferReliabilityProfile(alert),
      sourceTier: normaliseSourceTier(alert.sourceTier),
      isPrimary: true
    },
    ...corroborating.map((entry) => ({
      ...entry,
      isPrimary: false
    }))
  ].filter((entry) => clean(entry.publishedAt));
}
function buildSceneClock(alert) {
  const stack = sourceStack(alert);
  const timed = stack
    .map((entry) => ({ ...entry, timeMs: new Date(entry.publishedAt).getTime() }))
    .filter((entry) => Number.isFinite(entry.timeMs));
  const firstReport = timed.length ? timed.reduce((min, entry) => (entry.timeMs < min.timeMs ? entry : min)) : null;
  const lastOfficial = timed.filter((entry) => isOfficialProfile(entry.reliabilityProfile)).sort((a, b) => b.timeMs - a.timeMs)[0] || null;
  const lastCorroboration = timed.filter((entry) => !entry.isPrimary).sort((a, b) => b.timeMs - a.timeMs)[0] || null;
  return {
    firstReport,
    lastOfficial,
    lastCorroboration
  };
}
function renderSceneClock(alert) {
  const clock = buildSceneClock(alert);
  const items = [
    {
      label: 'Since first report',
      entry: clock.firstReport,
      fallback: 'No report timestamp confirmed yet.'
    },
    {
      label: 'Since last official update',
      entry: clock.lastOfficial,
      fallback: 'No official update has been attached yet.'
    },
    {
      label: 'Since last corroboration',
      entry: clock.lastCorroboration,
      fallback: 'No corroborating source has landed yet.'
    }
  ];
  return `<div class="scene-clock-grid">${items.map(({ label, entry, fallback }) => `
    <article class="scene-clock-item">
      <strong>${label}</strong>
      <p>${entry ? `${clockDisplay(entry.publishedAt)} | ${sceneClockStamp(entry.publishedAt)}${entry.source ? ` | ${entry.source}` : ''}` : fallback}</p>
    </article>`).join('')}</div>`;
}
function buildAuditBlock(alert) {
  const terrorTerms = Array.isArray(alert.terrorismHits) && alert.terrorismHits.length ? alert.terrorismHits : terrorismMatches(alert);
  const age = alert.publishedAt ? formatAgeFrom(alert.publishedAt) : 'age unknown';
  return [
    `SOURCE TIER: ${normaliseSourceTier(alert.sourceTier) || 'unclassified'}`,
    `RELIABILITY PROFILE: ${reliabilityLabel(inferReliabilityProfile(alert))}`,
    `AGE: ${age}`,
    `LANE REASON: ${clean(alert.laneReason) || contextLabel(alert)}`,
    terrorTerms.length ? `TERROR TERMS HIT: ${terrorTerms.join(', ')}` : 'TERROR TERMS HIT: none',
    `CORROBORATION COUNT: ${Number(alert.corroborationCount || 0)}`
  ].join('\n');
}
function renderCorroboratingSources(alert) {
  const sources = Array.isArray(alert.corroboratingSources) ? alert.corroboratingSources : [];
  if (!sources.length) {
    return "<p class='panel-copy'>No additional corroborating sources are attached to this incident yet.</p>";
  }
  return `<div class="corroboration-list">${sources.map((entry) => `
    <article class="corroboration-item">
      <a href="${entry.sourceUrl}" target="_blank" rel="noreferrer">${entry.source}</a>
      <p>${reliabilityLabel(normaliseReliabilityProfile(entry.reliabilityProfile))} | ${clean(entry.sourceTier) || 'source tier unknown'} | ${clean(entry.publishedAt) ? formatAgeFrom(entry.publishedAt) : 'age unknown'}</p>
    </article>`).join('')}</div>`;
}
function topPriority() { const pool = responderAlerts().length ? responderAlerts() : contextAlerts(); return pool[0]; }
function setActiveTab(next) {
  activeTab = next;
  tabbar.querySelectorAll('.tab').forEach((item) => item.classList.toggle('active', item.dataset.tab === next));
  document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === next));
  if (next === 'map') {
    setTimeout(() => {
      ensureMap();
      renderMap(true);
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

function buildBriefing(alert, summaryText) {
  const matches = Array.isArray(alert.terrorismHits) && alert.terrorismHits.length ? alert.terrorismHits : terrorismMatches(alert);
  const peopleInvolved = extractPeopleInvolved(alert);
  const sceneClock = buildSceneClock(alert);
  return [
    `WHAT: ${alert.title}`,
    `WHERE: ${alert.location}`,
    `WHEN: ${alert.happenedWhen || alert.time}`,
      `SOURCE: ${alert.source}`,
      `CONFIDENCE: ${alert.confidence}`,
      `LANE: ${laneLabels[alert.lane] || alert.lane}`,
      alert.lane === 'incidents' && inferIncidentTrack(alert) ? `INCIDENT TRACK: ${inferIncidentTrack(alert) === 'live' ? 'Live incident' : 'Case / prosecution'}` : '',
      alert.eventType ? `EVENT TYPE: ${clean(alert.eventType).replace(/_/g, ' ')}` : '',
      alert.geoPrecision ? `GEO PRECISION: ${alert.geoPrecision}` : '',
      Number(alert.corroborationCount || 0) ? `CORROBORATION COUNT: ${alert.corroborationCount}` : '',
      '',
      'SCENE CLOCK:',
      `FIRST REPORT: ${sceneClock.firstReport ? `${clockDisplay(sceneClock.firstReport.publishedAt)} | ${sceneClockStamp(sceneClock.firstReport.publishedAt)}` : 'Unconfirmed'}`,
      `LAST OFFICIAL UPDATE: ${sceneClock.lastOfficial ? `${clockDisplay(sceneClock.lastOfficial.publishedAt)} | ${sceneClockStamp(sceneClock.lastOfficial.publishedAt)}` : 'No official update yet'}`,
      `LAST CORROBORATION: ${sceneClock.lastCorroboration ? `${clockDisplay(sceneClock.lastCorroboration.publishedAt)} | ${sceneClockStamp(sceneClock.lastCorroboration.publishedAt)}` : 'No corroboration yet'}`,
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
  const sourceTier = normaliseSourceTier(alert.sourceTier);
  const reliabilityProfile = inferReliabilityProfile({
    ...alert,
    sourceTier,
    isOfficial: !!alert.isOfficial,
    lane: ['incidents','sanctions','oversight','border','prevention'].includes(alert.lane) ? alert.lane : 'incidents',
    source: clean(alert.source) || 'Unknown source'
  });
  const incidentTrack = inferIncidentTrack(alert);
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
      sourceTier,
      reliabilityProfile,
      incidentTrack,
      isDuplicateOf: clean(alert.isDuplicateOf),
      freshUntil: clean(alert.freshUntil),
      needsHumanReview: !!alert.needsHumanReview,
      priorityScore: Number.isFinite(alert.priorityScore) ? alert.priorityScore : null,
      confidenceScore: Number.isFinite(alert.confidenceScore) ? alert.confidenceScore : null,
      publishedAt: clean(alert.publishedAt),
      freshnessBucket: Number.isFinite(alert.freshnessBucket) ? alert.freshnessBucket : null,
      terrorismHits: Array.isArray(alert.terrorismHits) ? alert.terrorismHits.filter(Boolean) : [],
      isTerrorRelevant: typeof alert.isTerrorRelevant === 'boolean' ? alert.isTerrorRelevant : null,
      laneReason: clean(alert.laneReason),
      corroboratingSources: Array.isArray(alert.corroboratingSources) ? alert.corroboratingSources.filter(Boolean).map((entry) => ({
        source: clean(entry.source),
        sourceUrl: clean(entry.sourceUrl),
        sourceTier: normaliseSourceTier(entry.sourceTier),
        reliabilityProfile: normaliseReliabilityProfile(entry.reliabilityProfile),
        publishedAt: clean(entry.publishedAt),
        confidence: clean(entry.confidence)
      })) : [],
      corroborationCount: Number.isFinite(alert.corroborationCount) ? alert.corroborationCount : 0
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
function renderBriefingMode() {
  if (!briefingMode) {
    briefingModePanel.classList.add('hidden');
    return;
  }

  briefingModePanel.classList.remove('hidden');
  const alert = topPriority();
  if (!alert) {
    briefingModeTitle.textContent = 'Waiting for a verified source pull';
    briefingModeMeta.textContent = 'The briefing screen will lock onto the top live responder item as soon as one arrives.';
    briefingModeSummary.textContent = 'No live responder candidate is available yet, so the app is holding on a clean standby state rather than surfacing stale or placeholder material.';
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
  contextList.innerHTML = items.length ? items.map((alert) => `<article class="context-pill actionable" data-context="${alert.id}"><h4>${alert.title}</h4><p>${contextLabel(alert)} | ${alert.source}</p></article>`).join('') : "<p class='panel-copy'>No contextual items have been published into this filter yet.</p>";
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
  const regionCopy = briefingMode ? 'Top alert only' : (activeRegion === 'all' ? 'All feeds' : `${regionLabel(activeRegion)} feeds`);
  const laneCopy = briefingMode ? 'Briefing posture' : (activeLane === 'all' ? 'Responder posture' : laneLabels[activeLane]);
  heroRegion.textContent = `${regionCopy} | ${laneCopy}`;
  const sourceAge = liveFeedGeneratedAt ? formatAgeFrom(liveFeedGeneratedAt) : 'waiting';
  heroPolling.textContent = `UI checks 60s | feed build ~${SOURCE_PULL_MINUTES}m | source age ${sourceAge}`;
  const stamp = liveFeedGeneratedAt || lastBrowserPollAt;
  const sourceSuffix = liveSourceCount ? ` | ${liveSourceCount} sources` : ' | awaiting live pull';
  heroUpdated.textContent = `${stamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${sourceSuffix}`;
}

function renderAll() { renderHero(); renderBriefingMode(); renderPriority(); renderFeed(); renderContext(); renderMap(); renderWatchlist(); renderNotes(); }

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
  modalBriefing.textContent = buildBriefing(alert, summaryText);
  modalLink.href = alert.sourceUrl;
  copyBriefing.dataset.briefing = buildBriefing(alert, summaryText);
  modal.classList.remove('hidden');
}

function closeDetailPanel() { modal.classList.add('hidden'); }
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
document.getElementById('note-form').addEventListener('submit', (event) => { event.preventDefault(); const title = document.getElementById('note-title'); const body = document.getElementById('note-body'); notes.unshift({ title: title.value.trim(), body: body.value.trim() }); saveNotes(); title.value = ''; body.value = ''; renderNotes(); });
copyBriefing.addEventListener('click', async () => { const briefing = copyBriefing.dataset.briefing || ''; if (!briefing) return; await copyTextToButton(briefing, copyBriefing, 'Copy Briefing'); });
briefingModeToggle.addEventListener('click', () => { briefingMode = !briefingMode; saveBriefingMode(); applyBriefingMode(); renderAll(); });
briefingModeCopy.addEventListener('click', async () => { const briefing = briefingModeCopy.dataset.briefing || ''; if (!briefing) return; await copyTextToButton(briefing, briefingModeCopy, 'Copy Briefing'); });
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
briefingMode = loadBriefingMode();
albertQuote.textContent = nextAlbertQuote();
albertCard.addEventListener('click', () => { albertQuote.textContent = nextAlbertQuote(); });
document.querySelector('.bulldog-card').addEventListener('dblclick', () => { albertNote.classList.toggle('hidden'); });

applyBriefingMode();
renderAll();
loadGeoLookup().finally(() => {
  loadLiveFeed();
});
setInterval(loadLiveFeed, POLL_INTERVAL_MS);
