import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateApplicationApiKey,
  hashApplicationApiKey,
  knownApplicationApiKeyScopes,
  LAST_USED_THROTTLE_MINUTES,
  matchesApplicationApiKey,
  parseApplicationApiKey,
  parseApplicationApiKeyScopes,
} from './application-api-keys';
import { APPLICATION_API_KEY_SCOPES, ROLE_PERMISSIONS } from '@xorazm/shared';

test('application API key has a parseable public id and only a hash is persisted', () => {
  const generated = generateApplicationApiKey();
  assert.match(generated.token, /^xsk_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(parseApplicationApiKey(generated.token), { publicId: generated.publicId });
  assert.equal(matchesApplicationApiKey(generated.token, generated.secretHash), true);
  assert.equal(generated.secretHash.includes(generated.token), false);
  assert.equal(generated.maskedHint.includes(generated.token), false);
});

test('malformed and modified API keys are rejected', () => {
  const generated = generateApplicationApiKey();
  assert.equal(parseApplicationApiKey('xsk_short_secret'), null);
  assert.equal(parseApplicationApiKey(`Bearer ${generated.token}`), null);
  assert.equal(matchesApplicationApiKey(`${generated.token}x`, generated.secretHash), false);
  assert.equal(matchesApplicationApiKey(generated.token, 'not-a-hash'), false);
});

test('scope parser deduplicates allow-listed scopes and rejects privileges not implemented', () => {
  assert.deepEqual(parseApplicationApiKeyScopes(['dictionary:read', 'dictionary:read', 'content:read']), [
    'dictionary:read',
    'content:read',
  ]);
  assert.throws(() => parseApplicationApiKeyScopes([]));
  assert.throws(() => parseApplicationApiKeyScopes(['dictionary:write']));
});

// ---------------------------------------------------------------------------
// Secret xavfsizligi
// ---------------------------------------------------------------------------

test('har bir kalit takrorlanmas va yuqori entropiyali', () => {
  const tokens = new Set(Array.from({ length: 200 }, () => generateApplicationApiKey().token));
  assert.equal(tokens.size, 200, 'takrorlangan kalit chiqdi');
});

test('hash bir tomonlama va kalit matnini o‘z ichiga olmaydi', () => {
  const generated = generateApplicationApiKey();
  assert.match(generated.secretHash, /^[0-9a-f]{64}$/);
  assert.equal(generated.secretHash, hashApplicationApiKey(generated.token));
  // Hashdan kalitning birorta bo'lagi ham topilmasligi kerak.
  // `split('_')` ishlatilmaydi: base64url ichida ham `_` uchraydi.
  const secretPart = /^xsk_.{12}_(.{43})$/.exec(generated.token)![1]!;
  assert.equal(generated.secretHash.includes(secretPart), false);
  assert.equal(generated.secretHash.includes(generated.publicId), false);
});

test('maskalangan hint faqat oxirgi 4 belgini ochadi', () => {
  const generated = generateApplicationApiKey();
  const secretPart = /^xsk_.{12}_(.{43})$/.exec(generated.token)![1]!;
  assert.ok(generated.maskedHint.endsWith(secretPart.slice(-4)), generated.maskedHint);
  // Qolgan 39 belgi ko'rinmasligi kerak.
  assert.equal(generated.maskedHint.includes(secretPart.slice(0, -4)), false);
  assert.ok(generated.maskedHint.length < generated.token.length);
});

test('boshqa kalitning hashi qabul qilinmaydi', () => {
  const a = generateApplicationApiKey();
  const b = generateApplicationApiKey();
  assert.equal(matchesApplicationApiKey(a.token, b.secretHash), false);
  assert.equal(matchesApplicationApiKey(b.token, a.secretHash), false);
});

test('bo‘sh va shaklsiz kirish yiqilmaydi', () => {
  for (const bad of ['', '   ', 'xsk_', 'xsk__', 'random', 'xsk_aaaaaaaaaaaa_short']) {
    assert.equal(parseApplicationApiKey(bad), null, bad);
    assert.equal(matchesApplicationApiKey(bad, hashApplicationApiKey('x')), false, bad);
  }
});

// ---------------------------------------------------------------------------
// Scope siyosati
// ---------------------------------------------------------------------------

test('tashqi scope‘lar FAQAT o‘qish uchun', () => {
  // Bu strukturaviy kafolat: yozish scope'i umuman mavjud emas,
  // shuning uchun kalit hech qachon yozuv huquqini ola olmaydi.
  for (const scope of APPLICATION_API_KEY_SCOPES) {
    assert.ok(scope.endsWith(':read'), `yozish scope'i paydo bo‘ldi: ${scope}`);
  }
});

test('imtiyozli scope‘lar rad etiladi', () => {
  for (const forbidden of ['users:delete', 'integrations:manage', 'dictionary:write', 'words:write', 'api_keys:write']) {
    assert.throws(() => parseApplicationApiKeyScopes([forbidden]), /noto‘g‘ri/, forbidden);
  }
});

test('bazadagi noma’lum scope autentifikatsiyani yiqitmaydi', () => {
  // Kelajakda scope ro'yxatdan olib tashlansa, eski kalit har so'rovda
  // 500 bermasligi kerak — u shunchaki o'sha ruxsatni yo'qotadi.
  assert.deepEqual(knownApplicationApiKeyScopes(['dictionary:read', 'olib_tashlangan:read']), ['dictionary:read']);
  assert.deepEqual(knownApplicationApiKeyScopes(['butunlay:nomalum']), []);
  assert.deepEqual(knownApplicationApiKeyScopes(null), []);
  assert.deepEqual(knownApplicationApiKeyScopes('dictionary:read'), []);
});

test('scope A scope B ga kirish bermaydi', () => {
  const scopes = knownApplicationApiKeyScopes(['dictionary:read']);
  assert.ok(scopes.includes('dictionary:read'));
  assert.ok(!scopes.includes('content:read'));
  assert.ok(!scopes.includes('diagnostics:read'));
});

// ---------------------------------------------------------------------------
// RBAC
// ---------------------------------------------------------------------------

test('API kalitlarini faqat administrator boshqaradi', () => {
  assert.ok(ROLE_PERMISSIONS.admin.includes('api_keys:read'));
  assert.ok(ROLE_PERMISSIONS.admin.includes('api_keys:write'));
  for (const role of ['moderator', 'editor'] as const) {
    assert.ok(!ROLE_PERMISSIONS[role].includes('api_keys:read'), `${role} metadatani ko‘rmasligi kerak`);
    assert.ok(!ROLE_PERMISSIONS[role].includes('api_keys:write'), `${role} kalit yarata olmasligi kerak`);
  }
});

test('last-used yozuvi cheklangan', () => {
  // Har so'rovda UPDATE yozish Render bepul tarifida keraksiz yuk.
  assert.ok(LAST_USED_THROTTLE_MINUTES >= 1);
});
