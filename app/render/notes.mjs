import { matchesAlertSearch } from '../../shared/feed-controller.mjs';
import { watchlistCardMarkup } from '../components/cards.mjs';

function noteMatchesSearch(note, query) {
  const terms = String(query || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!terms.length) return true;

  const haystack = [note?.title, note?.body]
    .filter((value) => typeof value === 'string' && value.trim())
    .join(' ')
    .toLowerCase();

  return terms.every((term) => haystack.includes(term));
}

export function renderWatchlist({ state, elements, modalController }) {
  const allTracked = state.alerts.filter((alert) => state.watched.has(alert.id));
  const tracked = allTracked.filter((alert) => matchesAlertSearch(alert, state.searchQuery));
  const hasSearch = Boolean(String(state.searchQuery || '').trim());

  elements.watchlistSummary.textContent = hasSearch
    ? (tracked.length ? `${tracked.length} matching tracked incidents` : 'No results found')
    : (tracked.length ? `${tracked.length} tracked incidents` : 'No tracked incidents');
  elements.watchlistList.innerHTML = tracked.length
    ? tracked.map(watchlistCardMarkup).join('')
    : `<p class='panel-copy'>${
      hasSearch
        ? 'No results found.'
        : 'Track incidents in F.O.C to pin them here.'
    }</p>`;
  elements.watchlistList.querySelectorAll('[data-watch]').forEach((card) => {
    card.addEventListener('click', () => modalController.openDetail(state.alerts.find((item) => item.id === card.dataset.watch)));
  });
}

export function renderNotes({ state, elements }) {
  elements.notesList.replaceChildren();
  const matchingNotes = state.notes.filter((note) => noteMatchesSearch(note, state.searchQuery));
  if (!matchingNotes.length) {
    const empty = document.createElement('p');
    empty.className = 'panel-copy';
    empty.textContent = String(state.searchQuery || '').trim() ? 'No results found.' : 'No notes saved yet.';
    elements.notesList.append(empty);
    return;
  }

  matchingNotes.forEach((note) => {
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

function sourceRequestMatchesSearch(entry, query) {
  const terms = String(query || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!terms.length) return true;
  const value = String(entry?.url || '').toLowerCase();
  return terms.every((term) => value.includes(term));
}

export function addSourceRequest(sourceRequests, rawUrl, now = new Date()) {
  const nextUrl = String(rawUrl || '').trim();
  if (!nextUrl) {
    return { ok: false, message: 'Please paste a website link first.' };
  }
  let parsed = null;
  try {
    parsed = new URL(nextUrl);
  } catch {
    return { ok: false, message: 'That does not look like a valid website link. Please paste a full link like https://example.com' };
  }
  if (!/^https?:$/i.test(parsed.protocol)) {
    return { ok: false, message: 'Please use an http or https website link.' };
  }
  const url = parsed.toString();
  const alreadyRequested = (Array.isArray(sourceRequests) ? sourceRequests : []).some((entry) => entry?.url === url);
  if (alreadyRequested) {
    return { ok: false, message: 'That source link has already been requested.' };
  }
  if (!Array.isArray(sourceRequests)) {
    return { ok: false, message: 'Unable to save source request right now.' };
  }
  sourceRequests.unshift({
    url,
    requestedAt: now.toISOString()
  });
  return { ok: true, message: 'Source request saved.' };
}

export function renderSourceRequests({ state, elements }) {
  if (!elements.sourceRequestsList) return;
  elements.sourceRequestsList.replaceChildren();
  const matching = (Array.isArray(state.sourceRequests) ? state.sourceRequests : [])
    .filter((entry) => sourceRequestMatchesSearch(entry, state.searchQuery));
  if (!matching.length) {
    const empty = document.createElement('p');
    empty.className = 'panel-copy';
    empty.textContent = String(state.searchQuery || '').trim()
      ? 'No results found.'
      : 'No source requests yet.';
    elements.sourceRequestsList.append(empty);
    return;
  }
  matching.forEach((entry) => {
    const card = document.createElement('article');
    card.className = 'note-card';
    const title = document.createElement('strong');
    title.textContent = String(entry.url || '');
    const body = document.createElement('p');
    body.textContent = `Requested ${new Date(entry.requestedAt || Date.now()).toLocaleString()}`;
    card.append(title, body);
    elements.sourceRequestsList.append(card);
  });
}
