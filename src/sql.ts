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

/**
 * «Biz haqimizda» matnini yozish.
 *
 * Yuqoridagi ikki so'rov bilan bir xil sinfdagi xavf: `COALESCE` ichidagi
 * turlanmagan `NULL` parametr `text` deb taxmin qilinmasligi mumkin va
 * bu faqat jonli bazada ko'rinadigan `42804`/`42P08` beradi. Shu sabab
 * har bir parametr aniq turga cast qilingan va so'rov shu yerda —
 * `sql.test.ts` uni haqiqiy PostgreSQL parseriga beradi.
 *
 * Parametrlar: `$1` key, `$2` yangi sarlavha (yoki NULL), `$3` yangi matn
 * (yoki NULL), `$4`/`$5` — yozuv umuman bo'lmaganda ishlatiladigan
 * boshlang'ich qiymatlar, `$6` — o'zgartirgan admin.
 */
export const UPSERT_APP_CONTENT = `INSERT INTO app_content (key, title, body, updated_by)
   VALUES ($1::text, COALESCE($2::text, $4::text), COALESCE($3::text, $5::text), $6::uuid)
   ON CONFLICT (key) DO UPDATE
     SET title = COALESCE($2::text, app_content.title),
         body = COALESCE($3::text, app_content.body),
         updated_at = now(),
         updated_by = $6::uuid`;

/**
 * Ro'yxatda qolmagan havolani o'chiradi.
 *
 * Bo'sh massiv barcha havolalarni tozalaydi — bu «hato ma'lumotni
 * o'chirish» talabining to'g'ri xulqi, xato emas.
 */
export const DELETE_MISSING_CONTENT_LINKS = `DELETE FROM app_content_links
  WHERE content_key = $1::text AND NOT (id = ANY($2::uuid[]))`;

export const UPDATE_APP_CONTENT_LINK = `UPDATE app_content_links
    SET kind=$3::app_content_link_kind, label=$4::text, value=$5::text, url=$6::text,
        sort_order=$7::integer, is_active=$8::boolean
  WHERE id=$1::uuid AND content_key=$2::text RETURNING id`;

export const INSERT_APP_CONTENT_LINK = `INSERT INTO app_content_links
    (content_key, kind, label, value, url, sort_order, is_active)
  VALUES ($1::text,$2::app_content_link_kind,$3::text,$4::text,$5::text,$6::integer,$7::boolean)`;
