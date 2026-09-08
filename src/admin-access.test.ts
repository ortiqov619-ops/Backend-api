import assert from 'node:assert/strict';
import test from 'node:test';
import { decideAdminAccess } from './admin-access';

const base = { hasBearer: true, tokenValid: true, permissions: ['requests:moderate'], required: 'requests:moderate' };

test('ruxsati bor admin o‘tadi', () => {
  assert.deepEqual(decideAdminAccess(base), { allowed: true });
});

test('token umuman yo‘q — 401', () => {
  const decision = decideAdminAccess({ ...base, hasBearer: false });
  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed === false && decision.status, 401);
});

test('MUDDATI O‘TGAN token 401 beradi, 403 emas', () => {
  // Bu aynan nosozlik edi: 403 bo'lganda mijoz tokenni yangilamasdi va
  // admin panel 15 daqiqadan keyin butunlay ishlamay qolardi.
  const decision = decideAdminAccess({ ...base, tokenValid: false });
  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed === false && decision.status, 401, 'muddati o‘tgan token 403 olyapti — mijoz uni yangilamaydi');
  assert.equal(decision.allowed === false && decision.code, 'unauthorized');
});

test('muddati o‘tgan token ruxsatlar to‘liq bo‘lsa ham 401 beradi', () => {
  // Tokenni ochib bo'lmagach, undagi ruxsatlarga ishonib bo'lmaydi.
  const decision = decideAdminAccess({ ...base, tokenValid: false, permissions: ['requests:moderate', 'words:write'] });
  assert.equal(decision.allowed === false && decision.status, 401);
});

test('haqiqiy token, lekin rol yetarli emas — 403', () => {
  // Buni yangilash hal qilmaydi, shuning uchun mijoz qayta urinmasligi kerak.
  const decision = decideAdminAccess({ ...base, permissions: ['requests:read'] });
  assert.equal(decision.allowed === false && decision.status, 403);
  assert.equal(decision.allowed === false && decision.code, 'forbidden');
});

test('bo‘sh ruxsatlar ro‘yxati 403 beradi', () => {
  assert.equal(decideAdminAccess({ ...base, permissions: [] }).allowed, false);
});
