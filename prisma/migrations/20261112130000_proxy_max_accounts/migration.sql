-- Per-IP account cap override for the accounts-per-IP A/B/C test.
-- NULL keeps the current behaviour (default cap of 4). Set to 1/2/3 to put an IP
-- in a tighter test bucket; the proxy assigner and onboarding pool both honour it.
ALTER TABLE "proxies" ADD COLUMN "max_accounts" INTEGER;
