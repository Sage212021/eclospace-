# Eclospace — Avancement du développement

| Lot | Contenu | Statut |
|---|---|---|
| Lot 0 | Fondations (sécurité, rôles, audit, GED, notifications) | En cours — socle backend/frontend fonctionnel |
| Lot 1 | Entrée des manuscrits, comité de lecture, workflow | En cours — flux complet fonctionnel (étapes 1 à 5) |
| Lot 2 | Contrats, planification/Gantt, correction | En cours — flux complet fonctionnel (étapes 5 à 7) |
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

### 04/07/2026 (suite) — Lot 2 : contrats, tâches/Gantt, correction et comparateur de versions

**Fait :**
- Schéma Prisma : `contracts`, `royalty_terms` (termes contractuels — le moteur de calcul connecté aux ventes reste le Lot 5), `tasks`, `task_comments`.
- **Contrats** (Ch. 9) : numéro auto-généré (`CT-AAAA-NNNN`), circuit de validation à 5 étapes strictement séquentiel (preparation → legal_review → direction_approval → awaiting_signature → active), consultations journalisées (§9.11 : la sensibilité juridique impose de tracer même la lecture seule).
- **Règle de blocage Ch. 9 §9.12** : impossible de faire passer un manuscrit en production sans contrat d'édition actif, sauf dérogation motivée réservée à la Direction générale (tracée dans l'audit).
- **Tâches et Gantt simplifié** (Ch. 8 §8.4-8.7) : création, dépendances, replanification avec recalcul en cascade des tâches dépendantes et **détection automatique des conflits** (une tâche déjà engagée dont l'échéance amont bouge).
- **Correction éditoriale** (Ch. 10) : missions typées (orthographe, grammaire, style...), observations liées à une tâche avec points bloquants — un point bloquant non levé **empêche la validation de l'étape CORRECTION**.
- **Comparateur de versions** (Ch. 10 §10.5, risque technique identifié par le plan) : extraction de texte `.docx` + calcul des ajouts/suppressions, rapport structuré archivé au dossier. Limité aux `.docx` (repli prévu par le plan) ; export PDF non implémenté.
- **8 nouveaux tests automatisés** (19 au total, tous verts) : circuit contrat, blocage sans contrat actif, régression sur le saut de l'étape EXPERTISE (bug réel trouvé et corrigé), point bloquant, réplanification avec conflit, comparateur (ajouts/suppressions détectés, refus de comparer deux documents différents).
- **Frontend** : section Contrats (création, progression du circuit), section Tâches (Gantt en liste, création, avancement), section Correction (dépôt de version, comparateur avec surlignage des changements) — intégrées à la fiche manuscrit, conditionnées à l'étape courante. Flux vérifié dans un navigateur réel.
- **2 bugs réels trouvés et corrigés en testant dans un navigateur** (pas seulement via les tests automatisés) :
  1. Les étapes conditionnelles (Expertise, Réécriture) n'étaient jamais sautées même non requises — un manuscrit sans expertise nécessaire passait quand même par cette étape.
  2. CORS bloquait les requêtes `PATCH` (contrats, tâches) : la configuration par défaut de `@fastify/cors` ne les autorisait pas explicitement. Invisible dans les tests automatisés (qui n'utilisent pas de vrai CORS), révélé uniquement par le test en conditions réelles — illustre pourquoi la vérification navigateur reste nécessaire en plus des tests.

**Points d'interprétation à faire valider** (détail dans `docs/JOURNAL_TECHNIQUE.md`) : contrepartie de contrat limitée aux auteurs (pas de fiche prestataire/tiers), déclenchement de l'étape REECRITURE non spécifié, transfert vers la mise en page simplifié (validation manuelle plutôt qu'automatique à la version finale), Gantt en liste plutôt qu'en diagramme interactif, autorité de dérogation contractuelle.

**Limites connues de ce Lot 2 :**
- Pas de diagramme de Gantt graphique avec glisser-déposer (Ch. 8 §8.7) — liste avec dépendances et recalcul, fonctionnellement correcte mais visuellement plus simple.
- Comparateur limité aux `.docx` ; PDF maquetté non pris en charge (repli explicitement prévu par le plan).
- Pas de tableau de bord juridique consolidé (Ch. 9 §9.9) ni de tableau de bord des corrections (Ch. 10 §10.8) — hors périmètre minimal.
- Échéances de contrats et alertes automatiques (Ch. 9 §9.6) non implémentées.

**Prochaine étape :** faire valider ce Lot 2 par l'opérateur, puis démarrer le Lot 3 (maquette, infographie, ISBN/dépôt légal, BAT, impression) une fois validé.

### 04/07/2026 (suite) — Arbitrage opérateur sur les 3 points d'interprétation du Lot 2

M. Noah Mbala a tranché les trois points signalés à la fin du Lot 2 :

1. **Contrats : fiche Partenaire unique.** Décision de ne pas limiter les contrats aux auteurs. Mise en œuvre : table `authors` remplacée par une fiche `partners` unique avec catégorie (auteur, correcteur, traducteur, illustrateur, maquettiste, graphiste, imprimeur, consultant, autre prestataire). `work_contributors` et `contracts` référencent tous deux cette fiche unique — un contrat de prestation avec un imprimeur ou un correcteur fonctionne dès maintenant, sans refonte de structure prévue pour plus tard. Nouvel écran de création rapide de partenaire depuis le formulaire de contrat.
2. **Étape Réécriture : activée mais facultative.** Mise en œuvre : `manuscript.requires_rewrite`, posé par le responsable au moment de valider l'étape Correction (case à cocher « Cette version nécessite une réécriture »). Si coché, le manuscrit passe par l'étape Réécriture ; sinon elle est sautée comme avant, exactement comme pour l'étape Expertise.
3. **Diagramme de Gantt : liste pour la v1, confirmé.** Aucun changement de code — décision actée que le Gantt en liste (déjà livré) est la bonne première version, avec un diagramme graphique interactif prévu en v2 quand le besoin se précisera.

**Vérifié dans un navigateur réel** : création d'un partenaire « Imprimeur » depuis le formulaire de contrat (sélectionné automatiquement après création), et bascule vers l'étape Réécriture en cochant la case au moment de valider la Correction. 21 tests automatisés au total (2 nouveaux pour ces changements), tous verts.

**Prochaine étape :** démarrer le Lot 3 (maquette, infographie, ISBN/dépôt légal, BAT, impression).
