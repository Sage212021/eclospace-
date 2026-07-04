# Eclospace — Instructions pour Claude Code

## Ce projet

Eclospace est l'ERP éditorial de la maison d'édition Éclosion Édition : un système web qui suit chaque manuscrit du dépôt à l'archivage (lecture, contrat, correction, maquette, BAT, impression, stock, ventes, droits d'auteur), avec un tableau de bord de direction en temps réel.

**Le projet est entièrement spécifié.** Avant d'écrire la moindre ligne de code, lis les documents du dossier `docs/` :

| Document | Rôle |
|---|---|
| `docs/01_Cahier_des_charges.md` | LA référence fonctionnelle — 22 chapitres + annexe des décisions. Fait foi. |
| `docs/02_Modele_de_donnees.md` | ~75 tables, relations, 7 contraintes d'intégrité non négociables |
| `docs/03_Specification_API.md` | Toutes les routes, leurs règles métier, idempotence, erreurs 409 |
| `docs/04_Guide_de_style_UI.md` | Couleurs, typographie, composants — à respecter strictement |
| `docs/05_Plan_de_developpement.md` | Les 7 lots, leur ordre, les scénarios de recette |
| `docs/06_Registre_des_decisions.md` | Décisions actées (17 départements ; comptabilité en exports externes) |
| `prototype/Phase3_Prototype_UI.html` | Prototype navigable : le rendu visuel de référence |

## Règles impératives

1. **Suivre l'ordre des lots** (Plan de développement §2) : Lot 0 (fondations) → 1 → 2 → 3 → 4 → 5 → 6. Ne jamais commencer un module d'un lot ultérieur.
2. **Le cahier des charges fait foi.** En cas d'ambiguïté, poser la question à l'opérateur plutôt que d'inventer. Toute dérogation doit être signalée explicitement.
3. **Contraintes d'intégrité** (Modèle de données §13) : suppression logique uniquement, audit_log append-only, factures immuables, ISBN jamais réutilisé, versionnage de tous les documents, transactions atomiques pour vente/stock/droits.
4. **Tests automatisés obligatoires** sur les règles critiques (Plan §4.1) : workflow, calcul des droits d'auteur, cohérence du stock, numérotation des factures, permissions. Aucun module n'est terminé sans ses tests.
5. **Interface en français**, conforme au guide de style : or #B18414 = marque/positif, orange #C4661F = retard, rouge #C24B3A = critique. Chiffres en police à chasse fixe. Erreurs explicites (« Encours dépassé : 4,9 M pour un plafond de 4,0 M »), jamais « une erreur est survenue ».
6. **Simplicité technique** : stack éprouvée et économe (l'application doit fonctionner avec une connexion modeste). Pas de dépendance exotique. Documenter chaque choix dans `docs/JOURNAL_TECHNIQUE.md`.
7. **À chaque session** : commencer par résumer l'état du lot en cours et ce qui reste à faire ; terminer par un commit clair et la mise à jour de `AVANCEMENT.md`.

## Stack technique retenue

- Backend : Node.js + TypeScript + Fastify, ORM Prisma
- Base de données : PostgreSQL, suit le modèle de `docs/02_Modele_de_donnees.md` (UUID, champs d'audit systématiques, snake_case)
- Frontend : React + TypeScript + Vite, CSS aux jetons du guide de style (pas de bibliothèque UI lourde)
- API REST /api/v1/ conforme à `docs/03_Specification_API.md`
- Hébergement : **Cloud** (décision D-004, `docs/06_Registre_des_decisions.md`) — fournisseur et région à préciser avant la mise en production
- Détail et justification de chaque choix : `docs/JOURNAL_TECHNIQUE.md`

## État d'avancement

Voir `AVANCEMENT.md` (mis à jour à chaque session).
Lot en cours : **Lot 0 — Fondations** (démarré le 04/07/2026).

## L'opérateur

M. Noah Mbala Yves B., chef de projet métier — non-développeur. Explique tes choix simplement, propose des vérifications concrètes qu'il peut faire depuis un navigateur, et demande validation avant toute décision structurante.
