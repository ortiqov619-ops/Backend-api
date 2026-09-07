-- Boshqariladigan Application API keys.
-- Ochiq secret bazaga yozilmaydi: faqat yuqori entropiyali tokenning
-- SHA-256 izi saqlanadi va secret create/rotate javobida bir marta beriladi.

BEGIN;

ALTER TYPE audit_entity_type ADD VALUE IF NOT EXISTS 'application_api_key';

CREATE TABLE IF NOT EXISTS application_api_keys (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id           text NOT NULL UNIQUE CHECK (public_id ~ '^[A-Za-z0-9_-]{12}$'),
  name                text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 80),
  secret_hash         text NOT NULL UNIQUE CHECK (secret_hash ~ '^[0-9a-f]{64}$'),
  masked_hint         text NOT NULL CHECK (char_length(masked_hint) BETWEEN 8 AND 40),
  scopes              text[] NOT NULL CHECK (cardinality(scopes) > 0),
  expires_at          timestamptz,
  rate_limit_per_hour integer NOT NULL DEFAULT 1000 CHECK (rate_limit_per_hour BETWEEN 10 AND 10000),
  is_active           boolean NOT NULL DEFAULT true,
  last_used_at        timestamptz,
  last_used_ip        inet,
  revoked_at          timestamptz,
  revoked_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  revoke_reason       text,
  rotated_from_id     uuid REFERENCES application_api_keys(id) ON DELETE SET NULL,
  created_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT application_api_keys_revocation_consistency CHECK (
    (is_active AND revoked_at IS NULL AND revoke_reason IS NULL)
    OR (NOT is_active AND revoked_at IS NOT NULL AND char_length(btrim(revoke_reason)) >= 3)
  )
);

CREATE INDEX IF NOT EXISTS application_api_keys_status_idx
  ON application_api_keys(is_active, expires_at, created_at DESC);

DROP TRIGGER IF EXISTS application_api_keys_set_updated_at ON application_api_keys;
CREATE TRIGGER application_api_keys_set_updated_at BEFORE UPDATE ON application_api_keys
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

UPDATE roles
   SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['api_keys:read', 'api_keys:write']))
 WHERE code = 'admin';

COMMIT;
