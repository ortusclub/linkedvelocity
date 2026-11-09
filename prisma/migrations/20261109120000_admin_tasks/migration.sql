-- Dashboard To-do worklist: human state (claim / assignee / done) for tasks that are
-- otherwise derived live from signals. Keyed by a stable task_key so state survives
-- regeneration; a row whose task_key is no longer generated is simply ignored.
CREATE TABLE "admin_tasks" (
    "id" TEXT NOT NULL,
    "task_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "claimed_by_id" UUID,
    "claimed_at" TIMESTAMP(3),
    "done_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_tasks_task_key_key" ON "admin_tasks"("task_key");

-- CreateIndex
CREATE INDEX "admin_tasks_status_idx" ON "admin_tasks"("status");

-- AddForeignKey
ALTER TABLE "admin_tasks" ADD CONSTRAINT "admin_tasks_claimed_by_id_fkey" FOREIGN KEY ("claimed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
