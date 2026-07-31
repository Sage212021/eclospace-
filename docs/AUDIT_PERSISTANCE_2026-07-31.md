# Audit de persistance des données — 31/07/2026

**Contexte.** Signalement d'une anomalie critique : des informations saisies (module RH
notamment) sembleraient enregistrées mais disparaîtraient après actualisation, changement
de page ou reconnexion. Demande d'un audit complet de tous les modules et d'un rapport.

Ce document rend compte de l'audit mené, des constats, de la cause probable et des actions.

---

## 1. Méthode d'audit

- **Revue du code d'enregistrement** de bout en bout : formulaires (création / modification),
  couche d'appel API (frontend), routes serveur, écritures en base (Prisma), transactions.
- **Recherche systématique de l'anti-motif** « le formulaire semble réussir mais rien n'est
  écrit » : appels API manquants, erreurs avalées en silence, mises à jour d'état optimistes,
  points de code non implémentés (stub/mock), écritures hors transaction.
- **Contrôles techniques** : cohérence migrations ↔ schéma (drift), contraintes d'intégrité,
  droits d'accès, mécanisme d'échec de connexion, seed de déploiement.
- **Preuve par les tests** : exécution des suites d'écriture (RH, rapports, paramètres…).

## 2. Constats

### 2.1 La couche applicative enregistre correctement

- **Client API** (`frontend/src/api/client.ts`) : le helper `request()` **lève une erreur sur
  toute réponse non 2xx**. Un échec serveur **ne peut donc pas** être pris pour un succès.
- **Gestionnaires de sauvegarde** (RH, rapports, etc.) : ils **attendent** la réponse de l'API
  (`await`), affichent un **message de confirmation** en cas de succès et une **erreur** en cas
  d'échec. Exemple RH « Créer le dossier RH » : `createEmployee(...)` puis message
  « Dossier RH créé… » ; en cas d'échec, message d'erreur et la fenêtre reste ouverte.
- **Serveur** : les créations passent par des **transactions** (`prisma.$transaction`) — ex.
  `POST /api/v1/employees` crée la fiche employé (et, le cas échéant, le compte et le rôle) de
  façon atomique. Les rapports hebdomadaires sont écrits par `PATCH /api/v1/weekly-reports/:id`
  et **relus** au rechargement via `GET /api/v1/weekly-reports` (filtré sur l'auteur) — un
  rapport enregistré **réapparaît** donc après actualisation.
- **Aucun anti-motif trouvé** : pas d'appel API manquant, pas d'erreur d'écriture avalée
  (`.catch(() => {})` sur une écriture), aucun stub/mock/TODO dans les chemins d'enregistrement.

### 2.2 Cohérence base de données

- **Aucun drift significatif** entre les fichiers de migration et le schéma (contrôle
  `prisma migrate diff`) : la base construite en production par `prisma migrate deploy` produit
  bien toutes les tables/colonnes attendues. (Seules deux tables de compteurs, gérées
  volontairement en SQL brut, apparaissent hors modèle Prisma — sans effet sur les données.)
- **Le déploiement ne réinitialise pas la base** : `postdeploy` exécute `migrate deploy`
  (non destructif) puis un **seed idempotent** (upserts). Aucune commande de reset.

### 2.3 Preuve par les tests

Suites d'écriture exécutées et **au vert** : `hr-onboarding`, `weekly-reports`,
`lot6-hr-pilotage`, `access-audit`, `settings` (37 tests), en plus de la suite complète
(**458 tests**) passée en amont. Un test dédié vérifie désormais qu'un **compteur réel
d'enregistrements augmente après une création** (persistance prouvée de bout en bout).

> Remarque : lors de l'audit, l'exécution locale des tests a d'abord échoué **à la connexion**
> (compte `admin` absent de la base de test locale, effacé par un nettoyage de test). Après
> restauration (re-seed), tout est repassé au vert. Ce point était un **artefact
> d'environnement de test local**, sans rapport avec la persistance en production.

## 3. Cause probable en production

Le motif décrit — données **perdues au simple rafraîchissement** *et* après redéploiement, sur
**tous** les modules, alors que le code enregistre correctement — est la **signature typique
d'un problème au niveau de la base de données / de l'hébergement**, et non du code applicatif :

1. **Base non durable ou non partagée.** Si l'application tourne en **plusieurs instances** sans
   base **partagée** (ou pointe vers une base éphémère), une écriture atterrit sur une instance
   et un rafraîchissement lit une autre → la donnée « disparaît ». Un redéploiement efface tout.
2. **`DATABASE_URL` mal configurée** en production (ne pointant pas vers l'**add-on PostgreSQL
   persistant**).
3. **`migrate deploy` en échec au déploiement** (une migration bloquée) : les nouvelles
   tables/colonnes manquent et les écritures correspondantes échouent.

## 4. Actions mises en œuvre

- **Outil de diagnostic de persistance intégré à l'application** (page **Paramètres**) :
  - `GET /api/v1/system/diagnostic` renvoie l'état de la base (connectée, latence), le nombre de
    **migrations réellement appliquées**, et le **nombre réel d'enregistrements** par type
    (comptes, dossiers RH, rapports, factures, commandes, ouvrages), plus l'**identifiant
    d'instance** et la durée de fonctionnement.
  - Carte « **Diagnostic de persistance des données** » : l'opérateur enregistre une donnée puis
    clique « Rafraîchir » — **le compteur correspondant doit augmenter**. Si l'identifiant
    d'instance **change** d'un rafraîchissement à l'autre, c'est que **plusieurs serveurs
    répondent sans base partagée** (cause n°1 ci-dessus), immédiatement visible.
- **Test automatisé** confirmant que le compteur augmente après une création réelle.

## 5. Vérifications recommandées à l'hébergement (production)

1. **Add-on PostgreSQL persistant** provisionné et `DATABASE_URL` pointant **dessus**.
2. **Logs de déploiement** : confirmer que `prisma migrate deploy` se termine par
   « All migrations have been successfully applied » (aucune migration en échec).
3. **Instance unique** *ou* base **partagée** entre instances (via l'outil de diagnostic :
   l'identifiant d'instance doit rester **stable** entre deux rafraîchissements).
4. Après un enregistrement, **rafraîchir le diagnostic** : le compteur concerné doit augmenter et
   **rester** augmenté après reconnexion.

## 6. Conclusion

L'audit **n'a pas trouvé de perte de données imputable au code applicatif** : les chemins de
création / modification / enregistrement écrivent bien en base, de façon transactionnelle, et
les suites de tests le confirment. Le symptôme rapporté pointe vers la **couche base de données /
déploiement**. L'outil de diagnostic ajouté permet à l'opérateur de **le confirmer visuellement**
en quelques secondes et d'orienter la correction côté hébergement. Communiquer les **logs du
dernier déploiement** et la **configuration de la base** permettra de clôturer définitivement.
