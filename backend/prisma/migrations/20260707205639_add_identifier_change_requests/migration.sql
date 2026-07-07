-- CreateTable
CREATE TABLE "identifier_change_requests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "new_username" TEXT,
    "new_email" TEXT,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "confirmed_at" TIMESTAMP(3),
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identifier_change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "identifier_change_requests_token_key" ON "identifier_change_requests"("token");

-- AddForeignKey
ALTER TABLE "identifier_change_requests" ADD CONSTRAINT "identifier_change_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
