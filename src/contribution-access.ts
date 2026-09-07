/**
 * Hissa qo'shishga kim ruxsat oladi.
 *
 * Hissa qo'shish hisobsiz ham ochiq. Shu sabab «bloklash» ning aniq
 * chegarasi bo'lishi kerak, aks holda u ma'nosini yo'qotadi: bloklangan
 * odam hisobdan chiqib, mehmon sifatida yozishda davom etardi.
 *
 * SIYOSAT
 *
 *   1. Token bor, hisob faol          → hisobga bog'langan taklif.
 *   2. Token bor, hisob bloklangan    → 403. Mehmonga «tushib» qolmaydi.
 *   3. Token bor, lekin yaroqsiz      → mehmon. (Hisob o'chirilgan yoki
 *      token eskirgan bo'lishi mumkin; bu bloklash emas.)
 *   4. Token yo'q, lekin qurilma
 *      bloklangan hisobniki           → 403.
 *   5. Qolgan hammasi                 → mehmon.
 *
 * CHEGARA — ATAYLAB OCHIQ AYTILADI
 *
 * 4-band `users.installation_id` ga tayanadi. Ilovani o'chirib qayta
 * o'rnatgan odam yangi `installationId` oladi va bu tekshiruvdan o'tib
 * ketadi. Ya'ni bu — to'siq emas, qaytarish narxini oshiradigan chora.
 * Yagona haqiqiy himoya moderatsiya navbati va barqaror `Mehmon A1`
 * yorlig'i bo'lib qoladi: moderator bir qurilmadan kelayotgan takroriy
 * takliflarni baribir ko'radi.
 *
 * Bu yerda «bloklangan odam hech qachon yoza olmaydi» deb yozib
 * bo'lmaydi, chunki bu haqiqat emas.
 */

export type ContributionAccessDecision =
  | { kind: 'account'; userId: string }
  | { kind: 'guest' }
  | { kind: 'blocked'; reason: string | null };

export interface ContributionAccessInput {
  /** `Authorization: Bearer …` sarlavhasi berilganmi. */
  hasBearerToken: boolean;
  /** Token yaroqli bo'lsa — unga tegishli faol hisob. */
  activeAccount: { id: string } | null;
  /** Token yaroqli bo'lsa va hisob bloklangan bo'lsa — sababi bilan. */
  blockedAccountByToken: { blockedReason: string | null } | null;
  /** Shu qurilmaga bog'langan bloklangan hisob (token bo'lmasa ham). */
  blockedAccountByDevice: { blockedReason: string | null } | null;
}

export function decideContributionAccess(input: ContributionAccessInput): ContributionAccessDecision {
  // 2 — token bilan kelgan bloklangan hisob.
  if (input.blockedAccountByToken) {
    return { kind: 'blocked', reason: input.blockedAccountByToken.blockedReason };
  }
  // 1 — faol hisob.
  if (input.activeAccount) {
    return { kind: 'account', userId: input.activeAccount.id };
  }
  // 4 — hisobdan chiqqan, lekin o'sha qurilma.
  if (input.blockedAccountByDevice) {
    return { kind: 'blocked', reason: input.blockedAccountByDevice.blockedReason };
  }
  // 3 va 5 — mehmon.
  return { kind: 'guest' };
}

/** Foydalanuvchiga ko'rsatiladigan matn. Sabab bo'lmasa ham bo'sh qolmaydi. */
export function blockedMessage(reason: string | null): string {
  return `Hisobingiz bloklangan. Sabab: ${reason?.trim() || 'ko‘rsatilmagan'}`;
}
