
-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "main_contact_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_people" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "inbound_lead_id" UUID,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "channel" TEXT,
    "contact" TEXT,
    "company_id" UUID,
    "role" TEXT,
    "source" TEXT,
    "poc_owner" TEXT,
    "follow_up" TIMESTAMP(3),
    "lead_stage" TEXT,
    "is_test" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "direction" TEXT,
    "author_name" TEXT,
    "author_email" TEXT,
    "external_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "duplicate_suggestions" (
    "id" UUID NOT NULL,
    "person_a_id" UUID NOT NULL,
    "person_b_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "dismissed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "duplicate_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "companies_domain_key" ON "companies"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "crm_people_user_id_key" ON "crm_people"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_people_inbound_lead_id_key" ON "crm_people"("inbound_lead_id");

-- CreateIndex
CREATE INDEX "crm_people_company_id_idx" ON "crm_people"("company_id");

-- CreateIndex
CREATE INDEX "crm_people_last_activity_at_idx" ON "crm_people"("last_activity_at");

-- CreateIndex
CREATE INDEX "conversations_person_id_created_at_idx" ON "conversations"("person_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "duplicate_suggestions_person_a_id_person_b_id_key" ON "duplicate_suggestions"("person_a_id", "person_b_id");

-- AddForeignKey
ALTER TABLE "crm_people" ADD CONSTRAINT "crm_people_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_people" ADD CONSTRAINT "crm_people_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "crm_people"("id") ON DELETE CASCADE ON UPDATE CASCADE;
