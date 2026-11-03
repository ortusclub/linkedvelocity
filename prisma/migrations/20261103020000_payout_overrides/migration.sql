-- Admin overrides for the unified payouts console (checked / paused), keyed by payee key.
CREATE TABLE "payout_overrides" (
    "key" TEXT NOT NULL,
    "checked_at" TIMESTAMP(3),
    "pause_reason" TEXT,
    "paused_at" TIMESTAMP(3),
    "pause_note" TEXT,
    "pause_emailed" JSONB,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "payout_overrides_pkey" PRIMARY KEY ("key")
);
