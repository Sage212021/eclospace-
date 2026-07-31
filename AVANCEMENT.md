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
- **Données de référence = celles des documents numériques** (décision opérateur du 11/07/2026) : téléphones `(+237) 698 03 15 02 / 678 70 40 86`, e-mail `eclosionedition@gmail.com`, site `eclosioneditions.cm`, N° de contribuable `M021912751174Y`, RC `RC/YAO/2019/B/144`. C'est le **papier à en-tête** qui a été corrigé pour s'y conformer (nouvelle image fournie), pas l'inverse. Source unique du numérique dans trois fichiers (`frontend/src/lib/print.ts`, `backend/src/lib/documentEmail.ts`, `frontend/src/pages/QuoteSignPage.tsx`).
- **Papier à en-tête officiel corrigé** enregistré (`frontend/public/eclosion-papier-entete.png`, A4 1054×1492). Bandeaux mesurés ~56 mm (haut) et ~56 mm (bas) → hauteurs réservées : mode « en-tête intégré » padding 58/58 mm ; mode « papier vierge » espaces 40/40 mm en plus de la marge @page de 18 mm.
- **Petit écart restant à trancher** : le papier corrigé liste **3 téléphones** (dont `654 366 663`), le numérique n'en a que 2 — à aligner si l'opérateur le souhaite. *(Fait : 3e numéro ajouté au numérique.)*

### 11/07/2026 (suite) — Module Paiements enrichi (socle backend)

Sur analyse de la proposition « modes de paiement + comptes financiers » : **l'essentiel existait déjà** (comptes bancaires/caisses/mobile money, virements, trésorerie, encaissements liés à un compte, rapprochement, relances). Socle d'enrichissement livré (décisions opérateur du 11/07/2026 — tout confirmé) :

- **Modes de paiement 100 % configurables** : l'enum figé devient une **table `payment_methods`** (code, libellé, nature, actif, compte par défaut). L'administrateur ajoute/modifie librement (PayPal, Wave…). Les 5 modes historiques conservés (codes stables). Endpoints : `GET/POST /payment-methods`, `PATCH /payment-methods/:id` (admin).
- **Référence de transaction** sur chaque paiement (ID Mobile Money, n° chèque, réf. virement).
- **Association automatique** au **compte financier par défaut** du mode si non précisé.
- **Devise XAF** (F CFA Cameroun) par défaut partout + reprise des lignes en XOF.
- Migration **en place** (aucune donnée perdue : conversion du mode enum→code, colonnes ajoutées). **184 tests** (+3 : liste/ajout/unicité, mode inconnu refusé, compte par défaut + référence).
- **Incrément 2 (fait)** : écran **Finance → « Modes de paiement »** (admin : activer/désactiver, compte par défaut, ajouter un mode personnalisé) ; **encaissement enrichi** (choix du **mode** + **compte** + **référence**, et **paiement mixte** = plusieurs modes sur une même facture). Vérifié au navigateur.
- **Incrément 3 (fait — dimension point de vente)** : modèle **`points_of_sale`** (librairie, salon, boutique en ligne…), champ `point_of_sale_id` sur les ventes au comptoir, endpoints CRUD (`/points-of-sale`, commercial:administration). Migration additive.
- **Incrément 5 (fait — rapports)** : endpoint `GET /finance/payment-report?from&to` — agrégats **par mode de paiement**, **par compte financier**, **ventes par point de vente** ; **carte « Rapport d'encaissements »** sur l'écran Finance (filtre période + 3 tableaux). Vérifié au navigateur. **+3 tests** (`finance-reports.test.ts`).
- **Incrément 4 (fait — échéancier de crédit)** : table `installments` (échéances d'une facture), endpoints `POST/GET /invoices/:id/schedule` (plan limité au total TTC), statut par échéance (réglée / partielle / à venir / **en retard**) calculé sur le montant réglé cumulé. **Écran** : bouton « Échéancier » sur chaque facture → fenêtre de définition + statuts. **188 tests** (+2). Migration additive.
- **Module Paiements — 5 incréments livrés.** Reste optionnel : câblage UI du sélecteur point de vente sur la saisie de vente au comptoir (l'API est prête).

### 11/07/2026 (suite) — Rapports hebdomadaires par agent (Demande 3, backend)

Nouveau module : chaque agent rédige un compte-rendu périodique relié à ses **objectifs** (chiffrés et/ou libres) et à sa **recherche/veille** ; la hiérarchie suit et valide.

- **Objectifs** (`objectives`) : intitulé + cible chiffrée facultative (valeur + unité) + période + poids ; fixés par un **chef de département** (son pôle) ou la **DG**.
- **Rapport** (`weekly_reports`) : sections *réalisations, recherche, difficultés, plan suivant* + lignes d'**avancement d'objectifs** (`weekly_report_objectives`, % + commentaire ; objectif lié = chiffré, ou libellé libre). Cycle **brouillon → soumis → validé / retourné**. Un rapport par agent et par période.
- **Paramétrable** (table `settings`) : `weekly_report_validation_mode` (**dg** par défaut, ou **chef**) et `weekly_report_periodicity` (**weekly**, biweekly, monthly).
- **Confidentialité** (modèle « présence/names ») : agent = ses rapports ; chef = son pôle ; DG (`direction:consultation`) + super-admin = tout. Refus tracés (`access_denied`).
- **API** : objectifs (create/list), rapports (create période courante, list, get, patch, submit, validate/return). Migration **additive**. **181 tests** (+4 : cycle, confidentialité, habilitation validation, objectifs réservés).
- **Écrans (fait)** : page **« Mes rapports hebdo »** (menu, accessible à tous) — *Mon rapport de la période* (objectifs + avancement, réalisations, recherche/veille, difficultés, plan ; Enregistrer/Soumettre), *Mes objectifs*, et *Suivi des rapports* (chef/DG : consulter, valider/retourner). Vérifié au navigateur.
- Les deux réglages (mode de validation, périodicité) sont modifiables depuis l'écran **Paramètres** (clé/valeur, `settings:administration`).

### 11/07/2026 (suite) — Devis/facture Impression et Communication (Demande 2, choix C)

Le circuit devis → signature → facture est **généralisé aux trois métiers** de la maison : **Éditoriale** (facturée à l'auteur), **Impression** et **Communication** (facturées à un client). Décision opérateur : **choix C** — un devis peut viser un **auteur (Partenaire) OU un client (Customer)**, au choix.

- **Backend** : `EditorialQuote` gagne `serviceType` (enum `ServiceType`) et un destinataire au choix (`partnerId` **ou** `customerId`, au moins l'un des deux ; `partner_id` devient nullable). La facture est adressée au **client** si fixé, sinon au **client-auteur** miroir. Source de facture `${serviceType}_quote`. Migration **additive**.
- **Frontend** : le formulaire de devis (fiche manuscrit) propose le **type de prestation** (catalogue de lignes adapté à chaque métier) et le **destinataire** (auteur du manuscrit ou client). Titre du devis imprimé adapté (« Devis d'impression », « Devis de communication »…).
- **Tests** : +2 (`editorial-quotes.test.ts` : devis impression facturé à un client, refus sans destinataire). **177 tests passent.**
- **Reste** : Demande 3 (rapports hebdomadaires) — prochain incrément.

### 11/07/2026 (suite) — Filigrane d'authenticité sur les documents numériques

Retour opérateur : conserver la présentation numérique **élégante** d'origine (logo + coordonnées + pied légal), et y ajouter **uniquement l'ampoule** du papier à en-tête, en filigrane au centre, comme **signature d'authenticité**. Le relook « design en-tête par défaut » est annulé. Les **3 présentations** d'impression sont conservées (Numérique / En-tête intégré / Papier vierge). Filigrane extrait du papier à en-tête (`frontend/public/eclosion-filigrane.png`, blanc rendu transparent), affiché en très léger sur la seule version numérique. Vérifié au navigateur.

### 12/07/2026 — Module « Présences & Temps de travail » : incrément 1 (horaires + pointage)

Nouveau module d'évolution (validé par l'opérateur : ① socle logiciel d'abord, conçu extensible au pointage physique ; workflow de validation paramétrable avec par défaut le chef de grand pôle). Développé en **additif** : aucune table existante modifiée, aucune donnée touchée ; le module est indépendant et désactivable (le pointage est enregistré « au mieux » et ne bloque jamais l'authentification).

**Fait (incrément 1) :**
- **Schéma** (migration additive réversible `20260712010000_attendance_foundation`) : `work_schedules` (horaires paramétrables, portée maison/département/employé, heures en minutes, versionné par `effective_from`), `public_holidays` (jours fériés), `attendance_events` (pointage brut, champ `source` extensible à QR/RFID/biométrie/NFC/mobile — §11 — sans refonte des calculs).
- **Pointage** : la connexion et la déconnexion à l'ERP créent un `attendance_event` (`in`/`out`, `source = erp_session`), branché sur les 3 chemins de login + le logout, tolérant aux pannes.
- **Backend** (`presences` : nouveau module de permissions à 4 actions ; routes `/api/v1/attendance/...`) : horaire officiel résolu (employé > département > maison > défaut), CRUD horaires (administration), jours fériés, consultation du pointage **bornée à soi** sauf profil habilité (RH/DG/chef de département). Traçabilité au journal d'audit (ancienne → nouvelle valeur).
- **Seed** : horaire par défaut de la maison (08:30-18:00, pause 12h-13h exclue, Lun-Ven) ; `presences:consultation` pour chaque employé (vue de soi), administration/validation pour RH, DG, chefs de département. Idempotent.
- **Frontend** : carte « Horaires de travail » dans RH → affiche l'horaire appliqué, permet à l'administrateur RH de le modifier et d'ajouter des jours fériés (police à chasse fixe, palette conforme). Vérifié au navigateur (capture).
- **Tests** : +11 (`attendance.test.ts` : pointage entrée/sortie, résolution d'horaire maison/surcharge employé, refus d'horaire incohérent, jour férié + doublon 409, périmètre self du pointage, utilitaires HH:MM). **199 tests passent, zéro régression.**

**Limite assumée :** le pointage repose sur la connexion/déconnexion à l'ERP (§10) — indicatif, à valider par la hiérarchie avant la paie ; conçu pour brancher un pointage physique plus tard sans changer les calculs (§18).

**Prochaine étape :** incrément 2 — calculs de présence (temps travaillé pause exclue, retards, départs anticipés, absences, heures supplémentaires).

### 12/07/2026 (suite) — Présences : incrément 2 (moteur de calculs)

**Fait :**
- **Moteur de calcul pur** (`backend/src/lib/attendanceCompute.ts`, sans accès base, testable) : reconstitue la journée à partir des pointages bruts et calcule temps de présence, **temps travaillé (pause déjeuner exclue, §16)**, retard (§13), départ anticipé (§14), heures supplémentaires (§17), interruptions de milieu de journée, absence pleine journée. Justification portée en métadonnée (congé/mission validé couvrant le jour) sans fausser les chiffres bruts.
- **Endpoints** : `GET /api/v1/attendance/daily` (journée d'un employé) et `GET /api/v1/attendance/summary` (synthèse d'une période, mois courant par défaut) — périmètre self sauf profil habilité, décalage horaire métier paramétrable (`presence_timezone_offset_minutes`, défaut UTC+1). Comptes sans fiche employé : synthèse neutre (`no_employee`), pas de fausses absences.
- **Frontend** : carte « Mon temps de travail (ce mois) » dans RH (temps travaillé, jours travaillés, retards, départs anticipés, heures sup, absences injustifiées ; couleurs retard/or). Vérifié au navigateur.
- **Tests** : +14 (`attendance-compute.test.ts`), dont l'exemple exact du §16 (sortie 11:45 / retour 13:15 = 30 min, pause non comptée), retard/départ/heures sup, jour férié, week-end, absence justifiée, reconstitution d'intervalles tolérante (oubli de déconnexion, out orphelin). **213 tests passent, zéro régression.**

**Prochaine étape :** incrément 3 — règles de retenues paramétrables (montants, méthodes d'arrondi, plafonds, date d'effet).

### 12/07/2026 (suite) — Présences : incrément 3 (retenues paramétrables)

**Fait :**
- **Schéma** (migration additive réversible `20260712020000_deduction_rules`) : `deduction_rules` — barème **paramétrable et versionné** (montant par minute/demi-heure/heure, plafonds jour/mois, méthode, date d'effet). Anciennes versions conservées (§21).
- **Moteur pur** (`attendanceDeduction.ts`) : assiette « retenable » d'une journée (retard + départ anticipé + interruptions, ou temps attendu si absence pleine journée injustifiée ; **0 si justifié**), 4 méthodes de calcul (§22 : prorata exact, arrondi demi-heure sup., arrondi heure sup., personnalisée), application des plafonds jour puis mois.
- **Endpoints** : CRUD `/api/v1/attendance/deduction-rules` (POST = nouvelle version, PATCH = activer/désactiver, journalisés), et **aperçu** `/deduction-preview` (retenue proposée d'un employé sur une période selon la règle en vigueur, justifications et plafonds respectés).
- **Seed** : règle par défaut (500 FCFA/demi-heure, 1000 FCFA/heure, méthode prorata). Idempotent.
- **Frontend** : carte « Règles de retenues » dans RH (barème en vigueur + méthode + plafonds ; création d'une nouvelle version ; historique des versions). Vérifié au navigateur.
- **Tests** : +14 (`attendance-deduction.test.ts`) : méthodes de calcul (prorata/arrondis), assiette et exonération des jours justifiés, plafonds jour/mois, versionnage. **227 tests passent, zéro régression.**

**Rappel de cohérence :** le module **propose** la retenue ; le prélèvement réel reste effectué par la paie externe (D-003) après validation hiérarchique (workflow — incrément 4).

**Prochaine étape :** incrément 4 — file d'anomalies + justificatifs + workflow de validation paramétrable (chef → RH → RAF → DG).

### 12/07/2026 (suite) — Présences : incrément 4 (anomalies + workflow de validation)

**Fait :**
- **Schéma** (migration additive réversible `20260712030000_attendance_anomalies_workflow`) : `attendance_anomalies` (unique par employé/jour/nature, statuts §23, justification motif+commentaire+pièce jointe optionnelle) et `attendance_validation_levels` (niveaux paramétrables chef/RH/RAF/DG, ordre et caractère obligatoire/facultatif/désactivé).
- **Moteur pur** (`attendanceAnomaly.ts`) : détection (§19 : retard important, départ anticipé, absence — seuils paramétrables, jours justifiés exclus) et machine à états (transitions autorisées, statuts terminaux).
- **Endpoints** : scan idempotent d'un employé (validation), file d'anomalies avec **confidentialité** (employé = les siennes, chef = son pôle, RH/DG = toutes), justification (employé concerné/chef/RH), décision (valider/rejeter/corriger/annuler/analyser/demander correction, jurisdiction par pôle), niveaux de validation (GET + PUT paramétrable). Tout journalisé.
- **Seed** : 4 niveaux de validation (chef & RH & DG obligatoires, RAF facultatif) ; seuils d'anomalie (retard/départ ≥ 15 min). Idempotent.
- **Frontend** : carte « Anomalies de présence » dans RH — scan d'un employé, liste avec statuts colorés, justification (motifs §24), validation/rejet par les habilités. Vérifié au navigateur.
- **Tests** : +10 (`attendance-anomaly.test.ts`) : détection et seuils, machine à états, scan idempotent, confidentialité (employé/chef/RH), justification, refus de décision par l'employé, blocage des statuts terminaux, niveaux paramétrables. **237 tests passent, zéro régression.**

**Prochaine étape :** incrément 5 — tableau de bord RH + rapports (journalier, mensuel, DG) + exports.

### 12/07/2026 (suite) — Présences : incrément 5 (tableau de bord + rapports + exports)

**Fait :**
- **Moteur de rapport par lot** (dans `routes/attendance.ts`, `computeBatchReport`) : agrégation par employé sur une période, **lectures groupées + calcul en mémoire** (résolution d'horaire employé > département > maison > défaut sans requête par employé) pour tenir la charge (plusieurs centaines d'employés, §7). Réutilise le moteur de calcul (incrément 2) et le barème de retenue (incrément 3).
- **Endpoints** : `GET /report/monthly` (une ligne par employé : temps travaillé, retards, départs anticipés, heures sup, absences, retenue proposée + totaux) et `GET /dashboard` (indicateurs du jour : présents/absents/retards/départs, taux de présence et d'absentéisme, heures sup et retenues du mois). Réservés aux profils de supervision (RH/DG/chef).
- **Frontend** : carte « Tableau de bord & rapports RH » — bandeau d'indicateurs, sélecteur de période, tableau par employé, **Export Excel (CSV)** et **Imprimer / PDF** (navigateur). Vérifié au navigateur.
- **Tests** : +4 (`attendance-report.test.ts`) : refus de l'agrégat à un employé simple (403), rapport listant les cumuls et la retenue proposée, indicateurs du tableau de bord, refus du tableau de bord à un employé. **241 tests passent, zéro régression.**

**Prochaine étape :** incrément 6 — consolidation vers la paie (rapport RH mensuel validé, mode auto/manuel, rubriques Oui/Non, gel de période) alimentant les variables de paie existantes (export externe, D-003).

### 12/07/2026 (suite) — Présences : incrément 6 (consolidation paie) — MODULE COMPLET

**Fait :**
- **Schéma** (migration additive réversible `20260712040000_attendance_payroll`) : deux colonnes **nullable** sur `payroll_variables` (`deduction_amount`, `overtime_minutes` — aucune donnée existante impactée) ; `attendance_payroll_rubrics` (12 rubriques activables Oui/Non, §29), `attendance_payroll_periods` (statuts brouillon→valide→gele→transmis, mode auto/manuel) et `attendance_payroll_lines` (instantané figé par employé).
- **Endpoints** : rubriques (GET/PATCH), mode auto/manuel (GET/PUT), `prepare` (calcule et fige un instantané par employé, refusé si déjà gelé), récapitulatif (§30), `validate`, `freeze` (gel = données figées), `transmit` (alimente les **variables de paie** existantes pour les seules rubriques activées, D-003). Transactions élargies pour tenir plusieurs centaines d'employés. Tout journalisé.
- **Le module ne modifie jamais un bulletin** (§28) : il fournit des données ; la paie reste externe.
- **Seed** : 12 rubriques (les 4 calculées actives par défaut), mode « manuel ». Idempotent.
- **Frontend** : carte « Consolidation vers la paie » — mode, rubriques Oui/Non, workflow préparer→valider→geler→transmettre, récapitulatif par employé. Vérifié au navigateur.
- **Tests** : +6 (`attendance-payroll.test.ts`) : rubriques et mode, préparation + instantané, refus de gel avant validation (409), gel puis refus de re-préparation (409), transmission vers les variables de paie, exclusion d'une rubrique désactivée. **247 tests passent, zéro régression.**
- **Correctif** : à la transmission, une rubrique désactivée **remet la variable à null** (reflète exactement la configuration, au lieu de « laisser inchangé »).

**Module « Présences & Temps de travail » : les 6 incréments sont livrés** (horaires + pointage, calculs, retenues, anomalies + workflow, tableau de bord + rapports, consolidation paie). Développement 100 % additif, aucune donnée existante touchée, module désactivable.

**Prochaine étape (hors module) :** SMS des alertes (Phase B point 2) reste en attente d'une décision fournisseur/budget ; pointage physique (badge/QR/biométrie) branchable sur `attendance_events.source` sans refonte des calculs.

### 12/07/2026 (suite) — Module Paie natif : incrément 1 (paramètres versionnés + interrupteur) + i18n à suivre

Décision **D-007** actée (registre) : dérogation à D-003, **internalisation de la paie activable/désactivable**, en réimplémentant nativement le moteur Excel fourni (archivé dans `docs/paie/` avec sa spec `SPEC_MOTEUR_PAIE.md`).

**Fait (Paie incrément 1) :**
- **Schéma** (migration additive réversible `20260712050000_payroll_rate_sets`) : `payroll_rate_sets` — barème légal camerounais complet (CNPS PVID/PF/AT + plafond, IRPP progressif 4 tranches, CAC, CFC sal/pat, FNE, abattements, coefficient, heures, ancienneté, TC/RAV), **paramétrable et versionné par date d'effet**.
- **Interrupteur** `payroll_internal_enabled` (setting) : **désactivé par défaut** (export externe D-003) ; activable pour que l'ERP calcule les bulletins.
- **Module de permissions `paie`** (4 actions), accordé RESP_FINANCE (complet), DIR_GENERAL (validation/admin), RESP_RH (consultation/saisie).
- **Endpoints** : `GET/PUT /payroll/config` (interrupteur), `GET /payroll/rate-sets` (liste), `GET /payroll/rate-set?date=` (barème résolu), `POST /payroll/rate-sets` (nouvelle version). Tout journalisé.
- **Seed** : barème 2019 repris à l'identique du classeur (PVID 4,2 %, PF 7 %, AT 2,5 %, plafond 750 000, IRPP 10/15/25/35 %, CAC 10 %, CFC 1 %/1,5 %, FNE 1 %, abattement 30 %+500 000, TC/RAV). Idempotent.
- **Frontend** : carte « Paramètres de paie (barème légal) » dans RH — interrupteur oui/non, barème en vigueur, création d'une nouvelle version, historique. Vérifié au navigateur.
- **Tests** : +5 (`payroll.test.ts`) : refus profil non habilité (403), interrupteur par défaut désactivé + bascule, barème 2019 exposé, versionnage, validation des bornes. **252 tests passent, zéro régression.**

**Prochaine étape (en parallèle) :** i18n FR/EN — incrément 1 (infrastructure : couche de traduction, langue au profil, sélecteur FR/EN, première surface traduite) ; puis Paie incrément 2 (fiche paie employé) et incrément 3 (moteur de calcul brut→net).

### 12/07/2026 (suite) — i18n FR/EN : incrément 1 (infrastructure + shell traduit)

En parallèle du module Paie (D-007), chantier d'internationalisation.

**Fait :**
- **Backend** : colonne `users.language` (migration additive `20260712060000_user_language`, défaut "fr") ; `/api/v1/me` renvoie la langue ; `PATCH /api/v1/me/language` (fr|en) la mémorise sur le profil.
- **Frontend** : couche i18n légère et sans dépendance (`i18n.tsx`) — le **français reste le texte par défaut** fourni à `t(key, fr)`, seul l'**anglais** vit dans le dictionnaire ; une clé non traduite retombe proprement sur le français (traduction possible écran par écran, sans rien casser). Langue lue sur le profil à la connexion, changement mémorisé (localStorage + profil).
- **Sélecteur FR/EN** (`LanguageSwitch`) sur l'écran de connexion et dans le menu profil.
- **Surfaces traduites** (incrément 1) : page de **connexion** (identifiant, mot de passe, 2FA…), **barre latérale** (grands pôles + toutes les entrées de menu), **barre supérieure** (recherche, « en ligne », paramètres, déconnexion). Le contenu détaillé des pages reste en français (traduit dans les incréments suivants).
- **Tests** : +3 (`language.test.ts`) : /me renvoie la langue, changement fr→en persisté, refus d'une langue non supportée. **255 tests passent, zéro régression.** Vérifié au navigateur (bascule EN + persistance après rechargement).

**Prochaine étape (alternance) :** Paie incrément 2 (fiche paie employé), puis i18n incrément 2 (traduction du tableau de bord et des premiers écrans métier).

### 12/07/2026 (suite) — Module Paie : incrément 2 (fiche paie employé)

**Fait :**
- **Schéma** (migration additive `20260712070000_payroll_employee_profiles`) : `payroll_employee_profiles` (1-1 employé) — matricule, N° CNPS, NIU, catégorie/échelon, mode de paiement/compte, **brut contractuel**, **% salaire de base** (base et compléments dérivés), assiette fiscale, **parts fiscales** (+ appliquer O/N), **ancienneté** (années, taux individuel, seuil, appliquer O/N).
- **Endpoints** : `GET /api/v1/payroll/employees/:id/profile` (donnée sensible → accès journalisé) et `PUT` (upsert, `paie:saisie`, journalisé).
- **Frontend** : carte « Fiches paie (par employé) » dans RH — sélecteur d'employé, formulaire complet, **calcul en direct** du salaire de base et des compléments. Vérifié au navigateur.
- **Tests** : +5 (`payroll-profile.test.ts`) : refus profil non habilité (403), fiche vide (null), enregistrement + calcul base/compléments (500 000 × 0,6 = 300 000), refus % hors bornes (400), 404 employé inexistant. **260 tests passent, zéro régression.**

**Prochaine étape (alternance) :** i18n incrément 2 (traduction du tableau de bord et premiers écrans), puis Paie incrément 3 (moteur de calcul brut→net : cotisations CNPS, IRPP+CAC, CFC/FNE/TC/RAV, net à payer, coût employeur).

### 12/07/2026 (suite) — i18n FR/EN : incrément 2 (tableau de bord)

**Fait :** traduction complète du **tableau de bord** (accueil) via la couche i18n : titre de bienvenue, sous-titre, libellés des indicateurs (Ouvrages/Utilisateurs/Ventes/Stock), bloc « Ma session » (identifiant, rôle, statut) et **libellés de rôles** (Administrateur général…). Le français reste le défaut ; l'anglais s'affiche pour un utilisateur ayant choisi EN. Vérifié au navigateur (tableau de bord + menu profil entièrement en anglais). Frontend uniquement, aucune régression (260 tests backend inchangés).

**Prochaine étape (alternance) :** Paie incrément 3 (moteur de calcul brut→net), puis i18n incrément 3 (écrans RH / Finance).

### 12/07/2026 (suite) — Module Paie : incrément 3 (moteur de calcul brut→net)

**Fait :**
- **Moteur pur** (`payrollEngine.ts`) : réimplémentation **fidèle** des formules du « Livre de paie » du classeur (formules extraites du fichier source) — salaire brut, assiette fiscale, assiette CNPS plafonnée, PVID sal/pat, PF, AT, CFC sal/pat, FNE, taxe communale, RAV, base IRPP annuelle par part (abattements + parts fiscales), **IRPP + CAC** (barème progressif mensualisé), total retenues salariales, total charges patronales, **NET À PAYER**, **coût employeur**.
- **Endpoint** : `GET /api/v1/payroll/employees/:id/payslip?period=AAAA-MM` — résout la fiche paie + le barème en vigueur + la **retenue d'absence issue du module Présences** (consolidation de la période), calcule le bulletin (accès journalisé).
- **Frontend** : dans la carte « Fiches paie », **aperçu du bulletin calculé** (période + « Calculer le bulletin ») avec la ventilation complète. Vérifié au navigateur (intégration Présences→Paie : retenue de 115 000 déduite du brut).
- **Correctif** : le schéma de la fiche paie accepte désormais `null` pour les champs optionnels (fiscal_base, seniority_rate, seniority_threshold) envoyés par le formulaire.
- **Tests** : +16 (`payroll-engine.test.ts`) dont un **cas de référence vérifié au centime** contre un calcul à la main (brut 500 000, 1 part → PVID 16 800, IRPP+CAC 48 125, **net 426 075**, **coût employeur 567 300**), + variantes (ancienneté, retenue d'absence, parts fiscales) et l'intégration de l'endpoint. **276 tests passent, zéro régression.**

**Prochaine étape (alternance) :** i18n incrément 3 (écrans RH/Finance), puis Paie incrément 4 (bulletin PDF à l'en-tête + envoi e-mail) et incrément 5 (livre de paie + clôture/gel + déclarations CNPS/fiscales).

### 12/07/2026 (suite) — i18n FR/EN : incrément 3 (en-têtes des écrans principaux)

**Fait :** passe de traduction des **titres et sous-titres** des pages principales (RH, Finance, Stock, Commercial, Rapports, Utilisateurs & rôles, Direction générale, Mes lectures) via la couche i18n. Le français reste le défaut ; l'anglais s'affiche pour un utilisateur en EN (vérifié au navigateur : en-tête « Finance & accounting / Invoices, payments… »). Frontend uniquement, build OK, aucune régression backend (276 tests inchangés).

**Prochaine étape (alternance) :** Paie incrément 4 (bulletin PDF à l'en-tête maison + envoi e-mail via le mailer de l'ERP), puis i18n incrément 4 (contenu détaillé des écrans).

### 12/07/2026 (suite) — Module Paie : incrément 4 (bulletin PDF + envoi e-mail)

**Fait :**
- **Bulletin de paie imprimable** (`printPayslip` dans `print.ts`) à l'**en-tête maison** commun (logo, coordonnées, RCCM/NIU/N° affiliation CNPS, filigrane d'authenticité) : éléments de rémunération, cotisations sociales/fiscales, retenue d'absence (du module Présences), NET À PAYER, coût employeur, mentions légales (art. 68 & 89 du Code du travail camerounais). Impression → PDF via le navigateur (choix économe, aucune dépendance PDF).
- **Envoi par e-mail** : `buildPayslipEmail` (corps à l'en-tête maison) + endpoint `POST /api/v1/payroll/employees/:id/payslip/email` (aperçu + envoi via le mailer de l'ERP, Reply-To de l'expéditeur). Destinataire par défaut : e-mail de la fiche paie, sinon compte lié. Champ **e-mail** ajouté à la fiche paie (migration additive). Calcul du bulletin factorisé (`resolvePayslip`).
- **Frontend** : boutons « Imprimer le bulletin / PDF » et « Envoyer par e-mail » (fenêtre d'aperçu + envoi réutilisant `EmailModal`) dans l'aperçu du bulletin. Vérifié au navigateur (bulletin imprimé conforme, fenêtre d'envoi opérationnelle).
- **Tests** : +4 (`payroll-payslip-email.test.ts`) : aperçu sans fiche → 409, aperçu avec destinataire par défaut (e-mail de la fiche), envoi → 503 si SMTP non configuré (le flux atteint bien l'expédition), refus sans destinataire → 400. **280 tests passent, zéro régression.**

**Prochaine étape (alternance) :** i18n incrément 4 (contenu détaillé d'un écran métier), puis Paie incrément 5 (livre de paie + clôture/gel + déclarations CNPS/fiscales).

### 13/07/2026 — i18n FR/EN : incrément 4 (écran « Mes lectures » complet)

**Fait :** traduction **intégrale** de l'écran « Mes lectures » (comité de lecture) : en-tête, message vide, échéance, boutons (Fermer/Évaluer, Remettre mon rapport), statuts des missions, et **tout le formulaire de notation** (recommandations, appréciation, score global). Premier écran métier entièrement bilingue (au-delà des seuls en-têtes). Format de date localisé (fr-FR / en-GB). Vérifié au navigateur (titre + contenu en anglais). Frontend uniquement, build OK, aucune régression backend (280 tests inchangés).

**Prochaine étape (alternance) :** Paie incrément 5 (livre de paie mensuel + clôture/gel + déclarations CNPS/fiscales — dernier incrément Paie), puis i18n incrément 5 (autres écrans métier).

### 13/07/2026 (suite) — Module Paie : incrément 5 (livre de paie + clôture + déclarations) — MODULE COMPLET

**Fait :**
- **Schéma** (migration additive `20260713000000_payroll_closure`) : `payroll_closures` (clôture par période, unique) et `payroll_journal_lines` (instantané figé par salarié, détail des cotisations pour les déclarations). Le journal est **immuable**, re-clôture refusée (anti-doublon).
- **Livre de paie** : `GET /api/v1/payroll/register?period=` — calcul **par lot** (barème + retenues Présences chargés une seule fois) de tous les salariés dotés d'une fiche paie ; totaux (brut, net, charges patronales) + indicateur « clôturé ».
- **Clôture / gel** : `POST /register/:period/close` — archive le livre dans le journal (transaction), équivalent du « CloturerMois » du classeur ; `GET /journal/:period` restitue le journal figé. Tout journalisé.
- **Déclarations** : la ligne conserve le détail (assiette CNPS, PVID sal/pat, PF, AT / IRPP+CAC, CFC sal/pat, FNE, TC, RAV) ; exports **CNPS** et **fiscal** en CSV côté frontend.
- **Frontend** : carte « Livre de paie & clôture » — période, génération du livre (tableau tous salariés + totaux), **Clôturer la période** (droit `paie:validation`), **Export CNPS (CSV)** et **Export fiscal (CSV)**. Vérifié au navigateur (14 salariés, net total et coût employeur agrégés).
- **Tests** : +5 (`payroll-closure.test.ts`) : livre listant les salariés + totaux, clôture + journal immuable archivé, indicateur clôturé, refus de seconde clôture (409), journal d'une période non clôturée → 404. **285 tests passent, zéro régression.**

**Module « Paie » natif (D-007) : les 5 incréments sont livrés** — barème versionné + interrupteur, fiche paie employé, moteur de calcul brut→net, bulletin PDF + e-mail, livre de paie + clôture + déclarations. 100 % additif, activable/désactivable, aligné sur le classeur Excel source (`docs/paie/`).

**Reste (chantier i18n) :** traduction progressive des écrans métier restants (incréments i18n 5+).

### 13/07/2026 (suite) — i18n FR/EN : incrément 5 (écran « Stock » complet)

**Fait :** traduction **intégrale** de l'écran Stock & magasin : cartes (alertes, lieux, stock par référence, nouveau mouvement), messages vides, puces (rupture/alerte, déclassé), libellés de champs, boutons, et **les deux menus déroulants d'énumérations** (10 types de mouvement, 4 types de lieu). Vérifié au navigateur (contenu + options en anglais). Frontend uniquement, build OK, aucune régression backend (285 tests inchangés).

**Reste :** traduction des écrans Finance, Commercial, RH (dont les cartes des modules Présences/Paie), Rapports, Utilisateurs, Direction — au fil des incréments i18n suivants.

### 13/07/2026 (suite) — i18n FR/EN : incrément 6 (écran « Commercial » complet)

**Fait :** traduction **intégrale** de l'écran Commercial / ventes : cartes (Clients, Commandes, Nouvelle commande, Vente au comptoir), boutons, messages vides, libellés de champs, et **toutes les énumérations** (6 catégories de client, 4 zones de livraison, 3 modes d'encaissement, 4 types de point de vente). 44 appels `t()` ajoutés, français par défaut conservé. Build OK, aucune régression backend (285 tests inchangés).

**Reste :** écrans Finance, RH (cartes Présences/Paie), Rapports, Utilisateurs, Direction.

### 13/07/2026 (suite) — i18n FR/EN : incrément 7 (écran « Finance & comptabilité » complet)

**Fait :** traduction **intégrale** de l'écran Finance & comptabilité — le plus riche de l'ERP (1143 lignes, ~9 cartes, 8 fenêtres intégrées, 6 sous-composants). Sont désormais bilingues : les cartes (Factures, Encours & relance client, Dépenses, Relevés de droits d'auteur, Frais de port par zone, Taux de TVA, Modes de paiement, Rapport d'encaissements, Trésorerie), toutes les fenêtres (encaissement mixte, échéancier de crédit, génération/paiement de relevé, répartition des bénéficiaires, frais de port, compte/caisse, virement interne, gestion des modes de paiement), et **toutes les énumérations** (statuts de factures/dépenses/relevés, catégories de dépense dont « Abonnements / Services en ligne », zones de livraison réutilisant `com.zone.*`, types de produit TVA, genres de mode de paiement, statuts d'échéancier, types de compte). Les messages de confirmation et les corps d'e-mail (facture, relevé) basculent aussi selon la langue. ~150 appels `t()`, français conservé par défaut. Typecheck + build OK, aucune régression backend (285 tests inchangés).

**Reste :** écrans RH (cartes Présences/Paie), Rapports, Utilisateurs, Direction.

### 13/07/2026 (suite) — i18n FR/EN : incrément 8 (écran « Direction générale » complet)

**Fait :** traduction **intégrale** de l'écran Direction générale (pilotage) : les 4 cartes (tableau de bord consolidé, recherche globale, alertes automatiques, centre de pilotage intelligent), les **4 blocs de domaine** (Éditorial, Production, Commercial, Financier) avec leurs **14 tuiles d'indicateurs**, la fenêtre de décision d'une recommandation (traiter/reporter/ignorer), les messages, et les **libellés de priorité** (faible/moyenne/élevée/critique). Français conservé par défaut. Typecheck + build OK, aucune régression backend (285 tests inchangés).

**Reste :** écrans RH (cartes Présences/Paie), Rapports, Utilisateurs.

### 13/07/2026 (suite) — i18n FR/EN : incrément 9 (écran « Rapports & indicateurs » complet)

**Fait :** traduction **intégrale** de l'écran Rapports & indicateurs : les 4 cartes (dictionnaire d'indicateurs, bibliothèque de rapports standards, explorateur d'analyses personnelles, simulation de tirage), les 3 fenêtres intégrées (nouvelle analyse, promotion en rapport standard, simulation de tirage avec son tableau de résultats — en-têtes de colonnes traduites), les libellés de domaine (Éditorial/Production/Commercial/Financier/RH) et les messages. Français conservé par défaut. Typecheck + build OK, aucune régression backend (285 tests inchangés).

**Reste :** écrans RH (cartes Présences/Paie), Utilisateurs.

### 13/07/2026 (suite) — i18n FR/EN : incrément 10 (écran « Utilisateurs & rôles » complet)

**Fait :** traduction **intégrale** de l'écran Utilisateurs & rôles : bouton de création, formulaire de nouveau compte (identifiant, e-mail, mot de passe, rôle initial), actions par compte (réinitialiser le mot de passe, suspendre/réactiver, se connecter en tant que, supprimer), attribution/retrait de rôle, puce de statut (Actif/Suspendu), et les **6 fenêtres de confirmation** (suspension, imitation, suppression, réinitialisation, attribution, retrait) avec leurs corps de texte et messages. Français conservé par défaut. Typecheck + build OK, aucune régression backend (285 tests inchangés).

**Reste :** écran RH (cartes Présences/Paie) — dernier écran, réparti sur de nombreux sous-composants.

### 13/07/2026 (suite) — i18n FR/EN : incrément 11 (écran « RH » — partie Présences)

**Fait :** traduction **intégrale** de la page RH (dossiers collaborateurs, absences, anomalies d'accès, revue des habilitations, avec leurs 8 fenêtres et énumérations de statuts/types) **et** des 5 cartes du module Présences : horaires de travail (jours abrégés + source de l'horaire), synthèse « mon temps de travail », règles de retenues (barème versionné), file d'anomalies de présence (types + statuts + justification), tableau de bord & rapports RH (indicateurs, tableau, en-têtes CSV/PDF bilingues). Français conservé par défaut. Typecheck + build OK, aucune régression backend (285 tests inchangés).

**Reste :** partie **Paie** de l'écran RH (4 sous-composants : paramètres du barème, fiches paie, livre de paie/clôture, consolidation).

### 13/07/2026 (suite) — i18n FR/EN : incrément 12 (écran RH — partie Paie) — **chantier i18n terminé**

**Fait :** traduction **intégrale** des 4 sous-composants du module Paie (D-007) : paramètres du barème légal (interrupteur d'internalisation, barème CNPS/IRPP/CFC/FNE/CAC versionné, ~20 champs), fiches paie par employé (données du bulletin, aperçu brut→net des 12 lignes du bulletin, impression, e-mail bilingue), livre de paie & clôture (tableau, exports CNPS/fiscal CSV bilingues, clôture), consolidation vers la paie (mode, rubriques, workflow préparer→valider→geler→transmettre, statuts). Français conservé par défaut. Typecheck + build OK, aucune régression backend (285 tests inchangés).

**➡️ Le chantier i18n FR/EN est terminé : l'intégralité de l'ERP est désormais bilingue.** 12 incréments : connexion, tableau de bord, navigation/en-têtes, mes lectures, stock, commercial, finance, direction, rapports, utilisateurs, RH (présences + paie). Le français reste toujours le défaut ; l'anglais s'active par l'utilisateur (profil + sélecteur de langue). Aucune modification backend, tous les tests inchangés.

### 14/07/2026 — Centre de Communication Interne / Babillard d'annonces : incrément 1 (socle backend)

**Fait :** module d'évolution **additif** « communication » (Babillard d'annonces), sans toucher aux données ni aux fonctions existantes.
- **Schéma** (migration `20260714000000_communication_announcements`) : `announcement`, `announcement_category` (référentiel extensible), `announcement_target` (ciblage polymorphe tous/département/rôle/utilisateur), `announcement_receipt` (suivi de lecture + accusé), `announcement_attachment` (réutilise `Document`), `notification_preference` (son/volume/visuel/e-mail/catégories par utilisateur). Ajout de la valeur `annonce` à `NotificationType`. Priorités dédiées Normale/Importante/Urgente/Critique.
- **Sécurité** : contenu enrichi **assaini côté serveur** (liste blanche via `sanitize-html`) avant stockage — protection XSS ; liens/images limités à http(s), `rel=noopener` forcé.
- **API** (`routes/announcements.ts`) : catégories, fil personnel (annonces me ciblant), vue de gestion, détail, création/édition (brouillon), publication, archivage, suppression logique, marquer lu / accuser réception, tableau de suivi de lecture (auteur/admin), préférences de notification (`/me/notification-preferences`).
- **Notifications** : à la publication, une notification `annonce` par destinataire (alimente **immédiatement** la cloche existante) ; e-mail pour Urgente/Critique ou lecture obligatoire, en respectant l'opt-out de chaque utilisateur (`lib/notify.ts` → nouveau `notifyUsers()`).
- **Permissions** : module `communication` (4 actions). Consultation pour tout le personnel ; saisie + administration pour DG, RH, Administration/Finances, Direction éditoriale.
- **Audit** : création, modification, publication (status_change), archivage, suppression, consultation (view_sensitive), accusé de réception (validate).
- **Tests** : `tests/communication-announcements.test.ts` (ciblage, permissions, suivi de lecture, assainissement XSS, auteur-seul, audit, préférences). **292 tests passent** (+7). Typecheck OK.

**Reste (module Communication) :** inc 2 (écran Babillard : liste, filtres, détail, formulaire + pièces jointes + i18n) → inc 3 (cloche cliquable) → inc 4 (temps réel + sonnerie + pop-up + écran préférences) → inc 5 (suivi de lecture / relances) → inc 6 (bannière Urgent/Critique + archivage auto).

### 14/07/2026 (suite) — Babillard d'annonces : incrément 2 (écran frontend)

**Fait :** l'écran **Communication interne → Babillard d'annonces**, entièrement bilingue FR/EN.
- **Nouveau pôle de menu** « Communication interne » (icône mégaphone) avec la feuille « Babillard d'annonces », filtrée par la permission `communication:consultation`.
- **Fil personnel** : liste des annonces me ciblant, avec puce non-lue, épingle, chip de priorité (couleurs charte : normale/importante/urgente `#C4661F`/critique), catégorie, aperçu, date ; filtres non-lues / catégorie / priorité ; clic → **fenêtre de détail** (contenu enrichi rendu, bouton d'accusé de réception si lecture obligatoire).
- **Gestion** (publieurs) : liste avec statut, compteur lues/destinataires ; actions Voir / Modifier / Publier / Suivi / Archiver / Supprimer.
- **Formulaire** de création/édition : titre, **éditeur de contenu enrichi léger** (`RichTextEditor` : gras/italique/souligné/listes/lien, sans dépendance lourde ; HTML réassaini côté serveur), catégorie, priorité, date d'expiration, lecture obligatoire, épingle, et **constructeur de ciblage** (tous / département / rôle / employé, options fournies par un endpoint dédié réservé aux publieurs).
- **Suivi de lecture** : fenêtre listant qui a lu / pas lu (+ accusés), avec compteurs.
- **Backend** : petit endpoint additif `GET /announcement-targets/options` (réservé `communication:saisie`) pour alimenter le sélecteur de cibles sans exiger `users:consultation`.
- **CSS** : rendu du contenu enrichi (listes, liens, tableaux, citations) restauré malgré la réinitialisation globale.

**Vérifications :** typecheck + build frontend OK ; round-trip complet vérifié via le **serveur HTTP réel** (login → création avec `<script>` → publication 592 destinataires → fil → détail : script retiré, `<b>` conservé → suivi de lecture) ; **293 tests backend** (+1 : gating des options de ciblage). Aucune donnée existante modifiée.

**Reste (module Communication) :** inc 3 (cloche cliquable : menu déroulant + ouverture d'annonce) → inc 4 (temps réel + sonnerie + pop-up + écran préférences) → inc 5 (relances de lecture) → inc 6 (bannière Urgent/Critique + archivage auto).

### 14/07/2026 (suite) — Babillard d'annonces : incrément 3 (cloche cliquable)

**Fait :** la cloche 🔔 de la barre supérieure devient **interactive**.
- Clic sur la cloche → **menu déroulant** listant les 30 dernières notifications : puce de couleur selon la priorité, titre, aperçu (2 lignes), date/heure ; les non-lues sont surlignées.
- **Clic sur une notification** → marquée lue (badge décrémenté) ; si elle pointe vers une annonce (`entityType = announcement`), bascule automatiquement sur le **Babillard** et **ouvre l'annonce** directement (fenêtre de détail).
- **« Tout marquer comme lu »** → nouvel endpoint additif `POST /notifications/read-all` (bornée à ses propres notifications).
- Le badge de non-lus fonctionnait déjà et **inclut les annonces** (chaque publication crée une notification par destinataire — cf. inc 1).

**Vérifications :** typecheck front + back OK ; build OK ; round-trip vérifié sur le **serveur HTTP réel** (publication d'une annonce → la notification `annonce` porte `entityType/entityId` → « tout marquer comme lu » : 2211 → 0 non-lues). Aucune régression backend.

**Reste (module Communication) :** inc 4 (temps réel Socket.IO + sonnerie + pop-up + écran de préférences de notification) → inc 5 (relances de lecture) → inc 6 (bannière Urgent/Critique + archivage auto).

### 14/07/2026 (suite) — Babillard d'annonces : incrément 4 (temps réel + sonnerie + pop-up + préférences)

**Fait :** la diffusion devient **instantanée et paramétrable**.
- **Temps réel (Socket.IO)** : à la publication, un événement `announcement:new` est poussé aux destinataires **connectés** via une salle par utilisateur (`user:<id>`). Plomberie : `lib/realtime.ts` (émetteur partagé), `presence.ts` (join de la salle + enregistrement du serveur), `publishAnnouncement()` (émission après création des notifications). Les hors-ligne s'appuient sur la notification persistée (cloche).
- **Cloche** : le badge se met à jour sans rafraîchir la page (signal `refreshSignal`).
- **Sonnerie** : `lib/notificationSound.ts` — deux notes brèves générées en Web Audio (aucun fichier binaire), volume réglable ; ne peut retentir qu'après une première interaction (règle navigateur, signalée à l'utilisateur).
- **Pop-up** : `AnnouncementToasts` — aperçu en bas à droite (titre, extrait, priorité), clic → ouvre l'annonce ; s'efface seul.
- **Écran de préférences** (carte sur le Babillard) : sonnerie on/off, volume, pop-up visuel on/off, e-mail on/off, et **catégories à notifier** (toutes, ou une sélection fine). Respectées à la fois par le temps réel (front) et par l'e-mail (back, opt-out déjà en place).

**Vérifications :** typecheck front + back OK ; build OK ; **temps réel vérifié de bout en bout** avec un vrai client Socket.IO authentifié (publication → réception de `announcement:new` avec id/priorité/aperçu corrects). Suite backend relancée.

**Reste (module Communication) :** inc 5 (relances de lecture ciblées) → inc 6 (bannière Urgent/Critique sur le tableau de bord + archivage automatique à l'expiration).

### 14/07/2026 (suite) — Babillard d'annonces : incrément 5 (relances de lecture)

**Fait :** l'auteur (ou l'administration) peut **relancer les personnes concernées** d'une annonce publiée.
- **Backend** : `remindUnread()` + `POST /announcements/:id/remind` (réservé `communication:saisie`, auteur ou admin, annonce publiée). Cible ceux qui **n'ont pas accusé réception** si la lecture est obligatoire, sinon ceux qui **n'ont pas encore lu**. Réutilise la cloche, le temps réel et l'e-mail (notification « Rappel : … »), journalisé. Ne recrée aucun reçu.
- **Frontend** : bouton **« Relancer les non-lecteurs (N) »** dans la fenêtre de suivi de lecture, affiché seulement s'il reste des destinataires concernés ; message de confirmation avec le nombre relancé.
- **Performance** : ajout d'un **index `notifications(user_id, read_at)`** (migration additive) — la cloche interroge « mes notifications / non-lues » à chaque page et le Babillard crée une notification par destinataire ; cet index maintient ces lectures rapides à mesure que la table grandit.

**Vérifications :** typecheck front + back OK ; build OK ; tests du module (10, dont 2 nouveaux : relance ciblée = seuls les non-accusés, refus de relance sur brouillon). Suite backend relancée.

**Reste (module Communication) :** inc 6 (bannière Urgent/Critique sur le tableau de bord + archivage automatique à l'expiration) — dernier incrément.

### 14/07/2026 (suite) — Babillard d'annonces : incrément 6 (bannière + archivage auto) — **module terminé**

**Fait :** dernier incrément du Centre de Communication Interne.
- **Bannière défilante** en tête du tableau de bord (`AnnouncementBanner`) : les annonces **Urgentes/Critiques** qui ciblent l'utilisateur défilent en continu (CSS, en pause au survol), visibles dès la connexion ; clic → ouvre l'annonce ; le bandeau disparaît s'il n'y a rien d'urgent. Endpoint `GET /announcements/banner` (consultation). Fond bleu marine, étiquette de priorité aux couleurs de la charte, liseré rouge si une annonce critique est active.
- **Archivage automatique à l'expiration** : `sweepExpiredAnnouncements()` — balayage paresseux (pas de tâche planifiée, cf. JOURNAL_TECHNIQUE) déclenché aux consultations (fil, gestion, bannière) ; les annonces publiées dont la date d'expiration est passée passent en « archivée », journalisées comme action système (userId null).

**Vérifications :** typecheck front + back OK ; build OK ; tests du module : **12** (dont archivage auto d'une annonce expirée + bandeau ne contenant que les urgentes/critiques). Suite backend relancée.

**➡️ Le module Centre de Communication Interne / Babillard d'annonces est complet** (6 incréments) : socle backend, écran, cloche cliquable, temps réel + sonnerie + pop-up + préférences, relances de lecture, bannière + archivage automatique. Extensions futures possibles (calendrier partagé, sondages, anniversaires automatiques, newsletter) sous le même pôle « Communication interne ».

### 14/07/2026 (suite) — Calendrier partagé & événements : incrément 1 (socle backend)

**Fait :** 2ᵉ composant du Centre de Communication Interne, sous le même pôle et le même module de permissions (`communication`). 100 % additif.
- **Schéma** (migration `20260714200000_calendar_events`) : `calendar_events` (titre, description, type — réunion/échéance/formation/sortie/cérémonie/autre, début, fin, journée entière, lieu, auteur, suppression logique) et `calendar_event_targets` (ciblage polymorphe, réutilise l'enum `AnnouncementTargetType`).
- **API** (`routes/calendar.ts`) : liste par plage de dates **filtrée sur la visibilité** (un utilisateur ne voit que les événements qui le ciblent : tous / son département / ses rôles / lui-même ; l'administration voit tout), détail, création/modification/suppression logique (réservées `communication:saisie`, auteur ou admin). Réutilise le sélecteur de cibles et la résolution d'audience des annonces.
- **Audit** : création, modification, suppression.
- **Tests** : `tests/communication-calendar.test.ts` (visibilité par département, permissions, filtre de plage, gestion auteur-seul, plage de dates incohérente, audit).

**Reste (calendrier) :** inc 2 (écran calendrier : vue mensuelle + formulaire) → inc 3 (anniversaires automatiques : ajout d'une date de naissance à la fiche employé + génération) → inc 4 (rappels/notifications d'événement).

### 14/07/2026 (suite) — Calendrier partagé : incrément 2 (écran)

**Fait :** l'écran **Communication interne → Calendrier partagé**, bilingue FR/EN.
- **Nouvelle feuille de menu** « Calendrier partagé » (à côté du Babillard).
- **Vue mensuelle** : grille lundi→dimanche (6 semaines), jour courant surligné, navigation ‹ / Aujourd'hui / ›. Chaque jour affiche ses événements (liseré coloré par type, heure de début), « +N » au-delà de 3.
- **Détail** au clic sur un événement : type, date/heure (ou journée entière), lieu, description, auteur ; boutons Modifier/Supprimer si l'utilisateur peut gérer l'événement.
- **Formulaire** (publieurs) : titre, type (réunion/échéance/formation/sortie/cérémonie/autre), date, début/fin (ou journée entière), lieu, description, et **constructeur de ciblage** (tous/département/rôle/employé) — réutilise le sélecteur de cibles des annonces. Clic sur une case vide → création pré-datée.
- Chaque utilisateur ne voit que les événements qui le concernent (visibilité serveur, inc 1).

**Vérifications :** typecheck front + back OK ; build OK ; round-trip vérifié sur le **serveur HTTP réel** (création d'un événement → présent dans le mois, absent du mois suivant, `can_manage` correct).

**Reste (calendrier) :** inc 3 (anniversaires automatiques : date de naissance sur la fiche employé + génération) → inc 4 (rappels/notifications d'événement).

### 14/07/2026 (suite) — Calendrier partagé : incrément 3 (anniversaires automatiques)

**Fait :**
- **Fiche employé** : nouveau champ **date de naissance** (facultatif ; migration additive `20260714300000_employee_birth_date`). Saisissable à la création d'un collaborateur et modifiable via la fenêtre « Mobilité » (RH).
- **Anniversaires automatiques** dans le calendrier : le serveur génère des **événements virtuels « journée entière »** (non stockés) à partir des dates de naissance des collaborateurs actifs. On n'affiche que le **jour et le mois** — jamais l'année de naissance ni l'âge (confidentialité). Rendus avec 🎂 et la couleur or, non modifiables.
- **API** : `GET /calendar/events` fusionne les événements stockés et les anniversaires de la plage.

**Vérifications :** typecheck front + back OK ; build OK ; tests du calendrier : **7** (dont génération d'anniversaire au bon jour, absent hors plage, non gérable). Suite backend relancée.

**Reste (calendrier) :** inc 4 (rappels / notifications d'événement — cloche + e-mail à l'approche d'un événement).

### 14/07/2026 (suite) — Calendrier : anniversaires « du jour » sur le tableau de bord

**Précision demandée par l'opérateur** : l'anniversaire ne doit « sortir » **que le jour même**, pas rester affiché toute l'année ; et la date de naissance reste en back-office.
- **Encart « Anniversaire aujourd'hui »** sur le tableau de bord : n'apparaît **que le jour J**, listant uniquement les **noms** des personnes fêtées (« pensez à leur souhaiter ! »). Disparaît le lendemain.
- **API** : `GET /calendar/today-birthdays` — ne renvoie que les anniversaires du jour, **noms seuls** (aucune date de naissance exposée).
- Rappel : la date de naissance complète reste dans la fiche RH (back-office) ; le calendrier ne marque l'anniversaire que sur sa case du jour ; on n'affiche jamais l'année ni l'âge.

**Vérifications :** typecheck front + back OK ; build OK ; vérifié sur le serveur réel (seul l'employé fêté aujourd'hui ressort, pas celui de demain) ; test ajouté (l'anniversaire du jour sort, pas celui à +2 jours ; aucune date de naissance dans la réponse). Tests calendrier : **8**.

### 14/07/2026 (suite) — Calendrier partagé : incrément 4 (rappels & notifications) — **calendrier terminé**

**Fait :** dernier incrément du calendrier.
- **Notification à la création** : à l'ajout d'un événement, son audience reçoit une notification dans la cloche (`entityType = calendar_event`) ; les **échéances** passent en priorité haute (doublées d'un e-mail). Clic sur la notification → ouvre le **Calendrier**.
- **Rappel manuel** : bouton « Rappeler » sur le détail d'un événement (auteur/admin) → re-notifie l'audience (« Rappel : … », + e-mail).
- **Encart « Événements à venir »** sur le tableau de bord : les prochains événements (7 jours) qui me concernent, calculés à la demande (pas de planificateur), cliquables vers le calendrier.
- **API** : `GET /calendar/upcoming`, `POST /calendar/events/:id/remind`, notification intégrée à la création.

**Vérifications :** typecheck front + back OK ; build OK ; tests du calendrier : **11** (dont notification ciblée à la création, rappel manuel, fenêtre « à venir »). Suite backend relancée.

**➡️ Le calendrier partagé est complet** (4 incréments) : socle backend, écran mensuel, anniversaires automatiques (+ encart « du jour »), rappels/notifications. Le Centre de Communication Interne compte désormais **2 composants** (Babillard + Calendrier). Extensions futures possibles : sondages, newsletter.

### 14/07/2026 (suite) — Centre de Communication : Fil d'actualités (Newsletter inc 1)

**Fait :** 3ᵉ composant du Centre de Communication Interne — le **Fil d'actualités**, vue agrégée en lecture seule.
- **API** `GET /api/v1/newsfeed` : fusionne, sur une fenêtre de ±45 jours, les **annonces publiées qui me ciblent** (via mes reçus) et les **événements du calendrier qui me concernent** (même visibilité que le calendrier), triés du plus récent au plus ancien. Aucune nouvelle table (réutilise reçus + visibilité événements).
- **Écran** « Communication interne → Fil d'actualités » : chronologie type timeline, chaque élément (📣 annonce / 📅 événement / ⏰ échéance) montre sa date, son titre, un aperçu ; clic → ouvre l'annonce ou le calendrier. Bilingue FR/EN.

**Vérifications :** typecheck front + back OK ; build OK ; test ajouté (agrégation annonce+événement visible pour le destinataire, invisible pour un tiers). Tests communication-calendar : **12**. Suite backend relancée.

**Reste (Newsletter) :** inc 2 (digest périodique : compiler un bulletin d'actualités sur une période, aperçu, envoi par e-mail à une audience, archive des bulletins).

### 15/07/2026 — Centre de Communication : Bulletin d'actualités / Newsletter (inc 2, socle backend)

**Fait :** 4ᵉ composant du Centre de Communication Interne — le **Bulletin d'actualités** (« newsletter »), digest périodique composable puis diffusable par e-mail.
- **Modèle** `Newsletter` (titre, intro facultative, période début/fin, statut *brouillon*/*envoyée*, auteur, date d'envoi, nombre de destinataires, instantané figé des actualités) + enum `NewsletterStatus`. Migration `20260715184014_newsletters`. Aucune table existante modifiée.
- **Compilateur** (`lib/newsletters.ts`) : rassemble, pour une période, **uniquement les actualités de portée MAISON** — annonces publiées diffusées à « tous » + événements ouverts à « tous ». **Choix de confidentialité** : un bulletin partant à tout le personnel, on n'y agrège jamais un contenu ciblé sur un pôle/rôle/personne.
- **API** (`routes/newsletters.ts`, module « communication ») : liste (consultants ne voient que les bulletins **envoyés** ; éditeurs voient aussi les brouillons), prévisualisation d'une période, création/édition de brouillon, **envoi** (compile → fige l'instantané → e-mail à tout le personnel actif, sur le papier à en-tête maison, au meilleur effort), suppression logique. Cycle de vie verrouillé : un bulletin envoyé n'est ni modifiable ni renvoyable (409).
- **E-mail** (`buildNewsletterEmail`) : bulletin mis en page avec l'en-tête Éclosion Édition, liste datée des actualités, « Répondre à » = e-mail de l'éditeur qui envoie.

**Vérifications :** typecheck backend OK ; migration appliquée ; **4 tests** ajoutés (permissions, compilation « maison » qui exclut le ciblé + le hors-période, cycle brouillon→envoyé figé, visibilité consultant). Suite backend : **313 tests** (le seul échec observé en run complet est un *timeout* de charge sur un test RH sans lien — vert en isolation).

**Reste (Newsletter) :** inc 3 — écran « Bulletin d'actualités » (composer/prévisualiser/envoyer, consulter les bulletins envoyés), bilingue FR/EN, entrée de navigation.

### 15/07/2026 (suite) — Centre de Communication : Bulletin d'actualités (inc 3, écran)

**Fait :** l'écran **« Bulletin d'actualités »** (pôle Communication interne → 4ᵉ entrée), qui clôt le module Newsletter.
- **Liste** : les bulletins envoyés (visibles de tout le personnel) et, pour les éditeurs, aussi les brouillons ; chaque ligne montre le titre, la période, le statut (Brouillon/Envoyé) et le nombre de destinataires.
- **Composition** (éditeurs, `communication:saisie`) : titre, période (du/au), introduction facultative, avec un **aperçu en direct du sommaire** — la liste des actualités « maison » de la période s'actualise à chaque changement de dates (via `/newsletters/preview`).
- **Envoi** : bouton « Envoyer » avec **confirmation explicite** (« définitif, envoi par e-mail à tout le personnel, plus modifiable ») ; à l'envoi, message de retour avec le nombre de destinataires et d'actualités.
- **Consultation** : un bulletin envoyé s'ouvre en lecture seule et montre l'**instantané figé** (exactement ce qui a été diffusé) + date d'envoi et destinataires. Un brouillon montre l'aperçu en direct et propose Modifier / Supprimer / Envoyer.
- Bilingue FR/EN (clés `nlt.*`, `nav.cm-bulletin`), styles conformes au guide (bandeaux, badges, timeline sobre).

**Vérifications :** typecheck frontend OK ; build Vite OK. Aucune modification backend (le socle inc 2 était déjà fusionné).

**➡️ Le module Newsletter est complet** (3 incréments : fil d'actualités, socle backend, écran). Le Centre de Communication Interne compte désormais **4 composants** (Babillard + Calendrier + Fil d'actualités + Bulletin). Extensions futures possibles sous le même pôle : sondages, planification d'envoi automatique du bulletin.

### 16/07/2026 — Durcissement de l'architecture (inc 1) : frontières entre couches vérifiées

Chantier de **consolidation** (aucune nouvelle fonctionnalité) : rendre l'ERP durable dans le temps en verrouillant sa structure. Objectif = qu'un ajout dans 3 ou 5 ans ne puisse pas dégrader silencieusement l'organisation du code.

**Fait :**
- **Test d'architecture** (`backend/tests/architecture.test.ts`, écrit avec l'outil déjà présent — Vitest, **zéro dépendance nouvelle**) qui analyse le graphe d'imports et **fait échouer la CI** si une frontière est franchie. Trois invariants imposés :
  1. aucun fichier `lib/` ne dépend d'une route (pas de dépendance montante) ;
  2. aucune route n'importe une autre route (le partagé passe par `lib/`) ;
  3. personne n'importe l'assemblage (`app.ts` / `server.ts`).
- **Violation réelle corrigée** : `computeIsbnCompleteness` — une règle métier (complétude ISBN, Ch. 12) — vivait dans `routes/isbn.ts` mais était tirée par `routes/workflow.ts` et `routes/bat.ts`. Déplacée dans sa vraie couche : `lib/isbnCompleteness.ts`. Les trois routes l'importent désormais depuis `lib/`.
- Détection vérifiée sur les trois formes d'import (`… from`, `import()`, `import "…"` à effet de bord) — test prouvé non « faux-vert » en réintroduisant temporairement une violation.

**Vérifications :** typecheck backend OK ; test d'architecture 3/3 ; lot3 ISBN/BAT/workflow verts en isolation (le refactor ne change aucun comportement).

**Reste (durcissement) :** inc 2 — guide de démarrage développeur (`docs/`), pour qu'un nouvel arrivant lance et comprenne le projet sans deviner ; inc 3 (optionnel) — quelques tests bout-en-bout navigateur.

### 16/07/2026 (suite) — Durcissement de l'architecture (inc 2) : guide du développeur

Chantier de **consolidation** (documentation, aucun code applicatif touché).

**Fait :** nouveau document **`docs/08_Guide_developpeur.md`** — le guide d'accueil qui manquait pour qu'un développeur (humain ou IA) puisse **lancer, comprendre et faire évoluer** le projet sans deviner. Il complète le `README.md` (démarrage rapide) par :
- une **carte du code** (à quoi sert chaque dossier, où mettre quoi) ;
- les **trois couches et leurs frontières**, reliées au test qui les impose (inc 1) ;
- les **conventions non négociables** (les 7 contraintes d'intégrité et leur mise en œuvre : audit append-only, suppression logique, factures immuables, transactions atomiques, permissions Pôle→Profil→Niveau, erreurs explicites) ;
- l'**i18n FR/EN**, les **tests** (dont le piège du timeout de charge), le **workflow des migrations Prisma** (voie interactive + voie non interactive) ;
- une **recette pas à pas « ajouter un module de bout en bout »** qui encode toutes ces conventions en une check-list de 10 points ;
- les **points de déploiement** Cloud (Scalingo, disque éphémère → S3, SMTP hors dépôt).
- Lien ajouté depuis le `README.md`.

**Vérifications :** documentation uniquement ; aucune modification de code, de schéma ni de test. Rien à recompiler.

**Reste (durcissement) :** inc 3 (optionnel) — quelques tests bout-en-bout navigateur (Playwright déjà disponible dans l'environnement).

### 16/07/2026 (suite) — Correctif responsive : débordements horizontaux sur mobile

Signalé par l'opérateur (captures Scalingo sur téléphone) : certaines fenêtres débordaient à droite, coupant le contenu (menu déroulant des droits tronqué, filtres du Babillard chevauchant le titre). Cause : sur mobile, `.app-main` masque le débordement horizontal (`overflow-x: hidden`), donc tout élément trop large est **coupé et devient inaccessible**.

**Corrigé de façon systémique** (CSS partagé `styles/tokens.css`, s'applique partout d'un coup) :
- **En-tête de carte** (`.ecl-card__head`) : passait le titre et son action (filtres/boutons) sur une seule ligne non sécable → chevauchement. Ajout de `flex-wrap: wrap` + empilement explicite sous 640px (`flex-direction: column`) pour que l'action descende **sous** le titre. Corrige toutes les cartes à action (Babillard, etc.).
- **Champs de formulaire** (`input, select, textarea`) : ajout de `max-width: 100%` — un menu déroulant à libellé long (ex. « Correcteur — Correction éditoriale ») est désormais borné à la largeur de sa carte au lieu de pousser la page hors écran. Corrige la matrice des droits et tout menu long ailleurs.

**Audit associé** : vérification que chaque tableau large est bien dans un conteneur `overflow-x: auto` (défilement propre plutôt que coupe) — c'était déjà le cas partout (composant partagé `DataTable`, matrice des droits, journal d'audit, manuscrits, paie, présences). Les modales sont déjà bornées (`max-width: 100%`).

**Vérifications :** typecheck + build frontend OK ; rendu réel des deux écrans incriminés à 360 px (Chromium/Playwright) — **aucun débordement horizontal de page**, filtres empilés sous le titre, menu déroulant contenu dans la carte, tableau défilant dans son cadre. Correctif CSS pur, aucune logique touchée.

### 16/07/2026 (suite) — Application installable sur mobile (PWA)

Demande de l'opérateur : pouvoir « télécharger » l'application, avec le logo Eclospace. Pour un ERP web, la bonne réponse n'est pas une app de store (second code, comptes, revues) mais une **PWA** : on ouvre l'URL de l'ERP, on « ajoute à l'écran d'accueil », et une icône au logo lance l'application en plein écran comme une app.

**Fait :**
- **Manifeste** (`frontend/public/manifest.webmanifest`) : nom « Eclospace — Éclosion Édition », `display: standalone`, couleurs de marque (thème marine `#16233D`, fond `#F8F9FB`).
- **Icônes générées à partir du logo** (`eclospace-logo.jpg`) avec le Chromium déjà présent (aucun outil image à installer) : `icon-192`, `icon-512`, `icon-maskable-512` (marge de sécurité pour le masque Android), `apple-touch-icon` (iOS), favicon monogramme doré « E ».
- **Service worker minimal** (`sw.js`) : rend l'app installable + coquille de secours hors ligne ; **ne met jamais l'API en cache** (l'ERP montre l'état réel). Enregistré depuis `main.tsx` en production seulement, au meilleur effort.
- **`index.html`** : `theme-color`, `manifest`, `apple-touch-icon`, métadonnées iOS.

**Vérifications :** typecheck + build OK ; les fichiers PWA sont bien copiés dans `dist` (donc servis à la racine par le backend). Build servi en HTTP et inspecté dans Chromium : manifeste détecté, 3 icônes, `display: standalone`, **service worker actif (« activated »), portée racine** — critères d'installabilité réunis, aucune erreur console. Aucune dépendance ajoutée.

**Pour l'utilisateur :** ouvrir l'URL de l'ERP sur le téléphone → Android/Chrome propose « Installer l'application » (menu ⋮) ; iOS/Safari → Partager → « Sur l'écran d'accueil ». L'icône Eclospace apparaît alors sur l'écran d'accueil.

### 16/07/2026 (suite) — PWA : icônes plus lisibles (logo recadré et agrandi)

Retour de l'opérateur : le logo était trop petit dans l'icône. Le fichier source (`eclospace-logo.jpg`) contenait beaucoup de blanc autour du texte (zone utile détectée : 1004×305 sur 1280×653). Icônes régénérées en **recadrant au plus près** puis en **remplissant l'icône** (92 % de large pour les icônes standard, 72 % pour la version « maskable » afin de rester dans la zone de sécurité du masque Android). Résultat : « Eclospace » nettement lisible jusqu'à la petite taille d'un téléphone. Aperçu validé par l'opérateur avant fusion. Icônes régénérées : `icon-192`, `icon-512`, `icon-maskable-512`, `apple-touch-icon`.

### 16/07/2026 (suite) — PWA : choix final de l'icône = logo « Eclospace » agrandi

Le monogramme « E » (PR #83) a été annulé : l'opérateur a finalement retenu le **logo « Eclospace » complet en bandeau, agrandi**. Icônes régénérées à partir du logo recadré, remplies à **98 %** de la largeur (icônes standard et Apple), maskable inchangée à 72 % (zone de sécurité). PR #83 fermée sans fusion. Aperçu validé.

### 17/07/2026 — Correctif UX : conserver l'écran courant au retour d'arrière-plan (mobile)

Signalé par l'opérateur : sur mobile, minimiser l'application puis y revenir renvoyait au tableau de bord au lieu de rester sur l'écran ouvert. Cause : la navigation (état React `view`) n'existait qu'en mémoire vive ; quand le système recharge la page (récupération de mémoire au retour d'arrière-plan), l'app repartait de sa vue par défaut.

**Corrigé** (`frontend/src/App.tsx`) : l'écran courant est mémorisé dans `localStorage` (`eclospace.view`) tant qu'on est connecté, et **restauré au chargement** — y compris une fiche d'ouvrage ouverte (restaurée par son identifiant). Valeur invalide/clé inconnue → retour au tableau de bord. Effacé à la déconnexion (aucune mémorisation hors session).

**Vérifications :** typecheck + build OK ; test navigateur réel (Playwright) : après rechargement, l'app **reste sur la page Finance** et **restaure une fiche d'ouvrage** ouverte, au lieu de revenir au tableau de bord.

### 17/07/2026 (suite) — RH : signalement de clôture d'activité mensuelle

Nouveau besoin de l'opérateur : prévenir les responsables à temps pour finaliser la paie avant la clôture mensuelle. Décisions actées : l'activité d'un **mois civil** se clôture le **jour de clôture du mois suivant** (**10 par défaut, paramétrable** par la hiérarchie — 5, 6…) ; **rappels automatiques** aux **RH + Finance + Direction**, **les deux jours précédant l'échéance** (donc le 8 et le 9 pour une clôture au 10) ; déclenchement **à la connexion** d'un responsable, sans infrastructure de planification.

**Fait :**
- **Rubrique « Clôture d'activité mensuelle »** en tête de la page RH : échéance (date + jours restants, encart coloré selon l'urgence), période concernée, règle en vigueur, rappels déjà envoyés. Pour la hiérarchie (`rh:administration`) : **modifier le jour de clôture** (3–28) et **envoyer un rappel manuellement**.
- **Rappels automatiques** (cloche + e-mail, priorité haute) générés **paresseusement** — quand un responsable ouvre l'ERP autour de l'échéance (hook sur `/api/v1/me` pour RH/Finance/Direction, et sur la rubrique). Message explicite (« L'activité de juin sera clôturée le 10/07. Finalisez la paie : présences, absences, variables. »). **Idempotent** : un marqueur (`payroll_closure_reminders`, unique par période+jour) empêche tout double envoi ; **aucun rappel** si la période est déjà clôturée.
- **Paramétrage** du jour de clôture stocké dans `settings` (`activity_closure_day`) ; les jours de rappel s'en déduisent (jour-2 et jour-1).
- API : `GET /api/v1/hr/activity-closure`, `POST …/remind`, `PUT …/day`. Migration `payroll_closure_reminders`.

**Vérifications :** typecheck back+front ; build OK ; **5 tests** (jour paramétrable + bornes, rappel 1-2 jours avant mais pas le jour même, idempotence, pas de rappel si clôturée, permissions). Auth (6) et RH-pilotage (20) toujours verts. Rubrique vérifiée dans le navigateur réel (« 24 jours restants · prochaine clôture 10 août · période juillet 2026 »). Bilingue FR/EN.

### 17/07/2026 (suite) — Pont ERP → site vitrine (boutique WordPress), incrément 1

Nouveau besoin : permettre au maquettiste de **publier un ouvrage sur le site** (boutique WordPress/WooCommerce d'Éclosion), rangé dans la catégorie de son **genre**. Analyse faite avec l'opérateur ; le site est confirmé comme une **boutique** (panier, prix XAF, catégories = genres, ex. *FAMILLE*, *EDUCATION*).

**Fait (socle ERP, testable sans le site) :**
- **Modèle** `SitePublication` (état par ouvrage : non_publié/publié/erreur, identifiant + lien du produit distant, dernier aperçu, date/auteur). Migration `site_publications`. Aucune table existante modifiée.
- **Constructeur du produit** (`lib/sitePublisher.ts`) : à partir de l'ouvrage → nom (titre + sous-titre), auteur, **catégorie = genre**, **prix XAF** (extrait de `priceByCountry`), résumé, **ISBN** (SKU). Adaptateur **WooCommerce** (création/mise à jour de produit, résolution/création de la catégorie par nom) activé par variables d'environnement ; **sans configuration, l'action produit un APERÇU** (mémorisé) sans rien publier.
- **API** : `GET /manuscripts/:id/site-publication` (aperçu + état + champs manquants), `POST …` (publier — maquettiste, `manuscripts:saisie`).
- **Écran** : section **« Site vitrine »** sur la fiche d'ouvrage (dès la mise en page) — badge d'état, aperçu du produit, champs à compléter, lien vers la fiche du site, bouton **« Publier sur le site »**. Bilingue FR/EN.

**Vérifications :** typecheck back+front ; build OK ; **4 tests** (construction du produit, aperçu sans configuration, endpoint d'aperçu, permission de publication). Section vérifiée dans le navigateur réel (aperçu correct, « à compléter : prix » signalé).

**Reste (déploiement) :** créer la **clé API WooCommerce** côté site, la renseigner dans la config Scalingo (`SITE_WC_URL/KEY/SECRET`), puis **premier envoi test** en conditions réelles ; transfert de l'**image de couverture** (URL publique / import média) à finaliser au branchement.

**Sécurité :** les accès du site (partagés par l'opérateur) **ne sont pas** dans le dépôt ; ils iront en config d'hébergement. Mot de passe partagé en chat : à changer par prudence.

### 17/07/2026 (suite) — Site vitrine : pivot vers « fiche prête à publier » (option ①)

Le développeur du site a confirmé que **le site n'est pas WordPress** (sur-mesure PHP + React) et **n'expose pas d'API** de publication (le e-commerce est une option payante non prise, inutile pour la maison). La publication **automatique** demanderait une intervention dans le code du site, que le développeur juge difficile. **Décision opérateur (option ①)** : l'ERP prépare une **fiche prête à copier** que le maquettiste colle sur le site — zéro dépendance au développeur, utilisable tout de suite.

**Adapté :** l'ancienne connexion WooCommerce (incrément 1, #87) est remplacée par la **fiche copiable** :
- `lib/sitePublisher.ts` : `buildFichePayload` (titre, sous-titre, auteur, genre, prix XAF, ISBN, résumé) + `formatFiche` (texte prêt à coller) ; `setSitePublished` (marquage manuel + lien de la fiche en ligne). Suppression de l'adaptateur WooCommerce (sans objet).
- Section **« Fiche pour le site »** sur la fiche d'ouvrage : fiche formatée, bouton **« Copier la fiche »**, rappel couverture, champs manquants signalés, et suivi **« Marquer comme publié »** (+ lien facultatif) pour que l'ERP garde la trace de ce qui est en ligne.
- API : `GET /manuscripts/:id/site-publication` (fiche + état), `POST …` (marquer publié/retiré).

**Vérifications :** typecheck back+front ; build OK ; **4 tests** (construction de la fiche, endpoint d'aperçu, marquage publié + retrait, permission). Section vérifiée dans le navigateur réel.

**Le socle reste prêt** pour une publication automatique ultérieure si le site expose un jour une entrée API (option ②).

### 17/07/2026 (suite) — Fiche pour le site : couverture associée

Remarque de l'opérateur : la couverture devrait accompagner la fiche, pas être seulement rappelée. Ajouté : la section « Fiche pour le site » embarque désormais la **couverture (1re)** de l'ouvrage — **aperçu (vignette) + bouton « Télécharger la couverture »** — pour que le maquettiste ait tout au même endroit (texte + image). Si aucune couverture n'est déposée, un message invite à l'ajouter (Visuels / Pièces jointes).

Réutilise le stockage existant (`ImageAsset` type `couverture_1` → `DocumentVersion`) et la route de téléchargement `document-versions/:id/download`. Typecheck + build OK ; 4 tests verts (structure « couverture » vérifiée). Bilingue FR/EN.

### 19/07/2026 — Fiche pour le site : couverture téléchargée = image web légère

Demande de l'opérateur : le fichier à joindre à la fiche **ne doit pas être lourd**, il doit être **déjà en JPG/PNG**, de **très bonne qualité**. La couverture déposée dans l'ERP est en qualité **impression** (souvent plusieurs Mo, 3000+ px) — inadaptée telle quelle au site.

Ajouté : le téléchargement de la couverture depuis la fiche pointe désormais vers une nouvelle route `GET /api/v1/manuscripts/:id/site-cover` qui **transforme la couverture à la volée** en une image **légère** : sortie **JPG de très bonne qualité (q86)**, servie en pièce jointe avec un **nom propre** (`couverture-<titre>.jpg`). La vignette et le lien « Télécharger la couverture » utilisent cette version optimisée ; un libellé précise « image web légère, prête pour le site ».

**Format des vignettes du site pris en compte** (d'après la capture de la page catalogue eclosion.cm envoyée par l'opérateur) : les couvertures s'y affichent en **portrait ≈ 2:3**. La sortie est donc calée dans une boîte **1080 × 1600**, **proportions conservées** et **couverture entière** — on ne coupe jamais (aucun titre ni auteur perdu) et on ne déforme pas ; réduction seule (une couverture déjà petite n'est pas agrandie). Le site continue de recadrer l'affichage lui-même, comme pour les autres ouvrages.

**Choix technique** : bibliothèque **`jimp`** (traitement d'image 100 % JavaScript, sans binaire natif) — s'installe et tourne à l'identique sur le poste et sur le cloud, conforme à la règle « pas de dépendance exotique ». Isolé dans `lib/imageOptimize.ts` (`optimizeImage`, réduction seule) + `optimizedCoverForSite` dans `lib/sitePublisher.ts`. Format source non décodable (ex. PDF) → erreur explicite `422` plutôt qu'un fichier cassé. Détail dans `docs/JOURNAL_TECHNIQUE.md`.

Typecheck + build OK ; **8 tests verts** (réduction produit un JPG plus léger, jamais d'agrandissement, calage dans la boîte portrait 1080×1600 sans couper ni déformer, endpoint renvoie une image JPG légère en pièce jointe). Bilingue FR/EN.

### 19/07/2026 (suite) — Tableau de bord d'accueil enrichi (grands indicateurs)

La page d'accueil ne montrait que 4 totaux bruts. Elle devient un vrai **coup d'œil de pilotage**, en réutilisant `lib/kpi.ts` (source unique, mêmes formules que la page Direction) :

- **Nouveaux indicateurs** (chacun masqué si l'utilisateur n'a pas la permission) : **Ouvrages en cours** (hors archivés), **Tâches en retard** (orange si > 0), **Chiffre d'affaires**, **Ruptures de stock** (rouge si > 0) — en plus des ouvrages total, commandes, stock, utilisateurs.
- **Frise « pipeline éditorial »** : pour chaque étape du workflow portant des ouvrages, une barre proportionnelle (or) et le nombre — on voit d'un coup où en sont les ouvrages.
- Grands chiffres en **police à chasse fixe** ; montants en **notation compacte** (« 78,2 M XAF »), lisibles et sans débordement sur mobile (le chiffre exact reste sur la page Direction). Nombres jamais coupés en cours de chiffre.

Confidentialité respectée : indicateurs restreints (CA, ruptures, retards) invisibles pour un profil sans le droit correspondant. Typecheck + build OK ; **tests dashboard enrichis, verts** (cohérence ouvrages en cours = total − archivés ; somme du pipeline = total ; masquage `null` pour profil restreint). Vérifié en navigateur (accueil admin, ordinateur + mobile — captures à l'appui). Bilingue FR/EN.

### 19/07/2026 (suite) — Cloisonnement des pôles : droits RH et Rapports resserrés

Signalement de l'opérateur : un compte **Responsable commercial** avait accès aux modules **Ressources humaines** et **Rapports**. Après reproduction : ce n'était **pas** un bug d'usurpation d'identité (« Se connecter en tant que » abaisse bien les droits) ni d'affichage — le **rôle** portait `rh:consultation` et `rapports:consultation`, car le paramétrage livré les accordait à tous les responsables de service (élargissement §19.4). Les données confidentielles (salaires, chiffres financiers) restaient, elles, protégées.

**Décision opérateur (cloisonnement)** : un responsable opérationnel ne voit **que son pôle**. `rh:consultation` réservé au **Responsable RH** et à la **Direction générale** ; `rapports:consultation` réservé aux profils de pilotage (Direction générale, Direction éditoriale, Responsable finance, Responsable RH). Retiré à commercial, infographie, qualité, impression, juridique. Les présences (chacun voit les siennes) et la communication interne restent ouvertes à tous.

Mise en œuvre : nouveau `revoke()` dans le seed (miroir de `grant`) — le seed étant idempotent (rejoué à chaque test), **le rejouer corrige aussi une base déjà installée** ; correction également possible sans redéploiement via **Administration → « Droits & pôles »**. Tests `users-roles.test.ts` ajoutés (commercial/infographie n'ont ni RH ni Rapports ; RH/Direction les gardent) — 46 tests liés verts.

**Puis, à la demande de l'opérateur, changement du modèle de navigation** : au lieu de **masquer** les pôles non autorisés, on les **affiche tous** (structure de la maison visible par tous), avec un **cadenas** sur ceux hors périmètre ; cliquer un module verrouillé ouvre un écran clair **« Accès non autorisé »** nommant le pôle. Le contrôle serveur (403) et le gardiennage des **données** (indicateurs financiers, dossiers RH) restent inchangés — c'est la *structure* qui devient visible, pas les données d'autrui. Vérifié en navigateur (compte Responsable commercial : voit tous les pôles, cadenas sur RH/Utilisateurs/Droits/Paramètres/Diagnostics, écran « Accès non autorisé » à l'ouverture — captures à l'appui).

### 19/07/2026 (suite) — Comptes : réutiliser un e-mail/identifiant après suppression

Blocage signalé par l'opérateur (impossible de créer le compte du DG) : une **erreur technique brute** s'affichait (« Invalid `prisma.user.create()` … Unique constraint failed on the fields: (`email`) »). Cause : l'e-mail et l'identifiant sont uniques **en base** même après une suppression logique ; un compte supprimé (ex. « Noah ») occupait encore l'e-mail, mais les contrôles ne regardaient que les comptes non supprimés — d'où l'erreur non capturée.

Correctif : (1) à la **suppression**, l'identifiant et l'e-mail sont **libérés** (suffixés `#supprimé-<id>`, valeurs d'origine tracées) — la suppression reste logique ; (2) à la **création/modification**, on libère au besoin l'e-mail/identifiant retenus par des comptes supprimés (corrige aussi les comptes supprimés **avant** ce correctif) ; (3) filet de sécurité : toute collision résiduelle donne un **message clair en français** (409), jamais d'erreur technique. Un e-mail détenu par un compte **actif** reste refusé (409). Tests ajoutés (réutilisation après suppression → OK ; collision active → 409 sans texte « prisma »). 31 tests liés verts.

### 19/07/2026 (suite) — Connexion : robustesse au clavier mobile

Blocage signalé : après réinitialisation du mot de passe d'un compte, impossible de se connecter (« Identifiants invalides ») bien que le compte soit actif. Cause probable, liée au **clavier du téléphone** : les champs mot de passe de l'administration (création, réinitialisation) sont en texte visible (pour que l'admin puisse le communiquer) → la **correction/majuscule automatique** pouvait modifier le mot de passe enregistré, alors que le champ de connexion ne corrige pas ; et l'identifiant était comparé **exactement** (une majuscule ou un espace automatique le faisait échouer).

Correctif : (1) **frontend** — `autoCapitalize/autoCorrect/autoComplete=off` + `spellCheck=false` sur les champs identifiant et mot de passe (création, réinitialisation, connexion), pour que le clavier ne modifie plus la saisie ; (2) **backend** — l'identifiant est **rogné** et **insensible à la casse** à la connexion (« noah » = « Noah »), le **mot de passe reste exact** (jamais rogné) ; (3) **réparation des comptes existants** — un espace **déjà enregistré** dans l'identifiant n'est pas rattrapé par l'insensibilité à la casse (reproduit et vérifié), donc le seed **rogne les identifiants/e-mails déjà en base** (si la valeur nettoyée reste unique) : au redéploiement, un compte « Noah  » redevient « Noah » et se reconnecte. Tests `auth.test.ts` ajoutés (casse/espaces sur l'identifiant → OK ; espace en trop dans le mot de passe → refusé). Vérifié : typecheck + build OK, réparation confirmée en test.

### 21/07/2026 — Stockage durable (Backblaze B2) + Planning annuel des événements

**Stockage durable** : accompagnement de l'opérateur (pas à pas, sur mobile) pour brancher un **stockage objet permanent** — les fichiers s'effaçaient à chaque redéploiement (disque Scalingo éphémère). Après échecs de cartes bancaires sur plusieurs fournisseurs, choix de **Backblaze B2** (compatible S3, 10 Go gratuits, région Amsterdam). Bucket privé créé + clé dédiée (Read/Write), 6 variables `S3_*` renseignées dans Scalingo. Le code était déjà prêt (`lib/storage.ts`) : aucune modification, juste la configuration. Les fichiers (contrats, BAT, couvertures, affiches…) sont désormais **permanents**.

**Planning annuel des événements** (nouvelle fonctionnalité) : intégration du planning 2026 fourni (fusion de deux PDF) — **11 événements** (dont **Festival BINGUEL**, atelier de lecture pour enfants, 12→15 août). Chaque événement porte un **statut piloté** (à venir / à confirmer / **tenu** / **non tenu**) et une **affiche affichée directement** (sans téléchargement). **Le RH et la Direction générale** gèrent (statut + tous les champs **modulables**, dépôt d'affiche, ajout/suppression) ; **tout le personnel consulte sur le babillard, en temps réel**. Améliorations : mise en avant du **prochain** événement, badge **DG**, code couleur par statut. Modèle `AnnualEvent`, routes gardées (`communication:consultation` en lecture, `rh:administration` en gestion = RH + DG), composant sur le babillard, 11 événements chargés au seed puis **entièrement modifiables dans l'ERP**. **6 tests verts** ; typecheck + build OK ; vérifié en navigateur (ordinateur + mobile, captures à l'appui). Bilingue FR/EN.

### 20/07/2026 — Cloisonnement de la Production (droits par métier)

Signalement de l'opérateur (capture à l'appui) : un compte cumulant RH + Communication + **Juridique** ouvrait les modules **Production** (Maquette, Infographie, ISBN, BAT, Impression), sans aucun rôle « Production ». Cause identifiée et vérifiée : les modules Production étaient ouverts par le droit **générique** `manuscripts:consultation`, que le **Responsable juridique** possède légitimement (pour consulter les manuscrits liés aux **contrats**) — d'où l'accès par effet de bord. Le cumul de postes (effectif réduit, confirmé par l'opérateur) rendait le cas visible.

Correctif : chaque module Production dépend désormais du **droit métier** correspondant (`production` / `isbn` / `bat` / `printing:consultation`) et non plus de `manuscripts:consultation`. Résultat : le **juridique garde ses Contrats** mais **n'accède plus à la Production** ; chaque métier ne voit que le sien. La **Direction** (générale et éditoriale) reçoit dans le seed les droits de vue Production manquants pour garder la **supervision complète**. Tests ajoutés (juridique = aucun module Production mais garde `manuscripts:consultation` ; direction éditoriale = tous). Typecheck + build OK ; vérifié rôle par rôle. Rappel donné à l'opérateur : chaque rôle attribué **ajoute** ses accès — préférer un rôle par métier, sauf cumul voulu.

### 21/07/2026 (suite) — Planning des événements : sous-rubrique dédiée + vue calendrier annuelle

À la demande de l'opérateur, le **Planning des événements** est devenu une **sous-rubrique** de « Communication interne » (au lieu d'être encastré dans le babillard) : on la voit dans le menu et on l'**ouvre en cliquant** dessus.

Puis ajout d'une **vue calendrier** (aperçu global de toute l'année, comme le planning imprimable), **en gardant la liste**. Un sélecteur en haut de la page bascule entre **📋 Liste** (détaillée, avec pilotage RH/Direction) et **📅 Calendrier** (les **12 mois de l'année d'un coup d'œil**). Dans la vue calendrier : navigation d'année (◀ 2026 ▶), **compteur d'événements**, **légende des statuts** (couleurs À venir / À confirmer / Tenu / Non tenu), chaque jour concerné est **coloré selon le statut** ; cliquer un jour ouvre une **fiche du jour** (titre, badge DG, statut, dates, lieu, affiche, bouton « Modifier » pour RH/Direction). L'année s'ajuste automatiquement à celle des événements si l'année en cours est vide. Aucune fenêtre flottante — vue **intégrée et lisible sur mobile**.

Mise en œuvre 100 % frontend (composant `AnnualEventsPlanning`, aucune modification serveur ni base) : nouveaux sous-composants `YearCalendar` / `MiniMonth`, table jour→événements (bornes incluses), fiche du jour. Nouvelles clés i18n (`events.view_list/view_cal/count`, `common.close`). Typecheck + build OK ; vérifié en navigateur sur mobile (liste, calendrier annuel 2026, fiche du jour Festival BINGUEL — captures à l'appui). Bilingue FR/EN.

### 22/07/2026 — Audit avant version finale + 3 premiers renforts de sécurité

**Audit complet de l'ERP** (sur le code réel) : 39 modules, 24 écrans, 53 migrations, **343 tests** (verts ; les rares échecs en exécution parallèle sont des lenteurs de démarrage à froid, pas des bugs — repassent verts isolément). Les **6 contraintes d'intégrité** sont respectées (suppression logique, journal inaltérable, transactions atomiques, BAT verrouillé, période comptable gelée, ISBN unique). Sécurité de base en place (argon2, 2FA, sanitize-html, cookies httpOnly/sameSite/secure, CORS restreint, cloisonnement par pôle). Manquements identifiés et présentés à l'opérateur, classés par priorité (🔴 sécurité avant ouverture · 🟠 qualité/exploitation · 🟢 finitions).

**Points 1 à 3 traités (sécurité, sur validation de l'opérateur)** :
1. **Anti-force brute par compte** — 8 échecs sur un même identifiant → verrou temporaire de 10 min, remis à zéro à la première connexion réussie. Choisi **par compte** (et non par IP) car un bureau partage souvent une seule connexion Internet : une limite par IP bloquerait tout le monde.
2. **Filet d'erreur global** — plus jamais de message technique brut à l'écran (fini le « Unique constraint failed ») : message français propre garanti, erreur réelle journalisée côté serveur.
3. **En-têtes de sécurité navigateur** (helmet) — protections standard activées (CSP laissée désactivée pour ne pas casser l'interface React/PWA, à affiner plus tard).

Nouveau fichier de tests `security-hardening.test.ts` (3 tests verts). Typecheck + suite OK. Détail technique dans `docs/JOURNAL_TECHNIQUE.md`. Restent au programme : CI, allègement du chargement, exercice de restauration, recette métier, arbitrages (hors-ligne, chiffrement renforcé).

### 22/07/2026 (suite) — Intégration continue + stabilité des tests (audit, points 4 & 6)

**Intégration continue** (point 4) : nouveau workflow `.github/workflows/ci.yml`. À chaque proposition de fusion, GitHub vérifie automatiquement les types, lance **toute la suite de tests** (sur une base PostgreSQL jetable) et compile le frontend. Plus rien ne peut être fusionné en cassant la compilation ou un test — le filet de sécurité qui manquait.

**Stabilité des tests** (point 6) : délais des tests portés à 30 s dans `vitest.config.ts`. Les quelques échecs qu'on voyait étaient de simples lenteurs de démarrage à froid, pas des bugs ; ces marges les suppriment, ce qui rend la CI fiable.

### 22/07/2026 (suite) — Interface plus légère au premier accès (audit, point 5)

Découpage du chargement par écran (`React.lazy` + `Suspense`) : chaque page ne se télécharge qu'au moment où on l'ouvre, au lieu de tout charger d'un bloc. **Bundle initial 732 Ko → 349 Ko** (compressé ~196 Ko → ~107 Ko, environ **45 % de moins**) — un vrai gain sur une connexion modeste. Seule la page de connexion reste chargée d'emblée. Aucune dépendance ajoutée. Vérifié en navigateur (connexion + navigation, sans erreur).

### 22/07/2026 (suite) — Sauvegardes & restauration : runbook (audit, point 7)

Guide d'exploitation `docs/EXPLOITATION_SAUVEGARDES.md` pour l'administrateur : les deux réserves à protéger (base PostgreSQL chez Scalingo — sauvegardes automatiques ; fichiers chez Backblaze — versionnage), comment restaurer sans risque, et surtout une **procédure d'exercice de restauration** à réaliser au moins une fois avant la mise en service (puis chaque trimestre). Rappel : une sauvegarde jamais testée en restauration ne compte pas. Le test réel se fait côté Scalingo/Backblaze — accompagnement pas à pas prévu avec l'opérateur.

### 22/07/2026 (suite) — Vulnérabilités des dépendances passées en revue

`npm audit` : 6 alertes backend (0 côté frontend). La seule qui touche la **production** — `fast-uri` (via Fastify) — est **corrigée** (mise à jour non cassante, `package-lock.json` uniquement). Les 5 autres proviennent toutes de `s3rver`, un **outil de test** (serveur S3 fictif) jamais déployé ni exécuté en production → **aucun risque réel** ; les corriger casserait le test pour rien, donc laissées telles quelles et documentées. Suite de tests revérifiée verte après la mise à jour.

### 22/07/2026 (suite) — Politique de sécurité du contenu (CSP) activée (finalise l'audit, point 3)

La CSP, laissée désactivée à la première passe (pour ne pas risquer de casser l'interface), est maintenant **activée sur mesure** : les scripts ne viennent que de l'application (barrage anti-injection XSS), tout en laissant fonctionner les styles React, les images/affiches, le service worker (PWA) et la présence temps réel. `upgrade-insecure-requests` uniquement en production (HTTPS). **Vérifié en navigateur, aucune violation, interface intacte** (connexion, écrans à la demande, « en ligne » temps réel). Le point 3 de l'audit est ainsi complet.

### 22/07/2026 (suite) — Correction des dates du « Salon de Paris »

Dates confirmées par l'opérateur : **19 → 23 avril 2026** (au lieu de 19 mars → 30 avril, une plage trop large qui colorait tout le mois sur le calendrier). Corrigé dans le seed **et** réparé pour la base déjà en ligne : une réparation ciblée et idempotente met à jour l'événement au prochain déploiement, sans écraser d'éventuelles modifications manuelles. Vérifié (la réparation corrige bien un événement resté aux anciennes dates).

### 22/07/2026 (suite) — Décisions de lancement actées + check-list

Sur recommandation (après l'audit), la Direction acte : **D-008 — pas de mode hors-ligne en v1** (risque de synchro sur des données critiques ; la PWA tolère déjà les micro-coupures) et **D-009 — chiffrement conservé en l'état** (HTTPS + chiffrement au repos Scalingo + hachage + cloisonnement par droits suffisent ; le champ-par-champ ajouterait un risque de gestion de clés disproportionné). Consignées au `06_Registre_des_decisions.md`. Nouvelle **check-list de lancement** (`docs/CHECKLIST_LANCEMENT.md`) : sécuriser les accès (régénérer les secrets exposés, mot de passe admin, 2FA), test de restauration, recette métier par les référents, finalisation des données/comptes, bascule. L'essentiel restant relève de l'humain (recette) et de l'exploitation, pas du développement.

### 23/07/2026 — Aide intégrée (mode d'emploi par écran)

Nouvelle rubrique **« Aide »** dans le menu, pour **tout le personnel** : un mode d'emploi **par pôle et par sous-rubrique** qui oriente les utilisateurs quand ils bloquent. Pour chaque écran : à quoi il sert, les actions principales, et un encart « Si vous êtes bloqué » (questions fréquentes). Une **recherche** retrouve un sujet en un mot. **36 écrans documentés**. Contenu en français, sans jargon ; page chargée à la demande (n'alourdit pas le démarrage). Vérifié en navigateur. Le contenu anglais pourra être ajouté plus tard (la coquille est déjà bilingue).

### 23/07/2026 (suite) — Aide intégrée approfondie (procédé + blocages par écran)

Sur retour de l'opérateur (l'aide était trop superficielle), réécriture complète du contenu : chaque écran présente désormais le **procédé réel, étape par étape** (« Comment faire ») avec les vrais boutons, puis « Si vous êtes bloqué » (blocages concrets). Corrections apportées : ajout d'une entrée dédiée **« Envoyer un document par e-mail »** (facture/relevé depuis Finance, bulletin, lien de devis — l'app n'envoie pas d'e-mails libres) ; **« Mes lectures »** précisée (formulaire d'évaluation structuré — notes/critères + recommandation + commentaire → « Remettre mon rapport » — pas de téléchargement de rapport) ; nouvelle entrée **« Comprendre le circuit d'un ouvrage »** expliquant que 9 rubriques (comité, direction, correction, maquette, infographie, ISBN, BAT, impression, contrats) sont des **étapes** (ouvrir l'ouvrage à l'étape → faire le travail → « Valider cette étape »). Vérifié en navigateur.

### 23/07/2026 (suite) — Aide contextuelle par rubrique (plus de bloc unique au menu)

Sur demande de l'opérateur : l'aide n'est plus regroupée dans une rubrique « Aide » unique du menu. Elle est désormais **intégrée à chaque écran** : en ouvrant une rubrique, un bandeau **« ❓ Aide de cette rubrique »** apparaît en haut, repliable, montrant l'aide **de cette rubrique-là** (procédé étape par étape + « Si vous êtes bloqué »). L'accueil affiche en plus les repères généraux (connexion, circuit, e-mail…). Nouveau composant `RubricHelp` (injecté au-dessus de chaque page via `App.tsx`, clé = rubrique courante) ; ancienne page `HelpPage` et l'entrée de menu « Aide » retirées. Le contenu (`help/helpContent.ts`) est réutilisé tel quel. Vérifié en navigateur.

### 23/07/2026 (suite) — « Mes lectures » : téléchargement du rapport de lecture

Sur demande de l'opérateur : le relecteur peut désormais **télécharger/imprimer son rapport de lecture** (en plus de la saisie déjà prévue). Chaque évaluation remise affiche un bouton **« Télécharger mon rapport »** (Numérique/PDF, avec ou sans papier à en-tête) : le document reprend l'ouvrage, le relecteur, les critères notés (avec coefficients et commentaires), le score global, la recommandation et l'appréciation générale. Réalisation : le backend inclut désormais l'évaluation soumise (notes + critères) dans les missions du relecteur ; nouvelle fonction d'impression `printReadingReport` (même infrastructure que factures/bulletins/paie). Test ajouté (l'évaluation remise est bien fournie au relecteur). Typecheck + tests verts ; vérifié en navigateur.

### 23/07/2026 (suite) — Rapport de lecture : fichier joint + accès comité/direction

Deux compléments à la demande de l'opérateur :
1. **Fichier externe de rapport de relecture** : le relecteur peut **joindre un document** (le rapport rédigé qui a servi à l'évaluation), en plus du formulaire et du rapport généré. Bouton « Joindre le rapport (fichier) » dans « Mes lectures » ; fichier stocké (GED) et téléchargeable. Champs ajoutés à `reading_assignments` (migration additive) ; endpoints dépôt (relecteur propriétaire) / téléchargement (comité/direction).
2. **Accès comité/direction** : nouvelle section « Comité de lecture — rapports » sur la fiche manuscrit (gardée par `comite_lecture:consultation`) listant les évaluations des relecteurs, avec téléchargement du **rapport généré** (PDF) et du **fichier joint**.

Réalisation : `printReadingReport`/`buildReadingReport` partagés (`lib/readingReport.ts`), composant `ReadingEvaluationsSection`, fonctions client. Tests ajoutés (dépôt + téléchargement). Types + tests verts ; vérifié en navigateur.

### 23/07/2026 (suite) — « Suivi des ouvrages » : où en est chaque livre (voyants)

Nouvelle rubrique **« Suivi des ouvrages »** (menu principal, accessible à tout le personnel) : la liste des ouvrages engagés en production (à partir de la contractualisation), chacun avec son **étape courante** et un **% d'avancement**. En cliquant un ouvrage, on déplie **« Où en est l'ouvrage »** : une frise de **voyants** (fait ✓ / étape en cours en or / à venir) sur les 20 étapes du circuit, avec l'étape courante mise en avant. Pensé pour que le commercial ou l'assistanat éditorial situe un livre et renseigne un auteur d'un coup d'œil, sans le détail éditorial confidentiel. Endpoints `GET /workflow-statuses` et `GET /production-tracking` (requireAuth, ouvrages en production seulement) ; composants `ProductionTrackingPage` + `ManuscriptProgress`. Tests ajoutés. Types + tests verts ; vérifié en navigateur.

### 25/07/2026 — Messagerie interne 1-à-1 (avec pièces jointes)

Nouvelle **messagerie privée** entre utilisateurs (pôle Communication interne), selon les choix de l'opérateur : messages 1-à-1, annuaire ouvert (chacun écrit à tout le monde) mais présence « en ligne » masquée hors pôle, messages privés avec **supervision Direction possible, tracée au journal d'audit**, et **pièces jointes**. Backend : tables `conversations`/`chat_messages`/`conversation_reads` (migration), routes `/api/v1/chat` (annuaire, conversations, fil, envoi texte ou fichier, non-lus, lecture, téléchargement, suppression logique), livraison temps réel via Socket.IO. Frontend : écran « Messagerie » (liste, fil, composeur texte + fichier, badges de non-lus), bilingue. 7 tests. Correctifs d'affichage mobile ensuite (mise en page responsive, bascule paysage/portrait par orientation, et **déverrouillage de la rotation** — le manifeste PWA était figé en `portrait-primary`, passé à `any`).

### 26/07/2026 — Espace Auteur, incrément 1 (socle)

Démarrage de l'**Espace Auteur** : les auteurs (fiches Partenaire) peuvent disposer d'un **compte externe** relié à leur fiche, avec une **interface entièrement distincte** de l'ERP employé. Périmètre inc. 1 : compte + portail séparé + **tableau de bord « Mes ouvrages »** (avancement en langage clair : dépôt → lecture → correction → maquette → BAT → impression → publication, avec fil des étapes) + notifications. **Isolation stricte** : un auteur ne voit que ses propres ouvrages ; aucun accès à l'ERP (compte externe sans permission). Réalisation : enum `AccountType` + `partner_id` sur `users` (migration), `requireAuthor`, `account_type` dans `/me`, routes `/api/v1/author/*` (portée partnerId), endpoint personnel de création de compte auteur, auteur de démonstration au seed, portail `AuthorPortal` (aiguillage dans `App.tsx`), bilingue. Auteurs exclus de l'annuaire de la messagerie interne. 9 tests (isolation, cloisonnement, création). Vérifié en navigateur. Incréments suivants prévus : fichiers + messagerie services (Éducation/Client), puis droits/contrats/signature.

### 26/07/2026 (suite) — Espace Auteur, incrément 2a : échange de fichiers

Deuxième incrément (première moitié) de l'Espace Auteur : **échange de fichiers auteur ↔ maison**. Dans son portail, l'auteur **dépose** des fichiers (manuscrit, corrections, illustrations) sur l'un de ses ouvrages et **télécharge** les documents que la maison lui **partage** (BAT, épreuves, contrat…). Côté personnel, une section « Échange de fichiers avec l'auteur » sur la fiche manuscrit liste les dépôts de l'auteur et permet de lui partager un document. Notifications automatiques dans les deux sens (l'équipe est prévenue d'un dépôt, l'auteur d'un partage). Portée stricte : un auteur n'accède qu'aux fichiers de ses propres ouvrages ; suppression logique de ses propres dépôts (pas des fichiers de la maison). Réalisation : table `author_files` + enum `AuthorFileDirection` (migration), routes auteur (`/api/v1/author/works/:id/files`, dépôt/liste/téléchargement/suppression) et personnel (`/api/v1/manuscripts/:id/author-files`), stockage réutilisé, composant `AuthorFilesSection`, section « Fichiers » du portail. 5 tests ajoutés (14 au total pour l'Espace Auteur). Suite complète au vert. Vérifié en navigateur (dépôt auteur + partage maison). Reste l'incrément 2b : messagerie vers Service Éducation/Client.

### 29/07/2026 — Espace Auteur, incrément 2b : messagerie vers les services

Seconde moitié de l'incrément 2 : l'auteur écrit, depuis son portail, au **Service Éducation** ou au **Service Client** (section « Messagerie » : un fil = un sujet ; réponses suivies). Côté personnel, nouvel écran **« Messages des auteurs »** (pôle Communication interne) où les agents habilités traitent les demandes et répondent, avec filtre par service et compteurs de non-lus. Notifications dans les deux sens. L'auteur n'écrit qu'à un service (pas à une personne) et ne voit que ses propres fils. Réalisation : enums `ServiceDesk`/`ServiceMessageSender`, tables `service_threads`/`service_messages` avec suivi de lecture (migration) ; nouveau module de permission **`service_auteurs`** (consultation/saisie) accordé aux profils transverses (communication, commercial, direction éditoriale et générale) au seed ; routes auteur et personnel (`serviceDesk.ts`) ; section `AuthorMessages` du portail + écran `ServiceDeskPage`. Bilingue. 7 tests (création/réponse, isolation, gardes de permission). Suite complète au vert. Vérifié en navigateur des deux côtés. L'incrément 2 (échange de fichiers + messagerie services) est ainsi complet.

### 29/07/2026 (suite) — Reconfiguration Finance, étape 2 : jalon devis non bloquant + prise en charge

Sur demande de l'opérateur (le devis relève de la Finance, et l'utilisateur ne doit jamais être bloqué). Ajout sur le manuscrit d'un **mode de prise en charge** (à compte d'éditeur / **à compte d'auteur**) et d'un **jalon devis volontairement NON BLOQUANT** : pour un ouvrage à compte d'auteur, l'utilisateur choisit **« Établir le devis »** (la Finance est notifiée), **« Plus tard »**, ou **« Passer cette étape »** (avec justification) — le travail éditorial n'est jamais empêché. Côté Finance, nouvelle carte **« En attente de devis »** (page Finance) listant les ouvrages à compte d'auteur dont le devis reste à établir. Réalisation : enums `FundingMode`/`QuoteDecision` + champs sur `manuscripts` (migration) ; route `PATCH /manuscripts/:id/funding` (manuscripts:saisie, notifie la Finance sur « établir ») et `GET /finance/pending-quotes` (finance:consultation) ; composants `FundingCheckpoint` (fiche manuscrit) et `PendingQuotesCard` (page Finance). 5 tests (options non bloquantes, justification requise pour passer, liste Finance, permissions). Suite complète au vert. Vérifié en navigateur. Restent les étapes 3 (factures/proforma par le comptable + validation par seuil) et 4 (PDF Finance).

### 29/07/2026 (suite) — Reconfiguration Finance, étape 3 : commandes à facturer + validation par seuil

Sur demande de l'opérateur : une **commande à facturer** (ex. **livre scolaire**), initiée par le **DG, le commercial ou la Finance** (même principe que le jalon devis auteur), que la **Finance reçoit et transforme en facture**. Ajout d'une **validation par seuil** : sous le seuil (paramétrable, défaut 1 000 000 XAF), le comptable émet la facture ; au-dessus, elle naît **« en attente de validation »** du DG. Réalisation : modèle `BillingOrder` (nommé ainsi pour ne pas entrer en collision avec la `SalesOrder` commerciale existante) + enums `BillingOrderStatus`/`BillingOrderCategory` + compteur `CMD-AAAA-NNNN` ; ajout de `proforma` (InvoiceType) et `pending_validation` (InvoiceStatus) ; réglage `finance.validation_threshold`. Routes : création de commande (DG/commercial/finance), file « à facturer », établissement de la facture avec application du seuil, file des factures en attente + validation DG, lecture/écriture du seuil. `createInvoiceFromBillingOrder` réutilise `createInvoiceRecord`. Frontend : `BillingOrdersSection` sur la page Finance (formulaire commande, file « Commandes à facturer », « Établir la facture », « Factures en attente de validation » + « Valider », réglage du seuil). 5 tests (création, permission, seuil sous/au-dessus, validation DG, double facturation refusée). Suite complète au vert sur base neuve. Vérifié en navigateur (parcours livre scolaire 2 000 000 → en attente → validée). Note technique : ajouts de valeurs d'enum isolés dans leur propre migration (`ALTER TYPE ADD VALUE`) pour éviter les conflits d'application. Reste l'étape 4 (proforma exposée + PDF Finance partout) et l'entrée « commande » côté Commercial.

### 29/07/2026 (suite) — Messagerie : accusés de lecture + voyant, et Hall : voyant par pôle

Trois évolutions demandées par l'opérateur.
1. **Accusés de lecture (messagerie)** : un message que j'envoie porte **une coche** (envoyé) ; dès que le correspondant ouvre le fil, il passe à **deux coches en or** (lu). Backend : le fil expose un indicateur `read` par message (comparé à la dernière lecture du correspondant) ; un événement temps réel `chat:read` prévient l'expéditeur à la lecture. Frontend : coches ✓ / ✓✓ (or) sur mes messages, mises à jour en direct.
2. **Voyant de nouveau message chez le destinataire** : un **point rouge** sur le pôle « Communication interne » et un **badge de non-lus** sur l'entrée « Messagerie », rafraîchis régulièrement — le destinataire est averti même hors de la messagerie.
3. **Hall — voyant vert par pôle** : le pôle s'allume en vert dès qu'un de ses membres est connecté. Correctif : le pôle d'appartenance est désormais déduit du **département de la fiche employé OU, à défaut, des rôles** de l'utilisateur (beaucoup de comptes n'ayant pas de fiche RH tombaient tous en « Administration »). Vérifié en navigateur (deux comptes : un correcteur → Éditorial, l'admin → Administration ; les deux pôles s'allument).

Tests : accusé de lecture (le message passe à « lu » après consultation). Suite complète au vert sur base neuve.

### 31/07/2026 — Correction de facture (annulation validée DG + avoir) et chiffre d'affaires par famille

Trois demandes de l'opérateur, livrées en deux incréments.

1. **Annuler une facture (validée par le DG)** : une facture émise étant immuable, son annulation est un changement d'état **contrôlé en deux temps** — le **comptable la demande** (motif obligatoire → statut `cancellation_requested`), le **DG la valide** (`cancelled`) ou la refuse. Ce n'est **qu'à la validation** que la facture **sort du chiffre d'affaires** (kpi exclut `cancelled`). Garde-fou : une facture **déjà tirée (imprimée)** ne peut plus être annulée (`printed_at` posé à la première impression → 409). Mention **« Vente à crédit — montant dû »** sur le document tant que la facture n'est pas réglée. Écrans : bouton « Annuler la facture » (comptable), carte « Annulations à valider » (DG).

2. **Avoir (note de crédit)** : voie légale de correction quand la facture ne peut plus être annulée (tirée/réglée). `createCreditNoteFromInvoice` crée un avoir de mêmes montants rattaché à la facture (`parentInvoiceId`), contre-passe les droits d'auteur, respecte la période comptable ; un seul avoir par facture. Bouton « Avoir » sur les factures émises/réglées ; l'avoir s'imprime aussitôt et ramène le CA de la facture à zéro.

3. **Chiffre d'affaires par famille** : nouveau bloc sur la page Finance affichant, pour chaque **famille** (livre scolaire & parascolaire, livre général & littérature, communication & marketing, prestations d'édition/compte d'auteur), le **CA facturé**, le **CA encaissé** et les **créances** (vente à crédit), plus les **totaux** (facturé = encaissé + créances, TTC). Base de ventilation livre : nouveau **segment éditorial** (`EditorialSegment` scolaire/général) posé par l'éditorial sur la fiche ouvrage ; les prestations et la communication se déduisent du type de devis, le scolaire d'une commande à facturer ou du segment. Endpoint `GET /dashboard/revenue-by-family` (finance ou direction).

Réalisation : migrations `invoice_cancellation` (statut + colonnes `cancellation_*`), `invoice_printed` (`printed_at`), `editorial_segment` (enum + colonne) ; `lib/kpi.revenueByFamily`, `lib/invoicing.createCreditNoteFromInvoice` ; endpoints dans `billingOrders.ts` et `dashboard.ts`. Tests : 17 `billing-orders` (demande/validation/refus, verrou impression, motif requis, avoir + doublon refusé, ventilation facturé/créances, avoir hors CA) ; manuscrits/finance/dashboard au vert (36). `tsc` back+front + build OK.

### 31/07/2026 (suite) — Droits d'auteur : assiette juste face aux remises, et calcul du livre scolaire (12 % modulable, segmenté)

Deux demandes de l'opérateur.

1. **Assiette « prix public HT » et remise (correction).** Une remise consentie au libraire réduisait à tort les droits des contrats calculés **au prix public** : l'assiette retenue était le prix *net facturé*. Désormais on conserve, sur la ligne de facture, le **prix public HT avant remise** (`unit_public_price`) et on l'utilise comme assiette pour ces contrats ; les contrats **« prix net éditeur »** restent, eux, calculés sur le net. **Retours et avoirs contre-passent sur la même assiette** que la vente d'origine. Test dédié (`royalty-base-discount`) : contrat public → droits sur le prix public (36 000 et non 28 800 après remise de 20 %), contrat net → droits sur le net.

2. **Droits d'auteur du LIVRE SCOLAIRE.** Le livre scolaire est facturé par une **commande à facturer** ; jusqu'ici globale (montant unique), elle ne générait **aucun droit d'auteur**. Ajout d'un **détail par ouvrage** sur ces commandes (ISBN, quantité, prix unitaire HT, taux éventuel) et d'un **moteur de droits dédié** : **12 % par défaut, quel que soit l'ouvrage, mais modulable** — taux maison réglable par la DAF (réglage `royalty.scolaire_default_rate`) et **taux par ligne** possible au cas par cas. À l'établissement de la facture, une **écriture de droits segmentée et immuable** est créée par ouvrage (`SchoolRoyaltyEntry`), portant tous les renseignements réglementaires : **ouvrage, auteur, co-auteurs, ISBN, prix unitaire, quantité, assiette, taux, montant**. Un **avoir** sur une facture scolaire **contre-passe** ces droits (le relevé se neutralise). Nouveau **relevé segmenté par ouvrage** (endpoint `GET /royalties/school`, filtrable par année/ouvrage) avec **export CSV** de conformité.

Réalisation : migrations `invoice_line_public_price` (colonne `unit_public_price`), `school_royalty` (tables `billing_order_lines` et `school_royalty_entries`) ; `lib/schoolRoyalty.ts` (résolution ouvrage/auteurs, écriture des droits, relevé segmenté), réglage dans `lib/royaltySettings.ts`, branchement dans `lib/invoicing.ts` (facture depuis commande détaillée + contre-passation avoir), endpoints taux + relevé dans `routes/royalties.ts`, saisie par ligne dans `routes/billingOrders.ts`. Frontend : éditeur de lignes-ouvrages dans « Commandes à facturer » (page Finance), et bloc **« Droits d'auteur — livre scolaire »** (taux maison réglable, relevé par ouvrage, export CSV) sous les états annuels. Tests : `royalty-base-discount` (2) et `school-royalty` (5 : 12 % par défaut + segmentation, taux par ligne, taux maison modulable, relevé cumulé, permission DAF, contre-passation avoir). `tsc` back+front + build front OK.

**Décision opérateur (31/07/2026) — le contrat prime.** Priorité du taux appliqué à un livre scolaire : (1) **taux saisi sur la ligne** de commande (cas particulier) ; (2) sinon le **taux du contrat d'édition actif** du livre s'il en existe un (paliers respectés, le contrat prime sur le taux maison) ; (3) sinon le **taux maison** (12 % par défaut). L'assiette reste le prix unitaire de la vente scolaire. Test dédié : ouvrage sous contrat 8 % → droits calculés à 8 % (et non 12 %), un taux de ligne (5 %) primant encore sur le contrat.

### 31/07/2026 (suite) — La demande d'annulation de facture atteint bien le DG

Constat opérateur : une demande d'annulation de facture (par le comptable) **n'arrivait pas au DG**. Cause : la notification « annulation à valider » visait les titulaires de `finance:administration` **en excluant l'administrateur général** — or, dans une structure sans compte « Directeur général » dédié, l'administrateur général EST le décideur ; la liste des destinataires était donc **vide** et personne n'était prévenu (la carte de validation restait visible mais aucune cloche ne l'y amenait). Correctif : l'annulation d'une facture étant une décision **de gouvernance**, la notification part désormais à **tous** les titulaires de `finance:administration`, **administrateur général inclus** (les notifications purement opérationnelles du pôle — nouvelle commande à facturer — continuent, elles, d'exclure l'admin). On ne se notifie pas soi-même (le demandeur peut détenir la permission). La validation reste gardée par `finance:administration`. Test : une demande émise par un comptable notifie bien l'administrateur général, sans auto-notification du demandeur. Suite `billing-orders` au vert (18).

### 31/07/2026 (suite) — Facture au-dessus du seuil : cloche au DG + rubrique Valider / Refuser

Prolongement de la correction précédente au cas des **factures dépassant le seuil** (« à valider par le DG »).
1. **Cloche au DG** : dès qu'une facture naît « en attente de validation » (montant ≥ seuil), les titulaires de `finance:administration` — **administrateur général inclus** (décision de gouvernance), sans se notifier soi-même — reçoivent une notification.
2. **Vraie rubrique Valider / Refuser** : la carte « Factures à valider (au-dessus du seuil) » propose désormais, en plus de **Valider**, un bouton **Refuser** (motif obligatoire). Un refus : la facture (dont le numéro légal est déjà attribué) passe **annulée** (hors CA) avec son motif, les **droits d'auteur du livre scolaire** éventuellement calculés à sa création sont **contre-passés**, et la **commande à facturer** d'origine repasse **« à facturer »** (pour être revue ou annulée) ; le pôle Finance en est prévenu. Endpoint `POST /invoices/:id/validate-reject` (finance:administration). Tests : refus sans motif rejeté ; refus → facture annulée + commande repending + refacturation possible ; la demande d'annulation notifie bien le décideur. Suites `billing-orders` (19) et `school-royalty` (6) au vert, finance/dashboard OK.

### 31/07/2026 (suite) — Annulation de facture : validée par le DG / l'admin général, jamais par la Finance

Précision opérateur : l'annulation d'une facture **demandée par la Finance** doit être validée par le **DG ou l'administrateur général**, **pas par la Finance** (séparation des pouvoirs) — or le responsable financier détenait `finance:administration` et pouvait donc s'auto-valider. Correctif : la validation/refus d'annulation est désormais réservée à la **gouvernance**, discriminée par la permission **`pilotage:administration`** (détenue par le DG et l'administrateur général, pas par le responsable financier). Endpoints `cancel-approve` / `cancel-reject` gardés par `pilotage:administration` ; la notification « annulation à valider » part aux **décideurs de gouvernance** (DG / admin général), plus au pôle Finance ; on ne se notifie jamais soi-même. Frontend : la rubrique **« Annulations de factures à valider »** apparaît désormais sur la **page du DG (Direction générale)** — là où le DG travaille — et n'est plus affichée à la Finance (masquée si l'utilisateur n'a pas `pilotage:administration`). Composant réutilisable `InvoiceCancellationsToValidate` (chargement + actions autonomes), rendu sur la page Direction et la page Finance selon la permission. Tests : la Finance (`RESP_FINANCE`) obtient 403 sur validation/refus, le DG/admin obtient 200 ; la demande notifie bien le décideur de gouvernance. Suites `billing-orders` (20), governance/finance/dashboard/users-roles au vert.

### 31/07/2026 (suite) — Cohérence : la facture au-dessus du seuil suit la même règle (validée par le DG / l'admin, pas la Finance)

Dans la continuité de la séparation des pouvoirs sur l'annulation, la **validation par seuil** (facture au-dessus du seuil) est alignée : c'est une décision de **gouvernance**, réservée au **DG / administrateur général** (`pilotage:administration`), **pas** à la Finance qui a établi la facture. Backend : `POST /invoices/:id/validate` et `/validate-reject` gardés par `pilotage:administration` ; la cloche « facture à valider » part aux décideurs de gouvernance ; `financeAdminIds` (désormais inutile) supprimé. Frontend : la carte **« Factures à valider (au-dessus du seuil) »** (liste + Valider/Refuser + réglage du seuil) passe sous `pilotage:administration` — visible sur la **page du DG (Direction générale)** et pour l'admin, masquée à la Finance (`RESP_FINANCE`). Le prop `canAdmin` de `BillingOrdersSection` devient `canValidateThreshold`. Tests : la Finance obtient 403 sur validation/refus par seuil, le DG/admin 200. Suites `billing-orders` (21), governance, settings au vert.

### 31/07/2026 (suite) — Créer un client sans quitter le formulaire de commande

Blocage signalé : impossible d'introduire un nouveau client depuis le formulaire « Nouvelle commande » ; sans client, impossible d'établir une commande. Or le champ « Choisir un client » ne proposait aucune création, et le DG (`commercial:validation`, sans `commercial:saisie`) ne pouvait même pas créer de client via l'API. Correctif : (1) backend — la création de client (`POST /customers`) est ouverte aux **mêmes profils qui initient une commande à facturer** (commercial:saisie **ou** commercial:validation **ou** finance:saisie), plus l'admin ; (2) frontend — bouton **« + Nouveau client »** à côté du sélecteur, ouvrant un mini-formulaire (nom + catégorie) : à la création, la liste se recharge et le nouveau client est **sélectionné d'office**. Tests : le DG et le comptable peuvent créer un client (201), un magasinier non (403). Suites `billing-orders` (22), commercial, finance au vert.

### 31/07/2026 (suite) — Catalogue des manuels scolaires intégré (ouvrages sélectionnables)

Demande opérateur : intégrer la liste des manuels de la maison pour que les ouvrages soient **sélectionnés** dans la commande à facturer, sans ressaisie — on n'attribue plus que quantités/prix. Les **8 ouvrages** de la liste fournie (LATINISTAS 6ᵉ‑5ᵉ et 4ᵉ‑3ᵉ, Je découvre la langue grecque 4ᵉ‑3ᵉ, Informatique 6ᵉ/4ᵉ/3ᵉ, Au cœur des ténèbres, Stances et Poèmes suivi de Les Épreuves) sont chargés dans le seed (`prisma/seed.ts`, idempotent) : chaque ouvrage → un manuscrit (segment scolaire, back‑catalogue), ses **auteurs et co‑auteurs** (fiches Partenaire, dédupliquées), un **ISBN print** (provisoire, préfixe interne, à remplacer par l'ISBN officiel), et un **prix** courant. Le `postdeploy` relançant le seed, le catalogue sera présent en production dès le prochain déploiement. Côté formulaire de commande, le sélecteur d'ouvrage liste désormais ces titres ; à la sélection, **titre et prix unitaire se pré‑remplissent** automatiquement (modifiables) — `GET /isbns` renvoie le prix courant, le sélecteur l'exploite. Auteurs/co‑auteurs alimentent la segmentation des droits d'auteur (via l'ISBN → manuscrit). `tsc` back+front + build OK ; seed exécuté (« Catalogue scolaire : 8 ouvrages disponibles »).

### 31/07/2026 (suite) — Catalogue : matière et classe affichées à côté du titre

Sur demande de l'opérateur, chaque manuel du catalogue porte désormais sa **matière** et sa **classe** (Latin · 6ᵉ‑5ᵉ, Informatique · 3ᵉ, Littérature · Terminales…), stockées dans le **sous‑titre** du manuscrit (et en mots‑clés). `GET /isbns` renvoie le sous‑titre ; le sélecteur d'ouvrage affiche « Titre — Matière · Classe · ISBN », pour repérer l'ouvrage d'un coup d'œil. Seed idempotent (mise à jour des ouvrages existants au redéploiement). `tsc` back+front + build OK ; tests isbn/billing au vert.

### 31/07/2026 (suite) — Sélecteur d'ouvrage groupé par matière

Le menu de sélection d'ouvrage (commande à facturer) est désormais **groupé par matière** (`optgroup` : Grec, Informatique, Latin, Littérature…), la matière étant déduite du sous‑titre « Matière · Classe ». Dans chaque groupe, l'option affiche « Titre — Classe · ISBN » (la matière figurant déjà en en‑tête). Les ouvrages sans matière connue vont dans « Autres ouvrages », en dernier. Changement purement interface ; `tsc` + build OK.

### 31/07/2026 (suite) — Remise commerciale sur la facture (livre scolaire ou simple)

Sur le modèle de la facture SOCOCAM (Total → Remise % → Net à payer), l'établissement d'une facture depuis une commande à facturer propose désormais un **déroulé de remise 0–100 %** : le **net à payer se calcule immédiatement** (valeur de la remise affichée en direct). Backend : colonne `invoices.discount_pct` ; `createInvoiceRecord` stocke les totaux **nets** (HT/TVA/TTC après remise), le **brut** restant reconstituable depuis les lignes ; `createInvoiceFromBillingOrder` reçoit la remise (seuil de validation apprécié sur le net) ; l'avoir reprend la même remise. La remise **n'affecte pas les droits d'auteur** (calculés au prix plein de chaque ligne — cohérent avec le principe « une remise ne rogne pas les droits »). Route `/invoice` : paramètre `discount_pct` (0–100, borné). Frontend : sélecteur de remise par commande avec calcul en direct (remise et net à payer), transmis à l'établissement ; l'impression facture/proforma affiche **Total → Remise X % → Net à payer** quand une remise s'applique. Tests : totaux nets + ligne au brut + remise > 100 refusée ; droits d'auteur inchangés malgré remise 50 %. Suites billing-orders, school-royalty, finance au vert (53).

### 31/07/2026 (suite) — Remise disponible dès le formulaire de création de commande

À la demande de l'opérateur, le **déroulé de remise (0–100 %)** figure désormais **dans le formulaire de création** de la commande à facturer, avec calcul en direct du **net à payer** (et du montant de la remise). La remise est **enregistrée sur la commande** (`billing_orders.discount_pct`) et **reprise automatiquement** à l'établissement de la facture (toujours ajustable sur la ligne de la commande avant de facturer). Backend : colonne `discount_pct` sur `BillingOrder`, acceptée à la création, renvoyée par la vue, et utilisée par défaut à l'établissement si aucune remise n'est redéfinie. Test : commande créée avec 10 % → facture établie sans remise explicite reprend 10 % (net 180 000 sur 200 000). `tsc` back+front + build OK ; billing-orders au vert (24).

### 31/07/2026 (suite) — Audit de persistance des données + outil de diagnostic (signalement RH)

Suite au signalement « données RH non enregistrées », audit complet des chemins d'enregistrement (formulaires, client API, routes, transactions) sur l'ensemble des modules. **Constat : la couche applicative persiste correctement** — le client API lève une erreur sur toute réponse non-2xx (un échec ne peut pas passer pour un succès), les gestionnaires attendent la réponse et affichent confirmation/erreur, les créations serveur sont transactionnelles, et un rapport/dossier enregistré est bien relu au rechargement. Aucun anti-motif (appel manquant, erreur avalée, stub) ; pas de drift significatif migrations↔schéma ; le déploiement ne réinitialise pas la base. Suites d'écriture au vert (RH, rapports, paramètres…). Le symptôme (perte au rafraîchissement **et** au redéploiement, tous modules) pointe vers la **base de données / hébergement** (base non durable ou non partagée entre instances, `DATABASE_URL`, `migrate deploy` en échec). **Action : outil de diagnostic intégré** — `GET /system/diagnostic` (base connectée, migrations appliquées, **compteurs réels d'enregistrements**, identifiant d'instance) + carte « Diagnostic de persistance des données » sur la page Paramètres : l'opérateur enregistre puis rafraîchit, le compteur doit augmenter ; un identifiant d'instance changeant révèle plusieurs serveurs sans base partagée. Test dédié (le compteur augmente après une création). Rapport complet : `docs/AUDIT_PERSISTANCE_2026-07-31.md`.

### 31/07/2026 (suite) — ISBN officiels du catalogue scolaire

Les ISBN officiels fournis par la maison remplacent les ISBN provisoires dans le seed : Informatique 6ᵉ (978‑9956‑36‑265‑3), 4ᵉ (…264‑6), 3ᵉ (…269‑1) ; LATINISTAS 6ᵉ‑5ᵉ (…276‑9), 4ᵉ‑3ᵉ (…275‑2) ; Grecque 4ᵉ‑3ᵉ (…277‑6). Ajout de **LATINISTAS 2nde‑1ère‑Tle** (…274‑5, série Latin, 5000). Le seed met à jour l'ISBN existant (l'identifiant interne de la ligne ne change pas → références préservées) ; ISBN provisoire désormais dérivé du numéro de manuscrit (stable, insensible à l'ordre). « Au cœur des ténèbres » et « Stances et Poèmes » gardent un ISBN provisoire (non fournis). Seed idempotent vérifié (deux exécutions sans conflit).

### 31/07/2026 (suite) — Stabilité : plus d'écran blanc après mise à jour + moins de charge machine

Signalement : écran blanc après redéploiement (peine à charger), et machine qui rame/plante (obligés de fermer l'application). Causes traitées :
1. **Écran blanc / « obligés de fermer »** : l'application découpe ses écrans en 33 morceaux chargés à la demande, mais **aucun filet de sécurité (ErrorBoundary)** n'existait — après un redéploiement, une page ouverte réclame un morceau qui n'existe plus → **écran blanc définitif**. Ajout d'un **ErrorBoundary global** : sur une erreur de chargement de morceau, il **recharge automatiquement une fois** (en vidant les caches du service worker pour récupérer la dernière version) ; sur toute autre erreur, il affiche un **écran lisible avec bouton « Recharger »** au lieu d'une page blanche. (Les en-têtes de cache serveur étaient déjà corrects : `index.html` en `no-cache`, fichiers hachés `immutable` — le souci était bien l'absence de récupération côté client.)
2. **Charge machine** : reconnexion des sockets temps réel (messagerie, présence) **espacée jusqu'à 20 s** au lieu d'une boucle serrée quand le serveur est indisponible (ex. pendant un redéploiement) ; le **relevé des non-lus** ne sollicite plus le serveur quand l'onglet est **en arrière-plan**. `tsc` + build OK.

### 31/07/2026 (suite) — Notifications : glisser pour rabattre + allègement des écrans à images

1. **Rabattre une notification par glissement** : dans le panneau de la cloche, un glissement vers la gauche (mobile) révèle un fond « Rabattre ✕» et fait disparaître la notification (marquée lue) sans l'ouvrir. Le tap ouvre toujours la notification ; un glissement n'ouvre pas (garde-fou). Seuil 70 px, retour en place en dessous.
2. **Allègement pour les postes qui manipulent des images** (infographistes) : chargement paresseux (`loading="lazy"` + `decoding="async"`) des images de contenu (affiches d'événements en liste et en aperçu, couverture de la fiche site, codes-barres ISBN). Les images hors écran ne se téléchargent/décodent plus toutes d'un coup — défilement plus fluide et moins de mémoire sur les machines modestes. `tsc` + build OK.
