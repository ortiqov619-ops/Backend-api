import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool } from 'pg';
import { INSERT_VALIDATION_RESULT, jsonb, UPDATE_REQUEST_RESOLUTION } from './sql';

/**
 * Bu fayl ikkita jonli `500` ni qaytarib kelmasligi uchun yozilgan.
 *
 * Muhimi: bu nuqsonlarni birorta ham sof unit test tuta olmaydi. Ikkalasi ham
 * SQL matnidagi turlar deduksiyasida edi — TypeScript ularni ko'rmaydi va
 * so'rov faqat haqiqiy PostgreSQL parser'iga yetganda yiqiladi. Shuning uchun
 * asosiy tekshiruvlar `TEST_DATABASE_URL` berilganda haqiqiy bazada bajariladi:
 *
 *   TEST_DATABASE_URL=postgres://... npm test
 *
 * Baza berilmasa ular o'tkazib yuboriladi (`skip`), lekin quyidagi sof
 * tekshiruvlar har doim ishlaydi.
 */

const REASONS = [
  { code: 'dialect_marker', severity: 'info', weight: 5, evidence: 'qipchoq y-j almashinuvi' },
  { code: 'no_marker', severity: 'warning', weight: -8, evidence: 'Xorazm shevasiga xos belgi topilmadi.' },
];

test('jsonb() massivni JSON qiladi, PostgreSQL massiv literaliga aylantirmaydi', () => {
  const encoded = jsonb(REASONS);
  assert.equal(typeof encoded, 'string');
  // Nuqsonning belgisi aynan shu edi: `{"{\"code\"...` ko'rinishidagi
  // PostgreSQL massiv literali. To'g'ri qiymat `[` bilan boshlanadi.
  assert.ok(encoded!.startsWith('['), `JSON massiv kutilgandi, kelgani: ${encoded!.slice(0, 20)}`);
  assert.deepEqual(JSON.parse(encoded!), REASONS);
});

test('jsonb() obyektni ham, null/undefined ni ham to‘g‘ri uzatadi', () => {
  assert.equal(jsonb({ word: 'tovoq' }), '{"word":"tovoq"}');
  assert.equal(jsonb(null), null);
  assert.equal(jsonb(undefined), null);
  assert.equal(jsonb([]), '[]');
});

test('CASE ichidagi har bir parametr aniq turga cast qilingan', () => {
  // `CASE ... ELSE $n END` ichida cast bo'lmasa PostgreSQL parametr turini
  // ustundan emas, ikkinchi shoxdagi turlanmagan `NULL` dan chiqaradi va uni
  // `text` deb hisoblaydi. Cast'siz `$n` qolib ketmaganini tekshiramiz.
  const bareParamInsideCase = /ELSE\s+\$\d+\s+END/i;
  assert.ok(
    !bareParamInsideCase.test(UPDATE_REQUEST_RESOLUTION),
    'CASE ichida cast qilinmagan parametr bor — 42804 qaytadi',
  );
  assert.match(UPDATE_REQUEST_RESOLUTION, /ELSE \$5::uuid END/);
});

// ---------------------------------------------------------------------------
// Haqiqiy bazaga qarshi tekshiruvlar
// ---------------------------------------------------------------------------

const databaseUrl = process.env.TEST_DATABASE_URL;
const needsDatabase = { skip: databaseUrl ? false : 'TEST_DATABASE_URL berilmagan' };

/**
 * Har bir tekshiruv o'z tranzaksiyasida bajariladi va oxirida `ROLLBACK`
 * qilinadi, shuning uchun test bazada iz qoldirmaydi.
 */
async function inRollback(run: (client: import('pg').PoolClient, fixtures: { adminId: string; requestId: string }) => Promise<void>) {
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const adminId = (await client.query<{ id: string }>(
      `INSERT INTO users (email, full_name, password_hash) VALUES ($1,'SQL test','x') RETURNING id`,
      [`sql-test-${Date.now()}-${Math.random()}@test.local`],
    )).rows[0].id;
    const requestId = (await client.query<{ id: string }>(
      `INSERT INTO contribution_requests (payload, idempotency_key, validation_verdict, validation_score, requires_human_review)
       VALUES ('{"word":"tovoq","meaning":"idish"}'::jsonb, $1, 'needs_manual_review', 55, true) RETURNING id`,
      [`sql-test-${Date.now()}-${Math.random()}`],
    )).rows[0].id;
    await run(client, { adminId, requestId });
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
    await pool.end();
  }
}

test('so‘rovni tasdiqlash moderator id sini uuid sifatida yozadi', needsDatabase, async () => {
  await inRollback(async (client, { adminId, requestId }) => {
    // Nuqson bor paytda shu chaqiruv `42804` bilan yiqilardi va admin panelda
    // "Serverda kutilmagan xatolik yuz berdi" ko'rinardi.
    await client.query(UPDATE_REQUEST_RESOLUTION, [
      requestId, 'approved', jsonb({ word: 'tovoq' }), null, adminId, null,
    ]);
    const row = (await client.query(
      'SELECT status::text, resolved_by_user_id, resolved_at FROM contribution_requests WHERE id=$1',
      [requestId],
    )).rows[0];
    assert.equal(row.status, 'approved');
    assert.equal(row.resolved_by_user_id, adminId);
    assert.notEqual(row.resolved_at, null);
  });
});

test('aniqlashtirish so‘ralganda hal qiluvchi va vaqt bo‘sh qoladi', needsDatabase, async () => {
  await inRollback(async (client, { adminId, requestId }) => {
    await client.query(UPDATE_REQUEST_RESOLUTION, [
      requestId, 'needs_clarification', jsonb({ word: 'tovoq' }), 'Ma’noni aniqlashtiring', adminId, null,
    ]);
    const row = (await client.query(
      'SELECT status::text, resolved_by_user_id, resolved_at FROM contribution_requests WHERE id=$1',
      [requestId],
    )).rows[0];
    assert.equal(row.status, 'needs_clarification');
    assert.equal(row.resolved_by_user_id, null);
    assert.equal(row.resolved_at, null);
  });
});

test('tekshiruv sabablari jsonb massiv sifatida yoziladi va o‘qiladi', needsDatabase, async () => {
  await inRollback(async (client, { requestId }) => {
    // Nuqson bor paytda shu chaqiruv `22P02 invalid input syntax for type json`
    // bilan yiqilardi va foydalanuvchi so'z yubora olmasdi.
    await client.query(INSERT_VALIDATION_RESULT, [
      requestId, 'word_text', 'needs_manual_review', 55, 0.7, jsonb(REASONS),
      'rules', 'text-v1', '1', 'server', null,
    ]);
    const stored = (await client.query(
      'SELECT reasons FROM validation_results WHERE contribution_request_id=$1',
      [requestId],
    )).rows[0].reasons;
    assert.ok(Array.isArray(stored), 'jsonb massiv sifatida qaytishi kerak');
    assert.deepEqual(stored, REASONS);
  });
});

test('sabablarni jsonb() siz yuborish hamon xato beradi (nuqson qaytsa tutamiz)', needsDatabase, async () => {
  await inRollback(async (client, { requestId }) => {
    await assert.rejects(
      () => client.query(INSERT_VALIDATION_RESULT, [
        requestId, 'word_text', 'needs_manual_review', 55, 0.7, REASONS as unknown,
        'rules', 'text-v1', '1', 'server', null,
      ]),
      (error: { code?: string }) => error.code === '22P02',
      'massivni to‘g‘ridan-to‘g‘ri yuborish 22P02 berishi kerak',
    );
  });
});
