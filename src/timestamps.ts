/**
 * Vaqt qiymatlarini javobga tayyorlash.
 *
 * Alohida modulda, chunki bu yerdagi xato jimgina va qimmatga tushadi.
 *
 * `pg` `timestamptz` ustunini JS `Date` obyekti sifatida qaytaradi. Uni
 * `new Date(String(value))` orqali qayta o'qish millisekundlarni yo'qotadi:
 * `String(date)` → `"Mon Aug 17 2026 18:21:41 GMT+0500"`, ya'ni faqat
 * soniyagacha aniqlik qoladi.
 *
 * Bu shunchaki go'zallik masalasi emas. `updated_at` optimistik qulf uchun
 * ishlatiladi: moderator qaror yuborganda u ko'rgan `updatedAt` server
 * qiymatiga teng bo'lishi kerak, aks holda `409` qaytadi. Soniyagacha
 * yaxlitlanganda bir soniya ichida ish ko'rgan ikkita moderator bir xil
 * deb hisoblanardi va ikkinchi qaror birinchisining ustiga jimgina
 * yozilardi — aynan shu holat sinovda aniqlandi.
 */

export function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

/** Bo'sh qiymatda `null`; aks holda to'liq aniqlikdagi ISO-8601. */
export function iso(value: unknown): string | null {
  return value ? toDate(value).toISOString() : null;
}

/** Har doim qiymat kutiladigan ustunlar uchun. */
export function requiredIso(value: unknown): string {
  return toDate(value).toISOString();
}
