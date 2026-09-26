import { describe, expect, it } from 'vitest';
import { appleSupportsWebPush, detectPlatform, guideFor } from './install';

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  iphoneSafari163: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0.7204.119 Mobile/15E148 Safari/604.1',
  ipadDesktopMode: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  instagramIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 390.0.0.28.85 (iPhone15,3; iOS 18_5; en_GB; en-GB; scale=3.00; 1290x2796; 123456789)',
  androidChrome: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
  androidFirefox: 'Mozilla/5.0 (Android 14; Mobile; rv:141.0) Gecko/141.0 Firefox/141.0',
  facebookAndroid:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/127.0.6533.103 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/477.0.0.49.82;]',
  tiktok: 'Mozilla/5.0 (Linux; Android 13; SM-A536B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0 Mobile Safari/537.36 musical_ly_2023508030 BytedanceWebview/d8a21c6',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  windowsEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0',
  windowsFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:141.0) Gecko/20100101 Firefox/141.0',
};

describe('platform hints for install instructions', () => {
  it.each([
    [UA.iphoneSafari, 0, 'ios-safari'],
    [UA.iphoneChrome, 5, 'ios-other'],
    [UA.ipadDesktopMode, 5, 'ipados-safari'], // iPadOS reports a Mac unless you look at touch support
    [UA.ipadDesktopMode, 0, 'mac-safari'],
    [UA.macSafari, 0, 'mac-safari'],
    [UA.instagramIos, 5, 'in-app'],
    [UA.androidChrome, 5, 'android-chrome'],
    [UA.samsung, 5, 'android-samsung'],
    [UA.androidFirefox, 5, 'android-firefox'],
    [UA.facebookAndroid, 5, 'in-app'],
    [UA.tiktok, 5, 'in-app'],
    [UA.macChrome, 0, 'desktop-chrome'],
    [UA.windowsEdge, 0, 'desktop-edge'],
    [UA.windowsFirefox, 0, 'desktop-firefox'],
    ['curl/8.0', 0, 'other'],
  ])('%s (touch points %i) → %s', (userAgent, maxTouchPoints, guide) => {
    expect(guideFor(detectPlatform({ userAgent, maxTouchPoints }))).toBe(guide);
  });

  it('knows which Apple devices can get web push (iOS/iPadOS 16.4+, from the Home Screen)', () => {
    expect(detectPlatform({ userAgent: UA.iphoneSafari }).appleVersion).toBe(18.05);
    expect(appleSupportsWebPush(detectPlatform({ userAgent: UA.iphoneSafari }))).toBe(true);
    expect(appleSupportsWebPush(detectPlatform({ userAgent: UA.iphoneSafari163 }))).toBe(false);
    expect(appleSupportsWebPush(detectPlatform({ userAgent: UA.ipadDesktopMode, maxTouchPoints: 5 }))).toBe(true);
    expect(appleSupportsWebPush(detectPlatform({ userAgent: UA.macSafari }))).toBe(false); // not a phone or tablet
  });
});
