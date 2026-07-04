# Eclospace — Synthèse exécutive
## La plateforme de gestion éditoriale d'Éclosion Édition · Juillet 2026

---

## 1. Le projet en une page

Éclosion Édition gère aujourd'hui ses manuscrits, ses auteurs, sa production et ses ventes avec des outils dispersés. À mesure que le volume croît, cette organisation coûte : perte de visibilité sur les projets, retards découverts trop tard, droits d'auteur calculés à la main, stock incertain, décisions prises sans chiffres fiables.

Le projet dote la maison d'**Eclospace**, son ERP éditorial : un système unique qui suit chaque manuscrit du dépôt à l'archivage — lecture, contrat, correction, maquette, couverture, BAT, impression, stock, vente, droits d'auteur — et donne à la direction une vision en temps réel de toute l'activité.

**Trois horizons :**
1. **Court terme** — remplacer les fichiers dispersés par un outil unique de pilotage.
2. **Moyen terme** — absorber la croissance (1 000, 10 000 manuscrits et plus) sans gonfler les effectifs administratifs.
3. **Long terme** — faire d'Eclospace une **solution commercialisable auprès d'autres maisons d'édition africaines**, sur un marché où l'offre dédiée est quasi inexistante.

---

## 2. Ce que le système fera

**La chaîne du livre, sous contrôle.** Chaque manuscrit suit un parcours en 20 étapes où rien n'avance sans validation du responsable habilité, où tout est horodaté et signé, et où chaque retard déclenche une alerte — personne ne découvre plus un problème par hasard.

**Chaque département a son module et son tableau de bord** : secrétariat éditorial, comité de lecture, direction éditoriale, juridique, correction, maquette, infographie, contrôle qualité, impression, stock, commercial, finance, RH, archivage. Chaque utilisateur ne voit que son périmètre ; la direction voit tout.

**Une donnée saisie une seule fois.** Une vente enregistrée met à jour, en une seule opération : le stock, la facture, les droits de l'auteur, le chiffre d'affaires et les tableaux de bord. C'est ce qui rend les chiffres dignes de confiance.

**Six innovations distinguent Eclospace des logiciels existants :**

| Innovation | Ce qu'elle apporte |
|---|---|
| Centre de pilotage intelligent | Le système analyse et recommande en langage clair : « 3 manuscrits bloqués en correction depuis 10 jours », « le titre X sera en rupture dans 8 jours » |
| Indice de priorité éditoriale | Classement automatique des projets à traiter en premier |
| Notation pondérée des manuscrits | Score objectif d'aide à la décision du comité de lecture |
| Gantt interactif multi-projets | Pilotage visuel de centaines de projets en parallèle, retards et dépendances visibles |
| Moteur de droits d'auteur connecté aux ventes | Relevés d'auteurs générés en un clic, avances amorties automatiquement, auditable ligne à ligne |
| Comparateur de versions | Les changements entre deux versions d'un manuscrit, visibles en un regard |

**Conçu pour son contexte** : application web utilisable sur smartphone (scan du stock par la caméra, vente en salon), paiement mobile intégré, tolérance aux coupures de connexion et d'électricité, paramétrage par pays (dépôt légal, taxes) — des exigences que les ERP occidentaux ignorent.

---

## 3. Ce qui est déjà fait

Le travail de conception est **achevé et documenté** — c'est la partie qui conditionne la réussite :

| Livrable | Contenu |
|---|---|
| **Cahier des charges fonctionnel** (Word, 69 p.) | 22 chapitres : vision, rôles, 17 départements, workflow en 20 étapes, chaque module spécifié écran par écran, exigences techniques |
| **Annexe des décisions** | 30 points à arbitrer par la direction, dont 3 structurants |
| **Modèle de données** | ~75 tables, relations, 7 contraintes d'intégrité non négociables (ISBN jamais réutilisé, factures immuables, journal d'audit inviolable…) |
| **Spécification des API** | Toutes les fonctions du système, avec leurs règles métier |
| **Prototype interactif** (11 écrans) | Connexion, tableau de bord direction, fiche manuscrit et sa frise, Gantt, comité de lecture, stock avec scan mobile, commande, droits d'auteur, BAT, impression, poste correcteur — navigable, aux couleurs du logo |
| **Guide de style UI** | La référence visuelle et ergonomique pour les développeurs |
| **Plan de développement** | 7 lots, 12 scénarios de recette, reprise des données, formation, risques et parades |

Un développeur ou une équipe peut commencer à construire **sans réinterpréter le besoin** : tout est spécifié, jusqu'aux messages d'erreur.

---

## 4. Comment le système sera construit

**Sept lots, livrés dans l'ordre de la vie du livre**, chacun mis en service réellement dès sa recette — la maison utilise l'outil très tôt, pas de tunnel de 18 mois :

Lot 0 Fondations (sécurité, rôles, audit) → Lot 1 Entrée des manuscrits et comité → Lot 2 Contrats et correction → Lot 3 Fabrication (maquette, BAT, impression) → Lot 4 Stock et ventes → Lot 5 Finance et droits d'auteur → Lot 6 Pilotage et rapports.

**Ordre de grandeur** : 12 à 18 mois avec une équipe de 2-3 développeurs. **Option de réalisation recommandée** : prestataire pour les premiers lots avec clause de réversibilité complète (le code et les données appartiennent à Éclosion Édition), puis internalisation progressive — cohérente avec l'ambition de commercialisation.

**Garde-fous** : tests automatisés sur tout ce qui porte l'argent et le droit (droits d'auteur, stock, facturation, permissions) ; recette métier par les utilisateurs à chaque lot ; reprise des données existantes rapprochée et signée ; formation par vagues avec bascule ferme après un mois.

---

## 5. Ce que la direction doit décider maintenant

Le lancement dépend de **trois arbitrages** (détail dans l'Annexe A du cahier des charges) :

1. **L'organisation en 17 départements** — valider le regroupement proposé (structure de toute l'application).
2. **La comptabilité** — intégrée à l'ERP ou exports vers un logiciel/cabinet externe (l'hypothèse de travail actuelle).
3. **L'hébergement** — cloud, serveur local ou hybride (coûts, disponibilité, souveraineté des données).

Puis 27 décisions secondaires, à traiter en une ou deux séances d'arbitrage avec les responsables concernés.

**Et une décision de moyens** : désigner le **chef de projet métier interne** (mi-temps sanctuarisé) et choisir le mode de réalisation (prestataire, recrutement ou mixte).

---

## 6. Ce que la maison y gagne

- **La direction sait, à tout instant**, où est chaque manuscrit, ce qui est en retard, ce que rapporte chaque titre et où va la trésorerie.
- **Les auteurs sont payés juste et vite** — chaque franc de droits est traçable jusqu'à la vente qui l'a généré. C'est un argument de fidélisation et de réputation.
- **Les équipes travaillent dans un seul outil**, avec des règles claires et des alertes qui préviennent au lieu de constater.
- **La croissance devient absorbable** : 10 fois plus de manuscrits ne signifie pas 10 fois plus d'administration.
- **Un actif se constitue** : la mémoire économique et éditoriale de la maison — et, à terme, un produit logiciel — Eclospace — qu'Éclosion Édition pourra proposer aux éditeurs du continent, fidèle à sa devise : *l'avenir du livre*.

---

*Dossier complet disponible : cahier des charges (Word), modèle de données, API, prototype interactif, guide de style, plan de développement.*
