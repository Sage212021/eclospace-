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
5. **Interface en français**, conforme au guide de style et à l'identité visuelle Éclospace — relook **« Noir souverain » or/noir/blanc** (charte officielle Éclosion, validé le 28/08/2026, D-022, remplaçant le bleu marine du 09/07/2026) : **or #D9B21A** = marque, actions principales, éléments actifs, positif ; **noir #0B0B0C / #000000** = texte, structure, barre latérale ; **blanc #FFFFFF** (fond) + **ivoire #FAF8F2** (zones) = clarté. **Aucun bleu, aucun dégradé multicolore ; l'or est la seule couleur d'accent** et ne sert jamais de texte courant. Statuts sémantiques uniquement (jamais comme accent de marque) : ambre #B87400 = retard, rouge #B23A2E = critique/erreur, vert sobre #2F7D4A = validé/export. Le **logo Eclospace n'est jamais recoloré**. Chiffres en police à chasse fixe. Erreurs explicites (« Encours dépassé : 4,9 M pour un plafond de 4,0 M »), jamais « une erreur est survenue ».
6. **Simplicité technique** : stack éprouvée et économe (l'application doit fonctionner avec une connexion modeste). Pas de dépendance exotique. Documenter chaque choix dans `docs/JOURNAL_TECHNIQUE.md`.
7. **À chaque session** : commencer par résumer l'état du lot en cours et ce qui reste à faire ; terminer par un commit clair et la mise à jour de `AVANCEMENT.md`.
8. **Note de version obligatoire à CHAQUE nouveauté visible (règle permanente, ne jamais oublier).** Toute fonctionnalité ou correction perceptible par l'utilisateur DOIT être accompagnée d'une **note de version** ajoutée à la liste `releaseNotes` de `backend/prisma/seed.ts` (slug unique, titre « Nouveauté — … », texte explicatif simple façon message WhatsApp, et **audience ciblée** : `permissionModules` + `departmentCodes` du/des pôle(s) concerné(s) ; la Direction générale reçoit toujours tout). La diffusion est **automatique** : au déploiement/seed, `dispatchReleaseNotes()` envoie chaque nouvelle note aux utilisateurs concernés dans la **messagerie interne** + notification (une seule fois par `slug`). Ne jamais livrer une nouveauté sans sa note « Nouveauté ».
9. **Aucune mention « IA » dans les documents LIVRÉS (règle permanente).** Tout document produit et livré par le système (rapports de correction/évaluation, manuscrits corrigés, versions réécrites, couvertures, PDF/.docx téléchargés ou imprimés) NE DOIT JAMAIS indiquer, dans son contenu, son titre, son en-tête, son pied de page ou ses métadonnées visibles, qu'il a été généré ou assisté par une intelligence artificielle. Les documents sont produits « au nom du Service de relecture / des Éditions Éclosion ». Les prompts IA imposent déjà cette règle (`REGLE_DOR` : « Tu ne mentionnes JAMAIS que tu es une intelligence artificielle ») ; toute nouvelle sortie livrée doit la respecter (pas de « (IA) » dans un titre de fichier, pas de filigrane « généré par IA », etc.). Les libellés « IA » restent autorisés UNIQUEMENT sur les écrans internes de l'application (boutons, badges « à valider »), jamais dans le livrable lui-même.

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
