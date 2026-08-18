import type { UpdateCheckResponse, UpdateType } from '../contract/appUpdates';

/**
 * Ilova yangilanishini KO'RSATISH qoidalari.
 *
 * Bu yerda tarmoq ham, React ham yo'q — faqat qaror. Shu sabab qoidalar
 * testdan o'tadi va ikkala ilova (foydalanuvchi va admin) bir xil xulq
 * ko'rsatadi.
 *
 * Server "yangilanish bormi" degan savolga javob beradi; bu modul esa
 * "hozir ko'rsatilsinmi va bloklansinmi" degan savolga.
 */

/** Rad etilgandan keyin qayta ko'rsatilmaydigan muddat. */
export const UPDATE_COOLDOWN_MS: Record<Exclude<UpdateType, 'REQUIRED'>, number> = {
  OPTIONAL: 24 * 60 * 60 * 1_000,
  RECOMMENDED: 6 * 60 * 60 * 1_000,
};

/**
 * Keshlangan javob shu muddatdan keyin "ishonchsiz" bo'ladi.
 *
 * Majburiy yangilanish uchun bu hal qiluvchi: internetsiz qolgan telefon
 * eski qarorga tayanib abadiy bloklanib qolmasligi kerak.
 */
export const UPDATE_CACHE_TRUST_MS = 7 * 24 * 60 * 60 * 1_000;

export interface UpdateDismissal {
  versionCode: number;
  untilMs: number;
}

/** Keshlangan tekshiruv hali ishonchlimi. */
export function isCacheTrusted(checkedAtMs: number | null | undefined, now: number): boolean {
  if (!checkedAtMs) return false;
  return now - checkedAtMs < UPDATE_CACHE_TRUST_MS;
}

/**
 * Ilovaga kirish to'silsinmi.
 *
 * Faqat ikki shart bir vaqtda bajarilganda: server MAJBURIY dedi VA bu
 * javob ishonchli (hozir olingan yoki yaqinda keshlangan). Tarmoq
 * xatosi tufayli ishlab turgan ilova to'satdan yopilib qolmaydi.
 */
export function isBlockingUpdate(update: UpdateCheckResponse | null, trusted: boolean): boolean {
  if (!update?.updateAvailable) return false;
  return update.updateType === 'REQUIRED' && trusted;
}

/**
 * Taklif oynasi ko'rsatilsinmi.
 *
 * Rad etish aynan bitta versiyaga tegishli: yangi reliz chiqsa hisob
 * qaytadan boshlanadi va foydalanuvchi undan xabar topadi.
 */
export function shouldPromptForUpdate(input: {
  update: UpdateCheckResponse | null;
  dismissal: UpdateDismissal | null;
  trusted: boolean;
  now: number;
}): boolean {
  const { update, dismissal, trusted, now } = input;
  if (!update?.updateAvailable) return false;
  // Majburiy yangilanish oyna emas, to'siq bilan ko'rsatiladi.
  if (isBlockingUpdate(update, trusted)) return false;
  if (!dismissal) return true;
  if (dismissal.versionCode !== update.latestVersionCode) return true;
  return dismissal.untilMs <= now;
}

/** Rad etish yozuvini yasaydi. */
export function buildDismissal(update: UpdateCheckResponse, now: number): UpdateDismissal | null {
  if (!update.updateAvailable || update.updateType === 'REQUIRED') return null;
  const cooldown = UPDATE_COOLDOWN_MS[update.updateType] ?? UPDATE_COOLDOWN_MS.OPTIONAL;
  return { versionCode: update.latestVersionCode, untilMs: now + cooldown };
}

/** Yangilanishni boshlash uchun kerakli ma'lumot to'liqmi. */
export function isDownloadable(update: UpdateCheckResponse | null): update is UpdateCheckResponse & { downloadUrl: string; sha256: string } {
  return Boolean(update?.updateAvailable && update.downloadUrl && update.sha256);
}
