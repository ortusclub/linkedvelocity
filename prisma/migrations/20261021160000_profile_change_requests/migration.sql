-- CreateEnum
CREATE TYPE "ProfileChangeField" AS ENUM ('banner', 'headline', 'about', 'experience', 'location', 'other');

-- CreateEnum
CREATE TYPE "ProfileChangeStatus" AS ENUM ('planned', 'done', 'needs_info', 'rejected');

-- CreateTable
CREATE TABLE "profile_change_requests" (
    "id" UUID NOT NULL,
    "rental_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "field" "ProfileChangeField" NOT NULL,
    "value" TEXT,
    "file_url" TEXT,
    "experience" JSONB,
    "status" "ProfileChangeStatus" NOT NULL DEFAULT 'planned',
    "planned_for" TIMESTAMP(3) NOT NULL,
    "applied_at" TIMESTAMP(3),
    "admin_note" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profile_change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "profile_change_requests_rental_id_idx" ON "profile_change_requests"("rental_id");

-- CreateIndex
CREATE INDEX "profile_change_requests_status_planned_for_idx" ON "profile_change_requests"("status", "planned_for");

-- AddForeignKey
ALTER TABLE "profile_change_requests" ADD CONSTRAINT "profile_change_requests_rental_id_fkey" FOREIGN KEY ("rental_id") REFERENCES "rentals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_change_requests" ADD CONSTRAINT "profile_change_requests_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "linkedin_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
