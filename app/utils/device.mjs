export function detectDeviceProfile(win = window, nav = navigator) {
  const ua = nav.userAgent || '';
  const maxTouchPoints = Number(nav.maxTouchPoints || 0);
  const touchCapable = maxTouchPoints > 0 || 'ontouchstart' in win;
  const screenWidth = Number(win.screen?.width || win.innerWidth || 0);
  const screenHeight = Number(win.screen?.height || win.innerHeight || 0);
  const shortestEdge = Math.min(screenWidth || Infinity, screenHeight || Infinity);
  const isIphoneUa = /iPhone/i.test(ua);
  const isAndroidUa = /Android/i.test(ua);
  const isIpadUa = /iPad/i.test(ua);
  const isAndroidPhone = isAndroidUa && (/Mobile/i.test(ua) || shortestEdge <= 600);
  const isIosDesktopMode =
    /Macintosh/i.test(ua) &&
    touchCapable &&
    shortestEdge <= 480;
  const isAppleTouchDevice = /AppleWebKit/i.test(ua) && !isAndroidUa && touchCapable;
  const isIosHandsetLike = isAppleTouchDevice && shortestEdge <= 430 && (isIphoneUa || isIosDesktopMode);

  if (isIphoneUa || isIosHandsetLike) return 'iphone';
  if (isIpadUa || isIosDesktopMode) return 'browser';
  if (isAndroidPhone) return 'android';
  return 'browser';
}

export function applyDeviceProfile(doc = document) {
  const profile = detectDeviceProfile();
  const root = doc.documentElement;
  doc.body.dataset.device = profile;
  root.dataset.device = profile;
  root.classList.remove('device-iphone', 'device-android', 'device-browser');
  doc.body.classList.remove('device-iphone', 'device-android', 'device-browser');
  root.classList.add(`device-${profile}`);
  doc.body.classList.add(`device-${profile}`);
  return profile;
}
