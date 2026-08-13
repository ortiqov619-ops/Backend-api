-- Tarmoq javobi yo'qolib mobil ilova audioni qayta yuborsa, ayni yozuv
-- moderator navbatida ikki marta paydo bo'lmasligi kerak.
ALTER TABLE audio_submissions
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS audio_submissions_idempotency
  ON audio_submissions(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
