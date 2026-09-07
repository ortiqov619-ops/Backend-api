-- =====================================================================
-- Migratsiya: 0018_release_artifacts
--
-- Reliz APK'lari endi PostgreSQL da saqlanadi.
--
-- NEGA: bu xizmat Render'ning BEPUL tarifida ishlaydi — u yerda doimiy
-- disk yo'q. `APK_UPLOAD_DIR` konteyner ichidagi vaqtinchalik fayl
-- tizimiga yozadi va har redeployda yo'qoladi. Natijada `app_releases`
-- yozuvi mavjud bo'lib turaveradi, lekin yuklab olish 404 qaytaradi —
-- ilova foydalanuvchiga o'lik yangilanish ko'rsatardi.
--
-- Bu aynan audio bilan bo'lgan muammo va u ham xuddi shu yo'l bilan
-- hal qilingan (0014_audio_in_database). Shu sabab bu yerda ham yangi
-- tashqi xizmat qo'shilmaydi: bayt massivi yozuv bilan bir tranzaksiyada
-- saqlanadi va u bilan birga o'chadi.
--
-- Doimiy disk yoki obyekt xotirasi paydo bo'lsa, `release-storage.ts`
-- dagi bitta modul almashtiriladi — chaqiruvchi kod o'zgarmaydi.
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS app_release_artifacts (
  release_id  uuid PRIMARY KEY REFERENCES app_releases(id) ON DELETE CASCADE,
  bytes       bytea NOT NULL,
  sha256      text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes  integer NOT NULL CHECK (size_bytes > 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE app_release_artifacts IS
  'Reliz APK baytlari. Render bepul tarifida doimiy disk yo''q, shuning uchun artefakt bazada saqlanadi.';

-- Retention va "artefakt bormi?" tekshiruvi uchun; bayt massivini
-- o'qimasdan mavjudlikni bilish kerak bo'ladi.
CREATE INDEX IF NOT EXISTS app_release_artifacts_created_idx
  ON app_release_artifacts(created_at DESC);

COMMIT;
