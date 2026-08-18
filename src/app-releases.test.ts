import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decideUpdate,
  effectiveUpdateType,
  parseReleaseInput,
  ReleaseValidationError,
  updateNotificationText,
  updateTopic,
  type ReleaseView,
} from './app-releases';

function release(overrides: Partial<ReleaseView> = {}): ReleaseView {
  return {
    versionName: '1.2.4',
    versionCode: 24,
    minimumSupportedVersionCode: 20,
    updateType: 'RECOMMENDED',
    downloadUrl: 'https://example.test/app.apk',
    fileSize: 18_492_123,
    sha256: 'a'.repeat(64),
    releaseNotes: ['UI yaxshilandi'],
    publishedAt: '2026-08-17T10:00:00.000Z',
    ...overrides,
  };
}

test('reliz yo‘q bo‘lsa ilova hech qachon eskirgan deb belgilanmaydi', () => {
  // Bo'sh jadval butun foydalanuvchi bazasini bloklab qo'ymasligi kerak.
  const decision = decideUpdate(1, null);
  assert.equal(decision.updateAvailable, false);
  assert.equal(decision.current, true);
});

test('eng yangi versiyada yangilanish taklif qilinmaydi', () => {
  const decision = decideUpdate(24, release());
  assert.equal(decision.updateAvailable, false);
});

test('backenddan yangiroq versiya (staging build) yangilanish so‘ramaydi', () => {
  // Sinov qurilmasida odatda productiondan yuqori versionCode turadi.
  const decision = decideUpdate(99, release());
  assert.equal(decision.updateAvailable, false);
  assert.equal(decision.current, true);
});

test('eski versiyaga relizning o‘z darajasi beriladi', () => {
  const decision = decideUpdate(23, release({ updateType: 'OPTIONAL' }));
  assert.equal(decision.updateAvailable, true);
  assert.equal(decision.updateAvailable && decision.updateType, 'OPTIONAL');
});

test('qo‘llab-quvvatlanmaydigan versiya majburiy yangilanadi', () => {
  // Reliz "ixtiyoriy" bo'lsa ham, minimumdan past versiya bloklanadi.
  const decision = decideUpdate(19, release({ updateType: 'OPTIONAL', minimumSupportedVersionCode: 20 }));
  assert.equal(decision.updateAvailable && decision.updateType, 'REQUIRED');
});

test('minimum chegarasidagi versiya majburiy emas', () => {
  assert.equal(effectiveUpdateType(20, release({ updateType: 'OPTIONAL' })), 'OPTIONAL');
  assert.equal(effectiveUpdateType(19, release({ updateType: 'OPTIONAL' })), 'REQUIRED');
});

test('reliz REQUIRED bo‘lsa minimumdan yuqori versiya ham majburiy', () => {
  const decision = decideUpdate(23, release({ updateType: 'REQUIRED', minimumSupportedVersionCode: 0 }));
  assert.equal(decision.updateAvailable && decision.updateType, 'REQUIRED');
});

test('versionName matn sifatida solishtirilmaydi', () => {
  // "1.10" matn bo'yicha "1.9" dan kichik ko'rinadi; versionCode bunday
  // xatoga yo'l qo'ymaydi.
  const decision = decideUpdate(19, release({ versionName: '1.9', versionCode: 24 }));
  assert.equal(decision.updateAvailable, true);
  const same = decideUpdate(24, release({ versionName: '1.10', versionCode: 24 }));
  assert.equal(same.updateAvailable, false);
});

test('noto‘g‘ri o‘rnatilgan versiya ilovani bloklamaydi', () => {
  assert.equal(decideUpdate(Number.NaN, release()).updateAvailable, false);
});

test('USER va ADMIN mavzulari hech qachon aralashmaydi', () => {
  assert.equal(updateTopic('USER', 'ANDROID'), 'xorazim-user-android');
  assert.equal(updateTopic('ADMIN', 'ANDROID'), 'xorazim-admin-android');
  assert.equal(updateTopic('USER', 'IOS'), 'xorazim-user-ios');
  assert.notEqual(updateTopic('USER', 'ANDROID'), updateTopic('ADMIN', 'ANDROID'));
});

test('push matni ilova turiga mos keladi', () => {
  assert.match(updateNotificationText('USER', '1.2.4').body, /1\.2\.4/);
  assert.match(updateNotificationText('ADMIN', '1.0.8').title, /Admin/);
  assert.doesNotMatch(updateNotificationText('USER', '1.2.4').title, /Admin/);
});

/* ------------------------------ parse ------------------------------ */

test('to‘g‘ri reliz qabul qilinadi', () => {
  const parsed = parseReleaseInput({
    appType: 'user',
    platform: 'android',
    versionName: '1.2.4',
    versionCode: 24,
    minimumSupportedVersionCode: 20,
    updateType: 'recommended',
    downloadUrl: 'https://example.test/a.apk',
    fileSize: 100,
    sha256: 'B'.repeat(64),
    releaseNotes: ['bir', '  ', 'ikki'],
  }, { requireArtifact: true });

  assert.equal(parsed.appType, 'USER');
  assert.equal(parsed.platform, 'ANDROID');
  assert.equal(parsed.updateType, 'RECOMMENDED');
  assert.equal(parsed.sha256, 'b'.repeat(64));
  // Bo'sh izohlar tashlab yuboriladi.
  assert.deepEqual(parsed.releaseNotes, ['bir', 'ikki']);
});

test('noto‘g‘ri appType rad etiladi', () => {
  assert.throws(() => parseReleaseInput({ appType: 'SUPERADMIN', versionName: '1', versionCode: 1 }), ReleaseValidationError);
});

test('versionCode musbat butun son bo‘lishi shart', () => {
  for (const versionCode of [0, -3, 1.5, 'abc', null]) {
    assert.throws(
      () => parseReleaseInput({ appType: 'USER', versionName: '1.0.0', versionCode }),
      ReleaseValidationError,
      `qiymat: ${JSON.stringify(versionCode)}`,
    );
  }
});

test('minimum versionCode dan katta bo‘la olmaydi', () => {
  // Aks holda eng yangi reliz ham "qo'llab-quvvatlanmaydi" bo'lib qolardi.
  assert.throws(
    () => parseReleaseInput({ appType: 'USER', versionName: '1.0.0', versionCode: 10, minimumSupportedVersionCode: 11 }),
    ReleaseValidationError,
  );
});

test('HTTPS bo‘lmagan yuklab olish manzili rad etiladi', () => {
  assert.throws(
    () => parseReleaseInput({ appType: 'USER', versionName: '1.0.0', versionCode: 1, downloadUrl: 'http://example.test/a.apk' }),
    ReleaseValidationError,
  );
});

test('noto‘g‘ri sha256 rad etiladi', () => {
  assert.throws(
    () => parseReleaseInput({ appType: 'USER', versionName: '1.0.0', versionCode: 1, sha256: 'qisqa' }),
    ReleaseValidationError,
  );
});

test('Android relizi checksumsiz nashr qilinmaydi', () => {
  assert.throws(
    () => parseReleaseInput({ appType: 'USER', platform: 'ANDROID', versionName: '1.0.0', versionCode: 1 }, { requireArtifact: true }),
    ReleaseValidationError,
  );
  // iOS uchun APK yo'q, shuning uchun checksum ham talab qilinmaydi.
  assert.doesNotThrow(
    () => parseReleaseInput({ appType: 'USER', platform: 'IOS', versionName: '1.0.0', versionCode: 1 }, { requireArtifact: true }),
  );
});
