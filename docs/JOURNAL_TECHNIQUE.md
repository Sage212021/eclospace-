# Eclospace — Journal technique

Document vivant : chaque choix technique structurant y est consigné avec sa justification (CLAUDE.md, règle 6). Complète le registre des décisions (`06_Registre_des_decisions.md`), qui reste la source des arbitrages métier.

| Date | Choix | Raison |
|---|---|---|
| 04/07/2026 | Hébergement : **Cloud** (D-004) | Décidé par l'opérateur. Fournisseur et région précis à choisir avant la mise en production (Ch. 21 §21.7) ; en dev, tout tourne en local via Docker pour ne pas dépendre du choix final. |
| 05/07/2026 | Fournisseur cloud : **Scalingo** (PaaS français, région Paris) (D-004-bis) | Décidé par l'opérateur après comparaison de 4 options (Scalingo, VPS Hetzner/OVH, Render, grand cloud AWS/OVHcloud avancé). Retenu pour : support/documentation en français, PostgreSQL managé (sauvegardes et mises à jour de sécurité assurées par le prestataire — pas d'équipe technique interne pour les opérer), déploiement par `git push` sans administration serveur, coût prévisible, bonne latence réseau France ↔ Cameroun. Détail dans `06_Registre_des_decisions.md`. |
| 04/07/2026 | Backend : **Node.js + TypeScript + Fastify** | Un seul langage (TypeScript) du backend au frontend : plus simple à relire pour un chef de projet non-développeur. Fastify est léger, rapide, peu gourmand en ressources — cohérent avec l'exigence de sobriété (Ch. 21 §21.6) et un hébergement cloud à coût maîtrisé. |
| 04/07/2026 | ORM/migrations : **Prisma** | Schéma déclaratif proche du modèle de données déjà écrit (`02_Modele_de_donnees.md`) : UUID, champs d'audit, snake_case via `@map`. Migrations versionnées, lisibles en revue. |
| 04/07/2026 | Base de données : **PostgreSQL** | Imposé par le cahier des charges (Ch. 21 §21.3) et l'hypothèse H4 du modèle de données. |
| 04/07/2026 | Frontend : **React + TypeScript + Vite** | Écosystème large, PWA/mobile facile (scan stock, vente en salon), pas de bibliothèque UI lourde imposée — les composants du prototype (`.pill`, `.card`, `.spine`...) sont repris directement en CSS aux jetons du guide de style. |
| 04/07/2026 | Authentification : sessions signées + **argon2** (hachage) + **TOTP** (2FA, librairie `otplib`) | Standards éprouvés, aucune dépendance à un fournisseur d'identité tiers payant — condition de réversibilité complète (Ch. 21 §21.13). |
| 04/07/2026 | Journal d'audit : table `audit_log` sans droits `UPDATE`/`DELETE` au niveau base (contrainte SQL, pas seulement applicative) | Exigence non négociable Ch. 0 §0.3 et modèle de données §13.5 : même l'administrateur ne peut pas altérer le journal. |
| 04/07/2026 | Fichiers (GED) : stockage sur disque (dev) / objet compatible S3 (prod cloud), hash SHA-256 calculé serveur | Le modèle l'exige (`document_versions.sha256_hash`) ; un stockage compatible S3 garde le choix du fournisseur cloud ouvert. |
| 04/07/2026 | Tests : **Vitest** | Intégré à l'écosystème TypeScript/Vite, rapide, sans configuration lourde. |

| 04/07/2026 | Endpoints ajoutés hors spécification API v1 : `GET /genres`, `GET /collections`, `GET /evaluation-criteria`, `GET /users` | Plomberie minimale nécessaire aux listes déroulantes du Ch. 6 §6.2 et à la grille du Ch. 7 §7.4, absente de `03_Specification_API.md` (document explicitement « version de travail »). Lecture seule, permissions vérifiées. |

## Planning annuel des événements (21/07/2026)

### Besoin (opérateur)
- Intégrer le planning 2026 (fusion de deux PDF : calendrier + planning) : une
  liste d'événements (salons, festivals, réunions…) **suivie par le RH et la
  Direction générale**, **consultée par tout le personnel sur le babillard, en
  temps réel**. Le RH/DG marquent chaque événement **tenu / non tenu**, tous les
  champs sont **modulables** (dates, lieu…), et chaque événement porte une
  **affiche visible directement** (sans téléchargement).

### Mise en œuvre
- Modèle `AnnualEvent` (+ enum `AnnualEventStatus` : `a_venir` / `a_confirmer` /
  `tenu` / `non_tenu`). L'**affiche** est stockée hors base (disque en dev,
  stockage objet durable en prod — même mécanisme que la GED), **optimisée** en
  JPG léger (`optimizeImage`) et servie **inline** (pas de `content-disposition:
  attachment`) → elle s'affiche directement.
- Routes `/api/v1/annual-events` : lecture = `communication:consultation` (tout
  le personnel) ; création/modification/suppression/affiche = `rh:administration`.
  Ce droit est détenu **exactement** par le Responsable RH **et** la Direction
  générale — donc « RH + DG gèrent » sans nouvelle permission.
- **Affichage** : composant `AnnualEventsPlanning` intégré au **babillard**
  (page Communication). Lecture pour tous ; contrôles de gestion (statut en un
  clic, édition de tous les champs, dépôt d'affiche, ajout/suppression) visibles
  seulement si `rh:administration`. Rafraîchissement périodique (≈ 45 s) pour le
  « temps réel ». Améliorations : mise en avant du **prochain** événement, badge
  **DG**, code couleur Éclospace par statut.
- **Seed** : les **11 événements 2026** (dont Festival BINGUEL, 12→15 août) sont
  chargés une seule fois (si la table est vide) ; ensuite **tout est modifiable
  dans l'ERP** (aucune intervention en coulisses).
- Tests (`annual-events.test.ts`) : lecture par tout le personnel ; gestion
  refusée à un non-RH/DG (403) ; RH crée, DG marque « tenu » ; dates modulables ;
  affiche optimisée servie inline ; suppression logique.

## Points d'interprétation du Lot 1 à confirmer avec la Direction éditoriale

Le cahier des charges décrit le comité de lecture et la décision éditoriale en langage métier ; certains détails d'implémentation ont exigé un choix non explicitement tranché par les documents. Signalés ici conformément à CLAUDE.md règle 2 :

1. **Échelle de notation** : les critères (Ch. 7 §7.4) sont notés de 0 à 10. Le cahier des charges ne précise pas l'échelle.
2. **Seuils de classement qualitatif** (Ch. 7 §7.5 : « seuils paramétrables ») : valeurs de départ Excellent ≥ 8,5, Très bon ≥ 7, Bon ≥ 5, À retravailler ≥ 3, sinon Refusé. Stockées dans `settings` (clé `evaluation_rating_thresholds`), modifiables sans redéploiement.
3. **Seuil d'écart signalant un désaccord entre lecteurs** (Ch. 7 §7.5) : fixé à 3 points par défaut (clé `evaluation_score_gap_threshold`), à confirmer.
4. **Coefficients de la grille** (Ch. 7 §7.5) : seuls 3 exemples sont donnés dans le texte (ligne éditoriale ×3, potentiel commercial ×2, originalité ×2) ; les 6 autres critères ont reçu un coefficient par défaut de 1, à valider avec la Direction éditoriale.
5. **Étape 4 (décision éditoriale) marquée « validée »** uniquement pour les décisions terminales (acceptation, acceptation sous conditions, refus) ; une révision ou une mise en attente n'avance pas le workflow et ne clôt pas l'étape — lecture combinée du Ch. 4 §4.3 (3 statuts) et du Ch. 8 §8.2 (5 décisions), qui ne se recoupent pas exactement.
6. **Genres de départ** (Ch. 6 §6.2) : liste limitée aux exemples cités dans le texte (roman, essai, poésie, manuel, jeunesse) ; à compléter par le secrétariat éditorial selon le catalogue réel. Aucune collection n'a été pré-remplie (donnée propre à la maison, non spécifiée).

| 04/07/2026 | Comparateur de versions (Ch. 10 §10.5) : **`mammoth`** (extraction texte .docx) + **`diff`** (calcul des différences) | Bibliothèques établies et légères. Portée limitée aux fichiers .docx (repli explicitement prévu par le plan de développement §2, le PDF maquetté étant noté « à étudier »). Rapport structuré (JSON) archivé au dossier ; **export PDF non implémenté à ce stade**. |
| 04/07/2026 | Endpoint ajouté hors spécification API v1 : `GET /documents?entity_type=&entity_id=` | Nécessaire pour retrouver les documents d'un manuscrit avant de les comparer — absent de `03_Specification_API.md`. |
| 04/07/2026 | CORS : méthodes explicitement autorisées (`GET, POST, PATCH, DELETE, OPTIONS`) | Bug trouvé en testant le Lot 2 dans un navigateur réel : la configuration par défaut de `@fastify/cors` bloquait les requêtes `PATCH` (contrats, tâches) alors que les tests automatisés — qui n'utilisent pas de vrai CORS — ne l'avaient pas révélé. |
| 04/07/2026 | Fiche **Partenaire unique** (`partners`, remplace `authors`) avec catégorie (auteur, correcteur, traducteur, illustrateur, maquettiste, graphiste, imprimeur, consultant, autre) | Décision opérateur : éviter de refondre la structure des contrats à chaque nouveau type de prestataire. Base de test/dev réinitialisée pour cette migration (aucune donnée réelle en jeu à ce stade du projet). |
| 04/07/2026 | Gantt : **liste (v1)**, diagramme interactif en v2 | Décision opérateur : coût/complexité/délai maîtrisés maintenant ; le moteur de recalcul des dépendances et des conflits est déjà prêt pour alimenter un vrai diagramme plus tard. |

## Décisions opérateur du 04/07/2026 sur les points d'interprétation du Lot 2

1. **Contrepartie du contrat — DÉCIDÉ : fiche Partenaire unique.** L'opérateur demande explicitement de ne pas limiter les contrats aux auteurs : une fiche unique `partners` couvre désormais auteur, correcteur, traducteur, illustrateur, maquettiste, graphiste, imprimeur, consultant, autre prestataire (`PartnerCategory`). `work_contributors` et `contracts` référencent tous deux `partners` — table `authors` supprimée (renommée), aucune redondance à corriger plus tard. Un contrat de prestation avec un imprimeur ou un correcteur fonctionne dès maintenant.
2. **Étape REECRITURE — DÉCIDÉ : activée mais facultative.** `manuscript.requires_rewrite` (miroir de `requires_expertise`) : le responsable de la correction pose ce drapeau à la validation de l'étape CORRECTION (ou EXPERTISE) ; si activé, le manuscrit passe par RÉÉCRITURE avant de continuer, sinon elle est sautée comme avant. Interface : case à cocher « Cette version nécessite une réécriture » au moment de valider la correction.
3. **Transfert automatique vers la mise en page** (Ch. 10 §10.12) : toujours simplifié — validation explicite de l'étape CORRECTION par un responsable, plutôt qu'un déclenchement automatique à la validation d'une version de document précise (ambigu sans un champ désignant « la version finale »). Non tranché par l'opérateur, reste un point ouvert si besoin.
4. **Gantt interactif — DÉCIDÉ : liste pour la v1, diagramme graphique en v2.** L'opérateur confirme explicitement cette approche (coût/complexité/délai maîtrisés maintenant, richesse visuelle en version ultérieure). L'API recalcule déjà les tâches dépendantes et signale les conflits ; seule la représentation graphique avec glisser-déposer est différée — nécessitera de choisir une bibliothèque de visualisation le moment venu.
5. **Règle de dérogation contractuelle** (Ch. 9 §9.12) : la dérogation pour envoyer un ouvrage en production sans contrat actif est réservée à la permission `manuscripts:administration`, accordée pour l'instant au seul rôle Directeur général — à confirmer que c'est bien l'autorité visée par « accordée par la Direction générale ».

## Décisions et points d'interprétation du Lot 3 (Maquette, Infographie, ISBN, BAT, Impression)

| Date | Choix | Raison |
|---|---|---|
| 04/07/2026 | Correction de l'ordre du workflow : **Attribution des références (étape 12) avant Validation du BAT (étape 13)** | L'ordre saisi au Lot 1 (BAT=12, Attribution=13) contredisait le texte des Ch. 13 §13.9 et Ch. 14 §14.2, qui exigent tous deux que la complétude ISBN/dépôt légal/métadonnées soit vérifiée **avant** la constitution du dossier de BAT. Corrigé dans le seed ; aucune donnée réelle en jeu (Ch. 21 §21.4). |
| 04/07/2026 | Code-barres EAN-13 : **généré à la volée en SVG**, non stocké en image binaire | Algorithme normalisé et stable (implémentation propre dans `lib/barcode.ts`, sans dépendance externe) ; suffisant pour l'impression et pour l'affichage à l'écran. Simplifie le contrôle de complétude (Ch. 13 §13.9) : le code-barres est considéré transmis dès qu'un ISBN existe. |
| 04/07/2026 | Formule du calcul du dos (Ch. 12 §12.3) : approximation `pages × grammage × 0,0012 mm` | Le cahier des charges exige le calcul sans fixer de formule — valeur à confirmer avec les imprimeurs partenaires. |
| 04/07/2026 | Choix manuel d'un ISBN précis dans la tranche (Ch. 13 §13.3) : **non implémenté**, seule l'attribution automatique du prochain disponible l'est | Le modèle de tranche (`isbn_pool.next_value`) est un compteur séquentiel ; un choix manuel arbitraire casserait cette garantie de non-réutilisation sans structure supplémentaire. À revoir si le besoin est confirmé. |
| 04/07/2026 | Export ONIX 3.0 (Ch. 13 §13.8) : **format prévu (`MetadataExportFormat.onix30`) mais génération non implémentée**, seul l'export CSV simplifié fonctionne | Même logique que le comparateur de versions au Lot 2 : la norme ONIX est complexe et son usage dépend des partenaires de diffusion, non encore connus. |
| 04/07/2026 | Classification Thema (Ch. 13 §13.7) : `thema_codes` est une simple liste de codes libres, sans référentiel Thema chargé ni mappage automatique avec les catégories internes | Le référentiel Thema complet est une norme externe volumineuse ; son intégration est différée à un lot ultérieur si confirmée nécessaire. |
| 04/07/2026 | Réouverture d'un cycle de BAT après corrections (Ch. 14 §14.4) : reprend **tous** les points de contrôle non cochés du cycle précédent, plutôt que la liste strictement limitée « aux points corrigés et aux points de cohérence impactés » | Déterminer automatiquement quels points sont « impactés » par une correction donnée exigerait une modélisation fine des dépendances entre points de contrôle, non spécifiée. Simplification documentée, à affiner si le nombre de cycles observés en production le justifie. |
| 04/07/2026 | Liste de contrôle du BAT (Ch. 14 §14.3) : valeurs de départ fixes (`DEFAULT_BAT_CHECKLIST_ITEMS` dans `routes/bat.ts`), pas encore d'interface pour que la direction ajoute des points par collection | Le mécanisme générique `Checklist`/`ChecklistItem` le permettrait techniquement (même table que Ch. 11 §11.6 et Ch. 13 §13.9) ; l'écran d'administration reste à construire. |
| 04/07/2026 | Diffusion des notifications par rôle (`lib/notify.ts`) : nouveau mécanisme `notifyRole()`, en plus des notifications à un utilisateur unique déjà existantes | Nécessaire pour les alertes Ch. 14/15 adressées à une fonction (« le responsable qualité », « la Direction générale ») plutôt qu'à un utilisateur précis désigné dans la donnée métier. |
| 04/07/2026 | Engagement automatique du bon de commande dans le module Finance (Ch. 15 §15.4) et rapprochement facture/commande/réception (Ch. 15 §15.7) : **non implémentés** | Le module Finance (Ch. 18) n'existe pas avant un lot ultérieur ; le bon de commande est créé et suivi, mais aucune écriture comptable n'est générée pour l'instant. |
| 04/07/2026 | Jalons de fabrication (Ch. 15 §15.6) : alerte de retard au responsable impression uniquement, pas d'alerte automatique au Gantt du projet | Le Gantt (Ch. 8) n'a pas de mécanisme d'insertion automatique de jalons externes ; un lien serait à construire si confirmé nécessaire. |
| 04/07/2026 | Épreuve contractuelle demandée à l'imprimeur (Ch. 15 §15.5) : **non implémentée** | Fonctionnalité secondaire du circuit de transmission des fichiers, non bloquante pour le circuit principal devis → commande → réception. |

## Décisions et points d'interprétation du Lot 4 (Stock et magasin, Commercial)

| Date | Choix | Raison |
|---|---|---|
| 04/07/2026 | `PurchaseOrder.deliveryLocation` (texte libre, Lot 3) remplacé par `deliveryLocationId` (FK vers `stock_locations`) | Le Lot 4 introduit enfin `stock_locations` ; le champ texte libre n'était qu'un palliatif documenté au Lot 3. Aucune donnée réelle en jeu. |
| 04/07/2026 | Encours client (Ch. 17 §17.3, §17.5) : **approximé par le total des commandes non soldées** (statuts confirmed/preparing/shipped/delivered), en l'absence du module Finance | Le calcul exact de l'encours dépend des factures et paiements (Ch. 18, Lot 5) qui n'existent pas encore. Approximation raisonnable pour bloquer une commande dépassant un plafond, à réviser quand la facturation existera. |
| 04/07/2026 | Frais de port et taxes (Ch. 17 §17.5 point 3) : **non calculés automatiquement** — `tax_rate` saisi manuellement par ligne, frais de port absents | Le référentiel `tax_rates` (Ch. 18) et le calcul de frais selon poids/destination sont hors périmètre avant le module Finance. |
| 04/07/2026 | Facturation, avoirs et droits d'auteur déclenchés par une vente/un retour (Ch. 17 §17.6, §17.9) : **non implémentés** | Modules Finance (Ch. 18) et moteur de droits d'auteur connecté aux ventes (Ch. 9 §9.5) prévus au Lot 5, qui dépend justement des événements de vente créés ici. |
| 04/07/2026 | Retour client déclassé (verdict « damaged ») : **compartiment de stock `declasse` à part entière** (`stock_items.condition`), distinct du stock vendable, jamais mélangé dans les totaux ni les alertes de rupture | Décision opérateur du 04/07/2026 (validation du Lot 4 sous réserve) : le stock déclassé doit être suivi séparément, pas seulement mentionné sur la ligne de retour — corrigé avant la version finale, comme demandé. |
| 04/07/2026 | Réservation de stock à la confirmation d'une commande (Ch. 17 §17.5) : **répartie sur les tirages existants d'un même lieu**, sans choix de lieu automatique multi-entrepôt | Le lieu source est désigné explicitement par l'opérateur à la création de la commande ; répartir automatiquement une commande entre plusieurs entrepôts n'est pas demandé par le texte et aurait ajouté une complexité non spécifiée. |
| 04/07/2026 | Relance automatique des relevés de dépôt-vente en retard (Ch. 17 §17.6) : **non implémentée** | Nécessiterait une tâche planifiée (cron) absente de l'infrastructure actuelle ; les relevés existants sont consultables mais aucune alerte automatique n'est générée. |
| 04/07/2026 | Bug réel trouvé en testant dans un navigateur (pas seulement via les tests automatisés) : un mouvement de stock à sens unique (ex. « exemplaire d'auteur ») créditait silencieusement un second lieu si le formulaire envoyait par erreur un `to_location_id` non pertinent pour ce type de mouvement | La création de mouvement appliquait un delta sur n'importe quel lieu présent dans la requête, sans vérifier que le type de mouvement l'exigeait réellement. Corrigé dans `routes/stock.ts` (delta appliqué uniquement si le type l'exige) ; régression ajoutée aux tests automatisés. |

## Décision opérateur du 04/07/2026 sur le point d'interprétation du Lot 5 (Ch. 18 §18.1, §18.10)

**DÉCIDÉ : Option B — gestion financière opérationnelle + exports normalisés.** Le module Finance tient la facturation, les encaissements, la trésorerie, les droits d'auteur et l'analytique par ouvrage dans Eclospace, et génère des exports périodiques normalisés (CSV) à destination d'un cabinet ou logiciel comptable externe qui tient la comptabilité générale (plan comptable, journaux, grand livre, balance — Option A, écartée). Cohérent avec les simplifications déjà actées (export ONIX différé, export PDF différé au Lot 2).

## Décisions et points d'interprétation du Lot 5 (Finance et comptabilité, droits d'auteur)

| Date | Choix | Raison |
|---|---|---|
| 04/07/2026 | Bug réel corrigé (trouvé en écrivant les tests, avant même le navigateur) : le taux de TVA d'une ligne de commande (Ch. 17 §17.5, `sales_order_lines.tax_rate`) restait à 0 par défaut, sans jamais interroger le référentiel `tax_rates` (Ch. 18 §18.9) | C'était exactement le point signalé par l'opérateur en validant le Lot 4 sous réserve (« calcul automatique des taxes »). `POST /sales-orders` résout désormais `tax_rate` via `lookupTaxRatePct()` si la ligne n'en fournit pas explicitement un — la facture générée à la livraison hérite de ce taux (`routes/commercial.ts`). |
| 04/07/2026 | Encours client (Ch. 17 §17.3, §17.5, Ch. 18 §18.3) : **calcul précis** (`lib/finance.ts`, `computeCustomerOutstandingBalance`) remplace l'approximation du Lot 4 basée sur le total des commandes non soldées | C'était le premier point signalé par l'opérateur en validant le Lot 4 sous réserve. Le calcul est désormais : somme des soldes dus par facture (total TTC − paiements alloués − avoirs rattachés), sur les factures non annulées. |
| 04/07/2026 | Échéance de facture (`invoices.due_date`) : **30 jours par défaut** depuis l'émission, appliqué uniformément | Le cahier des charges ne fixe pas de délai standard ; `customers.payment_terms` reste un champ texte libre non structuré. Nécessaire pour que la balance âgée (§18.3) distingue « non échu » d'un retard réel. À affiner si des délais différenciés par client sont requis (parsing de `payment_terms`, ou champ numérique dédié). |
| 04/07/2026 | Relance graduée (Ch. 18 §18.3) : **deux niveaux fixes** (rappel courtois → mise en demeure), la troisième tentative est refusée (`max_dunning_level_reached`) | Au-delà de la mise en demeure, la suite relève du contentieux (avocat, tribunal de commerce), hors périmètre applicatif. Un niveau supplémentaire pourra être ajouté si le besoin est confirmé. |
| 04/07/2026 | Moteur de droits d'auteur (Ch. 9 §9.5) : le palier appliqué à une vente est déterminé par la **quantité cumulée après** ce mouvement (pas de répartition au prorata si un mouvement chevauche deux paliers) | Simplification déjà documentée au Lot 4 pour `lib/royalty.ts` ; confirmée ici car les relevés de droits du Lot 5 s'appuient sur ces mêmes `royalty_entries`. |
| 04/07/2026 | Génération d'un relevé de droits (`POST /contracts/:id/royalty-statements`) : les `royalty_entries` non encore rattachées à un relevé et dont `computed_at` tombe dans la période demandée sont agrégées ; deux relevés ne peuvent pas couvrir des périodes qui se chevauchent pour un même contrat (`409 period_overlap`) | Garantit qu'une même vente ne peut jamais être comptée deux fois dans deux relevés, sans verrou supplémentaire — la période demandée est la seule donnée qui contrôle l'inclusion. |
| 04/07/2026 | Trésorerie prévisionnelle (Ch. 18 §18.8, `GET /treasury/forecast`) : encaissements attendus = factures dues non soldées (échéance = `due_date`) ; décaissements prévus = dépenses **validées** non payées + relevés de droits **émis** non payés — répartis en fenêtres de 30 jours | Approximation raisonnable avec les données disponibles (pas de champ « date de paiement prévue » distinct sur `expenses`) ; le rapprochement bancaire assisté et le pointage (§18.8) restent non implémentés — les tables `bank_statements`/`statement_lines` existent au schéma mais aucune route d'import n'a été écrite. |
| 04/07/2026 | Rapprochement à trois volets facture fournisseur / commande / réception (Ch. 18 §18.4, Ch. 15 §15.7), provisionnement des créances douteuses (§18.3, « règles à définir avec le comptable ») : **non implémentés** | Le premier suppose une notion de « facture fournisseur » distincte de `purchase_orders`/`goods_receipts`, absente du modèle ; le second est explicitement noté comme à définir avec le comptable dans le cahier des charges lui-même (§18.3). Différés à un lot ultérieur si confirmés nécessaires. |
| 04/07/2026 | Retenues fiscales sur les droits d'auteur (Ch. 18 §18.7) : champ `royalty_payments.tax_withheld` saisi manuellement à l'exécution du paiement, aucun barème automatique par pays | La législation applicable dépend du pays de résidence de l'auteur, non encore précisé (cf. point ouvert n°20 de l'annexe des décisions). |

### Point signalé à l'opérateur (CLAUDE.md règle 2) — RÉSOLU ci-dessous

**Frais de port automatiques** (mentionnés dans la demande de validation du Lot 4) : aucune mention dans `01_Cahier_des_charges.md`. Faute de règle de calcul spécifiée, la fonctionnalité n'avait pas été construite au Lot 5. L'opérateur a depuis précisé les zones et modes de tarification attendus (revue du 04/07/2026 ci-dessous) ; le moteur est désormais implémenté.

## Renforcement du Lot 5 suite à la revue de l'opérateur du 04/07/2026 (conformité Cameroun/SYSCOHADA)

L'opérateur a fait valider le Lot 5 par un contrôle de gestion externe (note 18,5/20) avec une liste de points à corriger avant validation définitive. Décisions prises avec l'opérateur puis mises en œuvre :

| Date | Choix | Raison |
|---|---|---|
| 04/07/2026 | **Bug réel corrigé** : sélection du contrat de droits d'auteur par format vendu (`lib/royalty.ts`, `findActiveRoyaltyContract`) | Si un même ouvrage a plusieurs contrats actifs (ex. papier vs numérique, chacun avec son propre taux — `contracts.formats`), le moteur choisissait arbitrairement le premier trouvé au lieu de sélectionner celui dont `formats[]` contient le format réellement vendu. Corrigé avec repli sur un contrat sans restriction de format ; régression couverte par un test à deux contrats/deux formats. |
| 04/07/2026 | **Frais de port paramétrables** (Ch. 17 §17.5, hors cahier des charges initial) : `shipping_rates` par zone (Yaoundé, Douala, autres villes du Cameroun, international), avec forfait, tarif au kilogramme (poids via `work_metadata.weight_grams`) et gratuité au-delà d'un seuil de commande — priorité gratuité > tarif au kg > forfait | Reprend exactement les zones et modes demandés par l'opérateur. Facturés une seule fois par commande (`sales_orders.shipping_fee_invoiced`), sur la première livraison, jamais sur les livraisons de reliquat suivantes. Valeurs de départ à zéro (comme `tax_rates`), ajustables par le financier sans redéploiement. |
| 04/07/2026 | **Journal d'audit complet sur le module Finance** : toutes les mutations (dépenses, budgets, révisions budgétaires, taux de taxe et de frais de port, comptes bancaires, clôture de période, export comptable) écrivent désormais dans `audit_log` ; les factures et avoirs **générés automatiquement** par une livraison/un relevé de dépôt-vente/une vente directe/un retour sont eux aussi tracés, avec l'utilisateur qui a déclenché l'événement métier sous-jacent | `audit_log` existe depuis le Lot 0 (append-only, Ch. 0 §0.3) mais son application au module Finance était incomplète — plusieurs endpoints du Lot 5 initial ne l'appelaient pas encore. |
| 04/07/2026 | **Escalade de validation des dépenses au-delà d'un seuil** (Ch. 18 §18.11) : `expenses.status` gagne `en_attente_dg` ; au-delà d'un seuil paramétrable (`expense_dg_validation_threshold`, défaut 500 000, table `settings`, même mécanisme que `purchase_order_delegation_threshold` du Lot 3), la validation courante ne suffit plus — la validation finale est réservée au rôle Direction générale, distincte du premier valideur et du créateur | Simplification documentée : un circuit complet « demandeur → responsable hiérarchique → DAF → DG » suppose un organigramme (Ch. 19, RH) qui n'existe pas avant le Lot 6. Le circuit à deux paliers retenu ici reste une amélioration réelle par rapport au palier unique du Lot 5 initial, sans anticiper un module qui n'existe pas encore. |
| 04/07/2026 | **Rapprochement bancaire assisté** (Ch. 18 §18.8) : import d'un relevé (lignes en JSON — aucun partenaire bancaire n'a communiqué de format CSV propriétaire à ce stade, donc pas de parseur dédié) puis pointage ligne à ligne avec un paiement (`matched_payment_id`, `reconciled_at`) | Les tables `bank_statements`/`statement_lines` existaient déjà au schéma du Lot 5 initial sans route pour les exploiter ; désormais fonctionnelles. |
| 04/07/2026 | **Multi-caisses et virements internes** (Ch. 18 §18.8) : `bank_accounts.type` (banque/caisse/mobile_money) remplace le seul booléen `is_mobile_money` ; nouveau modèle `account_transfers` entre deux comptes propres à la maison | Une maison d'édition tient une caisse espèces (comptoir, salons) distincte de ses comptes bancaires. Un virement interne ne modifie jamais la position de trésorerie globale (vérifié par test), seulement la répartition entre comptes — solde par compte exposé via `GET /bank-accounts/:id/balance`. |
| 04/07/2026 | **Export comptable enrichi façon SYSCOHADA** (Ch. 18 §18.10, Option B) : colonnes `compte_debit`/`compte_credit`/`journal`/`centre_analytique`/`piece` ajoutées au CSV existant, plan de comptes indicatif dans `lib/accountingMapping.ts` | ⚠️ **CES NUMÉROS DE COMPTE NE SONT PAS CERTIFIÉS** — inspirés du SYSCOHADA révisé à titre indicatif seulement, à valider par le comptable de la maison avant tout dépôt réel (une erreur de compte dans une vraie déclaration a des conséquences fiscales concrètes). La réponse de l'export porte explicitement `chart_of_accounts_status: "indicatif_non_valide"` pour qu'aucun outil en aval ne le traite par erreur comme certifié. La TVA n'est pas isolée sur son propre compte (4431) : elle reste incluse dans le montant TTC du compte de ventes — simplification à corriger avec le comptable si un import direct en grand livre sans retraitement est nécessaire. **Bug réel corrigé avant livraison** : un paiement lié à un droit d'auteur (`royalty_payments`) était compté deux fois dans l'export (une fois via la requête générique des paiements, une fois via une requête séparée des droits d'auteur versés référençant le même `payment_id`) — supprimé, contrôle d'exhaustivité restauré. |
| 04/07/2026 | **Exports Sage/Odoo/SAP/Excel demandés par l'opérateur : non construits sous forme de connecteurs dédiés** | Ces logiciels importent tous un CSV structuré ; l'enrichissement ci-dessus (comptes/journal/analytique/pièce) rend le CSV existant directement exploitable par n'importe lequel d'entre eux, sans connecteur propriétaire à maintenir pour chacun — cohérent avec Option B et la sobriété technique demandée (CLAUDE.md règle 6, pas de dépendance exotique). Un vrai export `.xlsx` binaire (multi-feuilles, formules) n'a pas été construit : nécessiterait une nouvelle dépendance non requise, le CSV s'ouvrant déjà nativement dans Excel. |
| 04/07/2026 | **Tableaux de bord Finance consolidés** (point 8 de la revue) : **non construits à ce stade** | Relèvent du Lot 6 « RH, pilotage, rapports » selon le découpage du projet lui-même (`docs/05_Plan_de_developpement.md`) — CLAUDE.md règle 1 interdit de commencer un module d'un lot ultérieur. Toutes les données nécessaires (factures, encours, trésorerie, droits d'auteur dus, dépenses par centre de coût) sont déjà exposées par les endpoints existants et prêtes à être agrégées quand le Lot 6 démarrera. |
| 04/07/2026 | `vitest.config.ts` : suite de tests toujours séquentielle (`fileParallelism: false`), confirmé nécessaire | La clôture de période comptable (déjà présente au Lot 5 initial) et, désormais, les virements internes/soldes de compte manipulent un état partagé par plusieurs fichiers de test sur la même base ; le choix initial reste justifié. |

**14 nouveaux tests automatisés** (86 au total, tous verts) : sélection du contrat de droits par format avec deux contrats actifs, forfait de frais de port facturé une seule fois sur la première livraison, gratuité au-delà d'un seuil, escalade de validation au-delà du seuil de délégation avec refus d'un non-DG et refus du double rôle, multi-caisses et virement interne sans effet sur la position globale, import de relevé bancaire et pointage avec un paiement, export comptable enrichi avec écritures de dépense, traçabilité des factures générées automatiquement dans le journal d'audit.

## Convention de droits d'auteur entièrement paramétrable (revue opérateur du 04/07/2026)

L'opérateur a transmis une proposition détaillée pour rendre la convention de droits d'auteur « entièrement paramétrable » (9 points). Analyse avant mise en œuvre :

**Déjà couvert par le moteur existant** (aucun changement nécessaire) :
- Calcul classique quantité × prix de base × taux (`lib/royalty.ts`).
- Amortissement automatique de l'à-valoir (`royalty_statements.advance_recouped`).
- Paliers de vente progressifs selon la quantité cumulée (`royalty_terms.tiers`).
- Taux distinct selon le support (papier/ebook/audio/traduction) : chaque contrat porte son propre `formats[]` et ses propres paliers ; corrigé dans cette même session pour que le moteur sélectionne le bon contrat selon le format effectivement vendu (cf. section précédente).
- Base de calcul prix HT / prix net éditeur (`royalty_terms.base`, `RoyaltyBase`).

**Ajouté dans cette session** :

| Date | Choix | Raison |
|---|---|---|
| 04/07/2026 | **Répartition entre plusieurs bénéficiaires** (point 3) : nouveau modèle `contract_beneficiaries` (contrat, partenaire, part en %) — `POST /contracts/:id/beneficiaries` remplace la liste complète et exige une somme de parts égale à 100 % | Le calcul des droits reste au niveau du contrat (royalty_entries/statements inchangés — un seul calcul, une seule à-valoir) ; la répartition n'intervient qu'à l'exécution du paiement, qui crée un `Payment`/`royalty_payment` par bénéficiaire proportionnellement à sa part. Sans bénéficiaire configuré, 100 % va au partenaire unique du contrat (rétrocompatible, aucune régression sur les relevés déjà émis). |
| 04/07/2026 | **Paiements partiels et solde restant** (point 9) : `POST /royalty-statements/:id/payments` accepte un montant brut partiel (`amount`, défaut = solde restant) ; le relevé ne passe « paid » que lorsque le solde restant atteint zéro ; `GET /royalty-statements` et `.../:id` exposent `remaining_balance` | Auparavant, un seul paiement soldait obligatoirement la totalité du relevé — aucun paiement fractionné n'était possible, alors que c'est une pratique courante (acompte puis solde). |
| 04/07/2026 | **Retenue fiscale par défaut du contrat** (point « retenues fiscales ») : `royalty_terms.tax_withholding_pct`, appliqué automatiquement à l'exécution du paiement si `tax_withheld` n'est pas explicitement fourni dans la requête | Évite une saisie manuelle à chaque paiement quand le taux de retenue est stable pour un contrat donné (ex. retenue à la source sur redevances d'auteur non-résident). Reste surchargeable au cas par cas. |
| 04/07/2026 | **Périodicité des relevés** (point « périodicité ») : `royalty_terms.statement_periodicity` (mensuelle/trimestrielle/semestrielle/annuelle), champ **informatif** stocké sur le contrat | Aucune tâche planifiée n'existe dans le projet (pas de cron/scheduler) pour déclencher automatiquement la génération à la bonne date ; la génération reste une action volontaire « en un clic » comme le prévoit déjà le Ch. 9 §9.5. Un futur mécanisme de rappel pourrait s'appuyer sur ce champ si une infrastructure de tâches planifiées est ajoutée au projet. |

**Point volontairement non traité, avec justification** : la base de calcul « recettes d'exploitation » (mentionnée dans la proposition) suppose un flux de revenus de cession de droits étrangers/subsidiary rights qui n'est pas modélisé dans Eclospace (aucune table de suivi des ventes de droits à l'étranger) — contrairement à prix HT/prix net éditeur qui se calculent directement sur une vente unitaire déjà enregistrée. Ajouter cette option sans le flux de données sous-jacent produirait un champ inutilisable. À construire si un module de cession de droits est confirmé nécessaire.

**3 nouveaux tests automatisés** (89 au total, tous verts) : répartition 70/30 entre deux bénéficiaires avec refus d'une somme de parts ≠ 100 %, paiement partiel suivi du solde puis paiement final, retenue fiscale par défaut du contrat appliquée automatiquement.

## Lot 6 — RH (Ch. 19), Direction générale (Ch. 5), Rapports et pilotage (Ch. 20)

Couche transverse du projet : contrairement aux lots précédents, ce lot ne saisit quasiment rien de nouveau — il consolide et restitue les données déjà produites par les modules opérationnels des lots 1 à 5.

| Date | Choix | Raison |
|---|---|---|
| 04/07/2026 | **Aucune tâche planifiée (cron/scheduler) dans le projet** : trois mécanismes qui semblent « automatiques » sont en réalité déclenchés paresseusement | (1) La désactivation du compte à la date de départ (Ch. 19 §19.3) est vérifiée dans `loadEffectiveUser` (`lib/permissions.ts`), appelé à chaque requête authentifiée — désactivation immédiate si la date est déjà passée, sinon à la prochaine connexion. (2) Les recommandations du centre de pilotage (Ch. 5 §5.9) sont générées à la demande via `POST /recommendations/generate`, pas en tâche de fond. (3) Les rapports standards (Ch. 20 §20.3) sont générés de façon synchrone à l'appel de `POST /reports/:id/run`, sans file de tâches. Cohérent avec la simplification déjà actée au Lot 5 (clôture de période, relances de dépôt-vente). |
| 04/07/2026 | **Revue périodique des habilitations** (Ch. 19 §19.4) : un item de revue par employé **ayant un responsable identifié** (`Employee.managerId`) ; un employé sans responsable n'a pas de réviseur généré | Le texte ne prévoit pas d'autorité de repli pour les employés sans supérieur hiérarchique direct ; en inventer une (ex. Direction générale par défaut) aurait été une extrapolation non demandée. |
| 04/07/2026 | **Détection d'anomalies d'accès** (Ch. 19 §19.4) : deux règles concrètes seulement — compte actif sans dossier RH actif (hors `ADMIN_GENERAL`), et cumul `saisie`+`administration` sur un même module sensible (`finance`, `royalties`) | Le texte demande des « cumuls de rôles contraires à la séparation des tâches » sans lister les cumuls précis. Ancré sur le précédent concret déjà posé au Lot 5 (Ch. 18 §18.11, escalade de validation des dépenses) plutôt que de construire un détecteur de conflits de rôles entièrement générique. |
| 04/07/2026 | **Explorateur d'analyses** (Ch. 20 §20.4) : les dimensions/métriques disponibles sont **contraintes au registre KPI** (`lib/kpi.ts`, `KPI_REGISTRY`), pas un moteur de tableau croisé dynamique entièrement libre | Garantit le principe « un indicateur, une définition, une formule » (Ch. 20 §20.2) : le même registre alimente le tableau de bord Direction, la bibliothèque de rapports standards et l'explorateur — sans risque que deux écrans calculent le même indicateur différemment. Portée réduite assumée par rapport à un vrai moteur BI. |
| 04/07/2026 | **Paie complète (bulletins, déclarations sociales) : non implémentée**, seule la préparation des variables de paie l'est (`PayrollVariable` : présences, absences, primes, missions, export marqué `exportedAt`) | Explicitement hors périmètre par défaut selon le cahier des charges lui-même (Ch. 19 §19.7 : « à confirmer ») et cohérent avec l'option comptable externalisée retenue au Lot 5 (Ch. 18 §18.1, Option B). |
| 04/07/2026 | **Entretiens périodiques d'évaluation (grilles, objectifs, comptes rendus signés) : non implémentés** | Le cahier des charges lui-même les signale comme un point à trancher avec la direction (Ch. 19 §19.6, note en italique), pas comme une exigence actée. Aucune interprétation prise à la place de l'opérateur — à construire si confirmé nécessaire. |
| 04/07/2026 | **Congés** : décompte en **jours calendaires inclusifs** (`Math.ceil((to-from)/jour)+1`), sans calendrier de jours ouvrés/fériés paramétrable | Le Ch. 19 §19.5 mentionne des « jours fériés et calendriers paramétrables par pays » comme une ambition régionale, non un prérequis du Lot 6 ; le décompte simple reste correct pour l'usage immédiat (un seul pays, le Cameroun) et documenté comme simplification à affiner si l'ambition régionale se concrétise. |
| 04/07/2026 | **Confidentialité du dossier RH** (Ch. 19 §19.2) : module `rh_confidentiel` séparé (salaire de base, notes), consultation journalisée via l'action d'audit `view_sensitive` déjà existante | Réutilise exactement le mécanisme déjà en place pour le juridique (Ch. 9 §9.11, `contracts.ts`) plutôt que d'inventer un second système de traçabilité des accès sensibles. |
| 04/07/2026 | **Tableau de bord Direction générale** (Ch. 5 §5.1) : n'écrit rien, agrège uniquement les données déjà exposées par les modules opérationnels (manuscrits, tâches, ventes, finances) | Conforme au Ch. 5 §5.1 : « le module Direction générale lit les données de tous les modules, n'écrit que ses propres artefacts ». Le volet financier de ce tableau de bord reste masqué (`null`) pour un utilisateur sans `finance:consultation`, cohérent avec la restriction déjà posée au Lot 5. |
| 04/07/2026 | **Simulation de tirage** (Ch. 20 §20.6) : croise le dernier devis d'impression chiffré (`print_quotes.amounts`) avec le rythme de vente des 30 derniers jours (`invoice_lines`) — aucune donnée de simulation pour un ouvrage sans devis chiffré (`total_cost: null`) | Réutilise les données déjà saisies aux lots 3 (devis) et 5 (facturation) sans dupliquer de saisie ; le cas « aucun devis » est un résultat normal (pas une erreur), documenté par un test dédié. |

**20 nouveaux tests automatisés** (109 au total, tous verts) : création de dossier collaborateur avec compte et notification du responsable, désactivation immédiate et paresseuse (délai réel) à la date de départ, suspension/réactivation, accès aux données confidentielles restreint et journalisé, attribution/retrait de rôle avec justification, détection d'anomalie d'accès, campagne de revue des habilitations avec décision par réviseur, circuit de demande de congé avec décompte du solde et refus d'une double décision, permissions par rôle sur les nouveaux modules, calcul du tableau de bord Direction avec masquage financier selon permission, recherche globale, alertes avec priorités valides, génération idempotente des recommandations et traitement, calcul d'indicateur avec définition/formule, génération d'un rapport standard avec historique, création/calcul/rejet d'une analyse personnelle, simulation de tirage sans devis existant.

**Frontend** : trois écrans ajoutés (`HrPage`, `DirectionPage`, `ReportsPage`), suivant le même style que les écrans des lots précédents (cartes, formulaires par invites navigateur pour les identifiants d'entités liées faute de sélecteurs dédiés — même limitation déjà acceptée dans `FinancePage`). Vérifiés en navigateur (Playwright) : connexion, navigation vers les trois écrans, génération d'un rapport standard avec affichage des lignes, génération des recommandations — aucune erreur console au-delà du bruit habituel (favicon, vérification de session avant connexion).

## Présence temps réel (Socket.IO) — 07/07/2026

| Date | Choix | Raison |
|---|---|---|
| 07/07/2026 | **Socket.IO attaché au serveur HTTP de Fastify** (`attachPresence(app.server)` dans `server.ts`), même port que le trafic HTTP | Sur Scalingo tout le trafic passe par un seul `$PORT` ; pas de serveur ni de port dédié. La socket est authentifiée par le **cookie de session existant** (`verifySessionToken`), sans toucher au RBAC. |
| 07/07/2026 | **État de présence en mémoire, mono-instance** (`lib/presence.ts`) : une `Map` socket → { userId, pôle, module }, diffusée à chaque changement via `presence:update` | Suffisant pour la recette (1 conteneur web). ⚠️ **En cas de passage à plusieurs conteneurs web** (scaling horizontal / `WEB_CONCURRENCY > 1`), la présence ne serait plus cohérente entre instances : il faudrait un **adaptateur partagé** (`@socket.io/redis-adapter` + **addon Redis Scalingo**). Repli explicitement accepté par l'opérateur pour ce lot. |
| 07/07/2026 | Événements `presence:join` / `presence:leave` / `disconnect` ; le client émet le pôle+module courant à chaque changement de vue | La déconnexion (`disconnect`, fermeture d'onglet incluse) nettoie l'état pour éviter les voyants « fantômes ». Indicateurs : compteur global en header (utilisateurs connectés), voyant vert par pôle (visible même replié) et par module (au déroulé), badge numérique + info-bulle des noms si plusieurs. |

## Environnements

- **Développement** : Docker Compose local (PostgreSQL + backend + frontend), aucune donnée réelle (Ch. 21 §21.4).
- **Recette** et **Production** : provisionnées chez **Scalingo** (région Paris, D-004-bis), une application Scalingo par environnement, PostgreSQL managé Scalingo pour chacune. Les migrations Prisma et les seeds sont identiques d'un environnement à l'autre.

## Configuration du déploiement Scalingo (05/07/2026)

| Date | Choix | Raison |
|---|---|---|
| 05/07/2026 | **Une seule application déployée** (pas une pour le backend, une pour le frontend) : le frontend compilé (`frontend/dist`) est copié dans `backend/public` au moment du build, et Fastify le sert directement (`@fastify/static`, repli vers `index.html` pour les routes non-`/api/`, `backend/src/app.ts`) | Évite de payer et d'administrer deux applications Scalingo, un buildpack Nginx additionnel et la configuration CORS en production (le frontend et l'API sont servis depuis la même origine) — cohérent avec CLAUDE.md règle 6 (stack économe, pas de dépendance exotique). Le CORS dev (`FRONTEND_ORIGIN`, Vite sur le port 5173) reste inchangé pour le développement local. |
| 05/07/2026 | `package.json` et `Procfile` à la **racine du dépôt** (nouveau) : `npm run build` construit le frontend (avec `VITE_API_BASE=` vide pour des appels API en chemin relatif, donc même origine en production), puis le backend, puis copie `frontend/dist` vers `backend/public` ; `Procfile` définit `web: node backend/dist/server.js` et `postdeploy: npm --prefix backend run prisma:deploy` | Scalingo détecte un buildpack Node.js à la racine du dépôt et exécute automatiquement le script `build` du `package.json` racine ; le hook `postdeploy` (Procfile) applique les migrations Prisma après chaque déploiement réussi, dans un conteneur à usage unique, avant que le nouveau code ne serve du trafic. |
| 05/07/2026 | `prisma` **et** `tsx` déplacés de `devDependencies` vers `dependencies` dans `backend/package.json` | Scalingo élague les `devDependencies` après la construction ; sans ce déplacement, la commande `prisma migrate deploy` (hook `postdeploy`) et le seed (`tsx prisma/seed.ts`, voir ligne suivante) échoueraient faute de trouver leur paquet dans l'image finale servie. |
| 05/07/2026 | **Seed ajouté au hook `postdeploy`** : `postdeploy: npm --prefix backend run prisma:deploy && npm --prefix backend run seed:deploy` (nouveau script `seed:deploy` = `tsx prisma/seed.ts`, sans `--env-file`, les variables venant de l'environnement Scalingo) | Sans le seed, une base Scalingo neuve n'aurait ni données de référence (17 départements, rôles, permissions — Ch. 3) ni compte administrateur : l'application serait vide et personne ne pourrait se connecter. Le seed est **entièrement idempotent** (20 `upsert`, aucune suppression, aucune remise à zéro de données opérationnelles) donc sans danger à rejouer à chaque déploiement — il resynchronise seulement les données de référence canoniques. Le compte administrateur utilise `update: {}` : son mot de passe n'est **jamais** réécrit par un redéploiement une fois modifié depuis l'interface (vérifié par test — voir ci-dessous). |
| 05/07/2026 | Vérifié en local (conditions Scalingo, variables d'environnement seules) : le seed s'exécute sans fichier `.env` ; connexion réelle de l'administrateur réussie (HTTP 200) ; après relance du seed avec un **autre** `ADMIN_INITIAL_PASSWORD` (simulation d'un redéploiement), l'ancien mot de passe reste valide (200) et le nouveau est refusé (401) — confirme que le mot de passe admin déjà en place n'est jamais réinitialisé | Garantit qu'un redéploiement de routine ne peut pas rouvrir une faille en réactivant un mot de passe par défaut connu. |
| 05/07/2026 | Vérifié en local (simulation des commandes Scalingo) : `npm run build` à la racine, puis démarrage par `node backend/dist/server.js` avec les seules variables d'environnement (pas de fichier `.env`, comme sur Scalingo) : API (`/api/v1/health`), page d'accueil (`index.html`), route cliente du frontend (`/manuscripts/...` → repli SPA), fichier statique (`/assets/...`), 404 JSON explicite sur une route `/api/` inconnue — tous corrects. 109 tests automatisés toujours verts après ce changement. | Confirme que la configuration fonctionne avant la première tentative de déploiement réelle chez Scalingo, sans attendre que l'opérateur découvre un problème en production. |

### Stockage des documents (GED) — RÉSOLU (07/07/2026) : stockage objet S3

**Historique du point bloquant :** `backend/src/lib/storage.ts` écrivait les fichiers déposés (contrats, BAT, visuels...) sur le **disque local** du conteneur, éphémère chez Scalingo — perdus à chaque redéploiement, ce qui violait la contrainte « versionnage de tous les documents » (CLAUDE.md règle 3).

**Résolu (07/07/2026, PR « stockage S3 ») :** `storage.ts` bascule automatiquement sur un **stockage objet compatible S3** dès que les variables `S3_BUCKET` + clés + (`S3_ENDPOINT` ou `S3_REGION`) sont configurées ; sinon repli sur le disque local (dev/test). Signatures `storeFile`/`readStoredFile` inchangées (appelants non impactés, comme prévu au 04/07). Client `@aws-sdk/client-s3` (compatible tout fournisseur S3).

| Date | Choix | Raison |
|---|---|---|
| 07/07/2026 | Fournisseur : **Scaleway Object Storage** (région Paris `fr-par`) | Décision opérateur. Français, compatible S3, économique, durable sur plusieurs années (durabilité ~11 nines), cohérent avec l'écosystème européen (Scalingo, Brevo). Alternatives équivalentes : OVH, AWS S3. |
| 07/07/2026 | Routage disque vs S3 sans nouveau champ en base : une **clé d'objet S3 ne commence jamais par `/`**, un chemin disque si | Permet à `readStoredFile` de relire les anciens fichiers disque (dev) comme les objets S3 (prod) à partir du seul champ `file_path` existant. |
| 07/07/2026 | Vérifié par test automatisé (`tests/storage-s3.test.ts`) contre un serveur S3 compatible en mémoire (`s3rver`) : dépôt → clé d'objet → relecture identique | Le chemin S3 est couvert en continu, sans dépendre d'un fournisseur réel ; le chemin disque reste couvert par les tests documents/BAT existants. **120 tests au total, tous verts.** |

**À faire avant la mise en service des pièces jointes réelles :** l'opérateur crée un bucket Scaleway + des clés API, et configure les 5 variables (`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`) sur Scalingo. Recommandé pour les pièces légales critiques : activer le **versionnage du bucket** côté Scaleway (copie de sécurité supplémentaire).

### Variables d'environnement à configurer sur Scalingo

| Variable | Origine | Remarque |
|---|---|---|
| `DATABASE_URL` | Injectée automatiquement par l'addon PostgreSQL Scalingo | Aucune action requise |
| `PORT` | Injectée automatiquement par Scalingo | Aucune action requise (le code lit déjà `process.env.PORT`) |
| `SESSION_SECRET` | À définir manuellement, une valeur différente par environnement (recette ≠ production) | Secret d'application (`scalingo env-set` ou tableau de bord) |
| `ADMIN_INITIAL_PASSWORD` | À définir manuellement **avant le premier déploiement**, valeur forte | Mot de passe du compte `admin` créé par le seed. Sans effet une fois le mot de passe changé depuis l'interface. À défaut, une valeur par défaut connue (`ChangeMoiImmediatement!`) est utilisée — à éviter. |
| `FRONTEND_ORIGIN` | Optionnelle, sans effet utile en production (même origine) | Peut rester non définie |
| `UPLOAD_DIR` | Optionnelle | Voir point bloquant ci-dessus avant toute donnée réelle |

## Envoi d'e-mails « documents » et identité de l'expéditeur (Phase A — 10/07/2026)

Les factures, avoirs et relevés de droits peuvent être envoyés par e-mail depuis
l'ERP (le corps du message EST le document, mis en page sur le papier à en-tête).
Boîtes du personnel hébergées chez **Hostinger** (domaine de la maison).

**Décision d'implémentation (délivrabilité).** Un serveur SMTP n'expédie qu'au
nom d'une adresse qu'il **authentifie** ; il refuse d'« usurper » une adresse
tierce (sinon SPF/DKIM échouent et le message part en indésirable). On ne peut
donc pas mettre en « De » l'adresse de chaque pôle si l'ERP se connecte avec une
seule boîte. Choix retenu, robuste et sans configuration exotique :

- **De (From)** = boîte authentifiée du domaine de la maison (`SMTP_FROM`), avec
  un **nom affiché** identifiant l'agent/pôle (`SMTP_FROM_NAME` — marque + nom de
  l'utilisateur connecté).
- **Répondre à (Reply-To)** = e-mail **professionnel de l'utilisateur connecté**
  (`request.user.email`). Toute réponse arrive donc dans la boîte du bon pôle,
  même si le pôle possède 2-3 adresses : c'est celle de la personne réellement
  connectée qui reçoit les réponses.
- **Copie invisible (BCC)** = `SMTP_ARCHIVE_TO` (défaut : `SMTP_FROM`) — la maison
  conserve une copie de chaque envoi (« joindre le mail officiel de la maison »).

Cette approche fonctionne dès aujourd'hui avec Hostinger sans réglage particulier.
*Évolution possible* si l'on veut que le « De » porte réellement l'adresse du
pôle : créer une boîte SMTP par pôle (identifiants distincts) ou activer un envoi
« send-as » côté Hostinger — décision d'exploitation à valider avec l'opérateur,
non requise pour le fonctionnement.

### Variables SMTP (à renseigner sur Scalingo — jamais dans le code ni le dépôt)

| Variable | Valeur Hostinger | Remarque |
|---|---|---|
| `SMTP_HOST` | `smtp.hostinger.com` | — |
| `SMTP_PORT` | `465` (SSL) ou `587` (STARTTLS) | Le code active TLS automatiquement si port 465 |
| `SMTP_USER` | Adresse complète de la boîte d'envoi (ex. `contact@…`) | Boîte du domaine de la maison chez Hostinger |
| `SMTP_PASS` | Mot de passe de cette boîte | **Secret** : saisir directement dans Scalingo, jamais en clair dans le chat/dépôt |
| `SMTP_FROM` | Adresse affichée en « De » | Généralement identique à `SMTP_USER` |
| `SMTP_FROM_NAME` | Nom affiché par défaut (ex. `Éclosion Édition`) | Optionnelle |
| `SMTP_ARCHIVE_TO` | Adresse conservant une copie invisible | Optionnelle (défaut : `SMTP_FROM`) |

Tant que ces variables ne sont pas définies, l'envoi est **simulé** (journalisé)
en développement et refusé explicitement en production (code `mail_not_configured`,
message clair), conformément à la règle « erreurs explicites ».

### Alertes par e-mail branchées sur les notifications (Phase A — 10/07/2026)

Le modèle `Notification` prévoyait déjà un canal `email`. Les alertes sont
désormais **doublées d'un e-mail** pour les niveaux **`high` et `critical`**
uniquement (stock critique, encours dépassé, BAT/impression en retard, droits…),
afin de ne pas noyer les boîtes sous les notifications de routine. Les
notifications de tout niveau restent visibles dans la cloche de l'application.

- Point d'ancrage unique : `lib/notify.ts` → `notifyRole()`. Après création des
  notifications in-app, si la priorité est importante/critique **et** que le SMTP
  est configuré, un e-mail (papier à en-tête, bandeau de priorité aux couleurs de
  l'identité) est envoyé à l'adresse professionnelle de chaque destinataire
  **actif**. Les rangées concernées sont tracées `channel = email`, `sent_at`.
- **Meilleur effort** : l'envoi est encapsulé, une panne d'e-mail est journalisée
  puis ignorée — elle ne doit jamais interrompre l'opération métier (vente, BAT,
  stock) qui a déclenché l'alerte. Sans SMTP configuré, on ne tente rien (la
  cloche in-app suffit) : pas de faux marquage `email`.
- Constructeur d'e-mail : `buildNotificationEmail()` dans `lib/documentEmail.ts`.
  Tests : `tests/notification-email.test.ts`.

## Centre de Communication Interne — Babillard d'annonces (14/07/2026)

### Nouvelle dépendance : `sanitize-html`
- **Choix** : `sanitize-html` (+ `@types/sanitize-html`) pour assainir le contenu
  enrichi des annonces (mise en forme, listes, tableaux, liens, images) **avant
  stockage**. Bibliothèque éprouvée et largement adoptée (pas une dépendance
  exotique) ; l'alternative — écrire un assainisseur HTML maison — est un
  anti-patron reconnu (source classique de failles XSS).
- **Justification** : le contenu est saisi par des profils habilités mais
  **affiché à tout le personnel**. On ne fait jamais confiance au HTML reçu :
  liste blanche stricte de balises, schémas limités à http/https(+mailto),
  `rel="noopener noreferrer nofollow"` forcé, aucun `<script>/<style>/<iframe>`
  ni gestionnaire d'événement. Wrapper : `lib/announcementHtml.ts`.

### Réutilisation de l'existant (aucune table modifiée)
- **Cloche** : à la publication, on crée une ligne `Notification` (type `annonce`)
  par destinataire → le badge existant fonctionne sans réécriture. Helper
  `notifyUsers()` ajouté à `lib/notify.ts` (miroir de `notifyRole()`), respectant
  la préférence e-mail par utilisateur (nouvelle table `notification_preference`).
- **Pièces jointes** : réutilisent le stockage versionné/immuable `Document`.
- **Ciblage polymorphe** (`target_type` + `target_id`) sur le modèle
  `entity_type/entity_id` déjà employé (Notification, Document, AuditLog).
  Résolution de l'audience côté serveur : `lib/announcements.ts` → `resolveAudience()`.
- **Audit** : mapping sur l'enum existant (publication/archivage → `status_change`,
  consultation → `view_sensitive`, accusé de réception → `validate`) plutôt que
  d'ajouter des valeurs — impact minimal, cohérent avec le reste du code.

### Vidéos
- Gérées **par lien** (http/https) en v1 plutôt qu'hébergées, pour rester
  compatible avec une connexion modeste (contrainte du projet).

## Cloisonnement de la Production — droits par métier (20/07/2026)

### Constat (signalé par l'opérateur)
- Un compte cumulant plusieurs rôles (RH + Communication + **Juridique**)
  pouvait **ouvrir les modules Production** (Maquette, Infographie, ISBN, BAT,
  Impression), alors qu'aucun rôle « Production » ne lui était attribué.

### Cause
- Les entrées de menu Production étaient gardées par le droit **générique**
  `manuscripts:consultation`. Or le **Responsable juridique** a ce droit pour une
  raison légitime (consulter les manuscrits liés aux **contrats**) — il ouvrait
  donc aussi la Production par effet de bord. Le cumul de postes (effectif
  réduit) rendait le problème visible.

### Correctif
- Chaque module Production dépend désormais du droit **métier** correspondant,
  et non plus de `manuscripts:consultation` :
  Maquette / Infographie → `production:consultation` ; ISBN → `isbn:consultation`
  ; BAT → `bat:consultation` ; Impression → `printing:consultation`.
- Ainsi le **juridique garde ses Contrats** (via `manuscripts:consultation`) mais
  **n'accède plus à la Production**. Vérifié : RESP_JURIDIQUE ne voit aucun module
  Production ; chaque métier ne voit que le sien.
- **Supervision préservée** : la Direction générale et éditoriale reçoivent dans
  le seed les droits de vue Production qui leur manquaient
  (`production/isbn/bat/printing:consultation`) — elles gardent la vue complète.
- Défense en profondeur inchangée (le garde `isbn:consultation` etc. s'applique
  aussi à l'ouverture, pas seulement au menu).
- Tests (`users-roles.test.ts`) : juridique garde `manuscripts:consultation`
  mais aucun droit de vue Production ; la direction éditoriale les a tous.

### Rappel (cause récurrente)
- Plusieurs comptes cumulent 2–3 rôles. **Chaque rôle ajoute ses accès.** Ce
  correctif traite le cas juridique↔production ; le principe reste « un rôle par
  métier », sauf cumul réellement voulu.

## Connexion : robustesse au clavier mobile (19/07/2026)

### Constat (blocage opérateur)
- Après avoir réinitialisé le mot de passe d'un compte, la connexion échouait
  (« Identifiants invalides ») alors que le compte était bien actif.

### Cause probable
- Deux pièges du **clavier mobile** :
  1. Les champs mot de passe de l'**administration** (création de compte,
     réinitialisation) sont en `type="text"` (l'admin doit voir la valeur pour la
     communiquer). Or un champ texte déclenche la **correction/majuscule
     automatique** : le mot de passe **enregistré** pouvait différer de celui
     tapé (espace ajouté, lettre capitalisée…), alors que le champ de connexion
     (`type="password"`) ne corrige pas → les deux ne correspondaient plus.
  2. L'identifiant à la connexion était comparé **exactement** (casse + espaces).
     Un « Noah » saisi « noah » (minuscule auto) ou « Noah  » (espace) échouait.

### Correctif
- **Frontend** : `autoCapitalize="off" autoCorrect="off" autoComplete="off"
  spellCheck={false}` sur les champs identifiant + mot de passe (création,
  réinitialisation, connexion) → le clavier ne modifie plus la saisie.
- **Backend** : identifiant **rogné** (trim) et **insensible à la casse** à la
  connexion (`mode: "insensitive"`), ainsi qu'au create/patch. Le **mot de
  passe n'est jamais rogné** (un espace peut être voulu).
- **Réparation des comptes existants** : un espace **déjà enregistré** dans
  l'identifiant n'est PAS rattrapé par l'insensibilité à la casse (elle ignore la
  casse, pas les espaces — vérifié en reproduction). Le seed rogne donc les
  identifiants/e-mails déjà en base (uniquement si la valeur nettoyée reste
  unique). Le seed étant rejoué au déploiement, un compte « `Noah ` » redevient
  « `Noah` » et se connecte à nouveau (après une réinitialisation du mot de passe
  dans le champ désormais non corrigé, si le mot de passe avait aussi été altéré).
- Tests (`auth.test.ts`) : connexion avec casse différente / espaces autour de
  l'identifiant → OK ; mot de passe avec espace en trop → refusé.

## Comptes : réutiliser un e-mail/identifiant après suppression (19/07/2026)

### Constat (blocage opérateur)
- À la création d'un compte, une **erreur technique brute** s'affichait :
  « Invalid `prisma.user.create()` … Unique constraint failed on the fields:
  (`email`) ». Impossible de créer le compte du DG.

### Cause
- `username` et `email` sont `@unique` **en base** (indépendamment de la
  suppression logique). Or les pré-contrôles ne regardaient que les comptes
  **non supprimés** (`deletedAt: null`). Un compte **supprimé** occupait donc
  encore l'e-mail : le pré-contrôle passait, puis `create()` heurtait la
  contrainte d'unicité → erreur Prisma **non capturée**, affichée telle quelle
  (contraire à la règle §5 : erreurs explicites, jamais techniques).

### Correctif
- **Suppression** (`DELETE /users/:id`) : la suppression reste **logique** (la
  ligne et l'audit sont conservés) mais l'identifiant et l'e-mail sont
  **libérés** — suffixés `#supprimé-<id>` — pour être réutilisables. Les valeurs
  d'origine sont tracées dans l'audit.
- **Création / modification** : avant d'écrire, `releaseDeletedIdentifiers()`
  libère l'e-mail/identifiant encore détenus par d'éventuels comptes **supprimés**
  (corrige aussi les comptes supprimés **avant** ce correctif, comme le compte
  Noah). Filet de sécurité : toute violation d'unicité résiduelle (`P2002`) est
  convertie en **message clair en français** (409), jamais d'erreur brute.
- Un e-mail/identifiant détenu par un compte **actif** reste refusé (409) comme
  avant — on ne libère que des comptes supprimés.
- Tests (`users-roles.test.ts`) : réutilisation d'e-mail+identifiant après
  suppression → 201 ; collision avec un compte actif → 409 sans texte « prisma ».

## Cloisonnement des pôles — droits RH et Rapports resserrés (19/07/2026)

### Constat (signalé par l'opérateur)
- Un compte **Responsable commercial** voyait le module **Ressources humaines**
  et **Rapports**. Vérifié en reproduisant : ce n'était **ni** un bug
  d'usurpation d'identité (« Se connecter en tant que » fonctionne : elle
  abaisse bien les droits à ceux de la cible), **ni** un défaut d'affichage — le
  **rôle lui-même** portait `rh:consultation` et `rapports:consultation`.
- Origine : le seed accordait ces deux droits à **tous les responsables de
  service** (élargissement §19.4 : « revue des accès de leur équipe »). Les
  données confidentielles (salaires `rh_confidentiel`, chiffres `finance`)
  restaient, elles, protégées.

### Décision (opérateur, dérogation assumée à §19.4)
- On **cloisonne** : un responsable opérationnel ne voit **que son pôle**.
  - `rh:consultation` → réservé à **RESP_RH** et **DIR_GENERAL** (retour au
    §19.2 : « réservé au responsable RH et à la Direction »).
  - `rapports:consultation` → réservé aux profils de **pilotage/supervision**
    (DIR_GENERAL, DIR_EDITORIAL, RESP_FINANCE, RESP_RH).
  - Retiré à : RESP_COMMERCIAL, RESP_INFOGRAPHIE, RESP_QUALITE, RESP_IMPRESSION,
    RESP_JURIDIQUE. `presences:consultation` (chacun voit les siennes) et
    `communication:consultation` (comms internes) restent ouverts à tous.

### Mise en œuvre — correction aussi des bases déjà semées
- Nouveau helper `revoke(role, keys)` dans le seed (miroir de `grant`) : `grant`
  est idempotent mais ne **retire** jamais. Les listes `hrConsultRoles` /
  `reportRoles` accordent aux rôles retenus et **révoquent** aux autres. Le seed
  restant idempotent (rejoué à chaque `pretest`), **le rejouer corrige une base
  existante** — c'est ainsi que la production applique le resserrement.
- Correctif possible aussi **sans redéploiement** via l'écran **Administration →
  « Droits & pôles »** (`POST /api/v1/roles/:id/permissions`, `users:administration`).
- Tests (`users-roles.test.ts`) : un Responsable commercial / infographie n'a
  **ni** `rh:consultation` **ni** `rapports:consultation` (mais garde son
  métier) ; RH et Direction les conservent.

### Navigation « tout visible, gardé à l'ouverture » (choix opérateur)
- Choix de présentation retenu par l'opérateur : **tous les pôles de la maison
  s'affichent dans le menu pour tout le monde** (on montre la structure de
  l'organisation), mais **on n'accède qu'à son pôle**. Ouvrir un module hors
  périmètre affiche un écran **« Accès non autorisé »** nommant le pôle — au lieu
  de masquer le module (comportement précédent). C'est un modèle *discoverable
  but gated*, complémentaire du cloisonnement des droits ci-dessus.
- Mise en œuvre (frontend) : `Sidebar` n'écarte plus les modules non autorisés —
  ils restent affichés avec un **cadenas** et un texte atténué (toujours
  cliquables). `App` calcule `isLeafAuthorized(cle, permissions, roles)` à partir
  des `permission`/`role` déclarés par chaque entrée de menu ; si l'utilisateur
  n'y a pas droit, l'ouverture rend `UnauthorizedView` au lieu du contenu.
- **Défense en profondeur inchangée** : le contrôle serveur (`requirePermission`,
  403) reste la source de vérité — l'écran « Accès non autorisé » n'est qu'un
  garde-fou d'interface qui évite d'afficher une page vide/en erreur. Les
  **données** (indicateurs financiers, dossiers RH…) restent, elles, gardées par
  permission : la structure est visible, pas les données d'un autre pôle.

## Tableau de bord d'accueil enrichi — grands indicateurs (19/07/2026)

### Objectif
- La page d'accueil ne montrait que 4 totaux bruts (ouvrages, utilisateurs,
  ventes, stock). On en fait un vrai **coup d'œil de pilotage** : ouvrages en
  cours, tâches en retard, chiffre d'affaires, ruptures de stock, et une frise
  visuelle **« pipeline éditorial »** (nombre d'ouvrages par étape du workflow).

### Réutilisation de la source unique (`lib/kpi.ts`)
- L'endpoint `GET /api/v1/dashboard/stats` s'appuie sur `editorialIndicators()`
  (total + répartition par étape) et `commercialIndicators()` (chiffre
  d'affaires + ruptures) — **mêmes formules** que les tableaux de bord Direction
  et Rapports, pas de recalcul divergent. Les comptages restants (utilisateurs,
  commandes, stock physique, tâches en retard) sont des requêtes légères, la
  page d'accueil étant ouverte par tous à chaque connexion.
- **Ouvrages en cours** = total moins les archivés, **dérivé de la frise** (sans
  requête supplémentaire). Le **pipeline** ne renvoie que les étapes portant au
  moins un ouvrage, dans l'ordre du workflow.

### Confidentialité par module (inchangée)
- Chaque indicateur n'est calculé et renvoyé que si l'utilisateur a la
  permission de consultation correspondante (`manuscripts`, `users`,
  `commercial`, `stock`, `direction`) — sinon `null`, et la carte n'apparaît
  pas. Les indicateurs restreints (CA, ruptures, tâches en retard) restent
  masqués pour un profil sans le droit correspondant.

### Rendu (guide de style)
- Grands chiffres en **police à chasse fixe** ; ton **orange** si tâches en
  retard > 0, **rouge** si ruptures > 0 (code couleur retard/critique du guide).
  Montants en **notation compacte** (« 78,2 M XAF ») sur les cartes — lisibles
  d'un coup d'œil et sans débordement sur mobile ; le chiffre exact reste sur la
  page Direction. Séparateurs de milliers insécables : les nombres ne se coupent
  jamais en cours de chiffre.

## ERP → site vitrine : fiche prête à publier (17/07/2026)

### Contexte : site sur-mesure, sans API
- Vérification faite avec le développeur : le site **n'est pas WordPress**
  (PHP + React sur-mesure) et **n'expose aucune API** de publication (le
  e-commerce est une option payante non souscrite). La publication automatique
  supposerait une entrée API côté site, jugée difficile par le développeur.
- **Décision opérateur** : au lieu d'automatiser, l'ERP **prépare une fiche
  prête à copier** que le maquettiste colle sur le site (comme il ajoute déjà
  les ouvrages). Zéro dépendance, zéro accès direct au site en production (qui
  serait risqué et de toute façon injoignable depuis l'environnement de dev).

### Mise en œuvre
- `lib/sitePublisher.ts` : `buildFichePayload` (données de l'ouvrage) →
  `formatFiche` (texte prêt à coller). `setSitePublished` mémorise l'état
  (`SitePublication` : publié/non + lien de la fiche en ligne + date/auteur),
  pour que l'ERP garde la trace de ce qui est sur le site. L'ancien adaptateur
  WooCommerce a été retiré (sans objet ici).
- Le modèle `SitePublication` (déjà en base) est réutilisé tel quel.

### Évolution possible (option ②)
- Si le site expose un jour une entrée API (ou consomme un flux JSON de l'ERP),
  on rebranche la publication automatique : le socle (fiche, suivi, classement
  par genre) est déjà prêt, seule la « porte » d'envoi resterait à ajouter.

### Couverture « prête pour le web » — image légère (19/07/2026)
- Besoin opérateur : le fichier à joindre à la fiche ne doit **pas être lourd** ;
  il doit être **déjà en JPG/PNG**, de **très bonne qualité**. Or la couverture
  déposée dans l'ERP est en **qualité impression** (souvent plusieurs Mo,
  3000+ px), inadaptée au web.
- Mise en œuvre : `GET /api/v1/manuscripts/:id/site-cover` transforme la
  couverture (1re) **à la volée** — sortie **JPG qualité 86** (très bonne
  qualité, fichier léger), servie en **pièce jointe** avec un nom propre
  (`couverture-<titre-slug>.jpg`). La miniature et le lien « Télécharger la
  couverture » de la fiche pointent vers cette version optimisée.
- **Format des vignettes du site (eclosion.cm)** : les couvertures y sont
  affichées en **portrait ≈ 2:3**. On cale donc la sortie dans une boîte
  **1080 × 1600** — proportions **conservées**, **couverture entière** : on ne
  coupe jamais (ni titre ni auteur perdus) et on ne déforme pas. Réduction
  **seule** (jamais d'agrandissement : une couverture déjà petite garde ses
  dimensions). Le site recadre lui-même l'affichage si besoin, comme pour les
  autres ouvrages. `optimizeImage` accepte une boîte `maxWidth × maxHeight`
  (facteur ≤ 1, `min(maxW/w, maxH/h, 1)`), en plus du `maxLongSide` générique.
- **Choix de dépendance : `jimp`** (traitement d'image **100 % JavaScript**,
  aucun binaire natif à compiler). Motif : conforme à la règle « pas de
  dépendance exotique » et à la sobriété — s'installe et tourne **à l'identique**
  sur le poste et sur le cloud (pas de `sharp`/libvips à recompiler par
  plateforme). Le coût CPU de la conversion est ponctuel (au téléchargement) et
  acceptable pour le volume d'un éditeur.
- `lib/imageOptimize.ts` isole le traitement (`optimizeImage`, downscale-only) ;
  `optimizedCoverForSite` (dans `lib/sitePublisher.ts`) lit le fichier stocké
  (`readStoredFile`, disque en dev / S3 en prod) et applique l'optimisation. Un
  format source non décodable (ex. PDF) renvoie une erreur explicite `422`
  (`unsupported_image`) plutôt qu'un fichier cassé ; une couverture non-image
  affiche un message dans la fiche.

## Signalement de clôture d'activité mensuelle — RH (17/07/2026)

### Jour de clôture paramétrable, rappels relatifs
- L'activité d'un mois civil se clôture le **jour de clôture du mois suivant**,
  **paramétrable** (défaut 10, bornes 3–28) et stocké dans `settings`
  (`activity_closure_day`, valeur JSON). Les **jours de rappel se déduisent**
  toujours du jour de clôture : jour-2 et jour-1 (« 1 à 2 jours avant »).
  Modifier le jour recalcule donc les rappels automatiquement.

### Génération paresseuse (pas de planificateur)
- Cohérent avec le reste du projet (cf. balayage des annonces expirées) : aucun
  cron. Les rappels sont générés au fil des ouvertures de l'ERP par un
  responsable — hook fire-and-forget sur `/api/v1/me` (pour les titulaires de
  `rh:/paie:/direction:consultation`) et sur la rubrique RH. L'opérateur a
  retenu ce mode « sans infrastructure » ; un vrai planificateur Scalingo
  resterait possible en évolution (envoi garanti sans connexion).

### Idempotence
- Table `payroll_closure_reminders` avec unicité `(period_key, reminder_day)` :
  le marqueur est créé **avant** la notification, donc un seul appel notifie même
  si plusieurs responsables ouvrent l'ERP simultanément. `reminder_day = 0`
  marque un envoi **manuel**. Aucun rappel si une `PayrollClosure` existe déjà
  pour la période.

### Réutilisation
- Notifications via `notifyUsers` (cloche + e-mail, priorité `high`, type
  `echeance`), destinataires = union des rôles `RESP_RH`, `RESP_FINANCE`,
  `DIR_GENERAL`. Aucune table existante modifiée.

## Application installable — PWA (16/07/2026)

### Pas d'application « à télécharger » sur un store : une PWA
- **Choix** : rendre le frontend **installable** (Progressive Web App) plutôt que
  de fabriquer une application native Android/iOS. L'utilisateur ouvre l'URL de
  l'ERP et « ajoute à l'écran d'accueil » : une icône au logo Eclospace apparaît
  et l'application se lance en plein écran, comme une app.
- **Justification** : une app native imposerait un second code (Kotlin/Swift ou
  un wrapper), des comptes de store, des cycles de revue et des mises à jour
  séparées — l'opposé de la règle n°6 (simplicité, économie). La PWA réutilise
  exactement le même code déjà déployé ; « installer » et « mettre à jour » se
  font tout seuls via le web. Aucune dépendance ajoutée (pas de `vite-plugin-pwa`).

### Composants (tous statiques, servis à la racine)
- `public/manifest.webmanifest` : nom, `display: standalone`, couleurs de marque
  (thème marine `#16233D`, fond `#F8F9FB`), icônes.
- **Icônes** générées **à partir du logo** (`eclospace-logo.jpg`) avec le
  Chromium déjà présent (Playwright) — aucun outil image installé n'était requis :
  `icon-192`, `icon-512`, `icon-maskable-512` (marge « safe zone » pour le masque
  Android), `apple-touch-icon` (180, iOS), et un favicon monogramme doré « E »
  (net à petite taille). Logo centré sur fond blanc, fidèle à son rendu natif.
- `public/sw.js` : service worker **minimal**. Navigation en réseau-d'abord avec
  repli sur la coquille en cache (hors ligne) ; **l'API (`/api/*`) n'est jamais
  mise en cache** (un ERP montre l'état réel). Enregistré depuis `main.tsx`
  uniquement en production, au meilleur effort.
- `index.html` : `theme-color`, `manifest`, `apple-touch-icon`, métadonnées iOS.

### Vérification
- Build servi en HTTP puis inspecté dans Chromium : manifeste détecté, 3 icônes,
  `display: standalone`, **service worker actif (« activated »), portée racine** —
  critères d'installabilité réunis. Aucune erreur console.

## Durcissement de l'architecture — frontières entre couches (16/07/2026)

### Un test plutôt qu'un plugin de lint
- **Choix** : imposer les frontières entre couches par un **test Vitest**
  (`tests/architecture.test.ts`) qui parcourt le graphe d'imports, plutôt que
  d'ajouter ESLint + `eslint-plugin-boundaries` (le projet n'a pas d'ESLint).
- **Justification** : la règle n°6 du projet interdit les dépendances exotiques
  et privilégie l'économie. Le test réutilise l'outil déjà en place (Vitest +
  `node:fs`), n'ajoute **aucune dépendance**, tourne avec la suite (donc en CI),
  et documente les invariants sous forme exécutable. Il couvre les trois formes
  d'import (`from`, `import()` dynamique, `import "…"` à effet de bord).

### Invariants imposés (couches, de la plus basse à la plus haute)
- `lib/` = règles métier et utilitaires partagés — **ne connaît pas** les routes.
- `routes/` = points d'entrée HTTP — orchestrent, s'appuient sur `lib/`.
- `app.ts` / `server.ts` = assemblage et démarrage — **personne ne les importe**.
- Règles : (1) `lib/` ne dépend jamais d'une route ; (2) une route n'importe
  jamais une autre route (le partagé passe par `lib/`) ; (3) ni `lib/` ni
  `routes/` n'importent l'assemblage.

### Ce que les cross-imports entre domaines restent autorisés
- Un `lib/` peut en importer un autre (ex. `commercial` s'appuie sur
  `lib/finance` pour l'encours — cohérent et documenté). L'invariant ne cloisonne
  **pas** les domaines entre eux ; il impose le **sens des dépendances** (pas de
  montée de couche, pas de route→route), ce qui est la vraie cause d'un code qui
  se dégrade avec le temps.

### Correction associée
- `computeIsbnCompleteness` (règle de complétude ISBN, Ch. 12) vivait dans
  `routes/isbn.ts` et était tirée par `routes/workflow.ts` et `routes/bat.ts`
  (route→route). Déplacée dans `lib/isbnCompleteness.ts` ; comportement inchangé.

## Centre de Communication Interne — Bulletin d'actualités / Newsletter (15/07/2026)

### Périmètre « maison » du digest (confidentialité)
- Un bulletin est **envoyé à tout le personnel** ; le compilateur
  (`lib/newsletters.ts` → `compileNewsletter`) n'agrège donc **que** les
  actualités explicitement destinées à « tous » : annonces publiées ciblées
  `tous` + événements ciblés `tous`, sur la période. Un contenu ciblé sur un
  pôle/rôle/personne ne remonte **jamais** dans un bulletin général — cohérent
  avec la règle « ne pas exposer à un pôle ce qui concerne un autre ».

### Instantané figé à l'envoi (immuabilité de ce qui a été diffusé)
- À l'envoi, on **fige** la liste compilée dans `items_snapshot` (JSON) et on
  enregistre `sent_at` + `recipients`. Un bulletin envoyé est **verrouillé** :
  ni modifiable ni renvoyable (409). La consultation d'un bulletin envoyé montre
  l'instantané (ce qui a réellement été diffusé), pas une recompilation qui
  divergerait si une annonce est modifiée/supprimée après coup.

### Réutilisation de l'existant (aucune table modifiée)
- **E-mail** : `buildNewsletterEmail` (`lib/documentEmail.ts`) reprend le papier
  à en-tête maison et l'infrastructure `sendMail` ; « Répondre à » = e-mail de
  l'éditeur qui envoie (`senderIdentity`). Envoi au meilleur effort, sans SMTP
  (dev/test) l'e-mail est journalisé.
- **Permissions** : module `communication` réutilisé (consultation pour lire les
  bulletins envoyés, saisie pour composer/envoyer) — aucune nouvelle permission.
- **Audit** : `entity_type = "newsletter"`, mapping sur l'enum existant
  (création → `create`, édition → `update`, envoi/suppression → `status_change`).

## Renforts de sécurité avant version finale (22/07/2026)

Suite à l'audit de l'ERP, trois renforts de sécurité (sans changement fonctionnel visible) :

- **En-têtes de sécurité navigateur** (`@fastify/helmet`) : anti-« clickjacking » (X-Frame-Options), anti-reniflage de type (X-Content-Type-Options : nosniff), HSTS, Referrer-Policy, etc. La **CSP est volontairement désactivée** (`contentSecurityPolicy: false`) : l'interface React utilise des styles en ligne et un service worker (PWA) qu'une CSP stricte casserait ; les autres protections, elles, sont sans risque. À réactiver plus tard avec une politique sur mesure si besoin.

- **Filet d'erreur global** (`app.setErrorHandler`) : toute erreur non rattrapée par une route est convertie en message clair, en français, **sans détail technique** (plus jamais de « Unique constraint failed » à l'écran). Traduit les erreurs Prisma connues (P2002 → 409 « valeur déjà utilisée », P2025 → 404), garde le message métier des erreurs 4xx explicites, et renvoie un message générique pour tout imprévu (5xx) — l'erreur réelle reste journalisée côté serveur.

- **Anti-force brute par compte** (throttle applicatif dans `routes/auth.ts`) : chaque identifiant a son **propre budget d'échecs** (8 échecs → verrou temporaire de 10 min) ; une connexion réussie remet le compteur à zéro. **Choix délibéré du « par compte » plutôt que « par adresse IP »** : au Cameroun, tout un bureau partage souvent une seule connexion Internet (une seule adresse publique) — une limite par IP bloquerait tous les employés d'un coup. Le « par compte » protège chaque compte des essais répétés sans jamais pénaliser les collègues. Stockage en mémoire (suffisant sur une instance web unique ; à porter en base ou Redis si l'app est un jour répartie sur plusieurs instances). `trustProxy` activé pour que l'adresse réelle du visiteur (derrière Scalingo) soit correctement lue dans les journaux.

Tests : `tests/security-hardening.test.ts` (en-têtes présents, filet d'erreur en JSON propre, verrou après trop de tentatives). Typecheck OK.

## Intégration continue + stabilité des tests (22/07/2026)

- **Intégration continue** (`.github/workflows/ci.yml`) : à chaque proposition de fusion (et sur `main`), GitHub lance automatiquement — types (`tsc --noEmit`), **toute la suite de tests** backend sur une base PostgreSQL éphémère (mêmes identifiants que `backend/.env.test`, via `npm test` = migrations + seed + `vitest run`), puis les types et la compilation du frontend. Deux jobs (`backend`, `frontend`), Node 22, cache npm. Objectif : ne jamais fusionner du code qui casse la compilation ou un test métier. `concurrency` annule une exécution devenue obsolète.

- **Stabilité des tests** (`vitest.config.ts`) : délais portés à 30 s (`testTimeout`/`hookTimeout`). Les rares échecs observés étaient des dépassements au « démarrage à froid » (première connexion base, chauffe d'argon2), pas des bugs. Les fichiers s'exécutent déjà en série (`fileParallelism: false`, état partagé de la période comptable).

## Allègement du chargement de l'interface — « code-splitting » (22/07/2026)

Le frontend était livré en **un seul fichier JS** (~732 Ko, ~196 Ko compressé) : au premier accès, tout était téléchargé d'un bloc, pénalisant sur une connexion modeste (contexte Cameroun, CLAUDE.md règle 6).

Découpage par écran via `React.lazy` + `<Suspense>` (`App.tsx`) : chaque page devient un **fragment chargé à la demande**, au moment où l'utilisateur l'ouvre. Seule la page de **connexion** reste chargée d'emblée (porte d'entrée). Un court « Chargement… » s'affiche le temps qu'un écran arrive (généralement une fraction de seconde).

Résultat mesuré (build de production) : **bundle initial 732 Ko → 349 Ko** (compressé **196 Ko → 107 Ko**, ~45 % de moins). Les écrans lourds ne pèsent plus sur le premier accès — ex. RH (76 Ko), fiche manuscrit (67 Ko), Finance (37 Ko) — ils ne se téléchargent qu'à l'ouverture. Aucune dépendance ajoutée (React expose déjà `lazy`/`Suspense`). Vérifié en navigateur (connexion, tableau de bord, navigation vers un écran découpé — sans erreur).

## Sauvegardes et restauration — runbook (22/07/2026)

Nouveau guide d'exploitation `docs/EXPLOITATION_SAUVEGARDES.md`, destiné à l'administrateur de la maison (non-développeur). Couvre les **deux réserves** de données — base PostgreSQL (Scalingo, sauvegardes automatiques quotidiennes) et fichiers/GED (Backblaze B2, versionnage) — avec : où sont les sauvegardes, comment restaurer (production vs base d'essai), le réglage de versionnage Backblaze, une **procédure d'exercice de restauration** à faire au moins une fois puis chaque trimestre (avec relevé du délai de reprise), et le réflexe en cas d'incident réel. Aucune modification de code : c'est de l'exploitation. L'exercice réel se fait côté Scalingo/Backblaze, accompagné pas à pas.

## Vulnérabilités des dépendances — revue avant version finale (22/07/2026)

`npm audit` signalait 6 alertes côté backend (frontend : 0). Analyse de l'origine :

- **`fast-uri` (élevée)** — dépendance transitive de **Fastify** (donc présente en production). Corrigée par `npm audit fix` (non cassant) : `fast-uri` 3.1.3 → **3.1.4**. Seul changement : `package-lock.json`.
- **`fast-xml-parser`, `busboy`, `dicer` (5 alertes restantes)** — toutes issues de **`s3rver`**, un **outil de test uniquement** (serveur S3 fictif, `devDependencies`), qui simule le stockage objet dans `storage-s3.test.ts`. `s3rver` **n'est jamais déployé ni chargé à l'exécution** (aucun `import` hors des tests ; élagué du runtime de production) → **exposition production nulle**. Le seul correctif proposé (`npm audit fix --force`) rétrograderait `s3rver` en 2.2.9 (cassant, casserait le test) pour un risque uniquement en développement : non retenu. À surveiller ; si `s3rver` reste non maintenu, envisager un autre simulateur S3 plus tard.

## Politique de sécurité du contenu (CSP) activée (22/07/2026)

La CSP, laissée désactivée lors de la première passe helmet (pour ne pas risquer de casser l'interface React/PWA), est désormais **activée sur mesure** (`app.ts`). Tout se charge depuis la **même origine** :

- `script-src 'self'` — les scripts ne viennent que de nous (le build ne produit **aucun script en ligne** dans la page, vérifié) : coupe l'essentiel des injections (XSS) ;
- `style-src 'self' 'unsafe-inline'` — nécessaire aux styles en ligne de React (attribut `style=…`), sans risque notable ;
- `img-src 'self' data: blob:` — aperçus d'images, affiches ; `worker-src 'self'` — service worker (PWA) ; `connect-src 'self'` — l'API et la **socket temps réel** (Socket.IO), toutes deux sur la même origine ;
- `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'self'`, `form-action 'self'`.
- `upgrade-insecure-requests` **posé uniquement en production** (HTTPS) : en local (`http://localhost`) il casserait le chargement des fichiers — retiré quand `NODE_ENV ≠ production`.

Vérifié en navigateur (connexion, écrans chargés à la demande, présence temps réel « en ligne », styles intacts) : **aucune violation CSP**. Tests d'en-têtes (`security-hardening.test.ts`) toujours verts.

## Aide intégrée (mode d'emploi par écran) (23/07/2026)

Nouvelle rubrique **« Aide »** dans le menu (accessible à **tout le personnel**, sans droit particulier) : un centre d'aide parcourable qui documente **chaque écran**, organisé **par pôle puis par sous-rubrique**, pour orienter les utilisateurs quand ils bloquent. Chaque entrée donne : *à quoi sert l'écran*, *les actions principales*, et un encart *« Si vous êtes bloqué »* (questions fréquentes + réponses). Une **recherche** filtre l'ensemble (par ex. « facture », « mot de passe ») et déplie automatiquement les résultats. **36 écrans documentés** (dont une section « Pour bien démarrer » : connexion, navigation, codes couleur, recherche/notifications, compte/langue).

Réalisation : contenu séparé et maintenable dans `frontend/src/help/helpContent.ts` (structure par pôle → entrées) ; page `frontend/src/pages/HelpPage.tsx` (accordéon + recherche), **chargée à la demande** (chunk séparé, ~8 Ko compressé) ; intégrée au menu et au routage (`App.tsx`), libellé via i18n (FR par défaut, EN ajouté). Contenu rédigé en français, sans jargon ; les réponses « bloqué » collent aux comportements réels (Accès non autorisé = hors périmètre, facture immuable, BAT verrouillé, ISBN non réutilisé, encours dépassé, période clôturée, journal inaltérable…). Vérifié en navigateur (rendu, recherche, dépliage). Bilingue possible : la coquille est traduite ; le contenu détaillé peut recevoir sa version EN ultérieurement.

## Droits d'auteur : assiette face aux remises + moteur « livre scolaire » (31/07/2026)

**1. Assiette « prix public HT » et remise.** `recordRoyaltyEntry` reçoit déjà `unitPublicPrice` et `unitNetPrice` et choisit selon `royaltyTerms.base`. Le défaut passait `unitPrice` (net) pour les deux ; une remise rognait donc les droits d'un contrat au prix public. Correctif : on conserve le **prix public HT avant remise** sur la ligne de facture (`invoice_lines.unit_public_price`, nullable = pas de remise) et on le fournit comme assiette publique. `createInvoiceFromDelivery` renseigne le prix public (avant `discountPct`) ; retours (`createCreditNoteFromReturn`) et avoirs (`createCreditNoteFromInvoice`) reprennent l'assiette de la ligne d'origine pour contre-passer **exactement** l'entrée de la vente.

**2. Moteur « livre scolaire ».** Le livre scolaire se facture via `BillingOrder` (commande à facturer), jusqu'ici un montant global sans droits. Choix : **détailler la commande par ouvrage** (`billing_order_lines` : ISBN, quantité, prix unitaire HT, `royalty_rate` facultatif) plutôt qu'introduire un contrat par livre — le cahier des charges demande « 12 % quel que soit l'ouvrage ». À la facturation, `createInvoiceFromBillingOrder` génère une **ligne de facture par livre** (les `manuscriptId/format` des lignes restent nuls pour **ne pas** déclencher le moteur « contrat » et éviter le double comptage) puis écrit une **entrée de droits scolaire** par ligne.

Taux (priorité, décision opérateur du 31/07/2026 — **le contrat prime**) : (1) **taux de la ligne** s'il est renseigné ; (2) sinon le **taux du contrat d'édition actif** du livre s'il en existe un (`contractRateFor` : contrat `edition/coedition` actif dont `formats` couvre le format de l'ISBN, paliers évalués sur la quantité déjà écoulée du livre au canal scolaire) ; (3) sinon le **taux maison** (`royalty.scolaire_default_rate`, défaut **0,12**, réglable par la DAF — même schéma que le seuil de validation / la retenue à la source). L'assiette reste le prix unitaire de la vente scolaire (le canal scolaire n'a qu'un prix, sans distinction public/net), donc c'est le **taux** du contrat qui est emprunté, pas son mécanisme de relevé — les droits scolaires restent dans le relevé segmenté dédié.

Conformité : `school_royalty_entries` est un **instantané figé** (append-only, comme les écritures financières) portant les renseignements obligatoires — titre, ISBN, auteur, co-auteurs (rôle inclus), prix unitaire, quantité (signée), assiette, taux, montant. Les auteurs/co-auteurs sont résolus depuis `isbn → manuscript → work_contributors → partner` au moment du calcul (snapshot). Un avoir sur facture scolaire écrit des entrées de **quantité négative** (jamais de modification rétroactive). Relevé segmenté par ouvrage : `schoolRoyaltiesReport` (agrégation par manuscrit/ISBN), exposé en `GET /royalties/school` (+ export CSV côté client). Aucune dépendance ajoutée.

## Bulletin de paie par e-mail — pièce jointe PDF (06/08/2026)

Le moteur d'envoi du bulletin par e-mail existait déjà (aperçu, destinataire par défaut, envoi manuel via le modèle HTML). La spec demandait de **joindre le bulletin PDF officiel** au courriel. Deux voies possibles : rendre le HTML en PDF **côté serveur** (Chromium/Playwright — lourd, ops sur Scalingo) ou **côté navigateur**. **Décision opérateur (06/08/2026) : côté navigateur**, pour ne rien ajouter au serveur ni à l'hébergement.

Choix technique : **jsPDF** (dépendance frontend, chargée paresseusement avec la page RH). Le bulletin PDF est construit à partir des **mêmes données de calcul** que le bulletin imprimé (`buildPayslipPdfBase64`, `frontend/src/lib/payslipPdf.ts`), encodé en **base64** et transmis dans le corps JSON de `POST /payslip/email` (champ optionnel `pdf_base64`, rétrocompatible). Le serveur l'attache via `nodemailer` (`sendMail.attachments`). Aucun Chromium serveur.

Suivi d'envoi : table **`PayslipDispatch`** (statut `sent`/`failed`/`pending`, destinataire, erreur, présence PDF, auteur RH) — chaque envoi est tracé ; un échec (502) crée un dispatch `failed`, la **relance = renvoyer**. `GET /payslip/dispatches` alimente le journal affiché sous le bulletin.

## 07/08/2026 — Rapport de lecture « version finale » : fusion PDF côté navigateur (pdf-lib)

Demande opérateur : le **rapport déposé** par le relecteur doit être **fusionné en un seul PDF** avec le **rapport officiel à en-tête Éclosion** (« Mon rapport »), car c'est cette version finale qui est transmise au client/auteur ; prévoir des **options de transmission** (télécharger, transférer, e-mail…).

Choix technique :
- **Génération** du rapport officiel (en-tête logo + coordonnées `HOUSE`, tableau des critères, score, recommandation, appréciation) en PDF **côté navigateur** avec **jsPDF** (déjà présent) — `frontend/src/lib/readingReportPdf.ts`. Cohérent avec le choix bulletin de paie (06/08) : pas de Chromium serveur.
- **Fusion** du PDF officiel avec le fichier déposé : nouvelle dépendance **`pdf-lib`** (frontend) — `frontend/src/lib/finalReport.ts` (`buildFinalReadingReport`). `pdf-lib` est une bibliothèque JS pure, standard et sans natif, adaptée à une connexion modeste (chargée avec la page « Mes lectures »). Si le dépôt est un **PDF** → ses pages sont ajoutées à la suite ; une **image** (PNG/JPG) → ajoutée en pleine page ; **autre format** (ex. .docx) → non fusionnable, repli sur le rapport officiel seul + avertissement à l'écran (le relecteur joint alors le fichier séparément).
- **Transmission** : télécharger le PDF final, transférer par messagerie interne (pièce jointe réelle), envoyer par e-mail (`POST /reading-assignments/:id/email-report`, PDF en base64 → `nodemailer`, réservé au relecteur ou au comité/direction), ou WhatsApp (téléchargement + message pré-rempli).

## 07/08/2026 — Moteur de paie : aperçu du bulletin « en direct » + accordéon

Demande opérateur (RH) : dans la rubrique paie, modifier un pourcentage ne mettait pas à jour le net à payer (« net figé »), et le tableau de bord n'était pas en accordéon.

- **Net en direct** : le moteur de calcul (`backend/src/lib/payrollEngine.ts`, `computePayslip`) est **porté à l'identique** côté navigateur — `frontend/src/lib/payrollEngine.ts` (+ `ratesFromRateSet` pour convertir le barème de l'API). Dans « Fiches paie & bulletin », le bulletin est désormais recalculé **à chaque frappe** (`useMemo` sur le formulaire + barème + retenue d'absence). Le serveur reste la **référence** à l'enregistrement / la clôture ; la retenue d'absence (Présences) est chargée du serveur (bouton « Actualiser »).
- **Garde-fou de parité** : `backend/tests/payroll-frontend-parity.test.ts` importe les **deux** moteurs (l'unique import du port navigateur est un `import type` effacé à l'exécution) et vérifie qu'ils produisent des bulletins **identiques** sur 6 cas. Toute divergence future casse le test.
- **Envoi e-mail** : n'est activé que **fiche enregistrée** (valeurs officielles figées) ; l'aperçu non enregistré affiche un avertissement.
- **Accordéon** : le composant `Card` accepte `collapsible` / `defaultOpen` ; les rubriques du « Moteur de paie » (Fiches paie & bulletin, Paramètres/barème, Livre de paie) sont regroupées sous un titre + une note d'aide RH, chacune repliable.

## 07/08/2026 (suite) — Règle métier : retenue d'absence découplée du calcul de paie

Précision opérateur : les retenues d'absence de l'ERP **ne doivent pas être reliées directement au calcul de la paie**. Le cahier de présence (pointeur indépendant) est un **témoin** ; la retenue effective est **saisie par le RH** au moment d'intégrer la paie du mois / de l'employé.

- **Backend** (`routes/payroll.ts`) : `resolvePayslip` n'applique plus la retenue issue de la consolidation Présences ; elle est renvoyée séparément comme `attendance_witness` (indicatif). La retenue appliquée provient d'une saisie RH transmise en paramètre (`retenue_absence` en query sur `GET …/payslip`, ou dans le corps de `POST …/payslip/email`). Le livre de paie (`computeRegister`) n'applique plus non plus la retenue des présences.
- **Frontend** : champ « Retenue d'absence (saisie RH) » dans le bulletin ; le témoin du cahier de présence est affiché avec un bouton « Reporter dans la retenue » (report volontaire), et la mention « Indicatif : non relié au calcul ». Aperçu en direct et impression/e-mail utilisent la valeur saisie.
- **Test** : `payroll-attendance-decoupling.test.ts` — une consolidation avec retenue proposée de 60 000 n'impacte pas le net (retenue = 0, `attendance_witness` = 60 000) ; une saisie RH de 50 000 est bien appliquée (net en baisse).

## 07/08/2026 (suite) — Fiche manuscrit corrigeable après enregistrement (jusqu'au contrat signé)

Demande opérateur : la fiche se verrouillait après l'enregistrement (impossible de corriger une erreur/oubli). Décision : rendre la fiche corrigeable **tant que le contrat n'est pas signé**.

- **Backend** (`routes/manuscripts.ts`) : `PATCH /api/v1/manuscripts/:id/registration` (permission `manuscripts:saisie`) met à jour l'ouvrage (titre, sous-titre, langue, domaine, responsable), l'**identité complète de l'auteur** (état civil, pièce, coordonnées — sur le partenaire lié), les **frais de dépôt** et le **délai de réponse**. Motif obligatoire (`modification_reason`), tracé au journal d'audit. **Verrou** : si un contrat `signedAt`/`status=active` existe → 409 `registration_locked`. `GET /manuscripts/:id` renvoie désormais `registrationLocked` pour l'UI.
- **Frontend** : bouton « ✎ Modifier la fiche » (barre d'actions de la fiche), désactivé si verrouillée. Ouvre une fenêtre reprenant tous les champs pré-remplis (ouvrage + auteur + frais/délai) + champ motif. Une chaîne vide efface la valeur correspondante.
- **Test** : `manuscript-registration-edit.test.ts` — correction OK (ouvrage + auteur, tracé), refus sans motif (400), verrou après contrat signé (409 + `registrationLocked` au GET).

Reste demandé (incrément suivant) : suppression du manuscrit soumise à validation du DG (le directeur éditorial demande → le DG valide/refuse).

## 07/08/2026 (suite) — Chantier paie : cycle mensuel, étape 1 (grille éditable + net auto)

Demande opérateur : générer la paie du mois pour tous les salariés, avec saisie individuelle des éléments variables et net automatique ; le mois reste modifiable tant qu'il n'est pas validé (validation DG à venir).

- **Modèle** (migration `payroll_monthly_run`) : `PayrollMonthlyRun` (periodKey unique, `status` brouillon|valide, validatedBy/At) + `PayrollMonthlyLine` (par salarié : primes, heures sup, retenue d'absence, retard, avance, prêt, sanction, autres). Migration écrite à la main (le `migrate diff` remontait de la dérive DB non liée : conservé uniquement mes objets).
- **Backend** (`routes/payroll.ts`) : `POST /payroll/monthly/:period/prepare` (seed une ligne par fiche paie, idempotent, exige un barème en vigueur), `GET /payroll/monthly/:period` (statut + lignes + **bulletin recalculé** par le moteur), `PATCH /payroll/monthly/:period/lines/:employeeId` (saisie, **refusée si validé** → 409 `run_locked`). Mapping éléments→moteur : primes+heures sup imposables (brut & assiette), absences avant impôt, retard/avance/prêt/sanction/autres en retenues nettes internes.
- **Frontend** : `PayrollMonthlySection` — sélecteur de mois, « Préparer le mois », grille par salarié (8 colonnes éditables + NET), totaux, badge Brouillon/Validé. Enregistrement à la sortie de case, net rafraîchi. Placée en tête du « Moteur de paie » (accordéon RH).
- **Test** : `payroll-monthly.test.ts` — préparation idempotente, net recalculé (prime ↑ net ; avance −25 000 exact), verrou après validation.

Étape 2 (à venir) : validation obligatoire par le DG (fige le mois) → impression des bulletins PDF au modèle du classeur, livre de paie et états CNPS/fiscaux depuis le mois validé.

## 07/08/2026 (suite) — Chantier paie, étape 2a : validation DG + bulletins PDF au modèle

- **Validation DG** (`routes/payroll.ts`) : `POST /payroll/monthly/:period/validate` et `.../reopen`, réservés au **Directeur général** (`DIR_GENERAL` ou `ADMIN_GENERAL` — le droit `paie:validation` étant partagé RH/Finance/DG, un contrôle de rôle explicite renvoie 403 `dg_only` sinon). Valider fige le mois (la saisie renvoie 409 `run_locked`) ; rouvrir repasse en brouillon, refusé si le livre de paie est clôturé.
- **GET mois enrichi** : chaque ligne renvoie désormais les infos salarié (département, poste, date d'entrée, catégorie, mode de paiement, N° compte, congés) et le **bulletin complet** (`payslip`), pour l'impression groupée.
- **Bulletin PDF au modèle du classeur** (`lib/payslipPdf.ts`, refonte) : bloc « Informations salarié », éléments de rémunération, **cotisations en deux colonnes (part salariale ET patronale)** — CNPS PVID/PF/AT, CFC, FNE, TC, RAV, IRPP+CAC —, éléments internes, bandeau **NET À PAYER**, coût employeur, mode de paiement. `downloadPayslipsPdf` génère **tous les bulletins du mois** (un par page) une fois le mois validé.
- **Frontend** : boutons « Valider le mois (DG) » / « Rouvrir (DG) » (visibles au DG) et « Imprimer tous les bulletins » (après validation). Prop `canValidatePayrollDg` = rôle DIR_GENERAL/ADMIN_GENERAL.
- **Test** : `payroll-monthly.test.ts` — refus non-DG (403), validation DG (verrou 409), bulletin complet exposé, réouverture puis saisie de nouveau possible.

Reste (étape 2b) : livre de paie + états CNPS/fiscaux dérivés du mois validé (aujourd'hui calculés depuis les fiches) ; enrichissements bulletin (congés, contrat, contact d'urgence) si souhaité.

## 07/08/2026 (suite) — Chantier paie, étape 2b : livre de paie & états depuis le mois

`computeRegister` (livre de paie + exports CNPS/fiscaux + clôture) reprend désormais les **éléments variables du mois** quand le mois a été préparé (grille mensuelle) : chaque salarié est calculé par `computeMonthlyLine` (primes, heures sup, absences, retards, avances, prêts, sanctions) — donc le livre, les états CNPS/fiscaux (CSV) et le journal figé à la clôture reflètent exactement les bulletins. Sans mois préparé, calcul depuis les seules fiches (rétrocompatible). La réponse du livre expose `monthly_status` (brouillon|valide|null) ; le frontend affiche la source des montants (mois validé / brouillon à valider / fiches).

## 07/08/2026 (suite) — Compléments bulletin : bloc « Informations complémentaires & congés »

Le bulletin PDF (modèle classeur) reçoit un dernier bloc : **type de contrat** (HrContract le plus récent), **date de naissance** et **date d'entrée** (Employee), **solde de congés** (leaveBalanceDays). Le GET du mois (`routes/payroll.ts`) renvoie `contract_type` et `birth_date` par ligne ; `payslipPdf.ts` ajoute la section. Note : le modèle du classeur mentionne « situation familiale » et « contact d'urgence », mais ces champs n'existent pas dans le modèle de données (`EmployeeConfidential` ne stocke que des notes) — non ajoutés, pas de donnée confidentielle exposée sur le bulletin.

## 07/08/2026 (suite) — Stock : interface d'inventaire physique (Ch. 16 §16.8)

Le backend gérait déjà les campagnes d'inventaire (comptage à l'aveugle, écart, recomptage, régularisation, clôture) mais aucune interface ne les exposait. Ajout d'une UI dédiée, en réponse au rapport d'inventaire de l'opérateur.

- **Backend** (`routes/stock.ts`) : `GET /api/v1/inventories` (liste + avancement : comptées/total, écarts, à recompter, ajustements en attente) ; `GET /inventories/:id` enrichi (titre de l'ouvrage + ISBN par ligne, masquage à l'aveugle conservé).
- **Frontend** : `StockInventorySection` dans la page Stock — liste des campagnes avec **barre d'avancement**, création (lieu + type complet/tournant + à l'aveugle), **grille de comptage** (saisie à la sortie de case), écarts + recomptage (↻), **régularisation** (droit validation) et **clôture** (refusée tant que des écarts subsistent).
- **Test** : `lot4-stock.test.ts` — campagne, comptage avec écart, recomptage, refus de clôture, régularisation (stock ajusté), clôture.

Note : le rapport mentionne des exemplaires « touchés » (abîmés). L'état `declasse` existe déjà sur `StockItem` ; un comptage distinguant vendable/abîmé pourra être ajouté ultérieurement (schéma inventaire à étendre).

## 07/08/2026 (suite) — Inventaire : comptage des exemplaires abîmés (« touchés »)

Le rapport d'inventaire distingue des exemplaires « touchés » (abîmés) parmi les comptés (ex. « 15 dont 08 touchés »). Ajout d'un comptage « dont abîmés » par ligne d'inventaire, reclassé du stock **vendable** vers **déclassé** à la régularisation.

- **Schéma** : `InventoryLine.countedDamaged Int?` (migration `inventory_line_damaged`).
- **Backend** (`routes/stock.ts`) : `PATCH /inventory-lines/:id` accepte `counted_damaged` (≤ `counted_qty`, sinon 400). La **régularisation** crée, en plus de l'ajustement d'écart, un mouvement de **déclassement** (vendable −abîmés / déclassé +abîmés). La **clôture** est refusée tant que des abîmés ne sont pas déclassés. Liste : `damaged_lines` + `pending_adjust` intègrent les abîmés.
- **Frontend** : colonne « dont abîmés » dans la grille de comptage ; indicateur ⚠ dans l'avancement ; bouton « Régulariser » actif dès qu'il y a un écart OU des abîmés.
- **Test** : refus abîmés>comptés, comptage 50 dont 8 abîmés (écart 0), clôture bloquée, régularisation → vendable 42 / déclassé 8, clôture OK.

## 07/08/2026 (suite) — Stock : zones pré-créées + stock réel consolidé toutes zones

- **Zones du rapport pré-créées** (seed idempotent) : Magasin — cartons, Étagères DAF, Salon / exposition, Bureau DAF, Direction générale, Stock commerciaux. Prêtes à inventorier dès la mise en service.
- **Stock réel consolidé** : `GET /api/v1/stock-consolidated` — total par ouvrage tous lieux confondus (vendable vs déclassé) + détail par lieu + totaux généraux. Frontend : `StockConsolidatedSection` (tableau repliable par zone, ligne de total général) en tête de la page Stock. Répond au « stock réel total » du rapport final.
- **Test** : stock réparti sur 2 zones + 5 déclassés → vendable 45 / déclassé 5 / total 50, 2 lieux.

## 07/08/2026 (suite) — Stock par ouvrage : panneau sur la fiche + chargement de l'inventaire initial

Réponse à « intégrer les stocks par manuscrit » : rendre le stock visible et saisissable ouvrage par ouvrage, et permettre de charger les quantités du rapport d'inventaire.

- **Backend** (`routes/stock.ts`) : `GET /api/v1/manuscripts/:id/stock` — stock de l'ouvrage agrégé par ISBN et par lieu (vendable/déclassé) + totaux. La saisie du stock initial réutilise le mouvement `inventory_adjustment` (crédit immédiat, tracé), sans nouveau type.
- **Frontend** :
  - `ManuscriptStockSection` sur la fiche manuscrit : stock par ISBN/zone + saisie du stock initial (zone + quantité).
  - `StockInitialImportSection` sur la page Stock : chargement en lot — zone + quantités par ouvrage (recherche par titre/ISBN) → une régularisation par ligne. Permet d'intégrer les ~30 titres du rapport rapidement.
- **Test** : `lot4-stock.test.ts` — stock par manuscrit (0 → 120 après saisie initiale, ventilé par zone).

## 07/08/2026 (suite) — Chargement inventaire : rapprochement automatique titres → ouvrages

Pour gagner du temps sur l'intégration du rapport de stock : `POST /api/v1/stock-initial/match` rapproche des lignes « titre + quantité » des ouvrages existants (ISBN imprimés) par normalisation (accents/casse/ponctuation) + score de Dice sur bigrammes (seuil 0,5). Frontend (`StockInitialImportSection`) : zone de collage pré-remplie avec le rapport d'inventaire, bouton « Rapprocher automatiquement » → les quantités se placent sur les ouvrages reconnus (cumul si doublon), les non-trouvés sont listés (à saisir par le magasinier). L'opérateur choisit la zone puis « Charger le stock ». Test : « RHAPSODIES » apparié à « Rhapsodies » (score ≥ 90), titre inexistant → non trouvé.

## 07/08/2026 (suite) — Chargement inventaire : exemplaires « touchés » → déclassé

Peaufinage du chargement : les exemplaires « touchés » (abîmés) du rapport entrent en stock **déclassé**, avec la précision.
- **Backend** : le mouvement de stock accepte désormais un champ `condition` (vendable/declasse) appliqué à l'ajustement ; l'endpoint de rapprochement transmet `damaged` par ligne.
- **Frontend** (`StockInitialImportSection`) : le parseur extrait « (NN touchés) » (colonne « dont touchés » pré-remplie) ; au chargement, chaque ouvrage crée un mouvement **vendable** (quantité − touchés) et, si besoin, un mouvement **déclassé** (touchés) avec un motif explicite.
- **Test** : `damaged` transmis par le rapprochement ; chargement 7 vendable / 8 déclassé (« 15 dont 08 touchés »).

## 07/08/2026 (suite) — Refonte Contrats, phase 1a : tableau de bord + cycle de vie

Après audit du module Contrats & droits (déjà mûr : workflow, signature+empreinte, avenants, bénéficiaires, relevés), démarrage de la refonte CLM par le tableau de bord.
- **Schéma** : `Contract.validatedAt` (migration `contract_validated_at`), posé au passage en « attente de signature ».
- **Backend** (`routes/contracts.ts`) : `GET /api/v1/contracts/dashboard` (répartition par statut, avenants, avances contractuelles, échéances à 90 j + retards, contrats supprimés restaurables) ; `POST /api/v1/contracts/:id/restore` (droit validation).
- **Frontend** : `ContractsDashboard` affiché en tête de « Contrats & droits d'auteur » (compteurs par statut, échéances/retards, avances, restauration).
- **Test** : `contract-dashboard.test.ts` — compteurs + date de validation, retard signalé, suppression → restauration.

## 07/08/2026 (suite) — Nettoyage des ouvrages : fiches catalogue à compléter + épuration des essais

Demande opérateur : des ~100 ouvrages importés au catalogue ont des fiches incomplètes (à compléter, chemin A), et des manuscrits d'essai sont coincés au milieu du parcours (à épurer), sans toucher au catalogue/financier/RH.
- **Backend** (`routes/manuscripts.ts`) : `GET /manuscripts/catalogue-incomplete` (ouvrages parus dont la fiche manque d'ISBN, prix, domaine, date, identité auteur) ; `GET /manuscripts/purge-candidates` (manuscrits sans empreinte catalogue/financière = sûrs ; les autres listés avec leurs bloqueurs) ; `POST /manuscripts/purge` (archivage logique réversible, RE-VÉRIFIÉ côté serveur — refuse tout ouvrage avec empreinte). Réservé administration.
- **Frontend** : `ManuscriptCleanupSection` en accordéon « 🧹 Nettoyage » sur la vue Manuscrits (admin) — fiches à compléter (bouton « Compléter » → fiche) + épuration (cases pour les essais sûrs uniquement, ouvrages protégés non cochables).
- **Garde-fous** : le catalogue (publié, ISBN, site), les contrats et toute donnée financière protègent l'ouvrage ; la RH n'est pas concernée ; l'archivage est réversible (restaurable).
- **Test** : essai sûr → archivé ; manuscrit sous contrat → protégé (purge le saute) ; import sans ISBN → fiche à compléter.

## D-010 — Contractualisation déplacée après la Validation du BAT (18/08/2026)

- **Décision métier** (registre D-010) : nouvel ordre de production `… → Validation du BAT → Contractualisation → Impression → …`. L'auteur valide le BAT, puis le contrat est signé, avant l'impression. Dérogation assumée au Ch. 9 §9.12 et au Ch. 13 §13.3.
- **Source de vérité unique** : la table `workflow_statuses` (champ `step_order`), semée par `prisma/seed.ts`. La frise (`ManuscriptProgress`), les pipelines de tableaux de bord, les transitions (`workflow.ts`, dérivées de `step_order`) et les filtres en dérivent tous — aucune redéfinition dupliquée de l'ordre côté frontend (tout lit l'API `GET /workflow-statuses`).
- **Réordonnancement** : seules les étapes 5→13 sont renumérotées (Planification 5, Correction 6, Expertise 7, Réécriture 8, Mise en page 9, Infographie 10, Attribution des références 11, Validation du BAT 12, **Contractualisation 13**) ; Impression (14) et la suite inchangées. Migration `20260818090000_workflow_contractualisation_after_bat` : `UPDATE` des `step_order` uniquement — aucun code d'étape, id, ni ligne `manuscript_steps`/`step_transitions` touché ⇒ l'historique réel (dates, transmissions) des manuscrits existants est **préservé** (seul l'ordre de référence change).
- **Transitions adaptées** : après la **décision éditoriale** acceptée, le manuscrit passe à `PLANIFICATION` (et non plus `CONTRACTUALISATION`) — `readingCommittee.ts`. Le reste de l'avancement suit `step_order`, donc `VALIDATION_BAT → CONTRACTUALISATION → IMPRESSION` automatiquement.
- **Verrous contractuels retirés** (conséquence directe, cohérente avec la décision) : (1) `workflow.ts` — plus de blocage « pas de production sans contrat » à l'entrée de la production ; (2) `isbn.ts` — plus de blocage « ISBN sans contrat actif » (l'attribution des références précède désormais le contrat). **Incidence assumée** : correction, mise en page, ISBN et BAT se font avant tout contrat signé.
- **Tests** : `workflow-order.test.ts` verrouille l'ordre de référence (Contractualisation = BAT+1, précède Impression, décision → Planification, séquence 1..20 contiguë sans doublon). Flux de production existants réalignés (`lot2`, `lot3-workflow`, `lot3-isbn`, `lot4-workflow`).

## D-011 — Garde-fou éditorial « livrable de sortie » + étapes « à option » (20/08/2026)

- **Décision métier** (registre D-011) : (1) une étape ne se valide plus tant que le **fichier de sortie attendu** par l'étape suivante n'est pas déposé ; (2) **Expertise scientifique**, **Réécriture** et **Projet (Planification)** deviennent des **points de décision** « Réaliser / Passer », leur caractère facultative/obligatoire étant **défini à l'avance dans les Paramètres**. Dérogation assumée au Ch. 4 §4.3 (ces étapes n'étaient jusque-là que conditionnelles/sautées).
- **Verrou « livrable de sortie »** (`lib/stepDeliverables.ts`) : sans migration, réutilise les documents « pièce d'étape » au titre stable `[livrable:<CODE>]`. Étapes verrouillées = paramètre `workflow_deliverable_steps` (défaut : Planification, Expertise, Réécriture ; Mise en page & Infographie ajoutables). Refus `409 deliverable_missing`. Endpoints `GET`/`POST /manuscripts/:id/step-deliverable/:code` ; réglage `GET`/`PUT /workflow-deliverable-steps`.
- **Étapes « à option »** (`lib/stepRealization.ts`) : `isStepRequired` ne saute plus Expertise/Réécriture (toujours présentées). L'endpoint de validation (`workflow.ts`) accepte `step_decision` (`realise`/`passe`), `skip_reason`, `realization`. Contrôles : `409 step_mandatory` (passer une étape obligatoire), `skip_reason_required` (passer sans motif), `realization_incomplete` (réaliser sans les éléments requis). Le verrou « livrable » est **court-circuité quand l'étape est passée** (le motif tient lieu de justificatif). Modes = paramètre `workflow_step_modes` (défaut : Expertise & Réécriture *facultatives*, Projet *obligatoire*) — `GET`/`PUT /workflow-step-modes`. Méta d'écran : `GET /manuscripts/:id/optional-step/:code`.
- **Éléments exigés à la réalisation** : Expertise = expert désigné + avis (favorable/réserves/défavorable) [+ rapport livrable] ; Réécriture = note [+ version réécrite] ; Projet = responsable + calendrier + budget [+ fiche]. Stockés dans `manuscript_steps.realization_data` (JSONB) ; décision + motif dans `realization_mode` / `skip_reason`. Migration additive `20260820180000_step_realization` (3 colonnes ; aucun historique touché).
- **Frontend** : bloc « Livrable de l'étape » (`StepDeliverableBlock`) + panneau de décision Réaliser/Passer intégré à `GenericStepValidation` (formulaire des éléments ou motif, bouton adapté), toujours avec l'affectation nominative. Réglages : cartes « Verrou éditorial — livrables exigés » et « Étapes à option » dans les Paramètres (admin).
- **Tests** : `step-deliverable.test.ts` (verrou + réglage) ; `step-realization.test.ts` (méta, obligatoire→passer refusé, réaliser exige les éléments, passer facultative sans livrable, mode paramétrable). Flux `lot2` (2 tests réécrits pour le nouveau modèle), `lot3-workflow`, `lot4-workflow`, `step-assignment`, `step-deliverable` réalignés (passage explicite d'Expertise & Réécriture ; livrable + éléments pour Planification). Suite : 777/777.

## D-012 — Référentiel fiscal & CNPS des éléments de salaire (Niveau 1, 21/08/2026)

- **Source** : document officiel « Procédure fiscale de traitement des salaires de la signature du contrat à sa rupture » (CGI art. 30/31/33 pour l'IRPP ; Ordonnance CNPS n°73/17, arrêté interm. 003/1974, lettre-circulaire 021/91 pour le cotisable). Fournit la classification de ~37 éléments (taxable/exonéré, cotisable/non), le barème des avantages en nature et les deux formules de base (salaire brut taxable, salaire cotisable CNPS).
- **Niveau 1 livré** (choix opérateur) : **référentiel + guide**, sans modifier le calcul du bulletin. Modèle `SalaryElement` (code, catégorie, `fiscal_status`, `cnps_status`, `legal_ref`) semé de 36 rubriques (`lib/salaryElements.ts`, idempotent — les statuts ne sont pas réécrits au redéploiement). Routes `GET /api/v1/payroll/salary-elements` (consultation) et `PATCH …/:code` (paie:administration, tracé).
- **Barème des avantages en nature** (CGI art. 33) porté par le **barème versionné** `PayrollRateSet` (colonnes `an_*_pct`, défauts légaux 0.15/0.04/0.02/0.05/0.10/0.10), exposé dans `rateSetView`/`rateSetSchema` et éditable dans l'écran Barème (versionné par date d'effet, comme le reste). Migration additive `20260821140000_salary_elements_an_bareme`.
- **Frontend** : composant `SalaryElementsGuide` (Moteur de paie) — tableau par catégorie, statuts consultables (pastilles) ou éditables (listes déroulantes) pour l'administration ; barème AN affiché + éditable dans `PayrollSettingsSection`.
- **Réserve de conformité** : certains statuts (préavis, licenciement, usage véhicule personnel, jetons de présence) sont la meilleure lecture du document et **restent à valider par le comptable/juriste de la maison** — ils sont donc **éditables** (D-007 : conformité et mises à jour légales sous la responsabilité de la maison).
- **Niveau 2 (à venir, sur feu vert)** : bulletin **par rubriques** + calcul automatique du salaire brut taxable et du salaire cotisable CNPS (exonérations, frais professionnels, indemnités de rupture, avantages en nature au barème), en s'appuyant sur ce référentiel et le moteur de formules.
- **Tests** : `salary-elements.test.ts`. Suite : 793/793.

## D-013 — Rubriques paie « en vigueur / en attente » + traitement fiscal/CNPS automatique (Niveau 2, 21/08/2026)

- **Cadre posé par l'opérateur** : ne **jamais modifier la structure du bulletin**. Chaque rubrique du catalogue reste **paramétrée mais dormante** ; tant que la direction n'a pas décidé d'accorder une prime / indemnité / avantage à un employé, elle n'apparaît sur **aucun** bulletin. Le RH **active** une rubrique le jour où elle entre en vigueur ; les taux de cotisation et de taxe s'appliquent alors **selon les éléments pris en vigueur à date**. Réversible sans développeur.
- **Étape A — activation (« en vigueur / en attente »)** : `SalaryElement` reçoit `in_force` (bool, défaut `false`) et `effective_from` (date d'effet). Le `PATCH …/salary-elements/:code` accepte `in_force`/`effective_from` (paie:administration, tracé). La liste expose `in_force`+`effective_from`. Le seed est idempotent : il **ne réécrit pas** une activation décidée par le RH. Migration additive `20260821170000_salary_element_activation`. Frontend : colonne **État** + bouton « Mettre en vigueur / en attente » dans `SalaryElementsGuide`.
- **Étape B — traitement automatique** (sans changer la structure) : une **ligne libre** du bulletin peut être **rattachée à une rubrique en vigueur** (`element_code`). Le moteur `computePayslip` reçoit trois entrées **facultatives** (`rubriqueBrut`, `rubriqueTaxable`, `rubriqueCotisable`) — absentes ⇒ **calcul historique inchangé** (les 794 tests existants restent verts à l'octet près). `splitExtraLines` (routes paie) ventile chaque ligne typée selon le statut **fiscal** et **CNPS** de la rubrique active : une **indemnité exonérée** (ex. transport) **entre dans le brut mais ni dans l'assiette fiscale (IRPP/CFC/FNE) ni dans l'assiette CNPS** ; une rubrique **taxable + cotisable** entre dans les trois ; un **avantage en nature** n'est pas ajouté au brut espèces. Une rubrique **remise en attente** redevient une ligne libre classique (imposable). `activeRubriqueMap()` alimente les trois chemins autoritaires (grille mensuelle, blocage/validation, livre de paie/DIPE/CNPS).
- **Frontend** : dans l'éditeur de lignes libres (`PayrollMonthlySection`), sélecteur **« Rubrique »** listant les rubriques **en vigueur** ; le statut fiscal/CNPS retenu est rappelé à côté. Sans rubrique choisie, la ligne reste un gain imposable / une retenue nette comme avant.
- **Réserve de conformité** (rappel D-007/D-012) : les statuts fiscal/CNPS restent **éditables** et **à valider par le comptable/juriste** ; le système applique fidèlement le statut retenu, il ne le décide pas.
- **Étape B+ — avantages en nature évalués AU BARÈME** (CGI art. 33) : une ligne rattachée à la rubrique « avantages en nature » (en vigueur) peut être **évaluée automatiquement** au barème (`bareme_type` ∈ logement/électricité/eau/domestique/véhicule/nourriture, + `quantity`) plutôt que saisie en FCFA. Le moteur reçoit deux fractions facultatives `avantageNatureTaxablePct`/`avantageNatureCotisablePct` (Σ pct×quantité) et les multiplie par **sa propre** assiette fiscale « cœur » (base autoritaire, sans dérive avec la prime d'ancienneté/le moteur de formules). L'évaluation entre dans l'**assiette fiscale et l'assiette CNPS**, **pas dans le brut espèces** (non payé en cash) — cohérent avec le traitement des rubriques AN. Nouveau champ `avantages_nature` (informatif) sur le `Payslip` — le **moteur jumeau navigateur** (`frontend/src/lib/payrollEngine.ts`, aperçu en direct) est mis à jour à l'identique (entrées facultatives + champ de sortie) pour rester strictement parièle au moteur serveur (`payroll-frontend-parity.test.ts`). Le barème `an_*_pct` (déjà versionné, Niveau 1) est exposé sur la réponse du mois (`rateDisplay.avantages_nature`) pour l'affichage du % côté RH. Frontend : sous-ligne « Avantage / Nombre » dans l'éditeur de lignes libres (montant masqué, « au barème »). Aucune migration (réutilise `an_*_pct`). Compatibilité : fractions absentes ⇒ calcul historique inchangé.
- **Tests** : `salary-element-payslip.test.ts` (rubrique taxable+cotisable → brut+IRPP+CNPS ; indemnité exonérée → brut seul ; rubrique en attente → ligne libre imposable ; avantage en nature au barème → IRPP+CNPS sans le brut ; quantité multiplie l'évaluation). Suite : 799/799.

## Composition / typographie sur la fiche technique (étape 9, 22/08/2026)

- **Constat d'audit** : à l'étape 9 (Mise en page), l'écran « Fiche technique de fabrication » saisissait le **papier/façonnage** (`ProductionSpecs` : format, pages, papier intérieur + grammage, papier couverture, reliure, pelliculage) — modifiable via PATCH `upsert`. Manquaient les **caractéristiques d'écriture** (Ch. 11 §11.4) : elles n'existaient que dans la bibliothèque de gabarits globale (`LayoutTemplate.specs`), **non rattachée à l'ouvrage**.
- **Ajout (purement additif)** : 5 colonnes nullables sur `ProductionSpecs` — `typeface` (police), `fontSizePt` (corps), `leading` (interlignage), `margins` (marges), `layoutName` (gabarit/collection de référence, texte libre). Migration additive `20260822090000_production_specs_typography` (aucune donnée touchée, aucun champ existant modifié). Le schéma de la route et l'`upsert` intègrent ces champs ; ils **n'entrent dans aucun contrôle bloquant** (BAT/Impression inchangés).
- **Règle d'or (correction d'une saisie erronée)** : le même formulaire (PATCH partiel + bouton « Enregistrer ») permet de **re-modifier** n'importe quel champ sans toucher aux autres (Prisma ignore les champs `undefined`). Vérifié par test.
- **Frontend** : bloc « Composition / typographie » ajouté à `ProductionSection` (mêmes règles de permission `production:saisie`).
- **Localisation confirmée des 3 fiches** : (a) typographie **+** (b) papier/façonnage → **étape 9** (`ProductionSpecs`) ; (c) métadonnées commerciales/poids → **étape 11** (`WorkMetadata`, versionnée) ; le BAT (étape 12) et l'Impression (étape 14) **consomment** ces fiches sans les recréer.
- **Tests** : `lot3-production.test.ts` — saisie + re-modification de la typographie, fabrication préservée. Suite complète : 800/800.
