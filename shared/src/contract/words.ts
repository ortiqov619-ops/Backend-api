import type { Auditable, IsoDateTime, PageQuery, Paginated, Uuid } from './common';

export type WordStatus = 'draft' | 'published' | 'archived';

export interface WordVariant {
  id: Uuid;
  wordId: Uuid;
  /** Shevadagi yozilish varianti. */
  form: string;
  /** Fonetik normallashtirilgan kalit — duplicate va talaffuz solishtirish uchun. */
  phoneticKey: string;
  dialectId?: Uuid | null;
  regionId?: Uuid | null;
  note?: string | null;
  audioId?: Uuid | null;
}

export interface Word extends Auditable {
  id: Uuid;
  /** Shevadagi asosiy shakl. */
  word: string;
  /** Adabiy o'zbekchadagi ekvivalenti (bo'lsa). */
  literaryForm?: string | null;
  meaning: string;
  example?: string | null;
  category?: string | null;
  phoneticKey: string;
  status: WordStatus;
  regionId?: Uuid | null;
  districtId?: Uuid | null;
  villageId?: Uuid | null;
  dialectId?: Uuid | null;
  clan?: string | null;
  variants?: WordVariant[];
  primaryAudio?: AudioRef | null;
  /** Oxirgi avtomatik moslik skori (0–100). */
  dialectScore?: number | null;
  /** Shu so'z qaysi taklifdan yaratilgani. */
  sourceRequestId?: Uuid | null;
  archivedAt?: IsoDateTime | null;
  archiveReason?: string | null;
}

export interface AudioRef {
  id: Uuid;
  /** Imzolangan, muddatli URL. Doimiy havola emas. */
  playbackUrl: string;
  playbackUrlExpiresAt: IsoDateTime;
  durationMs: number;
  mimeType: string;
}

/** GET /words (public) va GET /admin/words (admin) — bir xil filtr. */
export interface WordListQuery extends PageQuery {
  search?: string;
  regionId?: Uuid;
  dialectId?: Uuid;
  category?: string;
  status?: WordStatus;
  hasAudio?: boolean;
  sort?: 'recent' | 'alphabetical' | 'popular';
}

export type WordListResponse = Paginated<Word>;

/** POST /admin/words — administratorning bevosita lug‘at yozuvi. */
export interface CreateAdminWordRequest {
  word: string;
  meaning: string;
  literaryForm?: string | null;
  example?: string | null;
  category?: string | null;
  regionId?: Uuid | null;
  districtId?: Uuid | null;
  dialectId?: Uuid | null;
  /** Audit uchun majburiy: nima sababdan bevosita kiritildi. */
  changeReason: string;
}

export interface CreateAdminWordResponse {
  word: Word;
  auditLogId: Uuid;
}

/** PATCH /words/:id */
export interface UpdateWordRequest {
  word?: string;
  literaryForm?: string | null;
  meaning?: string;
  example?: string | null;
  category?: string | null;
  regionId?: Uuid | null;
  districtId?: Uuid | null;
  villageId?: Uuid | null;
  dialectId?: Uuid | null;
  clan?: string | null;
  status?: WordStatus;
  /** Har bir admin o'zgarishi sababsiz bo'lmasin — audit uchun majburiy. */
  changeReason: string;
}

export interface UpdateWordResponse {
  word: Word;
  auditLogId: Uuid;
}

/** DELETE /words/:id — jismonan o'chirmaydi, arxivlaydi. */
export interface ArchiveWordRequest {
  reason: string;
  /** `true` bo'lsa faqat `admin` roli bajara oladi (GDPR-tipidagi tozalash). */
  hardDelete?: boolean;
}

export interface ArchiveWordResponse {
  id: Uuid;
  status: WordStatus;
  archivedAt: IsoDateTime;
  auditLogId: Uuid;
}
