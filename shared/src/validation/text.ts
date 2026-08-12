import type { ContributionPayload } from '../contract/contributions';
import type { LocationGateResult } from '../contract/geo';
import type {
  ValidationReason,
  ValidationReasonCode,
  ValidationResult,
  ValidationSeverity,
  ValidationThresholds,
} from '../contract/validation';
import { DEFAULT_THRESHOLDS, verdictFromScore } from '../contract/validation';
import { XORAZM_DISTRICTS } from '../geo/xorazm';
import {
  ALLOWED_TEXT_PATTERN,
  PROFANITY_ROOTS,
  RULE_PACK_NAME,
  RULE_PACK_VERSION,
  SPAM_PATTERNS,
  STANDARD_UZBEK_FORMS,
  TEXT_LIMITS,
  XORAZM_DIALECT_PATTERNS,
  XORAZM_MARKER_WORDS,
} from './lexicon';
import { normalizeForCompare, phoneticKey, similarityRatio } from './phonetics';

export interface DuplicateCandidate {
  id: string;
  word: string;
  phoneticKey?: string;
}

export interface TextValidationInput {
  payload: ContributionPayload;
  /** Duplicate tekshiruvi uchun mavjud so'zlar. Client'da — yuklangan lug'at. */
  duplicateCandidates?: readonly DuplicateCandidate[];
  /** Bir xil qurilmadan yaqinda yuborilgan so'zlar (normallashtirilgan). */
  recentSubmissions?: readonly string[];
  submissionsInLastHour?: number;
  /** Lokatsiya darvozasi natijasi — bo'lsa, sabablarga qo'shiladi. */
  locationGate?: LocationGateResult | null;
  origin: 'client' | 'server';
  now?: Date;
  thresholds?: ValidationThresholds;
}

const MESSAGES: Record<ValidationReasonCode, string> = {
  empty_text: 'So‘z kiritilmagan.',
  too_short: 'So‘z juda qisqa.',
  too_long: 'So‘z juda uzun.',
  invalid_characters: 'Ruxsat etilmagan belgilar ishlatilgan.',
  mixed_script: 'Lotin va kirill yozuvlari aralashtirilgan.',
  repeated_characters: 'Harflar sun’iy takrorlangan.',
  digits_only: 'So‘z faqat raqamlardan iborat.',
  profanity: 'Matnda haqoratli so‘z aniqlandi.',
  spam_pattern: 'Matn reklama/spamga o‘xshaydi.',
  duplicate_exact: 'Bu so‘z lug‘atda allaqachon bor.',
  duplicate_similar: 'Lug‘atda juda o‘xshash so‘z bor.',
  rate_limited: 'Qisqa vaqtda juda ko‘p so‘rov yuborilgan.',
  dialect_marker_hit: 'Xorazm shevasiga xos so‘z topildi.',
  dialect_phonetic_hit: 'Xorazm shevasiga xos shakl topildi.',
  no_dialect_signal: 'Xorazm shevasiga xos belgi topilmadi.',
  standard_uzbek_form: 'Bu adabiy o‘zbekcha shakl, sheva birligi emas.',
  dialect_metadata_mismatch: 'Tanlangan lahja matnga mos kelmadi.',
  missing_region: 'Hudud ko‘rsatilmagan.',
  region_mismatch: 'Hudud va tuman mos kelmadi.',
  region_not_in_xorazm: 'Ko‘rsatilgan hudud Xorazmga tegishli emas.',
  missing_meaning: 'So‘zning ma’nosi yozilmagan.',
  location_outside_geofence: 'Joylashuv Xorazm hududidan tashqarida.',
  location_low_accuracy: 'Joylashuv aniqligi past.',
  location_stale: 'Joylashuv ma’lumoti eskirgan.',
  location_missing: 'Joylashuv yuborilmagan.',
  location_mock_suspected: 'Soxta joylashuv shubhasi bor.',
  audio_too_short: 'Audio juda qisqa.',
  audio_too_long: 'Audio juda uzun.',
  audio_silent: 'Audioda ovoz aniqlanmadi.',
  audio_low_snr: 'Audioda shovqin ko‘p.',
  transcript_mismatch: 'Transkript yozilgan so‘zga mos kelmadi.',
  pronunciation_low_similarity: 'Talaffuz kutilgan shaklga kam o‘xshaydi.',
  stt_unavailable: 'Nutqni matnga o‘girish xizmati ulanmagan.',
};

function reason(
  code: ValidationReasonCode,
  severity: ValidationSeverity,
  scoreDelta: number,
  evidence?: string,
  message?: string,
): ValidationReason {
  return { code, severity, scoreDelta, message: message ?? MESSAGES[code], evidence };
}

function tokenize(text: string): string[] {
  return normalizeForCompare(text).split(/[^\p{L}\p{N}'‘’ʻ-]+/u).filter(Boolean);
}

function containsProfanity(text: string): string | null {
  for (const token of tokenize(text)) {
    const clean = token.replace(/[^\p{L}]/gu, '');
    for (const root of PROFANITY_ROOTS) {
      const normalizedRoot = normalizeForCompare(root).replace(/[^\p{L}]/gu, '');
      if (!normalizedRoot) continue;
      if (normalizedRoot.length >= 4 ? clean.startsWith(normalizedRoot) : clean === normalizedRoot) {
        return root;
      }
    }
  }
  return null;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Dastlabki (preliminary) matn filtri.
 *
 * Client uni yuborishdan oldin chaqiradi — foydalanuvchi darhol izoh oladi.
 * Server AYNAN shu funksiyani to'liq duplicate ro'yxati bilan qayta
 * chaqiradi va faqat serverning natijasi saqlanadi.
 */
export function validateContributionText(input: TextValidationInput): ValidationResult {
  const { payload, origin } = input;
  const thresholds = input.thresholds ?? DEFAULT_THRESHOLDS;
  const reasons: ValidationReason[] = [];
  const word = (payload.word ?? '').trim();
  const meaning = (payload.meaning ?? '').trim();
  const normalizedWord = normalizeForCompare(word);
  const haystack = `${normalizedWord} ${normalizeForCompare(meaning)} ${normalizeForCompare(payload.note ?? '')}`;

  let score = 50;
  let signals = 0;

  /* --- 1. Shakl --- */
  if (!word) {
    reasons.push(reason('empty_text', 'blocker', -100));
  } else {
    if (word.length < TEXT_LIMITS.wordMinLength) reasons.push(reason('too_short', 'blocker', -100, word));
    if (word.length > TEXT_LIMITS.wordMaxLength) reasons.push(reason('too_long', 'blocker', -100, String(word.length)));
    if (/^\d+$/.test(normalizedWord)) reasons.push(reason('digits_only', 'blocker', -100, word));
    if (!ALLOWED_TEXT_PATTERN.test(word)) reasons.push(reason('invalid_characters', 'blocker', -100, word));
    if (/(.)\1{3,}/u.test(normalizedWord)) reasons.push(reason('repeated_characters', 'warning', -20, word));
    const hasLatin = /\p{Script=Latin}/u.test(word);
    const hasCyrillic = /\p{Script=Cyrillic}/u.test(word);
    if (hasLatin && hasCyrillic) reasons.push(reason('mixed_script', 'warning', -15, word));
  }

  if (!meaning || meaning.length < TEXT_LIMITS.meaningMinLength) {
    reasons.push(reason('missing_meaning', 'warning', -18));
  }
  if (meaning.length > TEXT_LIMITS.meaningMaxLength) {
    reasons.push(reason('too_long', 'warning', -10, 'meaning'));
  }

  /* --- 2. Xatti-harakat --- */
  const profane = containsProfanity(haystack);
  if (profane) reasons.push(reason('profanity', 'blocker', -100, profane));

  for (const spam of SPAM_PATTERNS) {
    if (spam.pattern.test(`${word} ${meaning} ${payload.note ?? ''}`)) {
      reasons.push(reason('spam_pattern', spam.id === 'shout' ? 'warning' : 'blocker', spam.id === 'shout' ? -12 : -100, spam.label));
    }
  }

  if ((input.submissionsInLastHour ?? 0) > TEXT_LIMITS.hourlyRateLimit) {
    reasons.push(reason('rate_limited', 'blocker', -100, String(input.submissionsInLastHour)));
  }
  if (input.recentSubmissions?.some((prev) => normalizeForCompare(prev) === normalizedWord) && normalizedWord) {
    reasons.push(reason('duplicate_exact', 'blocker', -100, 'recent_submission'));
  }

  /* --- 3. Duplicate --- */
  if (normalizedWord && input.duplicateCandidates?.length) {
    const key = phoneticKey(word);
    let bestRatio = 0;
    let bestMatch: DuplicateCandidate | undefined;
    for (const candidate of input.duplicateCandidates) {
      const candidateKey = candidate.phoneticKey ?? phoneticKey(candidate.word);
      if (candidateKey === key) {
        bestRatio = 1;
        bestMatch = candidate;
        break;
      }
      const ratio = similarityRatio(key, candidateKey);
      if (ratio > bestRatio) {
        bestRatio = ratio;
        bestMatch = candidate;
      }
    }
    if (bestMatch && bestRatio === 1) {
      reasons.push(reason('duplicate_exact', 'blocker', -100, `${bestMatch.word} (${bestMatch.id})`));
    } else if (bestMatch && bestRatio >= TEXT_LIMITS.duplicateSimilarity) {
      reasons.push(
        reason('duplicate_similar', 'warning', -25, `${bestMatch.word} · ${Math.round(bestRatio * 100)}%`),
      );
    }
  }

  /* --- 4. Sheva mosligi --- */
  const markerHits = XORAZM_MARKER_WORDS.filter((marker) => {
    const m = normalizeForCompare(marker);
    return normalizedWord === m || normalizedWord.startsWith(m) || haystack.includes(` ${m} `);
  });
  for (const hit of markerHits.slice(0, 2)) {
    signals++;
    score += 16;
    reasons.push(reason('dialect_marker_hit', 'info', 16, hit));
  }

  let patternScore = 0;
  for (const pattern of XORAZM_DIALECT_PATTERNS) {
    if (pattern.pattern.test(normalizedWord)) {
      signals++;
      patternScore += pattern.weight;
      reasons.push(reason('dialect_phonetic_hit', 'info', pattern.weight, pattern.label));
    }
  }
  score += Math.min(patternScore, 28);

  if (STANDARD_UZBEK_FORMS.some((form) => normalizeForCompare(form) === normalizedWord)) {
    signals++;
    score -= 30;
    reasons.push(reason('standard_uzbek_form', 'warning', -30, word));
  } else if (markerHits.length === 0 && patternScore === 0) {
    score -= 14;
    reasons.push(reason('no_dialect_signal', 'warning', -14));
  }

  /* --- 5. Metama'lumot --- */
  const district = payload.districtId ?? '';
  const districtLabel = normalizeForCompare(district);
  if (!payload.regionId && !district) {
    score -= 8;
    reasons.push(reason('missing_region', 'warning', -8));
  } else if (districtLabel) {
    const known = XORAZM_DISTRICTS.some((name) => normalizeForCompare(name) === districtLabel);
    // Tuman UUID sifatida kelsa nom bo'yicha tekshirib bo'lmaydi — bu holat
    // serverda `regions` jadvali orqali hal qilinadi.
    const looksLikeUuid = /^[0-9a-f-]{36}$/i.test(district);
    if (!known && !looksLikeUuid) {
      score -= 20;
      reasons.push(reason('region_not_in_xorazm', 'warning', -20, district));
    } else if (known) {
      signals++;
      score += 8;
    }
  }

  if (payload.dialectId && markerHits.length === 0 && patternScore === 0) {
    score -= 8;
    reasons.push(reason('dialect_metadata_mismatch', 'info', -8, payload.dialectId));
  }

  /* --- 6. Lokatsiya sabablarini qo'shish --- */
  const gate = input.locationGate;
  if (gate) {
    if (gate.status === 'outside') reasons.push(reason('location_outside_geofence', 'blocker', -100));
    if (gate.status === 'low_accuracy') reasons.push(reason('location_low_accuracy', 'blocker', -100));
    if (gate.status === 'stale') reasons.push(reason('location_stale', 'blocker', -100));
    if (gate.status === 'mock_suspected') reasons.push(reason('location_mock_suspected', 'blocker', -100));
    if (gate.status === 'inside_near_boundary') {
      score -= 10;
      reasons.push(
        reason('location_outside_geofence', 'warning', -10, `${Math.round(gate.distanceToBoundaryM ?? 0)} m`,
          'Chegaraga yaqin joylashuv — qo‘lda tekshirish tavsiya etiladi.'),
      );
    }
  }

  const hasBlocker = reasons.some((r) => r.severity === 'blocker');
  const finalScore = hasBlocker ? 0 : clamp(Math.round(score));
  const confidence = hasBlocker ? 0.95 : clamp(0.35 + signals * 0.12, 0, 0.9);

  return {
    subject: 'word_text',
    verdict: verdictFromScore(finalScore, confidence, hasBlocker, thresholds),
    score: finalScore,
    confidence: Number(confidence.toFixed(2)),
    reasons,
    engine: { kind: 'rules', name: RULE_PACK_NAME, version: RULE_PACK_VERSION },
    evaluatedAt: (input.now ?? new Date()).toISOString(),
    origin,
  };
}

/** Foydalanuvchiga ko'rsatiladigan qisqa xabar. */
export function verdictMessage(result: ValidationResult): string {
  const blocker = result.reasons.find((r) => r.severity === 'blocker');
  switch (result.verdict) {
    case 'rejected':
      return blocker ? `Qabul qilinmadi: ${blocker.message}` : 'So‘rov qabul qilinmadi.';
    case 'needs_manual_review':
      return 'So‘rovingiz moderatorga yuborildi — qo‘shimcha tekshiruvdan o‘tadi.';
    case 'accepted_for_review':
      return 'Rahmat! So‘zingiz moderatsiya navbatiga qo‘shildi.';
  }
}
