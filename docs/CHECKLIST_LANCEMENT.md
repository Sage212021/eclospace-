# Eclospace — Check-list de lancement

Les étapes à faire **avant la mise en service réelle**, dans l'ordre. Chacune se vérifie
depuis un navigateur, sans compétence technique. À cocher au fur et à mesure.

Décisions actées : **pas de mode hors-ligne en v1** (D-008), **chiffrement conservé en l'état** (D-009).
Le socle technique de l'audit est fait (sécurité, intégration continue, interface allégée, sauvegardes documentées).

---

## Étape 1 — Sécuriser les accès (rapide, à faire en premier)

- [ ] **Régénérer les secrets qui ont été affichés à l'écran** (ils étaient visibles sur des captures) :
  - [ ] **Mot de passe SMTP** (envoi des e-mails) → le régénérer chez le fournisseur d'e-mail,
        puis mettre la nouvelle valeur **dans Scalingo → Environment** (jamais dans le code, jamais en message).
  - [ ] **Clé de stockage Backblaze (S3)** → créer une nouvelle clé d'application, remplacer les
        variables `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` dans Scalingo, supprimer l'ancienne clé.
  - [ ] Vérifier après coup : un e-mail part encore, une affiche se dépose et s'affiche encore.
- [ ] **Changer le mot de passe de l'administrateur par défaut** (`admin`) pour un mot de passe fort.
- [ ] **Activer la double authentification (2FA)** au moins pour les comptes sensibles :
      **Direction générale, RH, Finance**.

## Étape 2 — Test de restauration de sauvegarde (une fois, au calme, devant un ordinateur)

But : *prouver* qu'on sait récupérer. Détail dans `docs/EXPLOITATION_SAUVEGARDES.md`.

- [ ] Vérifier dans Scalingo que des sauvegardes récentes existent (déjà confirmé : « Periodic Backups : Included »).
- [ ] Télécharger la dernière sauvegarde, la restaurer **vers une base d'essai** (pas la production),
      et vérifier que les données sont là et cohérentes.
- [ ] Côté fichiers : régler le versionnage Backblaze, écraser un fichier test, restaurer sa version précédente.
- [ ] Noter la **date de l'exercice** et le **temps qu'il a fallu** (le « délai de reprise » réel).

## Étape 3 — Recette métier (le point le plus important)

But : de vraies personnes testent leurs vrais cas. C'est ce qui fait la différence.

- [ ] Désigner **un référent par pôle** (éditorial, production, commercial, stock, finance, RH, communication).
- [ ] **2 semaines de tests guidés** sur l'environnement de recette, à partir des scénarios de
      `docs/05_Plan_de_developpement.md` §4.2 (dépôt d'un manuscrit → contrat → correction → BAT →
      impression → stock → vente → droits ; clôture de période ; etc.).
- [ ] Consigner les anomalies **bloquantes** et **majeures** ; les corriger avant la mise en service.
- [ ] Chaque référent devient **formateur relais** pour son pôle.

## Étape 4 — Finaliser les données et les comptes

- [ ] **Comptes du personnel** : créer/ajuster les comptes réels, un **rôle par métier** (éviter les cumuls
      non voulus), retirer les comptes de test.
- [ ] Vérifier les **droits par pôle** (chaque personne ne voit que son périmètre).
- [ ] **Barèmes de paie** (si l'internalisation est activée, D-007) : faire **valider les taux** en vigueur
      par la personne responsable de la paie avant tout bulletin réel.
- [ ] **Exports comptables** : rappeler au comptable que le plan de comptes fourni est **indicatif, non certifié**
      (voir `docs/JOURNAL_TECHNIQUE.md`) — à valider avant tout dépôt réel.
- [ ] Vérifier le **planning des événements** (dates, affiches) et le contenu d'accueil.

## Étape 5 — Bascule en production

- [ ] Choisir le moment (heures creuses), prévenir les utilisateurs.
- [ ] Confirmer que l'environnement de production a **toutes ses variables** (base, e-mail, stockage, secrets).
- [ ] Vérifier une dernière fois depuis un téléphone **et** un ordinateur : connexion, tableau de bord,
      une action de chaque pôle.
- [ ] Communiquer le lien et la marche à suivre aux équipes ; garder ce document à jour.

---

> Rappel : ce qui protège le mieux le lancement, ce sont les **étapes 2 et 3** (savoir restaurer, et faire
> tester par les équipes). Le reste est de la préparation ; celles-là sont les vrais filets de sécurité.
