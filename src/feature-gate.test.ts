import assert from 'node:assert/strict';
import test from 'node:test';
import { appFeaturesFrom, isIntegrationLive, SUPPORTED_INTEGRATIONS } from './feature-gate';

const live = { provider: 'stt_primary', isEnabled: true, hasSecret: true, health: 'ok' };

test('to‘liq sozlangan integratsiya ilovada ko‘rinadi', () => {
  assert.equal(isIntegrationLive(live), true);
  assert.equal(appFeaturesFrom([live]).transcription, true);
});

test('o‘chirilgan integratsiya ilovada ko‘rinmaydi', () => {
  assert.equal(isIntegrationLive({ ...live, isEnabled: false }), false);
  assert.equal(appFeaturesFrom([{ ...live, isEnabled: false }]).transcription, false);
});

test('kalitsiz yoqilgan integratsiya ham ko‘rinmaydi', () => {
  // Kalitsiz integratsiya so'rov yuborsa albatta xato qaytadi —
  // foydalanuvchi mikrofon tugmasini bosib 30 soniya kutib qolardi.
  assert.equal(isIntegrationLive({ ...live, hasSecret: false }), false);
});

test('sog‘liq tekshiruvi yiqilgan integratsiya yashiriladi', () => {
  assert.equal(isIntegrationLive({ ...live, health: 'failing' }), false);
  assert.equal(isIntegrationLive({ ...live, health: 'not_configured' }), false);
});

test('hali tekshirilmagan yoki sekin ishlayotgan integratsiya ko‘rinaveradi', () => {
  // `unknown` — hech qachon tekshirilmagan; kalit bor va yoqilgan.
  // Bunday holatda imkoniyatni yashirish uni umuman ishga
  // tushirmaslik bilan barobar bo'lardi.
  assert.equal(isIntegrationLive({ ...live, health: 'unknown' }), true);
  assert.equal(isIntegrationLive({ ...live, health: 'degraded' }), true);
});

test('serverda mijozi yo‘q provider hech qachon ko‘rinmaydi', () => {
  // Kalit saqlangan bo‘lsa ham: kod hali yozilmagan.
  for (const provider of ['push_notifications', 'dialect_model', 'moderation_ai', 'object_storage']) {
    assert.equal(isIntegrationLive({ ...live, provider }), false, provider);
  }
  const features = appFeaturesFrom([
    { provider: 'push_notifications', isEnabled: true, hasSecret: true, health: 'ok' },
    { provider: 'dialect_model', isEnabled: true, hasSecret: true, health: 'ok' },
  ]);
  assert.equal(features.pushNotifications, false);
  assert.equal(features.dialectScoring, false);
});

test('ro‘yxat bo‘sh bo‘lsa hamma imkoniyat yopiq', () => {
  assert.deepEqual(appFeaturesFrom([]), {
    transcription: false,
    pushNotifications: false,
    dialectScoring: false,
  });
});

test('qo‘llab-quvvatlanadigan providerlar ro‘yxati ataylab qisqa', () => {
  assert.deepEqual([...SUPPORTED_INTEGRATIONS], ['stt_primary']);
});
