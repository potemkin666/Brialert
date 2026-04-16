// Keep this short so the hero metric updates quickly without stalling the initial UX.
const GEOLOCATION_TIMEOUT_MS = 5000;
const GEOLOCATION_MAX_AGE_MS = 300000;
const LOCATION_CACHE_KEY = 'albertalert.userLocationLabel.v1';
// Public reverse-geocoding endpoint; treat failures/rate limits as non-fatal and fall back.
const GEOCODE_API_URL = 'https://geocode.maps.co/reverse';

function geocodeApiKey() {
  const runtimeKey = globalThis?.ALBERTALERT_GEOCODE_API_KEY;
  return typeof runtimeKey === 'string' && runtimeKey.trim() ? runtimeKey.trim() : null;
}

function titleCase(value) {
  return String(value || '')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function timezoneFallback() {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  const [, city] = zone.split('/');
  return city ? titleCase(city) : null;
}

function localeRegionFallback(nav = navigator) {
  try {
    const locale = new Intl.Locale(nav.language || 'en');
    const region = locale.region;
    if (!region) return null;
    if (typeof Intl.DisplayNames !== 'function') return region;
    const display = new Intl.DisplayNames([nav.language || 'en'], { type: 'region' });
    return display.of(region) || region;
  } catch {
    return null;
  }
}

function pickAddressLabel(address) {
  if (!address || typeof address !== 'object') return null;
  return (
    address.suburb ||
    address.town ||
    address.city ||
    address.village ||
    address.county ||
    address.state ||
    address.country ||
    null
  );
}

function loadCachedLocation(cache = globalThis?.sessionStorage) {
  try {
    const value = cache?.getItem?.(LOCATION_CACHE_KEY);
    return value || null;
  } catch {
    return null;
  }
}

function saveCachedLocation(value, cache = globalThis?.sessionStorage) {
  if (!value) return;
  try {
    cache?.setItem?.(LOCATION_CACHE_KEY, value);
  } catch {
    // ignore cache write failures
  }
}

function fallbackLabel(nav) {
  return timezoneFallback() || localeRegionFallback(nav) || null;
}

export async function detectUserLocationLabel(nav = navigator, fetchImpl = fetch, cache = globalThis?.sessionStorage) {
  const cached = loadCachedLocation(cache);
  if (cached) return cached;
  if (!nav?.geolocation || typeof fetchImpl !== 'function') {
    const fallback = fallbackLabel(nav);
    saveCachedLocation(fallback, cache);
    return fallback;
  }

  try {
    const position = await new Promise((resolve, reject) => {
      nav.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: false,
        timeout: GEOLOCATION_TIMEOUT_MS,
        maximumAge: GEOLOCATION_MAX_AGE_MS
      });
    });
    const lat = position.coords?.latitude;
    const lon = position.coords?.longitude;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      const fallback = fallbackLabel(nav);
      saveCachedLocation(fallback, cache);
      return fallback;
    }

    const key = geocodeApiKey();
    const url = new URL(GEOCODE_API_URL);
    url.searchParams.set('lat', String(lat));
    url.searchParams.set('lon', String(lon));
    if (key) url.searchParams.set('api_key', key);
    const response = await fetchImpl(url.toString(), { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      const fallback = fallbackLabel(nav);
      saveCachedLocation(fallback, cache);
      return fallback;
    }

    const payload = await response.json();
    const label = pickAddressLabel(payload?.address);
    const resolved = label || fallbackLabel(nav);
    saveCachedLocation(resolved, cache);
    return resolved;
  } catch {
    const fallback = fallbackLabel(nav);
    saveCachedLocation(fallback, cache);
    return fallback;
  }
}
