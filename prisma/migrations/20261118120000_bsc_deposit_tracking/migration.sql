-- Track USDT/USDC received on BNB Smart Chain at the same per-customer deposit addresses.
ALTER TABLE "deposit_addresses" ADD COLUMN "bsc_usdt_last_seen" DECIMAL(38,18) NOT NULL DEFAULT 0;
ALTER TABLE "deposit_addresses" ADD COLUMN "bsc_usdc_last_seen" DECIMAL(38,18) NOT NULL DEFAULT 0;
