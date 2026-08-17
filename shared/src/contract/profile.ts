import type { IsoDateTime, Uuid } from './common';

/**
 * Boshqa odamga ko'rsatiladigan profil.
 *
 * Bu yerda faqat ochiq maydonlar bo'ladi: naqsh xeshi, token, qurilma
 * identifikatori yoki bloklash sababi hech qachon bu shaklga tushmaydi.
 * Shu sabab bir xil tur ham izoh muallifi uchun, ham moderator ko'rayotgan
 * hissa qo'shuvchi uchun ishlatiladi — ikkinchi, boyroq nusxa yaratish
 * ma'lumotni ortiqcha joyga tarqatgan bo'lardi.
 */
export interface PublicProfile {
  id: Uuid;
  username: string;
  displayName: string;
  /** Server bergan to'liq havola. Rasm yo'q bo'lsa `null`. */
  avatarUrl: string | null;
}

/**
 * Moderator ko'radigan hissa qo'shuvchi.
 *
 * Ochiq profilga qaror qabul qilish uchun zarur kontekst qo'shiladi:
 * hisob bloklanganmi va bu odam ilgari qancha hissa qo'shgan. Ikkalasi ham
 * `users` va `contribution_requests` dan hisoblanadi, nusxalanmaydi.
 */
export interface ContributorProfile extends PublicProfile {
  isBlocked: boolean;
  contributionCount: number;
  createdAt?: IsoDateTime | null;
  lastSeenAt?: IsoDateTime | null;
}

/** Qarorni kim qabul qilgani. Xodim hisobida `username` bo'lmaydi. */
export interface ModeratorProfile {
  id: Uuid;
  fullName: string;
  roles: string[];
}
