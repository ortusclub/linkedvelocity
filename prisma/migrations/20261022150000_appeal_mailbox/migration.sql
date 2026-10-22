-- CreateTable
CREATE TABLE "appeal_mailboxes" (
    "id" UUID NOT NULL,
    "address" TEXT NOT NULL,
    "linkedin_account_id" UUID NOT NULL,
    "label" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appeal_mailboxes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "appeal_mailboxes_address_key" ON "appeal_mailboxes"("address");

-- CreateIndex
CREATE INDEX "appeal_mailboxes_linkedin_account_id_created_at_idx" ON "appeal_mailboxes"("linkedin_account_id", "created_at");

-- AddForeignKey
ALTER TABLE "appeal_mailboxes" ADD CONSTRAINT "appeal_mailboxes_linkedin_account_id_fkey" FOREIGN KEY ("linkedin_account_id") REFERENCES "linkedin_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
