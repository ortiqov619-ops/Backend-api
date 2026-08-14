import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isTooSimplePattern,
  lockStateFor,
  normalizeDisplayName,
  normalizePattern,
  normalizeUsername,
  PATTERN_MAX_ATTEMPTS,
  PatternValidationError,
  remainingLockMs,
} from './pattern-auth';

test('naqsh kanonik matnga aylanadi va bir xil chizilgani bir xil natija beradi', () => {
  assert.equal(normalizePattern([0, 3, 6, 7]), '0-3-6-7');
  assert.equal(normalizePattern([0, 3, 6, 7]), normalizePattern([0, 3, 6, 7]));
  // Tartib muhim: teskari chizilgan naqsh boshqa naqsh.
  assert.notEqual(normalizePattern([0, 3, 6, 7]), normalizePattern([7, 6, 3, 0]));
});

test('juda qisqa yoki juda uzun naqsh rad etiladi', () => {
  assert.throws(() => normalizePattern([0, 1, 2]), PatternValidationError);
  assert.throws(() => normalizePattern([0, 1, 2, 3, 4, 5, 6, 7, 8, 0]), PatternValidationError);
});

test('takrorlangan nuqta rad etiladi', () => {
  assert.throws(() => normalizePattern([0, 1, 2, 0]), (error: PatternValidationError) => error.field === 'pattern');
});

test('to‘r chegarasidan tashqari va butun bo‘lmagan qiymatlar rad etiladi', () => {
  for (const bad of [[0, 1, 2, 9], [0, 1, 2, -1], [0, 1, 2, 3.5], [0, 1, 2, '3']]) {
    assert.throws(() => normalizePattern(bad), PatternValidationError, `qabul qilinmasligi kerak: ${JSON.stringify(bad)}`);
  }
});

test('ro‘yxat bo‘lmagan qiymat rad etiladi', () => {
  assert.throws(() => normalizePattern('0-1-2-3'), PatternValidationError);
  assert.throws(() => normalizePattern(null), PatternValidationError);
});

test('eng ko‘p uchraydigan naqshlar juda oson deb belgilanadi', () => {
  assert.equal(isTooSimplePattern('0-1-2-3'), true, 'ketma-ket o‘suvchi');
  assert.equal(isTooSimplePattern('8-7-6-5'), true, 'ketma-ket kamayuvchi');
  assert.equal(isTooSimplePattern('0-3-6-7-8'), false, 'burchakli naqsh qabul qilinadi');
  assert.equal(isTooSimplePattern('1-3-5-7'), false);
});

test('foydalanuvchi nomi kichik harfga keltiriladi va cheklovlar tekshiriladi', () => {
  assert.equal(normalizeUsername('  Dilnoza_X '), 'dilnoza_x');
  assert.throws(() => normalizeUsername('ab'), (error: PatternValidationError) => error.field === 'username');
  assert.throws(() => normalizeUsername('9dilnoza'), PatternValidationError, 'harf bilan boshlanishi kerak');
  assert.throws(() => normalizeUsername('dil noza'), PatternValidationError, 'bo‘sh joy bo‘lmasin');
  assert.throws(() => normalizeUsername('dilnozaʼ'), PatternValidationError, 'lotin bo‘lmagan belgi');
});

test('ism bo‘sh bo‘lsa foydalanuvchi nomi ishlatiladi', () => {
  assert.equal(normalizeDisplayName('', 'dilnoza'), 'dilnoza');
  assert.equal(normalizeDisplayName('  Dilnoza   Rahimova ', 'dilnoza'), 'Dilnoza Rahimova');
  assert.throws(() => normalizeDisplayName('x'.repeat(41), 'dilnoza'), PatternValidationError);
});

test('urinishlar tugagach hisob qulflanadi', () => {
  const now = new Date('2026-08-14T10:00:00.000Z');
  assert.equal(lockStateFor(PATTERN_MAX_ATTEMPTS - 1, now).locked, false);
  const locked = lockStateFor(PATTERN_MAX_ATTEMPTS, now);
  assert.equal(locked.locked, true);
  assert.equal(locked.until?.toISOString(), '2026-08-14T10:15:00.000Z');
});

test('qulf muddati o‘tgach qoldiq nolga tushadi', () => {
  const now = new Date('2026-08-14T10:20:00.000Z');
  assert.equal(remainingLockMs('2026-08-14T10:15:00.000Z', now), 0);
  assert.equal(remainingLockMs('2026-08-14T10:25:00.000Z', now), 5 * 60_000);
  assert.equal(remainingLockMs(null, now), 0);
});
