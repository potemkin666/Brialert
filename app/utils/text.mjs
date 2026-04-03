export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function cleanTextBlock(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\bAdvertisement\b/gi, ' ')
    .replace(/\bDid you know with a Digital Subscription.*$/i, ' ')
    .replace(/\bSign up to .*?newsletter.*$/i, ' ')
    .trim();
}

export function splitLongBriefSentences(value) {
  return cleanTextBlock(value)
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part, index, all) => all.indexOf(part) === index);
}
