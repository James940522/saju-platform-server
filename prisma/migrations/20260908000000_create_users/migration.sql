CREATE TYPE "user_status" AS ENUM (
  'pending_registration',
  'active',
  'suspended',
  'withdrawn'
);

CREATE TABLE "users" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "auth_subject" UUID NOT NULL,
  "status" "user_status" NOT NULL DEFAULT 'pending_registration',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "withdrawn_at" TIMESTAMPTZ(3),

  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_auth_subject_key" ON "users"("auth_subject");
