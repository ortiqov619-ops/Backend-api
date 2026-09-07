import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool, type PoolClient } from 'pg';
import { generateApplicationApiKey, matchesApplicationApiKey } from './application-api-keys';

/**
 * API kalitlarining BAZA tomonidagi hayot sikli.
 *
 * Bu yerdagi da'volarni sof test isbotlay olmaydi: ular CHECK
 * constraintlar, unikal indeks va `now()` bilan taqqoslashga tayanadi.
 *
 *   TEST_DATABASE_URL=postgres://... npm run test:api
 *
 * Baza berilmasa tekshiruvlar SKIP bo'ladi — ular hech qachon
 * "muvaffaqiyatli" deb hisoblanmaydi.
 */

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

async function createOwner(client: PoolClient): Promise<string> {
  const created = await client.query<{ id: string }>(
    `INSERT INTO users (email, full_name, password_hash) VALUES ($1,'Owner','x') RETURNING id`,
    [`owner-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`],
  );
  return created.rows[0]!.id;
}

/** Serverdagi INSERT bilan bir xil shakl. */
async function insertKey(
  client: PoolClient,
  owner: string,
  overrides: { scopes?: string[]; expiresAt?: string | null; rateLimit?: number } = {},
) {
  const generated = generateApplicationApiKey();
  const row = await client.query(
    `INSERT INTO application_api_keys
       (public_id, name, secret_hash, masked_hint, scopes, expires_at, rate_limit_per_hour, created_by)
     VALUES ($1,'Test kalit',$2,$3,$4,$5,$6,$7) RETURNING *`,
    [
      generated.publicId, generated.secretHash, generated.maskedHint,
      overrides.scopes ?? ['dictionary:read'],
      overrides.expiresAt ?? null,
      overrides.rateLimit ?? 1000,
      owner,
    ],
  );
  return { generated, row: row.rows[0]! };
}

/** Serverdagi autentifikatsiya so'rovi bilan bir xil. */
async function authenticate(client: PoolClient, token: string, publicId: string) {
  const found = await client.query(
    `SELECT id, secret_hash, scopes FROM application_api_keys
      WHERE public_id=$1 AND is_active=true AND (expires_at IS NULL OR expires_at > now())`,
    [publicId],
  );
  const row = found.rows[0];
  if (!row || !matchesApplicationApiKey(token, String(row.secret_hash))) return null;
  return row;
}

test('baza faqat hashni saqlaydi — ochiq secret hech qayerda yo‘q', needsDatabase, async () => {
  await inRollback(async (client) => {
    const owner = await createOwner(client);
    const { generated, row } = await insertKey(client, owner);

    assert.equal(row.secret_hash, generated.secretHash);
    assert.match(String(row.secret_hash), /^[0-9a-f]{64}$/);

    // Butun qatorni matnga aylantirib, ochiq kalit izini qidiramiz.
    const dump = JSON.stringify(row);
    assert.equal(dump.includes(generated.token), false, 'ochiq kalit qatorda saqlanibdi');
    const secretPart = /^xsk_.{12}_(.{43})$/.exec(generated.token)![1]!;
    assert.equal(dump.includes(secretPart), false, 'secret qismi qatorda saqlanibdi');
  });
});

test('to‘g‘ri kalit autentifikatsiyadan o‘tadi', needsDatabase, async () => {
  await inRollback(async (client) => {
    const owner = await createOwner(client);
    const { generated } = await insertKey(client, owner);
    assert.notEqual(await authenticate(client, generated.token, generated.publicId), null);
  });
});

test('noto‘g‘ri va noma’lum kalit rad etiladi', needsDatabase, async () => {
  await inRollback(async (client) => {
    const owner = await createOwner(client);
    const { generated } = await insertKey(client, owner);
    const other = generateApplicationApiKey();
    assert.equal(await authenticate(client, other.token, generated.publicId), null, 'boshqa secret o‘tdi');
    assert.equal(await authenticate(client, generated.token, other.publicId), null, 'noma’lum public id o‘tdi');
  });
});

test('muddati tugagan kalit rad etiladi', needsDatabase, async () => {
  await inRollback(async (client) => {
    const owner = await createOwner(client);
    const { generated } = await insertKey(client, owner, { expiresAt: new Date(Date.now() - 60_000).toISOString() });
    assert.equal(await authenticate(client, generated.token, generated.publicId), null);
  });
});

test('bekor qilingan kalit rad etiladi', needsDatabase, async () => {
  await inRollback(async (client) => {
    const owner = await createOwner(client);
    const { generated, row } = await insertKey(client, owner);
    await client.query(
      `UPDATE application_api_keys SET is_active=false, revoked_at=now(), revoked_by=$2, revoke_reason='test'
        WHERE id=$1`,
      [row.id, owner],
    );
    assert.equal(await authenticate(client, generated.token, generated.publicId), null);
  });
});

test('rotatsiya eskisini o‘chiradi va faqat bittasi faol qoladi', needsDatabase, async () => {
  await inRollback(async (client) => {
    const owner = await createOwner(client);
    const { generated: old, row: oldRow } = await insertKey(client, owner);
    const next = generateApplicationApiKey();

    // Serverdagi rotatsiya tranzaksiyasi bilan bir xil ketma-ketlik.
    await client.query(
      `UPDATE application_api_keys SET is_active=false, revoked_at=now(), revoked_by=$2, revoke_reason='Rotatsiya: test'
        WHERE id=$1`,
      [oldRow.id, owner],
    );
    await client.query(
      `INSERT INTO application_api_keys
         (public_id, name, secret_hash, masked_hint, scopes, expires_at, rate_limit_per_hour, rotated_from_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [next.publicId, oldRow.name, next.secretHash, next.maskedHint, oldRow.scopes,
       oldRow.expires_at, oldRow.rate_limit_per_hour, oldRow.id, owner],
    );

    assert.equal(await authenticate(client, old.token, old.publicId), null, 'eski kalit hamon ishlayapti');
    assert.notEqual(await authenticate(client, next.token, next.publicId), null, 'yangi kalit ishlamadi');

    const active = await client.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM application_api_keys
        WHERE is_active=true AND (id=$1 OR rotated_from_id=$1)`,
      [oldRow.id],
    );
    assert.equal(active.rows[0]!.total, 1, 'rotatsiyadan keyin bitta faol kalit qolishi kerak');
  });
});

test('bekor qilish sababsiz saqlanmaydi', needsDatabase, async () => {
  await inRollback(async (client) => {
    const owner = await createOwner(client);
    const { row } = await insertKey(client, owner);
    // CHECK constraint: nofaol kalitda sabab majburiy.
    await assert.rejects(
      () => client.query('UPDATE application_api_keys SET is_active=false, revoked_at=now() WHERE id=$1', [row.id]),
      (error: { code?: string }) => error.code === '23514',
    );
  });
});

test('plaintext secretni hash ustuniga yozib bo‘lmaydi', needsDatabase, async () => {
  await inRollback(async (client) => {
    const owner = await createOwner(client);
    const generated = generateApplicationApiKey();
    // CHECK constraint faqat 64 ta hex belgini qabul qiladi.
    await assert.rejects(
      () => client.query(
        `INSERT INTO application_api_keys (public_id, name, secret_hash, masked_hint, scopes, created_by)
         VALUES ($1,'Yomon',$2,$3,$4,$5)`,
        [generated.publicId, generated.token, generated.maskedHint, ['dictionary:read'], owner],
      ),
      (error: { code?: string }) => error.code === '23514',
    );
  });
});

test('bo‘sh scope bilan kalit yaratib bo‘lmaydi', needsDatabase, async () => {
  await inRollback(async (client) => {
    const owner = await createOwner(client);
    const generated = generateApplicationApiKey();
    await assert.rejects(
      () => client.query(
        `INSERT INTO application_api_keys (public_id, name, secret_hash, masked_hint, scopes, created_by)
         VALUES ($1,'Bo‘sh',$2,$3,$4,$5)`,
        [generated.publicId, generated.secretHash, generated.maskedHint, [], owner],
      ),
      (error: { code?: string }) => error.code === '23514',
    );
  });
});

test('administrator roli api_keys ruxsatlarini oladi, moderator olmaydi', needsDatabase, async () => {
  await inRollback(async (client) => {
    const admin = await client.query<{ permissions: string[] }>(`SELECT permissions FROM roles WHERE code='admin'`);
    assert.ok(admin.rows[0]!.permissions.includes('api_keys:write'));
    const moderator = await client.query<{ permissions: string[] }>(`SELECT permissions FROM roles WHERE code='moderator'`);
    assert.ok(!moderator.rows[0]!.permissions.includes('api_keys:read'));
    assert.ok(!moderator.rows[0]!.permissions.includes('api_keys:write'));
  });
});

test('last-used yozuvi cheklangan oynadan tez-tez yangilanmaydi', needsDatabase, async () => {
  await inRollback(async (client) => {
    const owner = await createOwner(client);
    const { row } = await insertKey(client, owner);
    const throttled = `UPDATE application_api_keys
        SET last_used_at=now(), last_used_ip=$2
      WHERE id=$1 AND (last_used_at IS NULL OR last_used_at < now() - ($3 || ' minutes')::interval)`;

    const first = await client.query(throttled, [row.id, '127.0.0.1', '5']);
    assert.equal(first.rowCount, 1, 'birinchi yozuv o‘tishi kerak');
    const second = await client.query(throttled, [row.id, '127.0.0.1', '5']);
    assert.equal(second.rowCount, 0, 'darhol keyingi yozuv o‘tkazib yuborilishi kerak');
  });
});
