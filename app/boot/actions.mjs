import {
  INITIAL_RESPONDER_VISIBLE,
  INITIAL_SUPPORTING_VISIBLE,
  RESPONDER_LOAD_STEP,
  SUPPORTING_LOAD_STEP
} from '../state/index.mjs';

export function setActiveRegion(state, nextRegion) {
  state.activeRegion = nextRegion;
  state.feedVisibleCount = INITIAL_RESPONDER_VISIBLE;
  state.supportingVisibleCount = INITIAL_SUPPORTING_VISIBLE;
}

export function incrementResponderVisible(state) {
  state.feedVisibleCount += RESPONDER_LOAD_STEP;
}

export function incrementSupportingVisible(state) {
  state.supportingVisibleCount += SUPPORTING_LOAD_STEP;
}

export function setSearchQuery(state, nextQuery) {
  state.searchQuery = String(nextQuery || '');
}

export function toggleWatchedAlert(state, alertId) {
  if (!alertId) return;
  if (state.watched.has(alertId)) state.watched.delete(alertId);
  else state.watched.add(alertId);
}

export function setSourceRequestSubmitting(state, submitting) {
  state.sourceRequestSubmitting = Boolean(submitting);
}

export function setSourceRequestStatus(state, status) {
  state.sourceRequestStatus = status;
}

export function setMapViewMode(state, mode) {
  state.mapViewMode = mode;
}

export function setActiveTabState(state, tab) {
  state.activeTab = tab;
}
