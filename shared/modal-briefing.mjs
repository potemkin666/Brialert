import { regionLabel } from './alert-view-model.mjs';
import { loadLongBrief } from './brief-cache.mjs';
import { reportBackgroundError } from './logger.mjs';

/**
 * Build scene-clock content as DOM nodes instead of innerHTML.
 * Accepts the structured clock data (from buildSceneClock) and produces
 * elements using textContent only — eliminating XSS surface.
 */
function buildSceneClockDOM(clock, doc) {
  const container = doc.createElement('div');
  container.className = 'scene-clock-grid';
  const items = [
    { label: 'Since first report', entry: clock.firstReport, fallback: 'No report timestamp confirmed yet.' }
  ];
  for (const { label, entry, fallback } of items) {
    const article = doc.createElement('article');
    article.className = 'scene-clock-item';
    const strong = doc.createElement('strong');
    strong.textContent = label;
    const p = doc.createElement('p');
    if (entry) {
      const parts = [];
      if (entry.publishedAt) parts.push(entry.publishedAt);
      if (entry.source) parts.push(entry.source);
      p.textContent = parts.join(' | ') || fallback;
    } else {
      p.textContent = fallback;
    }
    article.appendChild(strong);
    article.appendChild(p);
    container.appendChild(article);
  }
  return container;
}

/**
 * Build corroborating-sources list as DOM nodes instead of innerHTML.
 */
function buildCorroborationDOM(sources, deps, doc) {
  if (!sources.length) return null;
  const container = doc.createElement('div');
  container.className = 'corroboration-list';
  for (const entry of sources) {
    const article = doc.createElement('article');
    article.className = 'corroboration-item';
    const a = doc.createElement('a');
    const href = deps.safeHref ? deps.safeHref(entry.sourceUrl) : '#';
    a.href = href;
    a.target = '_blank';
    a.rel = 'noreferrer';
    a.textContent = entry.source || '';
    const p = doc.createElement('p');
    const metaParts = [
      deps.reliabilityLabel ? deps.reliabilityLabel(entry.reliabilityProfile) : '',
      entry.sourceTier || 'source tier unknown',
      entry.publishedAt ? (deps.formatAge ? deps.formatAge(entry.publishedAt) : '') : 'age unknown'
    ].filter(Boolean);
    p.textContent = metaParts.join(' | ');
    article.appendChild(a);
    article.appendChild(p);
    container.appendChild(article);
  }
  return container;
}

export function createModalController(elements, deps, options = {}) {
  const {
    modal,
    modalTitle,
    modalMeta,
    modalSummary,
    modalSceneClock,
    sceneClockPanel,
    modalCorroboration,
    corroborationPanel,
    modalSeverity,
    modalStatus,
    modalSource,
    modalRegion,
    modalBriefing,
    modalLink,
    copyBriefing,
    expandedBriefPanel,
    longBriefFallbackNotice,
    modalExpandedBrief,
    generateExpandedBrief,
    copyExpandedBrief
  } = elements;

  let currentAlert = null;
  let lockedScrollY = 0;

  function lockBodyScroll() {
    lockedScrollY = window.scrollY || window.pageYOffset || 0;
    document.body.classList.add('modal-open');
    document.body.style.top = `-${lockedScrollY}px`;
  }

  function unlockBodyScroll() {
    document.body.classList.remove('modal-open');
    document.body.style.top = '';
    window.scrollTo(0, lockedScrollY);
  }

  const loadLongBriefFn = options.loadLongBrief || loadLongBrief;

  function restoreCachedBrief(alert) {
    const cached = loadLongBriefFn(alert.id);
    if (!cached) return;
    if (modalExpandedBrief) modalExpandedBrief.textContent = cached;
    if (copyExpandedBrief) {
      copyExpandedBrief.disabled = false;
      copyExpandedBrief.dataset.brief = cached;
    }
    if (generateExpandedBrief) {
      generateExpandedBrief.textContent = 'Regenerate Long Brief';
    }
  }

  function openDetail(alert) {
    if (!alert) return;
    currentAlert = alert;
    const summaryText = deps.effectiveSummary(alert);
    const briefing = deps.buildBriefing(alert, summaryText);
    modalTitle.textContent = alert.title;
    modalMeta.textContent = `${alert.location} | ${alert.time}`;
    modalSummary.textContent = '';
    modalSummary.hidden = true;

    // Scene clock — DOM construction (no innerHTML)
    const doc = modalSceneClock.ownerDocument || document;
    if (deps.buildSceneClock) {
      const clock = deps.buildSceneClock(alert);
      modalSceneClock.textContent = '';
      modalSceneClock.appendChild(buildSceneClockDOM(clock, doc));
    } else {
      modalSceneClock.innerHTML = deps.renderSceneClock(alert);
    }
    sceneClockPanel.hidden = false;

    // Corroboration — DOM construction (no innerHTML)
    const sources = Array.isArray(alert.corroboratingSources) ? alert.corroboratingSources : [];
    if (deps.buildSceneClock) {
      modalCorroboration.textContent = '';
      const corrobEl = buildCorroborationDOM(sources, deps, doc);
      if (corrobEl) modalCorroboration.appendChild(corrobEl);
      corroborationPanel.hidden = !sources.length;
    } else {
      const corroborationMarkup = deps.renderCorroboratingSources(alert);
      modalCorroboration.innerHTML = corroborationMarkup;
      corroborationPanel.hidden = !corroborationMarkup;
    }

    modalSeverity.textContent = deps.severityLabel(alert.severity);
    modalStatus.textContent = alert.status;
    modalSource.textContent = alert.source;
    modalRegion.textContent = regionLabel(alert.region);
    modalBriefing.textContent = briefing;
    if (modalExpandedBrief) {
      modalExpandedBrief.textContent = 'Press Generate Long Brief to create a longer AI-written factual brief from the captured source text.';
    }
    if (expandedBriefPanel) expandedBriefPanel.hidden = false;
    if (longBriefFallbackNotice) {
      longBriefFallbackNotice.textContent = '';
      longBriefFallbackNotice.hidden = true;
    }
    if (generateExpandedBrief) {
      generateExpandedBrief.disabled = false;
      generateExpandedBrief.textContent = 'Generate Long Brief';
    }
    if (copyExpandedBrief) {
      copyExpandedBrief.disabled = true;
      copyExpandedBrief.dataset.brief = '';
      copyExpandedBrief.textContent = 'Copy Long Brief';
    }
    restoreCachedBrief(alert);
    modalLink.href = alert.sourceUrl;
    copyBriefing.dataset.briefing = briefing;
    lockBodyScroll();
    modal.classList.remove('hidden');
  }

  function closeDetailPanel() {
    currentAlert = null;
    unlockBodyScroll();
    modal.classList.add('hidden');
  }

  async function copyTextToButton(text, button, idleLabel) {
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = 'Copied';
    } catch (error) {
      reportBackgroundError('modal', 'Clipboard copy failed', error, { operation: 'copyTextToButton' });
      button.textContent = 'Copy failed';
    }
    setTimeout(() => {
      button.textContent = idleLabel;
    }, 1200);
  }

  return {
    openDetail,
    closeDetailPanel,
    copyTextToButton,
    getCurrentAlert() {
      return currentAlert;
    },
    setExpandedBrief(text) {
      if (!modalExpandedBrief || !copyExpandedBrief || !generateExpandedBrief) return;
      modalExpandedBrief.textContent = text;
      copyExpandedBrief.disabled = !cleanText(text);
      copyExpandedBrief.dataset.brief = text || '';
      generateExpandedBrief.textContent = 'Regenerate Long Brief';
    }
  };
}

function cleanText(value) {
  return String(value || '').trim();
}
