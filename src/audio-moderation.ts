/**
 * Audio moderatsiyasining sof (bazasiz) qoidalari.
 *
 * Audio qarori ilgari `PATCH /requests/:id/status` orqali o'tardi: bu butun
 * so'rov statusini o'zgartirar va `approved` holatida yangi `words` yozuvi
 * yaratardi. Moderator faqat talaffuz yozuvini baholayotgan bo'lsa ham
 * lug'atga yozuv qo'shilishi noto'g'ri. Shu sabab audio qarori alohida
 * endpointga ajratildi va uning validatsiyasi shu yerda testlanadi.
 */

export type AudioDecision = 'approved' | 'rejected' | 'needs_clarification';
export type AudioModerationStatus = AudioDecision | 'pending';

const DECISIONS: readonly AudioDecision[] = ['approved', 'rejected', 'needs_clarification'];

export class AudioModerationValidationError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = 'AudioModerationValidationError';
  }
}

export interface ParsedAudioDecision {
  decision: AudioDecision;
  /** `approved` uchun ixtiyoriy, qolgan qarorlar uchun majburiy. */
  reason: string | null;
  expectedUpdatedAt: string;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Qaror tanasini tekshiradi. Xato bo'lsa `422` uchun tayyor xabar beradi.
 *
 * `reason` majburiyligi DB'dagi `moderation_decisions_reason_required`
 * cheklovi bilan bir xil bo'lishi shart — aks holda constraint xatosi
 * foydalanuvchiga tushunarsiz `500` bo'lib qaytadi.
 */
export function parseAudioDecision(input: unknown): ParsedAudioDecision {
  const body = typeof input === 'object' && input !== null ? input as Record<string, unknown> : {};
  const decision = text(body.decision) as AudioDecision;
  if (!DECISIONS.includes(decision)) {
    throw new AudioModerationValidationError('decision', 'Audio qarori noto‘g‘ri.');
  }

  const reason = text(body.reason);
  if (decision !== 'approved' && !reason) {
    throw new AudioModerationValidationError('reason', 'Rad etish va qayta yozishni so‘rash uchun sabab majburiy.');
  }
  if (reason.length > 2_000) {
    throw new AudioModerationValidationError('reason', 'Sabab juda uzun.');
  }

  const expectedUpdatedAt = text(body.expectedUpdatedAt);
  if (!expectedUpdatedAt || Number.isNaN(Date.parse(expectedUpdatedAt))) {
    throw new AudioModerationValidationError('expectedUpdatedAt', 'Ro‘yxatni yangilab, qarorni qaytadan yuboring.');
  }

  return { decision, reason: reason || null, expectedUpdatedAt };
}

/** Optimistik qulf: format farq qilsa ham bir xil lahza bir xil hisoblanadi. */
export function isSameInstant(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) return false;
  const a = Date.parse(left);
  const b = Date.parse(right);
  return Number.isFinite(a) && Number.isFinite(b) && a === b;
}

/**
 * Takliflar ekranidagi `applyToAudio` uchun moslik jadvali.
 *
 * `needs_clarification` — bu so'z matni bo'yicha savol; audio hali baholanmagan
 * bo'lib qolishi kerak, aks holda u navbatdan tushib qoladi va hech kim uni
 * qayta ko'rmaydi.
 */
export function audioStatusForRequestDecision(status: string): AudioModerationStatus {
  if (status === 'approved') return 'approved';
  if (status === 'rejected') return 'rejected';
  return 'pending';
}

/** `moderation_decisions.decision` `pending` qiymatini qabul qilmaydi. */
export function isRecordableDecision(status: AudioModerationStatus): status is AudioDecision {
  return status !== 'pending';
}
