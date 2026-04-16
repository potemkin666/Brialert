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
  world: 'world',
  nearby: 'nearby'
});

export const NEARBY_RADIUS_KM = 150;

const MAP_MODE_VALUES = new Set(Object.values(MAP_VIEW_MODES));
export function resolveMapMode(value) {
  return MAP_MODE_VALUES.has(value) ? value : MAP_VIEW_MODES.london;
}

export const STATUS_LABELS = Object.freeze({
  update: 'Update',
  sourceUpdate: 'Source update'
});

export const SOURCE_REQUEST_STATUS_KINDS = Object.freeze({
  info: 'info',
  success: 'success',
  error: 'error'
});
