# ERP Éclosion Édition — Phase 2 : Conception de la base de données
## Modèle de données complet — Version de travail 1.0

---

## 1. Introduction et hypothèses

Ce document traduit le cahier des charges fonctionnel (chapitres 0 à 21) en un modèle de données relationnel : entités (tables), champs principaux et relations. Il servira de référence au développement (Phase 5) et à la spécification des API.

**Hypothèses de travail** (en attente des arbitrages de l'Annexe A, révisables) :
- **H1** — Organisation en 17 départements (Annexe A, point 4).
- **H2** — Comptabilité générale externe : l'ERP gère la facturation, les règlements et l'analytique, et produit des exports comptables (point 20, option B). Les tables de grand livre ne sont donc pas modélisées ; elles s'ajouteraient si l'option A était retenue.
- **H3** — Architecture compatible avec les trois options d'hébergement (point 26) : aucune dépendance à un service propriétaire dans le modèle.
- **H4** — Base relationnelle PostgreSQL ou équivalent (Ch. 21, §21.3).

## 2. Conventions générales

**Identifiants.** Chaque table possède une clé primaire technique `id` (UUID recommandé : facilite les synchronisations et le mode hors connexion futur, Ch. 21 §21.6). Les identifiants « métier » lisibles (numéro de manuscrit, numéro de facture...) sont des champs distincts, uniques, générés par des compteurs dédiés.

**Champs d'audit systématiques** (présents sur toutes les tables, non répétés dans les définitions) :
- `created_at`, `created_by` — création ;
- `updated_at`, `updated_by` — dernière modification ;
- `deleted_at`, `deleted_by` — **suppression logique uniquement** (jamais de DELETE physique : principe de traçabilité, Ch. 0 §0.3).

**Historisation.** Toute modification d'une table métier écrit une ligne dans `audit_log` (§3.6) : ancienne valeur, nouvelle valeur, auteur, horodatage. Le journal est append-only (Ch. 21, §21.4).

**Types.** `PK` clé primaire ; `FK→table` clé étrangère ; `ENUM` liste fermée gérée en table de référence ou type énuméré ; `JSONB` structure flexible (paramètres, pondérations) ; `MONEY` décimal exact (jamais de flottant pour les montants) ; montants stockés avec leur `currency` (devise ISO 4217 — multi-devises requis, Ch. 17/18).

**Nommage.** Tables au pluriel, snake_case, en anglais (standard de développement) ; le lexique §12 fait la correspondance français ↔ anglais.

---

## 3. Domaine transverse (sécurité, organisation, documents)

### 3.1 `departments` — Départements (Ch. 3)
| Champ | Type | Notes |
|---|---|---|
| id | PK | |
| code | texte unique | ex. `EDIT`, `STOCK` |
| name | texte | l'un des 17 départements (H1) |
| is_active | booléen | modules activables/désactivables (Ch. 21 §21.2) |

### 3.2 `users` — Comptes utilisateurs (Ch. 2)
| Champ | Type | Notes |
|---|---|---|
| id | PK | |
| employee_id | FK→employees | nul pour les comptes techniques ; le dossier RH est la source (Ch. 19 §19.3) |
| username, email | texte uniques | |
| password_hash | texte | jamais en clair (Ch. 21 §21.4) |
| mfa_enabled | booléen | obligatoire selon rôle |
| status | ENUM | active / suspended / disabled |
| last_login_at | horodatage | |

### 3.3 `roles`, `permissions`, `role_permissions`, `user_roles`
- `roles` : les rôles du Ch. 2 (code, libellé, department_id FK nullable).
- `permissions` : action atomique sur un module (`module`, `action` ∈ consultation / saisie / validation / administration — matrice Ch. 2 §2.3).
- `role_permissions` : table de liaison rôle ↔ permission.
- `user_roles` : liaison utilisateur ↔ rôle, avec `granted_at`, `granted_by`, `revoked_at`, `justification` (revue des habilitations, Ch. 19 §19.4).

### 3.4 `notifications` (transverse, Ch. 21 §21.8)
| Champ | Type | Notes |
|---|---|---|
| id | PK | |
| user_id | FK→users | destinataire |
| type | ENUM | affectation, échéance, validation, alerte stock... |
| priority | ENUM | low / medium / high / critical (Ch. 5 §5.6) |
| title, body | texte | |
| entity_type, entity_id | polymorphe | lien vers l'objet concerné (manuscrit, commande...) |
| channel | ENUM | in_app / email / sms |
| read_at, sent_at | horodatage | |

### 3.5 `documents` et `document_versions` — GED transverse (Ch. 4 §4.5, Ch. 21 §21.9)
`documents` : id, entity_type + entity_id (rattachement polymorphe : manuscrit, contrat, facture...), category (ENUM : manuscrit, rapport de lecture, contrat, BAT, facture, visuel...), title, confidentiality (ENUM, cf. Ch. 7 §7.9).
`document_versions` : id, document_id FK, version_number, file_path, file_size, mime_type, **sha256_hash** (empreinte — signature du BAT, Ch. 14 §14.5), status (draft / in_review / validated / archived, Ch. 10 §10.4), change_summary, uploaded_by, uploaded_at. **Aucune version n'est jamais écrasée.**

### 3.6 `audit_log` — Journal inviolable (Ch. 5 §5.8)
id, occurred_at, user_id, action (ENUM : create / update / status_change / validate / login / view_sensitive / export...), entity_type, entity_id, old_values JSONB, new_values JSONB, ip_address. **Append-only : aucune mise à jour ni suppression, contrainte appliquée en base.**

### 3.7 `settings` — Paramétrage
Clé/valeur JSONB versionné : seuils d'alerte, pondérations (indice de priorité Ch. 6 §6.5, notation Ch. 7 §7.5), seuils de délégation (Ch. 15, 17), règles du pilotage intelligent (Ch. 5 §5.9), calendriers et jours fériés par pays (Ch. 19 §19.5), taux de taxes par pays (Ch. 18 §18.9).

---

## 4. Domaine éditorial

### 4.1 `authors` — Auteurs
| Champ | Type | Notes |
|---|---|---|
| id | PK | |
| first_name, last_name | texte | |
| pen_name | texte | nom de plume |
| email, phone, address | texte | |
| bio | texte | pour la quatrième et les métadonnées (Ch. 12, 13) |
| tax_status | JSONB | retenues applicables aux droits (Ch. 18 §18.7) |

Une table `work_contributors` (voir §4.2) porte les rôles multiples (co-auteurs, traducteur, illustrateur, préfacier — Ch. 13 §13.6).

### 4.2 `manuscripts` — Manuscrits / projets éditoriaux (Ch. 6)
Entité centrale du système. Le « manuscrit » et le « projet éditorial » (Ch. 8 §8.3) sont **une même ligne** dont le cycle de vie est porté par le statut — évite les doublons de données.

| Champ | Type | Notes |
|---|---|---|
| id | PK | |
| manuscript_number | texte unique | numéro généré (Ch. 6 §6.2) |
| title, subtitle | texte | |
| collection_id | FK→collections | |
| genre_id | FK→genres | domaine (roman, essai...) |
| language | code ISO | |
| estimated_pages | entier | l'écart avec le réel vient de la maquette (Ch. 11 §11.5) |
| summary | texte | |
| keywords | tableau | |
| origin | ENUM | soumission / commande (Ch. 6 §6.4) |
| status | FK→workflow_statuses | statut courant (Ch. 6 §6.6) |
| priority_score | décimal | indice calculé (Ch. 6 §6.5) |
| priority_override | décimal + justification | ajustement manuel tracé |
| owner_id | FK→users | responsable du dossier |
| project_manager_id | FK→users | chef de projet (après acceptation) |
| received_at | date | |
| requires_expertise | booléen | active l'étape 8 (Ch. 4) |

`work_contributors` : manuscript_id, author_id, role (ENUM : author / co_author / translator / illustrator / preface), display_order.
`collections`, `genres` : référentiels (code, libellé, gabarit par défaut FK→layout_templates, charte FK→graphic_charters).

### 4.3 Workflow (Ch. 4)
- `workflow_statuses` : référentiel des ~20 étapes (code, libellé, ordre, département responsable FK, is_conditional).
- `manuscript_steps` : **une ligne par étape franchie ou planifiée** par manuscrit — manuscript_id, status_id, responsible_id, planned_start, planned_end, actual_start, actual_end, validation_by, validated_at, observations. Le retard = actual/now vs planned (Ch. 4 §4.4). C'est la source de la frise chronologique et du Gantt.
- `step_transitions` : journal des transmissions inter-départements (from_status, to_status, from_dept, to_dept, responsible, occurred_at, observations — Ch. 3 §3.4).

### 4.4 Comité de lecture (Ch. 7)
- `reading_assignments` : manuscript_id, reader_id FK→users, assigned_at, due_at, submitted_at, status, extension_reason.
- `evaluation_criteria` : référentiel des critères de la grille (libellé, coefficient, is_active — pondération Ch. 7 §7.5).
- `evaluations` : assignment_id, overall_comment, recommendation (ENUM : accept / accept_minor / accept_major / rewrite / new_expertise / reject), global_score (calculé), rating (ENUM : excellent...refused).
- `evaluation_scores` : evaluation_id, criterion_id, score, comment — le détail note par critère.
- La décision éditoriale (Ch. 8 §8.2) est portée par `editorial_decisions` : manuscript_id, decision, decided_by, decided_at, motivation, score_gap_flag (écart entre lecteurs signalé).

### 4.5 Tâches et production éditoriale (Ch. 8, 10, 11, 12)
- `tasks` : manuscript_id, step_id FK→manuscript_steps, title, type (ENUM : correction_ortho, correction_gramm, layout, cover, illustration, expertise, rewrite...), assignee_id, priority, planned_start/end, actual_start/end, progress_pct, status (Ch. 8 §8.6), depends_on_task_id FK auto-référente (**dépendances du Gantt**, Ch. 8 §8.7).
- `task_comments` : observations datées et signées, liées à la version concernée (Ch. 10 §10.6-10.7), is_blocking booléen.
- Les versions de manuscrit et d'épreuves sont portées par la GED (§3.5) rattachée au manuscrit ; les rapports du comparateur de versions (Ch. 10 §10.5) sont des documents de catégorie dédiée.

### 4.6 Maquette et infographie (Ch. 11, 12)
- `layout_templates` : bibliothèque de gabarits (Ch. 11 §11.3) — nom, collection_id, format (dimensions), specs JSONB (marges, polices, styles).
- `graphic_charters` : chartes (Ch. 12 §12.4) — périmètre (maison / collection), fichiers via GED.
- `production_specs` : une ligne par manuscrit — trim_format, final_pages (réel, Ch. 11 §11.5), paper_interior, paper_cover, binding, lamination, spine_width_mm (calculé, Ch. 12 §12.3), spine_needs_recalc booléen (alerte).
- `image_assets` : visuels (illustrations, couverture, promo) — manuscript_id, type, placement, resolution_dpi, color_mode, technical_ok booléen (contrôle au dépôt, Ch. 12 §12.5), **rights_origin, rights_license, rights_credit** (droits iconographiques bloquants), document_id FK→GED.
- `checklists` / `checklist_items` : listes de contrôle paramétrables (éléments structurels Ch. 11 §11.6 ; BAT Ch. 14 §14.3 ; complétude ISBN Ch. 13 §13.9) — chaque item : libellé, is_blocking, checked_by, checked_at, observation.

### 4.7 BAT (Ch. 14)
- `bat_records` : manuscript_id, cycle_number, opened_at, status (in_control / corrections_requested / awaiting_signature / signed / cancelled), interior_version_id + cover_version_id FK→document_versions (**fichiers exacts, via leur hash**), technical_sheet JSONB.
- `bat_anomalies` : bat_id, description, location, severity (minor / major / blocking), returned_to (layout / graphics), resolved_at.
- `bat_signatures` : bat_id, signer_id, signed_at, files_hash, author_approval booléen + référence (BAT auteur, point 12 Annexe A). **La signature verrouille les versions référencées.**

---

## 5. Domaine juridique (Ch. 9)

### 5.1 `contracts`
| Champ | Type | Notes |
|---|---|---|
| id | PK | |
| contract_number | texte unique | |
| type | ENUM | édition / coédition / traduction / illustration / correction / prestation / cession / avenant (parent_contract_id FK pour les avenants) |
| manuscript_id | FK, nullable | |
| counterparty_type + id | polymorphe | auteur, prestataire, employé externe |
| signed_at, effective_at, duration | | |
| territories, languages, formats | tableaux | droits cédés |
| financial_terms | JSONB | assiette (point 19 Annexe A), taux, paliers, avance |
| status | ENUM | preparation / legal_review / direction_approval / awaiting_signature / active / expired / terminated (circuit Ch. 9 §9.8) |

### 5.2 Droits d'auteur
- `royalty_terms` : contract_id, base (ENUM : prix public HT / prix net), tiers JSONB (paliers : jusqu'à N exemplaires → X %), advance_amount, payment_schedule.
- `royalty_entries` : **une ligne par mouvement générateur** — contract_id, source (sale_line_id ou return_line_id FK), quantity, unit_base_amount, rate_applied, amount (positif ou négatif pour les retours, Ch. 16 §16.7), computed_at. C'est le moteur du Ch. 9 §9.5 : tout est recalculable et traçable ligne à ligne.
- `royalty_statements` : relevés générés — contract_id, period_start/end, total_earned, advance_recouped, balance_due, status (draft / issued / paid), document_id (PDF archivé).
- `royalty_payments` : statement_id, paid_at, amount, tax_withheld, payment_id FK→payments (exécution financière, Ch. 18 §18.7).

---

## 6. Domaine références (Ch. 13)

- `isbn_pool` : tranches reçues — prefix, range_start, range_end, received_at ; vue calculée du stock disponible avec seuil d'alerte (§13.2).
- `isbns` : isbn13 unique, manuscript_id, format (ENUM : print / epub / pdf / audio — un ISBN par manifestation), status (available / reserved / assigned / published), assigned_at, assigned_by, barcode_file FK→GED (EAN généré, §13.4). *Jamais réutilisé : contrainte d'unicité + interdiction de réaffectation.*
- `legal_deposits` : manuscript_id, country, depository, copies_required, due_date, deposited_at, receipt_document_id, deposit_number (propagé à la page de copyright, §13.5). Paramétrable par pays (H3, ambition régionale).
- `work_metadata` : fiche complète par ouvrage (§13.6) — champs descriptifs, physiques (weight_grams → frais de port Ch. 17), commerciaux ; thema_codes tableau (classification §13.7) ; **versionnée** pour tracer les rediffusions.
- `metadata_exports` : journal des diffusions (§13.8) — partner_id, format (onix30 / csv), metadata_version, sent_at ; needs_resend calculé quand la fiche change.

---

## 7. Domaine fabrication (Ch. 15)

- `printers` : fiche imprimeur — coordonnées, specialties, payment_terms ; les indicateurs d'évaluation (§15.2) sont **calculés** depuis les commandes et non stockés (délais tenus, taux de non-conformité, compétitivité).
- `print_quotes` : consultation — manuscript_id, printer_id, quantities JSONB (hypothèses multiples : 500/1000/2000, §15.3), amounts JSONB, lead_time_days, valid_until, status (requested / received / selected / declined), selection_motive.
- `purchase_orders` : quote_id, po_number unique, amount, currency, delivery_due, delivery_location_id FK→stock_locations, quantity_tolerance_pct (point 23 Annexe A), status, approved_by (seuils de délégation), files_hash_reference (fichiers du BAT signé transmis, §15.5). L'émission **engage** le montant en analytique (§9.3 ci-dessous).
- `production_milestones` : po_id, milestone (files_received / setup / printing / finishing / shipped / delivered), planned_at, actual_at (§15.6).
- `goods_receipts` : po_id, received_at, quantities par référence, variance (rapproché de la tolérance), qc_verdict (conform / with_reserves / non_conform, Ch. 14 §14.7), qc_report_id.
- `supplier_claims` : receipt_id, description, photos via GED, resolution, resolved_at (§14.7).
- Réimpressions (§15.8) : nouvelle purchase_order rattachée au même manuscrit, reprint_number incrémenté, mini-BAT référencé.

---

## 8. Domaine stock (Ch. 16)

- `stock_locations` : lieux (magasin, dépôt, **dépôt-vente chez client** : client_id FK nullable) et emplacements internes (parent_id auto-référent : zone > allée > étagère, §16.2).
- `stock_items` : le stock par (isbn_id, location_id, print_run) — quantity_physical, quantity_reserved ; disponible = calculé (§16.5) ; unit_cost (valorisation au coût de fabrication par tirage, §16.9) ; alert_threshold, out_of_stock_threshold.
- `stock_movements` : **table pivot, une ligne par mouvement** — type (ENUM : production_in / sale_out / consignment_out / consignment_return / customer_return / transfer / press_copy / author_copy / pulping / inventory_adjustment), isbn_id, from_location_id, to_location_id, quantity, print_run, reason, reference polymorphe (order_id, receipt_id...), status (pending / in_transit / completed), moved_by, moved_at. *Aucun mouvement sans type, motif et responsable (§16.4). Le stock courant est la somme des mouvements — vérifiable à tout instant.*
- `inventories` / `inventory_lines` : campagnes (full / rotating, §16.8) — location scope, blind booléen ; lignes : isbn_id, counted_qty, theoretical_qty (figée au lancement), variance, recount_required, adjustment_movement_id FK (régularisation tracée et validée).

---

## 9. Domaines commercial et finance (Ch. 17, 18)

### 9.1 Clients et conditions
- `customers` : catégorie (ENUM : bookstore / distributor / institution / individual / platform, §17.3), coordonnées, relation_mode (firm / consignment), payment_terms, credit_limit (plafond d'encours), tax_id.
- `discount_grids` / `customer_discounts` : grilles par catégorie, remises spécifiques avec validité, remises promotionnelles bornées ; approval_required au-delà des seuils (§17.4).
- `price_list` : isbn_id, country, currency, price, effective_from — historisation native des changements de prix (§17.2).

### 9.2 Commandes et ventes
- `sales_orders` : customer_id, order_number, channel (rep / phone / fair / online / counter), status (draft / blocked_credit / confirmed / preparing / shipped / delivered / invoiced), block_reason, approved_by.
- `sales_order_lines` : order_id, isbn_id, quantity, unit_price, discount_pct, tax_rate — la confirmation crée la réservation de stock (§17.5).
- `deliveries` / `delivery_lines` : bons de livraison, transporteur, rapprochés des mouvements de stock (§16.6) ; reliquats gérés par livraisons multiples.
- `consignments` / `consignment_statements` : dépôts-ventes (§17.6) — stock déposé par client ; relevés périodiques (période, lignes vendues) dont la validation **génère la facture et les royalty_entries** ; relances si relevé en retard.
- `pos_sales` : ventes au comptoir et salons (§17.7) — lignes, mode d'encaissement (cash / card / **mobile_money**), event_id éventuel.
- `customer_returns` / `return_lines` : autorisation, réception, verdict par exemplaire (resaleable / damaged / pulp), lien facture d'origine → avoir + royalties négatives (§17.9).

### 9.3 Finance (H2 : analytique + facturation, export comptable)
- `invoices` / `invoice_lines` : numérotation continue infalsifiable (séquence dédiée, §18.2), type (invoice / credit_note, parent_invoice_id pour les avoirs), source polymorphe (delivery, consignment_statement, pos_sale), totaux HT/taxes/TTC, currency, due_date, status. **Jamais modifiée après émission.**
- `payments` : direction (in / out), method (transfer / cheque / cash / mobile_money), amount, received_at, bank_account_id.
- `payment_allocations` : lettrage paiement ↔ factures (total, partiel, acompte, §18.3).
- `expenses` : dépenses hors commandes d'impression — category, amount, status du circuit de validation, supplier, manuscript_id nullable (imputation analytique).
- `cost_entries` : **la comptabilité analytique par ouvrage** (§18.5) — manuscript_id, cost_type (ENUM : advance / royalties / editorial_services / manufacturing / promotion / overhead_allocation), source polymorphe (po, expense, royalty_statement), amount, committed/actual. Marge, point d'équilibre et taux de couverture = vues calculées croisant cost_entries et ventes nettes.
- `budgets` / `budget_lines` : par ouvrage et par département, engagé/réalisé vs prévu, alertes de dépassement (§18.6).
- `bank_accounts` / `bank_statements` / `statement_lines` : rapprochement bancaire assisté (§18.8) ; comptes de mobile money inclus.
- `tax_rates` : par pays et type de produit (§18.9).
- `accounting_exports` : lots d'export (période, format cible, lignes générées, checksum d'exhaustivité — §18.10 option B). Une période clôturée (`accounting_periods`) n'accepte plus d'écriture (§18.11).

---

## 10. Domaine RH (Ch. 19)

- `employees` : dossier individuel — statut (employee / contractor / intern / volunteer), poste, department_id, manager_id, dates d'entrée/sortie (la sortie **désactive le compte user à date**, §19.3). Données confidentielles (rémunération) dans une table séparée `employee_confidential` à accès restreint et consultations journalisées.
- `hr_contracts` : contrats de travail ou lien vers contracts (prestataires, Ch. 9) — type, dates, renouvellements, alertes d'échéance.
- `absences` : type (leave / sick / mission), circuit demandeur → responsable, soldes ; alimente la disponibilité du Gantt (§19.5).
- `skills` / `employee_skills` : cartographie (langues, logiciels, genres, habilitations internes §19.8).
- `payroll_variables` : variables de paie par période (présences, primes, missions prestataires à régler) — export vers la paie externe (§19.7).
- `access_reviews` / `access_review_items` : campagnes de revue des habilitations (§19.4) — chaque responsable confirme ou signale les accès de son équipe.

---

## 11. Domaine pilotage (Ch. 5, 20)

- `kpi_definitions` : **dictionnaire des indicateurs** (§20.2) — code, libellé, définition, formule documentée, version.
- `reports` : catalogue (propriétaire, description, paramètres JSONB, schedule cron, destinataires) ; `report_runs` : journal des générations et envois (§20.7).
- `saved_analyses` : analyses de l'explorateur (§20.4) — définition JSONB, owner, partages.
- `smart_rules` : règles du pilotage intelligent (Ch. 5 §5.9, §20.6) — condition paramétrée, message type, priorité.
- `recommendations` : instances générées — rule_id, entity concernée, message, priority, status (open / treated / ignored / postponed), treated_by, treated_at. Historique conservé pour évaluer la pertinence des règles.

---

## 12. Relations structurantes (synthèse)

```
authors ──< work_contributors >── manuscripts ──< manuscript_steps >── workflow_statuses
manuscripts ──< reading_assignments ──< evaluations ──< evaluation_scores
manuscripts ──< tasks (depends_on ↺)          manuscripts ──1 production_specs
manuscripts ──< documents ──< document_versions (hash)
manuscripts ──< contracts ──1 royalty_terms ──< royalty_entries >── sales/returns
contracts ──< royalty_statements ──< royalty_payments >── payments
manuscripts ──< isbns ──< price_list / stock_items / order_lines
isbn_pool ──< isbns          manuscripts ──< legal_deposits / work_metadata
manuscripts ──< print_quotes ──1 purchase_orders ──< milestones / goods_receipts ──< claims
purchase_orders ──> cost_entries <── expenses / royalty_statements   (analytique par ouvrage)
stock_locations ──< stock_items <── stock_movements >── (receipts, deliveries, returns, inventories)
customers ──< sales_orders ──< lines ──< deliveries ──> invoices ──< payment_allocations >── payments
customers ──< consignments ──< consignment_statements ──> invoices + royalty_entries
employees ──1 users ──< user_roles >── roles ──< role_permissions >── permissions
(toutes tables) ──> audit_log (append-only)
```

## 13. Contraintes d'intégrité clés

1. **Transactions atomiques** (Ch. 21 §21.3) : vente = réservation stock + ligne de commande ; livraison = mouvement + facture + royalty_entries — tout ou rien.
2. **Un ISBN n'est jamais réaffecté** (contrainte applicative + unicité).
3. **Une facture émise est immuable** ; correction = avoir référençant la facture d'origine.
4. **Le stock courant est reconstructible** par somme des mouvements — contrôle de cohérence périodique automatique.
5. **audit_log et document_versions sont append-only** (droits base de données, pas seulement applicatifs).
6. **Signature de BAT** : les document_versions référencées passent en statut verrouillé ; toute nouvelle version exige l'annulation du BAT.
7. **Séquences légales** (numéros de factures) : continues, sans trou, par exercice.

## 14. Prochaines étapes

1. Arbitrage des points structurants de l'Annexe A (4, 20, 26) et ajustement du modèle.
2. **Dictionnaire de données détaillé** : tous les champs de toutes les tables avec types précis, contraintes et valeurs par défaut (document de niveau développement).
3. Schéma physique : index, partitionnement éventuel des tables volumineuses (movements, audit_log, royalty_entries).
4. Spécification des API par domaine.
5. Puis Phase 3 : maquettes UI/UX, appuyées sur ce modèle.
