-- Har bir yangi so'z taklifiga faqat bitta talaffuz yozuvi biriktiriladi.
-- Oldingi deployda dublikat yuz bergan bo'lsa, eng birinchi yozuv canonical
-- bo'lib qoladi; qolgan audio fayllar yo'qolmaydi, lekin requestdan ajratiladi.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY contribution_request_id
           ORDER BY created_at ASC, id ASC
         ) AS position
  FROM audio_submissions
  WHERE contribution_request_id IS NOT NULL
)
UPDATE audio_submissions AS audio
SET contribution_request_id = NULL
FROM ranked
WHERE audio.id = ranked.id
  AND ranked.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS audio_submissions_one_per_request
  ON audio_submissions(contribution_request_id)
  WHERE contribution_request_id IS NOT NULL;

-- Bitta lug‘at so‘ziga aynan bir xil audio baytlari qayta biriktirilmaydi.
-- Tarixiy dublikat fayllar saqlanadi, faqat canonical so‘z bog‘lanishi qoladi.
WITH ranked_word_audio AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY word_id, checksum_sha256
           ORDER BY created_at ASC, id ASC
         ) AS position
  FROM audio_submissions
  WHERE word_id IS NOT NULL
)
UPDATE audio_submissions AS audio
SET word_id = NULL
FROM ranked_word_audio
WHERE audio.id = ranked_word_audio.id
  AND ranked_word_audio.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS audio_submissions_unique_word_recording
  ON audio_submissions(word_id, checksum_sha256)
  WHERE word_id IS NOT NULL;

-- Audio va STT endpointlari uchun barcha backend instansiyalariga umumiy,
-- atomik fixed-window rate-limit hisoblagichi.
CREATE TABLE IF NOT EXISTS api_rate_limits (
  bucket            text NOT NULL,
  window_start_ms   bigint NOT NULL,
  request_count     integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  expires_at        timestamptz NOT NULL,
  PRIMARY KEY (bucket, window_start_ms)
);

CREATE INDEX IF NOT EXISTS api_rate_limits_expiry_idx
  ON api_rate_limits(expires_at);
