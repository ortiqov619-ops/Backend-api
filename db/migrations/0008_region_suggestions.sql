-- "Boshqa hudud" qiymati contribution payload ichida alohida, moderatsiya
-- qilinadigan taklif sifatida saqlanadi. Rasmiy `regions` katalogiga faqat
-- administrator mavjud /admin/regions oqimi orqali qo‘shadi.

BEGIN;

ALTER TABLE contribution_requests
  ADD CONSTRAINT contribution_requests_proposed_region_shape CHECK (
    NOT (payload ? 'proposedRegion')
    OR COALESCE((
      jsonb_typeof(payload->'proposedRegion') = 'object'
      AND jsonb_typeof(payload->'proposedRegion'->'nameUz') = 'string'
      AND length(btrim(payload->'proposedRegion'->>'nameUz')) BETWEEN 2 AND 80
      AND jsonb_typeof(payload->'proposedRegion'->'level') = 'string'
      AND payload->'proposedRegion'->>'level' IN ('district', 'village', 'neighborhood')
      AND jsonb_typeof(payload->'proposedRegion'->'parentRegionId') = 'string'
      AND payload->'proposedRegion'->>'parentRegionId'
        ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    ), false)
  ) NOT VALID;

-- NOT VALID mavjud eski yozuvlarni o‘zgartirmaydi va deployni to‘xtatmaydi;
-- PostgreSQL baribir yangi INSERT/UPDATE qiymatlari uchun constraintni
-- darhol qo‘llaydi. Eski malformed payloadlar audit dalili sifatida qoladi.

CREATE INDEX contribution_requests_proposed_region_queue_idx
  ON contribution_requests(status, created_at DESC)
  WHERE payload ? 'proposedRegion';

COMMIT;
