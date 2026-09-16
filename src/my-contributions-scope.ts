/**
 * «Mening takliflarim» kimga tegishli ekanini hal qiladi.
 *
 * NEGA ALOHIDA FAYL: mehmon ham so'z yuboradi, lekin uning hisobi yo'q —
 * qaror (ayniqsa rad etish) unga bildirishnoma orqali yeta olmaydi, chunki
 * bildirishnoma hisobga yoziladi. Mehmon uchun yagona yo'l — o'z
 * qurilmasidan yuborgan takliflarini ro'yxatda ko'rish. Bu qaror SQL
 * ichida yozilsa tekshirib bo'lmasdi; shu sababli u shu yerda, testlar
 * bilan.
 *
 * XAVFSIZLIK: qurilma identifikatori (`installationId`) telefonning xavfsiz
 * xotirasida turadi va hech qachon ekranga chiqmaydi. U bilan FAQAT shu
 * qurilmadan hisobsiz yuborilgan takliflar ochiladi — hisobga bog'langan
 * takliflar hech qachon emas. Ya'ni bu identifikator o'zganing hisobiga
 * kalit bo'lolmaydi.
 */
export interface MyContributionsScope {
  /** `contribution_requests cr` uchun WHERE sharti. */
  clause: string;
  /** Shartdagi $1, $2 … qiymatlari. */
  params: string[];
}

export function myContributionsScope(input: {
  userId: string | null;
  installationId: string | null;
}): MyContributionsScope {
  const installationId = input.installationId?.trim() || null;
  const own = 'cr.submitted_by_user_id = $1::uuid';
  const guest = "cr.submitted_by_user_id IS NULL AND cr.device->>'installationId' = $#";

  if (input.userId && installationId) {
    // Hisob ochgan odam avval mehmon sifatida yuborgan so'zlarini ham
    // ko'radi: aks holda hisob ochgan zahoti ular ro'yxatdan yo'qolardi.
    return {
      clause: `(${own} OR (${guest.replace('$#', '$2')}))`,
      params: [input.userId, installationId],
    };
  }
  if (input.userId) return { clause: own, params: [input.userId] };
  if (installationId) return { clause: `(${guest.replace('$#', '$1')})`, params: [installationId] };
  throw new Error('myContributionsScope: hisob ham, qurilma ham yo‘q');
}
