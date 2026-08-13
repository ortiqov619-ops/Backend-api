-- Moderator «Qayta yozishni so‘rash» qarorini bergach, foydalanuvchi ayni
-- taklif uchun yangi talaffuz yubora olishi kerak edi. Amalda bu imkonsiz
-- edi: `audio_submissions_one_per_request` unikal indeksi har qanday ikkinchi
-- yozuvni bloklab, `409` qaytarardi va so‘rov navbatda muzlab qolardi.
--
-- Yechim: eski yozuv o‘chirilmaydi (audio dalil sifatida saqlanadi), balki
-- `superseded_at` bilan belgilanadi. Unikal cheklov endi faqat JORIY yozuvga
-- tegishli.

BEGIN;

ALTER TABLE audio_submissions
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES audio_submissions(id) ON DELETE SET NULL;

ALTER TABLE audio_submissions
  ADD CONSTRAINT audio_submissions_version_positive CHECK (version >= 1);

-- Almashtirilgan yozuv o‘zini almashtira olmaydi.
ALTER TABLE audio_submissions
  ADD CONSTRAINT audio_submissions_supersede_shape CHECK (
    superseded_by IS NULL OR (superseded_at IS NOT NULL AND superseded_by <> id)
  );

DROP INDEX IF EXISTS audio_submissions_one_per_request;

CREATE UNIQUE INDEX IF NOT EXISTS audio_submissions_one_current_per_request
  ON audio_submissions(contribution_request_id)
  WHERE contribution_request_id IS NOT NULL AND superseded_at IS NULL;

-- Navbat va tarix so‘rovlari uchun.
CREATE INDEX IF NOT EXISTS audio_submissions_current_queue_idx
  ON audio_submissions(moderation_status, created_at)
  WHERE superseded_at IS NULL;

COMMIT;
