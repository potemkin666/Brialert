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

export async function detectUserLocationLabel(nav = navigator, fetchImpl = fetch) {
  if (!nav?.geolocation || typeof fetchImpl !== 'function') {
    return timezoneFallback() || localeRegionFallback(nav) || null;
  }

  try {
    const position = await new Promise((resolve, reject) => {
      nav.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: false,
        timeout: 5000,
        maximumAge: 300000
      });
    });
    const lat = position.coords?.latitude;
    const lon = position.coords?.longitude;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return timezoneFallback() || localeRegionFallback(nav) || null;
    }

    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&zoom=10&addressdetails=1`;
    const response = await fetchImpl(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      return timezoneFallback() || localeRegionFallback(nav) || null;
    }

    const payload = await response.json();
    const label = pickAddressLabel(payload?.address);
    return label || timezoneFallback() || localeRegionFallback(nav) || null;
  } catch {
    return timezoneFallback() || localeRegionFallback(nav) || null;
  }
}
