BEGIN;
-- CreateTable
CREATE TABLE "reading_jobs" (
    "id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "product_code" VARCHAR(50) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'queued',
    "stage" VARCHAR(20) NOT NULL DEFAULT 'queued',
    "request_id" VARCHAR(128) NOT NULL,
    "result" JSONB,
    "error_reason" VARCHAR(60),
    "lease_id" UUID,
    "lease_until" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "reading_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reading_job_participants" (
    "job_id" UUID NOT NULL,
    "chart_id" UUID NOT NULL,
    "position" SMALLINT NOT NULL,

    CONSTRAINT "reading_job_participants_pkey" PRIMARY KEY ("job_id","chart_id")
);

-- CreateTable
CREATE TABLE "reading_requests" (
    "owner_user_id" UUID NOT NULL,
    "request_key" UUID NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "job_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reading_requests_pkey" PRIMARY KEY ("owner_user_id","request_key")
);

-- CreateIndex
CREATE INDEX "reading_jobs_status_created_at_idx" ON "reading_jobs"("status", "created_at");

-- CreateIndex
CREATE INDEX "reading_jobs_owner_user_id_created_at_id_idx" ON "reading_jobs"("owner_user_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "reading_job_participants_chart_id_idx" ON "reading_job_participants"("chart_id");

-- CreateIndex
CREATE UNIQUE INDEX "reading_job_participants_job_id_position_key" ON "reading_job_participants"("job_id", "position");

-- CreateIndex
CREATE INDEX "reading_requests_job_id_idx" ON "reading_requests"("job_id");

-- AddForeignKey
ALTER TABLE "reading_jobs" ADD CONSTRAINT "reading_jobs_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reading_job_participants" ADD CONSTRAINT "reading_job_participants_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "reading_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reading_job_participants" ADD CONSTRAINT "reading_job_participants_chart_id_fkey" FOREIGN KEY ("chart_id") REFERENCES "saju_charts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reading_requests" ADD CONSTRAINT "reading_requests_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reading_requests" ADD CONSTRAINT "reading_requests_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "reading_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Durable per-owner admission control, including multiple backend instances.
CREATE UNIQUE INDEX "reading_jobs_one_active_owner" ON "reading_jobs" ("owner_user_id") WHERE "status" IN ('queued', 'running');
ALTER TABLE "reading_jobs" ADD CONSTRAINT "reading_jobs_state_check" CHECK (
  (status = 'queued' AND stage = 'queued' AND result IS NULL AND error_reason IS NULL AND lease_id IS NULL AND lease_until IS NULL AND completed_at IS NULL)
  OR (status = 'running' AND stage IN ('preparing', 'interpreting', 'saving') AND result IS NULL AND error_reason IS NULL AND lease_id IS NOT NULL AND lease_until IS NOT NULL AND started_at IS NOT NULL AND completed_at IS NULL)
  OR (status = 'succeeded' AND stage = 'finished' AND result IS NOT NULL AND error_reason IS NULL AND lease_id IS NULL AND lease_until IS NULL AND completed_at IS NOT NULL)
  OR (status = 'failed' AND stage = 'finished' AND result IS NULL AND error_reason IS NOT NULL AND lease_id IS NULL AND lease_until IS NULL AND completed_at IS NOT NULL)
);
ALTER TABLE "reading_job_participants" ADD CONSTRAINT "reading_participant_position_check" CHECK (position >= 0);
ALTER TABLE "reading_requests" ADD CONSTRAINT "reading_request_hash_check" CHECK (request_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE "reading_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reading_job_participants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reading_requests" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "reading_jobs", "reading_job_participants", "reading_requests" FROM PUBLIC;
DO $$
DECLARE client_role TEXT;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      EXECUTE format('REVOKE ALL ON reading_jobs, reading_job_participants, reading_requests FROM %I', client_role);
    END IF;
  END LOOP;
END $$;

COMMIT;
