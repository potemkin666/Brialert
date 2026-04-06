import { escapeHtml } from '../utils/text.mjs';
import { formatRequestedAtLabel } from '../../shared/time-format.mjs';

function requestMatchesSearch(request, query) {
  const terms = String(query || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!terms.length) return true;

  const haystack = [
    request?.provider,
    request?.endpoint,
    request?.region,
    request?.kind,
    request?.lane,
    request?.validationLabel
  ]
    .filter((value) => typeof value === 'string' && value.trim())
    .join(' ')
    .toLowerCase();

  return terms.every((term) => haystack.includes(term));
}

function sourceRequestCardMarkup(request) {
  const validationLabel = request?.validationLabel || `${request?.kind || 'html'} | ${request?.region || 'uk'} | queued`;
  return `
    <article class="source-request-card">
      <strong>${escapeHtml(request?.provider || request?.endpoint || 'Requested source')}</strong>
      <p>${escapeHtml(request?.endpoint || '')}</p>
      <div class="meta-row">
        <span>${escapeHtml(formatRequestedAtLabel(request?.requestedAt))}</span>
        <span>${escapeHtml(validationLabel)}</span>
      </div>
    </article>`;
}

export function renderSourceRequests({ state, elements }) {
  const hasSearch = Boolean(String(state.searchQuery || '').trim());
  const requests = (Array.isArray(state.sourceRequests) ? state.sourceRequests : []).filter((request) =>
    requestMatchesSearch(request, state.searchQuery)
  );

  if (elements.sourceRequestSubmit) {
    elements.sourceRequestSubmit.disabled = Boolean(state.sourceRequestSubmitting);
    elements.sourceRequestSubmit.textContent = state.sourceRequestSubmitting ? 'Adding source...' : 'Add source';
  }

  if (elements.sourceRequestHint) {
    const region = state.activeRegion === 'all' ? 'UK' : String(state.activeRegion).replace(/^./, (match) => match.toUpperCase());
    elements.sourceRequestHint.textContent = `Brialert will validate the link and queue it for the next hourly run using the current ${region} scope.`;
  }

  if (elements.sourceRequestStatus) {
    const status = state.sourceRequestStatus;
    const hasStatus = Boolean(status?.message);
    elements.sourceRequestStatus.classList.toggle('hidden', !hasStatus);
    elements.sourceRequestStatus.classList.toggle('is-error', status?.kind === 'error');
    elements.sourceRequestStatus.classList.toggle('is-success', status?.kind === 'success');
    elements.sourceRequestStatus.textContent = hasStatus ? status.message : '';
  }

  elements.sourceRequestCount.textContent = hasSearch
    ? `${requests.length} matching requests`
    : `${requests.length} requested source${requests.length === 1 ? '' : 's'}`;
  elements.sourceRequestList.innerHTML = requests.length
    ? requests.map(sourceRequestCardMarkup).join('')
    : `<p class="panel-copy">${
      hasSearch
        ? 'No results found.'
        : 'No source requests saved yet.'
    }</p>`;
}
