import assert from 'node:assert/strict';
import test from 'node:test';
import { iso, requiredIso, toDate } from './timestamps';

test('Date obyekti millisekundlarini yo‘qotmaydi', () => {
  const value = new Date('2026-08-17T13:21:41.992Z');
  assert.equal(requiredIso(value), '2026-08-17T13:21:41.992Z');
});

test('bir soniya ichidagi ikki lahza farqlanadi', () => {
  // Aynan shu holat optimistik qulfni buzgan edi: `String(date)` ikkalasini
  // ham "…41.000Z" ga aylantirar va ikkinchi moderator `409` olmasdan
  // birinchisining qarorini qayta yozardi.
  const earlier = new Date('2026-08-17T13:21:41.930Z');
  const later = new Date('2026-08-17T13:21:41.992Z');
  assert.notEqual(requiredIso(earlier), requiredIso(later));
});

test('ISO matn qiymati o‘zgarmasdan qaytadi', () => {
  assert.equal(requiredIso('2026-08-17T13:21:41.992Z'), '2026-08-17T13:21:41.992Z');
});

test('bo‘sh qiymatlar null beradi', () => {
  for (const value of [null, undefined, '', 0]) {
    assert.equal(iso(value), null, `qiymat: ${JSON.stringify(value)}`);
  }
});

test('toDate mavjud Date nusxasini qayta yaratmaydi', () => {
  const value = new Date('2026-08-17T13:21:41.992Z');
  assert.equal(toDate(value), value);
});
