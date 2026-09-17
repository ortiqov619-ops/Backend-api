import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool, type PoolClient } from 'pg';
import {
  createRegionChain,
  createRegionFromProposal,
  RegionCodeExhaustedError,
  REGION_CODE_ATTEMPTS,
  type QueryExecutor,
} from './region-catalog';

const XORAZM_ID = '00000000-0000-4000-8000-000000000001';

// ---------------------------------------------------------------------------
// Sof tekshiruvlar — soxta executor bilan
// ---------------------------------------------------------------------------

/**
 * Berilgan kodlarni "band" deb hisoblaydigan soxta baza.
 *
 * Tranzaksiya buyruqlari (`SAVEPOINT`, `RELEASE`, `ROLLBACK TO`) alohida
 * `transaction` ro'yxatiga yoziladi: ular haqiqiy bazada qayta urinish
 * ishlashining sharti, shuning uchun tekshiruvlar ularni ham ko'radi.
 */
function fakeExecutor(taken: Set<string>): QueryExecutor & { codes: string[]; transaction: string[] } {
  const codes: string[] = [];
  const transaction: string[] = [];
  return {
    codes,
    transaction,
    async query(text: string, values?: unknown[]) {
      if (!values) {
        transaction.push(text);
        return { rows: [], rowCount: 0 };
      }
      const code = String(values[0]);
      codes.push(code);
      if (taken.has(code)) {
        throw Object.assign(new Error('duplicate key'), { code: '23505' });
      }
      return { rows: [{ id: `id-for-${code}` }], rowCount: 1 };
    },
  };
}

test('kod nomdan hosil bo‘ladi va hudud yaratiladi', async () => {
  const db = fakeExecutor(new Set());
  const id = await createRegionFromProposal(db, { nameUz: 'Pitnak shahri', level: 'district', parentRegionId: XORAZM_ID }, 'mod-1');
  assert.equal(id, 'id-for-pitnak-shahri');
  assert.deepEqual(db.codes, ['pitnak-shahri']);
});

test('kod band bo‘lsa raqam qo‘shiladi', async () => {
  const db = fakeExecutor(new Set(['pitnak', 'pitnak-2']));
  const id = await createRegionFromProposal(db, { nameUz: 'Pitnak', level: 'district', parentRegionId: XORAZM_ID }, 'mod-1');
  assert.equal(id, 'id-for-pitnak-3');
  assert.deepEqual(db.codes, ['pitnak', 'pitnak-2', 'pitnak-3']);
});

test('har bir urinish savepoint ichida bajariladi', async () => {
  // Usiz qayta urinish HAQIQIY bazada ishlamaydi: birinchi `23505` dan
  // keyin tranzaksiya bekor bo'ladi va ikkinchi urinish `25P02` bilan
  // yiqilib, moderatorga 500 qaytardi.
  const db = fakeExecutor(new Set(['pitnak']));
  await createRegionFromProposal(db, { nameUz: 'Pitnak', level: 'district', parentRegionId: XORAZM_ID }, 'mod-1');
  assert.deepEqual(db.transaction, [
    'SAVEPOINT region_code_attempt',
    'ROLLBACK TO SAVEPOINT region_code_attempt',
    'SAVEPOINT region_code_attempt',
    'RELEASE SAVEPOINT region_code_attempt',
  ]);
});

test('unique’dan boshqa xato yashirilmaydi', async () => {
  // Aks holda haqiqiy nuqson 20 marta takrorlanib, keyin noto'g'ri
  // "kod band" xabari bilan chiqardi.
  const statements: string[] = [];
  const db: QueryExecutor = {
    async query(text: string, values?: unknown[]) {
      if (!values) { statements.push(text); return { rows: [], rowCount: 0 }; }
      throw Object.assign(new Error('not null violation'), { code: '23502' });
    },
  };
  await assert.rejects(
    () => createRegionFromProposal(db, { nameUz: 'Pitnak', level: 'district', parentRegionId: XORAZM_ID }, 'mod-1'),
    /not null violation/,
  );
  // Xato uzatilsa ham tranzaksiya savepointgacha qaytariladi: chaqiruvchi
  // uni o'zi tugatishi kerak va buzilgan holatda qoldirib bo'lmaydi.
  assert.equal(statements.at(-1), 'ROLLBACK TO SAVEPOINT region_code_attempt');
});

test('urinishlar tugasa aniq xato beriladi', async () => {
  const taken = new Set(['x', ...Array.from({ length: REGION_CODE_ATTEMPTS }, (_, i) => `x-${i + 2}`)]);
  const db = fakeExecutor(taken);
  await assert.rejects(
    () => createRegionFromProposal(db, { nameUz: 'X', level: 'district', parentRegionId: XORAZM_ID }, 'mod-1'),
    RegionCodeExhaustedError,
  );
});

test('davlat ota-hududsiz yoziladi', async () => {
  const db: QueryExecutor & { parents: unknown[] } = Object.assign(
    { parents: [] as unknown[] },
    {
      async query(_text: string, values?: unknown[]) {
        // Tranzaksiya buyruqlarida parametr yo'q — ular hisobga olinmaydi.
        if (!values) return { rows: [], rowCount: 0 };
        (db as { parents: unknown[] }).parents.push(values[2]);
        return { rows: [{ id: 'country-1' }], rowCount: 1 };
      },
    },
  );
  await createRegionFromProposal(db, { nameUz: 'Turkmaniston', level: 'republic', parentRegionId: null }, 'mod-1');
  assert.deepEqual(db.parents, [null], 'davlatga ota-hudud berildi');
});

// ---------------------------------------------------------------------------
// Baza tekshiruvi — SQL turlar deduksiyasi faqat shu yerda tutiladi
// ---------------------------------------------------------------------------

const databaseUrl = process.env.TEST_DATABASE_URL;
const needsDatabase = { skip: databaseUrl ? false : 'TEST_DATABASE_URL berilmagan' };

async function inRollback(run: (client: PoolClient) => Promise<void>): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await run(client);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
    await pool.end();
  }
}

test('haqiqiy bazada hudud yaratiladi va hissaga ochiq bo‘ladi', needsDatabase, async () => {
  await inRollback(async (client) => {
    const id = await createRegionFromProposal(
      client,
      { nameUz: 'Test Tumani 900001', level: 'district', parentRegionId: XORAZM_ID },
      '00000000-0000-4000-8000-000000000000',
    );
    const row = await client.query<{ level: string; is_contribution_allowed: boolean; parent_id: string }>(
      'SELECT level::text AS level, is_contribution_allowed, parent_id FROM regions WHERE id = $1::uuid', [id],
    );
    assert.equal(row.rows[0]!.level, 'district');
    // Yopiq yaratilsa nom ilovadagi ro'yxatda hech qachon ko'rinmasdi.
    assert.equal(row.rows[0]!.is_contribution_allowed, true, 'yangi hudud hissaga yopiq yaratildi');
    assert.equal(row.rows[0]!.parent_id, XORAZM_ID);
  });
});

test('haqiqiy bazada band kod tranzaksiyani buzmaydi', needsDatabase, async () => {
  // Nuqson aynan shu yerda edi: birinchi INSERT `23505` bilan yiqilgach
  // tranzaksiya bekor bo'lardi va keyingi urinish `25P02` beradi. Soxta
  // executor buni ko'rsata olmaydi — faqat haqiqiy PostgreSQL ko'rsatadi.
  await inRollback(async (client) => {
    // `regions.created_by` — haqiqiy FK, shuning uchun moderator shu
    // tranzaksiyada yaratiladi.
    const moderator = (await client.query<{ id: string }>(
      `INSERT INTO users (full_name, email, password_hash, kind)
       VALUES ('Test Moderator', $1, 'x', 'staff') RETURNING id`,
      [`moderator-900003-${Date.now()}@example.test`],
    )).rows[0]!.id;
    const first = await createRegionFromProposal(
      client, { nameUz: 'Takror Tumani 900003', level: 'district', parentRegionId: XORAZM_ID }, moderator,
    );
    const second = await createRegionFromProposal(
      client, { nameUz: 'Takror Tumani 900003', level: 'district', parentRegionId: XORAZM_ID }, moderator,
    );
    assert.notEqual(first, second);
    const codes = await client.query<{ code: string }>(
      'SELECT code FROM regions WHERE id = ANY($1::uuid[]) ORDER BY code', [[first, second]],
    );
    assert.deepEqual(codes.rows.map((row) => row.code), ['takror-tumani-900003', 'takror-tumani-900003-2']);
    // Tranzaksiya hamon yozishga yaroqli: `25P02` bo'lganda bu yiqilardi.
    await client.query('SELECT 1');
  });
});

test('haqiqiy bazada davlat ota-hududsiz yaratiladi', needsDatabase, async () => {
  await inRollback(async (client) => {
    const id = await createRegionFromProposal(
      client,
      { nameUz: 'Testiston 900002', level: 'republic', parentRegionId: null },
      '00000000-0000-4000-8000-000000000000',
    );
    const row = await client.query<{ level: string; parent_id: string | null }>(
      'SELECT level::text AS level, parent_id FROM regions WHERE id = $1::uuid', [id],
    );
    assert.equal(row.rows[0]!.level, 'republic');
    assert.equal(row.rows[0]!.parent_id, null);
  });
});

// ---------------------------------------------------------------------------
// Zanjir
// ---------------------------------------------------------------------------

test('zanjirdagi har bir bo‘g‘in oldingisining ostiga yoziladi', async () => {
  const inserts: { code: string; level: unknown; parent: unknown }[] = [];
  const db: QueryExecutor = {
    async query(_text: string, values?: unknown[]) {
      if (!values) return { rows: [], rowCount: 0 };
      const code = String(values[0]);
      inserts.push({ code, level: values[3], parent: values[2] });
      return { rows: [{ id: `id-${code}` }], rowCount: 1 };
    },
  };
  const chain = await createRegionChain(db, {
    nameUz: 'Turkmaniston', level: 'republic', parentRegionId: null,
    lowerLevels: [
      { level: 'region', nameUz: 'Lebap' },
      { level: 'district', nameUz: 'Chorjoy' },
      { level: 'neighborhood', nameUz: 'Guliston' },
    ],
  }, 'mod-1');

  assert.deepEqual(chain, [
    { level: 'republic', id: 'id-turkmaniston' },
    { level: 'region', id: 'id-lebap' },
    { level: 'district', id: 'id-chorjoy' },
    { level: 'neighborhood', id: 'id-guliston' },
  ]);
  // Ota-hudud — har doim oldingi yaratilgani; davlatniki esa yo'q.
  assert.deepEqual(inserts.map((row) => row.parent), [null, 'id-turkmaniston', 'id-lebap', 'id-chorjoy']);
});

test('quyi bo‘g‘insiz zanjir faqat taklifning o‘zini yaratadi', async () => {
  const db = fakeExecutor(new Set());
  const chain = await createRegionChain(db, { nameUz: 'Pitnak', level: 'district', parentRegionId: XORAZM_ID }, 'mod-1');
  assert.deepEqual(chain, [{ level: 'district', id: 'id-for-pitnak' }]);
});
