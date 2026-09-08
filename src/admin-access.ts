/**
 * Admin endpointiga kirish qarori.
 *
 * NEGA ALOHIDA MODUL: bu yerdagi yagona nozik joy — "token yaroqsiz"
 * bilan "ruxsat yetmaydi" ni ARALASHTIRMASLIK. Ular bir xil ko'rinadi
 * (ikkalasida ham amal bajarilmaydi), lekin mijoz ularga BUTUNLAY
 * boshqacha javob beradi:
 *
 *   401 → tokenni yangilaydi va so'rovni takrorlaydi
 *   403 → yangilamaydi, foydalanuvchiga xato ko'rsatadi
 *
 * Ilgari muddati o'tgan token 403 olardi. Access token 15 daqiqa
 * yashaydi, shuning uchun admin ishlagan sayin ilova "buzilardi":
 * takliflarni tasdiqlash «Bu amal uchun ruxsatingiz yo'q» deb rad
 * etilardi, boshqaruv ekranlari esa «Xatolik» ko'rsatardi. Sabab rolda
 * emas, tokenda edi.
 */

export type AdminAccessDecision =
  | { allowed: true }
  | { allowed: false; status: 401; code: 'unauthorized'; message: string }
  | { allowed: false; status: 403; code: 'forbidden'; message: string };

export interface AdminAccessInput {
  /** `Authorization: Bearer ...` sarlavhasi bormi. */
  hasBearer: boolean;
  /** Token imzosi va muddati tekshiruvdan o'tdimi. */
  tokenValid: boolean;
  /** Tokendagi ruxsatlar. */
  permissions: readonly string[];
  /** Endpoint talab qiladigan ruxsat. */
  required: string;
}

export function decideAdminAccess(input: AdminAccessInput): AdminAccessDecision {
  if (!input.hasBearer) {
    return { allowed: false, status: 401, code: 'unauthorized', message: 'Avval tizimga kiring.' };
  }
  if (!input.tokenValid) {
    // Yangilash bu holatni hal qiladi — shuning uchun 401, 403 emas.
    return { allowed: false, status: 401, code: 'unauthorized', message: 'Sessiya muddati tugadi. Qaytadan kiring.' };
  }
  if (!input.permissions.includes(input.required)) {
    // Tokenni yangilash yordam bermaydi: rol shunchaki yetarli emas.
    return { allowed: false, status: 403, code: 'forbidden', message: 'Bu amal uchun ruxsat yo‘q.' };
  }
  return { allowed: true };
}
