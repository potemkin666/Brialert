export const LANE_ALL = 'all';
export const REGION_ALL = 'all';
export const DEFAULT_LANE = 'incidents';
export const LANE_KEYS = Object.freeze([
  'incidents',
  'context',
  'sanctions',
  'oversight',
  'border',
  'prevention'
]);

export const QUEUE_BUCKETS = Object.freeze({
  responder: 'responder',
  quarantine: 'quarantine'
});

export const MAP_VIEW_MODES = Object.freeze({
  london: 'london',
  world: 'world'
});

export const STATUS_LABELS = Object.freeze({
  update: 'Update',
  sourceUpdate: 'Source update'
});

export const SOURCE_REQUEST_STATUS_KINDS = Object.freeze({
  info: 'info',
  success: 'success',
  error: 'error'
});

export const SEVERITY_LEVELS = Object.freeze([
  'all',
  'critical',
  'high',
  'elevated',
  'moderate'
]);

export const SEVERITY_ORDER = Object.freeze({
  critical: 4,
  high: 3,
  elevated: 2,
  moderate: 1
});
