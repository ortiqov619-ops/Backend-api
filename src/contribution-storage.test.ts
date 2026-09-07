import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool, type PoolClient } from 'pg';
import { deliver } from './notifications';
import { submitterDisplayName, GUEST_DISPLAY_PATTERN } from './guest-identity';
import { buildWordListFilters } from './word-filters';
import {
  DELETE_MISSING_CONTENT_LINKS,
  REGION_STATS_SQL,
  INSERT_APP_CONTENT_LINK,
  UPDATE_APP_CONTENT_LINK,
  UPSERT_APP_CONTENT,
} from './sql';

/**
 * Mehmon hissasi va admin filtrlarining BAZA tomonidagi tekshiruvi.
 *
 * Bu yerdagi nuqsonlarni sof unit test tuta olmaydi: ular constraint,
 * enum cast va NULL FK bilan bog'liq — ya'ni faqat haqiqiy PostgreSQL
 * ularni rad etadi yoki qabul qiladi. Shu sabab:
 *
 *   TEST_DATABASE_URL=postgres://... npm run test:api
 *
 * Baza berilmasa tekshiruvlar o'tkazib yuboriladi.
 *
 * Har bir tekshiruv o'z tranzaksiyasida ishlaydi va `ROLLBACK` bilan
 * tugaydi — bazada iz qolmaydi.
 */

const databaseUrl = process.env.TEST_DATABASE_URL;
const needsDatabase = { skip: databaseUrl ? false : 'TEST_DATABASE_URL berilmagan' };

const WORD_HAS_AUDIO_SQL = `EXISTS (SELECT 1 FROM audio_submissions au WHERE au.word_id = w.id AND au.superseded_at IS NULL)`;

function unique(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

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

/** Hissa qo'shishi mumkin bo'lgan ilova hisobi. */
async function createAppUser(client: PoolClient): Promise<{ id: string; displayName: string }> {
  const username = unique('guest_test').replace(/-/g, '_').slice(0, 24);
  const created = await client.query<{ id: string }>(
    `INSERT INTO users (full_name, display_name, username, pattern_hash, kind)
     VALUES ($1,$1,$2,'x','app') RETURNING id`,
    ['Test Foydalanuvchi', username],
  );
  return { id: created.rows[0]!.id, displayName: 'Test Foydalanuvchi' };
}

async function createModerator(client: PoolClient): Promise<string> {
  const created = await client.query<{ id: string }>(
    `INSERT INTO users (email, full_name, password_hash) VALUES ($1,'Moderator','x') RETURNING id`,
    [`${unique('moderator')}@test.local`],
  );
  return created.rows[0]!.id;
}

// ---------------------------------------------------------------------------
// 1. Mehmon hissasi
// ---------------------------------------------------------------------------

test('mehmon taklifi hisobsiz, anonim nom bilan saqlanadi', needsDatabase, async () => {
  await inRollback(async (client) => {
    const displayName = submitterDisplayName(null, 'installation-guest-1');
    assert.match(displayName, GUEST_DISPLAY_PATTERN);

    const created = await client.query<{ id: string; submitted_by_user_id: string | null; submitted_by_display_name: string }>(
      `INSERT INTO contribution_requests
         (payload, device, idempotency_key, validation_verdict, validation_score, requires_human_review,
          submitted_by_user_id, submitted_by_display_name)
       VALUES ('{"word":"gelyatir","meaning":"kelayotir"}'::jsonb, '{"installationId":"installation-guest-1"}'::jsonb,
               $1, 'needs_manual_review', 55, true, NULL, $2)
       RETURNING id, submitted_by_user_id, submitted_by_display_name`,
      [unique('guest-idem'), displayName],
    );
    const row = created.rows[0]!;
    assert.equal(row.submitted_by_user_id, null, 'mehmon yozuvida hisob bo‘lmasligi kerak');
    assert.equal(row.submitted_by_display_name, displayName);
    assert.match(row.submitted_by_display_name, GUEST_DISPLAY_PATTERN);
  });
});

test('hisob bilan yuborilgan taklif hisobga bog‘lanadi', needsDatabase, async () => {
  await inRollback(async (client) => {
    const user = await createAppUser(client);
    const displayName = submitterDisplayName({ display_name: user.displayName }, 'installation-account-1');
    assert.equal(displayName, user.displayName);

    const created = await client.query<{ submitted_by_user_id: string | null; submitted_by_display_name: string }>(
      `INSERT INTO contribution_requests
         (payload, idempotency_key, validation_verdict, validation_score, requires_human_review,
          submitted_by_user_id, submitted_by_display_name)
       VALUES ('{"word":"tovoq","meaning":"idish"}'::jsonb, $1, 'needs_manual_review', 55, true, $2::uuid, $3)
       RETURNING submitted_by_user_id, submitted_by_display_name`,
      [unique('account-idem'), user.id, displayName],
    );
    assert.equal(created.rows[0]!.submitted_by_user_id, user.id);
    assert.doesNotMatch(created.rows[0]!.submitted_by_display_name, GUEST_DISPLAY_PATTERN);
  });
});

test('mehmon taklifi uchun moderator bildirishnomasi actorsiz yoziladi', needsDatabase, async () => {
  await inRollback(async (client) => {
    const moderatorId = await createModerator(client);
    const requestId = (await client.query<{ id: string }>(
      `INSERT INTO contribution_requests (payload, idempotency_key, validation_verdict, validation_score, requires_human_review)
       VALUES ('{"word":"gelyatir","meaning":"kelayotir"}'::jsonb, $1, 'needs_manual_review', 55, true) RETURNING id`,
      [unique('guest-notify')],
    )).rows[0]!.id;

    // Aynan shu chaqiruv `actorUserId: null` bilan ketadi. FK NOT NULL
    // bo'lganda u 23502 bilan yiqilardi va mehmon taklifi navbatga
    // tushmay qolardi.
    const written = await deliver(client, [{
      recipientUserId: moderatorId,
      actorUserId: null,
      type: 'WORD_SUBMITTED',
      title: 'Yangi so‘z taklifi',
      body: 'Mehmon A1 «gelyatir» so‘zini yubordi.',
      entityType: 'contribution_request',
      entityId: requestId,
      data: { isGuest: true },
    }]);

    assert.equal(written, 1);
    const stored = (await client.query(
      'SELECT actor_user_id, body FROM notifications WHERE recipient_user_id=$1::uuid AND entity_id=$2',
      [moderatorId, requestId],
    )).rows[0];
    assert.equal(stored.actor_user_id, null);
    assert.match(String(stored.body), /Mehmon A1/);
  });
});

// ---------------------------------------------------------------------------
// 2. Admin filtrlari haqiqiy SQL sifatida
// ---------------------------------------------------------------------------

test('yig‘ilgan filtr bandlari PostgreSQL da bajariladi', needsDatabase, async () => {
  await inRollback(async (client) => {
    const cases = [
      buildWordListFilters({}, { isAdmin: false, hasAudioSql: WORD_HAS_AUDIO_SQL }),
      buildWordListFilters({ status: 'draft' }, { isAdmin: true, hasAudioSql: WORD_HAS_AUDIO_SQL }),
      buildWordListFilters({ status: 'archived' }, { isAdmin: true, hasAudioSql: WORD_HAS_AUDIO_SQL }),
      buildWordListFilters({ status: 'all', hasAudio: 'true' }, { isAdmin: true, hasAudioSql: WORD_HAS_AUDIO_SQL }),
      buildWordListFilters({ status: 'all', hasAudio: 'false' }, { isAdmin: true, hasAudioSql: WORD_HAS_AUDIO_SQL }),
      buildWordListFilters(
        { status: 'published', search: 'suv', regionId: '00000000-0000-4000-8000-000000000001', category: 'maishiy' },
        { isAdmin: true, hasAudioSql: WORD_HAS_AUDIO_SQL },
      ),
    ];
    for (const { clause, params } of cases) {
      // `word_status` enum cast va parametr raqamlari faqat haqiqiy
      // parserda tekshiriladi.
      await client.query(`SELECT count(*)::int AS total FROM words w ${clause}`, params);
    }
  });
});

test('qoralama so‘z faqat admin filtrida ko‘rinadi', needsDatabase, async () => {
  await inRollback(async (client) => {
    const word = unique('qoralama').replace(/-/g, '');
    await client.query(
      `INSERT INTO words (word, meaning, phonetic_key, status) VALUES ($1, 'test', $1, 'draft')`,
      [word],
    );

    const publicFilter = buildWordListFilters({ status: 'draft', search: word }, { isAdmin: false, hasAudioSql: WORD_HAS_AUDIO_SQL });
    const publicRows = await client.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM words w ${publicFilter.clause}`,
      publicFilter.params,
    );
    assert.equal(publicRows.rows[0]!.total, 0, 'ochiq ro‘yxatda qoralama ko‘rinmasligi kerak');

    const adminFilter = buildWordListFilters({ status: 'draft', search: word }, { isAdmin: true, hasAudioSql: WORD_HAS_AUDIO_SQL });
    const adminRows = await client.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM words w ${adminFilter.clause}`,
      adminFilter.params,
    );
    assert.equal(adminRows.rows[0]!.total, 1, 'admin «Qoralama» filtrida so‘z ko‘rinishi kerak');
  });
});

// ---------------------------------------------------------------------------
// 3. Hudud katalogi va ilova matni
// ---------------------------------------------------------------------------

test('yangi respublikalar katalogda va Xorazm hamon ochiq', needsDatabase, async () => {
  await inRollback(async (client) => {
    const republics = await client.query<{ code: string; is_contribution_allowed: boolean }>(
      `SELECT code, is_contribution_allowed FROM regions WHERE level = 'republic' ORDER BY sort_order`,
    );
    const codes = republics.rows.map((row) => row.code);
    for (const code of ['uz', 'turkmaniston', 'qoraqalpogiston', 'afgoniston']) {
      assert.ok(codes.includes(code), `${code} katalogda bo‘lishi kerak`);
    }
    // Yangi hududlar yopiq yaratiladi.
    for (const row of republics.rows.filter((item) => item.code !== 'uz')) {
      assert.equal(row.is_contribution_allowed, false, `${row.code} yopiq bo‘lishi kerak`);
    }
    // Mavjud xulq buzilmaganini tekshiramiz.
    const xorazm = await client.query<{ is_contribution_allowed: boolean }>(
      `SELECT is_contribution_allowed FROM regions WHERE code = 'xorazm'`,
    );
    assert.equal(xorazm.rows[0]!.is_contribution_allowed, true, 'Xorazm hissa qabuli o‘zgarmasligi kerak');
  });
});

test('ilova matni havolasi faqat xavfsiz sxema bilan saqlanadi', needsDatabase, async () => {
  await inRollback(async (client) => {
    await client.query(
      `INSERT INTO app_content_links (content_key, kind, label, value, url, sort_order)
       VALUES ('about', 'telegram_channel', 'Bizning telegram kanal', '@xorazmshevalari', 'https://t.me/xorazmshevalari', 0)`,
    );
    await assert.rejects(
      () => client.query(
        `INSERT INTO app_content_links (content_key, kind, label, value, url, sort_order)
         VALUES ('about', 'link', 'Yomon', 'x', 'javascript:alert(1)', 1)`,
      ),
      (error: { code?: string }) => error.code === '23514',
      'CHECK constraint xavfli sxemani rad etishi kerak',
    );
  });
});

test('admin roli content ruxsatlarini oladi', needsDatabase, async () => {
  await inRollback(async (client) => {
    const admin = await client.query<{ permissions: string[] }>(`SELECT permissions FROM roles WHERE code = 'admin'`);
    assert.ok(admin.rows[0]!.permissions.includes('content:read'));
    assert.ok(admin.rows[0]!.permissions.includes('content:write'));
    const moderator = await client.query<{ permissions: string[] }>(`SELECT permissions FROM roles WHERE code = 'moderator'`);
    assert.ok(moderator.rows[0]!.permissions.includes('content:read'));
    assert.ok(!moderator.rows[0]!.permissions.includes('content:write'), 'moderator matnni o‘zgartira olmasligi kerak');
  });
});

test('ilova matnini yozish so‘rovlari PostgreSQL da bajariladi', needsDatabase, async () => {
  await inRollback(async (client) => {
    const admin = await createModerator(client);

    // 1. Qisman yangilash: faqat sarlavha. `COALESCE` ichidagi
    //    turlanmagan NULL aynan shu yerda 42804/42P08 berardi.
    await client.query(UPSERT_APP_CONTENT, ['about', 'Yangi sarlavha', null, 'Zaxira', 'Zaxira matn', admin]);
    let row = (await client.query('SELECT title, body FROM app_content WHERE key = $1', ['about'])).rows[0];
    assert.equal(row.title, 'Yangi sarlavha');
    assert.notEqual(row.body, null, 'matn berilmaganda eskisi qolishi kerak');

    // 2. Faqat matn.
    await client.query(UPSERT_APP_CONTENT, ['about', null, 'Yangi matn', 'Zaxira', 'Zaxira matn', admin]);
    row = (await client.query('SELECT title, body FROM app_content WHERE key = $1', ['about'])).rows[0];
    assert.equal(row.title, 'Yangi sarlavha', 'sarlavha berilmaganda o‘zgarmasligi kerak');
    assert.equal(row.body, 'Yangi matn');

    // 3. Havola qo‘shish, tahrirlash va o‘chirish.
    await client.query(INSERT_APP_CONTENT_LINK, [
      'about', 'telegram_channel', 'Bizning telegram kanal', '@xorazmshevalari', 'https://t.me/xorazmshevalari', 0, true,
    ]);
    const linkId = (await client.query<{ id: string }>(
      `SELECT id FROM app_content_links WHERE content_key='about' ORDER BY created_at DESC LIMIT 1`,
    )).rows[0]!.id;

    const updated = await client.query(UPDATE_APP_CONTENT_LINK, [
      linkId, 'about', 'website', 'Sayt', 'xorazm.uz', 'https://xorazm.uz', 3, false,
    ]);
    assert.equal(updated.rowCount, 1);

    // Bo‘sh massiv barcha havolalarni o‘chiradi — «hato ma’lumotni
    // o‘chirish» talabining to‘g‘ri xulqi.
    await client.query(DELETE_MISSING_CONTENT_LINKS, ['about', []]);
    const remaining = await client.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM app_content_links WHERE content_key='about'`,
    );
    assert.equal(remaining.rows[0]!.total, 0);
  });
});

test('ro‘yxatda qolgan havola o‘chirilmaydi', needsDatabase, async () => {
  await inRollback(async (client) => {
    await client.query(INSERT_APP_CONTENT_LINK, [
      'about', 'telegram_channel', 'Kanal', '@a_kanal', 'https://t.me/a_kanal', 0, true,
    ]);
    await client.query(INSERT_APP_CONTENT_LINK, [
      'about', 'phone', 'Telefon', '+998901234567', 'tel:+998901234567', 1, true,
    ]);
    const ids = (await client.query<{ id: string }>(
      `SELECT id FROM app_content_links WHERE content_key='about' ORDER BY sort_order`,
    )).rows.map((row) => row.id);

    await client.query(DELETE_MISSING_CONTENT_LINKS, ['about', [ids[0]]]);
    const left = (await client.query<{ id: string }>(
      `SELECT id FROM app_content_links WHERE content_key='about'`,
    )).rows.map((row) => row.id);
    assert.deepEqual(left, [ids[0]]);
  });
});

// ---------------------------------------------------------------------------
// 4. Atlas uchun ochiq hudud statistikasi
// ---------------------------------------------------------------------------

test('hudud statistikasi SQL i PostgreSQL da bajariladi', needsDatabase, async () => {
  await inRollback(async (client) => {
    // Korrelatsiyalangan pastki so'rovlar tashqi `r` aliasiga tayanadi —
    // buni faqat haqiqiy parser tekshira oladi.
    const rows = await client.query(
      `SELECT r.id, r.name_uz, ${REGION_STATS_SQL} FROM regions r ORDER BY r.sort_order LIMIT 5`,
    );
    assert.ok(rows.rows.length > 0, 'katalog bo‘sh bo‘lmasligi kerak');
    for (const row of rows.rows) {
      assert.equal(typeof Number(row.word_count), 'number');
      assert.ok(Number(row.word_count) >= 0);
      assert.ok(Number(row.audio_count) >= 0);
      assert.ok(Number(row.audio_count) <= Number(row.word_count), 'audio soni so‘z sonidan oshmasligi kerak');
    }
  });
});

test('statistika faqat nashr etilgan so‘zni sanaydi', needsDatabase, async () => {
  await inRollback(async (client) => {
    const xorazm = '00000000-0000-4000-8000-000000000001';
    const before = (await client.query<{ word_count: number }>(
      `SELECT ${REGION_STATS_SQL} FROM regions r WHERE r.id = $1`, [xorazm],
    )).rows[0]!.word_count;

    const draft = unique('qoralama').replace(/-/g, '');
    await client.query(
      `INSERT INTO words (word, meaning, phonetic_key, status, region_id) VALUES ($1,'test',$1,'draft',$2)`,
      [draft, xorazm],
    );
    const afterDraft = (await client.query<{ word_count: number }>(
      `SELECT ${REGION_STATS_SQL} FROM regions r WHERE r.id = $1`, [xorazm],
    )).rows[0]!.word_count;
    assert.equal(Number(afterDraft), Number(before), 'qoralama ochiq statistikaga tushmasligi kerak');

    const published = unique('nashr').replace(/-/g, '');
    await client.query(
      `INSERT INTO words (word, meaning, phonetic_key, status, region_id) VALUES ($1,'test',$1,'published',$2)`,
      [published, xorazm],
    );
    const afterPublished = (await client.query<{ word_count: number }>(
      `SELECT ${REGION_STATS_SQL} FROM regions r WHERE r.id = $1`, [xorazm],
    )).rows[0]!.word_count;
    assert.equal(Number(afterPublished), Number(before) + 1, 'nashr etilgan so‘z sanalishi kerak');
  });
});

test('tuman va qishloqdagi so‘z viloyat sanog‘iga ham kiradi', needsDatabase, async () => {
  await inRollback(async (client) => {
    const xorazm = '00000000-0000-4000-8000-000000000001';
    const district = (await client.query<{ id: string }>(
      `SELECT id FROM regions WHERE parent_id = $1 AND level = 'district' LIMIT 1`, [xorazm],
    )).rows[0];
    if (!district) return; // katalog bo'sh bo'lsa tekshiradigan narsa yo'q

    const before = (await client.query<{ word_count: number }>(
      `SELECT ${REGION_STATS_SQL} FROM regions r WHERE r.id = $1`, [xorazm],
    )).rows[0]!.word_count;

    const word = unique('tuman').replace(/-/g, '');
    await client.query(
      `INSERT INTO words (word, meaning, phonetic_key, status, district_id) VALUES ($1,'test',$1,'published',$2)`,
      [word, district.id],
    );
    const after = (await client.query<{ word_count: number }>(
      `SELECT ${REGION_STATS_SQL} FROM regions r WHERE r.id = $1`, [xorazm],
    )).rows[0]!.word_count;
    assert.equal(Number(after), Number(before) + 1, 'tumandagi so‘z viloyatda ham ko‘rinishi kerak');
  });
});
