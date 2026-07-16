# 08 — Guide du développeur

> **But de ce document** : permettre à un développeur qui découvre Eclospace de
> **lancer le projet, comprendre son organisation et y contribuer sans deviner**.
> Il complète le `README.md` (qui donne le démarrage rapide) par la carte du
> code et les conventions à respecter. À lire **après** `README.md` et
> `docs/07_Synthese_executive.md`, et à garder ouvert pendant les premiers jours.

---

## 1. Vue d'ensemble en 30 secondes

Eclospace est l'ERP éditorial d'Éclosion Édition : il suit chaque manuscrit du
dépôt à l'archivage (lecture → contrat → correction → fabrication → stock →
ventes → droits d'auteur), plus les fonctions transverses (RH, finance,
pilotage, communication interne).

- **Un seul dépôt** (monorepo) avec deux applications : `backend/` et `frontend/`.
- **Backend** : Node.js + TypeScript + **Fastify**, ORM **Prisma**, base
  **PostgreSQL**. API REST sous `/api/v1/`.
- **Frontend** : React + TypeScript + **Vite**. Pas de routeur ni de
  bibliothèque UI lourde (navigation par état, CSS aux jetons du guide de style).
- **En production**, le frontend est compilé et servi **par le même serveur**
  Fastify (même origine) — voir `docs/JOURNAL_TECHNIQUE.md`.

Le choix directeur (règle n°6 du `CLAUDE.md`) est la **simplicité** : stack
éprouvée, économe, sans dépendance exotique, capable de tourner avec une
connexion modeste.

---

## 2. Démarrer en local

Le pas-à-pas complet est dans le `README.md`. En résumé :

```bash
# Base de données locale (optionnel si vous avez déjà PostgreSQL)
docker compose up -d

# Backend — http://localhost:3000
cd backend
cp .env.example .env        # puis renseigner au minimum DATABASE_URL et SESSION_SECRET
npm install
npm run prisma:migrate      # applique les migrations (crée les tables)
npm run seed                # départements, rôles, permissions, compte « admin »
npm run dev

# Frontend — http://localhost:5173 (autre terminal)
cd frontend
cp .env.example .env
npm install
npm run dev
```

Le compte initial (`admin`) et son mot de passe de départ sont expliqués dans
`backend/.env.example` (`ADMIN_INITIAL_PASSWORD`). À changer dès la première
connexion : un mot de passe déjà modifié n'est **jamais** réinitialisé par un
redéploiement.

Les variables d'environnement sont **toutes documentées en commentaire** dans
`backend/.env.example` (SMTP, stockage S3, mot de passe maître de secours, etc.).
C'est la référence : ne pas dupliquer ces explications ailleurs.

---

## 3. Où trouver quoi (carte du code)

```
backend/
  prisma/
    schema.prisma          → LE modèle de données (≈75 tables, snake_case, UUID)
    migrations/            → migrations SQL versionnées (une par dossier horodaté)
    seed.ts                → données de référence (départements, rôles, permissions…)
  src/
    server.ts              → démarrage (écoute le port) — n'importe QUE app.ts
    app.ts                 → assemblage : enregistre tous les routes/*
    routes/                → points d'entrée HTTP, un fichier par domaine
    lib/                   → règles métier + utilitaires partagés (le cœur)
  tests/                   → tests automatisés Vitest (voir §7)

frontend/
  src/
    pages/                 → un écran par domaine (Dashboard, FinancePage, …)
    components/            → briques réutilisables (Modal, Button, TopBar, Sidebar…)
    api/client.ts          → toutes les fonctions d'appel à l'API (un seul endroit)
    i18n.tsx               → internationalisation FR/EN (voir §6)
    App.tsx                → navigation par pôles + rendu des pages

docs/                      → toute la conception (voir la table du CLAUDE.md)
```

**Règle simple pour s'orienter** : une **route** (`routes/x.ts`) reçoit une
requête HTTP, vérifie les permissions, valide les entrées, appelle la **logique
métier** (`lib/`), et renvoie une réponse. La logique réutilisable ne vit
**jamais** dans une route — elle vit dans `lib/`.

---

## 4. Les couches et leurs frontières (architecture)

Le code est organisé en **trois couches**, de la plus basse à la plus haute :

| Couche | Rôle | Peut importer… |
|---|---|---|
| `lib/` | Règles métier, utilitaires partagés | d'autres `lib/`, Prisma, paquets externes |
| `routes/` | Points d'entrée HTTP, orchestration | `lib/`, paquets externes |
| `app.ts` / `server.ts` | Assemblage et démarrage | tout — mais **personne ne les importe** |

Trois invariants sont **vérifiés automatiquement** par
`backend/tests/architecture.test.ts` (la CI échoue en cas de violation) :

1. **`lib/` ne dépend jamais d'une route** (pas de dépendance « montante »).
2. **Une route n'importe jamais une autre route** — si deux routes ont besoin
   de la même logique, elle doit être extraite dans `lib/`.
3. **Personne n'importe `app.ts` / `server.ts`** — l'assemblage se fait à un
   seul endroit.

> Ces règles imposent le **sens** des dépendances (ce qui empêche le code de
> pourrir avec le temps), mais **ne cloisonnent pas les domaines entre eux** :
> un `lib/` peut légitimement en appeler un autre (ex. `commercial` s'appuie sur
> `lib/finance` pour calculer l'encours client). Détail dans
> `docs/JOURNAL_TECHNIQUE.md`.

---

## 5. Conventions non négociables

Ces règles viennent des **7 contraintes d'intégrité** du modèle de données
(`docs/02_Modele_de_donnees.md` §13). Elles ne sont pas optionnelles.

- **Suppression logique uniquement** : on ne fait jamais de `DELETE`. Chaque
  table porte `deleted_at` / `deleted_by` ; on filtre `deletedAt: null` en
  lecture.
- **Journal d'audit append-only** : toute action sensible est tracée par
  `writeAuditLog(...)` (`lib/audit.ts`). La table `audit_log` est **inviolable
  au niveau de la base** (trigger PostgreSQL interdisant UPDATE/DELETE, même en
  superutilisateur). L'enum d'actions est fixe : on **mappe** sur les valeurs
  existantes (`status_change`, `view_sensitive`, `validate`, `create`,
  `update`) plutôt que d'en inventer.
- **Documents versionnés et figés** : le contenu d'une version de document est
  immuable après création (hash SHA-256 calculé serveur, trigger de protection).
- **Factures immuables et numérotées sans trou** : la numérotation passe par des
  compteurs dédiés (`lib/invoiceNumber.ts`, et pareil pour devis, contrats, bons
  de commande, commandes). Ne jamais numéroter « à la main ».
- **ISBN jamais réutilisé.**
- **Transactions atomiques** pour tout ce qui touche vente ↔ stock ↔ droits :
  `prisma.$transaction(async (tx) => { … })`.
- **Champs d'audit systématiques** : `created_by` / `updated_by` renseignés avec
  l'utilisateur courant.

**Erreurs explicites** (règle n°5 du `CLAUDE.md`) : jamais « une erreur est
survenue ». On renvoie un message précis et chiffré, ex.
« Encours dépassé : 4,9 M pour un plafond de 4,0 M ».

### Permissions

Chaque route sensible est protégée par
`requirePermission(module, action)` (`lib/permissions.js`), où `action` vaut
`consultation`, `saisie`, `validation` ou `administration`. Le modèle
d'habilitation est **Pôle → Profil (rôle) → Niveau d'action**, vérifié **côté
serveur** à chaque requête (jamais seulement côté écran). Les permissions
effectives d'un utilisateur sont exposées par `GET /api/v1/me`.

---

## 6. Internationalisation (FR/EN)

L'interface est **bilingue**, le **français est la langue par défaut**. On
utilise une fonction légère `t(clé, texteFr)` (`frontend/src/i18n.tsx`) :

```tsx
const { t, lang } = useI18n();
t("nlt.title", "Bulletin d'actualités")   // FR = valeur par défaut inline
```

Le français est écrit **directement à l'appel** (valeur de repli) ; la
**traduction anglaise** se met dans le dictionnaire de `i18n.tsx`, à la clé
correspondante. Pour ajouter un écran bilingue : préfixer ses clés (`fin.*`,
`cal.*`, `nlt.*`…) et compléter le dictionnaire EN.

---

## 7. Tests automatisés

Les tests sont **obligatoires sur les règles critiques** (workflow, calcul des
droits, cohérence du stock, numérotation des factures, permissions). Un module
n'est pas terminé sans ses tests.

```bash
cd backend
npm test                                   # toute la suite
node --env-file=.env.test node_modules/.bin/vitest run tests/xxx.test.ts   # un fichier
```

- Les tests tournent sur une **base PostgreSQL séparée** (`backend/.env.test`).
  Le script `pretest` applique les migrations et le seed avant de lancer la suite.
- Helpers communs : `backend/tests/helpers.ts` (`createUserWithRole`,
  `extractSessionCookie`, …). Les requêtes HTTP se font via `app.inject(...)`
  (pas besoin de démarrer un vrai serveur).
- **Bon à savoir** : la base de test est partagée entre exécutions et grossit ;
  sous forte charge, un test peut expirer par lenteur (timeout) alors qu'il
  passe seul. En cas de doute, relancer le fichier **en isolation** avant de
  conclure à une régression.

---

## 8. Faire évoluer le modèle de données (migrations Prisma)

Le schéma est dans `backend/prisma/schema.prisma`. Après l'avoir modifié :

**En développement (shell interactif)** — voie normale :

```bash
cd backend
npm run prisma:migrate     # = prisma migrate dev : crée et applique la migration
npm run prisma:generate    # régénère le client Prisma typé
```

**En environnement non interactif** (CI, agent) — les commandes interactives ne
sont pas disponibles ; on génère le SQL puis on écrit la migration à la main :

```bash
set -a; . ./.env.test; set +a
npx prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel ./prisma/schema.prisma --script
# → coller le SQL dans prisma/migrations/<horodatage>_<nom>/migration.sql
npx prisma migrate deploy && npx prisma generate
```

**Conventions de schéma** (voir `docs/02_Modele_de_donnees.md`) : identifiants
`UUID`, colonnes en `snake_case` (via `@map`), champs d'audit systématiques,
suppression logique. Toute migration est **additive** autant que possible ; on ne
supprime jamais une table de données existante.

---

## 9. Recette : ajouter un nouveau module de bout en bout

Cette check-list encode les conventions ci-dessus. Exemple : un module « Sondages ».

1. **Modèle** : ajouter la/les table(s) dans `schema.prisma` (UUID, snake_case,
   champs d'audit, `deleted_at`). Générer et appliquer la migration (§8).
2. **Permissions** : réutiliser un module de permission existant si le domaine
   s'y prête (ex. `communication`), sinon en créer un dans le seed.
3. **Logique métier** : mettre les règles réutilisables dans `lib/monModule.ts`
   (calculs, résolution d'audience, envois…). Rien de réutilisable dans la route.
4. **Route** : créer `routes/monModule.ts` — `requirePermission(...)`, validation
   des entrées avec **Zod**, appels à `lib/`, `writeAuditLog(...)` sur les actions
   sensibles, transactions atomiques si vente/stock/droits.
5. **Enregistrement** : `await app.register(monModuleRoutes)` dans `src/app.ts`.
6. **Client** : ajouter les fonctions d'appel dans `frontend/src/api/client.ts`
   (un seul endroit pour l'API).
7. **Écran** : créer `frontend/src/pages/MonModulePage.tsx`, le câbler dans
   `App.tsx` (pôle + entrée de menu gated par permission).
8. **i18n** : préfixer les clés et compléter le dictionnaire EN (§6).
9. **Tests** : couvrir les règles critiques et les permissions (§7).
10. **Docs** : consigner les choix dans `docs/JOURNAL_TECHNIQUE.md` et mettre à
    jour `AVANCEMENT.md`.

Le test d'architecture (§4) veille automatiquement à ce que les frontières
restent saines pendant tout ça.

---

## 10. Déploiement (Cloud)

L'hébergement cible est **Scalingo** (décision D-004). Points clés :

- `Procfile` : `web` démarre `backend/dist/server.js` ; `postdeploy` applique les
  migrations et le seed. Le backend sert aussi le frontend compilé.
- **Disque éphémère** : ne jamais stocker de fichiers sur le disque du conteneur
  en production. Les documents (GED) vont sur **stockage objet S3** dès que les
  variables `S3_*` sont renseignées (sinon repli disque local en dev/test).
- **SMTP** : les identifiants (`SMTP_USER` / `SMTP_PASS`) se saisissent
  **directement sur l'hébergeur**, jamais dans le dépôt. Sans SMTP configuré :
  e-mail journalisé en dev, échec explicite (`mail_not_configured`) en production.
- Toutes les variables sont décrites dans `backend/.env.example`.

---

## 11. Pour aller plus loin

| Besoin | Document |
|---|---|
| Comprendre le métier | `docs/01_Cahier_des_charges.md` (fait foi) |
| Le modèle de données | `docs/02_Modele_de_donnees.md` |
| Les routes de l'API | `docs/03_Specification_API.md` |
| Couleurs, typographie, composants | `docs/04_Guide_de_style_UI.md` |
| L'ordre des lots et la recette | `docs/05_Plan_de_developpement.md` |
| Les décisions actées | `docs/06_Registre_des_decisions.md` |
| **Le pourquoi de chaque choix technique** | `docs/JOURNAL_TECHNIQUE.md` |
| L'état d'avancement | `AVANCEMENT.md` |
| Les règles pour un contributeur (dont IA) | `CLAUDE.md` |
