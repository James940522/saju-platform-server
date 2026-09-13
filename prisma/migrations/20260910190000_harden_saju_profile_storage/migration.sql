BEGIN;

ALTER TABLE "saju_profiles" DROP CONSTRAINT "saju_profiles_birth_time_check";
ALTER TABLE "saju_profiles" ADD CONSTRAINT "saju_profiles_birth_time_check"
CHECK (
  ("birth_time_precision" = 'exact'
    AND "birth_hour" IS NOT NULL AND "birth_minute" IS NOT NULL
    AND "birth_hour" BETWEEN 0 AND 23 AND "birth_minute" BETWEEN 0 AND 59)
  OR ("birth_time_precision" = 'unknown'
    AND "birth_hour" IS NULL AND "birth_minute" IS NULL)
);

CREATE TABLE "saju_profile_creations" (
  "owner_user_id" UUID NOT NULL,
  "request_key" UUID NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "profile_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "saju_profile_creations_pkey" PRIMARY KEY ("owner_user_id", "request_key"),
  CONSTRAINT "saju_profile_creations_request_hash_check" CHECK ("request_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "saju_profile_creations_owner_user_id_fkey" FOREIGN KEY ("owner_user_id")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "saju_profile_creations_profile_id_fkey" FOREIGN KEY ("profile_id")
    REFERENCES "saju_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "saju_profile_creations_profile_id_idx" ON "saju_profile_creations"("profile_id");

-- Only the server DB role accesses these tables; browser roles have no policies.
ALTER TABLE "saju_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "saju_charts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "saju_profile_creations" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "saju_profiles", "saju_charts", "saju_profile_creations" FROM PUBLIC;
DO $$
DECLARE client_role TEXT;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      EXECUTE format('REVOKE ALL ON saju_profiles, saju_charts, saju_profile_creations FROM %I', client_role);
    END IF;
  END LOOP;
END $$;

COMMIT;
