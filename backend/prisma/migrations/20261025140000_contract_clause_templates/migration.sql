-- Bibliothèque de modèles de contrat (§9, D-054) : texte par défaut éditable
-- d'un article standard, par type de document. Additif, sans impact sur
-- l'existant (une ligne absente = texte standard du code).

-- CreateTable
CREATE TABLE "contract_clause_templates" (
    "id" TEXT NOT NULL,
    "template_key" TEXT NOT NULL,
    "article_number" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    CONSTRAINT "contract_clause_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contract_clause_templates_template_key_article_number_key" ON "contract_clause_templates"("template_key", "article_number");
