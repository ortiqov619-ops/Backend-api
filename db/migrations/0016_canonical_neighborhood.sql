-- Rasmiy mahalla tanlovi endi contribution payloadda yo'qolib qolmaydi:
-- tasdiqlangan so'z ham katalogdagi mahalla UUIDsini saqlaydi.

BEGIN;

ALTER TABLE words
  ADD COLUMN IF NOT EXISTS neighborhood_id uuid REFERENCES regions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS words_neighborhood_idx ON words(neighborhood_id);

COMMENT ON COLUMN words.neighborhood_id IS
  'Rasmiy regions katalogidagi neighborhood darajali hudud; eski erkin matn contribution payloadda qoladi.';

COMMIT;
