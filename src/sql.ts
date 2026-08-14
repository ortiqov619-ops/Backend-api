/**
 * Parametr turlari nozik bo'lgan SQL'lar.
 *
 * Bu yerdagi so'rovlar `server.ts` dan ajratib olingan, chunki `server.ts`
 * import qilinishi bilanoq portni band qiladi va shu sababli test ichidan
 * chaqirilmaydi. Ajratilgani uchun endi test aynan produksiyada bajariladigan
 * matnni tekshiradi — nusxasini emas.
 *
 * Ikkala so'rov ham bir xil sinfdagi nuqson tufayli jonli bazada `500` bergan
 * edi: PostgreSQL parametr turini o'zi taxmin qiladi va noto'g'ri taxmin
 * qiladi. TypeScript buni ko'rmaydi, chunki nuqson SQL matnida — shuning uchun
 * ular `sql.test.ts` da haqiqiy bazaga qarshi tekshiriladi.
 */

/**
 * `jsonb` ustuniga boradigan qiymatni matnga aylantiradi.
 *
 * `node-postgres` obyektni JSON qilib yuboradi, ammo massivni PostgreSQL
 * massiv literaliga (`{"..."}`) aylantiradi. Shu sababli `jsonb` ustuniga
 * yuborilgan JS massivi bazada
 * `22P02 invalid input syntax for type json` bilan yiqilardi — foydalanuvchi
 * so'z yuborganda `validation_results.reasons` aynan shu yo'ldan o'tadi.
 *
 * DIQQAT: bu faqat `jsonb` ustunlari uchun. `text[]` ustunlariga
 * (`audit_logs.actor_roles`, `dialects.marker_words`) massiv o'z holicha
 * uzatilishi kerak — ularni `jsonb()` ga o'rash ularni buzadi.
 */
export function jsonb(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

/**
 * Moderator so'rov bo'yicha qaror qabul qilganda yoziladigan yakuniy holat.
 *
 * Ikkita alohida tur nuqsoni shu bitta so'rovda edi:
 *
 * 1. `$2` uch joyda ishlatiladi. Cast bo'lmasa PostgreSQL uni bir joyda
 *    `moderation_status`, boshqasida `text` deb deduksiya qiladi va
 *    `42P08 inconsistent types deduced for parameter $2` bilan yiqiladi.
 *
 * 2. `resolved_by_user_id` — `uuid` ustuni, lekin `$5` `CASE` ichida turgani
 *    uchun PostgreSQL uning turini ustundan emas, `CASE` ning ikkinchi
 *    shoxidagi turlanmagan `NULL` dan chiqarib `text` deb hisoblardi:
 *    `42804 column "resolved_by_user_id" is of type uuid but expression is of
 *    type text`. Admin so'zni tasdiqlaganda chiqqan "Serverda kutilmagan
 *    xatolik yuz berdi" ning aynan sababi shu edi.
 *
 * Xulosa: `CASE` ichidagi har bir parametrga turini o'zimiz aytamiz.
 */
export const UPDATE_REQUEST_RESOLUTION = `UPDATE contribution_requests SET
    status = $2::moderation_status,
    payload = $3::jsonb,
    clarification_note = $4,
    resolved_at = CASE WHEN $2::moderation_status = 'needs_clarification' THEN NULL ELSE now() END,
    resolved_by_user_id = CASE WHEN $2::moderation_status = 'needs_clarification' THEN NULL ELSE $5::uuid END,
    result_word_id = $6::uuid
  WHERE id = $1::uuid`;

/**
 * Avtomatik tekshiruv natijasi. `reasons` — `jsonb`, va unga uzatiladigan
 * qiymat har doim `jsonb()` dan o'tishi kerak.
 */
export const INSERT_VALIDATION_RESULT = `INSERT INTO validation_results
    (contribution_request_id, subject, verdict, score, confidence, reasons,
     engine_kind, engine_name, engine_version, origin, geofence_version)
  VALUES ($1::uuid,$2::validation_subject,$3::validation_verdict,$4,$5,$6::jsonb,$7,$8,$9,$10::validation_origin,$11)`;
