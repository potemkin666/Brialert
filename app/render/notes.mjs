import { watchlistCardMarkup } from '../components/cards.mjs';

export function renderWatchlist({ state, elements, modalController }) {
  const tracked = state.alerts.filter((alert) => state.watched.has(alert.id));
  elements.watchlistSummary.textContent = tracked.length ? `${tracked.length} tracked incidents` : 'No tracked incidents';
  elements.watchlistList.innerHTML = tracked.length
    ? tracked.map(watchlistCardMarkup).join('')
    : "<p class='panel-copy'>Track incidents in F.O.C to pin them here.</p>";
  elements.watchlistList.querySelectorAll('[data-watch]').forEach((card) => {
    card.addEventListener('click', () => modalController.openDetail(state.alerts.find((item) => item.id === card.dataset.watch)));
  });
}

export function renderNotes({ state, elements }) {
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
