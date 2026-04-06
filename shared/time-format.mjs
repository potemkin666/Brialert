export function parseValidDate(value) {
  const stamp = value instanceof Date ? value : new Date(value || '');
  return Number.isNaN(stamp.getTime()) ? null : stamp;
}

export function formatAgeFromDate(dateLike, nowMs) {
  const stamp = parseValidDate(dateLike);
  if (!stamp) return 'age unknown';
  const effectiveNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const diffMinutes = Math.max(0, Math.round((effectiveNowMs - stamp.getTime()) / 60000));
  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const hours = Math.floor(diffMinutes / 60);
  const minutes = diffMinutes % 60;
  if (hours < 24) return minutes ? `${hours}h ${minutes}m ago` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatTimeHm(value, locale = []) {
  const stamp = parseValidDate(value);
  if (!stamp) return '';
  return stamp.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

export function formatRequestedAtLabel(value, locale = []) {
  const stamp = parseValidDate(value);
  if (!stamp) return 'Requested just now';
  return `Requested ${stamp.toLocaleString(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })}`;
}
