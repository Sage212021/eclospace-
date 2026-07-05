-- CreateTable
CREATE TABLE "login_challenges" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_challenges_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "login_challenges" ADD CONSTRAINT "login_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
