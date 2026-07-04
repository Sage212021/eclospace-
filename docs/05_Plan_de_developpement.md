# ERP Éclosion Édition — Phases 4-5 : Plan de développement
## Organisation, lots, jalons et recette — Version 1.0

---

## 1. Objet et principes d'organisation

Ce document organise la construction de l'ERP à partir des livrables de conception (cahier des charges Ch. 0-21 + Annexe A, modèle de données, spécification API, prototype UI et guide de style). Il découpe le développement en **lots livrables et utilisables**, ordonnés selon trois principes :

1. **Le socle d'abord** : sécurité, rôles, GED, audit et workflow sont transverses — tout le reste s'appuie dessus. On ne les « rattrape » pas après coup.
2. **Suivre la vie du livre** : les modules sont construits dans l'ordre où un manuscrit les traverse. Chaque lot livré permet de gérer réellement une portion croissante de la chaîne — la maison utilise l'outil avant la fin du projet.
3. **Une valeur d'usage par lot** : chaque lot se termine par une recette métier sur des cas réels et une mise en service partielle. Pas d'effet tunnel de 18 mois.

**Prérequis avant le Lot 1** : arbitrage des trois points structurants de l'Annexe A — départements (n°4), option comptable (n°20), hébergement (n°26) — et fourniture du logo en PNG transparent/SVG.

---

## 2. Découpage en lots

### Lot 0 — Fondations techniques
**Contenu** : mise en place des environnements (développement / recette / production, Ch. 21 §21.12), base de données et migrations, squelette applicatif, authentification + 2FA, rôles et permissions (Ch. 2), journal d'audit append-only, GED avec versionnage et hash (§3.5-3.6 du modèle), notifications internes, coquille UI (barre latérale, recherche, guide de style).
**Livrable utilisable** : on se connecte, on a des comptes aux bons rôles, tout est journalisé.
**Poids relatif : ~15 % de l'effort total.**

### Lot 1 — Le manuscrit entre dans la maison
**Modules** : Secrétariat éditorial (Ch. 6), Comité de lecture avec notation pondérée (Ch. 7), décision éditoriale et moteur de workflow avec la frise (Ch. 4, 8 §8.2-8.3).
**Livrable utilisable** : dépôt, enregistrement, lecture, évaluation, décision — le flux d'entrée complet fonctionne. **Premier module mis en service réelle.**
**Poids : ~12 %.**

### Lot 2 — Contrats et production éditoriale
**Modules** : Juridique et contrats (Ch. 9, hors moteur de droits connecté aux ventes), planification, tâches et Gantt (Ch. 8), Correction et versions avec comparateur (Ch. 10).
**Livrable utilisable** : de la signature du contrat à la version corrigée validée.
**Poids : ~15 %. Le comparateur de versions est le risque technique de ce lot — prototype de faisabilité en début de lot (formats docx puis PDF).**

### Lot 3 — Fabrication
**Modules** : Maquette (Ch. 11), Infographie avec calcul du dos et droits iconographiques (Ch. 12), ISBN / dépôt légal / métadonnées (Ch. 13, export ONIX en fin de lot), BAT avec signature électronique et verrouillage (Ch. 14), Impression avec devis comparés et jalons (Ch. 15).
**Livrable utilisable** : la chaîne complète du manuscrit accepté jusqu'aux exemplaires reçus.
**Poids : ~18 %.**

### Lot 4 — Stock et commercial
**Modules** : Stock complet avec scan mobile, inventaires, dépôts-ventes (Ch. 16) ; Commercial : clients, remises, commandes avec contrôle d'encours, livraisons, retours, vente directe et mobile money (Ch. 17).
**Livrable utilisable** : les livres se vendent et le stock est exact. **C'est le lot où l'outil commence à générer des recettes traçables.**
**Poids : ~16 %.**

### Lot 5 — Finance et droits d'auteur
**Modules** : Facturation, encaissements, relances, balance âgée, analytique par ouvrage, budgets, trésorerie, exports comptables (Ch. 18) ; **moteur de droits d'auteur connecté aux ventes** et relevés (Ch. 9 §9.5) — placé ici car il dépend des ventes du Lot 4.
**Livrable utilisable** : marge par ouvrage, relevés d'auteurs en un clic, trésorerie prévisionnelle.
**Poids : ~14 %. Lot le plus sensible : double recette (métier + comptable externe), jeux d'essai chiffrés contrôlés au centime.**

### Lot 6 — RH, pilotage et intelligence
**Modules** : RH et cycle de vie des comptes (Ch. 19), tableau de bord Direction générale consolidé et centre de pilotage intelligent (Ch. 5), rapports, explorateur et dictionnaire d'indicateurs (Ch. 20).
**Livrable utilisable** : le pilotage complet promis au Chapitre 0. *Les tableaux de bord par module, eux, sont livrés au fil des lots 1-5 — ce lot construit la couche transverse.*
**Poids : ~10 %.**

**Ordre de dépendance strict** : 0 → 1 → 2 → 3 → 4 → 5, le Lot 6 pouvant démarrer en parallèle du 5. À l'intérieur d'un lot, les équipes peuvent paralléliser par module.

---

## 3. Rythme et jalons

Le plan est exprimé en **jalons de contenu**, pas en dates : la durée dépendra de l'équipe retenue (voir §6). À titre d'ordre de grandeur, avec une équipe de 2-3 développeurs expérimentés, chaque lot représente typiquement 6 à 10 semaines ; le projet complet se situe dans une fourchette de **12 à 18 mois** jusqu'au Lot 6 inclus.

**Jalons de fin de lot (identiques pour chaque lot) :**
1. **Démonstration** sur les scénarios de recette du lot (voir §4).
2. **Recette métier** par les utilisateurs référents du ou des départements concernés (2 semaines de tests guidés en environnement de recette).
3. **Corrections** des anomalies bloquantes et majeures.
4. **Mise en service partielle** : le module entre en usage réel, avec reprise des données existantes du périmètre (voir §5).
5. **Bilan de lot** : écarts au cahier des charges consignés, décisions d'ajustement tracées (toute dérogation au CdC est validée par la direction, conformément au Ch. 0 §0.8).

---

## 4. Stratégie de tests (Phase 6 du plan initial, intégrée en continu)

### 4.1 Tests automatisés (développeurs)
Obligatoires sur les règles métier critiques (Ch. 21 §21.12) — liste minimale :
- workflow : impossibilité de sauter une validation ; étapes conditionnelles ;
- calcul des droits : paliers, amortissement d'avance, retours négatifs, retenues ;
- stock : cohérence somme des mouvements = stock ; réservations ; idempotence ;
- facturation : numérotation continue, immuabilité, avoirs ;
- permissions : chaque route API testée avec un rôle non autorisé (doit refuser).

### 4.2 Scénarios de recette métier (utilisateurs référents)
Bibliothèque de **scénarios de bout en bout** rejoués à chaque lot concerné, avec des manuscrits fictifs :

| # | Scénario | Vérifie |
|---|---|---|
| S1 | Manuscrit refusé au comité | Flux court, motivation, archivage direct |
| S2 | Manuscrit accepté → publié → vendu | Le chemin nominal complet (s'allonge à chaque lot) |
| S3 | BAT à corriger deux fois | Retours tracés, comparateur, verrouillage final |
| S4 | Trois projets en parallèle avec le même correcteur | Charge, Gantt, alertes de retard |
| S5 | Vente ferme + dépôt-vente + retours sur le même titre | Stock, avoirs, droits recalculés |
| S6 | Réimpression déclenchée par seuil de stock | Sous-cycle Ch. 15 §15.8, mini-BAT |
| S7 | Client dépassant son encours | Blocage, validation, traçabilité |
| S8 | Relevé de droits semestriel d'un auteur à paliers | Chiffres contrôlés à la main au centime |
| S9 | Départ d'un employé | Désactivation du compte, historique conservé |
| S10 | Coupure de connexion pendant une saisie de mouvement | Idempotence, reprise sans doublon |
| S11 | Inventaire avec écart | Comptage aveugle, régularisation validée |
| S12 | Clôture de période comptable puis tentative d'écriture | Refus motivé |

Chaque scénario a une fiche : préconditions, pas à pas, résultat attendu, résultat constaté, verdict.

### 4.3 Tests de charge
Avant la mise en service du Lot 4 : base peuplée de 10 000 manuscrits fictifs, 500 000 mouvements, 200 000 lignes de vente — temps de réponse mesurés contre les cibles du Ch. 21 §21.10.

---

## 5. Reprise des données existantes

Chantier à part entière, souvent sous-estimé — piloté par le secrétariat éditorial et la finance :
1. **Inventaire de l'existant** (fichiers Excel, dossiers papier, contrats) dès le Lot 0.
2. **Gabarits d'import** fournis par lot : catalogue et manuscrits en cours (Lot 1), contrats actifs (Lot 2), fiches ISBN et métadonnées (Lot 3), stock initial par inventaire physique complet (Lot 4 — l'inventaire de démarrage **est** la référence), clients et encours ouverts, balances (Lot 5).
3. **Règle** : on ne reprend informatiquement que ce qui est actif ; l'historique ancien est archivé en l'état (documents numérisés rattachés aux fiches).
4. Chaque import est validé par un rapprochement chiffré signé par le responsable du domaine.

---

## 6. Organisation et rôles du projet

| Rôle | Qui | Responsabilité |
|---|---|---|
| **Maître d'ouvrage** | Direction générale d'Éclosion Édition | Arbitrages, priorités, validation des lots |
| **Chef de projet métier** | **M. Noah Mbala Yves B.** (désigné le 04/07/2026, mi-temps sanctuarisé) | Interlocuteur unique des développeurs, anime la recette, tient le registre des décisions à jour |
| **Utilisateurs référents** | 1 par département concerné par le lot | Recette, jeux d'essai, futurs formateurs relais |
| **Équipe de développement** | Prestataire ou équipe à recruter | Réalisation conforme au CdC, tests automatisés, documentation |
| **Administrateur système** | À former en interne pendant le projet | Exploitation, sauvegardes, comptes |

**Options de réalisation** (à arbitrer avec le point 26 de l'Annexe A) :
- **A. Prestataire local** : contrat au forfait par lot, avec clauses de réversibilité (code, documentation et données appartiennent à Éclosion Édition — Ch. 21 §21.13) et de maintenance.
- **B. Équipe interne** (1-2 développeurs recrutés) : montée en compétence, coût maîtrisé dans la durée, cohérent avec l'ambition de commercialisation (Ch. 0) — mais délai plus long et risque de dépendance aux personnes.
- **C. Mixte** : prestataire pour les Lots 0-3, recrutement en cours de route pour internaliser la maintenance et les évolutions. **Option recommandée** au regard de l'objectif long terme.

**Rituel** : point hebdomadaire chef de projet ↔ développeurs ; démonstration à la direction à chaque fin de lot ; registre unique des décisions et des écarts.

---

## 7. Formation et conduite du changement (Phase 7-8 du plan initial)

- **Formation par vagues, au rythme des lots** : chaque mise en service partielle est précédée de la formation du département concerné (2 × ½ journée : prise en main guidée sur l'environnement de recette, puis cas réels accompagnés la première semaine).
- **Référents relais** : les utilisateurs référents de la recette forment leurs collègues — l'aide contextuelle par écran (Ch. 21 §21.11) sert de support.
- **Période de double fonctionnement limitée à 1 mois** par domaine (ancien fichier + ERP), puis bascule ferme : le double système prolongé est la première cause d'échec d'adoption.
- **Mesure d'adoption** : taux de saisie dans l'outil vs hors outil, revu à chaque bilan de lot.

---

## 8. Risques principaux et parades

| Risque | Impact | Parade |
|---|---|---|
| Arbitrages Annexe A retardés | Blocage des Lots 0-1 | Séance d'arbitrage planifiée avant le lancement (points 4, 20, 26 en premier) |
| Effet tunnel / dérive de périmètre | Démotivation, budget | Lots courts livrés en usage réel ; toute demande hors CdC passe par le registre des décisions |
| Comparateur de versions plus dur que prévu | Retard Lot 2 | Prototype de faisabilité en début de lot ; repli : comparaison docx seule en v1 |
| Reprise de données de mauvaise qualité | Chiffres faux au démarrage | Rapprochements signés ; inventaire physique complet comme référence stock |
| Sous-disponibilité du chef de projet métier | Décisions en attente, recette bâclée | Mi-temps sanctuarisé, acté par la direction |
| Départ d'un développeur clé | Perte de connaissance | Documentation vivante (OpenAPI, Ch. 21 §21.12), revues croisées, clause de réversibilité |
| Connectivité/électricité en exploitation | Interruptions de service | Choix d'hébergement adapté (point 26) ; idempotence déjà spécifiée ; mode hors connexion en évolution |

---

## 9. Après le Lot 6 : évolutions (Phase 9)

Pistes déjà identifiées dans le cahier des charges, à prioriser après six mois d'usage réel :
- mode hors connexion pour le terrain (Ch. 21 §21.6) ;
- accès externe auteurs (Annexe A, point 2) ;
- capacités prédictives sur l'historique accumulé (Ch. 20 §20.6) ;
- multilingue et paramétrages multi-pays complets — préparation de la **version commercialisable** de l'ERP (Ch. 0 §0.2), qui fera l'objet de son propre cahier des charges d'industrialisation.

---

## 10. Synthèse

Sept lots, chacun clos par une recette métier et une mise en service réelle ; des tests automatisés sur les règles qui portent l'argent et le droit ; une reprise de données rapprochée et signée ; une formation par vagues avec bascule ferme. À la fin du Lot 6, Éclosion Édition exploite l'intégralité du système spécifié dans le cahier des charges — et dispose des fondations pour en faire, ensuite, un produit.
