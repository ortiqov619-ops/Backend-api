import type { Auditable, IsoDateTime, PageQuery, Paginated, Uuid } from './common';
import type { AudioSubmission } from './audio';
import type { LocationSample, SubmissionLocationStatus } from './geo';
import type { ContributorProfile, ModeratorProfile } from './profile';
import type { ValidationResult, ValidationVerdict } from './validation';

export type ContributionType = 'word' | 'audio' | 'correction';

export type ModerationStatus = 'pending' | 'approved' | 'rejected' | 'needs_clarification';

/** Ro‘yxatda yo‘q hudud: rasmiy katalogga faqat moderator/admin tasdig‘idan keyin qo‘shiladi. */
export interface ProposedRegion {
  nameUz: string;
  level: 'district' | 'village' | 'neighborhood';
  parentRegionId?: Uuid;
}

/** So'z/izoh uchun foydalanuvchi kiritgan mazmun. */
export interface ContributionPayload {
  word: string;
  meaning: string;
  literaryForm?: string;
  example?: string;
  category?: string;
  clan?: string;
  note?: string;
  dialectId?: Uuid;
  regionId?: Uuid;
  districtId?: Uuid;
  villageId?: Uuid;
  neighborhood?: string;
  proposedRegion?: ProposedRegion;
}

/** Qurilma haqidagi minimal, anonim ma'lumot — spam/spoof tahlili uchun. */
export interface DeviceContext {
  platform: 'ios' | 'android' | 'web';
  installationId: string;
  appVersion: string;
  osVersion?: string;
  locale?: string;
}

export interface ContributionRequest extends Auditable {
  id: Uuid;
  type: ContributionType;
  status: ModerationStatus;
  payload: ContributionPayload;
  submittedByUserId?: Uuid | null;
  submittedByDisplayName?: string | null;
  /**
   * Hissa qo'shgan hisobning to'liq profili.
   *
   * Server uni `submitted_by_user_id` bo'yicha `users` dan qo'shib beradi,
   * shuning uchun ism/rasm o'zgarsa moderator darhol yangisini ko'radi.
   * Hisobsiz (mehmon) yuborilgan takliflarda `null`.
   */
  submitter?: ContributorProfile | null;
  device?: DeviceContext | null;

  // --- lokatsiya ---
  latitude?: number | null;
  longitude?: number | null;
  locationAccuracyM?: number | null;
  locationCheckedAt?: IsoDateTime | null;
  submissionLocationStatus: SubmissionLocationStatus;
  matchedGeofenceId?: Uuid | null;
  geofenceVersion?: number | null;

  // --- filtr natijalari ---
  validationVerdict: ValidationVerdict;
  validationScore: number;
  validationResults: ValidationResult[];

  audio?: AudioSubmission | null;
  /** Moderator bilan yozishuv (needs_clarification oqimi). */
  clarificationNote?: string | null;
  resolvedAt?: IsoDateTime | null;
  resolvedByUserId?: Uuid | null;
  /** Qarorni qabul qilgan moderator — id emas, ko'rsatiladigan profil. */
  resolvedBy?: ModeratorProfile | null;
  /** Tasdiqlanganda yaratilgan/yangilangan so'z. */
  resultWordId?: Uuid | null;
}

/**
 * Foydalanuvchining o'z takliflari ro'yxati (`GET /app/contributions`).
 *
 * Moderator ko'radigan to'liq yozuvdan ataylab qisqa: lokatsiya isboti,
 * qurilma ma'lumoti va avtomatik filtr tafsilotlari boshqa odamning
 * ishi va foydalanuvchiga kerak emas.
 */
export interface MyContribution {
  id: Uuid;
  word: string;
  meaning: string;
  status: ModerationStatus;
  /** Moderator yozgan sabab/izoh — rad etish va aniqlashtirishda ko'rsatiladi. */
  moderationNote?: string | null;
  /** Qarorni kim qabul qilgani. */
  resolvedBy?: ModeratorProfile | null;
  resolvedAt?: IsoDateTime | null;
  /** Tasdiqlangan bo'lsa — lug'atdagi so'z. */
  resultWordId?: Uuid | null;
  hasAudio: boolean;
  audioStatus?: ModerationStatus | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface MyContributionListQuery extends PageQuery {
  status?: ModerationStatus;
}

export type MyContributionListResponse = Paginated<MyContribution>;

/** POST /contributions/words */
export interface CreateWordContributionRequest {
  payload: ContributionPayload;
  /** GPS namunasi mavjud bo'lsa yuboriladi. Safardagi Xorazmlik uchun bo'sh bo'lishi mumkin. */
  location?: LocationSample | null;
  /** Foydalanuvchining Xorazm bilan doimiy aloqasi haqidagi deklaratsiyasi.
   * Bunday hissa doimo moderator tekshiruviga tushadi. */
  heritageDeclaration?: boolean;
  device: DeviceContext;
  /** Client tomonda hisoblangan dastlabki filtr — server qayta hisoblaydi. */
  clientValidation?: ValidationResult;
  /** Takroriy yuborishni to'sish uchun; bir xil kalit — bir xil natija. */
  idempotencyKey: string;
}

export interface CreateWordContributionResponse {
  request: ContributionRequest;
  /** UI shu matnni ko'rsatadi: "moderatsiyaga tushdi" / "rad etildi". */
  userMessage: string;
}

/**
 * POST /contributions/audio — `multipart/form-data`.
 * Maydonlar: `audio` (fayl) + `meta` (quyidagi JSON string).
 */
export interface CreateAudioContributionMeta {
  /** Mavjud so'zga audio qo'shilsa. */
  wordId?: Uuid;
  /** Yangi so'z bilan birga yuborilsa. */
  contributionRequestId?: Uuid;
  expectedText: string;
  durationMs: number;
  mimeType: string;
  location?: LocationSample | null;
  heritageDeclaration?: boolean;
  device: DeviceContext;
  idempotencyKey: string;
}

export interface CreateAudioContributionResponse {
  submission: AudioSubmission;
  request?: ContributionRequest;
  userMessage: string;
}

/** GET /requests */
export interface RequestListQuery extends PageQuery {
  status?: ModerationStatus;
  type?: ContributionType;
  regionId?: Uuid;
  verdict?: ValidationVerdict;
  locationStatus?: SubmissionLocationStatus;
  hasAudio?: boolean;
  /** `true` — ro‘yxatda bo‘lmagan hudud nomi ham taklif qilingan so‘rovlar. */
  hasRegionSuggestion?: boolean;
  /** `true` — faqat shubhali (spoof/near-boundary/past skor) so'rovlar. */
  flaggedOnly?: boolean;
  search?: string;
  sort?: 'oldest' | 'newest' | 'score_asc' | 'score_desc';
}

export type RequestListResponse = Paginated<ContributionRequest>;

/** PATCH /requests/:id/status */
export interface UpdateRequestStatusRequest {
  status: Exclude<ModerationStatus, 'pending'>;
  /** `rejected` va `needs_clarification` uchun majburiy. */
  reason?: string;
  /** Moderator tuzatgan yakuniy maydonlar (approve paytida). */
  overrides?: Partial<ContributionPayload>;
  /** Audio ham shu qaror bilan birga hal qilinsinmi. */
  applyToAudio?: boolean;
  expectedUpdatedAt: IsoDateTime;
}

export interface UpdateRequestStatusResponse {
  request: ContributionRequest;
  createdWordId?: Uuid | null;
  auditLogId: Uuid;
}

export interface ModerationDecision {
  id: Uuid;
  contributionRequestId: Uuid;
  audioSubmissionId?: Uuid | null;
  moderatorId: Uuid;
  moderatorName: string;
  decision: Exclude<ModerationStatus, 'pending'>;
  reason?: string | null;
  /** Moderator avtomatik filtr bilan rozi bo'lmadimi — model sifatini o'lchash uchun. */
  overrodeAutomatedVerdict: boolean;
  decidedAt: IsoDateTime;
}
