-- Manual status override for off-platform renters / abandoned ghosts (beats derived status)
ALTER TABLE "crm_people" ADD COLUMN "status_override" TEXT;
