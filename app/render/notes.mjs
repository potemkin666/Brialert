import { matchesAlertSearch } from '../../shared/feed-controller.mjs';
import { watchlistCardMarkup } from '../components/cards.mjs';

function noteMatchesSearch(note, query) {
  return matchesAlertSearch({
    title: note?.title,
    summary: note?.body
  }, query);
}

export function addSourceRequest(requests, link, now = new Date()) {
  const value = String(link || '').trim();
  if (!value) {
    return { ok: false, message: 'Enter a valid http(s) source link.' };
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, message: 'Enter a valid http(s) source link.' };
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { ok: false, message: 'Enter a valid http(s) source link.' };
  }

  const normalized = parsed.toString();
  const duplicate = requests.some((request) => String(request?.url || '').trim() === normalized);
  if (duplicate) {
    return { ok: false, message: 'That source link has already been requested.' };
  }

  const requestedAt = now instanceof Date && !Number.isNaN(now.getTime())
    ? now.toISOString()
    : new Date().toISOString();

  requests.unshift({ url: normalized, requestedAt });
  return { ok: true, message: 'Source request saved.' };
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
