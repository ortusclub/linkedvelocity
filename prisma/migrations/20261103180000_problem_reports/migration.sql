-- Renter-reported problems on a rented account (Renter Dashboard v3 "Something wrong? Report it").
CREATE TABLE "problem_reports" (
    "id" UUID NOT NULL,
    "rental_id" UUID NOT NULL,
    "linkedin_account_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "ticket_ref" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    CONSTRAINT "problem_reports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "problem_reports_ticket_ref_key" ON "problem_reports"("ticket_ref");
CREATE INDEX "problem_reports_user_id_status_idx" ON "problem_reports"("user_id", "status");
CREATE INDEX "problem_reports_rental_id_created_at_idx" ON "problem_reports"("rental_id", "created_at");
