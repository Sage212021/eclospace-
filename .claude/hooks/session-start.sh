#!/bin/bash
set -euo pipefail

# N'exécuter que dans un environnement distant (Claude Code on the web) :
# en local, l'opérateur gère son propre PostgreSQL (docker-compose.yml).
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# PostgreSQL n'est pas démarré automatiquement dans ce conteneur (pas de
# systemd) : sans ce démarrage, toutes les requêtes API échouent et
# l'interface reste bloquée sur le chargement (aucune donnée ne peut jamais
# arriver). C'est la cause du blocage rencontré en validation Lot 6.
service postgresql start || true

# Attendre que PostgreSQL accepte les connexions (jusqu'à ~30s).
for i in $(seq 1 30); do
  if pg_isready -h localhost -p 5432 >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! pg_isready -h localhost -p 5432 >/dev/null 2>&1; then
  echo "ERREUR : PostgreSQL n'a pas démarré à temps." >&2
  exit 1
fi

cd "$CLAUDE_PROJECT_DIR/backend"

# Migrations + seed sur la base de développement (idempotents : seed.ts
# n'utilise que des upsert/find-then-create). Nécessaires pour que
# `npm run dev` et la vérification navigateur fonctionnent immédiatement.
node --env-file=.env node_modules/.bin/prisma migrate deploy
node --env-file=.env node_modules/.bin/tsx prisma/seed.ts

# Migrations sur la base de test (le seed de test est déjà rejoué par le
# script `pretest` à chaque `npm test`, inutile de le dupliquer ici).
node --env-file=.env.test node_modules/.bin/prisma migrate deploy
