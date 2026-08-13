import type { Auditable, IsoDateTime, Uuid } from './common';
import type { ValidationEngineInfo, ValidationReason } from './validation';

/**
 * Audio quvuri (pipeline). Har bosqich mustaqil ishlaydi va alohida
 * saqlanadi, shuning uchun STT/AI provider bo'lmasa ham yozuv yo'qolmaydi.
 */
export type AudioPipelineStage =
  | 'uploaded'
  | 'transcribing'
  | 'dialect_detection'
  | 'pronunciation_scoring'
  | 'text_audio_match'
  | 'completed';

export type AudioAnalysisStatus =
  /** Provider ulanmagan yoki navbatda — admin qo'lda tekshiradi. */
  | 'pending_analysis'
  | 'analyzing'
  | 'analyzed'
  | 'failed'
  | 'skipped';

export interface AudioAnalysis {
  status: AudioAnalysisStatus;
  stage: AudioPipelineStage;
  /** STT natijasi. Provider yo'q bo'lsa `null`. */
  transcript: string | null;
  transcriptConfidence: number | null;
  /** Aniqlangan til kodi, masalan `uz`. */
  detectedLanguage: string | null;
  /** Xorazm shevasiga o'xshashlik, 0–1. Yordamchi signal, hukm emas. */
  dialectConfidence: number | null;
  /** Kutilgan talaffuz bilan o'xshashlik, 0–100. */
  pronunciationSimilarity: number | null;
  /** Yozilgan matn va audio mazmuni mos keladimi, 0–100. */
  textAudioMatch: number | null;
  /** Yuqoridagilardan hosil bo'lgan umumiy skor, 0–100. */
  overallScore: number | null;
  reasons: ValidationReason[];
  /** `true` bo'lsa moderator ko'rmaguncha hech narsa nashr etilmaydi. */
  requiresHumanReview: boolean;
  engine?: ValidationEngineInfo | null;
  analyzedAt?: IsoDateTime | null;
  /** Provider xatosi bo'lsa — texnik xabar (kalitlarsiz). */
  failureMessage?: string | null;
}

export function emptyAudioAnalysis(): AudioAnalysis {
  return {
    status: 'pending_analysis',
    stage: 'uploaded',
    transcript: null,
    transcriptConfidence: null,
    detectedLanguage: null,
    dialectConfidence: null,
    pronunciationSimilarity: null,
    textAudioMatch: null,
    overallScore: null,
    reasons: [],
    requiresHumanReview: true,
    engine: null,
    analyzedAt: null,
    failureMessage: null,
  };
}

export interface AudioSubmission extends Auditable {
  id: Uuid;
  contributionRequestId?: Uuid | null;
  wordId?: Uuid | null;
  /** Obyekt xotirasidagi kalit. Bevosita ochiq URL emas. */
  storageKey: string;
  /** Imzolangan, muddatli tinglash havolasi. */
  playbackUrl?: string | null;
  playbackUrlExpiresAt?: IsoDateTime | null;
  mimeType: string;
  durationMs: number;
  sizeBytes: number;
  sampleRateHz?: number | null;
  checksumSha256: string;
  /** Foydalanuvchi yozayotgan so'zning kutilgan shakli. */
  expectedText: string;
  analysis: AudioAnalysis;
  moderationStatus: 'pending' | 'approved' | 'rejected' | 'needs_clarification';
  /** Qayta yozilgan talaffuz uchun ortadi. Birinchi yozuv — `1`. */
  version?: number;
  /**
   * To'ldirilgan bo'lsa, bu yozuv yangi versiya bilan almashtirilgan.
   * Yozuv o'chirilmaydi: u audit dalili sifatida saqlanadi, lekin
   * moderatsiya navbatida ko'rinmaydi.
   */
  supersededAt?: IsoDateTime | null;
}

/**
 * Audio navbatidagi yozuvning konteksti.
 *
 * Audio uch xil holatda bo'ladi va moderator qaysi biri ekanini ko'rishi
 * shart: yangi taklifga biriktirilgan (`contribution_request`), nashr etilgan
 * lug'at so'ziga qo'shilgan talaffuz (`word`), yoki bog'lanishi uzilgan
 * tarixiy yozuv (`detached`).
 */
export interface AudioModerationContext {
  kind: 'contribution_request' | 'word' | 'detached';
  id: Uuid;
  /** Ko'rsatiladigan so'z: payload/lug'at qiymati, bo'lmasa `expectedText`. */
  word: string;
  meaning: string | null;
  /** Manba so'rov yoki so'zning holati; `detached` uchun `null`. */
  status: string | null;
}

export interface AudioModerationItem {
  submission: AudioSubmission;
  context: AudioModerationContext;
}

export interface AudioModerationQuery {
  status?: AudioSubmission['moderationStatus'];
  analysisStatus?: AudioAnalysisStatus;
  /** Tarixni ko'rish uchun; standart holatda faqat joriy versiyalar qaytadi. */
  includeSuperseded?: boolean;
  page?: number;
  pageSize?: number;
}

export interface AudioModerationListResponse {
  items: AudioModerationItem[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

/**
 * Audio qarori. So'rov statusiga ham, `words` jadvaliga ham tegmaydi —
 * moderator faqat talaffuz yozuvini baholaydi.
 */
export interface AudioModerationDecisionRequest {
  decision: 'approved' | 'rejected' | 'needs_clarification';
  /** `approved` dan boshqa qarorlar uchun majburiy. */
  reason?: string;
  /** Optimistik qulf: `AudioSubmission.updatedAt`. Mos kelmasa `409`. */
  expectedUpdatedAt: IsoDateTime;
}

export interface AudioModerationDecisionResponse extends AudioModerationItem {
  auditLogId: Uuid;
}

export const AUDIO_LIMITS = {
  minDurationMs: 700,
  maxDurationMs: 40_000,
  maxSizeBytes: 8 * 1024 * 1024,
  allowedMimeTypes: ['audio/m4a', 'audio/mp4', 'audio/aac', 'audio/wav', 'audio/webm'] as const,
} as const;

export type AllowedAudioMime = (typeof AUDIO_LIMITS.allowedMimeTypes)[number];
