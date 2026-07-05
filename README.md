# Eclospace

**La plateforme de gestion éditoriale d'Éclosion Édition** — un ERP qui suit chaque manuscrit du dépôt à l'archivage : lecture, contrat, correction, fabrication, stock, ventes et droits d'auteur.

- 📘 Commencer par : `docs/07_Synthese_executive.md`
- 📐 Conception complète : dossier `docs/`
- 🖥️ Prototype navigable : `prototype/Phase3_Prototype_UI.html` (à ouvrir dans un navigateur)
- 🤖 Instructions de développement : `CLAUDE.md` (lu automatiquement par Claude Code)
- 📊 État du projet : `AVANCEMENT.md`

Chef de projet : M. Noah Mbala Yves B. · Éclosion Édition — *L'avenir du livre*

## Démarrage local (Lot 0)

Prérequis : Node.js ≥ 20.6, PostgreSQL 16 (ou `docker compose up -d` pour une base locale).

```bash
# Backend
cd backend
cp .env.example .env
npm install
npm run prisma:migrate   # crée les tables
npm run seed              # départements, rôles, permissions, compte admin
npm run dev                # http://localhost:3000

# Frontend (autre terminal)
cd frontend
cp .env.example .env
npm install
npm run dev                # http://localhost:5173
```

Le compte administrateur initial est affiché par `npm run seed` (identifiant `admin`) — à changer dès la première connexion.

Tests backend : `cd backend && npm test` (utilise une base PostgreSQL séparée, voir `.env.test`).

Détail des choix techniques : `docs/JOURNAL_TECHNIQUE.md`.
