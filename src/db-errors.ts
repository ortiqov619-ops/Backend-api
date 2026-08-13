/**
 * PostgreSQL xatolarini xavfsiz HTTP javobiga tarjima qiladi.
 *
 * Ikki sabab bor:
 * 1. Ilgari faqat `23505` ushlanardi, qolgan barcha SQLSTATE global handlerga
 *    tushib `500 internal_error` bo'lardi. Moderator xatoning sababini
 *    ko'rmasdi, dasturchi esa qaysi cheklov ishlaganini bilmasdi.
 * 2. Xatoning `message`/`detail` maydonlarida ustun qiymatlari bo'ladi.
 *    Ular mijozga hech qachon chiqmasligi kerak — bu yerda faqat oldindan
 *    yozilgan matnlar ishlatiladi, tashqi matn ko'chirilmaydi.
 */

export interface DatabaseFault {
  status: number;
  code: string;
  message: string;
  /** `true` — bu server kodidagi nuqson, foydalanuvchi xatosi emas. */
  serverDefect: boolean;
}

/** Constraint nomi — ma'lumot emas, shuning uchun uni matnga bog'lash xavfsiz. */
const UNIQUE_MESSAGES: Record<string, string> = {
  words_unique_phonetic_per_region: 'Shunga o‘xshash so‘z bu hududda allaqachon mavjud.',
  contribution_requests_idempotency: 'Bu so‘rov allaqachon yuborilgan.',
  audio_submissions_one_per_request: 'Bu taklifga audio allaqachon biriktirilgan.',
  audio_submissions_unique_word_recording: 'Aynan shu audio lug‘at so‘ziga avval qo‘shilgan.',
  audio_submissions_idempotency_key_key: 'Bu audio allaqachon yuborilgan.',
  regions_code_key: 'Bunday hudud kodi allaqachon mavjud.',
  integration_secret_versions_provider_key_version_key: 'Bu kalit versiyasi allaqachon saqlangan.',
};

const CHECK_MESSAGES: Record<string, string> = {
  moderation_decisions_reason_required: 'Bu qaror uchun sabab yozish majburiy.',
  moderation_decisions_target: 'Qaror biror taklif yoki audioga bog‘lanishi kerak.',
  words_archived_consistency: 'So‘zning arxiv holati mos emas.',
  contribution_requests_resolved_consistency: 'So‘rovning yakunlanish holati mos emas.',
  contribution_requests_coords_pair: 'Koordinata to‘liq emas.',
  contribution_requests_proposed_region_shape: 'Taklif qilingan hudud ma’lumoti noto‘g‘ri.',
  integration_secrets_configured: 'Integratsiya kaliti holati mos emas.',
};

/** Xato `null`, satr yoki `undefined` bo'lishi mumkin — handler yiqilmasin. */
function fieldOf(error: unknown, field: 'code' | 'constraint'): string {
  if (typeof error !== 'object' || error === null) return '';
  const candidate = (error as Record<string, unknown>)[field];
  return typeof candidate === 'string' ? candidate : '';
}

/**
 * Ma'lum SQLSTATE uchun javob qaytaradi. Noma'lum kod bo'lsa `null` —
 * chaqiruvchi umumiy `500` javobini beradi.
 */
export function translateDatabaseError(error: unknown): DatabaseFault | null {
  const sqlState = fieldOf(error, 'code');
  if (!sqlState) return null;
  const constraint = fieldOf(error, 'constraint');

  switch (sqlState) {
    case '23505':
      return {
        status: 409,
        code: 'conflict',
        message: UNIQUE_MESSAGES[constraint] ?? 'Bunday yozuv allaqachon mavjud.',
        serverDefect: false,
      };
    case '23503':
      return {
        status: 422,
        code: 'validation_failed',
        message: 'Bog‘langan yozuv topilmadi. Hudud, lahja yoki so‘z tanlovini qayta tekshiring.',
        serverDefect: false,
      };
    case '23502':
      return {
        status: 422,
        code: 'validation_failed',
        message: 'Majburiy maydon to‘ldirilmagan.',
        serverDefect: false,
      };
    case '23514':
      return {
        status: 422,
        code: 'validation_failed',
        message: CHECK_MESSAGES[constraint] ?? 'Kiritilgan ma’lumot cheklovga mos kelmadi.',
        serverDefect: false,
      };
    case '22P02':
    case '22001':
    case '22003':
    case '22007':
      return {
        status: 422,
        code: 'validation_failed',
        message: 'Kiritilgan ma’lumot formati noto‘g‘ri.',
        serverDefect: false,
      };

    // Parallel moderatorlar: yozuv yo'qolmaydi, faqat qayta urinish kerak.
    case '40001':
    case '40P01':
    case '55P03':
      return {
        status: 409,
        code: 'conflict',
        message: 'Yozuv ayni damda band. Bir zumdan keyin qayta urinib ko‘ring.',
        serverDefect: false,
      };

    // Baza vaqtincha yetib bo'lmaydi — bu foydalanuvchi xatosi emas.
    case '53300':
    case '57014':
    case '57P01':
    case '57P03':
    case '08000':
    case '08003':
    case '08006':
      return {
        status: 503,
        code: 'provider_unavailable',
        message: 'Ma’lumotlar bazasi vaqtincha javob bermayapti. Qayta urinib ko‘ring.',
        serverDefect: false,
      };

    // Bu ikkisi — SQL matnidagi nuqson. Foydalanuvchi hech narsa qila olmaydi,
    // shuning uchun alohida belgilanadi va logda ko'rinadi.
    // `42P08` aynan audio tasdiqlashdagi `500` ning sababi bo'lgan.
    case '42P08':
    case '42P18':
    case '42804':
    case '42883':
    case '42703':
    case '42P01':
      return {
        status: 500,
        code: 'internal_error',
        message: 'Serverda ichki xatolik yuz berdi. Texnik mas’ulga xabar berildi.',
        serverDefect: true,
      };

    default:
      return null;
  }
}
