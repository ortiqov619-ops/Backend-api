import assert from 'node:assert/strict';
import test from 'node:test';
import { GUEST_DISPLAY_PATTERN, guestDisplayName, submitterDisplayName } from './guest-identity';

test('mehmon yorlig‘i «Mehmon A1» shaklida bo‘ladi', () => {
  const label = guestDisplayName('installation-abc');
  assert.match(label, GUEST_DISPLAY_PATTERN);
  assert.ok(label.startsWith('Mehmon '));
});

test('bir xil qurilma har doim bir xil yorliq oladi', () => {
  const first = guestDisplayName('device-42');
  const second = guestDisplayName('device-42');
  assert.equal(first, second);
});

test('turli qurilmalar turli chelaklarga tushadi', () => {
  const labels = new Set(Array.from({ length: 200 }, (_, index) => guestDisplayName(`device-${index}`)));
  // To'qnashuv mumkin, lekin 200 ta qurilma bitta yorliqqa tushishi
  // yorliqni foydasiz qilardi.
  assert.ok(labels.size > 150, `kutilgan tarqoqlik yo‘q: ${labels.size}`);
});

test('yorliq qurilma identifikatorini oshkor qilmaydi', () => {
  const installationId = 'a7f3-secret-installation-id';
  assert.ok(!guestDisplayName(installationId).includes(installationId));
  assert.ok(!guestDisplayName(installationId).includes('secret'));
});

test('identifikator bo‘sh bo‘lsa ham nom bo‘sh qolmaydi', () => {
  assert.equal(guestDisplayName(''), 'Mehmon');
  assert.equal(guestDisplayName(null), 'Mehmon');
  assert.equal(guestDisplayName(undefined), 'Mehmon');
});

test('hisob bo‘lsa uning ko‘rsatiladigan nomi ishlatiladi', () => {
  assert.equal(submitterDisplayName({ display_name: 'Bobur', full_name: 'Bobur S.' }, 'device-1'), 'Bobur');
  assert.equal(submitterDisplayName({ full_name: 'Bobur S.' }, 'device-1'), 'Bobur S.');
});

test('hisob bo‘lmasa mehmon yorlig‘i qaytadi', () => {
  assert.match(submitterDisplayName(null, 'device-1'), GUEST_DISPLAY_PATTERN);
});

test('nomsiz hisob ham anonim yorliq oladi, bo‘sh nom emas', () => {
  assert.match(submitterDisplayName({ display_name: '  ', full_name: null }, 'device-1'), GUEST_DISPLAY_PATTERN);
});
