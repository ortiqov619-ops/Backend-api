import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * Integratsiya kalitlari oqimining isboti — haqiqiy provider kaliti kerak
 * emas.
 *
 * `security.ts` konfiguratsiyani import vaqtida o'qiydi, shuning uchun modul
 * env to'ldirilgandan keyin dinamik yuklanadi. Top-level `await` ishlatilmaydi:
 * `tsx` bu paketni CommonJS sifatida bajaradi.
 */
process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:5432/test';
process.env.ADMIN_JWT_SECRET ??= 'test-jwt-secret-test-jwt-secret-1234567890';
process.env.INTEGRATION_MASTER_KEY ??= 'test-master-key-test-master-key-0987654321';

type Security = typeof import('./security');
let cached: Promise<Security> | null = null;
const loadSecurity = (): Promise<Security> => (cached ??= import('./security'));

const FAKE_KEY = 'gsk_soxta_kalit_faqat_test_uchun_7f2a';

test('a stored secret can be recovered byte for byte', async () => {
  const security = await loadSecurity();
  const encrypted = security.encryptSecret(FAKE_KEY);
  assert.equal(security.decryptSecret(encrypted.ciphertext, encrypted.nonce), FAKE_KEY);
});

test('the same secret never produces the same ciphertext twice', async () => {
  const security = await loadSecurity();
  const first = security.encryptSecret(FAKE_KEY);
  const second = security.encryptSecret(FAKE_KEY);
  assert.notEqual(first.ciphertext.toString('hex'), second.ciphertext.toString('hex'));
  assert.notEqual(first.nonce.toString('hex'), second.nonce.toString('hex'));
  // Fingerprint esa barqaror: kalitni ochmasdan «bu o'sha kalitmi?» deyish uchun.
  assert.equal(first.fingerprint, second.fingerprint);
});

test('the panel hint exposes only the last four characters', async () => {
  const security = await loadSecurity();
  const { maskedHint } = security.encryptSecret(FAKE_KEY);
  assert.equal(maskedHint, '••••7f2a');
  assert.equal(maskedHint.includes('gsk_'), false);
  assert.equal(maskedHint.replace(/•/g, '').length, 4);
});

test('the fingerprint is a one way hash, not the key itself', async () => {
  const security = await loadSecurity();
  const { fingerprint } = security.encryptSecret(FAKE_KEY);
  assert.match(fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(fingerprint.includes(FAKE_KEY), false);
});

test('a tampered ciphertext is rejected instead of returning garbage', async () => {
  const security = await loadSecurity();
  const encrypted = security.encryptSecret(FAKE_KEY);
  const tampered = Buffer.from(encrypted.ciphertext);
  tampered[0] = (tampered[0] ?? 0) ^ 0xff;
  assert.throws(() => security.decryptSecret(tampered, encrypted.nonce));
});

test('audio playback tokens are bound to a single audio id', async () => {
  const security = await loadSecurity();
  const signed = await security.signAudioPlaybackToken('audio-1');
  await assert.doesNotReject(() => security.verifyAudioPlaybackToken(signed.token, 'audio-1'));
  await assert.rejects(() => security.verifyAudioPlaybackToken(signed.token, 'audio-2'));
});

test('an access token cannot be reused as a playback token', async () => {
  const security = await loadSecurity();
  const access = await security.signAccessToken({ sub: 'user-1', roles: ['admin'], permissions: ['audio:read'] });
  await assert.rejects(() => security.verifyAudioPlaybackToken(access.token, 'user-1'));
});

test('ilova foydalanuvchisining tokeni admin tokeni sifatida ishlamaydi', async () => {
  const security = await loadSecurity();
  const app = await security.signAppUserToken('app-user-1');
  // Barcha tokenlar bitta kalit bilan imzolanadi, shuning uchun imzo
  // tekshiruvining o'zi yetarli emas: `verifyAccessToken` auditoriyasi bor
  // tokenni rad etishi kerak, aks holda oddiy foydalanuvchi o'z tokeni bilan
  // admin so'rovlarini yubora olardi.
  await assert.rejects(() => security.verifyAccessToken(app.token));
  await assert.rejects(() => security.verifyAudioPlaybackToken(app.token, 'app-user-1'));
  const claims = await security.verifyAppUserToken(app.token);
  assert.equal(claims.sub, 'app-user-1');
});

test('admin va audio tokenlari ilova tokeni sifatida ishlamaydi', async () => {
  const security = await loadSecurity();
  const admin = await security.signAccessToken({ sub: 'staff-1', roles: ['admin'], permissions: ['words:write'] });
  const playback = await security.signAudioPlaybackToken('audio-1');
  await assert.rejects(() => security.verifyAppUserToken(admin.token));
  await assert.rejects(() => security.verifyAppUserToken(playback.token));
});
