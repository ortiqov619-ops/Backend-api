-- Faqat foydalanuvchi roziligi bilan keladigan ilova ochilish statistikasi.
-- Aniq koordinata saqlanmaydi: owner paneliga faqat Xorazm/tashqarida va
-- server aniqlay olgan hudud kesimi kerak bo‘ladi.

BEGIN;

CREATE TYPE app_location_classification AS ENUM ('xorazm', 'outside', 'unknown');

CREATE TABLE app_open_events (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_id         text NOT NULL,
  app_version             text NOT NULL,
  location_consent        boolean NOT NULL,
  classification          app_location_classification NOT NULL,
  region_id               uuid REFERENCES regions(id) ON DELETE SET NULL,
  opened_at               timestamptz NOT NULL,
  received_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX app_open_events_opened_idx ON app_open_events(opened_at DESC);
CREATE INDEX app_open_events_region_idx ON app_open_events(region_id, opened_at DESC);
CREATE INDEX app_open_events_installation_idx ON app_open_events(installation_id, opened_at DESC);

COMMIT;
