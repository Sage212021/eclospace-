-- Moteur de correction éditoriale IA : types d'ouvrage + grilles de contrôle
-- (profils par type, éditables), avec profil par défaut en repli.
CREATE TABLE "book_types" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    CONSTRAINT "book_types_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "book_types_code_key" ON "book_types"("code");

CREATE TABLE "correction_profiles" (
    "id" TEXT NOT NULL,
    "book_type_code" TEXT,
    "label" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    CONSTRAINT "correction_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "correction_profiles_book_type_code_key" ON "correction_profiles"("book_type_code");

CREATE TABLE "correction_control_points" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "default_severity" TEXT NOT NULL DEFAULT 'C3',
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "correction_control_points_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "correction_control_points_profile_id_idx" ON "correction_control_points"("profile_id");

ALTER TABLE "correction_control_points" ADD CONSTRAINT "correction_control_points_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "correction_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
