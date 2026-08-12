/** Ovozdan so‘z aniqlash endpointining umumiy shartnomasi. */
export interface AudioTranscriptionResponse {
  /** Foydalanuvchi tasdiqlashi va tahrirlashi kerak bo‘lgan STT taklifi. */
  text: string;
  /** Provider ishonchi: 0–1. Bu moderator hukmi emas. */
  confidence: number | null;
  language?: string | null;
}
