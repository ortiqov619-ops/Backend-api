import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRegionTree,
  dialectsForRegion,
  regionOptionLabel,
  XORAZM_REGION_SEED_ID,
  type Dialect,
  type Region,
  type RegionLevel,
} from '@xorazm/shared';

const UZ = '00000000-0000-4000-8000-000000000000';
const TM = '00000000-0000-4000-8000-000000000010';
const KK = '00000000-0000-4000-8000-000000000011';

function region(
  id: string,
  nameUz: string,
  level: RegionLevel,
  parentId: string | null,
  isContributionAllowed: boolean,
  formerName: string | null = null,
): Region {
  return {
    id,
    code: id.slice(-4),
    nameUz,
    formerName,
    parentId,
    level,
    isContributionAllowed,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

/** Migratsiya 0015 dan keyingi katalogning kichraytirilgan nusxasi. */
const CATALOG: Region[] = [
  region(UZ, 'O‘zbekiston', 'republic', null, false),
  region(TM, 'Turkmaniston', 'republic', null, false),
  region(KK, 'Qoraqalpog‘iston', 'republic', null, false),
  region(XORAZM_REGION_SEED_ID, 'Xorazm viloyati', 'region', UZ, true),
  region('r-navoiy', 'Navoiy viloyati', 'region', UZ, false),
  region('r-dashoguz', 'Dashoguz welayaty', 'region', TM, false),
  region('d-urganch', 'Urganch tumani', 'district', XORAZM_REGION_SEED_ID, true),
  region('d-xiva', 'Xiva tumani', 'district', XORAZM_REGION_SEED_ID, true),
  region('d-yopiq', 'Yopiq tuman', 'district', XORAZM_REGION_SEED_ID, false),
  region('v-oba', 'Qorao‘y obasi', 'village', 'd-urganch', true, '«Kommunizm» jamoa xo‘jaligi'),
  region('v-ovul', 'Sarig‘ ovuli', 'village', 'd-urganch', true),
  region('n-mahalla', 'Shomaxulum mahallasi', 'neighborhood', 'v-oba', true),
];

test('faqat ostida ochiq viloyati bor davlat ro‘yxatga kiradi', () => {
  // Respublikaning o'zi hech qachon «hissa ochiq» bo'lmaydi — mezon
  // uning ostidagi viloyat.
  const tree = buildRegionTree(CATALOG);
  assert.deepEqual(tree.countries.map((country) => country.id), [UZ]);
});

test('yangi respublikalar katalogda bor, lekin yopiq bo‘lgani uchun tanlanmaydi', () => {
  const tree = buildRegionTree(CATALOG);
  const ids = tree.countries.map((country) => country.id);
  assert.ok(!ids.includes(TM), 'Turkmaniston hali yopiq');
  assert.ok(!ids.includes(KK), 'Qoraqalpog‘iston hali yopiq');
});

test('viloyat ochilgach uning davlati ham ro‘yxatda paydo bo‘ladi', () => {
  const opened = CATALOG.map((item) => (item.id === 'r-dashoguz' ? { ...item, isContributionAllowed: true } : item));
  const tree = buildRegionTree(opened);
  assert.deepEqual(tree.countries.map((country) => country.nameUz).sort(), ['O‘zbekiston', 'Turkmaniston']);
});

test('har bir daraja faqat ochiq farzandlarni beradi', () => {
  const tree = buildRegionTree(CATALOG);
  assert.deepEqual(tree.childrenOf(UZ, 'region').map((item) => item.nameUz), ['Xorazm viloyati']);
  // «Yopiq tuman» ro'yxatda ko'rinmasligi kerak.
  assert.deepEqual(tree.childrenOf(XORAZM_REGION_SEED_ID, 'district').map((item) => item.nameUz), ['Urganch tumani', 'Xiva tumani']);
  assert.deepEqual(tree.childrenOf('d-urganch', 'village').map((item) => item.nameUz), ['Qorao‘y obasi', 'Sarig‘ ovuli']);
  assert.deepEqual(tree.childrenOf('v-oba', 'neighborhood').map((item) => item.nameUz), ['Shomaxulum mahallasi']);
});

test('mavjud Xorazm xulqi o‘zgarmaydi', () => {
  // Regressiya himoyasi: katalog kengaygandan keyin ham Xorazm
  // tumanlari avvalgidek tanlanadigan bo‘lib qolishi kerak.
  const tree = buildRegionTree(CATALOG);
  assert.equal(tree.childrenOf(XORAZM_REGION_SEED_ID, 'district').length, 2);
  assert.ok(tree.countries.some((country) => tree.childrenOf(country.id, 'region').some((item) => item.id === XORAZM_REGION_SEED_ID)));
});

test('ota-hudud berilmasa ro‘yxat bo‘sh', () => {
  const tree = buildRegionTree(CATALOG);
  assert.deepEqual(tree.childrenOf(null, 'district'), []);
  assert.deepEqual(tree.childrenOf('', 'district'), []);
});

test('bo‘sh katalog xatoga olib kelmaydi', () => {
  const tree = buildRegionTree([]);
  assert.deepEqual(tree.countries, []);
  assert.deepEqual(tree.childrenOf(UZ, 'region'), []);
});

test('eski nom ro‘yxatda qavs ichida ko‘rinadi', () => {
  const oba = CATALOG.find((item) => item.id === 'v-oba')!;
  assert.equal(regionOptionLabel(oba), 'Qorao‘y obasi («Kommunizm» jamoa xo‘jaligi)');
  const urganch = CATALOG.find((item) => item.id === 'd-urganch')!;
  assert.equal(regionOptionLabel(urganch), 'Urganch tumani');
});

// ---------------------------------------------------------------------------
// Lahjalar
// ---------------------------------------------------------------------------

function dialect(id: string, nameUz: string, regionIds: string[], isActive = true): Dialect {
  return {
    id,
    code: id,
    nameUz,
    markerWords: [],
    regionIds,
    isActive,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const DIALECTS: Dialect[] = [
  dialect('d1', 'Og‘uz', [XORAZM_REGION_SEED_ID]),
  dialect('d2', 'Qipchoq', ['d-urganch']),
  dialect('d3', 'Eski', [XORAZM_REGION_SEED_ID], false),
];

test('lahja tanlangan hududga qarab toraytiriladi', () => {
  assert.deepEqual(dialectsForRegion(DIALECTS, ['d-urganch']).map((item) => item.nameUz), ['Qipchoq']);
  assert.deepEqual(dialectsForRegion(DIALECTS, [XORAZM_REGION_SEED_ID]).map((item) => item.nameUz), ['Og‘uz']);
});

test('nofaol lahja hech qachon taklif qilinmaydi', () => {
  assert.ok(!dialectsForRegion(DIALECTS, [XORAZM_REGION_SEED_ID, 'd-urganch']).some((item) => item.id === 'd3'));
});

test('mos lahja topilmasa barcha faol lahjalar qaytadi', () => {
  // Bo'sh ro'yxat tanlovni umuman yashirardi.
  assert.deepEqual(dialectsForRegion(DIALECTS, ['begona-hudud']).map((item) => item.nameUz), ['Og‘uz', 'Qipchoq']);
  assert.deepEqual(dialectsForRegion(DIALECTS, [null, undefined]).map((item) => item.nameUz), ['Og‘uz', 'Qipchoq']);
});
