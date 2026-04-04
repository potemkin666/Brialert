export function detectDeviceProfile(win = window, nav = navigator) {
  const ua = nav.userAgent || '';
  const maxTouchPoints = Number(nav.maxTouchPoints || 0);
  const touchCapable = maxTouchPoints > 0 || 'ontouchstart' in win;
  const screenWidth = Number(win.screen?.width || win.innerWidth || 0);
  const screenHeight = Number(win.screen?.height || win.innerHeight || 0);
  const shortestEdge = Math.min(screenWidth || Infinity, screenHeight || Infinity);
  const isIphoneUa = /iPhone/i.test(ua);
  const isAndroidUa = /Android/i.test(ua);
  const isAndroidPhone = isAndroidUa && (/Mobile/i.test(ua) || shortestEdge <= 600);
  const isIosDesktopMode =
    /Macintosh/i.test(ua) &&
    touchCapable &&
    shortestEdge <= 480;
  const isSmallTouchApple =
    !isAndroidUa &&
    touchCapable &&
    shortestEdge <= 430;

  if (isIphoneUa || isIosDesktopMode || isSmallTouchApple) return 'iphone';
  if (isAndroidPhone) return 'android';
  return 'desktop';
}

export function applyDeviceProfile(doc = document) {
  const profile = detectDeviceProfile();
  const root = doc.documentElement;
  doc.body.dataset.device = profile;
  root.dataset.device = profile;
  root.classList.remove('device-iphone', 'device-android', 'device-desktop');
  doc.body.classList.remove('device-iphone', 'device-android', 'device-desktop');
  root.classList.add(`device-${profile}`);
  doc.body.classList.add(`device-${profile}`);
  return profile;
}
