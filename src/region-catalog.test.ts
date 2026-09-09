import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool, type PoolClient } from 'pg';
import {
  createRegionFromProposal,
  RegionCodeExhaustedError,
  REGION_CODE_ATTEMPTS,
  type QueryExecutor,
} from './region-catalog';

const XORAZM_ID = '00000000-0000-4000-8000-000000000001';

// ---------------------------------------------------------------------------
// Sof tekshiruvlar — soxta executor bilan
// ---------------------------------------------------------------------------

/** Berilgan kodlarni "band" deb hisoblaydigan soxta baza. */
function fakeExecutor(taken: Set<string>): QueryExecutor & { codes: string[] } {
  const codes: string[] = [];
  return {
    codes,
    async query(_text: string, values?: unknown[]) {
      const code = String(values?.[0]);
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

test('unique’dan boshqa xato yashirilmaydi', async () => {
  // Aks holda haqiqiy nuqson 20 marta takrorlanib, keyin noto'g'ri
  // "kod band" xabari bilan chiqardi.
  const db: QueryExecutor = {
    async query() { throw Object.assign(new Error('not null violation'), { code: '23502' }); },
  };
  await assert.rejects(
    () => createRegionFromProposal(db, { nameUz: 'Pitnak', level: 'district', parentRegionId: XORAZM_ID }, 'mod-1'),
    /not null violation/,
  );
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
        (db as { parents: unknown[] }).parents.push(values?.[2]);
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
