import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWordListFilters, WordFilterValidationError } from './word-filters';

const HAS_AUDIO_SQL = 'EXISTS (SELECT 1 FROM audio_submissions au WHERE au.word_id = w.id)';
const options = (isAdmin: boolean) => ({ isAdmin, hasAudioSql: HAS_AUDIO_SQL });

test('ochiq ro‘yxat har doim faqat nashr etilgan so‘zlarni beradi', () => {
  const { clause, params } = buildWordListFilters({}, options(false));
  assert.equal(clause, `WHERE w.status = 'published'`);
  assert.deepEqual(params, []);
});

test('tokensiz so‘rov `status` bilan qoralamani ocha olmaydi', () => {
  // Xavfsizlik sharti: ochiq endpointda `status` parametri e'tiborga
  // olinmaydi, bekor qilib bo'lmaydigan `published` sharti qoladi.
  for (const status of ['draft', 'archived', 'all']) {
    const { clause } = buildWordListFilters({ status }, options(false));
    assert.equal(clause, `WHERE w.status = 'published'`);
  }
});

test('admin `status` filtri haqiqatan qo‘llanadi', () => {
  // Aynan shu nuqson: admin panelda «Qoralama» tanlansa ham nashr
  // etilgan so'zlar chiqardi.
  const draft = buildWordListFilters({ status: 'draft' }, options(true));
  assert.equal(draft.clause, 'WHERE w.status = $1::word_status');
  assert.deepEqual(draft.params, ['draft']);

  const archived = buildWordListFilters({ status: 'archived' }, options(true));
  assert.deepEqual(archived.params, ['archived']);
});

test('admin uchun `all` va bo‘sh status holat filtrini umuman qo‘ymaydi', () => {
  // «Barchasi» tanlanganda yangi qo'shilgan qoralama ham ro'yxatda
  // ko'rinishi kerak.
  assert.equal(buildWordListFilters({ status: 'all' }, options(true)).clause, '');
  assert.equal(buildWordListFilters({}, options(true)).clause, '');
  assert.equal(buildWordListFilters({ status: '' }, options(true)).clause, '');
});

test('noto‘g‘ri status 500 emas, tushunarli xato beradi', () => {
  assert.throws(
    () => buildWordListFilters({ status: 'pending' }, options(true)),
    (error: unknown) => error instanceof WordFilterValidationError && error.field === 'status',
  );
});

test('qidiruv so‘z, ma’no va adabiy shaklni qamraydi', () => {
  const { clause, params } = buildWordListFilters({ status: 'all', search: ' gelyatir ' }, options(true));
  assert.equal(clause, 'WHERE (w.word ILIKE $1 OR w.meaning ILIKE $1 OR COALESCE(w.literary_form, \'\') ILIKE $1)');
  assert.deepEqual(params, ['%gelyatir%']);
});

test('hudud filtri viloyat, tuman, qishloq va mahallani birga qidiradi', () => {
  const regionId = '00000000-0000-4000-8000-000000000001';
  const { clause, params } = buildWordListFilters({ status: 'all', regionId }, options(true));
  assert.equal(clause, 'WHERE (w.region_id = $1 OR w.district_id = $1 OR w.village_id = $1 OR w.neighborhood_id = $1)');
  assert.deepEqual(params, [regionId]);
});

test('noto‘g‘ri UUID filtri rad etiladi', () => {
  for (const field of ['regionId', 'dialectId'] as const) {
    assert.throws(
      () => buildWordListFilters({ [field]: 'not-a-uuid' }, options(true)),
      (error: unknown) => error instanceof WordFilterValidationError && error.field === field,
    );
  }
});

test('hasAudio ikkala yo‘nalishda ham ishlaydi', () => {
  assert.equal(
    buildWordListFilters({ status: 'all', hasAudio: 'true' }, options(true)).clause,
    `WHERE ${HAS_AUDIO_SQL}`,
  );
  assert.equal(
    buildWordListFilters({ status: 'all', hasAudio: 'false' }, options(true)).clause,
    `WHERE NOT ${HAS_AUDIO_SQL}`,
  );
  assert.throws(
    () => buildWordListFilters({ hasAudio: 'maybe' }, options(true)),
    WordFilterValidationError,
  );
});

test('bir nechta filtr parametr raqamlarini buzmasdan birlashadi', () => {
  const regionId = '00000000-0000-4000-8000-000000000001';
  const { clause, params } = buildWordListFilters(
    { status: 'published', search: 'suv', regionId, category: 'maishiy' },
    options(true),
  );
  assert.equal(
    clause,
    'WHERE w.status = $1::word_status'
    + ' AND (w.word ILIKE $2 OR w.meaning ILIKE $2 OR COALESCE(w.literary_form, \'\') ILIKE $2)'
    + ' AND (w.region_id = $3 OR w.district_id = $3 OR w.village_id = $3 OR w.neighborhood_id = $3)'
    + ' AND w.category = $4',
  );
  assert.deepEqual(params, ['published', '%suv%', regionId, 'maishiy']);
});
