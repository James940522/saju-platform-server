CREATE TABLE "account_withdrawals" (
  "auth_subject" UUID PRIMARY KEY,
  "kakao_user_id" VARCHAR(20) NOT NULL CHECK ("kakao_user_id" ~ '^[1-9][0-9]{0,18}$'),
  "phase" VARCHAR(30) NOT NULL DEFAULT 'unlink_kakao'
    CHECK ("phase" IN ('unlink_kakao', 'delete_auth', 'delete_user')),
  "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" >= 0),
  "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lease_id" UUID,
  "lease_until" TIMESTAMPTZ(3),
  "last_error" VARCHAR(50),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (("lease_id" IS NULL) = ("lease_until" IS NULL))
);
CREATE INDEX "account_withdrawals_next_attempt_at_idx" ON "account_withdrawals"("next_attempt_at");
ALTER TABLE "account_withdrawals" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "account_withdrawals" FROM PUBLIC;
DO $$
DECLARE client_role TEXT;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      EXECUTE format('REVOKE ALL ON account_withdrawals FROM %I', client_role);
    END IF;
  END LOOP;
END $$;
