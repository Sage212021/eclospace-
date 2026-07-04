# Cahier des charges fonctionnel — Éclosion Édition
## Chapitre 0 : Vision stratégique et philosophie d'Eclospace, l'ERP d'Éclosion Édition

### 0.1 Objet du chapitre

Ce chapitre, placé en tête du cahier des charges, expose la vision d'ensemble qui gouverne la conception de l'ERP Éclosion Édition. Il précède la présentation opérationnelle du projet (Chapitre 1) et sert de référence à tous les arbitrages ultérieurs : lorsqu'un choix de conception se présente, c'est à la lumière des principes énoncés ici qu'il doit être tranché.

### 0.2 Vision globale

La plateforme porte un nom : **Eclospace**. Ce n'est pas un simple logiciel de gestion, c'est un **ERP éditorial intelligent** conçu par et pour Éclosion Édition — la maison d'édition reste l'éditeur et le propriétaire du produit, Eclospace en est le nom commercial, conçu autour d'une conviction — la chaîne du livre, du manuscrit à l'archivage, forme un tout cohérent qui mérite un système d'information unifié, pensé pour le métier d'éditeur et non adapté depuis un outil généraliste.

La vision se décline en trois horizons :

1. **Court terme** — Doter Éclosion Édition d'un outil unique de pilotage de toute son activité, remplaçant les fichiers dispersés et les échanges informels.
2. **Moyen terme** — Faire de l'ERP un instrument de croissance : absorber l'augmentation du volume de manuscrits (1 000, 10 000 et au-delà) sans augmentation proportionnelle des effectifs administratifs, grâce à l'automatisation et à l'aide à la décision.
3. **Long terme** — Positionner l'ERP comme une **solution commercialisable auprès d'autres maisons d'édition, en particulier en Afrique**, où l'offre logicielle dédiée à l'édition est quasi inexistante. L'ambition est d'en faire une référence sur le continent.

### 0.3 Principes de fonctionnement fondamentaux

Cinq principes structurent l'ensemble du système. Ils sont déjà à l'œuvre dans les chapitres 1 à 10 et s'appliqueront à tous les modules à venir.

**1. Traçabilité totale.** Toute action est horodatée, signée et conservée. Rien n'est écrasé, rien n'est supprimé définitivement : versions de documents, historiques de statuts, journaux d'activité. Cette règle protège la maison juridiquement, facilite les audits et fonde la confiance dans le système.

**2. Validation avant progression.** Un manuscrit n'avance qu'après validation explicite du responsable habilité. Ce principe transforme le workflow en une chaîne de responsabilités claires, où chaque étape a un garant identifié.

**3. Cloisonnement et transparence maîtrisée.** Chaque utilisateur ne voit que son périmètre ; la direction voit tout. La confidentialité (manuscrits en lecture, contrats, finances) est une exigence de premier rang, pas une option.

**4. L'information vient à l'utilisateur.** Notifications, alertes priorisées, rappels d'échéances : le système signale ce qui requiert une action, plutôt que d'attendre que quelqu'un pense à vérifier. Personne ne doit découvrir un retard par hasard.

**5. Une donnée saisie une seule fois.** Chaque information (une vente, un contrat, une validation) est saisie à un seul endroit et se propage automatiquement partout où elle est utile : droits d'auteur, stocks, tableaux de bord, rapports. C'est la condition de la fiabilité des indicateurs.

### 0.4 Objectifs à long terme

- **Fiabilité décisionnelle** : que la direction puisse fonder chaque décision (publier, réimprimer, promouvoir, abandonner) sur des données exactes et à jour.
- **Capitalisation du savoir éditorial** : constituer, année après année, une mémoire de la maison — scores des manuscrits, performances commerciales, coûts réels — exploitable pour affiner la ligne éditoriale.
- **Indépendance technologique** : maîtriser un outil propre, adapté aux réalités locales (connectivité, coûts, pratiques du marché du livre africain), plutôt que dépendre de solutions étrangères coûteuses et inadaptées.
- **Rayonnement** : à terme, générer une nouvelle source de revenus par la commercialisation de l'ERP auprès d'autres éditeurs.

### 0.5 Architecture générale (principes directeurs)

Sans préjuger des choix techniques détaillés (qui feront l'objet du chapitre technologies), l'architecture obéit aux principes suivants :

- **Application web responsive**, accessible depuis tout navigateur, sur ordinateur comme sur mobile — essentiel dans des contextes où le smartphone est parfois le premier écran.
- **Architecture modulaire** : chaque département est un module autonome mais interconnecté ; on peut activer ou désactiver des modules selon la taille de la maison d'édition (condition de la commercialisation future auprès de structures plus petites).
- **Base de données unique et robuste**, garantissant l'unicité de la donnée (principe 5).
- **Montée en charge** : performances constantes de 100 à 10 000+ manuscrits.
- **Sécurité by design** : gestion fine des rôles, journalisation, sauvegardes automatiques, chiffrement des données sensibles.
- **Résilience adaptée au contexte** : tolérance aux coupures de connectivité et d'électricité (mécanismes à préciser au chapitre technologies : sauvegarde continue, reprise de session, éventuel mode dégradé).

### 0.6 Les innovations différenciantes

Cinq fonctionnalités, déjà spécifiées dans les chapitres 5 à 10, distinguent cet ERP des logiciels existants et constituent son avantage compétitif :

| Innovation | Chapitre | Apport |
|---|---|---|
| **Centre de pilotage intelligent** | 5 (§5.9) | Le système analyse et recommande en langage naturel, au lieu de seulement afficher des chiffres |
| **Indice de priorité éditoriale** | 6 (§6.5) | Classement automatique des projets à traiter, pour optimiser les ressources |
| **Notation pondérée des manuscrits** | 7 (§7.5) | Score objectif d'aide à la décision éditoriale, avec analyse des écarts entre lecteurs |
| **Diagramme de Gantt interactif multi-projets** | 8 (§8.7) | Pilotage visuel de centaines de projets en parallèle, avec dépendances et chemin critique |
| **Moteur de droits d'auteur connecté aux ventes** | 9 (§9.5) | Relevés de droits générés en un clic, avances amorties automatiquement |
| **Comparateur de versions** | 10 (§10.5) | Visualisation immédiate des changements entre deux versions d'un manuscrit |

Cette liste s'enrichira au fil des chapitres suivants (modules production, commercial, finance, intelligence décisionnelle).

### 0.7 Philosophie d'usage

L'ERP est au service des équipes, pas l'inverse. Trois engagements en découlent :

- **Simplicité d'abord** : chaque écran doit être utilisable sans formation longue ; la complexité est dans le système, pas dans l'interface.
- **L'humain décide** : les scores, indices et recommandations automatiques éclairent la décision, ils ne la remplacent jamais. La décision éditoriale, commerciale ou financière reste humaine, motivée et tracée.
- **Adoption progressive** : le déploiement module par module (cf. phases du projet, Chapitre 1) permet à chaque service de s'approprier l'outil à son rythme.

### 0.8 Portée de ce chapitre

Ce chapitre a valeur de **charte du projet**. Toute évolution future de l'ERP — nouveau module, nouvelle fonctionnalité, adaptation pour un autre éditeur — devra être évaluée à l'aune des principes et de la vision énoncés ici.


---


## Chapitre 1 : Présentation générale du projet

### 1.1 Contexte

Éclosion Édition est une maison d'édition qui gère aujourd'hui ses manuscrits, ses auteurs, sa production et ses ventes à travers des outils dispersés (fichiers, tableurs, échanges par email). Cette organisation devient un frein à mesure que le volume de manuscrits augmente : perte de visibilité sur l'avancement des projets, difficulté à coordonner les départements, absence de tableau de bord global, risque d'erreurs dans le suivi financier et documentaire.

### 1.2 Vision du projet

Doter Éclosion Édition d'un système d'information unique — un ERP éditorial — capable de piloter l'ensemble du cycle de vie d'un manuscrit, du dépôt initial jusqu'à l'archivage après commercialisation, en passant par la lecture, la correction, la fabrication, la diffusion et la gestion financière. Le système doit devenir la source unique de vérité pour tous les départements de la maison.

### 1.3 Objectifs du projet

- **Centraliser** l'information : un seul système pour tous les manuscrits, auteurs, contrats, stocks et finances.
- **Fluidifier** les processus entre départements grâce à des workflows formalisés et des transferts de responsabilité tracés.
- **Donner de la visibilité** à la direction sur l'état de chaque manuscrit et sur la santé globale de l'activité, en temps réel.
- **Sécuriser** les données sensibles (contrats, droits d'auteur, finances) via une gestion fine des rôles et des accès.
- **Réduire les délais** de traitement en identifiant rapidement les retards et les goulots d'étranglement.
- **Permettre la montée en charge** : le système doit rester performant avec 1 000, 10 000 manuscrits ou plus.
- **Faciliter la prise de décision** grâce à des rapports et statistiques fiables.

### 1.4 Périmètre du projet

**Inclus :**
- Tous les départements listés dans le cahier des charges (direction, éditorial, production, commercial, finance, RH, archivage, etc.).
- L'ensemble du cycle de vie du manuscrit, du dépôt à l'archivage.
- La gestion documentaire associée à chaque manuscrit et à chaque auteur.
- La gestion des utilisateurs, rôles et permissions.
- Les tableaux de bord par département et un tableau de bord global.

**Exclu (pour une phase ultérieure, à confirmer) :**
- Site web public de vente en ligne (e-commerce grand public).
- Application mobile dédiée (une version web responsive est prévue en priorité).
- Intégration comptable avec un logiciel tiers existant, sauf si Éclosion Édition en possède déjà un à connecter.

### 1.5 Parties prenantes

| Rôle | Intérêt dans le projet |
|---|---|
| Direction générale | Pilotage global, rentabilité, prise de décision |
| Direction éditoriale | Suivi des manuscrits et de la ligne éditoriale |
| Comité de lecture | Gestion des soumissions et des rapports de lecture |
| Production (correction, maquette, infographie, prépresse) | Suivi des tâches et délais |
| Commercial / Marketing | Suivi des ventes et de la diffusion |
| Finance / Comptabilité | Suivi des contrats, droits d'auteur, marges |
| RH | Gestion des utilisateurs internes |
| Auteurs (indirectement) | Bénéficiaires du suivi de leur manuscrit et de leurs droits |

### 1.6 Enjeux et facteurs de succès

- **Adoption par les utilisateurs** : chaque département doit trouver l'outil plus simple que ses méthodes actuelles.
- **Qualité des données** : un système n'a de valeur que si les informations saisies sont fiables et à jour.
- **Évolutivité** : l'architecture doit permettre d'ajouter des modules ou des départements sans tout reconstruire.
- **Sécurité** : les contrats, les données financières et les droits d'auteur sont des informations sensibles à protéger strictement.

### 1.7 Prochaines étapes du document

Ce chapitre sera suivi par :
- Chapitre 2 : Les utilisateurs et leurs rôles
- Chapitre 3 : Les départements d'Éclosion Édition
- Chapitre 4 : Le cycle complet d'un manuscrit
- (et ainsi de suite, selon le plan en 10 phases)


---


## Chapitre 2 : Les utilisateurs et leurs rôles

### 2.1 Principe général

L'accès à l'application est structuré par rôle. Chaque utilisateur se voit attribuer un rôle unique (ou éventuellement plusieurs pour les petites structures) qui détermine :
- les départements et modules qu'il peut consulter ;
- les actions qu'il peut effectuer (lecture seule, création, modification, validation, suppression) ;
- les manuscrits et documents auxquels il a accès.

**Règle de base :** un utilisateur ne voit que les informations nécessaires à son service. Un correcteur ne voit pas les données financières ; un comptable ne voit pas les rapports de lecture littéraire.

### 2.2 Liste des rôles

| Rôle | Rattachement | Niveau d'accès |
|---|---|---|
| Administrateur général | Transverse | Total — gestion des comptes, des rôles, des paramètres système |
| Directeur général | Direction générale | Vue complète sur tous les départements, en lecture, avec droits de décision |
| Directeur éditorial | Direction éditoriale | Vue complète sur le circuit éditorial (lecture, correction, fabrication) |
| Responsable administratif et financier | Finance / Comptabilité | Accès aux contrats, factures, droits d'auteur, tableaux financiers |
| Responsable commercial | Commercial / Librairie | Accès aux ventes, à la diffusion, aux stocks côté distribution |
| Responsable infographie | Infographie / Maquette / Couverture | Accès aux tâches de fabrication graphique |
| Correcteur | Correction linguistique / scientifique | Accès aux manuscrits qui lui sont assignés, en correction |
| Maquettiste | Maquette intérieure / Prépresse | Accès aux fichiers de mise en page et au statut de fabrication |
| Comptable | Comptabilité | Accès aux factures, devis, écritures comptables |
| Magasinier | Stock | Accès aux entrées/sorties, inventaire, alertes de stock |
| Assistant éditorial | Secrétariat éditorial / Comité de lecture | Accès à l'enregistrement des manuscrits et au suivi des lectures |

*Cette liste correspond aux rôles identifiés initialement. Elle pourra être complétée au fil des chapitres suivants (par exemple : membre du comité de lecture, chargé de communication, responsable RH, responsable juridique), à mesure que chaque département est détaillé.*

### 2.3 Matrice des droits par action

Pour chaque module, les droits seront définis selon quatre niveaux d'action :

| Niveau | Description |
|---|---|
| **Consultation** | Peut voir les données du module, sans les modifier |
| **Saisie** | Peut créer et modifier des données dans son périmètre |
| **Validation** | Peut approuver une étape et la faire avancer dans le workflow |
| **Administration** | Peut configurer le module (champs, règles, utilisateurs associés) |

Exemple d'application sur le module « Correction » :

| Rôle | Consultation | Saisie | Validation | Administration |
|---|---|---|---|---|
| Correcteur | Ses manuscrits assignés | Oui (rapport de correction) | Non | Non |
| Directeur éditorial | Tous les manuscrits | Non | Oui (passage à l'étape suivante) | Non |
| Administrateur général | Tout | Tout | Tout | Oui |

*Cette matrice sera complétée module par module dans les chapitres consacrés à chaque département (Chapitre 3 et suivants).*

### 2.4 Cycle de vie d'un compte utilisateur

1. **Création** : par l'administrateur général ou le responsable RH, avec attribution d'un rôle et d'un département.
2. **Activation** : envoi d'un accès (identifiant + mot de passe temporaire ou lien d'activation).
3. **Modification** : changement de rôle, de département, ou de périmètre d'accès en cas d'évolution de poste.
4. **Suspension** : blocage temporaire de l'accès (congé, enquête interne, etc.) sans suppression des données associées.
5. **Suppression / archivage** : lors du départ d'un collaborateur, le compte est désactivé mais son historique d'actions reste tracé pour l'audit.

### 2.5 Règles de sécurité liées aux utilisateurs

- Authentification obligatoire par identifiant et mot de passe ; option d'authentification à deux facteurs recommandée pour les rôles à accès financier ou administratif.
- Journal des connexions et des actions (qui a fait quoi, et quand) — voir Chapitre sur la sécurité et le journal d'activité.
- Expiration automatique de session après une période d'inactivité.
- Possibilité pour l'administrateur général de forcer la déconnexion ou la réinitialisation d'un mot de passe.

### 2.6 Cas particuliers à clarifier avec Éclosion Édition

Les points suivants nécessitent une validation avec la direction avant d'être figés dans le cahier des charges :
- Un même utilisateur peut-il cumuler plusieurs rôles (ex. : assistant éditorial qui fait aussi de la correction) ?
- Les auteurs doivent-ils avoir un accès externe limité (ex. : pour suivre l'avancement de leur propre manuscrit) ?
- Faut-il des rôles temporaires pour des prestataires externes (correcteur freelance, illustrateur indépendant) ?

### 2.7 Prochaine étape

Le Chapitre 3 détaillera l'ensemble des départements d'Éclosion Édition, leurs missions et les tableaux de bord associés à chacun.


---


## Chapitre 3 : Organisation fonctionnelle de la maison d'édition

### 3.1 Objet du chapitre

Ce chapitre définit l'organisation fonctionnelle d'Éclosion Édition. Chaque département correspond à un module de l'application, avec son propre espace de travail, ses responsabilités, ses droits d'accès (voir Chapitre 2) et son tableau de bord dédié.

Par rapport à la liste initiale de 26 modules envisagée en amont, ce chapitre propose une organisation consolidée en **17 départements fonctionnels**, plus cohérente avec la logique de workflow. Certains modules initiaux (ex. : Réécriture, Prépresse, Validation BAT, Distribution, Librairie, Contrats d'auteurs) sont ici rattachés à un département plus large plutôt que traités comme des entités séparées. *Ce regroupement devra être validé avec la direction d'Éclosion Édition avant d'être figé.*

### 3.2 Liste des départements

| # | Département | Mission principale |
|---|---|---|
| 1 | Direction générale | Supervision globale, décisions stratégiques |
| 2 | Secrétariat éditorial | Réception et enregistrement des manuscrits |
| 3 | Comité de lecture | Évaluation et avis sur les manuscrits |
| 4 | Direction éditoriale | Décision éditoriale et planification |
| 5 | Service juridique | Contrats et droits d'auteur |
| 6 | Correction éditoriale | Correction linguistique, orthographique, stylistique |
| 7 | Expertise scientifique | Vérification du contenu technique (si nécessaire) |
| 8 | Maquette et mise en page | Mise en forme et fichiers d'impression |
| 9 | Infographie et design | Couvertures, illustrations, visuels |
| 10 | Contrôle qualité | Conformité des fichiers et validation du BAT |
| 11 | Impression | Fabrication et réception des exemplaires |
| 12 | Gestion des stocks | Entrées, sorties, inventaires |
| 13 | Service commercial | Ventes, commandes, livraisons |
| 14 | Marketing et communication | Campagnes, lancements, supports |
| 15 | Administration et finances | Facturation, paiements, coûts |
| 16 | Ressources humaines | Utilisateurs, rôles, accès |
| 17 | Archivage | Conservation et traçabilité documentaire |

### 3.3 Détail des départements

Pour chaque département : missions, rôle(s) principal(aux) associé(s) (cf. Chapitre 2), et indicateurs du tableau de bord dédié.

**1. Direction générale**
- Missions : superviser l'ensemble des activités ; valider les décisions stratégiques ; suivre l'avancement de tous les ouvrages ; consulter tableaux de bord et rapports.
- Rôle associé : Directeur général.
- Indicateurs : vue consolidée de tous les indicateurs des 16 autres départements ; alertes globales de retard ; chiffre d'affaires ; nombre de manuscrits par étape.

**2. Secrétariat éditorial**
- Missions : réceptionner les manuscrits ; enregistrer les projets ; attribuer un numéro unique ; vérifier la complétude des dossiers ; affecter au comité de lecture.
- Rôle associé : Assistant éditorial.
- Indicateurs : manuscrits reçus (période) ; dossiers incomplets en attente ; délai moyen d'enregistrement ; manuscrits en attente d'affectation.

**3. Comité de lecture**
- Missions : examiner les manuscrits ; évaluer la qualité ; rédiger un rapport de lecture ; formuler un avis (acceptation, révision, refus).
- Rôle associé : Membre du comité de lecture *(à ajouter à la liste des rôles du Chapitre 2)*.
- Indicateurs : manuscrits en lecture ; délai moyen de lecture ; taux d'acceptation / révision / refus ; rapports en retard.

**4. Direction éditoriale**
- Missions : prendre la décision éditoriale ; planifier la production ; désigner les responsables d'étape ; suivre les délais.
- Rôle associé : Directeur éditorial.
- Indicateurs : manuscrits en attente de décision ; planning de production ; retards cumulés sur les projets en cours.

**5. Service juridique**
- Missions : préparer les contrats d'édition ; assurer le suivi juridique ; gérer les droits d'auteur ; archiver les documents contractuels.
- Rôle associé : *Responsable juridique, à ajouter au Chapitre 2* (peut être cumulé avec le Responsable administratif et financier selon la taille de la structure).
- Indicateurs : contrats en préparation / signés / en attente de signature ; échéances de renouvellement de droits.

**6. Correction éditoriale**
- Missions : correction linguistique, orthographique, grammaticale, typographique ; harmonisation du style.
- Rôle associé : Correcteur.
- Indicateurs : manuscrits en correction ; délai moyen ; taux de manuscrits renvoyés en réécriture.

**7. Expertise scientifique** *(si nécessaire selon le type d'ouvrage)*
- Missions : vérifier la rigueur scientifique ; contrôler les références ; valider le contenu technique.
- Rôle associé : Expert scientifique externe ou interne *(rôle ponctuel, à définir)*.
- Indicateurs : manuscrits en attente d'expertise ; délai moyen de validation.

**8. Maquette et mise en page**
- Missions : concevoir la maquette intérieure ; mettre en forme le livre ; préparer les fichiers d'impression.
- Rôle associé : Maquettiste.
- Indicateurs : manuscrits en maquette ; délai moyen ; fichiers en attente de validation.

**9. Infographie et design**
- Missions : concevoir les couvertures ; produire les illustrations ; réaliser les éléments graphiques et visuels de communication.
- Rôle associé : Responsable infographie.
- Indicateurs : couvertures en cours / validées ; illustrations en attente ; délai moyen.

**10. Contrôle qualité**
- Missions : vérifier la conformité des fichiers ; contrôler le BAT ; autoriser l'impression.
- Rôle associé : *Responsable contrôle qualité, à ajouter au Chapitre 2* (peut être porté par le Directeur éditorial dans une petite structure).
- Indicateurs : BAT en attente de validation ; taux de rejet ; délai moyen de validation.

**11. Impression**
- Missions : gérer les commandes d'impression ; suivre la fabrication ; contrôler la réception des exemplaires.
- Rôle associé : *Responsable production/impression, à ajouter au Chapitre 2*.
- Indicateurs : ouvrages en impression ; délai fournisseur ; exemplaires reçus vs commandés.

**12. Gestion des stocks**
- Missions : enregistrer les entrées et sorties ; réaliser les inventaires ; suivre les niveaux de stock.
- Rôle associé : Magasinier.
- Indicateurs : niveau de stock par titre ; alertes de seuil ; ruptures de stock ; mouvements récents.

**13. Service commercial**
- Missions : gérer les ventes ; suivre les commandes ; organiser les livraisons ; établir les statistiques commerciales.
- Rôle associé : Responsable commercial.
- Indicateurs : ventes par période / par titre ; commandes en cours ; livraisons en retard.

**14. Marketing et communication**
- Missions : préparer les campagnes promotionnelles ; organiser les lancements ; gérer les supports ; suivre les performances marketing.
- Rôle associé : *Chargé de communication, à ajouter au Chapitre 2*.
- Indicateurs : campagnes actives ; lancements planifiés ; retombées (si mesurables dans l'outil).

**15. Administration et finances**
- Missions : gérer les dépenses ; émettre les factures ; suivre les paiements ; calculer les coûts de production ; établir les états financiers.
- Rôle associé : Responsable administratif et financier, Comptable.
- Indicateurs : factures émises / en attente de paiement ; marge par ouvrage ; état de trésorerie.

**16. Ressources humaines**
- Missions : gérer les utilisateurs ; définir les rôles ; suivre les performances ; administrer les accès.
- Rôle associé : *Responsable RH, à ajouter au Chapitre 2* (souvent cumulé avec l'Administrateur général dans une petite structure).
- Indicateurs : utilisateurs actifs ; comptes en attente d'activation ; historique des accès.

**17. Archivage**
- Missions : conserver tous les documents ; assurer la traçabilité ; gérer les archives numériques.
- Rôle associé : Administrateur général ou rôle dédié selon volumétrie.
- Indicateurs : volume de documents archivés ; manuscrits archivés dans la période ; recherche/consultation d'archives.

### 3.4 Flux du manuscrit à travers les départements

Le parcours standard d'un manuscrit traverse les départements dans l'ordre suivant :

Secrétariat éditorial → Comité de lecture → Direction éditoriale → Service juridique → Correction éditoriale → Expertise scientifique *(si nécessaire)* → Maquette → Infographie → Contrôle qualité → Impression → Stock → Commercial → Livraison → Archivage.

Chaque transmission entre départements est enregistrée automatiquement avec :
- date et heure ;
- service émetteur et service destinataire ;
- responsable de la transmission ;
- statut du manuscrit à ce moment ;
- observations éventuelles.

*Ce flux sera détaillé étape par étape, avec les champs et pièces jointes associés, au Chapitre 4 : Le cycle complet d'un manuscrit.*

### 3.5 Principes de fonctionnement transverses

- Un manuscrit ne passe à l'étape suivante qu'après validation explicite de l'étape précédente par le responsable habilité.
- Toutes les actions sont historisées et non modifiables a posteriori (traçabilité complète).
- Chaque utilisateur ne voit que les modules correspondant à son rôle et à son département (cf. Chapitre 2), à l'exception de l'Administrateur général et de la Direction générale, qui ont une vue transverse.
- Tout dépassement de la date prévue déclenche une alerte automatique au responsable et, selon la configuration, à son supérieur hiérarchique.
- Les tableaux de bord de chaque département sont mis à jour en temps réel à chaque action.

### 3.6 Points à valider avec Éclosion Édition

- Confirmer le regroupement en 17 départements plutôt que la liste initiale de 26 modules (certains modules comme Réécriture, Prépresse, Validation BAT, Distribution et Librairie sont-ils suffisamment distincts pour mériter leur propre espace et tableau de bord ?).
- Compléter le Chapitre 2 avec les rôles manquants identifiés ci-dessus (membre du comité de lecture, responsable juridique, responsable contrôle qualité, responsable production/impression, chargé de communication, responsable RH).
- Statuer sur l'Expertise scientifique : département permanent ou intervention ponctuelle externe selon les ouvrages ?

### 3.7 Prochaine étape

Le Chapitre 4 détaillera le cycle complet d'un manuscrit, étape par étape, avec pour chacune : responsable, date d'entrée, date prévue, date réelle, retard éventuel, observations et pièces jointes.


---


## Chapitre 4 : Workflow détaillé du manuscrit

### 4.1 Objet du chapitre

Ce chapitre décrit le cycle de vie complet d'un manuscrit au sein d'Éclosion Édition, en 20 étapes. Chaque étape correspond à un statut dans l'application et s'inscrit dans le flux entre départements défini au Chapitre 3 (§3.4). Chaque changement d'étape est enregistré automatiquement afin de garantir une traçabilité totale.

### 4.2 Principe général

Chaque manuscrit est identifié par un **numéro unique** attribué à sa réception (cf. Secrétariat éditorial, Chapitre 3). Il suit un parcours normalisé. À chaque changement d'étape, le système enregistre :

- la date et l'heure ;
- le responsable de l'action ;
- le département concerné ;
- le nouveau statut ;
- les observations ;
- les documents associés.

**Règle fondamentale :** aucune étape ne peut être validée sans l'autorisation du responsable habilité (cf. matrice des droits, Chapitre 2, §2.3).

### 4.3 Les 20 étapes du workflow

**Étape 1 — Réception du manuscrit**
*Département : Secrétariat éditorial*
- Enregistrement du manuscrit.
- Attribution du numéro unique.
- Vérification des pièces fournies.
- Création du dossier numérique.
- **Statut : Reçu.**

**Étape 2 — Vérification administrative**
*Département : Secrétariat éditorial*
Contrôle de la conformité du dossier : coordonnées de l'auteur, manuscrit complet, annexes, formulaire de soumission.
- **Statut : Dossier conforme / Dossier incomplet.**
- Un dossier incomplet déclenche une notification à l'auteur (ou au secrétariat pour relance) et bloque le passage à l'étape 3.

**Étape 3 — Comité de lecture**
*Département : Comité de lecture*
- Affectation à un ou plusieurs lecteurs.
- Évaluation qualitative.
- Rédaction d'un rapport de lecture (pièce jointe obligatoire).
- **Avis possibles : accepté / accepté sous réserve de modifications / révision demandée / refusé.**

**Étape 4 — Décision éditoriale**
*Département : Direction éditoriale*
La Direction éditoriale examine les rapports de lecture et prend la décision finale.
- **Statut : Accepté / Refusé / En attente.**
- Un refus clôt le workflow : le dossier passe directement à l'archivage (étape 20) avec le motif de refus.

**Étape 5 — Contractualisation**
*Département : Service juridique*
- Préparation du contrat, validation juridique, signature, numérisation, archivage du contrat.
- Le système suit également : les échéances, les droits d'auteur, les avances éventuelles (lien avec le module financier, chapitre dédié).
- **Statut : Contrat en préparation / En attente de signature / Signé.**

**Étape 6 — Planification du projet**
*Département : Direction éditoriale*
Définition : du chef de projet, des intervenants, des délais, du calendrier, des objectifs.
- C'est à cette étape que sont fixées les **dates prévues** de chaque étape suivante, qui serviront de référence au calcul des retards.

**Étape 7 — Correction éditoriale**
*Département : Correction éditoriale*
Le manuscrit passe successivement par : correction orthographique, grammaticale, typographique, harmonisation du style, validation.
- **Chaque correction génère une nouvelle version du document** (versionnage obligatoire, cf. §4.5).

**Étape 8 — Expertise scientifique** *(si nécessaire)*
*Département : Expertise scientifique*
- Attribution d'experts, saisie de leurs observations, demandes de modifications, validation scientifique.
- Cette étape est **conditionnelle** : elle n'apparaît dans le workflow que si l'ouvrage a été marqué « à expertise » lors de la planification (étape 6).

**Étape 9 — Réécriture éditoriale** *(si nécessaire)*
*Département : Correction éditoriale*
- Restructuration, enrichissement, adaptation, validation.
- Étape conditionnelle également, déclenchée par la correction (étape 7) ou l'expertise (étape 8).

**Étape 10 — Mise en page**
*Département : Maquette et mise en page*
Création de : la maquette intérieure, la pagination, la table des matières, les styles.

**Étape 11 — Infographie**
*Département : Infographie et design*
Production de : couverture, quatrième de couverture, illustrations, graphiques, visuels promotionnels.
- *Remarque : les étapes 10 et 11 peuvent se dérouler en parallèle ; le passage à l'étape 12 exige la validation des deux.*

**Étape 12 — Validation du BAT**
*Département : Contrôle qualité*
Contrôle de : la mise en page, la couverture, les couleurs, les marges, la qualité des fichiers.
- **Décision : BAT validé / BAT à corriger.**
- Un BAT à corriger renvoie le projet à l'étape 10 ou 11 selon la nature de la correction, avec traçabilité du motif.

**Étape 13 — Attribution des références**
*Département : Direction éditoriale / Secrétariat éditorial*
Le système enregistre : ISBN, dépôt légal, code-barres, collection, catégorie, mots-clés.

**Étape 14 — Impression**
*Département : Impression*
Suivi de : la commande, l'imprimeur, les quantités, les délais, la réception.

**Étape 15 — Contrôle qualité (exemplaires imprimés)**
*Département : Contrôle qualité*
Vérification : de la conformité, de la reliure, des couleurs, du nombre d'exemplaires.
- Une non-conformité déclenche une réclamation auprès de l'imprimeur, tracée dans le dossier.

**Étape 16 — Entrée en stock**
*Département : Gestion des stocks*
Enregistrement : du dépôt, du magasin, des quantités, de l'emplacement.

**Étape 17 — Commercialisation**
*Département : Service commercial*
Le service commercial renseigne : le prix public, les canaux de vente, les libraires partenaires, les distributeurs, la disponibilité.
- **Statut : En vente.**

**Étape 18 — Vente et livraison**
*Département : Service commercial / Gestion des stocks*
Le système suit : les commandes, les paiements, les livraisons, les retours éventuels.
- Chaque vente décrémente automatiquement le stock (lien avec le module stock).

**Étape 19 — Suivi post-publication**
*Départements : Commercial / Finances / Stocks*
Consultation en continu : des ventes, des réimpressions, des stocks restants, des droits d'auteur générés, des performances commerciales.
- Une réimpression relance un sous-cycle : étapes 14 → 16.

**Étape 20 — Archivage**
*Département : Archivage*
Le dossier complet comprend : le manuscrit, le contrat, les rapports, les corrections, les maquettes, le BAT, les factures, les statistiques de vente.
- **Statut final : Archivé.**

### 4.4 Tableau de suivi permanent

Pour chaque ouvrage, l'application affiche en permanence :

- le numéro du projet ;
- le titre ;
- le responsable actuel ;
- le département en charge ;
- le statut ;
- le pourcentage d'avancement (calculé à partir des étapes validées) ;
- les dates prévues et réelles de chaque étape ;
- les éventuels retards (écart date réelle / date prévue) ;
- les pièces jointes ;
- l'historique complet des actions.

Cette vue correspond à la frise chronologique du suivi de production, accessible depuis la fiche de chaque manuscrit.

### 4.5 Règles de gestion du workflow

1. **Immutabilité des validations** : aucun utilisateur ne peut modifier une étape déjà validée sans autorisation d'un profil habilité ; toute modification autorisée est elle-même tracée.
2. **Horodatage systématique** : toutes les actions sont horodatées et associées à leur auteur.
3. **Notifications** : chaque changement de statut déclenche une notification aux services concernés (service destinataire de l'étape suivante, direction si configuré).
4. **Alertes de retard** : tout dépassement d'une date prévue génère une alerte automatique.
5. **Versionnage des documents** : chaque version d'un document est conservée, avec possibilité de retour à une version antérieure. Aucune version n'est écrasée.
6. **Étapes conditionnelles** : les étapes 8 (expertise scientifique) et 9 (réécriture) ne sont activées que si le projet le requiert ; leur absence n'est pas comptée comme une étape sautée.
7. **Sortie anticipée** : un refus (étape 4) ou un abandon de projet (décision de la Direction générale, motivée et tracée) conduit directement à l'archivage.

### 4.6 Prochaine étape

Le Chapitre 5 décrit le module « Direction générale » et son tableau de bord stratégique, qui agrège en temps réel les données produites par ce workflow.


---


## Chapitre 5 : Module « Direction générale » et tableau de bord stratégique

### 5.1 Objet du module

Le module « Direction générale » est le centre de pilotage de l'application. Il offre au Directeur général et aux utilisateurs autorisés une vision globale, instantanée et détaillée de l'ensemble des activités d'Éclosion Édition : état de chaque manuscrit, performances des départements, indicateurs financiers, ventes, stocks et alertes — sans avoir à naviguer dans les modules opérationnels.

Toutes les données affichées sont produites par le workflow décrit au Chapitre 4 et par les modules départementaux du Chapitre 3 : ce module ne saisit rien, il **agrège et restitue**.

### 5.2 Accès

Ce module est réservé aux profils suivants (cf. Chapitre 2) :

| Profil | Étendue de l'accès |
|---|---|
| Administrateur système | Accès complet, y compris paramétrage du tableau de bord |
| Directeur général | Accès complet en consultation |
| Directeur éditorial | Accès complet, **droits limités sur les données financières** |
| Responsable administratif et financier | Accès selon les autorisations définies (indicateurs financiers et commerciaux) |

### 5.3 Tableau de bord principal

À l'ouverture du module, le tableau de bord affiche les indicateurs sous forme de cartes, graphiques et listes dynamiques, mis à jour en temps réel. Les indicateurs sont regroupés en quatre familles.

**5.3.1 Indicateurs éditoriaux**
- Nombre total de manuscrits enregistrés.
- Manuscrits en attente d'examen.
- Manuscrits en comité de lecture.
- Manuscrits acceptés / refusés.
- Manuscrits en correction.
- Manuscrits en mise en page.
- Manuscrits en infographie.
- Manuscrits en validation BAT.
- Manuscrits en impression.
- Manuscrits en stock.
- Manuscrits commercialisés.
- Ouvrages archivés.

*Chaque indicateur correspond à un statut du workflow (Chapitre 4) et est cliquable : il ouvre la liste filtrée des manuscrits concernés.*

**5.3.2 Indicateurs de production**
- Nombre de projets en cours / terminés.
- Taux de respect des délais.
- Nombre de projets en retard.
- Temps moyen de production par ouvrage.
- Charge de travail par département.

**5.3.3 Indicateurs commerciaux**
- Nombre d'ouvrages vendus.
- Ventes par titre, par collection, par canal de distribution.
- Chiffre d'affaires global et mensuel.
- Meilleures ventes.
- Livres en rupture de stock.

**5.3.4 Indicateurs financiers**
- Coût de production par ouvrage.
- Dépenses engagées / recettes encaissées.
- Marge estimée par titre.
- Droits d'auteur à payer.
- Factures en attente.
- Situation de trésorerie (si le module financier est activé).

*Les indicateurs financiers ne sont visibles que par les profils habilités (§5.2).*

### 5.4 Moteur de recherche global

Le module intègre une recherche instantanée permettant de retrouver un ouvrage à partir de :
- son numéro de projet ;
- son titre ;
- son auteur ;
- son ISBN ;
- sa collection ;
- son responsable de projet ;
- son statut.

La recherche accepte les critères combinés (ex. : tous les ouvrages d'une collection donnée, en retard, sous la responsabilité d'une même personne).

### 5.5 Fiche synthétique d'un ouvrage

Depuis le tableau de bord ou la recherche, la sélection d'un ouvrage affiche sa fiche synthétique :
- informations générales (titre, auteur, collection, numéro de projet) ;
- statut actuel et service responsable ;
- pourcentage d'avancement ;
- calendrier prévisionnel vs dates réelles ;
- documents associés ;
- validations obtenues ;
- dépenses engagées ;
- ventes réalisées ;
- alertes éventuelles.

Cette fiche est la vue « direction » de la frise chronologique définie au Chapitre 4 (§4.4).

### 5.6 Alertes automatiques

Le tableau de bord met en évidence, dans une zone dédiée :
- les tâches en retard ;
- les validations en attente ;
- les contrats non signés ;
- les BAT à approuver ;
- les stocks faibles ;
- les échéances de paiement ;
- les anomalies détectées dans le workflow (ex. : étape validée sans pièce jointe obligatoire).

**Chaque alerte est priorisée selon quatre niveaux : faible, moyenne, élevée, critique.** Les alertes critiques peuvent en outre déclencher une notification (e-mail ou notification interne, selon la configuration du Chapitre consacré aux notifications).

### 5.7 Rapports

Le module génère automatiquement des rapports :
- quotidiens, hebdomadaires, mensuels, trimestriels, annuels ;
- exportables en **PDF ou Excel** ;
- filtrables par période, collection, responsable ou département.

Le contenu type d'un rapport (indicateurs inclus, mise en page, logo) sera spécifié dans le chapitre consacré aux rapports et statistiques.

### 5.8 Journal des activités

Toutes les opérations importantes du système sont consignées dans un journal :
- connexions des utilisateurs ;
- création d'un manuscrit ;
- changements de statut ;
- validations d'étape ;
- modifications de documents ;
- impressions de rapports.

Le journal est **consultable uniquement par les profils autorisés** (Administrateur système et Direction générale). Il est en lecture seule : aucune entrée ne peut être modifiée ou supprimée, y compris par l'administrateur, afin de garantir sa valeur d'audit.

### 5.9 Centre de pilotage intelligent

Au-delà de la restitution de données, le module intègre un **centre de pilotage intelligent** : le système analyse automatiquement la situation et produit des recommandations et des constats formulés en langage naturel, directement exploitables par la direction.

Exemples de messages générés automatiquement :
- « Trois manuscrits sont bloqués en correction depuis plus de 10 jours. »
- « Le stock du titre X atteindra le seuil d'alerte dans une semaine. »
- « Le coût de production de cet ouvrage dépasse le budget prévu de 15 %. »

**Principes de fonctionnement :**
- Les analyses s'appuient sur des règles configurables (durées de blocage, seuils d'écart budgétaire, vitesse d'écoulement des stocks, etc.), définies par l'administrateur avec la direction.
- Chaque recommandation est reliée aux données qui la justifient : un clic ouvre la liste des manuscrits, le détail du stock ou le budget concerné.
- Les recommandations sont priorisées selon les mêmes quatre niveaux que les alertes (§5.6) et peuvent être marquées « traitée », « ignorée » ou « reportée », avec traçabilité de la décision.
- L'historique des recommandations est conservé, ce qui permet a posteriori d'évaluer la pertinence des règles et de les affiner.

Ce centre de pilotage transforme l'ERP d'un outil de restitution en un véritable **outil d'aide à la décision** : il ne se contente pas de montrer les chiffres, il attire l'attention de la direction sur ce qui mérite une action.

### 5.10 Objectif du module

Le module « Direction générale » doit permettre à la direction d'Éclosion Édition de piloter efficacement l'ensemble des activités de la maison grâce à une information fiable, centralisée et mise à jour en temps réel. Il constitue l'outil principal d'aide à la décision stratégique, opérationnelle et financière.

### 5.11 Prochaine étape

Les chapitres suivants détailleront, module par module, les autres départements (Secrétariat éditorial, Comité de lecture, etc.), avec pour chacun : écrans, champs, actions, droits et tableau de bord.


---


## Chapitre 6 : Module « Secrétariat éditorial et gestion des manuscrits »

### 6.1 Objet du module

Le module « Secrétariat éditorial » constitue le **point d'entrée unique** de tous les projets éditoriaux d'Éclosion Édition. Il permet d'enregistrer, d'identifier, de classer et de suivre chaque manuscrit dès sa réception.

**Règle absolue :** aucun manuscrit ne peut intégrer le processus éditorial (Chapitre 4) sans avoir été enregistré dans ce module.

### 6.2 Création d'un dossier éditorial

À la réception d'un manuscrit, le système crée un dossier numérique unique contenant les champs suivants :

| Champ | Saisie | Obligatoire |
|---|---|---|
| Numéro de projet | Généré automatiquement | Oui |
| Date de réception | Automatique (modifiable) | Oui |
| Titre de l'ouvrage | Manuelle | Oui |
| Sous-titre | Manuelle | Non |
| Nom de l'auteur | Manuelle (ou lien vers fiche auteur existante) | Oui |
| Collection envisagée | Liste déroulante | Non |
| Domaine (roman, essai, poésie, manuel, jeunesse, etc.) | Liste déroulante | Oui |
| Langue | Liste déroulante | Oui |
| Nombre estimé de pages | Manuelle | Non |
| Résumé | Manuelle | Non |
| Mots-clés | Manuelle (étiquettes) | Non |
| Niveau de priorité | Calculé + ajustable (voir §6.5) | Oui |
| Responsable du dossier | Sélection d'un utilisateur | Oui |

Le dossier est ensuite accessible aux services autorisés, selon les droits définis au Chapitre 2.

### 6.3 Pièces jointes

Le système permet d'associer au dossier :
- le manuscrit original ;
- les versions corrigées ;
- les illustrations et photos ;
- les contrats ;
- les rapports de lecture ;
- les notes internes et courriers ;
- les factures ;
- le BAT ;
- les fichiers d'impression ;
- tout autre document utile.

**Chaque document est versionné** afin de conserver un historique complet (cf. règle de versionnage, Chapitre 4, §4.5). Aucune version n'est écrasée.

### 6.4 Classification et recherche

Les manuscrits peuvent être classés et filtrés selon plusieurs critères combinables :
- collection ;
- genre ;
- auteur ;
- responsable éditorial ;
- priorité ;
- statut ;
- année de réception ;
- projet interne ou commande externe.

Les filtres doivent rester performants avec plusieurs milliers de dossiers (exigence de montée en charge, cf. Chapitre 1, §1.3).

### 6.5 Indice de priorité éditoriale

Chaque manuscrit reçoit un **indice de priorité éditoriale calculé automatiquement**, qui permet au tableau de bord de classer les projets à traiter en priorité.

**Critères pris en compte (pondérables) :**
- urgence du projet ;
- type d'ouvrage (commande institutionnelle, ouvrage académique, publication courante, etc.) ;
- délais contractuels ;
- disponibilité des équipes ;
- potentiel commercial estimé.

**Règles de fonctionnement :**
- Les pondérations de chaque critère sont configurables par l'administrateur, en accord avec la Direction éditoriale.
- L'indice est recalculé automatiquement lorsque l'un des critères change (ex. : échéance contractuelle qui se rapproche).
- Le Directeur éditorial peut **ajuster manuellement** la priorité d'un projet ; cet ajustement est tracé avec sa justification.
- Le tableau de bord (§6.10) et le module Direction générale (Chapitre 5) exploitent cet indice pour ordonner les listes de projets.

Cette fonctionnalité aide la direction à optimiser la planification et l'utilisation des ressources.

### 6.6 Gestion des statuts

Chaque manuscrit possède un statut mis à jour automatiquement, aligné sur les étapes du workflow du Chapitre 4 :

Reçu → Vérification administrative → En comité de lecture → Décision éditoriale → Contrat en préparation → En correction → En expertise → En mise en page → En infographie → BAT → Impression → Stock → Commercialisation → Vente → Archivé.

Chaque changement de statut est enregistré avec la date, l'heure et l'utilisateur concerné.

### 6.7 Calendrier de suivi

Pour chaque projet, le système affiche :
- date de réception ;
- date de début de production ;
- échéance prévue ;
- date réelle de chaque étape ;
- retards éventuels ;
- temps total de production.

Le calendrier est mis à jour automatiquement à chaque validation d'étape.

### 6.8 Affectation des responsables

Le secrétariat éditorial peut désigner :
- le directeur éditorial ;
- le chef de projet ;
- les correcteurs ;
- les maquettistes ;
- les infographistes ;
- tout autre intervenant.

**Chaque affectation déclenche une notification** à la personne désignée.

### 6.9 Historique des actions

Toutes les opérations sont enregistrées :
- création du dossier ;
- modification des informations ;
- ajout de documents ;
- changement de statut ;
- affectation d'un responsable ;
- validation d'une étape.

L'historique est consultable à tout moment par les profils autorisés et n'est jamais modifiable (cohérence avec le journal d'activités, Chapitre 5, §5.8).

### 6.10 Alertes

Le système signale automatiquement :
- les dossiers incomplets ;
- les manuscrits sans responsable ;
- les retards de traitement ;
- les échéances proches ;
- les documents manquants.

### 6.11 Tableau de bord du secrétariat éditorial

Le module affiche notamment :
- nombre total de manuscrits enregistrés ;
- nouveaux manuscrits reçus (période paramétrable) ;
- dossiers incomplets ;
- dossiers en attente de lecture ;
- projets en retard ;
- projets clôturés ;
- **liste des projets triée par indice de priorité éditoriale** (§6.5).

### 6.12 Objectif du module

Le module « Secrétariat éditorial » garantit une gestion rigoureuse et centralisée des manuscrits. Il assure la traçabilité de chaque projet dès son arrivée, facilite la coordination entre les départements et constitue le point de départ de l'ensemble du processus éditorial.


---


## Chapitre 7 : Module « Comité de lecture et évaluation des manuscrits »

### 7.1 Objet du module

Le module « Comité de lecture » permet d'organiser, suivre et documenter l'évaluation des manuscrits soumis à Éclosion Édition. Il garantit un processus de sélection **transparent, structuré et traçable**.

Tous les rapports, observations et décisions sont conservés dans le dossier numérique du manuscrit (Chapitre 6).

### 7.2 Affectation des manuscrits

Le Directeur éditorial ou le Secrétariat éditorial peut affecter un manuscrit à un ou plusieurs lecteurs. Un même manuscrit peut être évalué simultanément par plusieurs lecteurs.

Pour chaque lecteur, le système enregistre :
- le nom du lecteur ;
- la date d'affectation ;
- le délai de remise du rapport ;
- la date effective de remise ;
- le statut de la mission (en cours, remis, en retard, annulé).

### 7.3 Tableau de bord du comité de lecture

**Vue lecteur** — chaque lecteur visualise :
- les manuscrits qui lui sont attribués ;
- les échéances à respecter ;
- les rapports déjà remis ;
- les évaluations en cours ;
- les missions terminées.

**Vue responsable du comité** — visualise en plus :
- les retards ;
- la charge de travail de chaque lecteur (nombre de manuscrits en cours, délai moyen).

### 7.4 Grille d'évaluation

L'application propose une grille d'analyse **personnalisable** comprenant notamment :
- originalité du sujet ;
- qualité de l'écriture ;
- structure du texte ;
- cohérence du contenu ;
- rigueur scientifique (si applicable) ;
- qualité des références ;
- intérêt pour le public cible ;
- adéquation avec la ligne éditoriale d'Éclosion Édition ;
- potentiel commercial ;
- recommandations du lecteur.

Chaque critère peut être **noté et commenté**.

### 7.5 Notation pondérée et score global

La grille d'évaluation est complétée par un **système de notation pondérée**, outil d'aide à la décision pour la Direction éditoriale.

**Fonctionnement :**
- Chaque critère de la grille (§7.4) reçoit un **coefficient** configurable par la Direction éditoriale (ex. : adéquation à la ligne éditoriale ×3, potentiel commercial ×2, originalité ×2, etc.).
- L'application calcule automatiquement un **score global** du manuscrit à partir des notes et des coefficients.
- Le score est traduit en classement qualitatif : **Excellent / Très bon / Bon / À retravailler / Refusé** (les seuils sont paramétrables).
- Lorsque plusieurs lecteurs évaluent le même manuscrit, le système affiche le score de chaque lecteur, la moyenne, et l'écart entre évaluateurs (un écart important signale un manuscrit à discuter en comité).

**Usages :**
- Comparer objectivement les projets en attente de décision.
- Analyser les tendances sur plusieurs années (évolution de la qualité des soumissions, corrélation entre score initial et succès commercial).

**Limite explicite :** cette aide à la décision **ne remplace pas le jugement humain**. La décision finale reste celle de la Direction éditoriale (Chapitre 4, étape 4), qui peut s'écarter du score en motivant sa décision.

### 7.6 Rapport de lecture

Le lecteur rédige son rapport directement dans l'application ou le dépose en pièce jointe.

Le rapport comprend notamment :
- une appréciation générale ;
- les points forts ;
- les points à améliorer ;
- les recommandations ;
- une conclusion.

### 7.7 Décisions proposées

À l'issue de son évaluation, le lecteur peut recommander :
- acceptation sans modification ;
- acceptation sous réserve de corrections mineures ;
- acceptation sous réserve de corrections majeures ;
- demande de réécriture ;
- nouvelle expertise ;
- refus motivé.

**Ces recommandations restent consultatives** jusqu'à la décision officielle de la Direction éditoriale.

### 7.8 Gestion des délais

Le système :
- calcule automatiquement les échéances ;
- envoie des rappels avant la date limite ;
- signale les retards ;
- permet de prolonger un délai **avec justification obligatoire**.

Toutes les modifications sont historisées.

### 7.9 Confidentialité

Les manuscrits confiés aux lecteurs sont accessibles uniquement aux personnes autorisées.

Chaque rapport peut être marqué selon quatre niveaux de diffusion :
- confidentiel ;
- visible par la Direction uniquement ;
- partageable avec les autres membres du comité ;
- intégrable au dossier éditorial.

*Point de vigilance : l'anonymisation éventuelle des lecteurs vis-à-vis des auteurs (et réciproquement) devra être tranchée avec la direction — certaines maisons pratiquent la lecture en aveugle.*

### 7.10 Statistiques

Le module produit des indicateurs tels que :
- nombre de manuscrits évalués ;
- délai moyen d'évaluation ;
- taux d'acceptation / taux de refus ;
- nombre de rapports en attente ;
- charge de travail par lecteur ;
- distribution des scores globaux (§7.5) par période et par genre.

### 7.11 Notifications

Le système notifie automatiquement :
- l'affectation d'un nouveau manuscrit ;
- les rappels d'échéance ;
- la remise d'un rapport ;
- les demandes de complément ;
- la décision de la Direction éditoriale.

### 7.12 Validation et transmission

Lorsque tous les rapports requis sont disponibles, le dossier est automatiquement transmis à la Direction éditoriale pour décision (Chapitre 4, étape 4).

Avant transmission, le système vérifie que :
- tous les rapports attendus ont été déposés ;
- les évaluations sont complètes (tous les critères notés) ;
- les pièces jointes nécessaires sont présentes.

### 7.13 Objectif du module

Le module « Comité de lecture » garantit une évaluation rigoureuse, équitable et documentée des manuscrits. Il fournit à la Direction éditoriale toutes les informations nécessaires pour prendre une décision fondée — enrichies par le score pondéré — tout en assurant la traçabilité et la confidentialité du processus.


---


## Chapitre 8 : Module « Direction éditoriale et gestion de la production »

### 8.1 Objet du module

Le module « Direction éditoriale » permet de piloter l'ensemble des projets éditoriaux d'Éclosion Édition. Il centralise les décisions, planifie les travaux, coordonne les équipes et contrôle l'avancement de chaque ouvrage jusqu'à sa publication.

Ce module constitue le **lien entre les décisions du comité de lecture (Chapitre 7) et les services de production** (correction, maquette, infographie, contrôle qualité).

### 8.2 Décision éditoriale

Après analyse des rapports de lecture et du score pondéré (Chapitre 7, §7.5), la Direction éditoriale peut prendre l'une des décisions suivantes :
- acceptation du manuscrit ;
- acceptation sous conditions ;
- demande de révision ;
- mise en attente ;
- refus motivé.

Chaque décision est enregistrée avec :
- la date ;
- le responsable ;
- la motivation (obligatoire, notamment si la décision s'écarte du score du comité) ;
- les documents associés.

Cette décision correspond à l'étape 4 du workflow (Chapitre 4).

### 8.3 Création du projet éditorial

En cas d'acceptation, le manuscrit devient un **projet éditorial**. Le système génère automatiquement :
- un identifiant de projet (lié au numéro de manuscrit du Chapitre 6) ;
- le calendrier prévisionnel ;
- les étapes obligatoires (et conditionnelles : expertise, réécriture, cf. Chapitre 4) ;
- les tâches à réaliser ;
- les responsables de chaque étape.

### 8.4 Planification de la production

Le Directeur éditorial établit le planning du projet :
- date de lancement ;
- échéance de correction ;
- échéance de mise en page ;
- échéance d'infographie ;
- validation du BAT ;
- impression ;
- lancement commercial.

Le planning est modifiable et **chaque changement est historisé** (ancienne date, nouvelle date, auteur, motif).

### 8.5 Affectation des intervenants

Le module permet d'affecter :
- un chef de projet éditorial ;
- un ou plusieurs correcteurs ;
- un expert scientifique (si nécessaire) ;
- un maquettiste ;
- un infographiste ;
- un illustrateur ;
- un responsable qualité ;
- un responsable commercial.

Chaque intervenant reçoit automatiquement une notification. L'affectation tient compte de la charge de travail visible au tableau de bord (§8.12).

### 8.6 Gestion des tâches

Chaque étape est découpée en tâches. Pour chaque tâche, le système enregistre :
- l'intitulé ;
- le responsable ;
- la priorité ;
- la date de début ;
- la date prévue de fin ;
- la date réelle de fin ;
- le niveau d'avancement ;
- les commentaires ;
- les pièces jointes.

**Statuts possibles d'une tâche :** non commencée / en cours / suspendue / terminée / validée.

### 8.7 Diagramme de Gantt interactif

Le module intègre un **diagramme de Gantt interactif**, vue centrale de la planification. C'est l'un des outils les plus utilisés de l'ERP pour une maison gérant des dizaines ou des centaines de projets en parallèle.

**Fonctionnalités :**
- Chaque ouvrage apparaît sur une ligne avec toutes ses étapes (lecture, correction, maquette, couverture, BAT, impression, commercialisation).
- **Vue projet** (toutes les tâches d'un ouvrage) et **vue portefeuille** (tous les ouvrages en parallèle, filtrables par collection, responsable, statut).
- Les responsables habilités peuvent **déplacer des échéances par glisser-déposer**, selon leurs droits (Chapitre 2) ; chaque déplacement est historisé avec justification.
- **Dépendances entre tâches** : une tâche ne peut commencer avant la fin de celle dont elle dépend ; le décalage d'une tâche recalcule automatiquement les tâches dépendantes et signale les conflits.
- Les retards sont mis en évidence visuellement (code couleur), avec affichage du chemin critique du projet.
- La frise chronologique de chaque manuscrit (Chapitre 4, §4.4) est une vue simplifiée de ce même Gantt.

### 8.8 Gestion des délais

Le système calcule automatiquement :
- le temps prévu pour chaque étape ;
- le temps réellement consommé ;
- les écarts ;
- le pourcentage d'avancement global.

Des alertes sont générées en cas de dépassement, remontées au tableau de bord du module et au centre de pilotage intelligent (Chapitre 5, §5.9).

### 8.9 Validation des étapes

Chaque étape doit être validée avant le passage à la suivante (règle fondamentale du Chapitre 4). La validation est enregistrée avec :
- le nom du validateur ;
- la date et l'heure ;
- les observations éventuelles.

**Le système interdit la progression si une validation obligatoire est absente.**

### 8.10 Gestion des modifications

Toutes les modifications importantes sont historisées :
- changement de planning ;
- changement de responsable ;
- modification des délais ;
- ajout ou suppression de tâches ;
- modification des documents.

Aucune information n'est supprimée définitivement ; les anciennes versions restent consultables.

### 8.11 Tableau de bord du Directeur éditorial

Le tableau de bord présente notamment :
- les projets en cours ;
- les projets en retard ;
- les tâches critiques (sur le chemin critique du Gantt) ;
- la charge de travail par collaborateur ;
- le taux d'avancement de chaque ouvrage ;
- les validations en attente ;
- les prochaines échéances ;
- les projets classés par indice de priorité éditoriale (Chapitre 6, §6.5).

### 8.12 Indicateurs de performance

Le système calcule automatiquement :
- le délai moyen de production ;
- le taux de respect des échéances ;
- le nombre de projets terminés / en retard ;
- la productivité par département ;
- la durée moyenne de chaque étape éditoriale.

Ces indicateurs alimentent le module Direction générale (Chapitre 5, §5.3.2).

### 8.13 Objectif du module

Le module « Direction éditoriale et gestion de la production » assure une planification rigoureuse, une coordination efficace des équipes et un suivi permanent de chaque projet. Il garantit que tous les ouvrages suivent un processus maîtrisé, conforme aux exigences de qualité et aux délais fixés par Éclosion Édition.


---


## Chapitre 9 : Module « Gestion des contrats, droits d'auteur et affaires juridiques »

### 9.1 Objet du module

Ce module centralise l'ensemble des documents juridiques liés aux ouvrages publiés par Éclosion Édition. Il assure le suivi des contrats, des droits d'exploitation, des obligations contractuelles et des paiements liés aux droits d'auteur.

Il correspond au département Service juridique (Chapitre 3) et couvre l'étape 5 du workflow (Contractualisation, Chapitre 4).

### 9.2 Types de contrats

Le système permet de créer différents types de contrats :
- contrat d'édition ;
- contrat de coédition ;
- contrat de traduction ;
- contrat d'illustration ;
- contrat de correction ;
- contrat de prestation de services ;
- contrat de cession de droits ;
- avenant à un contrat existant.

Chaque contrat reçoit un **numéro unique généré automatiquement** et est rattaché à l'ouvrage et aux parties concernées.

### 9.3 Informations enregistrées

Chaque contrat comporte notamment :
- numéro et type de contrat ;
- ouvrage concerné ;
- partie(s) contractante(s) ;
- date de signature et date d'entrée en vigueur ;
- durée du contrat ;
- territoires d'exploitation ;
- langues autorisées ;
- formats autorisés (papier, numérique, audio, etc.) ;
- conditions financières ;
- clauses particulières ;
- statut du contrat (en préparation, en validation, en attente de signature, actif, expiré, résilié).

### 9.4 Gestion des droits d'auteur

Le système enregistre :
- le pourcentage de droits d'auteur (y compris paliers progressifs, ex. : 8 % jusqu'à 3 000 exemplaires, 10 % au-delà) ;
- les avances sur droits ;
- les redevances ;
- les échéances de paiement ;
- les retenues éventuelles ;
- l'historique des paiements.

Les droits sont calculés selon les paramètres définis dans le contrat.

### 9.5 Moteur de calcul automatique des droits connecté aux ventes

Le module intègre un **moteur de calcul automatique des droits d'auteur connecté au module commercial**, fonctionnalité stratégique de l'ERP.

**Fonctionnement :**
- Dès qu'une vente est enregistrée (librairie, en ligne ou vente directe par Éclosion Édition), l'ERP met automatiquement à jour le **relevé de droits de l'auteur** selon les clauses de son contrat : pourcentage applicable, paliers, assiette de calcul (prix public HT, prix net éditeur — à préciser dans le contrat), avances à amortir.
- L'avance versée est amortie automatiquement : aucun paiement de droits n'est déclenché tant que les droits générés n'ont pas couvert l'avance ; le solde restant à amortir est visible en permanence.
- Les retours de librairie (Chapitre stocks/commercial) viennent en déduction des droits calculés.
- Le Responsable administratif et financier peut générer **en un clic** les états de droits d'auteur par période (semestriels ou annuels selon les usages contractuels) et les ordres de paiement correspondants.
- Chaque relevé généré est archivé au dossier de l'auteur et rattaché au contrat.

**Règles de contrôle :**
- Tout calcul est traçable : le détail des ventes prises en compte est consultable depuis le relevé.
- Une modification rétroactive d'une vente (annulation, retour tardif) déclenche un recalcul et une alerte au service financier.

### 9.6 Gestion des échéances

L'application surveille automatiquement :
- les contrats arrivant à expiration ;
- les échéances de paiement ;
- les renouvellements ;
- les obligations contractuelles.

Des rappels sont envoyés aux responsables concernés, et les échéances critiques remontent au tableau de bord de la Direction générale (Chapitre 5, §5.6).

### 9.7 Archivage des documents

Le module conserve :
- les contrats signés ;
- les avenants ;
- les procurations ;
- les autorisations ;
- les courriers juridiques ;
- les pièces justificatives.

Tous les documents sont classés et versionnés.

### 9.8 Circuit de validation des contrats

Avant activation, chaque contrat suit un circuit de validation :
1. Préparation.
2. Relecture juridique.
3. Validation de la Direction.
4. Signature.
5. Archivage.

Le système enregistre toutes les validations (validateur, date, heure, observations).

### 9.9 Tableau de bord juridique

Le tableau de bord présente notamment :
- nombre de contrats actifs ;
- contrats en préparation ;
- contrats expirant prochainement ;
- contrats expirés ;
- paiements de droits d'auteur à venir ;
- avances en cours d'amortissement (§9.5) ;
- litiges éventuels ;
- documents en attente de signature.

### 9.10 Historique et traçabilité

Chaque opération est enregistrée : création, modification, validation, signature, renouvellement, résiliation.

**Aucune suppression définitive n'est autorisée** sans les droits appropriés, et toute suppression autorisée reste tracée dans le journal.

### 9.11 Sécurité et confidentialité

Les informations juridiques sont strictement confidentielles. L'accès est réservé aux profils autorisés :
- Direction générale ;
- Direction éditoriale ;
- Responsable administratif et financier ;
- Service juridique ;
- Administrateur système.

**Chaque consultation ou modification est journalisée** (y compris les consultations en lecture seule, compte tenu de la sensibilité des données).

### 9.12 Intégration avec les autres modules

Le module communique automatiquement avec :
- le module Manuscrits (Chapitre 6) ;
- le module Direction éditoriale (Chapitre 8) ;
- le module Finance et Comptabilité ;
- le module Commercial (dont il reçoit les ventes pour le calcul des droits, §9.5) ;
- le module Rapports.

**Règle de blocage :** un ouvrage ne peut être envoyé en production que si le contrat d'édition requis est validé, sauf dérogation accordée par la Direction générale — dérogation motivée et tracée.

### 9.13 Objectif du module

Ce module garantit la sécurité juridique des activités d'Éclosion Édition. Il facilite le suivi des engagements contractuels, automatise les échéances importantes et le calcul des droits d'auteur, et assure une gestion transparente et traçable des opérations, au bénéfice de la maison comme des auteurs.


---


## Chapitre 10 : Module « Correction éditoriale et gestion des versions »

### 10.1 Objet du module

Le module « Correction éditoriale » permet d'organiser, suivre et documenter toutes les interventions réalisées sur un manuscrit avant sa mise en page. Il garantit la qualité linguistique, stylistique et éditoriale des ouvrages publiés par Éclosion Édition.

Le système assure également la **gestion de toutes les versions du manuscrit** afin de préserver un historique complet des modifications. Il couvre les étapes 7 (correction) et 9 (réécriture) du workflow (Chapitre 4).

### 10.2 Affectation des correcteurs

Le Directeur éditorial ou le chef de projet peut désigner un ou plusieurs correcteurs. Pour chaque mission, le système enregistre :
- le correcteur désigné ;
- la date d'affectation ;
- la date limite ;
- le niveau de priorité ;
- le statut de la mission.

### 10.3 Types de correction

Le module prend en charge plusieurs niveaux de correction, activables ou désactivables selon les besoins du projet :
- correction orthographique ;
- correction grammaticale ;
- correction typographique ;
- correction syntaxique ;
- correction stylistique ;
- harmonisation éditoriale ;
- vérification des références bibliographiques ;
- contrôle de la cohérence globale.

Les niveaux activés pour un projet sont définis lors de la planification (Chapitre 8, §8.4) et chacun constitue une tâche traçable.

### 10.4 Gestion des versions

À chaque dépôt d'un nouveau fichier, le système crée automatiquement une nouvelle version. Pour chaque version, sont enregistrés :
- le numéro de version (incrémenté automatiquement) ;
- la date de création ;
- le responsable ;
- les principales modifications (résumé saisi au dépôt) ;
- le statut : **brouillon / en révision / validée / archivée**.

**Aucune version n'est écrasée** : toutes restent consultables et peuvent être restaurées (règle générale de versionnage, Chapitre 4, §4.5).

### 10.5 Comparateur de versions

Le module intègre un **comparateur de versions**, fonctionnalité différenciante de l'ERP d'Éclosion Édition.

**Fonctionnalités :**
- Affichage **côte à côte de deux versions** quelconques d'un même manuscrit, au choix de l'utilisateur.
- Mise en évidence visuelle des **ajouts, suppressions et modifications** (code couleur distinct pour chaque type de changement).
- Navigation de changement en changement (précédent / suivant).
- Génération automatique d'un **rapport des changements** entre deux versions : nombre de modifications, liste des passages concernés, exportable en PDF et joignable au dossier.
- Filtrage possible par type de changement (ex. : n'afficher que les suppressions).

**Usages :**
- Le correcteur vérifie ce qui a été modifié depuis la version précédente.
- Le chef de projet contrôle qu'une demande de correction a bien été traitée.
- La Direction éditoriale audite les évolutions d'un ouvrage complexe comportant de nombreuses révisions.

*Point technique à préciser en phase de conception : la comparaison porte en priorité sur les formats texte structurés (Word/docx). La faisabilité sur d'autres formats (PDF maquetté) sera étudiée au chapitre technologies.*

### 10.6 Cycle de validation d'une version

Une version suit le cycle suivant :
1. Dépôt de la version.
2. Contrôle du chef de projet.
3. Validation ou demande de corrections complémentaires.
4. Transmission à l'étape suivante.

**Le système interdit la progression tant que la version n'est pas validée.**

### 10.7 Suivi des observations

Les correcteurs peuvent enregistrer :
- des commentaires ;
- des recommandations ;
- des points bloquants ;
- des demandes de clarification.

Chaque observation est **datée, signée et liée à la version concernée**. Les points bloquants empêchent la validation de la version tant qu'ils ne sont pas levés.

### 10.8 Tableau de bord des corrections

Le module affiche :
- les manuscrits en correction ;
- les corrections en retard ;
- les missions par correcteur ;
- les validations en attente ;
- les versions créées / validées.

### 10.9 Notifications

Le système notifie automatiquement :
- l'affectation d'une nouvelle mission ;
- l'approche d'une échéance ;
- le dépôt d'une nouvelle version ;
- la validation d'une version ;
- une demande de corrections supplémentaires.

### 10.10 Historique des modifications

L'application conserve un journal détaillé indiquant :
- qui a effectué une modification ;
- à quelle date ;
- sur quelle version ;
- avec quel commentaire.

Cette traçabilité facilite les audits internes et les retours en arrière si nécessaire.

### 10.11 Indicateurs de performance

Le système calcule notamment :
- le délai moyen de correction ;
- le nombre de versions par ouvrage ;
- le taux de validation au premier passage ;
- la charge de travail par correcteur ;
- le nombre de corrections en attente.

### 10.12 Intégration avec les autres modules

Le module est connecté à :
- la Direction éditoriale (Chapitre 8) ;
- la Mise en page ;
- l'Infographie ;
- le Contrôle qualité.

**Une fois la version finale validée, le manuscrit est automatiquement transféré vers le module de mise en page** (étape 10 du workflow).

### 10.13 Objectif du module

Le module « Correction éditoriale et gestion des versions » garantit la qualité des publications d'Éclosion Édition grâce à un processus structuré de révision, une gestion sécurisée des versions — renforcée par le comparateur — et une traçabilité complète de toutes les interventions réalisées avant la production finale.


---


## Chapitre 11 : Module « Maquette et mise en page »

### 11.1 Objet du module

Le module « Maquette et mise en page » organise la transformation du manuscrit corrigé et validé (Chapitre 10) en un livre composé, paginé et prêt pour l'impression. Il couvre l'étape 10 du workflow (Chapitre 4) et correspond au département Maquette et mise en page (Chapitre 3).

Il reçoit automatiquement la version finale validée du manuscrit depuis le module Correction (Chapitre 10, §10.12) et livre en sortie les fichiers destinés au contrôle qualité et au BAT (Chapitre 14).

### 11.2 Réception du manuscrit et ouverture de la mission

À la validation de la version finale corrigée, le système :
- transfère automatiquement le dossier au module Maquette ;
- notifie le maquettiste affecté (affectation faite en planification, Chapitre 8, §8.5) ;
- crée la mission de mise en page avec sa date limite issue du planning.

Pour chaque mission, le système enregistre : le maquettiste, la date d'affectation, la date limite, la priorité, le statut (à faire / en cours / en validation / validée).

### 11.3 Bibliothèque de gabarits

Le module gère une **bibliothèque de gabarits de composition** réutilisables :
- gabarits par collection (chaque collection d'Éclosion Édition possède sa maquette type : format, marges, police, interlignage) ;
- gabarits par type d'ouvrage (roman, essai, manuel scolaire, beau livre, jeunesse, poésie) ;
- possibilité de créer un gabarit spécifique pour un projet donné, puis de l'enregistrer dans la bibliothèque.

**Chaque gabarit précise :**
- le format du livre (dimensions fermées) ;
- les marges et l'empagement ;
- la ou les polices et leur hiérarchie ;
- les styles de paragraphes et de caractères ;
- le traitement des éléments spéciaux (citations, encadrés, notes de bas de page, légendes).

L'utilisation d'un gabarit garantit la cohérence visuelle d'une collection et accélère la composition.

### 11.4 Feuilles de styles

Pour chaque projet, le module documente la feuille de styles appliquée :
- styles de titres (niveaux 1 à n) ;
- corps de texte ;
- citations, exergues, notes ;
- listes et tableaux ;
- titres courants et folios.

Toute dérogation au gabarit de la collection est signalée et justifiée (traçabilité des choix graphiques).

### 11.5 Composition et pagination

Le module suit l'avancement de la composition :
- nombre de pages composées / total estimé ;
- traitement de la pagination (folios, belles pages, pages blanches) ;
- gestion des débuts de chapitres ;
- contrôle des veuves, orphelines et lignes creuses (points de vigilance signalés par le maquettiste) ;
- calcul automatique de l'écart entre le nombre de pages estimé (Chapitre 6) et le nombre réel — information transmise au module Impression pour l'établissement des devis (Chapitre 15) et au module Finance pour le coût de fabrication.

### 11.6 Éléments structurels du livre

Le module vérifie la présence et la conformité des éléments obligatoires, sous forme de **liste de contrôle** :
- pages de faux-titre et de titre ;
- page de copyright (mentions légales, ISBN — alimenté par le Chapitre 13, dépôt légal, crédits) ;
- table des matières (générée et vérifiée en cohérence avec la pagination réelle) ;
- préface, avant-propos, remerciements (si applicables) ;
- corps de l'ouvrage ;
- annexes, bibliographie, index (si applicables) ;
- achevé d'imprimer.

Un élément manquant bloque la validation de la mission tant qu'il n'est pas fourni ou explicitement déclaré « sans objet ».

### 11.7 Intégration des éléments graphiques

Le module coordonne l'insertion des éléments produits par l'Infographie (Chapitre 12) :
- illustrations intérieures, photos, graphiques, cartes ;
- vérification de la résolution (seuil minimal 300 dpi pour l'impression, paramétrable) ;
- vérification du mode colorimétrique (CMJN pour l'impression) ;
- légendes et crédits iconographiques ;
- liste des emplacements réservés en attente d'un visuel.

Un visuel non conforme (résolution insuffisante, mauvais mode colorimétrique) est signalé automatiquement au dépôt du fichier.

### 11.8 Versions de maquette et épreuves

Comme pour la correction, **chaque export de maquette crée une version** (épreuve 1, épreuve 2, etc.) :
- numéro d'épreuve, date, responsable, résumé des modifications ;
- les épreuves sont diffusées aux relecteurs désignés (relecture sur épreuves) ;
- les corrections d'épreuves sont consignées dans le module et rattachées à l'épreuve concernée ;
- le comparateur de versions (Chapitre 10, §10.5) est utilisable entre deux épreuves PDF pour vérifier que seules les corrections demandées ont été appliquées, selon la faisabilité technique étudiée au chapitre technologies.

### 11.9 Préparation du fichier d'impression

En fin de composition, le module encadre la production du **PDF prêt à imprimer** :
- export PDF aux normes d'impression (PDF/X, à confirmer avec les imprimeurs partenaires) ;
- polices incorporées ;
- fonds perdus et traits de coupe ;
- résolution des images vérifiée ;
- contrôle en amont (preflight) : le résultat du contrôle est joint au dossier.

Le fichier validé est transmis au module BAT et Contrôle qualité (Chapitre 14), accompagné de sa fiche technique (format, nombre de pages, couleurs).

### 11.10 Tableau de bord du module

- Missions de mise en page en cours / en retard ;
- épreuves en circulation et corrections en attente ;
- charge de travail par maquettiste ;
- délai moyen de composition par type d'ouvrage ;
- écarts pages estimées / pages réelles.

### 11.11 Notifications et alertes

- Réception d'un nouveau manuscrit à composer ;
- échéance proche ou dépassée ;
- visuel manquant ou non conforme ;
- épreuve déposée / corrections demandées / épreuve validée.

### 11.12 Intégration avec les autres modules

| Module | Échange |
|---|---|
| Correction (Ch. 10) | Reçoit la version finale validée du texte |
| Infographie (Ch. 12) | Reçoit couverture et visuels ; signale les emplacements en attente |
| ISBN et métadonnées (Ch. 13) | Reçoit l'ISBN et le code-barres pour la page de copyright et la couverture |
| BAT / Contrôle qualité (Ch. 14) | Livre le PDF prêt à imprimer et sa fiche technique |
| Impression (Ch. 15) | Transmet le nombre de pages réel pour les devis |
| Direction éditoriale (Ch. 8) | Remonte l'avancement au Gantt |

### 11.13 Objectif du module

Le module « Maquette et mise en page » garantit une composition professionnelle, cohérente avec l'identité graphique de chaque collection, et livre des fichiers d'impression fiables et contrôlés — condition d'un BAT sans surprise et d'une impression sans reprise coûteuse.


---


## Chapitre 12 : Module « Infographie et création des couvertures »

### 12.1 Objet du module

Le module « Infographie » organise la création de tous les éléments graphiques d'un ouvrage : couverture complète, illustrations intérieures et visuels de communication. Il couvre l'étape 11 du workflow (Chapitre 4) et correspond au département Infographie et design (Chapitre 3).

Il travaille **en parallèle du module Maquette** (Chapitre 11) : le passage au BAT exige la validation des deux (règle posée au Chapitre 4, étape 11).

### 12.2 Ouverture de la mission graphique

À la planification du projet (Chapitre 8), le système crée la ou les missions graphiques et notifie l'infographiste et/ou l'illustrateur affectés. Chaque mission enregistre : le responsable, la date d'affectation, la date limite, la priorité, le statut (à faire / en cours / en validation / validée).

Le brief créatif est joint à la mission : résumé de l'ouvrage, public visé, collection, contraintes de la charte graphique, références éventuelles fournies par la Direction éditoriale.

### 12.3 La couverture complète

Le module suit la création des quatre composantes de la couverture :

**1. Première de couverture**
- Titre, sous-titre, nom de l'auteur ;
- visuel principal (illustration, photo, composition typographique) ;
- logo d'Éclosion Édition et éventuel logo de collection.

**2. Quatrième de couverture**
- Texte de présentation (argumentaire) — rédigé par la Direction éditoriale, validé avant intégration ;
- biographie courte de l'auteur (avec photo éventuelle) ;
- **code-barres ISBN/EAN**, fourni automatiquement par le module ISBN et métadonnées (Chapitre 13) ;
- prix public (fourni par le module Commercial) ;
- mentions de collection.

**3. Dos (tranche)**
- Titre, auteur, logo ;
- **calcul automatique de l'épaisseur du dos** à partir du nombre de pages réel (transmis par le module Maquette, Chapitre 11, §11.5) et du grammage du papier (transmis par le module Impression, Chapitre 15). Toute modification du nombre de pages ou du papier déclenche une alerte de recalcul du dos — source d'erreur classique en fabrication.

**4. Rabats** (si applicable)
- Contenus éditoriaux ou promotionnels selon la collection.

### 12.4 Charte graphique et cohérence de collection

Le module gère une **bibliothèque de chartes graphiques** :
- charte générale d'Éclosion Édition (logos, couleurs, typographies institutionnelles) ;
- charte par collection (principes de couverture, gabarits, emplacements types) ;
- historique des couvertures publiées, consultable pour garantir la cohérence visuelle d'une collection.

Toute dérogation à la charte d'une collection est signalée et doit être validée par la Direction éditoriale.

### 12.5 Illustrations intérieures

Pour les ouvrages illustrés, le module gère :
- la liste des illustrations à produire (issue de la planification), avec pour chacune : description, emplacement prévu dans l'ouvrage, format, statut ;
- l'affectation à un illustrateur (interne ou externe — dans ce cas, lien avec le contrat d'illustration, Chapitre 9, §9.2) ;
- le dépôt des fichiers, versionnés ;
- le contrôle technique automatique au dépôt : résolution (≥ 300 dpi), mode colorimétrique (CMJN), format de fichier ;
- la gestion des **droits iconographiques** : pour chaque visuel, origine (création, banque d'images, photo fournie par l'auteur), licence, crédit à mentionner. Un visuel sans droits documentés bloque la validation — protection juridique essentielle.

### 12.6 Visuels marketing et de communication

Le module produit et centralise les déclinaisons promotionnelles :
- couverture en haute et basse définition (pour libraires, presse, site web) ;
- visuels pour réseaux sociaux (formats déclinés) ;
- affiches et marque-pages ;
- bandeaux promotionnels ;
- visuels pour salons et lancements.

Ces éléments sont mis à disposition du module Marketing et communication dans une **médiathèque par ouvrage**, avec les formats et résolutions adaptés à chaque usage.

### 12.7 Cycle de validation graphique

Chaque livrable graphique suit un circuit de validation :
1. Dépôt d'une proposition (versionnée : V1, V2...).
2. Revue par la Direction éditoriale (et la Direction générale pour la couverture, selon configuration).
3. Commentaires et demandes de modification, consignés et rattachés à la version.
4. Validation finale.

**La couverture validée est verrouillée** : toute modification ultérieure exige une dérogation motivée et tracée, et déclenche une alerte vers le BAT si celui-ci est déjà engagé.

*Point à trancher avec la direction : faut-il permettre de soumettre plusieurs propositions de couverture en parallèle (planches-concours) avec un vote ou un choix motivé ? Pratique courante et facile à outiller.*

### 12.8 Tableau de bord du module

- Missions graphiques en cours / en retard ;
- couvertures en attente de validation ;
- illustrations manquantes par ouvrage ;
- visuels sans droits documentés ;
- charge de travail par infographiste / illustrateur.

### 12.9 Notifications et alertes

- Nouvelle mission ou nouveau brief ;
- échéance proche ou dépassée ;
- proposition déposée / commentaires / validation ;
- alerte de recalcul du dos (§12.3) ;
- visuel non conforme techniquement ou sans droits.

### 12.10 Intégration avec les autres modules

| Module | Échange |
|---|---|
| Maquette (Ch. 11) | Fournit les illustrations intérieures ; reçoit le nombre de pages pour le dos |
| ISBN et métadonnées (Ch. 13) | Reçoit le code-barres EAN pour la quatrième de couverture |
| Impression (Ch. 15) | Reçoit le grammage papier (calcul du dos) ; livre le fichier de couverture prêt à imprimer |
| BAT / Contrôle qualité (Ch. 14) | Livre la couverture validée |
| Commercial (Ch. 17) | Reçoit le prix public à afficher ; fournit couvertures HD/BD aux canaux de vente |
| Marketing / Communication | Alimente la médiathèque promotionnelle |
| Juridique (Ch. 9) | Contrats d'illustration ; droits iconographiques |

### 12.11 Objectif du module

Le module « Infographie et création des couvertures » garantit des ouvrages à l'identité visuelle forte et cohérente, des fichiers techniquement irréprochables, et une sécurité juridique complète sur les visuels — tout en fournissant au commercial et à la communication les munitions graphiques du succès de chaque livre.


---


## Chapitre 13 : Module « ISBN, dépôt légal et métadonnées »

### 13.1 Objet du module

Le module « ISBN, dépôt légal et métadonnées » gère l'identité officielle et commerciale de chaque ouvrage : ses identifiants normalisés, ses obligations légales et l'ensemble des informations descriptives qui accompagneront le livre dans les circuits de diffusion. Il couvre l'étape 13 du workflow (Chapitre 4).

Un ouvrage sans identifiants complets ne peut pas passer à l'impression : ce module est un **point de passage obligé** entre la validation graphique et le BAT.

### 13.2 Gestion du stock d'ISBN

Éclosion Édition dispose de tranches d'ISBN attribuées par l'agence nationale (ou régionale) compétente. Le module gère ce stock comme une ressource :

- enregistrement des tranches reçues (préfixe éditeur, plage de numéros) ;
- suivi des ISBN : disponibles / réservés / attribués / publiés ;
- **alerte lorsque le stock d'ISBN disponibles passe sous un seuil paramétrable**, afin d'anticiper la demande d'une nouvelle tranche (délais administratifs parfois longs) ;
- historique complet : quel ISBN, attribué à quel ouvrage, à quelle date, par qui.

**Règle : un ISBN attribué n'est jamais réutilisé**, même si le projet est abandonné (conformité à la norme ISO 2108).

### 13.3 Attribution de l'ISBN

L'attribution suit un circuit contrôlé :
1. Demande d'attribution par la Direction éditoriale ou le Secrétariat éditorial.
2. Vérification automatique que l'ouvrage remplit les conditions (contrat validé, titre définitif).
3. Attribution du prochain ISBN disponible (ou choix manuel dans la liste des disponibles).
4. Calcul et vérification automatiques de la **clé de contrôle**.
5. Enregistrement dans le dossier de l'ouvrage et propagation automatique aux modules concernés (page de copyright — Chapitre 11 ; code-barres de couverture — Chapitre 12).

**Un ISBN distinct est attribué à chaque format** du même ouvrage : papier (et chaque format papier différent), numérique (EPUB, PDF), audio. Le module lie ces ISBN entre eux comme « manifestations » d'une même œuvre.

### 13.4 Génération du code-barres

Le module génère automatiquement le **code-barres EAN-13** à partir de l'ISBN :
- image vectorielle et haute résolution, aux normes des scanners de librairie ;
- transmission automatique au module Infographie pour intégration en quatrième de couverture (Chapitre 12, §12.3) ;
- régénération automatique en cas de changement d'ISBN (avec alerte à l'infographie si la couverture est déjà validée).

### 13.5 Dépôt légal

Le module organise le respect des obligations de dépôt légal selon la réglementation du pays :

- fiche de dépôt légal par ouvrage : organisme dépositaire (bibliothèque nationale ou équivalent), nombre d'exemplaires à déposer, date limite ;
- génération des documents de dépôt (formulaires, courriers d'accompagnement) ;
- suivi du statut : à préparer / déposé / accusé de réception reçu ;
- archivage de l'accusé de réception au dossier de l'ouvrage ;
- **le numéro de dépôt légal et sa mention réglementaire sont propagés à la page de copyright** (Chapitre 11, §11.6) et à l'achevé d'imprimer ;
- alertes sur les dépôts en retard.

*Point à préciser avec la direction : le ou les pays de référence pour le dépôt légal, car les règles (nombre d'exemplaires, délais, organisme) varient selon la législation nationale. Le module doit être paramétrable pour s'adapter à chaque pays — exigence directement liée à l'ambition de commercialisation régionale (Chapitre 0).*

### 13.6 Fiche de métadonnées de l'ouvrage

Le module centralise la **fiche descriptive complète** de chaque ouvrage, source unique pour tous les canaux :

**Identification** : ISBN(s), titre, sous-titre, auteur(s) et contributeurs (traducteur, illustrateur, préfacier) avec leurs rôles normalisés, collection, numéro dans la collection, éditeur, date de publication.

**Description physique** : format (dimensions), nombre de pages, type de reliure, poids (utile pour les frais d'expédition — transmis au module Commercial).

**Description commerciale** : résumé de présentation (argumentaire de la quatrième), biographie de l'auteur, prix public par pays/devise, public visé, tranche d'âge (jeunesse).

**Classification** : catégorie(s) thématique(s), mots-clés, langue de publication, langue d'origine (si traduction).

### 13.7 Classification thématique

Le module applique un ou plusieurs référentiels de classification :
- le référentiel interne d'Éclosion Édition (collections, domaines — cf. Chapitre 6) ;
- **le référentiel Thema** (norme internationale de classification commerciale du livre), recommandé pour l'interopérabilité avec les diffuseurs et libraires ;
- correspondance automatique entre les deux référentiels une fois le mappage configuré.

### 13.8 Export ONIX et diffusion des métadonnées

Pour alimenter les circuits professionnels (diffuseurs, distributeurs, librairies en ligne, bases bibliographiques), le module produit des **exports normalisés** :

- **export ONIX 3.0** (norme internationale d'échange de métadonnées du livre) : généré automatiquement depuis la fiche de métadonnées, par ouvrage ou par lot ;
- exports simplifiés CSV/Excel pour les partenaires n'utilisant pas ONIX ;
- suivi des envois : quel partenaire a reçu quelle version de la fiche, à quelle date ;
- **toute modification de la fiche (prix, résumé, date de parution) signale les partenaires à re-notifier**.

*L'usage effectif d'ONIX dépendra des partenaires de diffusion d'Éclosion Édition ; le module le prévoit dès la conception pour ne pas le retrofitter plus tard.*

### 13.9 Contrôle de complétude

Avant de libérer l'ouvrage vers le BAT (Chapitre 14), le module vérifie une **liste de contrôle bloquante** :
- ISBN attribué et clé valide ;
- code-barres généré et transmis à la couverture ;
- dépôt légal préparé (ou planifié selon la réglementation : avant ou après impression) ;
- fiche de métadonnées complète (champs obligatoires renseignés) ;
- classification affectée.

Tout élément manquant bloque la progression et génère une alerte au responsable.

### 13.10 Tableau de bord du module

- Stock d'ISBN disponibles (avec seuil d'alerte) ;
- ouvrages en attente d'attribution ;
- dépôts légaux à effectuer / en retard ;
- fiches de métadonnées incomplètes ;
- exports ONIX/CSV récents et partenaires à re-notifier.

### 13.11 Intégration avec les autres modules

| Module | Échange |
|---|---|
| Maquette (Ch. 11) | Fournit ISBN et n° de dépôt légal pour la page de copyright |
| Infographie (Ch. 12) | Fournit le code-barres EAN pour la quatrième de couverture |
| BAT (Ch. 14) | Contrôle de complétude bloquant avant BAT |
| Commercial (Ch. 17) | Fournit la fiche de métadonnées, le prix, le poids ; alimente les canaux de vente |
| Direction éditoriale (Ch. 8) | Demandes d'attribution, suivi au Gantt |

### 13.12 Objectif du module

Le module « ISBN, dépôt légal et métadonnées » donne à chaque ouvrage une identité officielle irréprochable et des métadonnées riches et normalisées — condition de sa visibilité dans les circuits de diffusion nationaux et internationaux, et de la conformité légale d'Éclosion Édition.


---


## Chapitre 14 : Module « BAT (Bon à tirer) et contrôle qualité »

### 14.1 Objet du module

Le module « BAT et contrôle qualité » organise la validation finale de l'ouvrage avant impression. Le Bon à tirer est **l'acte le plus engageant de la chaîne de fabrication** : une fois signé, l'ouvrage part à l'impression et toute erreur résiduelle sera imprimée à des centaines ou milliers d'exemplaires.

Il couvre l'étape 12 du workflow (validation du BAT) ainsi que l'étape 15 (contrôle qualité des exemplaires imprimés), et correspond au département Contrôle qualité (Chapitre 3).

### 14.2 Constitution du dossier de BAT

Le dossier de BAT est assemblé automatiquement lorsque toutes les conditions amont sont remplies :

- PDF intérieur prêt à imprimer, avec rapport de preflight (Maquette, Ch. 11, §11.9) ;
- fichier de couverture complet validé, dos calculé (Infographie, Ch. 12) ;
- contrôle de complétude ISBN / dépôt légal / métadonnées passé (Ch. 13, §13.9) ;
- fiche technique de fabrication : format, pagination, papier intérieur et couverture, façonnage, pelliculage, quantité prévue.

**Le système bloque l'ouverture du BAT tant qu'un de ces éléments manque** — c'est la convergence de toute la chaîne amont.

### 14.3 Liste de contrôle du BAT

Le module guide le contrôle à travers une **liste de vérification structurée**, chaque point étant coché par le contrôleur avec observations éventuelles :

**Intérieur**
- conformité de la mise en page au gabarit ;
- pagination et table des matières exactes ;
- présence et exactitude des mentions légales (ISBN, dépôt légal, copyright, achevé d'imprimer) ;
- qualité des images (résolution, colorimétrie) ;
- marges, fonds perdus, traits de coupe.

**Couverture**
- orthographe du titre, du nom de l'auteur (erreur classique et catastrophique) ;
- épaisseur du dos cohérente avec la pagination et le papier ;
- code-barres scannable et conforme à l'ISBN ;
- prix affiché conforme à la fiche commerciale ;
- couleurs et pelliculage conformes à la charte.

**Cohérence globale**
- correspondance intérieur/couverture (titre, auteur, collection) ;
- fiche technique complète pour l'imprimeur.

La liste est **paramétrable** : la direction peut ajouter des points de contrôle propres à ses collections.

### 14.4 Corrections de dernière minute

Si le contrôle révèle des anomalies :

1. Chaque anomalie est consignée : description, localisation (page), gravité (mineure / majeure / bloquante), capture d'écran éventuelle.
2. Le dossier est renvoyé au module concerné (Maquette ou Infographie) avec la liste des corrections — **retour tracé conformément au workflow** (Chapitre 4, étape 12 : « BAT à corriger »).
3. La correction produit une nouvelle version du fichier ; le comparateur de versions (Ch. 10, §10.5) permet de vérifier que **seules** les corrections demandées ont été appliquées — protection contre les régressions accidentelles.
4. Un nouveau cycle de contrôle est ouvert, limité aux points corrigés et aux points de cohérence impactés.

Le nombre d'allers-retours est suivi comme indicateur de qualité amont (§14.9).

### 14.5 Signature électronique du BAT

La validation finale prend la forme d'une **signature électronique du BAT** dans l'application :

- le ou les signataires habilités sont définis par la direction (typiquement : Directeur éditorial, et Direction générale au-delà d'un seuil de tirage ou de budget paramétrable) ;
- la signature enregistre : l'identité du signataire, la date et l'heure, **l'empreinte numérique (hash) des fichiers exacts approuvés** — garantissant que le fichier envoyé à l'imprimeur est bit à bit celui qui a été signé ;
- possibilité d'associer l'auteur à la validation (BAT auteur), selon les termes de son contrat : envoi d'une épreuve, recueil de son accord, tracé au dossier ;
- **après signature, les fichiers sont verrouillés**. Toute modification exige l'annulation formelle du BAT (motivée, tracée, notifiée à la direction) et un nouveau cycle de signature.

### 14.6 Autorisation d'impression

La signature du BAT déclenche automatiquement :
- le changement de statut de l'ouvrage (« BAT validé — bon pour impression ») ;
- la notification au module Impression (Ch. 15) avec transmission du dossier verrouillé (fichiers + fiche technique) ;
- l'inscription de la date de signature dans le calendrier du projet (référence pour les délais d'impression).

### 14.7 Contrôle qualité des exemplaires imprimés

À la réception des exemplaires (étape 15 du workflow), le module organise le second contrôle :

- prélèvement d'un échantillon (taille paramétrable selon le tirage) ;
- liste de vérification : conformité au BAT signé, qualité de la reliure et du façonnage, fidélité des couleurs, absence de défauts (pages manquantes, inversées, maculées), comptage des exemplaires reçus vs commandés ;
- verdict : **conforme / conforme avec réserves / non conforme** ;
- en cas de non-conformité : ouverture d'une **réclamation fournisseur** documentée (photos, quantités concernées, exigence de réimpression ou d'avoir), tracée jusqu'à sa résolution et rattachée à la fiche de l'imprimeur (Ch. 15) ;
- seuls les exemplaires acceptés sont transmis à l'entrée en stock (Ch. 16).

### 14.8 Tableau de bord du module

- BAT en attente de contrôle / en cours / en attente de signature ;
- anomalies ouvertes par gravité ;
- réceptions à contrôler ;
- réclamations fournisseurs en cours ;
- délai moyen de cycle de BAT.

### 14.9 Indicateurs de qualité

- Taux de BAT validés au premier passage (indicateur de qualité de la chaîne amont) ;
- nombre moyen d'allers-retours par ouvrage ;
- typologie des anomalies (mise en page, couverture, mentions légales...) — pour cibler les améliorations ;
- taux de non-conformité à la réception, par imprimeur — alimente l'évaluation des fournisseurs (Ch. 15).

### 14.10 Notifications et alertes

- Dossier de BAT complet, prêt au contrôle ;
- anomalies bloquantes détectées ;
- BAT en attente de signature (rappels) ;
- BAT signé (notification à l'impression) ;
- réception à contrôler ; non-conformité déclarée.

### 14.11 Intégration avec les autres modules

| Module | Échange |
|---|---|
| Maquette (Ch. 11) / Infographie (Ch. 12) | Reçoit les fichiers ; renvoie les demandes de correction |
| ISBN / métadonnées (Ch. 13) | Contrôle de complétude préalable |
| Impression (Ch. 15) | Transmet le dossier verrouillé après signature ; alimente l'évaluation fournisseurs |
| Stock (Ch. 16) | Libère les exemplaires acceptés vers l'entrée en stock |
| Direction générale (Ch. 5) | Alertes BAT en attente ; indicateurs qualité |

### 14.12 Objectif du module

Le module « BAT et contrôle qualité » constitue le verrou de sécurité de la fabrication : il garantit que rien ne part à l'impression sans validation formelle, traçable et complète, et que rien n'entre en stock sans contrôle — protégeant Éclosion Édition des erreurs coûteuses et de leurs conséquences commerciales et d'image.


---


## Chapitre 15 : Module « Impression et fabrication »

### 15.1 Objet du module

Le module « Impression » organise la relation avec les imprimeurs et le suivi de la fabrication physique des ouvrages, depuis la demande de devis jusqu'à la réception des exemplaires. Il couvre l'étape 14 du workflow (Chapitre 4) et correspond au département Impression (Chapitre 3).

Il reçoit en entrée le dossier verrouillé transmis après signature du BAT (Chapitre 14, §14.6) et livre en sortie les exemplaires contrôlés vers le stock (Chapitre 16).

### 15.2 Référentiel des imprimeurs

Le module gère un **fichier fournisseurs dédié aux imprimeurs** :

- fiche par imprimeur : coordonnées, contacts, spécialités (offset, numérique, grands formats), capacités (types de reliure, pelliculage, délais habituels), conditions commerciales et de paiement ;
- historique complet des commandes passées : ouvrages, quantités, prix, délais réels ;
- **évaluation continue du fournisseur**, alimentée automatiquement par les données du système :
  - respect des délais (dates promises vs dates réelles) ;
  - taux de non-conformité à la réception (issu du contrôle qualité, Ch. 14, §14.7 et §14.9) ;
  - compétitivité tarifaire (historique des devis) ;
  - réclamations ouvertes et leur résolution.

Cette évaluation objective outille les décisions d'attribution des commandes.

### 15.3 Demandes de devis

Pour chaque projet à imprimer, le module organise la consultation :

1. Génération automatique de la **fiche technique de consultation** à partir des données du dossier : format, pagination réelle (Ch. 11), papier intérieur et couverture, façonnage, pelliculage, quantité(s) envisagée(s) — avec possibilité de demander plusieurs hypothèses de tirage (ex. : 500 / 1 000 / 2 000 exemplaires) pour comparer les coûts unitaires.
2. Envoi de la consultation à un ou plusieurs imprimeurs sélectionnés.
3. Saisie des devis reçus : montant, délai proposé, validité de l'offre, conditions.
4. **Tableau comparatif automatique** des devis : coût total, coût unitaire par hypothèse de tirage, délai, notes d'évaluation du fournisseur.
5. Choix motivé de l'imprimeur, validé selon les seuils de délégation (un montant au-delà d'un seuil paramétrable requiert la validation de la Direction générale).

Tous les devis, retenus ou non, sont archivés au dossier (historique des prix du marché).

### 15.4 Bon de commande

Le devis retenu est transformé en **bon de commande** :

- numéro unique généré automatiquement ;
- reprise de la fiche technique et du prix convenu ;
- date de livraison contractuelle ;
- lieu de livraison (magasin, Ch. 16) ;
- conditions de paiement ;
- clauses qualité (référence au BAT signé, tolérances acceptées sur les quantités — usage professionnel : ± quelques % à préciser, sort des exemplaires non conformes).

Le bon de commande est validé selon le circuit de délégation, généré en PDF, transmis à l'imprimeur, et son montant est **engagé automatiquement dans le module Finance** (Ch. 18) au titre du coût de fabrication de l'ouvrage.

### 15.5 Transmission des fichiers

Le module trace la transmission des fichiers d'impression :
- fichiers transmis = fichiers verrouillés du BAT signé, vérifiés par leur empreinte numérique (Ch. 14, §14.5) ;
- date de transmission, mode (plateforme, lien sécurisé), accusé de réception de l'imprimeur ;
- épreuve contractuelle éventuelle demandée à l'imprimeur (plotter, épreuve calibrée) : réception, contrôle, validation tracés.

### 15.6 Suivi de fabrication

Pour chaque commande en cours, le module suit les jalons :

- fichiers reçus par l'imprimeur ;
- calage / lancement ;
- impression en cours ;
- façonnage ;
- expédition ;
- livraison.

Chaque jalon porte une date prévue et une date réelle ; les retards déclenchent des alertes (au responsable impression, et au Gantt du projet, Ch. 8). Les échanges avec l'imprimeur (demandes, incidents) sont consignés au dossier.

### 15.7 Réception

À la livraison :
- enregistrement de la réception : date, quantités livrées par référence, état apparent des colis ;
- rapprochement automatique **commande / livraison** : écart de quantité signalé (dans la tolérance contractuelle ou non) ;
- déclenchement du contrôle qualité des exemplaires (Ch. 14, §14.7) ;
- après verdict du contrôle : les exemplaires acceptés sont proposés à l'entrée en stock (Ch. 16) ; les non conformes suivent la procédure de réclamation (Ch. 14).

La réception conforme déclenche le rapprochement de la **facture fournisseur** dans le module Finance (contrôle facture / commande / réception — principe de rapprochement à trois volets, sécurité comptable de base).

### 15.8 Réimpressions

Le module gère les réimpressions comme un sous-cycle accéléré (Chapitre 4, étape 19) :
- déclenchement sur alerte de stock bas (Ch. 16) ou décision commerciale ;
- reprise du dossier technique existant (fichiers du dernier BAT signé) ;
- consultation simplifiée ou commande directe chez l'imprimeur habituel selon la politique définie ;
- mention de l'édition/tirage mise à jour à l'achevé d'imprimer — seule modification autorisée, tracée par un mini-BAT de réimpression.

### 15.9 Coûts de fabrication

Le module consolide, par ouvrage :
- coût d'impression (bon de commande + avenants éventuels) ;
- coûts annexes (épreuves, transport, douane le cas échéant) ;
- **coût unitaire de fabrication par exemplaire**, transmis au module Finance pour le calcul de la marge par ouvrage (Ch. 18) et exploité par le centre de pilotage intelligent (Ch. 5, §5.9 — ex. : dépassement du budget de fabrication).

### 15.10 Tableau de bord du module

- Consultations en cours / devis en attente ;
- commandes en fabrication, par jalon ;
- livraisons attendues cette semaine / en retard ;
- réclamations fournisseurs ouvertes ;
- évaluation synthétique des imprimeurs ;
- réimpressions en cours.

### 15.11 Notifications et alertes

- Dossier prêt pour consultation (BAT signé) ;
- devis reçu / consultation arrivant à échéance ;
- commande à valider (seuil de délégation) ;
- jalon de fabrication en retard ;
- livraison enregistrée / écart de quantité ;
- suggestion de réimpression (stock bas).

### 15.12 Intégration avec les autres modules

| Module | Échange |
|---|---|
| BAT (Ch. 14) | Reçoit le dossier verrouillé ; renvoie les réceptions au contrôle qualité |
| Maquette (Ch. 11) / Infographie (Ch. 12) | Fiche technique (pagination, couverture) ; grammage papier pour le dos |
| Stock (Ch. 16) | Entrée en stock des exemplaires acceptés ; alertes de stock bas pour réimpression |
| Finance (Ch. 18) | Engagement des commandes ; rapprochement facture/commande/réception ; coût unitaire |
| Direction générale (Ch. 5) | Indicateurs fabrication ; alertes budget |

### 15.13 Objectif du module

Le module « Impression et fabrication » professionnalise la relation avec les imprimeurs : consultations comparées, commandes engagées et tracées, fabrication suivie jalon par jalon, fournisseurs évalués objectivement — pour obtenir la meilleure qualité au meilleur coût, dans les délais, et connaître au centime le coût de fabrication de chaque ouvrage.


---


## Chapitre 16 : Module « Stock et magasin »

### 16.1 Objet du module

Le module « Stock et magasin » assure la gestion physique et comptable des exemplaires : entrées, sorties, emplacements, inventaires, alertes. Il couvre l'étape 16 du workflow (Chapitre 4), correspond au département Gestion des stocks (Chapitre 3), et constitue la charnière entre la fabrication (Ch. 15) et la vente (Ch. 17).

**Principe cardinal : le stock affiché par le système doit toujours refléter la réalité physique.** Toutes les règles du module en découlent.

### 16.2 Organisation des lieux de stockage

Le module gère un ou plusieurs lieux de stockage :
- magasin(s) principal(aux) d'Éclosion Édition ;
- dépôts secondaires éventuels ;
- **stocks en dépôt-vente chez les libraires** (exemplaires appartenant encore à l'éditeur mais physiquement chez un partenaire — pratique courante à suivre distinctement, cf. Ch. 17) ;
- emplacements internes : zone, allée, étagère (adressage paramétrable selon la taille du magasin).

Chaque exemplaire en stock est rattaché à un lieu et un emplacement.

### 16.3 Identification des articles

Chaque référence en stock correspond à un ouvrage dans un format donné, identifié par son ISBN (Ch. 13). Le module s'appuie sur les **codes-barres EAN** :
- lecture par douchette ou par l'appareil photo d'un smartphone (application web responsive, cf. Ch. 0, §0.5 — pas d'équipement coûteux requis) ;
- étiquetage des emplacements et des cartons ;
- toute opération (entrée, sortie, transfert, inventaire) peut être saisie par scan, réduisant drastiquement les erreurs de saisie.

Le suivi par **lot/tirage** est assuré : chaque entrée est rattachée à son tirage d'origine (1re impression, réimpression n), utile pour la traçabilité qualité et l'analyse des coûts.

### 16.4 Mouvements de stock

Tous les mouvements sont typés, horodatés et signés :

**Entrées**
- réception de fabrication (exemplaires acceptés par le contrôle qualité, Ch. 14/15) ;
- retours clients ou libraires (après contrôle de l'état : remis en stock vendable, ou déclassé) ;
- retours de dépôt-vente ;
- régularisations d'inventaire (justifiées).

**Sorties**
- ventes et livraisons (déclenchées par le module Commercial, Ch. 17) ;
- mises en dépôt-vente ;
- services de presse et exemplaires gratuits (justificatifs : destinataire, motif — presse, promotion, dépôt légal, auteur selon contrat) ;
- exemplaires d'auteur (quota contractuel, décompté automatiquement, cf. Ch. 9) ;
- mises au pilon (destruction d'invendus ou d'exemplaires déclassés — procédure validée par la direction, tracée, avec incidence comptable transmise au module Finance) ;
- régularisations d'inventaire.

**Transferts**
- entre lieux de stockage, avec statut « en transit » jusqu'à confirmation de réception.

**Aucun mouvement ne peut être saisi sans type, motif et responsable.** Chaque mouvement met à jour le stock en temps réel.

### 16.5 Niveaux de stock et alertes

Pour chaque référence, le module distingue :
- **stock physique** (présent en magasin) ;
- **stock réservé** (commandes en attente de préparation) ;
- **stock disponible à la vente** = physique − réservé ;
- **stock en dépôt-vente** (chez les partenaires) ;
- **stock en transit**.

Paramètres par référence :
- **seuil d'alerte** : en dessous, notification au responsable commercial et suggestion de réimpression (Ch. 15, §15.8) ;
- **seuil de rupture** : stock disponible nul — alerte critique, remontée au tableau de bord de la Direction générale (Ch. 5) et signalée aux canaux de vente (Ch. 17) ;
- le centre de pilotage intelligent (Ch. 5, §5.9) anticipe : « au rythme de vente actuel, le titre X atteindra le seuil d'alerte dans N jours ».

### 16.6 Préparation des commandes et expéditions

En lien avec le module Commercial (Ch. 17) :
- réception des ordres de préparation (commandes validées) ;
- **bon de préparation** (picking) : liste des références, quantités, emplacements — optimisée par ordre de rangement du magasin ;
- contrôle de préparation par scan (chaque exemplaire scanné est rapproché de la commande) ;
- **bon de livraison** généré et joint au colis ;
- enregistrement de l'expédition : transporteur, date, suivi éventuel ;
- confirmation de livraison (retour du bon signé ou validation du destinataire) clôturant le mouvement.

### 16.7 Gestion des retours

Procédure dédiée aux retours (usage important du commerce du livre) :
1. Annonce du retour (par le libraire/client via le commercial).
2. Réception physique et comptage.
3. **Contrôle de l'état exemplaire par exemplaire** : remis en stock vendable / déclassé (défraîchi) / pilon.
4. Rapprochement avec la facture ou le dépôt d'origine — transmission au module Finance pour avoir (Ch. 18) et **recalcul des droits d'auteur** (Ch. 9, §9.5 : les retours viennent en déduction).

### 16.8 Inventaires

Le module organise deux régimes d'inventaire :
- **inventaire complet périodique** (annuel a minima) : campagne préparée par le système (listes de comptage par emplacement, à l'aveugle — quantités théoriques masquées), double comptage en cas d'écart, validation des régularisations par la direction ;
- **inventaire tournant** : comptage régulier d'une fraction du stock (les références à forte rotation plus souvent), lissé sur l'année, moins perturbant pour l'activité.

Tout écart constaté est documenté (motif présumé : casse, vol, erreur de saisie) et régularisé par un mouvement tracé et validé. Le taux d'écart d'inventaire est un indicateur de fiabilité du magasin (§16.10).

### 16.9 Valorisation du stock

Le stock est valorisé au **coût unitaire de fabrication** (transmis par le module Impression, Ch. 15, §15.9), par lot/tirage :
- valeur totale du stock, par référence, collection, lieu ;
- dépréciation des invendus anciens (règles à définir avec le comptable : ancienneté, rotation) ;
- incidence comptable des pilons et écarts d'inventaire transmise au module Finance (Ch. 18).

### 16.10 Tableau de bord du module

- Stock disponible par référence / collection / lieu ;
- références sous seuil d'alerte, en rupture ;
- valeur totale du stock et rotation (jours de stock au rythme de vente actuel) ;
- commandes à préparer, expéditions du jour, retours en attente de contrôle ;
- écarts d'inventaire (taux de fiabilité) ;
- exemplaires immobilisés (invendus > N mois) — candidats aux opérations commerciales ou au pilon.

### 16.11 Notifications et alertes

- Entrée de fabrication à ranger ;
- seuil d'alerte / rupture atteints ;
- commande à préparer, retard d'expédition ;
- retour annoncé / à contrôler ;
- campagne d'inventaire planifiée ; écart à valider ;
- suggestion de réimpression ou de déstockage (pilotage intelligent).

### 16.12 Intégration avec les autres modules

| Module | Échange |
|---|---|
| Impression (Ch. 15) | Entrées de fabrication ; alertes de stock bas → réimpression |
| Commercial (Ch. 17) | Réservations, préparations, expéditions, retours ; disponibilité en temps réel |
| Finance (Ch. 18) | Valorisation du stock ; avoirs sur retours ; incidence des pilons et écarts |
| Juridique (Ch. 9) | Exemplaires d'auteur (quotas) ; retours → recalcul des droits |
| Direction générale (Ch. 5) | Ruptures, valeur du stock, prévisions du pilotage intelligent |

### 16.13 Objectif du module

Le module « Stock et magasin » garantit un stock exact, valorisé et traçable exemplaire par exemplaire, des expéditions fiables, et une anticipation des ruptures comme des surstocks — transformant le magasin d'un point aveugle en un maillon piloté de la chaîne du livre.


---


## Chapitre 17 : Module « Commercial, distribution et ventes »

### 17.1 Objet du module

Le module « Commercial » organise la mise en marché des ouvrages : référencement, canaux de vente, prise de commandes, facturation client, suivi des livraisons et des retours, et pilotage des performances commerciales. Il couvre les étapes 17 et 18 du workflow (Chapitre 4) et correspond aux départements Service commercial, Distribution et Librairie (Chapitre 3).

C'est le module qui **transforme les données en recettes** : chaque vente qu'il enregistre alimente automatiquement le stock (Ch. 16), la facturation (Ch. 18) et les droits d'auteur (Ch. 9, §9.5).

### 17.2 Mise en vente d'un ouvrage

À l'entrée en stock, le commercial prépare la mise en vente :

- **fiche commerciale** de l'ouvrage, alimentée automatiquement par la fiche de métadonnées (Ch. 13, §13.6) : titre, auteur, ISBN, résumé, couverture HD/BD (Ch. 12, §12.6), poids et format ;
- **prix public** par pays/devise, avec date d'effet ; tout changement de prix est historisé et propagé (métadonnées, quatrième de couverture pour les tirages futurs, canaux de vente) ;
- date de mise en vente (office) ;
- statut de disponibilité : à paraître / disponible / réimpression en cours / épuisé / retiré de la vente — synchronisé avec le stock (Ch. 16, §16.5) et diffusé aux partenaires via les exports (Ch. 13, §13.8).

*Point à trancher avec la direction : la réglementation applicable au prix du livre (prix unique ou prix libre selon les pays de vente) — elle conditionne la gestion des remises autorisées.*

### 17.3 Référentiel clients

Le module gère un fichier clients structuré par catégorie :
- **librairies** (indépendantes, chaînes) ;
- **distributeurs / diffuseurs** ;
- **institutions** (établissements scolaires, universités, bibliothèques, ministères, ONG — segment souvent décisif en Afrique : commandes groupées de manuels et d'ouvrages) ;
- **particuliers** (vente directe) ;
- **plateformes en ligne**.

Chaque fiche client comporte : coordonnées, contacts, conditions commerciales négociées (**taux de remise** par catégorie ou spécifique, conditions de paiement, plafond d'encours), mode de relation (ferme / dépôt-vente), historique complet des commandes, encours et retards de paiement (alimentés par Ch. 18).

### 17.4 Conditions commerciales et remises

- Grilles de remise par catégorie de client (ex. : libraires X %, distributeurs Y %, institutions Z %) ;
- remises spécifiques négociées par client, avec validité ;
- remises promotionnelles temporaires par opération (salons, rentrée scolaire), bornées dans le temps ;
- **toute remise hors grille exige une validation** selon les seuils de délégation, tracée avec son motif.

### 17.5 Prise de commande

Le module enregistre les commandes quelle qu'en soit l'origine (visite commerciale, téléphone, email, salon) :

1. Sélection du client → application automatique de ses conditions.
2. Saisie des lignes (référence, quantité) avec **contrôle de disponibilité en temps réel** (stock disponible, Ch. 16) ; les quantités commandées passent en stock réservé.
3. Calcul automatique : remises, taxes applicables, frais de port (selon poids, Ch. 13, et destination).
4. Contrôle de l'encours client : une commande qui dépasse le plafond d'encours ou concerne un client en retard de paiement est **bloquée en attente de validation** de la direction commerciale ou financière.
5. Confirmation → ordre de préparation transmis au magasin (Ch. 16, §16.6).

Devis et proforma peuvent précéder la commande (utile pour les marchés institutionnels), convertibles en commande en un clic.

### 17.6 Ventes fermes et dépôts-ventes

Le module distingue nativement les deux régimes :

**Vente ferme** : la livraison déclenche la facturation (Ch. 18) ; les retours éventuels donnent lieu à avoir selon les conditions convenues.

**Dépôt-vente** : les exemplaires livrés restent la propriété d'Éclosion Édition (stock « en dépôt-vente », Ch. 16, §16.5) ; le libraire adresse périodiquement un **relevé des ventes réalisées** (« noté »), saisi ou importé dans le module ; seules les ventes relevées sont facturées et génèrent des droits d'auteur ; les invendus sont retournés ou reconduits. Le module suit l'ancienneté des dépôts et relance les partenaires n'ayant pas transmis leur relevé.

### 17.7 Vente directe

Pour les ventes réalisées par Éclosion Édition elle-même (au siège, en ligne, sur salons) :
- interface de **vente au comptoir** simplifiée : scan du code-barres, encaissement, ticket/facture ;
- gestion des salons et événements : stock déporté (transfert, Ch. 16), ventes saisies sur place (mobile), rapprochement au retour ;
- modes d'encaissement paramétrables : espèces, carte, **paiement mobile (mobile money)** — indispensable dans le contexte régional (Ch. 0) ; chaque encaissement est transmis au module Finance.

### 17.8 Livraisons et suivi

- Suivi de chaque commande : enregistrée → validée → en préparation → expédiée → livrée → facturée ;
- rapprochement automatique avec les bons de livraison du magasin (Ch. 16, §16.6) ;
- gestion des reliquats (livraisons partielles) avec information du client ;
- retards de livraison signalés au commercial et visibles du pilotage (Ch. 5).

### 17.9 Retours clients

En miroir de la procédure magasin (Ch. 16, §16.7) :
- autorisation de retour préalable (selon conditions du client) ;
- rapprochement du retour avec les factures d'origine ;
- génération de l'**avoir** (Ch. 18) et recalcul des droits d'auteur (Ch. 9, §9.5) ;
- suivi du **taux de retour par client et par titre** — indicateur clé : un taux anormal révèle un problème de placement ou de mise en marché.

### 17.10 Analyse des ventes

Le module produit les analyses commerciales :
- ventes par titre, collection, auteur, catégorie de client, canal, zone géographique, période ;
- palmarès des meilleures ventes ; titres sans vente depuis N mois ;
- vitesse d'écoulement par titre (alimente les prévisions de rupture du pilotage intelligent, Ch. 5/16) ;
- comparaisons entre périodes (N vs N-1) ;
- **taux de couverture des coûts** : croisement ventes / coût de fabrication (Ch. 15) et à-valoir (Ch. 9) pour situer chaque titre par rapport à son point d'équilibre — l'information décisive pour réimprimer, promouvoir ou arrêter.

### 17.11 Tableau de bord du module

- Chiffre d'affaires du jour / mois / année, vs objectifs ;
- commandes en cours par statut ; commandes bloquées (encours) ;
- meilleures ventes de la période ; ruptures pénalisantes (titres demandés indisponibles) ;
- dépôts-ventes : relevés en attente, ancienneté ;
- taux de retour ; encours clients à risque.

### 17.12 Notifications et alertes

- Nouvel ouvrage disponible à la vente ;
- commande bloquée à valider ;
- rupture sur un titre à forte demande ;
- relevé de dépôt-vente en retard ;
- client dépassant son plafond d'encours ;
- objectif commercial atteint / en risque.

### 17.13 Intégration avec les autres modules

| Module | Échange |
|---|---|
| Stock (Ch. 16) | Disponibilité temps réel, réservations, préparations, retours |
| Finance (Ch. 18) | Facturation, avoirs, encaissements, encours clients |
| Juridique (Ch. 9) | Chaque vente/retour alimente le calcul des droits d'auteur |
| ISBN/métadonnées (Ch. 13) | Fiche commerciale ; diffusion de la disponibilité aux partenaires |
| Infographie (Ch. 12) | Visuels HD/BD pour les canaux et les libraires |
| Direction générale (Ch. 5) | CA, meilleures ventes, alertes commerciales |

### 17.14 Objectif du module

Le module « Commercial, distribution et ventes » donne à Éclosion Édition une force de vente outillée : conditions maîtrisées, commandes fiables, dépôts-ventes enfin suivis, encours sous contrôle et analyses permettant de savoir, titre par titre, où se gagne et où se perd l'argent de la maison.


---


## Chapitre 18 : Module « Finance et comptabilité »

### 18.1 Objet du module

Le module « Finance et comptabilité » centralise la dimension économique de toute l'activité : facturation, encaissements et paiements, dépenses, coûts de production, marges par ouvrage, droits d'auteur à payer et états financiers. Il correspond au département Administration et finances (Chapitre 3).

Il applique strictement le principe « une donnée saisie une seule fois » (Ch. 0, §0.3) : **les commandes, ventes, retours et réceptions saisis dans les autres modules génèrent automatiquement leurs écritures financières** ; le module Finance contrôle, complète et consolide, il ne ressaisit pas.

*Point à trancher avec la direction : ce module tient-il la comptabilité générale complète, ou prépare-t-il les données pour un logiciel comptable externe (ou un cabinet) via des exports normalisés ? Le présent chapitre couvre la gestion financière opérationnelle dans tous les cas ; la comptabilité générale est traitée en §18.10 selon l'option retenue.*

### 18.2 Facturation clients

- **Génération automatique des factures** à partir des livraisons (ventes fermes) ou des relevés de dépôt-vente (Ch. 17, §17.6) ;
- numérotation chronologique continue et infalsifiable (exigence légale) ;
- mentions obligatoires paramétrées selon la réglementation du pays (identification fiscale, taxes) ;
- factures proforma pour les marchés institutionnels ;
- **avoirs** générés depuis les retours validés (Ch. 17, §17.9), rattachés aux factures d'origine ;
- envoi PDF par email tracé ; réédition à l'identique possible, jamais de modification d'une facture émise (correction = avoir + nouvelle facture).

### 18.3 Encaissements et suivi des créances clients

- Enregistrement des règlements : virement, chèque, espèces, **paiement mobile** (Ch. 17, §17.7) ;
- lettrage des règlements avec les factures (total, partiel, acompte) ;
- **balance âgée clients** : créances par ancienneté (non échu, 30, 60, 90+ jours) ;
- relances automatisées et graduées (rappel courtois → mise en demeure), tracées au dossier client ;
- encours client temps réel, alimentant le blocage des commandes (Ch. 17, §17.5) ;
- provisionnement des créances douteuses (règles à définir avec le comptable).

### 18.4 Dépenses et fournisseurs

- Engagement automatique des bons de commande d'impression (Ch. 15, §15.4) et saisie des autres dépenses (loyers, salaires en lien avec Ch. 19, prestations, transport, communication) ;
- **rapprochement à trois volets** facture fournisseur / commande / réception (Ch. 15, §15.7) avant mise en paiement — aucune facture fournisseur n'est payée sans ce contrôle lorsqu'une commande existe ;
- circuit de validation des dépenses selon les seuils de délégation ;
- échéancier des paiements fournisseurs ; balance âgée fournisseurs.

### 18.5 Comptabilité analytique par ouvrage

Cœur économique de l'ERP éditorial : **chaque ouvrage est un centre de coûts et de recettes**.

**Coûts imputés par ouvrage :**
- à-valoir et droits d'auteur (Ch. 9) ;
- prestations éditoriales externes (correction, traduction, illustration — via leurs contrats, Ch. 9) ;
- fabrication (Ch. 15, §15.9) ;
- part des coûts de promotion directement affectables ;
- clé de répartition paramétrable pour les frais généraux (optionnelle).

**Recettes par ouvrage :**
- ventes nettes (ventes − retours − remises), par canal (Ch. 17) ;
- cessions de droits éventuelles (Ch. 9).

**Résultats calculés automatiquement :**
- coût de revient complet et coût unitaire ;
- **marge par ouvrage** (brute et après droits d'auteur) ;
- **point d'équilibre en exemplaires** et taux de couverture atteint (affiché aussi au commercial, Ch. 17, §17.10) ;
- rentabilité par collection, par auteur, par genre — la mémoire économique qui affine la ligne éditoriale (Ch. 0, §0.4).

### 18.6 Budgets et contrôle budgétaire

- Budget prévisionnel par ouvrage établi à la mise en production (Ch. 8) : coûts prévus par poste, recettes espérées ;
- budgets annuels par département ;
- suivi engagé/réalisé vs budget, avec **alerte de dépassement** exploitée par le pilotage intelligent (Ch. 5, §5.9 : « le coût de production de cet ouvrage dépasse le budget prévu de 15 % ») ;
- toute révision budgétaire est motivée et tracée.

### 18.7 Droits d'auteur — exécution financière

En aval du moteur de calcul (Ch. 9, §9.5), le module Finance exécute :
- provisionnement continu des droits générés par les ventes ;
- génération des ordres de paiement aux échéances contractuelles ;
- gestion des retenues fiscales applicables aux droits d'auteur selon la législation ;
- historique complet des paiements par auteur, rapproché de ses relevés.

### 18.8 Trésorerie

- Position de trésorerie par compte (banques, caisse, comptes de paiement mobile) ;
- rapprochement bancaire assisté (import des relevés, pointage) ;
- **plan de trésorerie prévisionnel** : encaissements attendus (balance clients, échéances de marchés institutionnels) vs décaissements prévus (fournisseurs, droits d'auteur, charges) — l'outil de survie de toute maison d'édition, où les cycles d'encaissement sont longs ;
- alertes sur les points bas prévisionnels.

### 18.9 Taxes

- Paramétrage des taxes applicables (TVA ou équivalent, taux par type de produit — le livre bénéficie souvent de taux réduits ou d'exonérations selon les pays) ;
- calcul automatique sur ventes et achats ;
- états préparatoires aux déclarations périodiques.

*La configuration fiscale est par pays — exigence de paramétrabilité liée à l'ambition régionale (Ch. 0, §0.5).*

### 18.10 Comptabilité générale ou exports comptables

Selon l'option retenue (§18.1) :

**Option A — comptabilité intégrée** : plan comptable paramétrable (conforme au référentiel national, ex. SYSCOHADA dans l'espace OHADA), écritures générées automatiquement depuis les opérations, journaux, grand livre, balance, préparation des états annuels.

**Option B — exports vers un système comptable externe** : génération périodique d'écritures normalisées (format d'import du logiciel cible ou du cabinet), avec journal de correspondance et contrôle d'exhaustivité (toute opération de l'ERP se retrouve dans l'export, une seule fois).

Dans les deux cas, la piste d'audit est garantie : de tout montant d'un état financier, on peut remonter aux opérations d'origine dans l'ERP.

### 18.11 Sécurité et séparation des tâches

- Accès strictement limité aux profils habilités (Ch. 2 et Ch. 9, §9.11) ; consultations journalisées ;
- **séparation des tâches** paramétrable : celui qui saisit une dépense ne peut pas la valider seul ; celui qui valide un paiement n'est pas celui qui l'a engagé (selon la taille de l'équipe, la direction ajuste ces règles) ;
- clôtures périodiques : une période clôturée n'accepte plus d'écriture (correction = écriture sur période ouverte, tracée).

### 18.12 Tableau de bord du module

- Trésorerie du jour et prévisionnelle ;
- CA facturé, encaissé ; créances par ancienneté ; top des retards clients ;
- dépenses engagées vs budget ; factures fournisseurs à échéance ;
- droits d'auteur provisionnés / à payer ;
- marges par ouvrage / collection ; titres sous leur point d'équilibre.

### 18.13 Intégration avec les autres modules

| Module | Échange |
|---|---|
| Commercial (Ch. 17) | Factures, avoirs, encaissements, encours et blocages clients |
| Impression (Ch. 15) | Engagements, rapprochement trois volets, coûts de fabrication |
| Juridique (Ch. 9) | À-valoir, calcul des droits ; exécution des paiements auteurs |
| Stock (Ch. 16) | Valorisation, incidence des pilons et écarts d'inventaire |
| RH (Ch. 19) | Charges de personnel (selon périmètre retenu) |
| Direction générale (Ch. 5) | Indicateurs financiers, alertes budget et trésorerie |

### 18.14 Objectif du module

Le module « Finance et comptabilité » fait de chaque chiffre une information fiable et traçable : la maison connaît en permanence sa trésorerie, ses créances, ses coûts réels et **la rentabilité exacte de chaque ouvrage** — le fondement des décisions éditoriales et commerciales éclairées que promet l'ERP.


---


## Chapitre 19 : Module « Ressources humaines »

### 19.1 Objet du module

Le module « Ressources humaines » gère les personnes qui font fonctionner Éclosion Édition : collaborateurs internes et intervenants externes réguliers (correcteurs freelances, illustrateurs, lecteurs du comité). Il administre les dossiers du personnel, les comptes utilisateurs et leurs droits, la charge de travail et les absences, et prépare les éléments de paie.

Il correspond au département Ressources humaines (Chapitre 3) et opère en binôme avec la gestion des utilisateurs définie au Chapitre 2 : **le dossier RH est la source, le compte utilisateur en est la conséquence**.

### 19.2 Dossier du collaborateur

Chaque personne dispose d'un dossier individuel :

- état civil et coordonnées ;
- **statut : salarié / prestataire externe / stagiaire / bénévole** — le statut conditionne les rubriques actives du dossier ;
- poste, département de rattachement (Ch. 3), responsable hiérarchique ;
- contrat de travail ou contrat de prestation (pour les externes, lien direct avec les contrats du Ch. 9 : correction, illustration...) : type, dates, durée, renouvellements ;
- pièces du dossier (contrats signés, diplômes, pièces d'identité), versionnées et confidentielles ;
- historique de carrière dans la maison : postes occupés, évolutions.

**Confidentialité maximale** : les dossiers RH ne sont accessibles qu'au responsable RH, à la Direction générale et à l'administrateur système ; chaque consultation est journalisée (même exigence que pour le juridique, Ch. 9, §9.11).

### 19.3 Cycle de vie administratif et comptes utilisateurs

Le module orchestre les mouvements de personnel et leurs conséquences applicatives, en application directe du Chapitre 2 (§2.4) :

**Arrivée** : création du dossier → génération du compte utilisateur avec le rôle correspondant au poste → notification au responsable pour l'accueil.

**Mobilité interne** : changement de poste/département → mise à jour automatique du rôle et des accès, effective à la date du mouvement.

**Suspension** (congé longue durée, procédure) : gel du compte sans perte de données.

**Départ** : clôture du dossier → **désactivation automatique du compte à la date de départ** (aucun compte orphelin actif — faille de sécurité classique), conservation de l'historique des actions à des fins d'audit, liste de restitution (matériel, documents).

### 19.4 Gestion des rôles et des habilitations

En lien avec le Chapitre 2 :
- attribution et retrait des rôles, avec justification tracée ;
- **revue périodique des habilitations** : campagne (semestrielle par exemple) où chaque responsable confirme que les accès de son équipe correspondent toujours aux fonctions réelles — exigence d'audit interne ;
- détection des anomalies : compte actif sans dossier RH actif, cumuls de rôles contraires à la séparation des tâches (Ch. 18, §18.11).

### 19.5 Temps, absences et disponibilité

- Calendrier des présences : congés, absences, missions, télétravail le cas échéant ;
- circuit de demande et validation des congés (demandeur → responsable), avec soldes tenus à jour ;
- **la disponibilité alimente la planification** : le Gantt (Ch. 8, §8.7) et l'affectation des missions (correction, maquette, infographie) tiennent compte des absences ; l'indice de priorité éditoriale (Ch. 6, §6.5) intègre la disponibilité des équipes ;
- jours fériés et calendriers paramétrables par pays (Ch. 0, ambition régionale).

### 19.6 Charge de travail et performance

Le module consolide les données d'activité **déjà produites par les autres modules** (aucune saisie supplémentaire) :
- missions en cours et terminées par personne (corrections, maquettes, lectures, contrôles...) ;
- délais tenus vs dépassés ;
- volumes traités (manuscrits lus, pages corrigées, couvertures produites) ;
- charge prévisionnelle (missions affectées à venir).

**Usage et limites** : ces indicateurs servent à équilibrer la charge, objectiver les entretiens et dimensionner les recrutements. La direction veillera à un usage loyal et transparent — les indicateurs mesurent une activité outillée, pas la valeur d'une personne ; les objectifs et leur interprétation restent du ressort du management (principe « l'humain décide », Ch. 0, §0.7).

*Point à trancher avec la direction : formaliser ou non des entretiens périodiques d'évaluation dans l'outil (grilles, objectifs, comptes rendus signés).*

### 19.7 Rémunérations et préparation de la paie

Selon le périmètre retenu (cohérent avec l'option comptable du Ch. 18, §18.1) :
- éléments contractuels de rémunération (confidentiels, accès restreint) ;
- **préparation des variables de paie** : présences/absences, primes validées, missions de prestataires à régler ;
- export vers le prestataire ou le logiciel de paie ; ou saisie du net à payer pour exécution par le module Finance (Ch. 18, §18.4) ;
- pour les externes : rapprochement automatique entre missions terminées/validées et factures de prestation à payer.

*La paie complète (bulletins, déclarations sociales) est par défaut hors périmètre de l'ERP — à confirmer.*

### 19.8 Formation et compétences

- Cartographie simple des compétences (langues de correction, logiciels maîtrisés, genres éditoriaux) — exploitée lors des affectations (trouver le correcteur compétent disponible) ;
- suivi des formations : demandes, validations, réalisations, coûts (transmis au budget, Ch. 18, §18.6) ;
- habilitations internes (qui est formé à valider un BAT, à tenir la caisse des salons...).

### 19.9 Tableau de bord du module

- Effectif par département et par statut ; arrivées/départs de la période ;
- absences du jour et de la semaine ; soldes de congés à risque ;
- charge par personne et par département (surcharge/sous-charge) ;
- comptes utilisateurs : actifs, suspendus, anomalies détectées (§19.4) ;
- contrats (travail et prestation) arrivant à échéance ;
- variables de paie prêtes / en attente.

### 19.10 Notifications et alertes

- Demande de congé à valider ; retour d'absence ;
- contrat arrivant à échéance (travail ou prestation) ;
- compte à désactiver (départ) ; anomalie d'habilitation ;
- campagne de revue des accès à lancer ;
- surcharge détectée sur une personne ou un service.

### 19.11 Intégration avec les autres modules

| Module | Échange |
|---|---|
| Gestion des utilisateurs (Ch. 2) | Création, modification, désactivation des comptes et rôles |
| Direction éditoriale (Ch. 8) | Disponibilités et compétences pour l'affectation ; charge au Gantt |
| Juridique (Ch. 9) | Contrats de prestation des intervenants externes |
| Finance (Ch. 18) | Variables de paie, paiements de prestations, budget formation |
| Direction générale (Ch. 5) | Effectifs, charge, alertes RH |

### 19.12 Objectif du module

Le module « Ressources humaines » garantit que la bonne personne, avec les bons droits et la bonne charge de travail, est au bon endroit de la chaîne éditoriale — et que chaque mouvement de personnel se traduit immédiatement et automatiquement dans la sécurité du système.


---


## Chapitre 20 : Module « Rapports, statistiques et intelligence décisionnelle »

### 20.1 Objet du module

Le module « Rapports, statistiques et intelligence décisionnelle » est la couche d'analyse transverse de l'ERP. Là où chaque module opérationnel produit ses indicateurs (chapitres 5 à 19), ce module **croise les données de toute la maison** pour répondre aux questions qui dépassent un département : quels genres sont rentables ? Quels délais s'allongent d'année en année ? Quels auteurs construisent le fonds de la maison ?

Il prolonge le tableau de bord de la Direction générale (Ch. 5) et le centre de pilotage intelligent (Ch. 5, §5.9) en leur donnant la profondeur historique et la capacité d'exploration.

### 20.2 Principes

- **Une seule source de vérité** : tous les rapports puisent dans les données opérationnelles de l'ERP ; aucun chiffre n'est ressaisi (Ch. 0, §0.3, principe 5). Un même indicateur a la même définition et la même valeur partout.
- **Dictionnaire des indicateurs** : chaque indicateur diffusé (CA net, marge, délai de production, taux de retour...) possède une définition écrite et une formule de calcul documentée, consultable depuis le rapport — condition de la confiance dans les chiffres.
- **Respect des droits** : un rapport n'expose jamais à un utilisateur des données que son rôle ne lui permet pas de voir (Ch. 2) ; les rapports financiers suivent les restrictions du Ch. 18.
- **Historisation** : les données sont conservées sans limite de durée ; les analyses pluriannuelles sont un objectif explicite (Ch. 0, §0.4, capitalisation du savoir éditorial).

### 20.3 Bibliothèque de rapports standards

Le module livre une bibliothèque de rapports prêts à l'emploi, organisée par domaine :

**Éditorial**
- Flux des manuscrits : reçus, acceptés, refusés, taux par genre et par période ;
- délais par étape du workflow (lecture, correction, maquette, BAT...) et leur évolution ;
- analyse des scores du comité de lecture (Ch. 7, §7.5) : distribution, écarts entre lecteurs, corrélation score initial / devenir commercial du titre.

**Production**
- Durée moyenne de production par type d'ouvrage ; goulots d'étranglement récurrents ;
- taux de BAT validés au premier passage, typologie des anomalies (Ch. 14, §14.9) ;
- performance des imprimeurs (Ch. 15, §15.2).

**Commercial**
- Ventes par titre, collection, auteur, canal, client, zone, période ; palmarès et queues de catalogue ;
- taux de retour par client et par titre ; performance des dépôts-ventes ;
- cycle de vie des titres : courbe des ventes depuis la parution (nouveauté vs fonds).

**Financier**
- Marges par ouvrage/collection/genre ; titres sous leur point d'équilibre (Ch. 18, §18.5) ;
- balance âgée, encours, trésorerie réalisée vs prévisionnelle ;
- droits d'auteur générés et payés, par auteur et par période.

**RH et activité**
- Charge par département et par personne ; délais tenus ;
- coûts de production internes vs externalisés.

Chaque rapport standard est filtrable (période, collection, département...), exportable en **PDF et Excel** (Ch. 5, §5.7), et peut être **programmé** : génération et envoi automatiques aux destinataires désignés (ex. : rapport commercial hebdomadaire chaque lundi matin).

### 20.4 Explorateur d'analyses (rapports personnalisés)

Au-delà des rapports standards, les utilisateurs habilités disposent d'un **explorateur** :
- choix des indicateurs et des axes d'analyse (période, collection, genre, auteur, client, canal, département...) ;
- tableaux croisés et graphiques (courbes, barres, répartitions) ;
- enregistrement des analyses personnelles, partage avec d'autres utilisateurs (dans le respect de leurs droits) ;
- promotion d'une analyse personnelle en rapport standard par l'administrateur.

L'explorateur couvre le besoin sans attendre un développement : c'est la réponse aux questions imprévues de la direction.

### 20.5 Analyses pluriannuelles et mémoire de la maison

Le module exploite la profondeur historique pour éclairer la stratégie :
- évolution sur plusieurs années : volume de soumissions, taux d'acceptation, délais, coûts de fabrication, prix moyens, ventes par genre ;
- **analyse du catalogue** : répartition du fonds, contribution des nouveautés vs du fonds au CA, titres à réimprimer/ressusciter/abandonner ;
- **fiche auteur consolidée** : tous les titres d'un auteur, leurs ventes, leurs droits, leur rentabilité — support des décisions de fidélisation ;
- saisonnalité des ventes (rentrées scolaire et littéraire, fêtes) pour caler les parutions et les stocks.

### 20.6 Intelligence décisionnelle

Prolongement analytique du centre de pilotage intelligent (Ch. 5, §5.9), avec la même philosophie : **le système éclaire, l'humain décide** (Ch. 0, §0.7).

**Détections et projections (à base de règles configurables) :**
- projection de rupture de stock au rythme de vente courant (Ch. 16) ;
- dérive des délais d'une étape par rapport à son historique ;
- dépassement budgétaire en cours de production (Ch. 18, §18.6) ;
- titre approchant son point d'équilibre (signal de réimpression ou de promotion) ;
- client dont le comportement de paiement se dégrade.

**Aides à la décision documentées :**
- **simulation de tirage** : pour une réimpression envisagée, croiser devis (Ch. 15), rythme de vente et stock pour comparer des hypothèses de quantité ;
- **pré-bilan prévisionnel d'un projet** : avant acceptation d'un manuscrit, esquisse économique à partir des coûts types de sa catégorie et des ventes moyennes du genre — jointe au dossier de décision éditoriale (Ch. 8, §8.2).

Chaque recommandation reste traçable (données sources consultables) et son traitement est historisé (Ch. 5, §5.9).

*Des capacités prédictives plus avancées (modèles statistiques ou d'apprentissage) pourront être étudiées ultérieurement, une fois deux à trois années de données accumulées ; le présent cahier des charges n'en fait pas une exigence initiale.*

### 20.7 Diffusion et gouvernance des rapports

- Catalogue des rapports avec propriétaire, description, destinataires, fréquence ;
- traçabilité des générations et des envois (qui a reçu quoi, quand) ;
- revue périodique du catalogue : suppression des rapports non consultés, mise à jour des définitions (le dictionnaire des indicateurs, §20.2, est versionné).

### 20.8 Tableau de bord du module

- Rapports programmés du jour / de la semaine et leur statut d'envoi ;
- analyses les plus consultées ;
- recommandations d'intelligence décisionnelle ouvertes, par priorité ;
- indicateurs en anomalie de définition ou de calcul (contrôles de cohérence).

### 20.9 Intégration avec les autres modules

Ce module lit les données de **tous** les modules (Ch. 5 à 19) et n'écrit dans aucun — à l'exception de la journalisation de ses propres générations et envois. Il alimente en retour :

| Destinataire | Apport |
|---|---|
| Direction générale (Ch. 5) | Rapports périodiques, analyses pluriannuelles, recommandations |
| Direction éditoriale (Ch. 8) | Pré-bilans prévisionnels, analyses de délais et de scores |
| Commercial (Ch. 17) | Analyses de ventes, cycle de vie des titres, saisonnalité |
| Finance (Ch. 18) | États périodiques, analyses de marge et de trésorerie |
| Impression (Ch. 15) | Simulations de tirage, performance fournisseurs |

### 20.10 Objectif du module

Le module « Rapports, statistiques et intelligence décisionnelle » transforme les données accumulées par l'ERP en savoir stratégique : il donne à Éclosion Édition la mémoire de son activité, des chiffres dignes de confiance et des analyses qui éclairent chaque grande décision — publier, tirer, promouvoir, fidéliser — aujourd'hui pour la maison, demain comme argument phare de l'ERP commercialisé (Ch. 0).


---


## Chapitre 21 : Architecture technique et technologies

### 21.1 Objet du chapitre

Ce chapitre traduit en exigences techniques les principes du Chapitre 0 et les besoins fonctionnels des chapitres 1 à 20. Il fixe des **exigences et des orientations**, non des choix de produits définitifs : les technologies précises (langages, frameworks, hébergeur) seront arrêtées avec l'équipe de développement, à condition de satisfaire les exigences ci-dessous.

### 21.2 Architecture générale

- **Application web** accessible par navigateur, sans installation sur les postes ;
- **responsive** : utilisable sur ordinateur, tablette et smartphone — le magasin (scan par smartphone, Ch. 16, §16.3), les salons (vente mobile, Ch. 17, §17.7) et la direction en déplacement l'exigent ;
- **architecture modulaire** : chaque module (Ch. 5 à 20) est activable/désactivable par configuration, sans toucher au code — condition de la commercialisation à des structures plus petites (Ch. 0, §0.5) ;
- séparation claire entre interface, logique métier et données, pour permettre les évolutions (Phase 8 du plan projet) ;
- **API interne documentée** : toutes les fonctions passent par une API, ce qui prépare les intégrations futures (site de vente en ligne, applications partenaires, import ONIX des diffuseurs).

### 21.3 Base de données

- Base de données **relationnelle robuste et open source** (type PostgreSQL ou équivalent), garantissant l'intégrité référentielle entre les entités (manuscrits, contrats, ventes, stocks...) ;
- transactions ACID : une vente qui décrémente le stock, crée la facture et alimente les droits d'auteur est **tout ou rien** — jamais d'état intermédiaire incohérent ;
- volumétrie cible : 10 000+ manuscrits, millions de mouvements et lignes de vente, sans dégradation (Ch. 1, §1.3) ; index et archivage à chaud prévus dès la conception ;
- horodatage et signature de toutes les écritures (principe de traçabilité, Ch. 0, §0.3) ;
- le **modèle de données détaillé fait l'objet de la Phase 2** du plan projet (document distinct).

### 21.4 Sécurité

**Authentification et accès**
- Mots de passe stockés selon l'état de l'art (hachage fort, jamais en clair) ;
- authentification à deux facteurs proposée, obligatoire pour les rôles financiers, juridiques et l'administrateur (Ch. 2, §2.5) ;
- sessions expirées après inactivité ; déconnexion forcée possible par l'administrateur ;
- application stricte de la matrice des rôles (Ch. 2) **côté serveur** — jamais uniquement dans l'interface.

**Protection des données**
- Chiffrement des communications (HTTPS/TLS obligatoire) ;
- chiffrement au repos des données sensibles (contrats, données RH, financières) ;
- journal d'audit inviolable (Ch. 5, §5.8) : append-only, aucune modification ni suppression possible, y compris par l'administrateur ;
- journalisation des consultations pour les modules sensibles (juridique Ch. 9, RH Ch. 19).

**Développement**
- Protections standard contre les vulnérabilités web courantes (injections, XSS, CSRF...) ;
- environnements séparés : développement / test / production ; aucune donnée réelle en développement.

### 21.5 Sauvegardes et continuité

- **Sauvegardes automatiques quotidiennes** au minimum, avec sauvegarde continue des transactions si l'hébergement le permet ;
- conservation sur plusieurs générations (quotidiennes, hebdomadaires, mensuelles) ;
- **copie externalisée** dans un lieu distinct du serveur principal (règle 3-2-1 : trois copies, deux supports, une hors site) ;
- **tests de restauration périodiques et obligatoires** — une sauvegarde jamais testée n'est pas une sauvegarde ;
- objectifs à valider avec la direction : perte de données maximale admissible (RPO, cible : ≤ 24 h, idéalement quelques minutes) et durée maximale d'interruption (RTO, cible : ≤ 1 jour ouvré).

### 21.6 Résilience et contexte de connectivité

Exigence différenciante posée au Chapitre 0 (§0.5) pour le contexte régional :

- **tolérance aux coupures** : reprise de session sans perte de saisie après une coupure de connexion ou d'électricité (brouillons enregistrés automatiquement) ;
- application **économe en bande passante** : pages légères, chargement différé des documents lourds, compression ;
- **mode dégradé à étudier** pour les fonctions de terrain (inventaire, vente en salon) : saisie hors connexion sur l'appareil, synchronisation à la reconnexion, avec règles claires de résolution des conflits. *Ce mode complexifie sensiblement le développement : la Phase 1 peut l'exclure, mais l'architecture ne doit pas le rendre impossible ensuite.*

### 21.7 Hébergement

Trois options à arbitrer avec la direction (annexe A) :

| Option | Avantages | Points d'attention |
|---|---|---|
| **Cloud régional ou international** | Sauvegardes et disponibilité professionnelles, montée en charge facile | Coût récurrent en devises, dépendance à la connectivité, localisation des données |
| **Serveur local (au siège)** | Maîtrise physique, fonctionne pendant les coupures d'Internet | Électricité, climatisation, sécurité physique, sauvegarde hors site à organiser, compétences d'administration |
| **Hybride** | Serveur local + réplication cloud : le meilleur des deux | Complexité de synchronisation |

L'exigence non négociable, quelle que soit l'option : **copie de sauvegarde hors du site principal** et engagement de disponibilité mesuré.

### 21.8 Notifications

- Notifications **internes à l'application** (centre de notifications par utilisateur) — canal principal ;
- relais **email** pour les alertes importantes (validations en attente, retards critiques) ;
- relais **SMS ou messagerie mobile** à étudier pour les alertes critiques hors connexion (option, coût par message) ;
- préférences par utilisateur et par type d'événement (paramétrage fin, pour éviter la fatigue d'alertes).

### 21.9 Documents et fichiers

- Stockage des fichiers (manuscrits, maquettes, PDF, images) hors base de données, avec référencement en base et contrôle d'accès identique aux données ;
- **versionnage natif** de tous les documents (exigence transverse, Ch. 4, §4.5) avec empreinte numérique (hash) par version — support de la signature du BAT (Ch. 14, §14.5) ;
- volumétrie : plusieurs Go par ouvrage illustré ; dimensionnement et archivage à froid des projets clos (Ch. 3, Archivage) ;
- **génération de PDF** intégrée : factures, bons de commande, rapports, relevés de droits (Ch. 5, 9, 15, 17, 18, 20) ;
- **import/export Excel (xlsx) et CSV** : reprise de l'existant, relevés de dépôt-vente (Ch. 17, §17.6), exports comptables (Ch. 18, §18.10), rapports (Ch. 20) ;
- **export ONIX 3.0** (Ch. 13, §13.8) ;
- lecture et **génération de codes-barres EAN-13** (Ch. 13, §13.4 ; Ch. 16, §16.3), y compris par caméra de smartphone.

### 21.10 Performance et montée en charge

- Temps de réponse cible : < 2 secondes pour les écrans courants, < 5 secondes pour les tableaux de bord agrégés ;
- recherche globale (Ch. 5, §5.4) indexée, résultats quasi instantanés jusqu'à 10 000+ manuscrits ;
- rapports lourds et exports générés **en tâche de fond** avec notification à disponibilité — jamais de blocage de l'interface ;
- tests de charge avant mise en production (Phase 5 du plan projet) avec des volumes simulés supérieurs aux cibles.

### 21.11 Ergonomie et accessibilité

- Interface en **français** ; architecture prête pour le multilingue (anglais, portugais — marchés régionaux, Ch. 0) sans refonte ;
- principe « simplicité d'abord » (Ch. 0, §0.7) : parcours guidés, valeurs par défaut intelligentes, erreurs expliquées en langage clair ;
- utilisable au clavier, contrastes suffisants, tailles de police adaptables — bonnes pratiques d'accessibilité ;
- aide contextuelle intégrée par écran (base de la formation, Phase 7).

### 21.12 Qualité, tests et déploiement

- Code versionné (Git), revues de code, tests automatisés sur les règles métier critiques (calcul des droits, mouvements de stock, facturation) ;
- environnement de **recette** où la maison teste chaque livraison avec des manuscrits fictifs (Phase 5) avant production ;
- déploiements sans interruption longue, avec possibilité de retour arrière ;
- documentation technique maintenue (condition d'indépendance vis-à-vis d'un prestataire unique, Ch. 0, §0.4).

### 21.13 Conformité et données personnelles

- Registre des données personnelles traitées (auteurs, clients, employés) et de leurs finalités ;
- respect de la réglementation applicable en matière de protection des données selon les pays d'exploitation ;
- droits d'accès et de rectification outillés ; durées de conservation définies avec le juridique ;
- clauses de confidentialité et de réversibilité (récupération complète des données) dans tout contrat d'hébergement ou de développement — **la donnée appartient à Éclosion Édition**.

### 21.14 Objectif du chapitre

Ces exigences garantissent que l'ERP sera sûr, rapide, durable et adapté à son contexte d'exploitation — et que les choix techniques de l'équipe de développement, quels qu'ils soient, serviront le projet défini dans les vingt chapitres précédents plutôt que de le contraindre.


---


## Annexe A : Synthèse des points à trancher avec la direction

Cette annexe rassemble toutes les décisions signalées au fil des chapitres et restant à arbitrer avant (ou pendant) la phase de conception détaillée. Chaque point indique le chapitre source, la question posée et l'enjeu. La direction est invitée à statuer point par point ; les décisions seront reportées dans les chapitres concernés, qui font foi.

### A.1 Organisation et rôles

| # | Réf. | Question | Enjeu |
|---|---|---|---|
| 1 | Ch. 2 §2.6 | Un même utilisateur peut-il cumuler plusieurs rôles ? | Réalité des petites équipes vs séparation des tâches (Ch. 18 §18.11) |
| 2 | Ch. 2 §2.6 | Les auteurs ont-ils un accès externe limité (suivi de leur manuscrit, de leurs droits) ? | Service rendu aux auteurs vs surface de sécurité supplémentaire |
| 3 | Ch. 2 §2.6 | Rôles temporaires pour prestataires externes (correcteurs freelances, illustrateurs) ? | Fluidité des collaborations vs contrôle des accès |
| 4 | Ch. 3 §3.6 | Valider le regroupement en 17 départements (au lieu des 26 modules initiaux) | Structure de toute l'application et des tableaux de bord |
| 5 | Ch. 3 §3.6 | Compléter la liste des rôles (comité de lecture, juridique, contrôle qualité, production, communication, RH) | Matrice des droits complète |
| 6 | Ch. 3 §3.6 | Expertise scientifique : département permanent ou intervention ponctuelle externe ? | Workflow (étape conditionnelle) et contrats |

### A.2 Processus éditorial

| # | Réf. | Question | Enjeu |
|---|---|---|---|
| 7 | Ch. 7 §7.9 | Lecture en aveugle (anonymisation lecteurs/auteurs) ? | Équité du processus de sélection |
| 8 | Ch. 7 §7.5 | Coefficients de la notation pondérée et seuils des classements | Calibrage de l'aide à la décision |
| 9 | Ch. 6 §6.5 | Pondérations de l'indice de priorité éditoriale | Ordonnancement des projets |
| 10 | Ch. 12 §12.7 | Planches-concours : plusieurs propositions de couverture en parallèle avec choix motivé ? | Processus créatif |
| 11 | Ch. 14 §14.5 | Signataires du BAT et seuils (tirage, budget) déclenchant la signature de la Direction générale | Chaîne de responsabilité sur l'acte le plus engageant |
| 12 | Ch. 14 §14.5 | BAT auteur : systématique, selon contrat, ou jamais ? | Relation auteurs et délais |

### A.3 Références, légal et conformité

| # | Réf. | Question | Enjeu |
|---|---|---|---|
| 13 | Ch. 13 §13.5 | Pays de référence pour le dépôt légal (et paramétrage multi-pays) | Conformité légale ; ambition régionale |
| 14 | Ch. 13 §13.8 | Usage effectif d'ONIX selon les partenaires de diffusion | Priorité de développement |
| 15 | Ch. 17 §17.2 | Réglementation du prix du livre applicable (prix unique ou libre, par pays) | Gestion des remises autorisées |
| 16 | Ch. 21 §21.13 | Réglementations de protection des données applicables ; durées de conservation | Conformité et archivage |

### A.4 Commercial et finance

| # | Réf. | Question | Enjeu |
|---|---|---|---|
| 17 | Ch. 17 §17.4 | Grilles de remise par catégorie de client et seuils de validation des remises hors grille | Politique commerciale |
| 18 | Ch. 17 §17.5 | Plafonds d'encours par catégorie de client | Risque client |
| 19 | Ch. 9 §9.5 | Assiette de calcul des droits d'auteur (prix public HT ou prix net éditeur) — par contrat | Modèle de contrat type |
| 20 | Ch. 18 §18.1 / §18.10 | Comptabilité générale intégrée (référentiel national, ex. SYSCOHADA) ou exports vers logiciel/cabinet externe | Périmètre majeur du module Finance |
| 21 | Ch. 18 §18.11 | Règles de séparation des tâches selon la taille réelle de l'équipe | Contrôle interne |
| 22 | Ch. 18 §18.3 / Ch. 16 §16.9 | Règles de provisionnement des créances douteuses et de dépréciation des stocks | À définir avec le comptable |
| 23 | Ch. 15 §15.3-15.4 | Seuils de délégation pour devis et commandes d'impression ; tolérances de quantité (± %) | Circuits de validation |

### A.5 RH

| # | Réf. | Question | Enjeu |
|---|---|---|---|
| 24 | Ch. 19 §19.6 | Formaliser des entretiens périodiques d'évaluation dans l'outil ? | Management ; acceptabilité sociale |
| 25 | Ch. 19 §19.7 | Périmètre paie : préparation des variables uniquement (défaut) ou davantage ? | Périmètre du module RH |

### A.6 Technique et déploiement

| # | Réf. | Question | Enjeu |
|---|---|---|---|
| 26 | Ch. 21 §21.7 | Hébergement : cloud, serveur local ou hybride | Coûts, disponibilité, souveraineté des données |
| 27 | Ch. 21 §21.5 | Objectifs RPO/RTO (perte de données et durée d'interruption admissibles) | Dimensionnement des sauvegardes |
| 28 | Ch. 21 §21.6 | Mode hors connexion (inventaire, salons) : Phase 1 ou évolution ultérieure ? | Complexité vs usage terrain |
| 29 | Ch. 21 §21.8 | Canal SMS/messagerie pour alertes critiques (coût par message) | Réactivité hors connexion |
| 30 | Ch. 1 §1.4 | Confirmer les exclusions de périmètre : e-commerce grand public, application mobile native, intégration comptable tierce | Cadrage du projet |

### Utilisation de cette annexe

Il est recommandé d'organiser **une ou deux séances d'arbitrage** avec les responsables concernés (direction générale, éditoriale, financière, commerciale), de consigner chaque décision (choix, motif, date, décideur), puis de mettre à jour les chapitres. Les points 4, 20 et 26 sont **structurants** : ils conditionnent la conception de la base de données (Phase 2) et devraient être tranchés en premier.
