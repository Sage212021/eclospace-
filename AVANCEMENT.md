# Eclospace — Avancement du développement

| Lot | Contenu | Statut |
|---|---|---|
| Lot 0 | Fondations (sécurité, rôles, audit, GED, notifications) | En cours — socle backend/frontend fonctionnel |
| Lot 1 | Entrée des manuscrits, comité de lecture, workflow | En cours — flux complet fonctionnel (étapes 1 à 5) |
| Lot 2 | Contrats, planification/Gantt, correction | En cours — flux complet fonctionnel (étapes 5 à 7) |
| Lot 3 | Maquette, infographie, ISBN, BAT, impression | En cours — flux complet fonctionnel (étapes 10 à 15) |
| Lot 4 | Stock et commercial | En cours — flux complet fonctionnel (étapes 16 à 18) |
| Lot 5 | Finance et droits d'auteur | En cours — flux complet fonctionnel |
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

### 04/07/2026 (suite) — Lot 3 : maquette, infographie, ISBN/dépôt légal/métadonnées, BAT, impression

**Fait :**
- Schéma Prisma : `production_specs`, `image_assets`, `layout_templates`, `graphic_charters`, `checklists`/`checklist_items` (mécanisme générique réutilisé par le BAT et la complétude ISBN), `isbn_pool`/`isbns`, `legal_deposits`, `work_metadata`, `metadata_exports`, `bat_records`/`bat_anomalies`/`bat_signatures`, `printers`/`print_quotes`/`purchase_orders`/`production_milestones`/`goods_receipts`/`supplier_claims`.
- **Maquette (Ch. 11) et Infographie (Ch. 12)** : fiche technique de fabrication avec **calcul automatique de l'épaisseur du dos** et alerte de recalcul quand pages/papier changent ; visuels avec contrôle technique automatique (résolution ≥ seuil paramétrable, mode CMJN) et gestion des droits iconographiques (origine, licence, crédit) — notification si non conforme.
- **ISBN, dépôt légal et métadonnées (Ch. 13)** : gestion du stock d'ISBN par tranches avec alerte de seuil bas paramétrable, attribution automatique (clé de contrôle EAN-13 calculée et vérifiée), **un ISBN attribué n'est jamais réutilisé**, code-barres EAN-13 généré à la volée en SVG, fiche de dépôt légal, fiche de métadonnées versionnée (les partenaires déjà notifiés sont signalés à re-notifier après modification), **contrôle de complétude bloquant** avant le BAT.
- **BAT et contrôle qualité (Ch. 14)** : constitution automatique du dossier bloquée tant que la convergence amont (ISBN/métadonnées, fiche technique, couverture conforme et pourvue de ses droits) n'est pas atteinte ; liste de contrôle structurée ; anomalies avec gravité et renvoi en correction (nouveau cycle) ; **signature électronique verrouillant les fichiers** par une empreinte combinée des versions approuvées — toute modification après signature exige une annulation motivée et tracée, notifiée à la Direction générale.
- **Impression et fabrication (Ch. 15)** : référentiel imprimeurs (fiche Partenaire, catégorie imprimeur) avec évaluation continue (délais, non-conformité, réclamations) ; devis comparés par hypothèse de tirage avec tableau de coût unitaire ; sélection motivée soumise à un **seuil de délégation paramétrable** (Direction générale au-delà) ; bon de commande numéroté automatiquement, référençant l'empreinte des fichiers du BAT signé ; jalons de fabrication avec alerte de retard ; réception avec **rapprochement automatique commande/livraison** (écart hors tolérance signalé) ; réclamations fournisseurs ; réimpressions en sous-cycle accéléré reprenant le dernier BAT signé.
- **Intégration au moteur de workflow (étapes 10 à 15)** : convergence Maquette/Infographie exigée avant l'étape Infographie, contrôle de complétude ISBN bloquant avant l'étape Attribution des références, signature du BAT exigée avant l'étape Validation du BAT, bon de commande transmis exigé avant l'étape Impression, verdict de contrôle qualité acceptable exigé avant l'étape Contrôle qualité (exemplaires imprimés).
- **Correction d'un ordre du Lot 1** : l'étape « Attribution des références » (ISBN) est repassée avant « Validation du BAT », conformément aux Ch. 13 §13.9 et Ch. 14 §14.2 qui exigent la complétude ISBN avant le BAT — l'ordre initial du Lot 1 les avait inversées.
- **27 nouveaux tests automatisés** (48 au total, tous verts) : calcul et alerte de recalcul du dos, contrôle technique et droits iconographiques bloquants, attribution ISBN et non-réutilisation, complétude ISBN/dépôt légal/métadonnées, circuit complet de BAT (contrôle → signature → verrouillage), renvoi en correction et réouverture de cycle, annulation de signature motivée, devis/sélection/bon de commande avec seuil de délégation, jalons et alerte de retard, rapprochement commande/livraison et réclamation, réimpression, évaluation imprimeur, et circuit complet du workflow (étapes 10 à 15) avec vérification de chaque verrou.
- **Frontend** : quatre nouvelles sections intégrées à la fiche manuscrit (fiche technique de fabrication et visuels, ISBN/dépôt légal/métadonnées avec code-barres affiché, dossier de BAT avec checklist et signature, devis/bon de commande imprimeur), conditionnées à l'étape courante. Flux de saisie vérifié dans un navigateur réel (remplissage et enregistrement de la fiche technique, calcul du dos affiché immédiatement).

**Points d'interprétation signalés** (détail dans `docs/JOURNAL_TECHNIQUE.md`) : formule du calcul du dos, code-barres généré à la volée plutôt que stocké, choix manuel d'un ISBN précis non implémenté, export ONIX non implémenté (CSV simplifié seulement), classification Thema simplifiée à une liste de codes libres, réouverture de cycle de BAT reprenant tous les points non cochés plutôt qu'une liste strictement limitée, engagement Finance et rapprochement facture/commande/réception non implémentés (module Finance hors périmètre avant un lot ultérieur).

**Limites connues de ce Lot 3 :**
- Pas d'écran d'administration pour les gabarits de mise en page et chartes graphiques (Ch. 11 §11.4, Ch. 12 §12.4) — endpoints prêts, écran non prioritaire pour ce lot.
- Pas d'export ONIX 3.0 ni de tableau de bord dédié à l'ISBN/BAT/impression (Ch. 13 §13.10, Ch. 14 §14.8, Ch. 15 §15.10) — hors périmètre minimal.
- Le choix manuel d'un ISBN précis dans une tranche n'est pas implémenté (seule l'attribution automatique du prochain disponible l'est).
- Épreuve contractuelle imprimeur (Ch. 15 §15.5) non implémentée.

**Prochaine étape :** faire valider ce Lot 3 par l'opérateur, puis démarrer le Lot 4 (stock et magasin, commercial) une fois validé.

### 04/07/2026 (suite) — Lot 3 validé par l'opérateur ; démarrage et livraison du Lot 4 : stock et magasin, commercial

**Fait :**
- Schéma Prisma : `stock_locations` (hiérarchie zone > allée > étagère, dépôt-vente rattaché à un client), `stock_items` (stock par isbn/lieu/tirage), `stock_movements` (table pivot append-only : 10 types typés), `inventories`/`inventory_lines` ; `customers`, `discount_grids`/`customer_discounts`, `price_list`, `sales_orders`/`sales_order_lines`, `deliveries`/`delivery_lines`, `consignments`/`consignment_statements`, `pos_sales`, `customer_returns`/`return_lines`. `PurchaseOrder.deliveryLocation` (texte libre, Lot 3) remplacé par une vraie relation vers `stock_locations`.
- **Stock et magasin (Ch. 16)** : mouvements typés (entrée fabrication, sortie vente/pilon/exemplaires auteur et presse, transfert, retour, régularisation), **aucun mouvement sans type, motif et responsable** ; disponible = physique − réservé toujours recalculé, jamais stocké ; seuils d'alerte et de rupture par référence ; **inventaires à l'aveugle** (quantités théoriques masquées jusqu'au comptage), double comptage en cas d'écart, régularisation tracée par un mouvement dédié ; entrée en stock déclenchée par la réception de fabrication, réservée aux exemplaires acceptés par le contrôle qualité (Ch. 14/15).
- **Commercial, distribution et ventes (Ch. 17)** : fiche client par catégorie avec remise automatique (grille par catégorie ou remise négociée), toute remise hors grille exigeant une validation de la Direction générale ; commande avec **contrôle de disponibilité en temps réel** et **contrôle d'encours** (une commande dépassant le plafond est bloquée puis débloquée par validation) ; réservation du stock à la confirmation ; livraison rapprochée automatiquement des mouvements de stock, reliquats gérés par livraisons multiples ; **dépôt-vente** (les exemplaires restent la propriété d'Éclosion Édition, seules les ventes relevées réduisent le stock déposé) ; vente au comptoir/salon avec encaissement espèces/carte/**mobile money** ; retours clients avec verdict exemplaire par exemplaire (remis en stock vendable / pilon / déclassé).
- **Intégration au moteur de workflow (étapes 16 à 18)** : entrée en stock exigeant un mouvement de réception effectif, mise en vente exigeant un prix public défini, passage à la vente/livraison exigeant qu'une commande ou une vente ait été enregistrée.
- **21 nouveaux tests automatisés** (68 au total, tous verts) : cohérence stock = somme des mouvements, transfert en transit jusqu'à confirmation, seuils d'alerte/rupture, inventaire à l'aveugle avec écart et régularisation, entrée en stock réservée aux exemplaires acceptés, remise de grille et remise hors grille validée, contrôle de disponibilité et d'encours avec blocage/déblocage, livraison avec rapprochement, dépôt-vente avec relevé, vente au comptoir, retour client par exemplaire, circuit complet du workflow (étapes 16 à 18) avec vérification de chaque verrou.
- **Frontend** : deux nouveaux écrans transverses (non rattachés à un seul manuscrit, contrairement aux sections des lots précédents) — **Stock** (lieux, état du stock par référence, alertes, saisie de mouvement) et **Commercial** (clients, commandes, déblocage d'encours, vente au comptoir). Endpoint `GET /api/v1/isbns` ajouté hors spécification API v1 (nécessaire pour choisir un ouvrage par ISBN sans naviguer manuscrit par manuscrit).
- **1 bug réel trouvé en testant dans un navigateur** (pas seulement via les tests automatisés) : un mouvement de stock à sens unique (ex. « exemplaire d'auteur ») créditait silencieusement un second lieu si le formulaire envoyait par erreur un lieu de destination non pertinent pour ce type de mouvement — invisible dans les tests automatisés qui n'exerçaient jamais cette combinaison précise. Corrigé (le delta n'est appliqué que sur le(s) lieu(x) que le type de mouvement exige réellement), régression ajoutée aux tests.

**Points d'interprétation signalés** (détail dans `docs/JOURNAL_TECHNIQUE.md`) : encours client approximé en l'absence du module Finance, frais de port et taxes non calculés automatiquement, facturation/avoirs/droits d'auteur non déclenchés (Lot 5), réservation sans répartition automatique multi-entrepôt, relance de dépôt-vente en retard non automatisée.

**Limites connues de ce Lot 4 :**
- Pas de tableau de bord dédié au stock ni au commercial (Ch. 16 §16.10, Ch. 17 §17.11) — hors périmètre minimal.
- Pas d'écran de bon de préparation (picking) avec scan (Ch. 16 §16.6) — les mouvements de sortie se saisissent directement.
- Analyse des ventes (palmarès, vitesse d'écoulement, taux de couverture des coûts, Ch. 17 §17.10) non implémentée — dépend en partie des coûts de fabrication consolidés (Ch. 15 §15.9) et du module Finance.

**Prochaine étape :** faire valider ce Lot 4 par l'opérateur, puis démarrer le Lot 5 (finance et droits d'auteur) une fois validé.

### 04/07/2026 (suite) — Arbitrage opérateur sur les 4 points d'interprétation du Lot 4

M. Noah Mbala a validé le Lot 4 sous réserve des 4 points signalés, avec la décision suivante :

1. **Stock déclassé : compartiment séparé du stock vendable.** Mis en œuvre immédiatement (ne dépendait pas du module Finance) : `stock_items.condition` (`vendable` / `declasse`), unique par (isbn, lieu, tirage, état). Un retour client avec verdict « défraîchi » crédite désormais ce compartiment séparé au lieu de n'être qu'une mention sur la ligne de retour ; exclu du calcul des alertes de rupture du stock vendable.
2. **Calcul financier précis de l'encours client, calcul automatique des frais de port et des taxes, facturation et droits d'auteur automatiques.** Ces trois points relèvent du module Finance (Ch. 18) et du moteur de droits d'auteur (Ch. 9 §9.5), tous deux prévus au **Lot 5**, qui démarre immédiatement pour les traiter.

**Prochaine étape :** démarrer le Lot 5 (finance et droits d'auteur).

### 04/07/2026 (suite) — Décision opérateur Ch. 18 §18.1/§18.10, puis livraison du Lot 5 : finance et droits d'auteur

L'opérateur a tranché le point d'interprétation ouvert par le cahier des charges lui-même (§18.1, §18.10) : **Option B — gestion financière opérationnelle + exports normalisés** vers un cabinet/logiciel comptable externe (pas de comptabilité générale intégrée dans Eclospace).

**Fait :**
- Schéma Prisma : `royalty_entries`/`royalty_statements`/`royalty_payments`, `invoices`/`invoice_lines` (immuables, avoirs rattachés par `parent_invoice_id`), `payments`/`payment_allocations` (lettrage), `expenses`/`cost_entries`, `budgets`/`budget_lines`, `bank_accounts`/`bank_statements`/`statement_lines`, `tax_rates`, `accounting_periods`, `accounting_exports`, `dunnings` (relance graduée).
- **Facturation clients (Ch. 18 §18.2)** : génération **automatique** de la facture à la livraison d'une vente ferme, à la validation d'un relevé de dépôt-vente, ou à une vente directe (numérotation chronologique continue `FA-AAAA-NNNNN`) ; avoir généré automatiquement depuis un retour client validé, rattaché à la facture d'origine ; une facture émise n'est jamais modifiée.
- **Encaissements et créances (Ch. 18 §18.3)** : enregistrement des règlements (virement, chèque, espèces, mobile money, carte) avec **lettrage** total/partiel ; **encours client calculé précisément** (solde dû = total TTC − paiements alloués − avoirs), remplaçant l'approximation du Lot 4 — `routes/commercial.ts` importe désormais `lib/finance.ts` ; **balance âgée** (non échu/30/60/90+ jours, échéance à 30 jours par défaut) ; **relance graduée** (rappel courtois → mise en demeure, tracée au dossier client, refusée au-delà).
- **Bug réel corrigé** : le taux de TVA d'une commande restait à 0 par défaut sans jamais consulter le référentiel de taux (`tax_rates`) — trouvé en écrivant les tests du Lot 5. C'était précisément le second point signalé par l'opérateur en validant le Lot 4 (« calcul automatique des taxes »). `POST /sales-orders` résout maintenant le taux automatiquement si non fourni.
- **Moteur de droits d'auteur (Ch. 9 §9.5, Ch. 18 §18.7)** : chaque vente/retour met déjà à jour le relevé de l'auteur (calcul connecté au module commercial, livré en toile de fond du Lot 4/5) ; génération **en un clic** d'un relevé de droits par période (agrège les mouvements non encore rattachés, amortit l'à-valoir restant, dégage un solde dû) ; ordre de paiement exécutable une fois le solde positif, avec retenue fiscale optionnelle.
- **Dépenses, analytique, budgets, trésorerie, taxes, exports (Ch. 18 §18.4-18.10)** : circuit de validation des dépenses avec **séparation des tâches stricte** (qui saisit ne peut pas valider seul) ; dépense rattachée à un ouvrage devenant un coût analytique automatiquement ; rentabilité par ouvrage (coût complet, marge, point d'équilibre) ; budgets prévisionnels par ouvrage/département avec révision motivée et tracée ; position de trésorerie et **plan prévisionnel** à 90 jours par fenêtres de 30 jours (encaissements attendus vs décaissements prévus, alerte sur point bas) ; taux de taxe paramétrables par pays/type de produit ; **clôture de période comptable bloquant toute nouvelle écriture financière** ; export comptable normalisé (CSV + somme de contrôle) vers le cabinet externe.
- **12 nouveaux tests automatisés** (79 au total, tous verts) : facture automatique avec TVA calculée, encaissement/lettrage réduisant l'encours, refus d'un lettrage incohérent, relance graduée à deux niveaux avec refus au-delà, amortissement de l'à-valoir avant tout paiement de droits, exécution d'un paiement de droits avec retenue fiscale, séparation des tâches sur la validation d'une dépense, dépense-ouvrage alimentant l'analytique, budget avec révision motivée, export comptable avec somme de contrôle, clôture de période bloquant une nouvelle facture. `vitest.config.ts` ajouté (`fileParallelism: false`) : la clôture de période comptable manipule un état global réel (le mois courant), qui entrerait en concurrence avec d'autres fichiers de test s'ils s'exécutaient en parallèle sur la même base.
- **Frontend** : nouvel écran transverse **Finance** (factures, encours/relance par client, dépenses avec formulaire de saisie, relevés de droits d'auteur). Vérifié dans un navigateur réel : affichage de la balance âgée pour un client sans facture, création d'une dépense, et blocage explicite de l'auto-validation (« Celui qui saisit une dépense ne peut pas la valider seul (Ch. 18 §18.11). ») affiché tel quel dans l'interface, conforme au guide de style (erreurs explicites).

**Points d'interprétation signalés** (détail dans `docs/JOURNAL_TECHNIQUE.md`) : échéance de facture à 30 jours par défaut faute de délai standard spécifié, relance à deux niveaux fixes, trésorerie prévisionnelle approximée (pas de rapprochement bancaire assisté), rapprochement à trois volets facture fournisseur/commande/réception non implémenté, provisionnement des créances douteuses non implémenté (le cahier des charges lui-même le note « à définir avec le comptable »), retenues fiscales sur droits d'auteur saisies manuellement (pas de barème automatique par pays).

**Point à signaler explicitement** : les « frais de port automatiques » demandés par l'opérateur en validant le Lot 4 **ne figurent nulle part dans le cahier des charges** (recherche faite dans les 22 chapitres) — aucune règle de calcul n'y est décrite. Cette fonctionnalité n'a pas été implémentée faute de spécification ; une clarification de l'opérateur est nécessaire (forfait par transporteur ? grille par zone ? intégration à une API de transporteur ?) avant de la construire.

**Limites connues de ce Lot 5 :**
- Pas de rapprochement bancaire assisté ni d'import de relevé (Ch. 18 §18.8) — les tables existent au schéma, aucune route d'import/pointage n'a été écrite.
- Pas de tableau de bord dédié Finance (Ch. 18 §18.11 : indicateurs consolidés pour la Direction générale) — les données sont consultables par écran, pas encore agrégées en un tableau de bord.
- Export comptable limité au CSV (le format prévu par l'Option B) ; aucun format spécifique à un logiciel comptable particulier n'a été demandé.

**Prochaine étape :** faire valider ce Lot 5 par l'opérateur (en particulier trancher le point des frais de port), puis démarrer le Lot 6 (RH, pilotage, rapports) une fois validé.

### 04/07/2026 (suite) — Renforcement du Lot 5 suite à la revue d'un contrôle de gestion externe (18,5/20, conformité Cameroun/SYSCOHADA)

L'opérateur a fait auditer le Lot 5 par un contrôle de gestion externe, qui a noté le module 18,5/20 et recommandé plusieurs améliorations avant validation définitive. Après clarification (plusieurs points étaient déjà couverts, un relève d'un lot ultérieur par construction du projet), tout ce qui était réalisable sans donnée manquante a été implémenté :

**Fait :**
- **Bug réel corrigé** : le moteur de droits d'auteur choisissait arbitrairement un contrat quand un même ouvrage avait plusieurs contrats actifs (ex. papier vs numérique) au lieu de sélectionner celui dont le format correspond à la vente — corrigé, avec un test à deux contrats/deux formats.
- **Frais de port paramétrables** (Ch. 17 §17.5) : zones Yaoundé / Douala / autres villes du Cameroun / international, avec forfait, tarif au kilogramme (poids réel de l'ouvrage) ou gratuité au-delà d'un seuil de commande — configurable par le financier sans redéveloppement, facturé une seule fois par commande.
- **Journal d'audit complet** sur tout le module Finance, y compris les factures/avoirs générés automatiquement par les événements commerciaux (livraison, dépôt-vente, vente directe, retour).
- **Escalade de validation des dépenses** au-delà d'un seuil paramétrable (500 000 par défaut) : validation finale réservée à la Direction générale, distincte du premier valideur et du créateur.
- **Rapprochement bancaire assisté** : import d'un relevé et pointage ligne à ligne avec un paiement.
- **Multi-caisses et virements internes** : distinction banque/caisse/mobile money par compte, virement entre comptes propres à la maison sans effet sur la position de trésorerie globale, solde par compte.
- **Export comptable enrichi façon SYSCOHADA** : colonnes compte débit/compte crédit/journal/centre analytique/référence de pièce, directement exploitables par Sage, Odoo, SAP ou Excel (tous important un CSV structuré) — **le plan de comptes est indicatif, non certifié, à valider par le comptable de la maison avant tout dépôt réel** (signalé explicitement dans la réponse de l'export). Un second bug réel a été corrigé au passage : un paiement de droits d'auteur était compté deux fois dans l'export.
- **14 nouveaux tests automatisés** (86 au total, tous verts). Vérifié dans un navigateur réel : paramétrage d'un tarif de frais de port par zone, création de deux comptes (banque + caisse) avec affichage du solde.

**Points explicitement non traités, avec justification :**
- Connecteurs dédiés Sage/Odoo/SAP/export .xlsx binaire : le CSV enrichi s'importe déjà dans ces logiciels sans connecteur propriétaire à maintenir (cohérent avec la sobriété technique demandée) ; un vrai `.xlsx` nécessiterait une nouvelle dépendance non requise.
- Tableaux de bord Finance consolidés : relèvent du Lot 6 « RH, pilotage, rapports » selon le découpage du projet lui-même — non commencés en avance sur le plan de développement.
- Circuit de validation des dépenses à un vrai palier « responsable hiérarchique » personnel : suppose un organigramme (RH, Lot 6) qui n'existe pas encore ; le circuit à deux paliers retenu (validation courante + Direction générale au-delà du seuil) reste une amélioration réelle sans anticiper ce module.

**Prochaine étape :** faire valider ce renforcement par l'opérateur, puis démarrer le Lot 6 (RH, pilotage, rapports).
