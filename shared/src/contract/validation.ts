import type { IsoDateTime, Uuid } from './common';

/** Filtrning yakuniy qarori. Hech qachon "avtomatik tasdiqlash" emas. */
export type ValidationVerdict = 'accepted_for_review' | 'needs_manual_review' | 'rejected';

export type ValidationSubject = 'word_text' | 'word_meaning' | 'metadata' | 'audio' | 'location';

export type ValidationReasonCode =
  // matn shakli
  | 'empty_text'
  | 'too_short'
  | 'too_long'
  | 'invalid_characters'
  | 'mixed_script'
  | 'repeated_characters'
  | 'digits_only'
  // xatti-harakat
  | 'profanity'
  | 'spam_pattern'
  | 'duplicate_exact'
  | 'duplicate_similar'
  | 'rate_limited'
  // sheva
  | 'dialect_marker_hit'
  | 'dialect_phonetic_hit'
  | 'no_dialect_signal'
  | 'standard_uzbek_form'
  | 'dialect_metadata_mismatch'
  // metama'lumot
  | 'missing_region'
  | 'region_mismatch'
  | 'region_not_in_xorazm'
  | 'missing_meaning'
  // lokatsiya
  | 'location_outside_geofence'
  | 'location_low_accuracy'
  | 'location_stale'
  | 'location_missing'
  | 'location_mock_suspected'
  // audio
  | 'audio_too_short'
  | 'audio_too_long'
  | 'audio_silent'
  | 'audio_low_snr'
  | 'transcript_mismatch'
  | 'pronunciation_low_similarity'
  | 'stt_unavailable';

export type ValidationSeverity = 'info' | 'warning' | 'blocker';

export interface ValidationReason {
  code: ValidationReasonCode;
  severity: ValidationSeverity;
  /** Skorga qo'shilgan hissa (musbat yoki manfiy). */
  scoreDelta: number;
  /** Foydalanuvchi/moderatorga ko'rsatiladigan o'zbekcha izoh. */
  message: string;
  /** Sababni keltirib chiqargan aniq qiymat (so'z, kalit, o'xshash yozuv id'si). */
  evidence?: string;
}

export interface ValidationResult {
  id?: Uuid;
  subject: ValidationSubject;
  verdict: ValidationVerdict;
  /** 0–100. 100 = Xorazm shevasiga to'liq mos ko'rinadi. */
  score: number;
  /** Modelning o'ziga ishonchi 0–1. Qoidaviy filtr uchun ham hisoblanadi. */
  confidence: number;
  reasons: ValidationReason[];
  /** Qaysi qoida/model qarorni chiqardi — reproduktsiya uchun majburiy. */
  engine: ValidationEngineInfo;
  evaluatedAt: IsoDateTime;
  /** Client'da bajarilganmi yoki serverda. Yakuniy qaror faqat `server`. */
  origin: 'client' | 'server';
}

export interface ValidationEngineInfo {
  /** `rules` — determinizmli qoidalar; `model` — STT/AI; `hybrid`. */
  kind: 'rules' | 'model' | 'hybrid';
  /** `xorazm-dialect-rules` kabi barqaror nom. */
  name: string;
  /** Semver. Har o'zgarishda oshiriladi va DB'ga yoziladi. */
  version: string;
  /** Model ishlatilgan bo'lsa provider nomi (kalit emas!). */
  provider?: string;
}

export interface ValidationThresholds {
  /** Shundan past — darhol rad. */
  rejectBelow: number;
  /** Shundan yuqori — moderator navbatiga "accepted_for_review" sifatida. */
  autoQueueAbove: number;
  /** Ikkisi orasidagi hamma narsa — `needs_manual_review`. */
  minConfidenceForVerdict: number;
}

export const DEFAULT_THRESHOLDS: ValidationThresholds = {
  rejectBelow: 25,
  autoQueueAbove: 65,
  minConfidenceForVerdict: 0.5,
};

export function verdictFromScore(
  score: number,
  confidence: number,
  hasBlocker: boolean,
  thresholds: ValidationThresholds = DEFAULT_THRESHOLDS,
): ValidationVerdict {
  if (hasBlocker) return 'rejected';
  if (score < thresholds.rejectBelow) return 'rejected';
  if (confidence < thresholds.minConfidenceForVerdict) return 'needs_manual_review';
  return score >= thresholds.autoQueueAbove ? 'accepted_for_review' : 'needs_manual_review';
}
