/**
 * Kirishdagi qisqa tanishuv qachon ko'rsatilishi.
 *
 * Talab: mehmon har ochishda «Biz haqimizda» ning qisqa ko'rinishini
 * ko'radi, hisobga kirgan foydalanuvchi esa markazdagi logo bilan
 * to'g'ridan-to'g'ri lug'atga tushadi.
 *
 * «Har ochish» ni tom ma'noda olish halaqit beradi: foydalanuvchi
 * boshqa ilovaga o'tib qaytganda yoki tizim ilovani qayta ishga
 * tushirganda tanishuvni yana kutib o'tirmasligi kerak. Shu sabab qaror
 * vaqt bo'yicha ishlaydi va u sof funksiya — `updates/policy.ts` bilan
 * bir xil yondashuv.
 */

export const INTRO_COOLDOWN_MS = 60_000;

export interface IntroDecisionInput {
  /** Hisobga kirilganmi. Kirgan foydalanuvchi tanishuvni ko'rmaydi. */
  hasAccount: boolean;
  /** Oxirgi ko'rsatilgan vaqt (ms). Hech qachon ko'rsatilmagan bo'lsa `null`. */
  lastShownAtMs: number | null;
  nowMs: number;
  cooldownMs?: number;
}

export function shouldShowIntro(input: IntroDecisionInput): boolean {
  if (input.hasAccount) return false;
  const { lastShownAtMs, nowMs } = input;
  if (lastShownAtMs === null) return true;
  // Buzilgan yoki kelajakdagi qiymat (qurilma soati orqaga surilgan)
  // tanishuvni abadiy yo'q qilib qo'ymasligi kerak.
  if (!Number.isFinite(lastShownAtMs) || lastShownAtMs > nowMs) return true;
  return nowMs - lastShownAtMs >= (input.cooldownMs ?? INTRO_COOLDOWN_MS);
}

/** Qurilmada saqlangan xom qiymatni raqamga keltiradi. */
export function parseIntroTimestamp(storedValue: string | null | undefined): number | null {
  if (!storedValue) return null;
  const parsed = Number(storedValue);
  return Number.isFinite(parsed) ? parsed : null;
}
