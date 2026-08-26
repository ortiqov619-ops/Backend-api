/**
 * Ilovaga qaysi imkoniyat «bor» deb ko'rsatilishi.
 *
 * Foydalanuvchi ilovasi tashqi xizmatga bog'liq tugmalarni faqat shu
 * qaror asosida chizadi. Ishlamaydigan tugmani ko'rsatib qo'yish
 * ilovani buzuq qilib ko'rsatadi, shuning uchun shubha bo'lganda
 * javob har doim «yo'q» bo'ladi.
 *
 * Imkoniyat «bor» hisoblanishi uchun TO'RTTA shart bir vaqtda
 * bajarilishi kerak:
 *
 *   1. serverda bu provider uchun haqiqiy mijoz yozilgan bo'lsin;
 *   2. admin uni yoqgan bo'lsin;
 *   3. kalit kiritilgan bo'lsin (kalitsiz yoqilgan integratsiya ishlamaydi);
 *   4. oxirgi sog'liq tekshiruvi muvaffaqiyatsiz bo'lmasin.
 */

/** Serverda haqiqiy mijozi bor providerlar. */
export const SUPPORTED_INTEGRATIONS = new Set(['stt_primary']);

export interface IntegrationRow {
  provider: string;
  isEnabled: boolean;
  hasSecret: boolean;
  health: string;
}

export function isIntegrationLive(row: IntegrationRow): boolean {
  if (!SUPPORTED_INTEGRATIONS.has(row.provider)) return false;
  if (!row.isEnabled) return false;
  if (!row.hasSecret) return false;
  // `unknown` — hali tekshirilmagan; kalit bor va yoqilgan bo'lsa
  // urinib ko'rishga arziydi. `failing` esa aniq nosozlik.
  return row.health !== 'failing' && row.health !== 'not_configured';
}

export interface AppFeatures {
  transcription: boolean;
  pushNotifications: boolean;
  dialectScoring: boolean;
}

export function appFeaturesFrom(rows: readonly IntegrationRow[]): AppFeatures {
  const live = new Set(rows.filter(isIntegrationLive).map((row) => row.provider));
  return {
    /** Yozilgan ovozni matnga o'girish. */
    transcription: live.has('stt_primary'),
    /** Push bildirishnomalar — serverda mijozi hali yozilmagan. */
    pushNotifications: live.has('push_notifications'),
    /** Sheva mosligini avtomatik baholash — serverda mijozi yo'q. */
    dialectScoring: live.has('dialect_model'),
  };
}
