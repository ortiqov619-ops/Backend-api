import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDismissal,
  isBlockingUpdate,
  isCacheTrusted,
  isDownloadable,
  shouldPromptForUpdate,
  UPDATE_CACHE_TRUST_MS,
  UPDATE_COOLDOWN_MS,
  type UpdateCheckResponse,
} from '@xorazm/shared';

const NOW = Date.parse('2026-08-18T12:00:00.000Z');

function available(overrides: Partial<Extract<UpdateCheckResponse, { updateAvailable: true }>> = {}): UpdateCheckResponse {
  return {
    updateAvailable: true,
    current: false,
    updateType: 'OPTIONAL',
    latestVersionName: '3.2.1',
    latestVersionCode: 17,
    minimumSupportedVersionCode: 12,
    downloadUrl: 'https://example.test/user-17.apk',
    fileSize: 1_000,
    sha256: 'a'.repeat(64),
    releaseNotes: [],
    publishedAt: '2026-08-18T10:00:00.000Z',
    ...overrides,
  };
}

const none: UpdateCheckResponse = { updateAvailable: false, current: true };

test('yangilanish yo‘q — hech narsa ko‘rsatilmaydi', () => {
  assert.equal(shouldPromptForUpdate({ update: none, dismissal: null, trusted: true, now: NOW }), false);
  assert.equal(isBlockingUpdate(none, true), false);
});

test('ixtiyoriy yangilanish taklif qilinadi', () => {
  assert.equal(shouldPromptForUpdate({ update: available(), dismissal: null, trusted: true, now: NOW }), true);
});

test('tavsiya etilgan yangilanish ham taklif, ham blok emas', () => {
  const update = available({ updateType: 'RECOMMENDED' });
  assert.equal(shouldPromptForUpdate({ update, dismissal: null, trusted: true, now: NOW }), true);
  assert.equal(isBlockingUpdate(update, true), false);
});

test('majburiy yangilanish oyna emas, to‘siq bilan ko‘rsatiladi', () => {
  const update = available({ updateType: 'REQUIRED' });
  assert.equal(isBlockingUpdate(update, true), true);
  // Aks holda foydalanuvchi bir vaqtda ham to'siqni, ham oynani ko'rardi.
  assert.equal(shouldPromptForUpdate({ update, dismissal: null, trusted: true, now: NOW }), false);
});

test('ishonchsiz javob bilan ilova bloklanmaydi', () => {
  // Backend yetib bo'lmasa yoki kesh eskirgan bo'lsa, ishlab turgan ilova
  // to'satdan yopilib qolmasligi kerak.
  const update = available({ updateType: 'REQUIRED' });
  assert.equal(isBlockingUpdate(update, false), false);
});

test('kesh ishonchliligi muddat bilan cheklangan', () => {
  assert.equal(isCacheTrusted(NOW - 1_000, NOW), true);
  assert.equal(isCacheTrusted(NOW - UPDATE_CACHE_TRUST_MS + 1_000, NOW), true);
  assert.equal(isCacheTrusted(NOW - UPDATE_CACHE_TRUST_MS - 1_000, NOW), false);
  assert.equal(isCacheTrusted(null, NOW), false);
});

test('rad etilgan yangilanish muddat davomida qayta ko‘rsatilmaydi', () => {
  const update = available();
  const dismissal = buildDismissal(update, NOW);
  assert.ok(dismissal);
  assert.equal(shouldPromptForUpdate({ update, dismissal, trusted: true, now: NOW + 1_000 }), false);
  // Muddat tugagach yana ko'rsatiladi.
  assert.equal(shouldPromptForUpdate({ update, dismissal, trusted: true, now: NOW + UPDATE_COOLDOWN_MS.OPTIONAL + 1 }), true);
});

test('yangi versiya chiqsa rad etish bekor bo‘ladi', () => {
  const dismissal = buildDismissal(available(), NOW)!;
  // Foydalanuvchi 17-versiyani rad etgan, lekin 18 chiqdi.
  const newer = available({ latestVersionCode: 18, latestVersionName: '3.2.2' });
  assert.equal(shouldPromptForUpdate({ update: newer, dismissal, trusted: true, now: NOW + 1_000 }), true);
});

test('tavsiya etilgan yangilanish qisqaroq muddatga rad etiladi', () => {
  const optional = buildDismissal(available({ updateType: 'OPTIONAL' }), NOW)!;
  const recommended = buildDismissal(available({ updateType: 'RECOMMENDED' }), NOW)!;
  assert.ok(recommended.untilMs < optional.untilMs);
});

test('majburiy yangilanishni rad etib bo‘lmaydi', () => {
  assert.equal(buildDismissal(available({ updateType: 'REQUIRED' }), NOW), null);
});

test('fayl yoki checksum bo‘lmasa yuklab olish boshlanmaydi', () => {
  // Checksumsiz APK'ni tekshirib bo'lmaydi, shuning uchun u o'rnatilmaydi.
  assert.equal(isDownloadable(available()), true);
  assert.equal(isDownloadable(available({ sha256: null })), false);
  assert.equal(isDownloadable(available({ downloadUrl: null })), false);
  assert.equal(isDownloadable(none), false);
  assert.equal(isDownloadable(null), false);
});
