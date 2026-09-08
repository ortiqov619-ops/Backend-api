import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canBeChildOf,
  canCreateRegionUnder,
  isDirectNeighborhoodChild,
  isDirectVillageChild,
  normalizeDialectLabel,
  normalizeRegionName,
  parseLocalIdentifier,
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

test('canonical neighborhood must be the direct child of its selected parent', () => {
  const parentId = '10000000-0000-4000-8000-000000000002';
  assert.equal(isDirectNeighborhoodChild({ level: 'neighborhood', parentId }, parentId), true);
  assert.equal(isDirectNeighborhoodChild({ level: 'neighborhood', parentId: XORAZM_ID }, parentId), false);
  assert.equal(isDirectNeighborhoodChild({ level: 'village', parentId }, parentId), false);
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
    neighborhoodId: null,
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
    neighborhoodId: null,
    neighborhood: null,
    matchedRegionId: null,
    resolution: 'generalized',
  });
});

test('approved custom neighborhood can map only to a canonical neighborhood id', () => {
  const districtId = '10000000-0000-4000-8000-000000000002';
  const neighborhoodId = '30000000-0000-4000-8000-000000000001';
  const proposal = parseRegionSuggestion({ nameUz: 'Yangi mahalla', level: 'neighborhood', parentRegionId: districtId }, XORAZM_ID)!;
  assert.deepEqual(resolveRegionForPublication(proposal, { districtId, neighborhoodId }), {
    districtId,
    villageId: null,
    neighborhoodId,
    neighborhood: null,
    matchedRegionId: neighborhoodId,
    resolution: 'canonical',
  });
});

// ---------------------------------------------------------------------------
// Erkin matnli hudud maydonlari: mahalla nomi va urug'/laqab
// ---------------------------------------------------------------------------

test('mahalla va urug‘ nomi tozalanib qaytadi', () => {
  assert.equal(parseLocalIdentifier('  Shomaxulum   mahallasi ', 'payload.neighborhood'), 'Shomaxulum mahallasi');
  assert.equal(parseLocalIdentifier("Qo‘ng‘irot", 'payload.clan', { maxLength: 60 }), "Qo‘ng‘irot");
});

test('bo‘sh qiymat xato emas — bu maydonlar ixtiyoriy', () => {
  assert.equal(parseLocalIdentifier('', 'payload.clan'), null);
  assert.equal(parseLocalIdentifier('   ', 'payload.clan'), null);
  assert.equal(parseLocalIdentifier(null, 'payload.clan'), null);
  assert.equal(parseLocalIdentifier(undefined, 'payload.clan'), null);
});

test('havola, teg va uzun matn moderator ekraniga tushmaydi', () => {
  for (const value of ['https://example.com', 'www.spam.uz', '<script>alert(1)</script>', 'yoz@menga', 'x'.repeat(81)]) {
    assert.throws(
      () => parseLocalIdentifier(value, 'payload.neighborhood'),
      RegionSuggestionValidationError,
      value,
    );
  }
});

test('juda qisqa qiymat va matn bo‘lmagan tur rad etiladi', () => {
  assert.throws(() => parseLocalIdentifier('x', 'payload.clan'), RegionSuggestionValidationError);
  assert.throws(() => parseLocalIdentifier(42, 'payload.clan'), RegionSuggestionValidationError);
  assert.throws(() => parseLocalIdentifier({ nameUz: 'x' }, 'payload.clan'), RegionSuggestionValidationError);
});

test('maxLength maydonga qarab o‘zgaradi', () => {
  const sixtyOne = 'a'.repeat(61);
  assert.equal(parseLocalIdentifier(sixtyOne, 'payload.neighborhood'), sixtyOne);
  assert.throws(
    () => parseLocalIdentifier(sixtyOne, 'payload.clan', { maxLength: 60 }),
    (error: unknown) => error instanceof RegionSuggestionValidationError && error.field === 'payload.clan',
  );
});

// ---------------------------------------------------------------------------
// Davlat taklifi
// ---------------------------------------------------------------------------

test('davlat taklifining ota-hududi bo‘lmaydi', () => {
  // Davlat ierarxiyaning tepasi: unga parent berib bo'lmaydi.
  assert.deepEqual(parseRegionSuggestion({ nameUz: '  Turkmaniston  ', level: 'republic' }, XORAZM_ID), {
    nameUz: 'Turkmaniston',
    level: 'republic',
    parentRegionId: null,
  });
});

test('davlat taklifiga yuborilgan parentRegionId e’tiborga olinmaydi', () => {
  // Aks holda davlat o'zidan kichik hududning ichiga tushib qolardi.
  const parsed = parseRegionSuggestion(
    { nameUz: 'Qozog‘iston', level: 'republic', parentRegionId: XORAZM_ID },
    XORAZM_ID,
  );
  assert.equal(parsed?.parentRegionId, null);
});

test('davlat nomi ham qolgan hududlar bilan bir xil qat’iylikda tekshiriladi', () => {
  for (const nameUz of ['T', 'boshqa', 'http://example.test', 'x'.repeat(81)]) {
    assert.throws(
      () => parseRegionSuggestion({ nameUz, level: 'republic' }, XORAZM_ID),
      RegionSuggestionValidationError,
      nameUz,
    );
  }
});

test('davlat taklifi so‘zni hech qanday tumanga bog‘lamaydi', () => {
  // So'z tanlangan viloyatda qoladi; davlatni moderator alohida yaratadi.
  const districtId = '10000000-0000-4000-8000-000000000002';
  const resolved = resolveRegionForPublication(
    { nameUz: 'Turkmaniston', level: 'republic', parentRegionId: null },
    { districtId },
  );
  assert.equal(resolved.matchedRegionId, null, 'davlat tumanga bog‘lanib qoldi');
  assert.equal(resolved.resolution, 'generalized');
  // Moderator tanlagan tuman saqlanadi — so'z bir joyda nashr qilinishi kerak.
  assert.equal(resolved.districtId, districtId);
});

test('boshqa darajalar davlat qo‘shilgandan keyin ham o‘zgarmaydi', () => {
  // Regressiya: ishlab turgan tuman taklifi buzilmasligi shart.
  assert.deepEqual(parseRegionSuggestion({ nameUz: 'Yangi tuman', level: 'district' }, XORAZM_ID), {
    nameUz: 'Yangi tuman',
    level: 'district',
    parentRegionId: XORAZM_ID,
  });
});
