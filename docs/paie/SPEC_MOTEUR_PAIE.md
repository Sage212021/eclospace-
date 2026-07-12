# Moteur de paie Éclosion — spécification (source : classeur Excel V26)

> Fichiers source archivés dans ce dossier :
> - `Moteur_Paie_Eclosion_V26_MAJ10.xlsm` — le moteur (feuilles + formules Excel).
> - `Module_Paie_Eclosion.bas` — macros VBA (édition PDF, envoi e-mail, clôture mensuelle).
>
> Ce document extrait la logique métier du classeur pour permettre sa
> **réimplémentation native** dans l'ERP (Node/TypeScript). Le classeur Excel ne
> peut pas s'exécuter dans une application web ; il fait ici **office de
> spécification de référence**. Toute valeur/barème ci-dessous est **paramétrable
> et versionné par date d'effet** (comme dans le classeur).

## 1. Feuilles du classeur

Accueil · Tableau de bord · **Paramètres** · **Employés** · **Retenues internes** ·
**Livre de paie** · **Bulletin** · **Journal de paie** · Déclarations CNPS ·
Déclarations fiscales · Guide Développeur.

## 2. Paramètres (feuille « Paramètres ») — tous versionnés par date d'effet

Taux actifs sélectionnés par `LOOKUP` sur la version la plus récente ≤ période.

| Code | Libellé |
|---|---|
| VID_SAL / VID_PAT | CNPS – PVID (pension) part salariale / patronale |
| PF | CNPS – Prestations familiales (patronale) |
| AT | CNPS – Accidents du travail (patronale) |
| PLAFOND | Plafond mensuel assiette CNPS (FCFA) |
| ABAT_PCT / ABAT_FIXE | Abattement IRPP : % frais pro + forfait annuel |
| CAC | Centimes Additionnels Communaux (% de l'IRPP) |
| CFC_SAL / CFC_PAT | Crédit Foncier du Cameroun part sal. / pat. |
| FNE | Fonds National de l'Emploi (patronale) |
| COEF | Coefficient assiette CNPS ÷ assiette fiscale |
| HEURES | Durée mensuelle légale (heures) |
| ANC_DEF | Taux prime d'ancienneté par défaut |

**Barème IRPP** (annuel par part fiscale, versionné) — ex. version 2019-01-01 :
tranche 1 ≤ 2 000 000 @ 10 % · T2 ≤ 3 000 000 @ 15 % · T3 ≤ 5 000 000 @ 25 % ·
T4 (au-delà) @ 35 %. **CAC** appliqué en % de l'IRPP.

**Barème TC / RAV** (Taxe Communale / Redevance Audiovisuelle, tranches sur brut
mensuel, versionné) — ex. version 2019-01-01 : seuil 110 000 (TC 0 / RAV 1 950),
seuil 200 000 (TC 500 / RAV 1 950), tranche 3 (TC 750 / RAV 3 250).

## 3. Fiche employé (feuille « Employés »)

Matricule, Nom & Prénom, Département, Catégorie/Échelon, Date d'entrée/sortie,
N° CNPS, Email, **Salaire brut contractuel**, % salaire de base, Salaire de base,
Compléments, **Assiette fiscale**, Statut (Actif/…), Banque/Mode de paiement,
N° compte, **Parts fiscales**, Ancienneté (ans), Taux prime anc. individuel,
Seuil anc., Appliquer prime anc. ? (Oui/Non), Appliquer parts fiscales ? (Oui/Non),
état civil (naissance, sexe, situation familiale, enfants), N° CNI, **NIU**,
téléphone, adresse, solde congés, etc.

## 4. Livre de paie — colonnes calculées (une ligne par salarié / période)

A Matricule · B Nom · C Département · **D Salaire de base** · E Compléments ·
F Prime ancienneté · G Retenue absence · **H SALAIRE BRUT** · I Assiette fiscale ·
J Assiette CNPS plafonnée · **K PVID salarié** · L PVID patronal ·
M Prest. familiales · N Accidents travail · O CFC salarié · P CFC patronal ·
Q FNE patronal · R Taxe communale · S RAV · T Base IRPP annuelle/part ·
**U IRPP + CAC** · V Avance · W Remb. prêt · X Retard · Y Autres retenues ·
Z Total retenues internes · **AA TOTAL RETENUES SALARIALES** ·
AB TOTAL CHARGES PATRONALES · **AC NET À PAYER** · **AD COÛT EMPLOYEUR**.

Enchaînement de calcul :
1. Brut = base + compléments + prime ancienneté − retenue absence.
2. Assiette CNPS plafonnée = min(brut ajusté, PLAFOND) ; PVID/PF/AT dessus.
3. Assiette fiscale ; IRPP annuel/part via barème progressif après abattements ;
   + CAC (% IRPP) ; CFC salarial/patronal, FNE, TC, RAV.
4. **Net à payer = Brut − total retenues salariales (légales) − total retenues internes.**
5. **Coût employeur = Brut + total charges patronales.**

## 5. Retenues internes (feuille « Retenues internes »)

Avance sur salaire, remboursement prêt, retenue retard non justifié, autres —
par matricule et période. (Recoupe la « retenue » du module Présences de l'ERP.)

## 6. Bulletin (feuille « Bulletin »)

En-tête maison (ECLOSION EDITION SARL, RCCM RC/YAO/2019/B/144, NIU
M021912751174Y, N° affiliation CNPS C-YAO-2019-0144), période, date de paiement,
infos salarié, éléments de rémunération, cotisations sociales/fiscales (taux
sal./pat.), retenues internes, **NET À PAYER = brut − retenues légales − retenues
internes**, coût employeur, mentions légales (Code du travail camerounais art.
68 & 89, congés 1,5 j/mois).

## 7. Traitements (VBA `Module_Paie_Eclosion.bas`)

- `GenererBulletinsPDF` : un PDF par salarié Actif.
- `EnvoyerBulletinsParEmail` : idem + envoi (Outlook) — à remplacer par le mailer de l'ERP.
- `CloturerMois` : archive le Livre de paie vers le **Journal de paie** (anti-doublon
  par période), horodaté — équivaut au **gel de période** de l'ERP.

## 8. Correspondance avec l'ERP existant

| Excel | ERP |
|---|---|
| Feuille Employés | table `employees` (+ champs paie confidentiels) |
| Salaire de base | `employee_confidential.base_salary` |
| Retenues internes (retard) | retenue proposée par le **module Présences** |
| Paramètres (taux/barèmes versionnés) | table de **paramètres de paie** versionnés (à créer) |
| Livre de paie | consolidation de paie (à créer) |
| Journal de paie / CloturerMois | **gel de période** (déjà amorcé côté Présences) |
| Bulletin PDF | générateur d'impression de l'ERP (`print.ts`) |
| Envoi Outlook | `mailer` de l'ERP |

## 9. Réserve de conformité

Les barèmes (CNPS, IRPP, CAC, CFC, FNE, TC/RAV) et mentions **relèvent de la
législation camerounaise** et **évoluent** (lois de finances). Ils sont
paramétrables/versionnés : leur mise à jour et la conformité des bulletins
restent sous la responsabilité de l'entreprise (cf. décision D-003 — la paie
était jusqu'ici en export externe ; l'internaliser est une dérogation à faire
acter par la Direction générale).
