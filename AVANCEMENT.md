# Eclospace — Avancement du développement

| Lot | Contenu | Statut |
|---|---|---|
| Lot 0 | Fondations (sécurité, rôles, audit, GED, notifications) | En cours — socle backend/frontend fonctionnel |
| Lot 1 | Entrée des manuscrits, comité de lecture, workflow | En cours — flux complet fonctionnel (étapes 1 à 5) |
| Lot 2 | Contrats, planification/Gantt, correction | En cours — flux complet fonctionnel (étapes 5 à 7) |
| Lot 3 | Maquette, infographie, ISBN, BAT, impression | En cours — flux complet fonctionnel (étapes 10 à 15) |
| Lot 4 | Stock et commercial | En cours — flux complet fonctionnel (étapes 16 à 18) |
| Lot 5 | Finance et droits d'auteur | **Validé par l'opérateur (04/07/2026)** |
| Lot 6 | RH, pilotage, rapports | **Validé par l'opérateur (05/07/2026)** |

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

### 04/07/2026 (suite) — Convention de droits d'auteur entièrement paramétrable

L'opérateur a transmis une proposition détaillée (9 points) pour rendre la convention de droits d'auteur entièrement paramétrable, conforme à la liberté contractuelle laissée par la législation camerounaise. Analyse faite avant mise en œuvre : plusieurs points étaient déjà couverts par le moteur existant (calcul classique, amortissement de l'à-valoir, paliers de vente, taux par support, base HT/net éditeur) ; trois manques réels ont été comblés :

**Fait :**
- **Répartition entre plusieurs bénéficiaires** (auteur + illustrateur, coauteurs...) : chaque contrat peut désormais définir une répartition en pourcentage (somme obligatoirement égale à 100 %) ; le paiement des droits crée automatiquement un versement distinct par bénéficiaire, proportionnel à sa part. Sans répartition configurée, tout va au partenaire unique du contrat comme avant (aucune régression).
- **Paiements partiels des droits d'auteur** : un relevé peut désormais être réglé en plusieurs fois (acompte puis solde), avec suivi du solde restant affiché à l'écran ; le relevé ne passe « réglé » que lorsque le solde atteint zéro.
- **Retenue fiscale par défaut et périodicité au niveau du contrat** : un taux de retenue fiscale peut être fixé une fois pour toutes sur le contrat (appliqué automatiquement à chaque paiement, sauf surcharge ponctuelle) ; la périodicité des relevés (mensuelle/trimestrielle/semestrielle/annuelle) est désormais un champ du contrat — à titre indicatif, la génération reste une action volontaire (pas de tâche planifiée automatique, aucune infrastructure de ce type dans le projet).
- **3 nouveaux tests automatisés** (89 au total, tous verts). Vérifié dans un navigateur réel : les nouveaux boutons « Répartir entre bénéficiaires » et le paiement partiel des droits s'affichent et fonctionnent sans erreur.

**Point volontairement non traité, avec justification** : la base de calcul « recettes d'exploitation » (pour les cessions de droits à l'étranger) suppose un module de suivi des revenus de cession de droits qui n'existe pas dans Eclospace — contrairement aux bases HT/net éditeur qui se calculent directement sur une vente déjà enregistrée. Ajouter cette option sans les données sous-jacentes produirait un champ inutilisable ; à construire si un module de cession de droits est confirmé nécessaire.

**Prochaine étape :** faire valider cette évolution par l'opérateur, puis démarrer le Lot 6 (RH, pilotage, rapports).

### 04/07/2026 (suite) — Lot 5 validé par l'opérateur ; démarrage du Lot 6 : RH, pilotage, rapports

M. Noah Mbala a validé le Lot 5 et demandé le démarrage immédiat du Lot 6, dernier lot du plan de développement (Ch. 19 RH, Ch. 5 Direction générale/pilotage intelligent, Ch. 20 rapports/BI). Relecture complète des trois chapitres avant développement (règle CLAUDE.md n°2) ; le détail du lot suit dans une prochaine entrée.

### 04/07/2026 (suite) — Livraison du Lot 6 : RH, pilotage, rapports (dernier lot du plan de développement)

**Fait :**
- **Ressources humaines (Ch. 19)** : dossier collaborateur (arrivée avec création de compte et notification du responsable, mobilité, départ avec désactivation automatique du compte — immédiate ou à la prochaine connexion, suspension/réactivation) ; module confidentiel séparé (salaire de base, notes) avec consultation journalisée comme le juridique ; attribution/retrait de rôle avec justification ; détection d'anomalies d'accès (compte sans dossier RH, cumul saisie/administration sur un module sensible) ; campagnes de revue périodique des habilitations ; circuit de demande/validation des congés avec décompte du solde ; disponibilité et charge de travail consolidées depuis les autres modules ; cartographie des compétences ; préparation des variables de paie.
- **Direction générale (Ch. 5)** : tableau de bord consolidé (éditorial, production, commercial, financier — masqué sans la permission finance), recherche globale combinable (numéro, titre, contributeur, collection, ISBN), fiche synthétique d'un ouvrage, alertes automatiques à quatre niveaux de priorité (tâches en retard, validations en attente, contrats non signés, BAT à approuver, stock faible, échéances impayées).
- **Centre de pilotage intelligent (Ch. 5 §5.9, Ch. 20 §20.6)** : règles configurables (manuscrits bloqués, projection de rupture de stock, dépassement budgétaire) génératrices de recommandations en langage naturel, traitées avec traçabilité (traité/reporté/ignoré + commentaire).
- **Rapports et indicateurs (Ch. 20)** : dictionnaire d'indicateurs (une formule, une source de vérité par indicateur), bibliothèque de 5 rapports standards générés à la demande (flux éditorial, délais de production, ventes par canal, marges par ouvrage, charge RH par département), explorateur d'analyses personnelles contraint au registre d'indicateurs (partage entre utilisateurs, promotion en rapport standard), simulation de tirage (coût unitaire et durée d'écoulement estimée).
- Trois écrans frontend ajoutés (Ressources humaines, Direction générale, Rapports), vérifiés dans un navigateur réel (Playwright) : connexion, navigation, génération d'un rapport avec affichage des lignes, génération des recommandations — aucune erreur.
- **20 nouveaux tests automatisés** (109 au total, tous verts).

**Points d'interprétation et simplifications, documentés dans `docs/JOURNAL_TECHNIQUE.md` :**
- Aucune tâche planifiée (cron) dans le projet : désactivation de compte, génération des recommandations et des rapports sont toutes déclenchées à la demande ou paresseusement à la connexion, jamais en tâche de fond.
- Paie complète (bulletins, déclarations sociales) : non implémentée, hors périmètre par défaut selon le cahier des charges lui-même (Ch. 19 §19.7, « à confirmer »). Seule la préparation des variables l'est.
- Entretiens périodiques d'évaluation : non implémentés — le cahier des charges les signale lui-même comme un point à trancher avec la direction (Ch. 19 §19.6), pas comme une exigence actée.
- Explorateur d'analyses volontairement contraint au registre d'indicateurs existant plutôt qu'un moteur de tableau croisé entièrement libre, pour garantir qu'un même indicateur ne soit jamais calculé différemment à deux endroits.
- Revue des habilitations : un réviseur uniquement pour les employés ayant un responsable hiérarchique identifié (pas d'autorité de repli inventée).

**Prochaine étape :** faire valider ce Lot 6 par l'opérateur — c'est le dernier lot du plan de développement.

### 05/07/2026 — Correctif : l'application restait bloquée sur le chargement en environnement de validation

L'opérateur a signalé que l'application restait bloquée sur le chargement (aucune interface ne s'affichait). Reproduit et corrigé :

- **Cause réelle** : PostgreSQL n'est pas démarré automatiquement dans les environnements Claude Code sur le web (pas de `systemd`) — sans base de données, toutes les requêtes échouent et rien ne peut jamais s'afficher. Corrigé en ajoutant un hook de démarrage de session (`.claude/hooks/session-start.sh`, déclaré dans `.claude/settings.json`) qui démarre PostgreSQL, attend qu'il accepte les connexions, applique les migrations et réamorce les données de base (dev + test) avant toute autre action — validé par un test à froid (base arrêtée puis relancée uniquement via ce hook).
- **Bug réel trouvé pendant cette vérification** (sans lien avec le signalement initial, mais qui aurait fait échouer `npm test` en re-validation) : `tests/lot6-hr-pilotage.test.ts` utilisait des identifiants de compte statiques (`manager_arrivee_test`, `arrivant_test`...) créés via `POST /employees` (un vrai `create`, pas un `upsert`) — une seconde exécution de la suite sur la même base de test (non réinitialisée entre les runs, comme documenté dans `tests/helpers.ts` pour `uniqueIsbnPrefix`) provoquait une violation de contrainte d'unicité sur `users.username`, donc une erreur 500 en cascade sur 4 tests. Corrigé avec un suffixe aléatoire par exécution (même principe que `uniqueIsbnPrefix`), vérifié par trois exécutions consécutives de `npm test` sans réinitialisation de la base entre elles (109/109 à chaque fois).

### 05/07/2026 (suite) — Lot 6 validé par l'opérateur : fin du plan de développement

M. Noah Mbala a validé le Lot 6 après correction du blocage au chargement. Les sept lots du plan de développement (`docs/05_Plan_de_developpement.md`, Lot 0 à Lot 6) sont désormais tous validés. Le périmètre applicatif spécifié au cahier des charges (`docs/01_Cahier_des_charges.md`) est couvert de bout en bout : du dépôt d'un manuscrit à l'archivage, en passant par le comité de lecture, les contrats, la production éditoriale, l'impression, le stock, le commercial, la finance et les droits d'auteur, jusqu'aux RH, à la Direction générale et aux rapports.

**Limites et points ouverts restants** (récapitulatif, détail dans `docs/JOURNAL_TECHNIQUE.md`) :
- Hébergement de production (fournisseur cloud et région) à préciser avant toute mise en production (décision D-004).
- Paie complète (bulletins, déclarations sociales) et entretiens périodiques d'évaluation : hors périmètre par défaut, le cahier des charges les signale lui-même comme à confirmer.
- Comptabilité générale tenue par un cabinet externe (Option B) : Eclospace exporte, ne tient pas le grand livre ; le plan de comptes SYSCOHADA fourni est indicatif, non certifié.
- Base de calcul « recettes d'exploitation » pour les droits d'auteur (cession de droits à l'étranger) : non modélisée, aucun flux de données sous-jacent dans le projet.
- Explorateur d'analyses contraint au registre d'indicateurs existant, pas un moteur de tableau croisé entièrement libre.

**Prochaine étape :** aucune au titre du plan de développement initial ; évolutions futures à discuter avec l'opérateur (hébergement de production, périmètre paie, points ouverts ci-dessus).

### 05/07/2026 (suite) — Décision opérateur sur l'hébergement de production (D-004-bis)

Quatre options comparées (PaaS francophone Scalingo, VPS économique Hetzner/OVH, PaaS anglophone Render, grand cloud AWS/OVHcloud avancé). M. Noah Mbala a choisi **Scalingo** (PaaS français, région Paris) : support en français, PostgreSQL géré (sauvegardes et mises à jour de sécurité assurées par le prestataire, sans avoir à administrer un serveur), déploiement par `git push`, coût prévisible, bonne latence réseau France ↔ Cameroun. Décision consignée dans `docs/06_Registre_des_decisions.md` (D-004-bis) et `docs/JOURNAL_TECHNIQUE.md`.

**Prochaine étape :** créer le compte Scalingo, connecter le dépôt Git, provisionner une application + une base PostgreSQL managée par environnement (recette, puis production), configurer les variables d'environnement (secrets), premier déploiement, puis test réel dans un navigateur par l'opérateur lui-même — la première vérification en conditions réelles depuis le début du projet.

### 05/07/2026 (suite) — Préparation du déploiement Scalingo (Procfile, build, migrations automatiques)

**Fait :**
- `package.json` et `Procfile` ajoutés à la racine du dépôt : un script `build` qui compile le frontend puis le backend et copie le frontend compilé dans `backend/public` ; `Procfile` définit le processus `web` et un hook `postdeploy` qui applique les migrations Prisma après chaque déploiement.
- **Une seule application Scalingo** au lieu de deux : le backend (Fastify) sert désormais aussi le frontend compilé (`@fastify/static`, avec repli vers `index.html` pour les routes de l'interface) — plus simple et moins cher à exploiter qu'un backend + un frontend séparés avec buildpack Nginx (cohérent avec CLAUDE.md règle 6).
- `prisma` déplacé des dépendances de développement vers les dépendances de production dans `backend/package.json` (nécessaire pour que le hook de migration fonctionne après le nettoyage des dépendances de développement fait par Scalingo).
- Variables d'environnement à configurer documentées dans `docs/JOURNAL_TECHNIQUE.md` (`SESSION_SECRET` à définir manuellement ; `DATABASE_URL`/`PORT` fournis automatiquement par Scalingo).
- **Vérifié en local** en simulant exactement les commandes Scalingo (build à la racine, démarrage sans fichier `.env`, uniquement des variables d'environnement) : page d'accueil, routes de l'interface, fichiers statiques, API et 404 explicite sur une route API inconnue, tous corrects. Les 109 tests automatisés restent tous verts.

**Point bloquant signalé avant tout usage réel en production (pas avant la recette)** : le stockage des documents (contrats, BAT, visuels...) écrit sur le disque local du serveur, qui est **éphémère** chez Scalingo (perdu à chaque redémarrage/redéploiement). Nécessite un stockage objet compatible S3, à choisir avec l'opérateur avant de déposer de vrais documents en production — détail dans `docs/JOURNAL_TECHNIQUE.md`.

**Prochaine étape :** l'opérateur crée le compte Scalingo et l'application de recette (avec l'addon PostgreSQL), connecte ce dépôt Git, définit `SESSION_SECRET`, puis un premier déploiement peut être tenté et testé dans un navigateur réel.

### 05/07/2026 (suite) — Fusion dans main (PR #2) et correction : le seed manquait au déploiement

- **PR #2 fusionnée dans `main`** : la configuration de déploiement (décision Scalingo + Procfile/build) est désormais sur la branche de référence. C'est `main` que Scalingo déploiera.
- **Correction avant le premier déploiement** : le hook `postdeploy` appliquait les migrations mais **pas le seed** — une base Scalingo neuve aurait été vide (ni départements/rôles/permissions, ni compte administrateur), rendant l'application inutilisable et l'écran de connexion inaccessible. Ajouté au hook (`seed:deploy`), avec `tsx` déplacé en dépendance de production (comme `prisma`) pour qu'il fonctionne dans l'image finale.
- **Sécurité vérifiée** : le seed est idempotent (rejouable à chaque déploiement sans rien écraser) et le mot de passe du compte administrateur (`ADMIN_INITIAL_PASSWORD`, à définir par l'opérateur) n'est **jamais réinitialisé par un redéploiement** une fois changé depuis l'interface — testé concrètement (connexion réussie, puis l'ancien mot de passe reste valide et le nouveau du seed est refusé après une relance simulant un redéploiement).
- Compte administrateur de départ : identifiant **`admin`**, mot de passe = variable `ADMIN_INITIAL_PASSWORD` (à définir dans l'onglet Environment de Scalingo, valeur forte), à changer dès la première connexion.

**Prochaine étape :** l'opérateur configure l'application Scalingo (branche `main`, addon PostgreSQL, variables `SESSION_SECRET` et `ADMIN_INITIAL_PASSWORD`), déclenche le premier déploiement et se connecte dans un navigateur réel — première vérification en conditions réelles du projet.

### 08/07/2026 — Nouvelles spécifications fonctionnelles, Phase 1 (Sécurité & confort)

Suite à un nouveau cahier de spécifications fonctionnelles (9 points : icône œil, gestion des comptes, droits configurables par pôle, passe-partout admin, classement rapide/multicritère, archivage hiérarchique, antidatage, journal de traçabilité), plan validé par l'opérateur en 5 phases. **Phase 1 livrée :**

- **Icône « œil » sur les champs sensibles (§1)** : nouveau composant réutilisable `frontend/src/components/PasswordInput.tsx` — bouton afficher/masquer, champ masqué par défaut. Appliqué à l'écran de connexion (`Login.tsx`) et à la section « Sécurité du compte » (`AccountSecurity.tsx`, 4 champs). Vérifié dans un navigateur réel (captures : point masqué → texte en clair, icône alignée au bord droit du champ).
- **Réinitialisation d'un mot de passe par l'administrateur (§1)** : nouvel endpoint `POST /api/v1/users/:id/reset-password`, réservé au niveau `users:administration`. L'admin fixe un nouveau mot de passe pour un compte (utilisateur ayant perdu le sien) ; règles de complexité appliquées, opération tracée au journal d'audit **sans jamais y écrire le mot de passe**. Bouton « Réinitialiser le mot de passe » ajouté sur chaque compte de l'écran « Utilisateurs & rôles ».
- **4 tests automatisés** ajoutés (réinitialisation réussie + reconnexion avec le nouveau mot de passe, ancien mot de passe rejeté, trace d'audit, refus d'un mot de passe faible en 400, refus 403 sans habilitation). Suite complète : **125 tests passent**.

**Prochaine étape :** Phase 2 — dates & antidatage (date de publication/parution historique sur les ouvrages + import des livres déjà parus avec leur date réelle, tracé).

### 08/07/2026 (suite) — Phase 2 (Dates & antidatage)

Deuxième phase des nouvelles spécifications fonctionnelles (points §5/§8 : date de parution réelle + saisie rétroactive des ouvrages déjà parus). **Phase 2 livrée :**

- **Date de parution sur les ouvrages** : nouveau champ `publication_date` (nul tant que le livre n'est pas paru) + drapeau `is_back_catalogue` (ouvrage déjà paru saisi rétroactivement). Migration `add_manuscript_publication_date`. La colonne « Paru le » apparaît dans la liste des manuscrits ; la date figure sur la fiche de l'ouvrage.
- **Antidatage tracé (§8)** : endpoint `POST /api/v1/manuscripts/:id/publication-date` — renseigner ou corriger la date de parution réelle. Le journal d'audit conserve **la date de parution historique ET la date de saisie effective** (`recorded_at`), et signale l'antidatage (`antidated: true` si la date est antérieure à ce jour). Sur la fiche, un lien « Renseigner / Modifier » ouvre une saisie de date pour les profils habilités (`manuscripts:saisie`).
- **Import d'un ouvrage déjà paru (§8)** : endpoint `POST /api/v1/manuscripts/import` + bouton « + Importer un ouvrage déjà paru » sur l'écran Manuscrits. L'ouvrage entre **directement au « Suivi post-publication »** avec sa date de parution historique, sans dérouler le circuit de production — pour constituer le catalogue existant de la maison. Refus explicite d'une date de parution future. Traçabilité complète au journal (`imported`, `back_catalogue`, date historique, date de saisie, antidatage).
- **4 tests automatisés** ajoutés (import avec date historique + statut post-publication + trace d'audit ; refus d'une date future ; antidatage d'un ouvrage existant tracé ; refus 403 sans habilitation). Suite complète : **133 tests passent**. Parcours vérifié dans un navigateur réel (import d'un ouvrage daté du 10/05/2019, badge « ouvrage déjà paru », puis modification de la date en 20/11/2018 avec confirmation).

**Prochaine étape :** Phase 3 — catalogue & classements (raccourcis par période, tri/filtre multicritère, mémorisation du dernier tri, gestion des domaines/collections).

### 08/07/2026 (suite) — Phase 3 (Catalogue & classements)

Troisième phase des nouvelles spécifications fonctionnelles (points §5/§6 : classement rapide par période + classement multicritère + gestion des domaines/collections). **Phase 3 livrée :**

- **Barre de classement du catalogue** sur l'écran Manuscrits (vue globale) : **raccourcis par période** de parution (Tout, Cette année, Année dernière, Ce mois-ci) + bornes de date personnalisées ; **filtres multicritères** (recherche par titre, domaine, collection, ouvrages déjà parus / entrés en production) ; **tri** configurable (priorité, titre, date de parution, date de réception) avec choix de l'ordre. L'API `GET /api/v1/manuscripts` accepte désormais ces paramètres.
- **Mémorisation du dernier tri/filtre** (§6) : les préférences de classement sont enregistrées dans le navigateur (`localStorage`) et restaurées à la session suivante. État vide dédié quand aucun ouvrage ne correspond aux critères (avec bouton « Réinitialiser les filtres »).
- **Gestion des domaines & collections** (§6) : nouvel écran « Domaines & collections » (pôle Éditorial) — ajout/retrait, code court généré automatiquement, **retrait logique refusé tant qu'un ouvrage utilise l'entrée** (message explicite), chaque opération journalisée. Endpoints `POST/DELETE /api/v1/genres` et `/api/v1/collections`, réservés au niveau `manuscripts:administration`.
- **5 tests automatisés** ajoutés (filtre par période + tri par date ; filtre « déjà parus » + recherche titre ; création/retrait d'un domaine + refus si utilisé ; gestion collections + refus code déjà pris ; refus 403 sans habilitation). Suite complète : **139 tests passent**. Parcours vérifié dans un navigateur réel (filtre 2020-2025, ajout du domaine « Bande dessinée »).

**Prochaine étape :** Phase 4 — archivage hiérarchique (arborescence année/mois/jour, collection, auteur, catégorie).

### 09/07/2026 — Phases 4 & 5 (Archivage hiérarchique + Gouvernance admin)

Quatrième et cinquième phases livrées ensemble (à la demande de l'opérateur), sur une même branche/PR.

**Phase 4 — Archivage hiérarchique (§7) :**
- Nouvel écran « Archives » (pôle Éditorial) : classement hiérarchique de tous les ouvrages, arborescence dépliable avec compteurs. Axes sélectionnables : **Année › Mois**, **Année › Mois › Jour**, **Collection › Année**, **Domaine › Année**, **Auteur**. Les ouvrages sans date de parution sont regroupés sous « Date inconnue ». Un clic sur un ouvrage ouvre sa fiche.
- Endpoint `GET /api/v1/archives` : projection légère (date de parution, collection, domaine, auteur, étape) ; l'arbre est reconstruit côté client selon l'ordre d'axes choisi — pas de combinatoire d'endpoints.

**Phase 5 — Gouvernance admin (§2, §3 ; décision A) :**
- **Gestion des comptes** (écran Utilisateurs & rôles enrichi) : création de compte (identifiant, e-mail, mot de passe conforme, rôle initial), **suspension/réactivation**, **suppression logique**. Garde-fous : pas d'auto-suspension, pas d'auto-suppression, **jamais le dernier administrateur général**. Endpoints `POST/PATCH/DELETE /api/v1/users`.
- **Matrice des droits éditable** (écran « Droits & pôles ») : pour chaque rôle, l'administrateur coche/décoche les actions (consulter/saisir/valider/administrer) par module. Effet immédiat (vérifié : un rôle passe de 403 à 200 après ajout). L'**Administrateur général reste en lecture seule** (accès de secours). Endpoints `GET /api/v1/permissions`, `GET/POST /api/v1/roles/:id/permissions`.
- **Gestion des pôles** (départements) : ajout (code auto-généré) / retrait logique, **refusé si des rôles ou employés y sont rattachés**. Endpoints `GET/POST/DELETE /api/v1/departments`. Décision A actée : pôle = département créable, profil = rôle, niveau = action.
- Toutes ces opérations sont réservées au niveau `users:administration` et journalisées.
- **9 tests automatisés** ajoutés (archives + axes ; création/suspension/réactivation de compte + connexion ; mot de passe faible refusé ; anti-auto-suppression ; matrice appliquée immédiatement ; super-admin protégé ; création/retrait de pôle + refus si utilisé ; refus 403 sans habilitation). Suite complète : **151 tests passent**. Parcours vérifié au navigateur (arbre des archives, création de compte, matrice de droits, ajout d'un pôle).

**Prochaine étape :** consolidation / retours de l'opérateur — les 5 phases des nouvelles spécifications fonctionnelles sont couvertes.

### 09/07/2026 (suite) — Renforcement gouvernance : passe-partout, usurpation d'identité, mot de passe maître, droits par pôle

À la demande de l'opérateur, quatre fonctionnalités d'administration avancée (précisions des points §2/§3/§4).

- **Compte passe-partout inbloquable** : champ `is_protected` sur les comptes (posé sur `admin` par le seed ; migration `add_user_is_protected`). Le compte protégé ne peut être ni suspendu, ni supprimé, ni privé de son rôle d'administrateur général — garantie d'un accès de secours permanent.
- **« Se connecter en tant que » (usurpation d'identité)** : `POST /api/v1/users/:id/impersonate` — un administrateur voit l'application sous l'identité d'un autre compte (assistance). Un **bandeau orange** l'indique en permanence avec un bouton « Revenir à mon compte » (`POST /api/v1/auth/stop-impersonation`). Début et fin tracés au journal ; interdit de viser le compte passe-partout ou soi-même ; l'identité réelle de l'administrateur est conservée dans la session.
- **Mot de passe maître de secours (« bris de glace »)** : `lib/masterPassword.ts` + variable `MASTER_PASSWORD_HASH` (empreinte argon2, jamais le mot de passe en clair). **Désactivé par défaut.** N'ouvre **que** le compte passe-partout, contourne le second facteur (perte d'appareil), et journalise chaque usage en priorité haute. Choix de conception assumé : pas de mot de passe unique ouvrant n'importe quel compte (anti-pattern) — l'accès aux autres comptes passe par l'usurpation d'identité, tracée et réversible.
- **Droits par pôle en une opération** : `POST /api/v1/departments/:id/permissions` applique (ou retire) un droit à **tous les rôles d'un pôle** d'un coup (le rôle administrateur général n'est jamais affecté). Section « Réglage groupé par pôle » sur l'écran Droits & pôles.
- **Correctif transverse** : le client HTTP ne déclarait `Content-Type: application/json` que par défaut, ce qui faisait échouer les requêtes POST **sans corps** (usurpation, retour, déconnexion) avec une erreur Fastify « corps vide ». Le type n'est désormais envoyé que lorsqu'un corps est présent.
- **7 tests automatisés** ajoutés (passe-partout non suspensible/supprimable ; mot de passe maître ouvre le compte protégé et pas un compte ordinaire, tracé ; usurpation + retour reflétés par /me ; usurpation du passe-partout interdite ; droit appliqué à tout un pôle ; refus 403 sans habilitation). Suite complète : **149 tests passent**. Usurpation et réglage par pôle vérifiés dans un navigateur réel (bandeau, bascule de vue, retour au compte).

**Prochaine étape :** consolidation / retours de l'opérateur.

### 09/07/2026 (suite) — Identité visuelle premium (fondation navy / or / blanc)

Nouvelle identité visuelle validée par l'opérateur : bleu marine (confiance, ~70 %), blanc (clarté, ~20 %), or (prestige/marque, accent ~10 %). **Fondation livrée** (le reste est proposé en phases) :

- **Palette officielle centralisée** dans `frontend/src/styles/tokens.css` : bleu marine `#16233D`/`#1E2A44`/`#223252`, fond `#F8F9FB`, cartes `#FFFFFF`, or `#C89A1B` (+ or clair `#D9B24C`, or foncé `#A87D14`). Comme toute l'application lit ces jetons, **l'ensemble de l'interface est reskinné d'un coup** (barre latérale, cartes, accents, fonds, titres en bleu marine). La référence de couleur du guide (CLAUDE.md §5) est mise à jour.
- **Champs de saisie** : halo doré discret au focus (règle CSS globale) — effet « logiciel soigné » sans toucher chaque champ.
- **Page de connexion premium** : fond bleu marine en dégradé, carte blanche très arrondie (18 px) et ombrée, logo centré agrandi, bouton or en dégradé avec halo et brillance au survol.
- **Menu latéral** : élément sélectionné = fond or très léger + **barre dorée de 4 px** + texte blanc renforcé.
- Vérifié au navigateur (connexion + pages internes) : rendu haut de gamme, lisibilité conservée.

**Proposé pour les phases suivantes** (plus lourdes, à valider) : boutons sémantiques (`<Button variant>` : Ajouter=or, Modifier=navy, Voir=contour, Supprimer=rouge, Exporter=vert), refonte des tableaux (en-tête navy, zébrage, survol or), grands indicateurs KPI du tableau de bord (nécessite des endpoints de comptage), barre supérieure avec menu profil/avatar, jeu d'icônes modernes en remplacement des puces.

**Prochaine étape :** retour de l'opérateur sur la fondation visuelle, puis phases suivantes de l'identité.

### 09/07/2026 (suite) — Identité visuelle : boutons sémantiques + menu mobile escamotable

- **Barre latérale responsive** (retour opérateur : sur téléphone, la barre fixe occupait ~65 % de l'écran) : sous 900 px, elle passe en **tiroir escamotable** (hook `useIsMobile`, bouton ☰ dans la barre supérieure, voile cliquable, fermeture après sélection) ; comportement inchangé sur grand écran. Vérifié en 390 px.
- **Boutons sémantiques** : nouveau composant `<Button variant>` (styles dans `tokens.css`, jeton vert `--success` ajouté) — **Ajouter = or, Modifier = bleu marine, Voir = contour, Supprimer = rouge discret, Exporter = vert**, avec états survol/actif/désactivé. Déployé sur les écrans à forte densité d'actions : Utilisateurs & rôles, Manuscrits (nouveau/import/enregistrer), Domaines & collections, Droits & pôles (réglages groupés), Paramètres (cartes de seuils + sécurité du compte). Chaque action est désormais reconnaissable à sa couleur. Vérifié au navigateur.

**Proposé pour la suite** : refonte des tableaux (en-tête navy, zébrage, survol or) puis grands indicateurs KPI du tableau de bord.

**Prochaine étape (avant les tableaux) :** fiabiliser le menu mobile (ci-dessous).

### 09/07/2026 (suite) — Fiabilisation du menu mobile (piloté par CSS)

Retour opérateur : sur un vrai téléphone, la barre latérale réapparaissait en mode fixe (contenu écrasé), alors que l'émulation navigateur montrait le tiroir fonctionner. Cause : le basculement mobile reposait sur du **JavaScript** (`matchMedia`), qui peut ne pas se déclencher sur un appareil réel (mode « site pour ordinateur », particularités du navigateur).

- **Layout responsive repassé en CSS pur** (média-requêtes `@media (max-width: 900px)` dans `tokens.css`) : sous 900 px, la barre latérale devient un tiroir escamotable (classes `app-shell` / `app-sidebar` / `app-menu-btn` / `app-backdrop`) ; au-dessus, barre fixe en flux. Le JavaScript ne sert plus qu'à ouvrir/fermer le tiroir (bouton ☰). Hook `useIsMobile` supprimé (plus nécessaire).
- Vérifié au navigateur avec une fenêtre **390 px « nue »** (sans forcer le mode mobile, au plus près d'un vrai navigateur) : barre hors écran + ☰ visible + contenu pleine largeur ; ouverture du tiroir avec voile ; et en 1200 px, barre fixe sans ☰. Aucun débordement horizontal.

**Prochaine étape :** tableaux premium, puis KPI du tableau de bord.

### 09/07/2026 (suite) — Identité visuelle : tableaux premium

- **Classe `.ecl-table`** (dans `tokens.css`) : en-tête **bleu marine + texte blanc** (majuscules), **lignes alternées** (blanc / gris très clair), **survol en or très pâle** ; cellules `.mono` (identifiants/dates, chasse fixe alignée à gauche) et `.num` (quantités, chasse fixe alignée à droite).
- Appliquée aux tableaux : **liste des ouvrages** (Manuscrits), **Journal d'activité**, **matrice des droits** (Droits & pôles), et au composant générique **`DataTable`** — ce qui reskin aussi les tableaux de **Direction générale** et **Rapports & statistiques**.
- Vérifié au navigateur : en-têtes marine, zébrage, lisibilité nettement améliorée des listes.

**Prochaine étape :** grands indicateurs KPI du tableau de bord (nécessite des endpoints de comptage + tests).

### 09/07/2026 (suite) — Tableau de bord : grands indicateurs (KPI)

Dernier point de la refonte visuelle proposée par l'opérateur.

- **Backend** : nouvel endpoint `GET /api/v1/dashboard/stats` (`requireAuth`) renvoyant quatre indicateurs — **Ouvrages** (manuscrits), **Utilisateurs** (comptes actifs), **Ventes** (commandes de vente), **Stock** (total d'exemplaires physiques). Chaque indicateur n'est calculé et renvoyé que si l'utilisateur a la permission de consultation correspondante (`manuscripts` / `users` / `commercial` / `stock`) — sinon `null`, respect de la confidentialité par module.
- **Frontend** : le tableau de bord affiche ces indicateurs en tête, chacun dans une **carte blanche avec icône dorée** et un **grand chiffre** formaté (séparateur de milliers), au-dessus du rappel de session. Seules les cartes autorisées s'affichent.
- **3 tests automatisés** (cohérence des chiffres pour l'admin ; masquage `null` hors périmètre ; 401 sans session). Suite complète : **152 tests passent**. Vérifié au navigateur (78 ouvrages, 43 utilisateurs, 19 ventes, 3 802 en stock).

**Refonte visuelle premium : tous les points proposés par l'opérateur sont couverts** (palette navy/or/blanc, connexion, menu actif + tiroir mobile, cartes, boutons sémantiques, tableaux, indicateurs KPI).

**Prochaine étape :** retours de l'opérateur.

### 09/07/2026 (suite) — Finitions premium : barre de profil + icônes de navigation

Deux finitions optionnelles demandées par l'opérateur.

- **Barre supérieure — menu de profil** (façon Microsoft 365 / Notion) : un **avatar** (initiales, fond doré) en haut à droite ouvre un menu déroulant — identité + e-mail, « Paramètres du compte », « Se déconnecter ». Le bouton « Se déconnecter » isolé disparaît. Bonus : l'accès aux **Paramètres** (donc à la sécurité du compte / changement de mot de passe) est désormais offert à **tous** via ce menu ; la page Paramètres reste accessible sans habilitation « settings » (elle n'affiche alors que la « Sécurité du compte », sans erreur).
- **Icônes de navigation** : jeu d'icônes monochromes (trait), sobres et premium (`components/icons.tsx`) — un pictogramme par pôle (livre, production, panier, finance, utilisateurs, graphique) et pour le tableau de bord (maison), **teinté d'or quand le pôle est actif**. Les **puces de présence vertes** sont remplacées par une **petite silhouette dorée** (+ nombre si plusieurs).
- Vérifié au navigateur : avatar + menu déroulant (identité, Paramètres, Déconnexion fonctionnelle), icônes de pôles dorées à l'ouverture, présence en silhouette dorée.

**Refonte visuelle premium : terminée** (palette, connexion, menu + icônes + tiroir mobile, cartes, boutons sémantiques, tableaux, indicateurs KPI, barre de profil).

**Prochaine étape :** retours de l'opérateur.

### 09/07/2026 (suite) — Refonte des accès (lot 1/2) : recherche, journalisation, présence confidentielle

Première tranche de la « refonte du système de connexion et de gestion des accès » demandée par l'opérateur, en respectant la consigne : **ne rien changer à la présentation générale ; les ajouts se font en fenêtres qui se déroulent au clic.** Branche `claude/eclospace-next-steps-1a32bp`.

1. **Recherche rapide fonctionnelle** (corrige « la barre de recherche ne renvoie à rien ») : le champ de la barre supérieure était décoratif (désactivé). Il retrouve désormais un ouvrage par **titre, numéro de manuscrit, auteur** (nom/prénom/nom de plume) **ou ISBN**, via un **menu déroulant** qui s'ouvre à la frappe ; un clic ouvre la fiche. Nouvel endpoint `GET /api/v1/quick-search` (accès à tout profil pouvant consulter les ouvrages, distinct du moteur avancé Direction `GET /api/v1/search`, Ch. 5 §5.4) ; sans droit de consultation, résultats masqués (liste vide), jamais d'erreur. **5 tests.**
2. **Journalisation renforcée** : ajout des actions **« logout »** (chaque déconnexion, symétrique du login) et **« access_denied »** (toute tentative d'accès refusée en 403, avec la permission manquante + méthode/URL) au journal inviolable (migration `add_audit_logout_access_denied`). La page Journal les affiche et filtre automatiquement. **2 tests.**
3. **Confidentialité de la présence** : le canal temps réel (Socket.IO) ne diffuse plus la **liste nominative** des connectés — seulement des **compteurs** (`total`, par pôle, par module ; décompte par personne, pas par onglet). Les voyants et le « N en ligne » restent identiques ; les info-bulles deviennent génériques (nombre seul).
4. **Fenêtre « Hall / Présence »** : l'indicateur « N en ligne » devient cliquable et déroule une fenêtre listant chaque **pôle actif/inactif + effectif** et le total — **sans identités** (rappel de confidentialité en pied).
5. **Notifications discrètes** de connexion/déconnexion : petit bandeau éphémère (bas d'écran), **générique** (« Une personne s'est connectée. », jamais de nom), déclenché par la variation du total en ligne, stabilisé sur 700 ms pour absorber les rebonds de transport.

Suite complète : **159 tests passent**. Chaque point vérifié au navigateur (recherche + ouverture de fiche ; payload de présence sans noms ; fenêtre Hall ; bandeaux uniques connexion/déconnexion).

**Reste à décider (reporté, question à l'opérateur)** : révéler les **noms** des connectés dans la fenêtre Hall aux seuls profils habilités (Direction générale, super-administrateur, et **responsable de son propre pôle**). Le « responsable de pôle » n'est pas encore identifié de façon univoque dans le modèle — décision de structuration à confirmer avant de l'implémenter (règle 2 du CLAUDE.md).

**Prochaine étape :** retours de l'opérateur (notamment sur la révélation des noms aux profils habilités).

### 10/07/2026 — Hall : révélation des identités aux profils habilités

Suite de la refonte des accès. La fenêtre « Hall / Présence » révèle désormais les **noms** des personnes connectées, mais **uniquement** aux profils d'oversight : **Direction générale** et **super-administrateur**. Tout autre profil garde la vue par effectifs seuls.

- **Backend** : `GET /api/v1/presence/names`, gardé par `direction:consultation` — ce garde vise exactement la DG (qui détient la permission) et le super-admin (qui détient toutes les permissions). Tout autre profil reçoit **403**, refus lui-même journalisé (`access_denied`). Le registre de présence en mémoire n'est exposé que par cette route ; le canal temps réel continue de ne diffuser que des compteurs. **3 tests** (autorisé / refusé 403 / 401). Suite complète : **162 tests passent**.
- **Frontend** : à l'ouverture du Hall, un profil habilité charge les noms à la demande et les affiche sous chaque pôle ; le pied de fenêtre précise la base de la révélation. Rien ne change pour les autres.
- Vérifié au navigateur : la DG voit « Production — 1 présent — admin » ; un correcteur voit « Production — 1 présent » sans nom.

**Reste ouvert** : la révélation par **« responsable de son propre pôle »**. Décision prise avec l'opérateur : implémenter d'abord les deux profils univoques (DG + super-admin) ; le « responsable de pôle » suppose de le **désigner formellement** (rôle dédié à assigner, rattaché à un pôle) — à acter avant implémentation.

**Prochaine étape :** retours de l'opérateur.

### 10/07/2026 (suite) — Hall : le chef de département voit son équipe présente

Décision de l'opérateur : le responsable d'un pôle = **Chef de département**. La révélation des noms dans le Hall s'étend à ce profil, **borné à son seul département**.

- **Rôle « marqueur » `CHEF_DEPARTEMENT`** (transverse, ajouté au seed) : assigné **en plus** du rôle métier de la personne ; son périmètre (le département) vient de sa **fiche employé**, pas du rôle.
- La présence retient le **département réel** de chaque personne (fiche employé), fixe pour la session : les noms révélés sont regroupés par **département réel**, sans dépendre de la navigation ni d'un rattachement de pôle deviné.
- `GET /api/v1/presence/names` : Direction générale / super-admin → **tous** les départements ; chef de département → **son seul** département ; chef sans département rattaché ou autre profil → **403** (journalisé).
- **Hall** : sous les effectifs par pôle (inchangés, visibles de tous), une section « Personnes présentes » regroupe les noms par département, pour les seuls profils habilités.
- **5 tests** de périmètre. Suite complète : **164 tests passent**. Vérifié au navigateur : le chef de la Correction voit « Correction éditoriale : chef_correction, membre_correction » et **pas** la personne d'un autre département ; un membre ordinaire ne voit aucun nom.

**À la mise en production** : le rôle `CHEF_DEPARTEMENT` est créé par le seed (à rejouer au déploiement). Pour qu'un chef voie son équipe, l'administration doit (1) lui **assigner ce rôle** et (2) s'assurer que sa **fiche employé est rattachée à un département**.

**Refonte des accès (points 1, 2, 9, 10, 11 + révélation habilitée) : livrée.** Reste ouvert : les points non retenus de la refonte initiale (hall pré-connexion, connexion par pôle) — en attente de votre décision.

**Prochaine étape :** retours de l'opérateur.

### 10/07/2026 (correctif) — Chef de département = niveau des grands pôles

Précision de l'opérateur : le « Chef de département » raisonne au niveau des **grands pôles** du menu (Éditorial, Production, Commercial, Juridique & Finance, Administration, Pilotage), pas des 17 départements fins. Correctif appliqué :

- Table de rattachement de chaque département fin → grand pôle (`DEPARTMENT_CODE_TO_POLE`, calée sur la composition du menu : Archives → Éditorial, Contrôle qualité → Production, Stock → Commercial, Finance → Juridique & Finance, RH → Administration, Direction générale → Pilotage…).
- La révélation des noms (`GET /api/v1/presence/names`) regroupe désormais par **grand pôle** ; un chef voit **tout son grand pôle** (borné à celui-ci).
- Effectif par pôle compté par **appartenance** (fiche employé), cohérent avec les noms ; le voyant par module reste l'activité de navigation.
- Les noms s'affichent directement sous chaque pôle dans le Hall.
- Vérifié au navigateur : le chef de la Correction (→ Éditorial) voit tout l'Éditorial, dont un collègue du Secrétariat, et **pas** la Production. **164 tests passent.**

**Note d'exploitation** : pour qu'un chef voie son pôle, l'administration lui attribue le rôle « Chef de département » et rattache sa fiche employé à un département (le rattachement département → grand pôle est automatique).

### 10/07/2026 (suite) — Habillage « soft » des pages opérationnelles

Retour opérateur : certaines pages (Rapports, Finance, RH…) faisaient « données brutes dans un cadre », pas une interface soignée. Refonte visuelle de toutes les pages concernées, dans un style moderne, sans changer le fonctionnement.

**Briques réutilisables** : `<Card>` (carte premium : coins arrondis, ombre douce, marges responsives, en-tête icône + titre + sous-titre + action), `<Modal>`/`<Field>` (fenêtre intégrée à l'app remplaçant les pop-up du navigateur), et des styles CSS (`.ecl-page`, `.ecl-card`, `.ecl-list`/`.ecl-row` rangées aérées, `.ecl-tech` repli « détail technique », `.ecl-modal`, `.ecl-field`).

**Pages refondues (10)** : Rapports et indicateurs, Finance & comptabilité, Mes lectures, Direction générale, Stock & magasin, Commercial & ventes, Ressources humaines, Domaines & collections, Droits & pôles, Utilisateurs & rôles.

**Améliorations transverses** :
- Listes aérées (rangées arrondies + survol) au lieu de lignes collées séparées par un filet.
- Jargon technique (codes, formules SQL des indicateurs) replié dans un « Détail technique » discret.
- Boutons premium (dorés/marine/contour/rouge) partout, pastilles de statut/domaine/priorité.
- **Toutes** les saisies par pop-up du navigateur (`window.prompt/alert/confirm`) remplacées par des fenêtres intégrées (voile flouté, fermeture Échap). Plus aucun dialogue natif dans les pages.
- Marges responsives : confortable sur téléphone (vérifié sur écran 390 px, sans débordement horizontal).

**Prochaine étape :** retours de l'opérateur.

### 10/07/2026 (suite) — Envoi des e-mails « au nom » du pôle / de l'agent connecté

Demande opérateur : les e-mails de l'ERP (factures, avoirs, relevés de droits) doivent partir des adresses **de chaque pôle** — l'adresse professionnelle de l'utilisateur connecté (boîtes du personnel hébergées chez **Hostinger**), un pôle pouvant avoir 2-3 adresses ; et la maison doit en **conserver une copie**.

**Ce qui a été fait (sans nouvelle dépendance)** :
- Chaque envoi porte désormais un **nom d'expéditeur** identifiant l'agent/pôle et un **« Répondre à »** = l'e-mail professionnel de l'utilisateur connecté ⇒ les réponses arrivent directement dans la boîte du bon pôle (celle de la personne réellement connectée, même si le pôle a plusieurs adresses).
- La maison reçoit une **copie invisible (BCC)** de chaque envoi (« joindre le mail officiel »).
- L'adresse affichée en « De » reste la boîte authentifiée du domaine de la maison, **pour la délivrabilité** (un serveur SMTP refuse d'expédier au nom d'une adresse qu'il n'authentifie pas — sinon le message part en indésirable).

**Réglages (à saisir sur Scalingo, jamais dans le code)** : `SMTP_HOST=smtp.hostinger.com`, `SMTP_PORT=465`, `SMTP_USER`/`SMTP_PASS` (boîte du domaine), `SMTP_FROM`, `SMTP_FROM_NAME`, `SMTP_ARCHIVE_TO`. Détail et justification : `docs/JOURNAL_TECHNIQUE.md`. Backend recompilé (typecheck OK), suite Finance : **21 tests passent**.

**Point à valider avec l'opérateur** : si l'on veut que le « De » porte réellement l'adresse de chaque pôle (et non le « Répondre à »), il faut soit une boîte SMTP par pôle, soit activer l'envoi « send-as » chez Hostinger — décision d'exploitation, non nécessaire au fonctionnement.

### 10/07/2026 (suite) — Mémoire des adresses e-mail, généralisée à tous les écrans

À la demande de l'opérateur, les adresses e-mail déjà utilisées sont **mémorisées** et **reproposées en suggestion** — plus besoin de retaper une adresse connue.

- **Où** : fenêtre d'envoi d'un document (facture/relevé), création de compte (Utilisateurs & rôles), changement d'e-mail de connexion (Sécurité du compte). Brique commune `<EmailInput>` : un champ e-mail qui propose les adresses connues et mémorise la saisie en quittant le champ.
- **Comment** : stockage **local au navigateur** (aucune donnée envoyée au serveur, aucune synchronisation entre postes), les plus récentes en tête, limite 100 adresses. Aucune nouvelle dépendance.
- Typecheck et build front OK.

### 10/07/2026 (suite) — Alertes par e-mail (fin de la Phase A)

Dernier point de la Phase A : les alertes de l'ERP sont désormais **doublées d'un e-mail**, en plus de la cloche déjà présente dans l'application.

- **Quelles alertes** : seulement les niveaux **importantes** et **critiques** (stock critique, encours dépassé, BAT/impression en retard, droits d'auteur…). Les notifications de routine restent, elles, dans la cloche uniquement — pour ne pas encombrer les boîtes mail.
- **À qui** : à l'adresse professionnelle de chaque destinataire **actif** du rôle concerné. L'e-mail reprend le papier à en-tête maison, avec un bandeau de couleur selon la gravité (rouge = critique, orange = important).
- **Robustesse** : envoi « au meilleur effort » — si l'e-mail échoue (ou n'est pas encore configuré), l'alerte reste visible dans l'application et **l'opération métier n'est jamais bloquée**. Tant que le SMTP n'est pas renseigné, aucun e-mail n'est tenté.
- **Tests** : `tests/notification-email.test.ts` (contenu de l'e-mail + non-régression des notifications). Suites liées (stock, BAT, impression, commercial, documents) : **31 tests passent**. Backend typecheck OK.

**Phase A terminée** : impression/PDF des documents (factures, relevés, bons de commande, contrats) sur papier à en-tête + logo ; TVA livres à 0 % réglable ; envoi des documents par e-mail avec aperçu ; identité d'expéditeur par pôle (Répondre-à) + copie maison ; mémoire des adresses e-mail ; alertes par e-mail.

### 10/07/2026 (suite) — Phase B, point 1 : signature électronique simple / interne

Décision opérateur : **signature simple/interne** (sans coût, sans prestataire) ; **SMS reporté**.

- **Principe** : l'accord d'une partie (la **partie contractante** — auteur/prestataire — ou la **maison**) est enregistré dans l'ERP, **horodaté**, lié à une **empreinte des clauses signées** (garantit que la signature porte bien sur cette version des termes), et **inscrit au journal inviolable**. La signature de la partie contractante **active** le contrat.
- **Garde-fous** : signature possible uniquement en « attente de signature » ; **confirmation d'accord explicite** obligatoire (case à cocher) ; une même partie ne signe qu'une fois. Réservé à la validation juridique.
- **Écran** : depuis la fiche d'un manuscrit → Contrats → bouton **« ✍️ Signer »** (quand le contrat attend une signature). Fenêtre montrant les signatures déjà apposées + formulaire d'accord. Le suivi de statut par « Faire avancer » reste pour les étapes amont ; l'activation passe désormais par la signature.
- **Base de données** : nouvelle table `contract_signatures` (migration **additive**, aucune donnée existante touchée).
- **Tests** : `tests/contract-signature.test.ts` (activation, empreinte, trace, refus hors état, consentement, unicité par partie). **170 tests passent** (backend), build front OK.

**Phase B, point 2 (SMS)** : reporté à la décision budgétaire/fournisseur de l'opérateur.

### 11/07/2026 — Compte d'auteur : devis → signature → facture de prestation (backend)

Nouvelle extension décidée avec l'opérateur : facturer à l'**auteur** le **travail éditorial** (relecture, correction, proposition de couverture, maquette… jusqu'au livre fini), **hors impression et communication**. Modèle « compte d'auteur », en complément du « compte d'éditeur » du cahier des charges. Parcours : **devis → l'auteur le valide/signe → facture générée depuis le devis**.

**Fait (fondations backend, testées)** :
- **Devis de prestation** (`editorial_quotes` + lignes) : création, totaux HT/TVA/TTC, mention d'exclusion (impression/communication) par défaut, numérotation sécurisée `DE-AAAA-NNNN`.
- **Trois modes de signature** (au choix selon le contexte / l'accessibilité de l'auteur) :
  - **③ en ligne** (principal) : envoi d'un **lien unique** (jeton aléatoire, à usage unique, expirant 30 j) ; page publique sans compte ; l'auteur consulte et **signe en ligne**.
  - **① interne** : un agent enregistre l'accord de l'auteur.
  - **② papier** : devis imprimé, signé, scanné, renvoyé (accord enregistré, scan rattaché).
  - Dans tous les cas : **empreinte des montants signés** + **trace au journal**.
- **Facture de prestation** générée depuis le devis **accepté** : reprend les lignes, **aucun droit d'auteur généré**, facturée à un **client-auteur** miroir (lié au Partenaire, dédoublonné), immuable, même série `FA-…`.
- **Garde-fous** : facture impossible avant acceptation ; consentement explicite obligatoire ; lien à usage unique.
- Migrations **additives** (aucune donnée touchée). **175 tests** (dont 5 nouveaux sur ce parcours).

**Reste à faire (prochain incrément)** : écran de gestion des devis (fiche manuscrit), **page publique de signature**, **impression PDF** du devis et de la facture de prestation, **envoi par e-mail** du lien de signature ; puis consigner la décision au registre.

### 11/07/2026 (suite) — Compte d'auteur : écrans, signature en ligne, PDF, e-mail (terminé)

Partie visible construite et **vérifiée au navigateur** :
- **Écran de gestion des devis** sur la fiche du manuscrit (section « Prestation éditoriale (compte d'auteur) ») : création (catalogue de prestations + lignes libres, total en direct), **envoi pour signature**, **signature interne/papier**, **génération de la facture**, **impression/PDF** du devis.
- **Page publique de signature** (`/signer-devis/:jeton`) : accessible **sans compte**, aux couleurs de la maison ; l'auteur voit son devis (lignes, total, mention d'exclusion) et **signe en un clic** → écran de confirmation « Devis signé — merci ». *(Vérifié de bout en bout : consultation via le lien, signature, confirmation.)*
- **Envoi automatique par e-mail** du lien de signature à l'auteur quand « Envoyer pour signature » est cliqué (réutilise le SMTP configuré ; au meilleur effort).
- **Impression PDF** du devis (papier à en-tête, mention d'exclusion, bloc d'acceptation si signé) et de la facture de prestation (via l'impression facture existante).
- **Décision consignée** au registre : **D-006** (extension « compte d'auteur »).

Typecheck + build front OK ; suite backend inchangée (175 tests). Reste éventuel : ajuster les formulations de la page de signature selon retours.

### 11/07/2026 (suite) — Trois présentations d'impression + papier à en-tête officiel

Sur retour opérateur, tous les documents officiels (facture, devis, relevé de droits, bon de commande, contrat) offrent désormais **trois présentations à l'impression**, via un menu « Imprimer / PDF ▾ » commun (`DocPrintMenu`) :
1. **Numérique** (par défaut) : logo + mentions légales complètes — pour l'écran/e-mail ou le papier ordinaire ;
2. **Avec papier à en-tête intégré** : l'image A4 officielle de la maison est reproduite en fond (en-tête + filigrane + pied) — à imprimer sur **papier ordinaire** ;
3. **Sur papier à en-tête vierge** : version **neutre** (sans logo ni mentions), zones haut/bas réservées — à imprimer sur le **papier physique** pré-imprimé.

- **Papier à en-tête officiel enregistré** : extrait du fichier fourni (`NOUVEAU_PAPIER_ENTETE_ECLOSION1.docx`) et sauvegardé (`frontend/public/eclosion-papier-entete.png`, A4 1385×1959).
- Impression des fonds forcée (`print-color-adjust: exact`). Vérifié au navigateur (devis en-tête intégré : contenu bien centré dans la zone libre).
- Hauteurs réservées (mode vierge / intégré) ajustables si le bandeau du papier diffère.
- **Coordonnées harmonisées sur le papier à en-tête officiel** (décision opérateur du 11/07/2026) : les documents numériques (impression, e-mails, page de signature) portent désormais les mêmes coordonnées que le papier à en-tête — téléphones `(+237) 677 157 326 / 678 704 086 / 698 031 502`, e-mail `editioneclosion@gmail.com`, site `eclosionedition.cm`, N° de contribuable `MÀ2019127511744Y`, RC `RC/YAO/2019/B/144`. Source unique dans trois fichiers (`frontend/src/lib/print.ts`, `backend/src/lib/documentEmail.ts`, `frontend/src/pages/QuoteSignPage.tsx`).
- **Hauteurs réservées ajustées** d'après la mesure des bandeaux du papier (~40 mm chacun) : mode « en-tête intégré » = padding 44 mm (haut) / 46 mm (bas) ; mode « papier vierge » = espaces 24 mm / 26 mm en plus de la marge @page de 18 mm.
- **À faire vérifier par l'opérateur** : le **N° de contribuable** (`MÀ2019127511744Y`) et le **RC** ont été lus sur l'image du papier à en-tête — à confirmer au caractère près (donnée légale sensible).
