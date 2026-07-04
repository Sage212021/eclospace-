# Eclospace — Avancement du développement

| Lot | Contenu | Statut |
|---|---|---|
| Lot 0 | Fondations (sécurité, rôles, audit, GED, notifications) | En cours — socle backend/frontend fonctionnel |
| Lot 1 | Entrée des manuscrits, comité de lecture, workflow | En attente |
| Lot 2 | Contrats, planification/Gantt, correction | En attente |
| Lot 3 | Maquette, infographie, ISBN, BAT, impression | En attente |
| Lot 4 | Stock et commercial | En attente |
| Lot 5 | Finance et droits d'auteur | En attente |
| Lot 6 | RH, pilotage, rapports | En attente |

## Journal des sessions
(Claude Code complète à chaque session : date, ce qui a été fait, prochaine étape)

### 04/07/2026 — Décompression du dossier de conception + démarrage du Lot 0

**Fait :**
- Dossier de conception décompressé et rangé (`CLAUDE.md`, `README.md`, `AVANCEMENT.md`, `docs/`, `prototype/`).
- Décisions actées : hébergement **Cloud** (D-004, `docs/06_Registre_des_decisions.md`), logo reçu (`assets/logo/eclospace-logo.jpg` — JPG fond blanc ; **une version PNG transparent ou SVG reste à demander à la maison** pour la barre latérale sombre, cf. guide de style §9).
- Stack technique choisie et documentée (`docs/JOURNAL_TECHNIQUE.md`) : Node.js/TypeScript/Fastify + Prisma + PostgreSQL côté backend, React/Vite côté frontend.
- **Backend** (`backend/`) : authentification (argon2 + session signée + 2FA TOTP), `GET /api/v1/me`, matrice rôles/permissions appliquée côté serveur à chaque route, journal d'audit `audit_log` **append-only au niveau base** (trigger PostgreSQL, vérifié même en superutilisateur), GED (`documents`/`document_versions` avec hash SHA-256 calculé serveur, contenu figé après création), notifications internes. Schéma Prisma complet du domaine transverse (17 départements, rôles, permissions, utilisateurs).
- Seed de référence : 17 départements (Ch. 3 §3.2), 17 rôles (Ch. 2 §2.2 + Ch. 3 §3.3), compte administrateur initial.
- **6 tests automatisés** (Vitest) sur les règles critiques du Lot 0 : rejet d'identifiants invalides, permissions effectives via `/me`, refus 403 d'une action hors périmètre d'un rôle, flux 2FA complet (activation + refus de code invalide), immutabilité du journal d'audit. Tous passent, de façon reproductible.
- **Frontend** (`frontend/`) : écran de connexion (logo, 2FA), coquille UI (barre latérale filtrée par permissions, barre de recherche + cloche de notifications, tableau de bord) aux jetons du guide de style. Vérifié dans un navigateur réel (captures à l'appui).
- Bug corrigé en cours de route : les middlewares de permission Fastify doivent être `async` (une fonction sync à 2 arguments fait attendre indéfiniment la requête) — voir `backend/src/lib/permissions.ts`.

**Limites connues de ce Lot 0 (à ne pas prendre pour des oublis) :**
- Pas encore d'écran de gestion des comptes/rôles ni d'endpoint de création d'utilisateur : le RH complet est spécifié au Lot 6 ; en attendant, les comptes se créent via le script de seed ou directement en base.
- Les préférences de notification par type d'événement (§2.2 de la spec API) ne sont pas modélisées : aucune table dédiée dans `02_Modele_de_donnees.md` — à trancher quand ce point sera abordé.
- Fournisseur cloud et région précis non choisis (D-004 acte seulement l'option Cloud) : à faire avant la mise en production.

**Validation opérateur (04/07/2026) :** M. Noah Mbala accepte les captures d'écran (connexion, 2FA, tableau de bord) comme preuve de bon fonctionnement du Lot 0. *Note transparente : il ne s'agit pas encore d'un test pratique par l'opérateur lui-même dans son navigateur — cela suppose un environnement de recette hébergé, qui n'existe pas encore (fournisseur cloud précis non choisi). Ce test réel devra être fait dès que cet environnement existera.* Sur cette base, le Lot 1 démarre.

**Prochaine étape :** Lot 1 — secrétariat éditorial (Ch. 6), comité de lecture avec notation pondérée (Ch. 7), décision éditoriale et moteur de workflow avec la frise (Ch. 4, 8 §8.2-8.3).
