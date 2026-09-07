import assert from 'node:assert/strict';
import test from 'node:test';
import { blockedMessage, decideContributionAccess, type ContributionAccessInput } from './contribution-access';

const base: ContributionAccessInput = {
  hasBearerToken: false,
  activeAccount: null,
  blockedAccountByToken: null,
  blockedAccountByDevice: null,
};

test('faol hisob o‘z takliflariga bog‘lanadi', () => {
  const decision = decideContributionAccess({
    ...base, hasBearerToken: true, activeAccount: { id: 'user-1' },
  });
  assert.deepEqual(decision, { kind: 'account', userId: 'user-1' });
});

test('tokensiz odam mehmon bo‘ladi', () => {
  assert.deepEqual(decideContributionAccess(base), { kind: 'guest' });
});

test('bloklangan hisob token bilan yoza olmaydi', () => {
  const decision = decideContributionAccess({
    ...base, hasBearerToken: true, blockedAccountByToken: { blockedReason: 'Spam' },
  });
  assert.deepEqual(decision, { kind: 'blocked', reason: 'Spam' });
});

test('bloklangan hisob mehmonga «tushib» qolmaydi', () => {
  // Aynan shu nuqson bo'lishi mumkin edi: `optionalAppUser` bloklangan
  // hisob uchun `null` qaytaradi va tekshiruvsiz u mehmon bo'lib
  // yozishda davom etardi.
  const decision = decideContributionAccess({
    ...base, hasBearerToken: true, activeAccount: null, blockedAccountByToken: { blockedReason: null },
  });
  assert.equal(decision.kind, 'blocked');
});

test('hisobdan chiqqan bloklangan odam o‘sha qurilmada ham yoza olmaydi', () => {
  // Token yo'q — lekin qurilma bloklangan hisobniki.
  const decision = decideContributionAccess({
    ...base, hasBearerToken: false, blockedAccountByDevice: { blockedReason: 'Takroriy reklama' },
  });
  assert.deepEqual(decision, { kind: 'blocked', reason: 'Takroriy reklama' });
});

test('yaroqsiz token bloklash emas — mehmon sifatida davom etadi', () => {
  // Hisob o'chirilgan yoki token eskirgan bo'lishi mumkin. Buni
  // bloklash deb hisoblash begunoh odamni to'sib qo'yardi.
  const decision = decideContributionAccess({ ...base, hasBearerToken: true });
  assert.deepEqual(decision, { kind: 'guest' });
});

test('faol hisob qurilma tekshiruvidan ustun turadi', () => {
  // Bir qurilmada avval bloklangan hisob bo'lgan, keyin boshqa odam
  // o'z faol hisobi bilan kirgan — u yoza olishi kerak.
  const decision = decideContributionAccess({
    ...base,
    hasBearerToken: true,
    activeAccount: { id: 'user-2' },
    blockedAccountByDevice: { blockedReason: 'eski hisob' },
  });
  assert.deepEqual(decision, { kind: 'account', userId: 'user-2' });
});

test('bloklash xabari sababsiz ham bo‘sh qolmaydi', () => {
  assert.match(blockedMessage(null), /bloklangan/);
  assert.match(blockedMessage('   '), /ko‘rsatilmagan/);
  assert.match(blockedMessage('Spam'), /Spam/);
});
