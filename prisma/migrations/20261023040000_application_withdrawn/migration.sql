-- Referrer self-withdraw: soft-hide a signup from the referrer portal while keeping the record.
-- IF NOT EXISTS so applying the column directly to prod (ahead of this migration being recorded)
-- stays safe and a later `prisma migrate deploy` is a no-op rather than a failure.
ALTER TABLE "ambassador_applications" ADD COLUMN IF NOT EXISTS "withdrawn_at" TIMESTAMP(3);
