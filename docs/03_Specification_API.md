# ERP Éclosion Édition — Phase 2 (suite) : Spécification des API
## Version de travail 1.0

---

## 1. Objet et principes

Ce document spécifie l'API interne de l'ERP (exigence du Ch. 21, §21.2) : toutes les fonctions de l'application passent par cette API — l'interface web n'est qu'un client parmi d'autres possibles (future application partenaire, site de vente, imports diffuseurs). Elle s'appuie directement sur le modèle de données de la Phase 2.

**Principes :**
- **REST/JSON** sur HTTPS exclusivement ; verbes standards (GET lire, POST créer, PATCH modifier, jamais de DELETE physique — suppression logique via PATCH de statut).
- **Authentification par jeton** de session à durée limitée ; 2FA au login pour les rôles sensibles (Ch. 21 §21.4).
- **Autorisation côté serveur à chaque appel** : la matrice rôles/permissions (Ch. 2) est évaluée par l'API, jamais par le client seul.
- **Toute écriture est journalisée** dans audit_log avec l'identité du jeton appelant.
- **Idempotence des écritures critiques** (paiements, mouvements de stock) via une clé d'idempotence fournie par le client — indispensable pour la tolérance aux coupures (Ch. 21 §21.6) : rejouer une requête interrompue ne crée pas de doublon.
- **Pagination systématique** des listes ; filtres et tri en paramètres ; réponses d'erreur normalisées (code, message lisible, détails de validation champ par champ).
- **Versionnage d'API** (`/api/v1/...`) pour permettre les évolutions sans casser les clients.

Convention des exemples : `{id}` est un UUID ; corps et réponses en JSON ; seuls les champs significatifs sont montrés.

---

## 2. Transverse

### 2.1 Authentification et session
```
POST /api/v1/auth/login          {username, password} → jeton (ou défi 2FA)
POST /api/v1/auth/2fa            {challenge_id, code} → jeton
POST /api/v1/auth/logout
GET  /api/v1/me                  → profil, rôles, permissions effectives
```
La réponse de `/me` pilote l'interface : menus et actions affichés = permissions retournées.

### 2.2 Notifications
```
GET   /api/v1/notifications?unread=true&priority=high
PATCH /api/v1/notifications/{id}         {read: true}
GET   /api/v1/notifications/preferences  / PATCH ...   (par type d'événement, Ch. 21 §21.8)
```

### 2.3 Documents (GED transverse, Ch. 4 §4.5)
```
POST /api/v1/documents                    {entity_type, entity_id, category, title, confidentiality}
POST /api/v1/documents/{id}/versions      (multipart : fichier + change_summary) → version, sha256
GET  /api/v1/documents/{id}/versions
GET  /api/v1/document-versions/{id}/download
POST /api/v1/document-versions/compare    {left_id, right_id} → rapport de comparaison (Ch. 10 §10.5)
```
Le dépôt d'une version ne remplace jamais la précédente ; le hash est calculé côté serveur et retourné.

### 2.4 Recherche globale (Ch. 5 §5.4)
```
GET /api/v1/search?q=...&types=manuscript,author,isbn,contract
```
Résultats filtrés selon les droits de l'appelant.

---

## 3. Domaine éditorial

### 3.1 Manuscrits (Ch. 6)
```
POST  /api/v1/manuscripts                      → création, manuscript_number généré
GET   /api/v1/manuscripts?status=&collection=&priority_min=&sort=priority
GET   /api/v1/manuscripts/{id}                 → fiche complète (+ liens : steps, documents, tasks)
PATCH /api/v1/manuscripts/{id}
GET   /api/v1/manuscripts/{id}/timeline        → frise chronologique (Ch. 4 §4.4)
POST  /api/v1/manuscripts/{id}/priority-override   {score, justification}   (Ch. 6 §6.5)
```

### 3.2 Workflow (Ch. 4)
```
POST /api/v1/manuscripts/{id}/steps/{step}/validate   {observations}
```
Règles appliquées par l'API : validation possible uniquement par un rôle habilité ; étape précédente validée ; checklists bloquantes complètes (Ch. 11 §11.6, 13 §13.9, 14 §14.3). Sinon → erreur 409 avec la liste des conditions manquantes. La validation crée la transition, notifie le service suivant, met à jour statut et Gantt — **en une transaction**.

### 3.3 Comité de lecture (Ch. 7)
```
POST  /api/v1/manuscripts/{id}/reading-assignments   {reader_id, due_at}
GET   /api/v1/reading-assignments?reader=me&status=pending
POST  /api/v1/reading-assignments/{id}/evaluation    {scores[], overall_comment, recommendation}
      → global_score et rating calculés serveur (pondérations en settings)
POST  /api/v1/manuscripts/{id}/editorial-decision    {decision, motivation}   (Ch. 8 §8.2)
```

### 3.4 Tâches et Gantt (Ch. 8)
```
GET   /api/v1/tasks?assignee=me&status=in_progress
POST  /api/v1/manuscripts/{id}/tasks
PATCH /api/v1/tasks/{id}                {progress_pct, status, planned_end}
GET   /api/v1/gantt?view=portfolio&collection=&manager=     → structure projets/tâches/dépendances
PATCH /api/v1/tasks/{id}/reschedule     {planned_start, planned_end, justification}
      → recalcul des tâches dépendantes, liste des conflits retournée (Ch. 8 §8.7)
```

### 3.5 Production graphique et BAT (Ch. 11, 12, 14)
```
GET/PATCH /api/v1/manuscripts/{id}/production-specs      (final_pages, papiers → recalcul spine_width, alerte §12.3)
POST /api/v1/manuscripts/{id}/image-assets               (contrôle technique auto : dpi, colorimétrie, droits)
POST /api/v1/manuscripts/{id}/bat                        → ouverture si conditions réunies (§14.2)
POST /api/v1/bat/{id}/anomalies                          {description, severity, returned_to}
POST /api/v1/bat/{id}/sign                               {author_approval?} → hash des fichiers figé, versions verrouillées, notification impression
POST /api/v1/bat/{id}/cancel                             {motivation} → déverrouillage tracé, alerte direction
```

---

## 4. Domaine juridique (Ch. 9)

```
POST  /api/v1/contracts                  {type, manuscript_id, counterparty, financial_terms}
PATCH /api/v1/contracts/{id}/status      (circuit : preparation → legal_review → approval → signature → active)
GET   /api/v1/contracts?expiring_before=2026-12-31
GET   /api/v1/contracts/{id}/royalties/ledger        → royalty_entries ligne à ligne (auditabilité §9.5)
POST  /api/v1/contracts/{id}/royalties/statements    {period_start, period_end} → relevé PDF + solde d'avance
GET   /api/v1/authors/{id}/royalties/summary         → tous contrats, gagné / payé / à payer
```
Les `royalty_entries` ne sont **jamais créées par appel direct** : elles sont générées par les événements de vente et de retour (§6). Toute consultation du domaine est journalisée (§9.11).

---

## 5. Domaine références (Ch. 13)

```
GET  /api/v1/isbn/pool                       → stock disponible, seuil d'alerte
POST /api/v1/manuscripts/{id}/isbn           {format} → attribution du prochain disponible, clé vérifiée, code-barres généré
GET  /api/v1/isbns/{isbn13}                  → ouvrage, format, statut
POST /api/v1/manuscripts/{id}/legal-deposit  {country} → fiche, documents, échéance
GET/PATCH /api/v1/manuscripts/{id}/metadata  → fiche versionnée
POST /api/v1/metadata/exports                {partner_id, format: onix30|csv, manuscript_ids[]}
GET  /api/v1/metadata/exports?needs_resend=true
```

---

## 6. Domaines fabrication, stock, commercial

### 6.1 Fabrication (Ch. 15)
```
POST /api/v1/manuscripts/{id}/print-quotes      {printer_ids[], quantities[]} → consultation
POST /api/v1/print-quotes/{id}/select           {motivation} → contrôle du seuil de délégation
POST /api/v1/print-quotes/{id}/purchase-order   → PO générée, montant engagé en analytique
PATCH /api/v1/purchase-orders/{id}/milestones/{m}   {actual_at}
POST /api/v1/purchase-orders/{id}/receipts      {lines[]} → écart vs tolérance, déclenche le contrôle qualité
GET  /api/v1/printers/{id}/scorecard            → évaluation calculée (§15.2)
```

### 6.2 Stock (Ch. 16)
```
GET  /api/v1/stock?isbn=&location=              → physique / réservé / disponible / dépôt-vente / transit
POST /api/v1/stock/movements                    {type, isbn_id, from, to, quantity, reason, reference, idempotency_key}
GET  /api/v1/stock/movements?isbn=&period=
POST /api/v1/inventories                        {scope, mode: full|rotating, blind: true}
POST /api/v1/inventories/{id}/lines/{line}/count    {counted_qty}   (saisie par scan)
POST /api/v1/inventories/{id}/close             → écarts, régularisations à valider
GET  /api/v1/stock/alerts                       → sous seuil, ruptures, projections (pilotage)
```
Le scan smartphone appelle `GET /api/v1/isbns/{ean}` puis poste le mouvement — deux appels légers, adaptés à la bande passante (Ch. 21 §21.6).

### 6.3 Commercial (Ch. 17)
```
POST /api/v1/customers                          {category, relation_mode, credit_limit, ...}
POST /api/v1/sales-orders                       {customer_id, lines[]} → prix et remises appliqués serveur,
                                                  contrôle stock + encours ; statut blocked_credit si dépassement
POST /api/v1/sales-orders/{id}/approve          (déblocage par rôle habilité)
POST /api/v1/sales-orders/{id}/deliveries       → bon de préparation magasin, réservation → sortie
POST /api/v1/consignments                       {customer_id, lines[]}
POST /api/v1/consignments/{id}/statements       {period, sold_lines[]} → facture + royalty_entries en une transaction
POST /api/v1/pos-sales                          {lines[], payment_method, idempotency_key}   (comptoir/salon)
POST /api/v1/customer-returns                   {origin_invoice_id, lines[]} → verdicts, avoir, royalties négatives
GET  /api/v1/sales/analytics?group_by=title|collection|channel&period=
```

### 6.4 Finance (Ch. 18)
```
GET  /api/v1/invoices?status=unpaid&customer=          (les factures naissent des événements, pas d'un POST direct,
                                                        sauf cas manuels autorisés)
POST /api/v1/payments                    {direction, method, amount, allocations[], idempotency_key}
GET  /api/v1/customers/{id}/aging        → balance âgée
POST /api/v1/dunning/{customer_id}/next  → relance graduée suivante, tracée
POST /api/v1/expenses                    {category, amount, manuscript_id?} → circuit de validation
GET  /api/v1/manuscripts/{id}/profitability   → coûts, ventes nettes, marge, point d'équilibre (§18.5)
GET  /api/v1/treasury/forecast?horizon=90d
POST /api/v1/accounting/exports          {period, format} → lot + checksum d'exhaustivité (§18.10)
POST /api/v1/accounting/periods/{p}/close    → la période n'accepte plus d'écriture
```

---

## 7. Domaines RH et pilotage

### 7.1 RH (Ch. 19)
```
POST  /api/v1/employees                  → crée dossier + compte utilisateur avec rôle du poste (§19.3)
PATCH /api/v1/employees/{id}/departure   {date} → désactivation du compte programmée à date
POST  /api/v1/absences                   {type, from, to} → circuit de validation
GET   /api/v1/availability?department=&period=      → alimente Gantt et affectations
POST  /api/v1/access-reviews             → lance une campagne ; GET .../items?reviewer=me
GET   /api/v1/workload?department=&person=
```
Les données confidentielles (`employee_confidential`) ont leurs propres routes à autorisation renforcée et consultation journalisée.

### 7.2 Tableaux de bord et rapports (Ch. 5, 20)
```
GET  /api/v1/dashboards/{department}         → indicateurs du module (définis au dictionnaire KPI)
GET  /api/v1/dashboards/direction            → vue consolidée (Ch. 5 §5.3), filtrée par droits
GET  /api/v1/kpi/{code}?period=&group_by=    → tout indicateur du dictionnaire, définition jointe
GET  /api/v1/reports                         → catalogue ; POST /api/v1/reports/{id}/run {params} → génération en tâche de fond,
                                               notification à disponibilité (Ch. 21 §21.10)
POST /api/v1/analyses                        → explorateur : enregistrer/partager une analyse (§20.4)
GET  /api/v1/recommendations?status=open&priority=critical
PATCH /api/v1/recommendations/{id}           {status: treated|ignored|postponed}   (Ch. 5 §5.9)
POST /api/v1/simulations/print-run           {manuscript_id, quantities[]} → comparatif coût/écoulement (§20.6)
```

---

## 8. Règles transversales de l'API

1. **Les événements métier créent les données dérivées, jamais le client.** Une livraison crée la facture ; un relevé de dépôt crée les royalties ; un BAT signé notifie l'impression. Le client déclenche l'événement, le serveur orchestre la transaction complète (Ch. 21 §21.3).
2. **Erreurs 409 explicites** : quand une règle métier bloque (étape non validée, encours dépassé, checklist incomplète, période close), la réponse liste précisément les conditions manquantes — l'interface peut les afficher telles quelles.
3. **Exports lourds asynchrones** : toute génération > 2 s passe en tâche de fond avec notification (Ch. 21 §21.10).
4. **Limites de débit** par jeton, journalisation des accès anormaux.
5. **Documentation vivante** : spécification OpenAPI générée depuis le code et publiée en interne — condition d'indépendance vis-à-vis d'un prestataire (Ch. 0 §0.4).

## 9. Prochaines étapes

1. Dictionnaire de données détaillé, produit **domaine par domaine** au rythme des sprints de développement (le présent document et le modèle de données en sont la source).
2. Schéma physique (index, partitionnement de movements / audit_log / royalty_entries).
3. **Phase 3 : maquettes UI/UX**, chaque écran s'appuyant sur les routes spécifiées ici.
