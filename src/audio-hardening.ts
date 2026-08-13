export interface AudioIdempotencyFingerprint {
  contributionRequestId: string | null;
  wordId: string | null;
  checksumSha256: string;
  mimeType: string;
  durationMs: number;
  expectedText: string;
}

/** Idempotency key faqat aynan bir xil audio amali uchun qayta ishlatilishi mumkin. */
export function sameAudioFingerprint(
  stored: AudioIdempotencyFingerprint,
  incoming: AudioIdempotencyFingerprint,
): boolean {
  return stored.contributionRequestId === incoming.contributionRequestId
    && stored.wordId === incoming.wordId
    && stored.checksumSha256 === incoming.checksumSha256
    && stored.mimeType === incoming.mimeType
    && stored.durationMs === incoming.durationMs
    && normalizeExpectedText(stored.expectedText) === normalizeExpectedText(incoming.expectedText);
}

export function normalizeExpectedText(value: string): string {
  return value.trim().toLocaleLowerCase('uz-Latn-UZ').replace(/\s+/g, ' ');
}

export function fixedWindow(nowMs: number, windowSeconds: number): {
  windowStartMs: number;
  resetAtMs: number;
} {
  const windowMs = Math.max(1, Math.floor(windowSeconds)) * 1_000;
  const windowStartMs = Math.floor(nowMs / windowMs) * windowMs;
  return { windowStartMs, resetAtMs: windowStartMs + windowMs };
}
