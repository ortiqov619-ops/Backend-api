import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONTRIBUTION_RULE_FIELDS,
  DEFAULT_CONTRIBUTION_FIELD_RULES,
  SERVER_ENFORCED_CONTRIBUTION_FIELDS,
  missingRequiredContributionFields,
  parseContributionFieldRules,
} from '@xorazm/shared';

test('sukut bo‘yicha hech bir maydon majburiy emas', () => {
  // Migratsiya ishlab turgan ilovaning talabini o'zgartirmasligi kerak.
  assert.deepEqual(parseContributionFieldRules({}), DEFAULT_CONTRIBUTION_FIELD_RULES);
  assert.equal(Object.values(DEFAULT_CONTRIBUTION_FIELD_RULES).some(Boolean), false);
});

test('noma’lum kalitlar tashlanadi', () => {
  // Mijozdan kelgan obyekt jadvalga to'g'ridan-to'g'ri tushmaydi.
  const rules = parseContributionFieldRules({ dialectId: true, word: true, ' clan': true, audio: 'ha' });
  assert.equal(rules.dialectId, true);
  assert.equal(rules.audio, false, 'matn qiymat `true` deb qabul qilindi');
  assert.deepEqual(Object.keys(rules).sort(), [...CONTRIBUTION_RULE_FIELDS].sort());
});

test('null va noto‘g‘ri turlar sukutga qaytadi', () => {
  for (const input of [null, undefined, 'ha', 42, []]) {
    assert.deepEqual(parseContributionFieldRules(input), DEFAULT_CONTRIBUTION_FIELD_RULES);
  }
});

test('faqat majburiy va bo‘sh maydon xato beradi', () => {
  const rules = { ...DEFAULT_CONTRIBUTION_FIELD_RULES, dialectId: true, clan: true };
  const missing = missingRequiredContributionFields(rules, { dialectId: '', clan: 'Qo‘ng‘irot' }, { hasAudio: true });
  assert.deepEqual(missing, ['dialectId'], 'to‘ldirilgan maydon ham majburiy deb belgilandi');
});

test('faqat bo‘shliqdan iborat qiymat to‘ldirilgan hisoblanmaydi', () => {
  const rules = { ...DEFAULT_CONTRIBUTION_FIELD_RULES, clan: true };
  assert.deepEqual(
    missingRequiredContributionFields(rules, { clan: '   ' }, { hasAudio: true }),
    ['clan'],
  );
});

test('ro‘yxat faqat formada bor maydonlardan iborat', () => {
  // Formada yo'q maydonni majburiy qilish yuborishni to'xtatib qo'yardi.
  assert.deepEqual([...CONTRIBUTION_RULE_FIELDS].sort(), ['audio', 'clan', 'dialectId']);
});

test('ixtiyoriy maydon bo‘sh bo‘lsa ham xato bermaydi', () => {
  assert.deepEqual(
    missingRequiredContributionFields(DEFAULT_CONTRIBUTION_FIELD_RULES, {}, { hasAudio: false }),
    [],
  );
});

test('audio majburiy bo‘lsa ham yozuvsiz holat aniqlanadi', () => {
  const rules = { ...DEFAULT_CONTRIBUTION_FIELD_RULES, audio: true };
  assert.deepEqual(missingRequiredContributionFields(rules, {}, { hasAudio: false }), ['audio']);
  assert.deepEqual(missingRequiredContributionFields(rules, {}, { hasAudio: true }), []);
});

test('audio serverda tekshirilmaydi — u keyingi so‘rovda keladi', () => {
  // Buni yashirmaslik kerak: so'z yozuvi yaratilgandan keyin yuklanadi,
  // shuning uchun so'zni qabul qilish paytida uni talab qilib bo'lmaydi.
  assert.equal(SERVER_ENFORCED_CONTRIBUTION_FIELDS.includes('audio' as never), false);
  assert.deepEqual([...SERVER_ENFORCED_CONTRIBUTION_FIELDS].sort(), ['clan', 'dialectId']);
});
