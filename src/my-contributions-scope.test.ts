import test from 'node:test';
import assert from 'node:assert/strict';
import { myContributionsScope } from './my-contributions-scope';

test('hisobli foydalanuvchi faqat o‘z takliflarini oladi', () => {
  const scope = myContributionsScope({ userId: 'u-1', installationId: null });
  assert.equal(scope.clause, 'cr.submitted_by_user_id = $1::uuid');
  assert.deepEqual(scope.params, ['u-1']);
});

test('mehmon o‘z qurilmasidan yuborgan hisobsiz takliflarni ko‘radi', () => {
  const scope = myContributionsScope({ userId: null, installationId: 'dev-9' });
  assert.match(scope.clause, /submitted_by_user_id IS NULL/);
  assert.match(scope.clause, /installationId'\s*=\s*\$1/);
  assert.deepEqual(scope.params, ['dev-9']);
});

test('mehmon sharti hisobga bog‘langan takliflarni hech qachon ochmaydi', () => {
  // Bu shart bo'lmasa qurilma identifikatori boshqa odamning hisobidagi
  // takliflarini ko'rsatib qo'yishi mumkin edi.
  const scope = myContributionsScope({ userId: null, installationId: 'dev-9' });
  assert.ok(scope.clause.includes('cr.submitted_by_user_id IS NULL'));
  assert.ok(!scope.clause.includes('$2'));
});

test('hisob ochgan odam avvalgi mehmon takliflarini yo‘qotmaydi', () => {
  const scope = myContributionsScope({ userId: 'u-1', installationId: 'dev-9' });
  assert.match(scope.clause, /\$1::uuid OR/);
  assert.match(scope.clause, /\$2/);
  assert.deepEqual(scope.params, ['u-1', 'dev-9']);
});

test('bo‘sh qurilma identifikatori hisobga ta’sir qilmaydi', () => {
  const scope = myContributionsScope({ userId: 'u-1', installationId: '   ' });
  assert.equal(scope.clause, 'cr.submitted_by_user_id = $1::uuid');
  assert.deepEqual(scope.params, ['u-1']);
});

test('na hisob, na qurilma — so‘rov umuman bajarilmaydi', () => {
  assert.throws(() => myContributionsScope({ userId: null, installationId: null }));
});
