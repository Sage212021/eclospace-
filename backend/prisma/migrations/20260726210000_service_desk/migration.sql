-- CreateEnum
CREATE TYPE "ServiceDesk" AS ENUM ('education', 'client');
CREATE TYPE "ServiceMessageSender" AS ENUM ('author', 'staff');

-- CreateTable
CREATE TABLE "service_threads" (
    "id" TEXT NOT NULL,
    "partner_id" TEXT NOT NULL,
    "service" "ServiceDesk" NOT NULL,
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_message_at" TIMESTAMP(3),
    "author_read_at" TIMESTAMP(3),
    "staff_read_at" TIMESTAMP(3),

    CONSTRAINT "service_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_messages" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "sender_kind" "ServiceMessageSender" NOT NULL,
    "sender_user_id" TEXT,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "service_threads_partner_id_idx" ON "service_threads"("partner_id");
CREATE INDEX "service_threads_service_idx" ON "service_threads"("service");
CREATE INDEX "service_messages_thread_id_created_at_idx" ON "service_messages"("thread_id","created_at");

-- AddForeignKey
ALTER TABLE "service_threads" ADD CONSTRAINT "service_threads_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_messages" ADD CONSTRAINT "service_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "service_threads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
