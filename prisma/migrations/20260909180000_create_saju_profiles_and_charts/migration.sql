CREATE TYPE "saju_relation_type" AS ENUM (
  'self',
  'family',
  'friend',
  'partner',
  'other'
);

CREATE TYPE "saju_calendar_type" AS ENUM ('solar', 'lunar');

CREATE TYPE "birth_time_precision" AS ENUM ('exact', 'unknown');

CREATE TYPE "luck_cycle_gender" AS ENUM ('male', 'female');

CREATE TABLE "saju_profiles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "owner_user_id" UUID NOT NULL,
  "display_name" VARCHAR(30) NOT NULL,
  "relation_type" "saju_relation_type" NOT NULL,
  "calendar_type" "saju_calendar_type" NOT NULL,
  "birth_year" SMALLINT NOT NULL,
  "birth_month" SMALLINT NOT NULL,
  "birth_day" SMALLINT NOT NULL,
  "is_leap_month" BOOLEAN NOT NULL DEFAULT false,
  "birth_time_precision" "birth_time_precision" NOT NULL,
  "birth_hour" SMALLINT,
  "birth_minute" SMALLINT,
  "luck_cycle_gender" "luck_cycle_gender" NOT NULL,
  "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Seoul',
  "current_chart_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(3),

  CONSTRAINT "saju_profiles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "saju_profiles_birth_month_check"
    CHECK ("birth_month" BETWEEN 1 AND 12),
  CONSTRAINT "saju_profiles_birth_day_check"
    CHECK ("birth_day" BETWEEN 1 AND 31),
  CONSTRAINT "saju_profiles_solar_leap_month_check"
    CHECK ("calendar_type" = 'lunar' OR "is_leap_month" = false),
  CONSTRAINT "saju_profiles_birth_time_check"
    CHECK (
      (
        "birth_time_precision" = 'exact'
        AND "birth_hour" BETWEEN 0 AND 23
        AND "birth_minute" BETWEEN 0 AND 59
      )
      OR (
        "birth_time_precision" = 'unknown'
        AND "birth_hour" IS NULL
        AND "birth_minute" IS NULL
      )
    )
);

CREATE TABLE "saju_charts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "profile_id" UUID NOT NULL,
  "schema_version" SMALLINT NOT NULL,
  "engine_name" VARCHAR(50) NOT NULL,
  "engine_version" VARCHAR(50) NOT NULL,
  "policy_version" VARCHAR(50) NOT NULL,
  "input_hash" CHAR(64) NOT NULL,
  "payload" JSONB NOT NULL,
  "calculated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "saju_charts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "saju_charts_schema_version_check"
    CHECK ("schema_version" > 0),
  CONSTRAINT "saju_charts_input_hash_check"
    CHECK ("input_hash" ~ '^[0-9a-f]{64}$')
);

ALTER TABLE "users"
ADD COLUMN "primary_saju_profile_id" UUID;

CREATE UNIQUE INDEX "users_primary_saju_profile_id_key"
ON "users"("primary_saju_profile_id");

CREATE UNIQUE INDEX "saju_profiles_current_chart_id_key"
ON "saju_profiles"("current_chart_id");

CREATE INDEX "saju_profiles_owner_user_id_deleted_at_idx"
ON "saju_profiles"("owner_user_id", "deleted_at");

CREATE UNIQUE INDEX "saju_charts_profile_id_input_hash_key"
ON "saju_charts"("profile_id", "input_hash");

CREATE INDEX "saju_charts_profile_id_calculated_at_idx"
ON "saju_charts"("profile_id", "calculated_at");

ALTER TABLE "saju_profiles"
ADD CONSTRAINT "saju_profiles_owner_user_id_fkey"
FOREIGN KEY ("owner_user_id") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "saju_charts"
ADD CONSTRAINT "saju_charts_profile_id_fkey"
FOREIGN KEY ("profile_id") REFERENCES "saju_profiles"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "saju_profiles"
ADD CONSTRAINT "saju_profiles_current_chart_id_fkey"
FOREIGN KEY ("current_chart_id") REFERENCES "saju_charts"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "users"
ADD CONSTRAINT "users_primary_saju_profile_id_fkey"
FOREIGN KEY ("primary_saju_profile_id") REFERENCES "saju_profiles"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
