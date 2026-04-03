export function detectDeviceProfile() {
  const ua = navigator.userAgent || '';
  const isIphone = /iPhone/i.test(ua);
  const isAndroidPhone = /Android/i.test(ua) && /Mobile/i.test(ua);
  if (isIphone) return 'iphone';
  if (isAndroidPhone) return 'android';
  return 'desktop';
}

export function applyDeviceProfile(doc = document) {
  const profile = detectDeviceProfile();
  doc.body.dataset.device = profile;
  doc.body.classList.remove('device-iphone', 'device-android', 'device-desktop');
  doc.body.classList.add(`device-${profile}`);
  return profile;
}
