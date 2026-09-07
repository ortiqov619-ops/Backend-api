-- =====================================================================
-- Migratsiya: 0019_release_artifact_chunks
--
-- 0018 artefaktni bitta `bytea` ustuniga yozardi. Bu production'da
-- ishlamadi: `node-postgres` `bytea` parametrini o'n oltilik MATN
-- ko'rinishida uzatadi, ya'ni 37 MB lik APK simda ~74 MB ga aylanadi.
-- Render bepul tarifidagi 512 MB RAM bunga yetmadi va nashr so'rovi
-- har safar 502 bilan tugadi (jarayon o'lardi).
--
-- Yechim: artefakt bo'laklarga bo'linib yoziladi. Har bir INSERT bir
-- necha megabayt bilan ishlaydi, o'qishda esa bo'laklar ketma-ket
-- oqim sifatida uzatiladi — to'liq fayl hech qachon xotiraga
-- yig'ilmaydi.
--
-- 0018 dagi jadval metama'lumot uchun qoladi (checksum va hajm), uning
-- `bytes` ustuni esa olib tashlanadi. Production'da u bo'sh: 0018
-- deploy qilingandan keyin birorta yuklash muvaffaqiyatli tugamagan.
-- =====================================================================

BEGIN;

ALTER TABLE app_release_artifacts DROP COLUMN IF EXISTS bytes;

CREATE TABLE IF NOT EXISTS app_release_artifact_chunks (
  release_id  uuid    NOT NULL REFERENCES app_release_artifacts(release_id) ON DELETE CASCADE,
  chunk_index integer NOT NULL CHECK (chunk_index >= 0),
  bytes       bytea   NOT NULL,
  PRIMARY KEY (release_id, chunk_index)
);

COMMENT ON TABLE app_release_artifact_chunks IS
  'Reliz APK baytlari bo''laklarda. Bitta katta bytea Render bepul tarifidagi xotiraga sig''maydi.';

COMMIT;
