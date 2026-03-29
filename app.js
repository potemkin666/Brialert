const POLL_INTERVAL_MS = 60_000;

const alerts = [
  {
    id: "leeds-terrorism-charges",
    title: "Leeds Man Charged with Eleven Terrorism Offences",
    location: "Leeds",
    region: "uk",
    lane: "incidents",
    severity: "critical",
    status: "Charged",
    actor: "Counter Terrorism Policing North East and CPS",
    subject: "A 33-year-old man from Leeds",
    happenedWhen: "13 March 2026",
    confidence: "Verified official case update",
    summary: "Counter Terrorism Policing North East said a 33-year-old man from Leeds was charged with eleven terrorism offences after an intelligence-led investigation.",
    aiSummary: "This is a prosecution-stage development rather than a fast-moving public incident, but it still carries strong responder value because it marks the point where an intelligence-led investigation has progressed into formal charges. The volume of offences suggests a broader evidential picture rather than a single narrow allegation, which means the case may later expose propaganda links, facilitation activity, possession or dissemination behaviour, travel indicators, or networked extremist contact that are not yet fully in the open. For a working brief, the key point is that this is a verified official Counter Terrorism Policing update tied to Leeds, and it should be monitored for the exact offence mix, court progression, linked arrests, ideological framing, and any evidence that the case connects to wider operational activity.",
    source: "Counter Terrorism Policing",
    sourceUrl: "https://www.counterterrorism.police.uk/leeds-man-charged-with-eleven-terrorism-offences/",
    time: "13 Mar 2026",
    x: 24,
    y: 36,
    major: true
  },
  {
    id: "eurojust-self-igniting-parcels",
    title: "Joint Investigation Team Disrupts Group Using Self-Igniting Parcels",
    location: "Europe-wide",
    region: "europe",
    lane: "incidents",
    severity: "high",
    status: "Press release",
    actor: "Eurojust and national judicial partners",
    subject: "A cross-border group linked to self-igniting parcel attacks",
    happenedWhen: "06 March 2026",
    confidence: "Verified official judicial update",
    summary: "Eurojust said a joint investigation team was crucial in exposing several attacks across Europe involving self-igniting parcels and linked suspects in Lithuania and Poland.",
    aiSummary: "This is a strong cross-border incident brief because it frames the parcel attacks as a linked operational picture across several jurisdictions rather than a set of isolated suspicious items. The main significance is the combination of method, suspects, and judicial coordination into a single disruption narrative, which makes it more operationally useful than a routine institutional update. For briefing, the important line is that Eurojust attributes the progress in the case to coordinated investigative and prosecutorial work, with next checks likely to focus on further arrests, additional countries entering the case picture, target selection, technical method, and whether the network shows broader extremist or support facilitation links.",
    source: "Eurojust",
    sourceUrl: "https://www.eurojust.europa.eu/news/joint-investigation-team-disrupts-group-using-self-igniting-parcels-terrorist-attacks",
    time: "06 Mar 2026",
    x: 56,
    y: 50,
    major: true
  },
  {
    id: "uk-ct-sanctions-notices",
    title: "Counter-Terrorism Sanctions Notices Remain a High-Signal Watch Surface",
    location: "United Kingdom",
    region: "uk",
    lane: "sanctions",
    severity: "elevated",
    status: "Guidance page",
    actor: "FCDO and HM Treasury sanctions architecture",
    subject: "Designation, delisting, and alias updates under the UK CT sanctions regime",
    happenedWhen: "19 February 2026",
    confidence: "Verified official sanctions page",
    summary: "The UK counter-terrorism sanctions notices page provides granular notice-level changes including aliases, identifiers, and designation changes.",
    aiSummary: "This is not a live incident alert, but it is a high-signal legal and operational watch surface because sanctions notices often expose changes in names, aliases, identifiers, and regime posture before those changes are reflected consistently in secondary reporting. In practical briefing terms, these notices help with entity resolution, alias mapping, cross-jurisdiction comparison, and understanding whether the UK is tightening or altering its treatment of individuals or organisations tied to terrorism designation frameworks. It belongs in the sanctions lane because the real value is in notice-level change detection rather than headline drama.",
    source: "GOV.UK",
    sourceUrl: "https://www.gov.uk/guidance/counter-terrorism-list-of-designations-and-sanctions-notices",
    time: "19 Feb 2026",
    x: 28,
    y: 42,
    major: false
  },
  {
    id: "separation-centres-response",
    title: "Government Response to Separation Centre Review",
    location: "United Kingdom",
    region: "uk",
    lane: "oversight",
    severity: "moderate",
    status: "Response published",
    actor: "UK Government and custodial review framework",
    subject: "Policy and safety changes following the Separation Centre review",
    happenedWhen: "03 February 2026",
    confidence: "Verified official response page",
    summary: "The government response covers staff safety, intelligence capability, and system reform after the review of Separation Centres.",
    aiSummary: "This is an oversight and prison-extremism signal rather than a front-line incident, but it matters because failures in custodial management, staff protection, intelligence handling, and offender separation can later feed directly into broader security risk. For briefing purposes, the strongest line is that the government is responding to weaknesses identified by the review, including staff safety and system design implications. It belongs in oversight because it shapes long-term posture rather than immediate public warning, but it is exactly the kind of downstream signal that can explain later operational strain.",
    source: "GOV.UK",
    sourceUrl: "https://www.gov.uk/government/publications/response-to-the-independent-review-of-separation-centres",
    time: "03 Feb 2026",
    x: 30,
    y: 47,
    major: false
  },
  {
    id: "frontex-document-fraud",
    title: "Document Fraud Remains a Key Border-Risk Enabler",
    location: "European Union",
    region: "europe",
    lane: "border",
    severity: "moderate",
    status: "Reference page",
    actor: "Frontex",
    subject: "Document and identity fraud as an enabler of serious crime and terrorism",
    happenedWhen: "Current standing guidance",
    confidence: "Verified official Frontex page",
    summary: "Frontex describes document and identity fraud as a serious threat and a key enabler for crimes including terrorism.",
    aiSummary: "This belongs in the border lane because it frames document and identity fraud as a persistent enabling mechanism rather than a one-off event. The practical briefing value is strategic: document abuse affects mobility, screening confidence, and the ability of hostile actors to obscure travel patterns or identities. It should not trigger the same urgency as a live attack report, but it is the sort of background risk factor that helps explain how later incidents may have been enabled.",
    source: "Frontex",
    sourceUrl: "https://www.frontex.europa.eu/what-we-do/fighting-crime/document-fraud/",
    time: "Reference",
    x: 63,
    y: 57,
    major: false
  },
  {
    id: "eu-knowledge-hub-newsletter",
    title: "EU Knowledge Hub Flags Radicalisation and Network Trends",
    location: "European Union",
    region: "europe",
    lane: "prevention",
    severity: "elevated",
    status: "Newsletter",
    actor: "EU Knowledge Hub on Prevention of Radicalisation",
    subject: "Cross-border extremist networks and evolving online radicalisation dynamics",
    happenedWhen: "27 February 2026",
    confidence: "Verified official EU page",
    summary: "The EU Knowledge Hub newsletter points to extremist network evolution, online cultures, and foreign conflict linkages relevant to prevention work.",
    aiSummary: "This is a prevention and horizon-scanning item rather than a breaking alert, but it is useful because it highlights how online radicalisation environments, extremist network behaviour, and cross-border influences are being framed by an official EU prevention platform. For a quick brief, the main point is that the item contributes strategic context rather than incident detail, helping an analyst understand trend pressure that may later surface in arrests, referrals, or attack plotting.",
    source: "European Commission",
    sourceUrl: "https://home-affairs.ec.europa.eu/networks/eu-knowledge-hub-prevention-radicalisation_en",
    time: "27 Feb 2026",
    x: 59,
    y: 45,
    major: false
  }
];

const albertQuotes = [
  "Stay steady. Clear heads make better decisions.",
  "Breathe first, then assess, then act.",
  "Good responders buy clarity before they buy speed.",
  "Calm is contagious when the room needs it most.",
  "The brief is only useful if it is clean, fast, and trusted."
];

const laneLabels = {
  all: "All lanes",
  incidents: "Incidents",
  sanctions: "Sanctions",
  oversight: "Oversight",
  border: "Border",
  prevention: "Prevention"
};

const incidentKeywords = [
  "terror",
  "terrorism",
  "attack",
  "attacks",
  "bomb",
  "bombing",
  "explosion",
  "explosive",
  "device",
  "ramming",
  "stabbing",
  "shooting",
  "hostage",
  "plot",
  "suspect",
  "arrest",
  "charged",
  "charged with",
  "parcel",
  "radicalised",
  "extremist",
  "isis",
  "islamic state",
  "al-qaeda",
  "threat"
];

const trustedMajorSources = new Set([
  "Counter Terrorism Policing",
  "Eurojust",
  "GOV.UK",
  "Europol",
  "Reuters",
  "The Guardian",
  "BBC News",
  "Associated Press"
]);

const notes = [
  {
    title: "Morning posture",
    body: "Maintain focus on transport hubs, symbolic sites, and fast-moving public order environments with terrorism indicators."
  },
  {
    title: "Cross-border watch",
    body: "Track whether any developing European incidents show common method, travel pathway, or propaganda overlap with UK activity."
  }
];

let activeRegion = "all";
let activeLane = "all";
let watched = new Set(["eurojust-self-igniting-parcels"]);
let lastPolledAt = new Date();
let albertIndex = 0;

const priorityCard = document.getElementById("priority-card");
const feedList = document.getElementById("feed-list");
const contextList = document.getElementById("context-list");
const watchlistList = document.getElementById("watchlist-list");
const notesList = document.getElementById("notes-list");
const watchedCount = document.getElementById("watched-count");
const contextCount = document.getElementById("context-count");
const watchlistSummary = document.getElementById("watchlist-summary");
const heroRegion = document.getElementById("hero-region");
const heroUpdated = document.getElementById("hero-updated");
const heroPolling = document.getElementById("hero-polling");
const mapGrid = document.getElementById("map-grid");
const mapSummary = document.getElementById("map-summary");
const filters = document.getElementById("filters");
const laneFilters = document.getElementById("lane-filters");
const tabbar = document.getElementById("tabbar");
const albertCard = document.getElementById("albert-card");
const albertQuote = document.getElementById("albert-quote");
const albertNote = document.getElementById("albert-note");

const modal = document.getElementById("detail-modal");
const closeModal = document.getElementById("close-modal");
const copyBriefing = document.getElementById("copy-briefing");
const modalBackdrop = document.getElementById("modal-backdrop");
const modalTitle = document.getElementById("modal-title");
const modalMeta = document.getElementById("modal-meta");
const modalAiSummary = document.getElementById("modal-ai-summary");
const modalSummary = document.getElementById("modal-summary");
const modalSeverity = document.getElementById("modal-severity");
const modalStatus = document.getElementById("modal-status");
const modalSource = document.getElementById("modal-source");
const modalRegion = document.getElementById("modal-region");
const modalBriefing = document.getElementById("modal-briefing");
const modalLink = document.getElementById("modal-link");

function filteredAlerts() {
  return alerts.filter((alert) => {
    const regionMatch = activeRegion === "all" || alert.region === activeRegion;
    const laneMatch = activeLane === "all" || alert.lane === activeLane;
    return regionMatch && laneMatch;
  });
}

function responderAlerts() {
  return filteredAlerts().filter(isLiveIncidentCandidate);
}

function contextAlerts() {
  return filteredAlerts().filter((alert) => !isLiveIncidentCandidate(alert));
}

function severityLabel(severity) {
  return severity.charAt(0).toUpperCase() + severity.slice(1);
}

function regionLabel(region) {
  return region === "uk" ? "UK" : "EU";
}

function keywordMatches(alert) {
  const haystack = `${alert.title} ${alert.summary} ${alert.aiSummary}`.toLowerCase();
  return incidentKeywords.filter((keyword) => haystack.includes(keyword));
}

function incidentScore(alert) {
  const matches = keywordMatches(alert);
  let score = matches.length;
  if (alert.lane === "incidents") score += 3;
  if (alert.severity === "critical") score += 3;
  if (alert.severity === "high") score += 2;
  if (alert.major) score += 2;
  if (trustedMajorSources.has(alert.source)) score += 2;
  return score;
}

function isLiveIncidentCandidate(alert) {
  return alert.lane === "incidents" && incidentScore(alert) >= 6;
}

function buildBriefing(alert, summaryText) {
  const matches = keywordMatches(alert);
  return [
    `WHO: ${alert.subject}`,
    `WHAT: ${alert.title}`,
    `WHERE: ${alert.location}`,
    `WHEN: ${alert.happenedWhen}`,
    `SOURCE: ${alert.source}`,
    `CONFIDENCE: ${alert.confidence}`,
    `LANE: ${laneLabels[alert.lane]}`,
    "",
    "EXECUTIVE NOTE:",
    summaryText,
    "",
    "IMMEDIATE VALUE:",
    `This item sits in the ${laneLabels[alert.lane].toLowerCase()} lane and should be read as ${isLiveIncidentCandidate(alert) ? "a live incident responder candidate" : "a contextual monitoring item"}.`,
    matches.length ? `TRIGGER KEYWORDS: ${matches.join(", ")}` : "TRIGGER KEYWORDS: none matched",
    "",
    `ORIGINAL LINK: ${alert.sourceUrl}`
  ].join("\n");
}

function topPriority() {
  const ranking = { critical: 4, high: 3, elevated: 2, moderate: 1 };
  const pool = responderAlerts().length ? responderAlerts() : contextAlerts();
  return [...pool].sort((a, b) => {
    const scoreGap = incidentScore(b) - incidentScore(a);
    if (scoreGap !== 0) return scoreGap;
    if (a.major !== b.major) return a.major ? -1 : 1;
    return ranking[b.severity] - ranking[a.severity];
  })[0];
}

function openDetail(alert) {
  modalTitle.textContent = alert.title;
  modalMeta.textContent = `${alert.location} | ${alert.time}`;
  modalAiSummary.textContent = alert.aiSummary;
  modalSummary.textContent = alert.summary;
  modalSeverity.textContent = severityLabel(alert.severity);
  modalStatus.textContent = alert.status;
  modalSource.textContent = alert.source;
  modalRegion.textContent = alert.region === "uk" ? "United Kingdom" : "Europe";
  modalBriefing.textContent = buildBriefing(alert, alert.aiSummary);
  modalLink.href = alert.sourceUrl;
  copyBriefing.dataset.briefing = buildBriefing(alert, alert.aiSummary);
  modal.classList.remove("hidden");
}

function closeDetailPanel() {
  modal.classList.add("hidden");
}

function renderPriority() {
  const alert = topPriority();
  if (!alert) {
    priorityCard.classList.remove("context-priority");
    priorityCard.innerHTML = "<p>No alerts available for this filter.</p>";
    return;
  }

  const liveCandidate = isLiveIncidentCandidate(alert);
  const matches = keywordMatches(alert);
  priorityCard.classList.toggle("context-priority", !liveCandidate);

  priorityCard.innerHTML = `
    <div class="eyebrow">${liveCandidate ? "Live Terror Incident Trigger" : "Context Item"}</div>
    <h2>${alert.title}</h2>
    <p class="muted">${laneLabels[alert.lane]} | ${alert.location} | ${alert.status}</p>
    <p>${alert.summary}</p>
    <div class="meta-row">
      <span>${alert.source}</span>
      <span>${matches.length ? `${matches.length} keyword hits` : "No incident keyword hit"}</span>
      <span>${alert.time}</span>
    </div>
  `;

  priorityCard.onclick = () => openDetail(alert);
}

function responderCardMarkup(alert) {
  return `
    <article class="feed-card actionable" data-id="${alert.id}">
      <div class="feed-top">
        <div>
          <h4>${alert.title}</h4>
          <p>${alert.location}</p>
        </div>
        <div class="feed-actions">
          <button class="star-button ${watched.has(alert.id) ? "active" : ""}" data-star="${alert.id}">${watched.has(alert.id) ? "Watch" : "Track"}</button>
          <span class="severity severity-${alert.severity}">${severityLabel(alert.severity)}</span>
        </div>
      </div>
      <p>${alert.summary}</p>
      <div class="meta-row">
        <span>${alert.source}</span>
        <span>${alert.status}</span>
      </div>
    </article>
  `;
}

function renderFeed() {
  const items = responderAlerts();
  feedList.innerHTML = items.length
    ? items.map(responderCardMarkup).join("")
    : "<p class='panel-copy'>No live incident triggers in this filter.</p>";

  watchedCount.textContent = `${watched.size} watched`;

  feedList.querySelectorAll(".feed-card").forEach((card) => {
    card.addEventListener("click", () => {
      const alert = alerts.find((item) => item.id === card.dataset.id);
      openDetail(alert);
    });
  });

  feedList.querySelectorAll(".star-button").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const id = button.dataset.star;
      if (watched.has(id)) watched.delete(id);
      else watched.add(id);
      renderAll();
    });
  });
}

function renderContext() {
  const items = contextAlerts().slice(0, 4);
  contextCount.textContent = `${items.length} contextual items`;
  contextList.innerHTML = items.length
    ? items.map((alert) => `
      <article class="context-pill actionable" data-context="${alert.id}">
        <h4>${alert.title}</h4>
        <p>${laneLabels[alert.lane]} | ${alert.source}</p>
      </article>
    `).join("")
    : "<p class='panel-copy'>No contextual items in this filter.</p>";

  contextList.querySelectorAll("[data-context]").forEach((card) => {
    card.addEventListener("click", () => {
      const alert = alerts.find((item) => item.id === card.dataset.context);
      openDetail(alert);
    });
  });
}

function renderMap() {
  mapGrid.querySelectorAll(".pin").forEach((pin) => pin.remove());
  filteredAlerts().forEach((alert) => {
    const pin = document.createElement("button");
    pin.className = `pin actionable severity-${alert.severity}`;
    pin.style.left = `${alert.x}%`;
    pin.style.top = `${alert.y}%`;
    pin.dataset.pin = alert.id;
    pin.setAttribute("aria-label", alert.title);
    pin.addEventListener("click", () => openDetail(alert));
    mapGrid.appendChild(pin);
  });

  mapSummary.textContent = `${responderAlerts().length} responder items | ${contextAlerts().length} context`;
}

function renderWatchlist() {
  const tracked = alerts.filter((alert) => watched.has(alert.id));
  watchlistSummary.textContent = tracked.length ? `${tracked.length} tracked incidents` : "No tracked incidents";
  watchlistList.innerHTML = tracked.length
    ? tracked.map((alert) => `
      <article class="feed-card actionable" data-watch="${alert.id}">
        <div class="feed-top">
          <div>
            <h4>${alert.title}</h4>
            <p>${alert.location}</p>
          </div>
          <span class="severity severity-${alert.severity}">${laneLabels[alert.lane]}</span>
        </div>
        <p>${alert.summary}</p>
      </article>
    `).join("")
    : "<p class='panel-copy'>Track incidents in F.O.C to pin them here.</p>";

  watchlistList.querySelectorAll("[data-watch]").forEach((card) => {
    card.addEventListener("click", () => {
      const alert = alerts.find((item) => item.id === card.dataset.watch);
      openDetail(alert);
    });
  });
}

function renderNotes() {
  notesList.innerHTML = notes.map((note) => `
    <article class="note-card">
      <strong>${note.title}</strong>
      <p>${note.body}</p>
    </article>
  `).join("");
}

function renderHero() {
  const regionCopy = activeRegion === "all" ? "All feeds" : `${regionLabel(activeRegion)} feeds`;
  const laneCopy = activeLane === "all" ? "Responder posture" : laneLabels[activeLane];
  heroRegion.textContent = `${regionCopy} | ${laneCopy}`;
  heroPolling.textContent = `Trusted incident sources / ${Math.round(POLL_INTERVAL_MS / 1000)}s`;
  heroUpdated.textContent = lastPolledAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function renderAll() {
  renderHero();
  renderPriority();
  renderFeed();
  renderContext();
  renderMap();
  renderWatchlist();
  renderNotes();
}

function runPollingCycle() {
  lastPolledAt = new Date();
  renderAll();
}

filters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-region]");
  if (!button) return;
  activeRegion = button.dataset.region;
  filters.querySelectorAll(".filter").forEach((item) => item.classList.remove("active"));
  button.classList.add("active");
  renderAll();
});

laneFilters.addEventListener("click", (event) => {
  const button = event.target.closest("[data-lane]");
  if (!button) return;
  activeLane = button.dataset.lane;
  laneFilters.querySelectorAll(".filter").forEach((item) => item.classList.remove("active"));
  button.classList.add("active");
  renderAll();
});

tabbar.addEventListener("click", (event) => {
  const button = event.target.closest("[data-tab]");
  if (!button) return;

  const next = button.dataset.tab;
  tabbar.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
  button.classList.add("active");

  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.panel === next);
  });
});

document.getElementById("note-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const title = document.getElementById("note-title");
  const body = document.getElementById("note-body");
  notes.unshift({ title: title.value.trim(), body: body.value.trim() });
  title.value = "";
  body.value = "";
  renderNotes();
});

copyBriefing.addEventListener("click", async () => {
  const briefing = copyBriefing.dataset.briefing || "";
  try {
    await navigator.clipboard.writeText(briefing);
    copyBriefing.textContent = "Copied";
    setTimeout(() => {
      copyBriefing.textContent = "Copy Briefing";
    }, 1200);
  } catch {
    copyBriefing.textContent = "Copy failed";
    setTimeout(() => {
      copyBriefing.textContent = "Copy Briefing";
    }, 1200);
  }
});

closeModal.addEventListener("click", closeDetailPanel);
modalBackdrop.addEventListener("click", closeDetailPanel);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeDetailPanel();
});

albertCard.addEventListener("click", () => {
  albertIndex = (albertIndex + 1) % albertQuotes.length;
  albertQuote.textContent = albertQuotes[albertIndex];
});

document.querySelector(".bulldog-card").addEventListener("dblclick", () => {
  albertNote.classList.toggle("hidden");
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

runPollingCycle();
setInterval(runPollingCycle, POLL_INTERVAL_MS);
