import type { AudioAnalysis } from '../contract/audio';
import { AUDIO_LIMITS, emptyAudioAnalysis } from '../contract/audio';
import type { ValidationReason, ValidationReasonCode, ValidationSeverity } from '../contract/validation';
import { RULE_PACK_NAME, RULE_PACK_VERSION } from './lexicon';
import { normalizeForCompare, phoneticSimilarity, pronunciationSimilarityScore } from './phonetics';

export interface AudioAnalysisInput {
  expectedText: string;
  durationMs: number;
  sizeBytes: number;
  mimeType: string;
  /** STT/AI provider ulanganmi. `false` bo'lsa natija `pending_analysis`. */
  sttAvailable: boolean;
  transcript?: string | null;
  transcriptConfidence?: number | null;
  detectedLanguage?: string | null;
  /** Model bergan sheva ishonchi 0..1. Bo'lmasa fonetik taxmin ishlatiladi. */
  dialectConfidence?: number | null;
  /** Signal/shovqin nisbati (dB), agar o'lchangan bo'lsa. */
  snrDb?: number | null;
  providerName?: string;
  now?: Date;
}

function push(
  reasons: ValidationReason[],
  code: ValidationReasonCode,
  severity: ValidationSeverity,
  scoreDelta: number,
  message: string,
  evidence?: string,
): void {
  reasons.push({ code, severity, scoreDelta, message, evidence });
}

/** Fayl darajasidagi tekshiruv — provider kerak emas, hamma vaqt ishlaydi. */
export function checkAudioEnvelope(input: Pick<AudioAnalysisInput, 'durationMs' | 'sizeBytes' | 'mimeType'>): ValidationReason[] {
  const reasons: ValidationReason[] = [];
  if (input.durationMs < AUDIO_LIMITS.minDurationMs) {
    push(reasons, 'audio_too_short', 'blocker', -100, 'Audio juda qisqa (kamida 0,7 soniya).', `${input.durationMs} ms`);
  }
  if (input.durationMs > AUDIO_LIMITS.maxDurationMs) {
    push(reasons, 'audio_too_long', 'blocker', -100, 'Audio juda uzun (ko‘pi bilan 30 soniya).', `${input.durationMs} ms`);
  }
  if (input.sizeBytes > AUDIO_LIMITS.maxSizeBytes) {
    push(reasons, 'audio_too_long', 'blocker', -100, 'Audio fayl hajmi juda katta.', `${input.sizeBytes} B`);
  }
  if (!AUDIO_LIMITS.allowedMimeTypes.includes(input.mimeType as never)) {
    push(reasons, 'audio_silent', 'blocker', -100, 'Audio formati qo‘llab-quvvatlanmaydi.', input.mimeType);
  }
  return reasons;
}

/**
 * Audio quvurining natijasini yig'adi.
 *
 * MUHIM: bu funksiya "Xorazm shevasini aniqladim" demaydi. U faqat
 * mavjud signallarni bitta skorga jamlaydi va deyarli har doim
 * `requiresHumanReview: true` qaytaradi. Yakuniy qaror — moderatorniki.
 */
export function analyzeAudioSubmission(input: AudioAnalysisInput): AudioAnalysis {
  const analysis = emptyAudioAnalysis();
  const reasons = checkAudioEnvelope(input);
  const hasBlocker = reasons.some((r) => r.severity === 'blocker');
  analysis.reasons = reasons;

  if (hasBlocker) {
    analysis.status = 'skipped';
    analysis.stage = 'uploaded';
    analysis.overallScore = 0;
    analysis.requiresHumanReview = true;
    return analysis;
  }

  if (!input.sttAvailable || input.transcript == null) {
    push(
      reasons,
      'stt_unavailable',
      'info',
      0,
      'Nutqni matnga o‘girish xizmati ulanmagan — audio moderator tekshiruviga qoldi.',
    );
    analysis.status = 'pending_analysis';
    analysis.stage = 'uploaded';
    analysis.requiresHumanReview = true;
    return analysis;
  }

  const transcript = input.transcript.trim();
  const transcriptConfidence = input.transcriptConfidence ?? 0.5;
  const pronunciation = pronunciationSimilarityScore(input.expectedText, transcript);
  const textMatch = Math.round(
    phoneticSimilarity(normalizeForCompare(input.expectedText), normalizeForCompare(transcript)) * 100,
  );
  // Model bermasa — fonetik o'xshashlikdan ehtiyotkor taxmin.
  const dialectConfidence = input.dialectConfidence ?? Math.min(0.6, pronunciation / 200);

  if (!transcript) {
    push(reasons, 'audio_silent', 'blocker', -100, 'Audioda tushunarli nutq topilmadi.');
  }
  if (pronunciation < 55) {
    push(reasons, 'pronunciation_low_similarity', 'warning', -20, 'Talaffuz kutilgan shaklga kam o‘xshaydi.', `${pronunciation}%`);
  }
  if (textMatch < 50) {
    push(reasons, 'transcript_mismatch', 'warning', -20, 'Transkript yozilgan so‘zga mos kelmadi.', transcript);
  }
  if (input.detectedLanguage && input.detectedLanguage !== 'uz') {
    push(reasons, 'transcript_mismatch', 'warning', -15, 'Aniqlangan til o‘zbekcha emas.', input.detectedLanguage);
  }
  if (input.snrDb != null && input.snrDb < 10) {
    push(reasons, 'audio_low_snr', 'warning', -10, 'Yozuvda shovqin ko‘p.', `${input.snrDb} dB`);
  }

  const overall = Math.max(
    0,
    Math.min(100, Math.round(pronunciation * 0.45 + textMatch * 0.3 + dialectConfidence * 100 * 0.25)),
  );

  analysis.status = 'analyzed';
  analysis.stage = 'completed';
  analysis.transcript = transcript;
  analysis.transcriptConfidence = Number(transcriptConfidence.toFixed(2));
  analysis.detectedLanguage = input.detectedLanguage ?? null;
  analysis.dialectConfidence = Number(dialectConfidence.toFixed(2));
  analysis.pronunciationSimilarity = pronunciation;
  analysis.textAudioMatch = textMatch;
  analysis.overallScore = overall;
  analysis.reasons = reasons;
  analysis.engine = {
    kind: input.providerName ? 'hybrid' : 'rules',
    name: RULE_PACK_NAME,
    version: RULE_PACK_VERSION,
    provider: input.providerName,
  };
  analysis.analyzedAt = (input.now ?? new Date()).toISOString();
  // Avtomatik natija hech qachon yakuniy emas: yuqori skor faqat
  // moderator navbatidagi ustuvorlikni pasaytiradi.
  analysis.requiresHumanReview =
    overall < 80 || transcriptConfidence < 0.7 || dialectConfidence < 0.6 || reasons.some((r) => r.severity !== 'info');
  return analysis;
}
