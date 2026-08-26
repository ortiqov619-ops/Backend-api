import { createHash } from 'node:crypto';

/**
 * Hisobsiz («mehmon») hissa qo'shuvchining moderator ko'radigan nomi.
 *
 * Talab: hisob ochish ixtiyoriy, lekin moderator baribir bir odamning
 * takliflarini bir-biriga bog'lay olishi kerak — aks holda spam va
 * takroriy yuborishni ko'rib bo'lmaydi.
 *
 * Yechim: qurilma o'rnatish identifikatoridan barqaror, lekin ORQAGA
 * QAYTARIB BO'LMAYDIGAN yorliq hisoblanadi. Xeshlangani muhim: xom
 * `installationId` moderator ekraniga hech qachon chiqmasligi kerak, u
 * qurilmaning barqaror identifikatori va shaxsiy ma'lumot hisoblanadi.
 *
 * Format PDF talabidagidek: `Mehmon A1`.
 */

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const MAX_NUMBER = 99;

export const GUEST_DISPLAY_PREFIX = 'Mehmon';

/** Har qanday manbadan kelgan yorliqni tanib olish uchun. */
export const GUEST_DISPLAY_PATTERN = /^Mehmon [A-Z]([1-9]|[1-9]\d)$/;

/**
 * Barqaror mehmon yorlig'i.
 *
 * Bir xil qurilma har doim bir xil yorliqni oladi; turli qurilmalar
 * 26 × 99 = 2574 ta chelakka tarqaladi. To'qnashuv mumkin va bu ataylab:
 * yorliq shaxsni aniqlash uchun emas, moderatorga qo'pol signal berish
 * uchun. Identifikator bo'sh bo'lsa ham ekranda hech qachon bo'sh nom
 * turmasligi kerak, shuning uchun umumiy `Mehmon` qaytadi.
 */
export function guestDisplayName(installationId: string | null | undefined): string {
  const source = (installationId ?? '').trim();
  if (!source) return GUEST_DISPLAY_PREFIX;
  const digest = createHash('sha256').update(`xorazm-guest:${source}`).digest();
  const letter = LETTERS[digest[0]! % LETTERS.length]!;
  const number = (((digest[1]! << 8) | digest[2]!) % MAX_NUMBER) + 1;
  return `${GUEST_DISPLAY_PREFIX} ${letter}${number}`;
}

/**
 * Hissa yozuvida saqlanadigan nom.
 *
 * Hisob bo'lsa uning ko'rsatiladigan nomi ishlatiladi — moderator uni
 * yulduzcha va profil bilan ko'radi. Hisob bo'lmasa anonim yorliq
 * yoziladi, `submitted_by_user_id` esa `NULL` bo'lib qoladi.
 */
export function submitterDisplayName(
  account: { display_name?: unknown; full_name?: unknown } | null,
  installationId: string | null | undefined,
): string {
  if (!account) return guestDisplayName(installationId);
  const named = String(account.display_name ?? account.full_name ?? '').trim();
  return named || guestDisplayName(installationId);
}
