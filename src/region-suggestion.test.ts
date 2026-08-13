import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canBeChildOf,
  canCreateRegionUnder,
  isDirectVillageChild,
  normalizeDialectLabel,
  normalizeRegionName,
  parseRegionSuggestion,
  resolveRegionForPublication,
  uniqueDialectIdByLabel,
  RegionSuggestionValidationError,
} from './region-suggestion';

const XORAZM_ID = '00000000-0000-4000-8000-000000000001';

test('custom district is normalized and receives the selected region as parent', () => {
  assert.deepEqual(parseRegionSuggestion({ nameUz: '  Qo‘shko‘pir   shahri ', level: 'district' }, XORAZM_ID), {
    nameUz: 'Qo‘shko‘pir shahri',
    level: 'district',
    parentRegionId: XORAZM_ID,
  });
  assert.equal(normalizeRegionName('Qo‘shko‘pir'), "qo'shko'pir");
  assert.equal(normalizeRegionName('Urganch tumani'), normalizeRegionName('Urganch'));
});

test('unsafe, placeholder and oversized custom region names are rejected', () => {
  for (const nameUz of ['Boshqa', '<script>', 'https://example.com', 'x'.repeat(81)]) {
    assert.throws(
      () => parseRegionSuggestion({ nameUz, level: 'district' }, XORAZM_ID),
      RegionSuggestionValidationError,
    );
  }
});

test('region suggestion level hierarchy is explicit', () => {
  assert.equal(canBeChildOf('district', 'region'), true);
  assert.equal(canBeChildOf('district', 'district'), false);
  assert.equal(canBeChildOf('village', 'district'), true);
  assert.equal(canBeChildOf('neighborhood', 'village'), true);
  assert.equal(canBeChildOf('village', 'region'), false);
  assert.equal(canCreateRegionUnder('region', 'republic'), true);
  assert.equal(canCreateRegionUnder('region', 'region'), false);
  assert.equal(canCreateRegionUnder('neighborhood', 'district'), true);
});

test('canonical village must be the direct child of the selected district', () => {
  const districtId = '10000000-0000-4000-8000-000000000002';
  assert.equal(isDirectVillageChild({ level: 'village', parentId: districtId }, districtId), true);
  assert.equal(isDirectVillageChild({ level: 'village', parentId: XORAZM_ID }, districtId), false);
  assert.equal(isDirectVillageChild({ level: 'district', parentId: districtId }, districtId), false);
  assert.equal(isDirectVillageChild({ level: 'village', parentId: districtId }, null), false);
});

test('legacy dialect display names map only to one canonical active dialect', () => {
  const dialects = [
    { id: '20000000-0000-4000-8000-000000000001', code: 'oguz', nameUz: 'O‘g‘uz' },
    { id: '20000000-0000-4000-8000-000000000002', code: 'qipchoq', nameUz: 'Qipchoq' },
  ];
  assert.equal(normalizeDialectLabel(' OʻGʻUZ '), normalizeDialectLabel('O‘g‘uz'));
  assert.equal(uniqueDialectIdByLabel('Oguz', dialects), dialects[0]!.id);
  assert.equal(uniqueDialectIdByLabel('O‘g‘uz', dialects), dialects[0]!.id);
  assert.equal(uniqueDialectIdByLabel('qipchoq', dialects), dialects[1]!.id);
  assert.equal(uniqueDialectIdByLabel('noma’lum', dialects), null);
});

test('approved custom district uses only the moderator-selected canonical district', () => {
  const proposal = parseRegionSuggestion({ nameUz: 'Pitnak shahri', level: 'district' }, XORAZM_ID)!;
  const districtId = '10000000-0000-4000-8000-000000000001';
  assert.deepEqual(resolveRegionForPublication(proposal, { districtId }), {
    districtId,
    villageId: null,
    neighborhood: null,
    matchedRegionId: districtId,
    resolution: 'canonical',
  });
});

test('unresolved village is safely generalized to the moderator-selected district', () => {
  const districtId = '10000000-0000-4000-8000-000000000002';
  const proposal = parseRegionSuggestion({ nameUz: 'Yangi ovul', level: 'village', parentRegionId: districtId }, XORAZM_ID)!;
  assert.deepEqual(resolveRegionForPublication(proposal, { districtId }), {
    districtId,
    villageId: null,
    neighborhood: null,
    matchedRegionId: null,
    resolution: 'generalized',
  });
});
