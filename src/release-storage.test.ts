import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { APP_TYPES } from './app-releases';
import {
  ARTIFACT_CHUNK_BYTES,
  deleteReleaseArtifact,
  getReleaseArtifactMeta,
  putReleaseArtifact,
  releaseArtifactExists,
  safeLegacyPath,
  sha256Of,
  streamReleaseArtifact,
} from './release-storage';

// ---------------------------------------------------------------------------
// Sof tekshiruvlar
// ---------------------------------------------------------------------------

test('checksum baytlardan hisoblanadi', () => {
  const bytes = Buffer.from('xorazm');
  assert.match(sha256Of(bytes), /^[0-9a-f]{64}$/);
  assert.equal(sha256Of(bytes), sha256Of(Buffer.from('xorazm')));
  assert.notEqual(sha256Of(bytes), sha256Of(Buffer.from('xorazn')));
});

test('eski disk yo‘li saqlash katalogidan tashqariga chiqa olmaydi', () => {
  // `storage_key` bazadan keladi, lekin unga ishonib bo'lmaydi.
  assert.equal(safeLegacyPath('/var/apk', '../../etc/passwd'), null);
  assert.equal(safeLegacyPath('/var/apk', '/etc/passwd'), null);
  assert.equal(safeLegacyPath('/var/apk', '..'), null);
  assert.equal(safeLegacyPath('/var/apk', null), null);
  assert.equal(safeLegacyPath('/var/apk', 'user-20.apk'), '/var/apk/user-20.apk');
});

test('reliz turlari faqat USER va ADMIN', () => {
  // Noto'g'ri appType bilan yuklab olish yo'li umuman ochilmasligi kerak.
  assert.deepEqual([...APP_TYPES].sort(), ['ADMIN', 'USER']);
});

// ---------------------------------------------------------------------------
// Baza tekshiruvlari
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

/** Oqimni to'liq o'qib, baytlarni qaytaradi. */
async function collectStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const chunk of stream) parts.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(parts);
}

/** Test relizi. `version_code` to'qnashmasligi uchun yuqori diapazon. */
async function createRelease(client: PoolClient, appType: 'USER' | 'ADMIN', versionCode: number) {
  const created = await client.query<{ id: string }>(
    `INSERT INTO app_releases
       (app_type, platform, version_name, version_code, update_type, download_url, storage_key, file_size, sha256, is_active)
     VALUES ($1::app_type,'ANDROID','9.9.9',$2,'RECOMMENDED','https://example.test/a.apk',$3,10,$4,true)
     RETURNING id`,
    [appType, versionCode, `${appType.toLowerCase()}-${versionCode}.apk`, 'a'.repeat(64)],
  );
  return created.rows[0]!.id;
}

test('artefakt saqlanadi va aynan o‘sha baytlar qaytadi', needsDatabase, async () => {
  await inRollback(async (client) => {
    const id = await createRelease(client, 'USER', 900001);
    const bytes = randomBytes(2048);
    await putReleaseArtifact(client, id, bytes, sha256Of(bytes));

    assert.equal(await releaseArtifactExists(client, id), true);
    const meta = await getReleaseArtifactMeta(client, id);
    assert.equal(meta!.sizeBytes, bytes.length);
    assert.equal(meta!.sha256, sha256Of(bytes));
    const read = await collectStream(streamReleaseArtifact(client, id));
    assert.equal(read.length, bytes.length);
    assert.equal(sha256Of(read), sha256Of(bytes), 'baytlar o‘zgargan');
  });
});

test('checksum mos kelmasa artefakt saqlanmaydi', needsDatabase, async () => {
  await inRollback(async (client) => {
    const id = await createRelease(client, 'USER', 900002);
    const bytes = randomBytes(512);
    await assert.rejects(
      () => putReleaseArtifact(client, id, bytes, 'b'.repeat(64)),
      /checksum/i,
    );
    assert.equal(await releaseArtifactExists(client, id), false, 'buzilgan artefakt yozilib qolibdi');
  });
});

test('artefakt yo‘q bo‘lsa null qaytadi — 500 emas', needsDatabase, async () => {
  await inRollback(async (client) => {
    const id = await createRelease(client, 'ADMIN', 900003);
    assert.equal(await releaseArtifactExists(client, id), false);
    assert.equal(await getReleaseArtifactMeta(client, id), null);
    assert.equal((await collectStream(streamReleaseArtifact(client, id))).length, 0);
  });
});

test('qayta yuklash artefaktni almashtiradi, dublikat yaratmaydi', needsDatabase, async () => {
  await inRollback(async (client) => {
    const id = await createRelease(client, 'USER', 900004);
    const first = randomBytes(256);
    const second = randomBytes(512);
    await putReleaseArtifact(client, id, first, sha256Of(first));
    await putReleaseArtifact(client, id, second, sha256Of(second));

    const rows = await client.query<{ total: number }>(
      'SELECT count(*)::int AS total FROM app_release_artifacts WHERE release_id = $1::uuid', [id],
    );
    assert.equal(rows.rows[0]!.total, 1);
    const read = await collectStream(streamReleaseArtifact(client, id));
    assert.equal(sha256Of(read), sha256Of(second));
  });
});

test('artefakt reliz yozuvi bilan birga o‘chadi', needsDatabase, async () => {
  await inRollback(async (client) => {
    const id = await createRelease(client, 'USER', 900005);
    const bytes = randomBytes(128);
    await putReleaseArtifact(client, id, bytes, sha256Of(bytes));
    await client.query('DELETE FROM app_releases WHERE id = $1::uuid', [id]);
    for (const table of ['app_release_artifacts', 'app_release_artifact_chunks']) {
      const rows = await client.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM ${table} WHERE release_id = $1::uuid`, [id],
      );
      assert.equal(rows.rows[0]!.total, 0, `CASCADE ishlamadi: ${table}`);
    }
  });
});

test('artefaktni alohida o‘chirish reliz yozuvini saqlaydi', needsDatabase, async () => {
  await inRollback(async (client) => {
    const id = await createRelease(client, 'ADMIN', 900006);
    const bytes = randomBytes(128);
    await putReleaseArtifact(client, id, bytes, sha256Of(bytes));
    await deleteReleaseArtifact(client, id);
    assert.equal(await releaseArtifactExists(client, id), false);
    const release = await client.query('SELECT id FROM app_releases WHERE id = $1::uuid', [id]);
    assert.ok(release.rows[0], 'reliz tarixi o‘chib ketdi');
  });
});

test('retention eng yangi relizni hech qachon o‘chirmaydi', needsDatabase, async () => {
  await inRollback(async (client) => {
    // Uchta reliz; retention = 1 bo'lsa faqat eng yangisi qoladi.
    const ids: string[] = [];
    for (const code of [900010, 900011, 900012]) ids.push(await createRelease(client, 'USER', code));

    const stale = await client.query<{ id: string }>(
      `SELECT id FROM app_releases
        WHERE app_type='USER'::app_type AND platform='ANDROID' AND version_code >= 900010
        ORDER BY version_code DESC OFFSET 1`,
    );
    const staleIds = stale.rows.map((row) => row.id);
    assert.equal(staleIds.length, 2);
    // Eng yangisi (900012) ro'yxatda bo'lmasligi SHART.
    assert.ok(!staleIds.includes(ids[2]!), 'eng yangi reliz o‘chirishga tushib qoldi');
    assert.ok(staleIds.includes(ids[0]!) && staleIds.includes(ids[1]!));
  });
});

test('USER va ADMIN retention bir-biriga aralashmaydi', needsDatabase, async () => {
  await inRollback(async (client) => {
    const userId = await createRelease(client, 'USER', 900020);
    await createRelease(client, 'ADMIN', 900021);
    const stale = await client.query<{ id: string }>(
      `SELECT id FROM app_releases
        WHERE app_type='ADMIN'::app_type AND platform='ANDROID' AND version_code >= 900020
        ORDER BY version_code DESC OFFSET 1`,
    );
    assert.ok(!stale.rows.some((row) => row.id === userId), 'ADMIN tozalashi USER relizini tanladi');
  });
});

test('katta artefakt bir nechta bo‘lakka bo‘linadi', needsDatabase, async () => {
  await inRollback(async (client) => {
    const id = await createRelease(client, 'USER', 900030);
    // Ikki bo'lakdan sal ko'proq — chegaradagi holat.
    const bytes = randomBytes(ARTIFACT_CHUNK_BYTES * 2 + 1024);
    await putReleaseArtifact(client, id, bytes, sha256Of(bytes));

    const chunks = await client.query<{ total: number }>(
      'SELECT count(*)::int AS total FROM app_release_artifact_chunks WHERE release_id = $1::uuid', [id],
    );
    assert.equal(chunks.rows[0]!.total, 3, 'bo‘laklar soni kutilganidek emas');

    const read = await collectStream(streamReleaseArtifact(client, id));
    assert.equal(read.length, bytes.length);
    assert.equal(sha256Of(read), sha256Of(bytes), 'bo‘laklardan yig‘ilgan fayl buzilgan');
  });
});

test('kichikroq fayl qayta yuklanganda eski bo‘laklar qolmaydi', needsDatabase, async () => {
  await inRollback(async (client) => {
    const id = await createRelease(client, 'USER', 900031);
    const big = randomBytes(ARTIFACT_CHUNK_BYTES * 2);
    await putReleaseArtifact(client, id, big, sha256Of(big));
    const small = randomBytes(1024);
    await putReleaseArtifact(client, id, small, sha256Of(small));

    const read = await collectStream(streamReleaseArtifact(client, id));
    assert.equal(read.length, small.length, 'eski bo‘laklar qolib, fayl uzayib ketdi');
    assert.equal(sha256Of(read), sha256Of(small));
  });
});

test('bo‘lak hajmi xotira uchun xavfsiz chegarada', () => {
  // `bytea` sim orqali o'n oltilik matn sifatida ketadi — hajm
  // ikkilanadi. 512 MB lik instansiya uchun 4 MB xavfsiz.
  assert.ok(ARTIFACT_CHUNK_BYTES <= 8 * 1024 * 1024, 'bo‘lak juda katta');
  assert.ok(ARTIFACT_CHUNK_BYTES >= 1024 * 1024, 'bo‘lak juda kichik — so‘rovlar ko‘payadi');
});
