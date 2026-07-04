# Eclospace — Avancement du développement

| Lot | Contenu | Statut |
|---|---|---|
| Lot 0 | Fondations (sécurité, rôles, audit, GED, notifications) | En cours — socle backend/frontend fonctionnel |
| Lot 1 | Entrée des manuscrits, comité de lecture, workflow | En cours — flux complet fonctionnel (étapes 1 à 5) |
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

### 04/07/2026 (suite) — Lot 1 : flux complet manuscrit → comité de lecture → décision éditoriale

**Fait :**
- Schéma Prisma du domaine éditorial : `authors`, `genres`, `collections`, `manuscripts`, `work_contributors`, `workflow_statuses` (les 20 étapes du Ch. 4 §4.3 référencées dès maintenant, seules les étapes 1 à 4 sont pilotées par l'application), `manuscript_steps`, `step_transitions`, `reading_assignments`, `evaluation_criteria`, `evaluations`, `evaluation_scores`, `editorial_decisions`.
- **Secrétariat éditorial** (Ch. 6) : création de manuscrit avec numéro auto-généré (`MS-AAAA-NNNN`, compteur atomique en base), étape 1 (réception) validée automatiquement à la création, fiche manuscrit, frise chronologique (`GET /manuscripts/{id}/timeline`), ajustement manuel de priorité tracé.
- **Moteur de workflow** générique (Ch. 4 §4.2, §4.5) : impossible de valider une étape hors séquence (le statut courant du manuscrit fait foi), notifications au département suivant à chaque transition.
- **Comité de lecture** (Ch. 7) : affectation de lecteurs, grille de notation pondérée à 9 critères (score calculé **serveur**, jamais par le client), transmission **automatique** à la Direction éditoriale dès que tous les rapports attendus sont remis (§7.12).
- **Décision éditoriale** (Ch. 8 §8.2) : 5 décisions possibles, motivation obligatoire, écart de notation entre lecteurs signalé automatiquement ; un refus clôt le workflow directement vers l'archivage (Ch. 4 §4.3), une acceptation avance vers la contractualisation (Lot 2).
- **5 nouveaux tests automatisés** (16 au total, tous verts) : numérotation, séquencement strict des étapes, permissions par rôle, calcul pondéré du score (vérifié non équivalent à une simple moyenne), refus → archivage direct.
- **Frontend** : liste des manuscrits avec création, fiche manuscrit avec frise visuelle (`.spine` du guide de style), formulaire de vérification administrative, affectation de lecteur, écran « Mes lectures » avec curseurs de notation en direct, formulaire de décision éditoriale. Flux complet vérifié dans un navigateur réel, captures à l'appui.
- Deux ajouts pragmatiques hors périmètre strict de la spec API (documentés dans `JOURNAL_TECHNIQUE.md`) : `GET /users` et `GET /genres`/`GET /collections`/`GET /evaluation-criteria`, nécessaires aux listes déroulantes de l'interface.
- Bug corrigé en cours de route : le statut du manuscrit ne progressait pas après la validation automatique de l'étape 1 à la création (restait bloqué sur « Réception »).

**Points d'interprétation à faire valider par la Direction éditoriale** (détail dans `docs/JOURNAL_TECHNIQUE.md`) : échelle de notation (0-10), seuils de classement qualitatif, seuil d'écart entre lecteurs, coefficients par défaut des critères non explicités par le cahier des charges, liste de départ des genres.

**Limites connues de ce Lot 1 :**
- Pas de vue « responsable du comité » consolidée (charge de travail par lecteur, Ch. 7 §7.3) — nécessiterait un tableau de bord dédié, hors périmètre minimal du Lot 1.
- Pas de gestion des délais/rappels automatiques (Ch. 7 §7.8) au-delà du champ échéance.
- Contractualisation, planification, Gantt (Ch. 8 §8.4 et suivants) : Lot 2, non commencés.

**Prochaine étape :** faire valider ce Lot 1 par l'opérateur, puis démarrer le Lot 2 (contrats, planification/Gantt, correction avec comparateur de versions) une fois validé.
