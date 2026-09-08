CREATE TYPE "user_consent_type" AS ENUM (
  'terms_of_service',
  'privacy_policy',
  'age_requirement'
);

CREATE TABLE "user_consents" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "type" "user_consent_type" NOT NULL,
  "version" VARCHAR(50) NOT NULL,
  "accepted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "user_consents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "user_consents_user_id_idx" ON "user_consents"("user_id");

CREATE UNIQUE INDEX "user_consents_user_id_type_version_key"
ON "user_consents"("user_id", "type", "version");

ALTER TABLE "user_consents"
ADD CONSTRAINT "user_consents_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
