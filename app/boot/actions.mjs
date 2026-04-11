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

export function setActiveLane(state, nextLane) {
  state.activeLane = String(nextLane || 'all');
  state.feedVisibleCount = INITIAL_RESPONDER_VISIBLE;
  state.supportingVisibleCount = INITIAL_SUPPORTING_VISIBLE;
}

export function setActiveSeverityThreshold(state, nextThreshold) {
  state.activeSeverityThreshold = String(nextThreshold || 'all');
  state.feedVisibleCount = INITIAL_RESPONDER_VISIBLE;
  state.supportingVisibleCount = INITIAL_SUPPORTING_VISIBLE;
}

export function addMutedSource(state, source) {
  const value = String(source || '').trim().toLowerCase();
  if (!value) return false;
  if (state.mutedSources.has(value)) return false;
  state.mutedSources.add(value);
  return true;
}

export function removeMutedSource(state, source) {
  const value = String(source || '').trim().toLowerCase();
  if (!value) return false;
  return state.mutedSources.delete(value);
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
