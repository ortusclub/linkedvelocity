-- Flag a self-serve change of payout method/details on the payouts console.
ALTER TABLE "referrers" ADD COLUMN "payout_change" JSONB;
ALTER TABLE "ambassador_applications" ADD COLUMN "payout_change" JSONB;
