import assert from 'node:assert/strict';
import test from 'node:test';
import { INTRO_COOLDOWN_MS, parseIntroTimestamp, shouldShowIntro } from '@xorazm/shared';

const NOW = 1_800_000_000_000;

test('hisobga kirgan foydalanuvchi tanishuvni ko‘rmaydi', () => {
  // Talab: ro'yxatdan o'tgan foydalanuvchi markazdagi logo bilan
  // to'g'ridan-to'g'ri lug'atga tushadi.
  assert.equal(shouldShowIntro({ hasAccount: true, lastShownAtMs: null, nowMs: NOW }), false);
  assert.equal(shouldShowIntro({ hasAccount: true, lastShownAtMs: NOW - 10 * INTRO_COOLDOWN_MS, nowMs: NOW }), false);
});

test('mehmon birinchi ochishda tanishuvni ko‘radi', () => {
  assert.equal(shouldShowIntro({ hasAccount: false, lastShownAtMs: null, nowMs: NOW }), true);
});

test('mehmon uchun tanishuv keyingi ochishda qaytadi', () => {
  assert.equal(shouldShowIntro({ hasAccount: false, lastShownAtMs: NOW - INTRO_COOLDOWN_MS, nowMs: NOW }), true);
  assert.equal(shouldShowIntro({ hasAccount: false, lastShownAtMs: NOW - 10 * 60_000, nowMs: NOW }), true);
});

test('qisqa vaqtdagi qayta ochilish tanishuvni takrorlamaydi', () => {
  // Ilova fondan qaytganda yoki tizim uni qayta ishga tushirganda
  // ekran qayta chiqsa, u tanishuv emas — halaqit bo'lardi.
  assert.equal(shouldShowIntro({ hasAccount: false, lastShownAtMs: NOW - 1_000, nowMs: NOW }), false);
  assert.equal(shouldShowIntro({ hasAccount: false, lastShownAtMs: NOW, nowMs: NOW }), false);
});

test('buzilgan yoki kelajakdagi vaqt tanishuvni abadiy yo‘qotmaydi', () => {
  // Qurilma soati orqaga surilsa saqlangan vaqt «kelajak» bo'lib qoladi.
  assert.equal(shouldShowIntro({ hasAccount: false, lastShownAtMs: NOW + 5 * 60_000, nowMs: NOW }), true);
  assert.equal(shouldShowIntro({ hasAccount: false, lastShownAtMs: Number.NaN, nowMs: NOW }), true);
});

test('maxsus cooldown qiymati hurmat qilinadi', () => {
  assert.equal(shouldShowIntro({ hasAccount: false, lastShownAtMs: NOW - 5_000, nowMs: NOW, cooldownMs: 1_000 }), true);
  assert.equal(shouldShowIntro({ hasAccount: false, lastShownAtMs: NOW - 500, nowMs: NOW, cooldownMs: 1_000 }), false);
});

test('saqlangan xom qiymat xavfsiz o‘qiladi', () => {
  assert.equal(parseIntroTimestamp(String(NOW)), NOW);
  assert.equal(parseIntroTimestamp(null), null);
  assert.equal(parseIntroTimestamp(undefined), null);
  assert.equal(parseIntroTimestamp(''), null);
  assert.equal(parseIntroTimestamp('buzilgan'), null);
});
