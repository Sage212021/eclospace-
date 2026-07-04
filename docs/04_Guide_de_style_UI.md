# ERP Éclosion Édition — Phase 3 : Guide de style UI
## Référence pour les développeurs — Version 1.0

Ce guide formalise les choix de conception du prototype interactif (`Phase3_Prototype_UI_Eclosion_Edition.html`), qui fait foi pour le rendu visuel. Toute nouvelle interface de l'ERP doit s'y conformer.

---

## 1. Principes directeurs

1. **Simplicité d'abord** (Ch. 0 §0.7) : chaque écran a un travail principal, visible sans défilement. La complexité vit dans le système, pas dans l'interface.
2. **L'information vient à l'utilisateur** : alertes, retards et actions attendues sont mis en évidence par la couleur et la position — jamais enfouis dans un sous-menu.
3. **Cloisonnement visible** : le menu latéral ne montre que les modules autorisés par les rôles de l'utilisateur (réponse de `GET /api/v1/me`). Un écran ne montre jamais un bouton que l'utilisateur n'a pas le droit d'utiliser.
4. **Le blocage s'explique** : quand une règle métier empêche une action (checklist incomplète, encours dépassé), l'interface affiche la liste exacte des conditions manquantes, telle que retournée par l'API (erreurs 409).
5. **Économie de bande passante** (Ch. 21 §21.6) : pas d'images décoratives, pas de bibliothèques lourdes ; les chiffres et le texte portent l'information.

---

## 2. Couleurs (jetons)

| Jeton | Valeur | Usage |
|---|---|---|
| `--ink` | `#1E2430` | Texte principal |
| `--chrome` | `#232B3E` | Barre latérale, fond de connexion |
| `--chrome-2` | `#2C3650` | Survol / séparateurs de la barre latérale |
| `--paper` | `#F7F6F2` | Fond de l'espace de travail |
| `--card` | `#FFFFFF` | Cartes et panneaux |
| `--line` | `#E4E2DA` | Bordures et filets |
| `--eclosion` | `#B18414` | **Or Éclosion** — accent de marque : actions principales, étapes validées, liens, sélection |
| `--eclosion-soft` | `#F7EFDA` | Fonds d'accent (pastilles positives, halo d'étape courante, encadrés) |
| `--amber` | `#C4661F` | Orange brûlé — retard, attention (distinct de l'or de marque) |
| `--amber-soft` | `#F9E9DB` | Fond des pastilles d'attention |
| `--alert` | `#C24B3A` | Rouge — critique, rupture, bloquant, négatif |
| `--alert-soft` | `#F9E9E6` | Fond des pastilles critiques |
| `--muted` | `#6B7280` | Texte secondaire |

**Règles sémantiques :**
- L'or est la marque **et** le positif (validé, disponible, conforme). Ne jamais l'utiliser pour signaler un problème.
- Retard = orange brûlé ; critique/bloquant/valeur négative = rouge. Ne jamais intervertir.
- Un état neutre (planifié, corrigé, archivé) utilise le gris (`p-grey`).
- Texte sur fond clair : toujours les variantes foncées indiquées (contraste AA minimum).

---

## 3. Typographie

| Rôle | Police | Usage |
|---|---|---|
| Titres | **Fraunces** (fallback Georgia, serif) | Titres de page et de la marque uniquement — jamais dans les tableaux ni les formulaires |
| Texte | **Public Sans** (fallback system-ui) | Tout le reste : corps, libellés, boutons |
| Données | **IBM Plex Mono** (fallback monospace) | Chiffres, montants, ISBN, numéros de dossiers, dates dans les frises, hash |

**Règles :**
- Corps 14 px ; libellés secondaires 12–13 px ; méta-libellés 10–11 px en capitales espacées.
- **Toute donnée chiffrée comparable est en police à chasse fixe et alignée à droite** dans les tableaux — condition de lecture rapide des colonnes de montants et quantités.
- Les montants FCFA s'écrivent avec l'espace insécable comme séparateur de milliers : `548 200`. Les grands montants agrégés peuvent s'abréger : `18,4 M`.
- Les négatifs (retours, avoirs) sont précédés du signe `−` et colorés en rouge.

---

## 4. Composants normalisés

### 4.1 Pastilles de statut (`.pill`)
Quatre variantes seulement : `p-green` (or/positif), `p-amber` (attention), `p-red` (critique), `p-grey` (neutre). Texte court : « Rupture », « Seuil dans 8 j », « J+4 ». Jamais de phrase.

### 4.2 Cartes (`.card`)
Fond blanc, bordure `--line`, rayon 10 px, padding 18 px. Titre de carte : 13 px semi-gras, avec lien d'action optionnel aligné à droite (« Voir tout → »).

### 4.3 Tableaux
En-têtes en capitales 11 px grises ; lignes de 10 px de padding ; survol `#FBFAF6`. Une ligne cliquable ouvre la fiche de l'objet (classe `.linklike` sur le titre). Pas de zébrures.

### 4.4 Boutons
- **Primaire** : fond or, texte blanc, un seul par zone d'écran — l'action principale (« Signer le BAT », « Enregistrer le mouvement »).
- **Secondaire** : fond blanc, bordure `--line`.
- **Destructif/alerte** : bordure et texte rouges, jamais de fond rouge plein.
- Le libellé dit exactement ce qui se passe : « Remettre mon rapport », pas « Valider ». L'action garde le même nom du bouton à la confirmation.
- Un bouton indisponible reste visible mais estompé (`opacity .45; disabled`), avec la raison du blocage en dessous.

### 4.5 Recommandations du pilotage (`.reco`)
Barre de sévérité verticale (rouge/orange/or) + message en langage naturel + boutons d'action (« Traiter », « Reporter », « Ignorer », plus une action contextuelle : « Simuler une réimpression »). Toujours actionnables, jamais purement informatives.

### 4.6 Encadrés pédagogiques (`.note`)
Fond or pâle : rappellent une règle du système (« La signature verrouillera ces fichiers »). Une phrase ou deux, jamais plus.

### 4.7 Bandeaux de blocage (`.warn`)
Fond rouge pâle, en tête de l'écran concerné, avec la cause chiffrée et le bouton de recours (« Demander la validation »). C'est l'incarnation visuelle des erreurs 409.

---

## 5. Motifs d'écran

### 5.1 La frise du manuscrit (`.spine`) — élément signature
Chaîne de stations horizontale : nœud plein or = validée (✓), halo or = étape courante, orange = validée en retard (avec `+N j`), vide = à venir. Date sous chaque station en chasse fixe. **Elle apparaît sur toute fiche d'ouvrage** et sert de repère commun à tous les métiers. Défilement horizontal sur mobile.

### 5.2 Jalons de fabrication (`.mstone`)
Variante compacte de la frise pour les commandes d'impression (6 jalons fixes du Ch. 15 §15.6).

### 5.3 Tableaux de bord
Rangée de 4 indicateurs vitaux (`.kpi`) en tête — chiffre en chasse fixe 26 px, libellé, variation colorée. Puis deux colonnes : listes opérationnelles à gauche (2/3), alertes et recommandations à droite (1/3). Chaque indicateur est cliquable vers la liste filtrée correspondante (Ch. 5 §5.3.1).

### 5.4 Vue mobile de terrain (gabarit « téléphone »)
Pour le scan stock et la vente en salon : un geste par écran — scanner → quantité (gros boutons − / +) → un bouton primaire. Cibles tactiles ≥ 38 px. Toute écriture porte une clé d'idempotence (API §1).

### 5.5 Gantt (`.gantt`)
Barres : or plein = terminé, hachuré or = en cours, orange = en retard, gris = planifié ; trait rouge vertical = aujourd'hui ; tiret gauche = dépendance. Légende toujours visible sous le diagramme.

### 5.6 Formulaires d'évaluation
Curseurs (`input range`, accent or) + coefficient affiché + score recalculé en direct côté client *pour le confort*, mais **recalculé côté serveur à la soumission** (le serveur fait foi).

---

## 6. Navigation

- Barre latérale sombre, trois groupes fixes ordonnés comme la vie d'un livre : **Pilotage → Chaîne du livre → Diffusion**. Entrée active : fond `--chrome-2` + filet or à gauche.
- Barre supérieure : recherche globale (placeholder « Rechercher un ouvrage, un auteur, un ISBN… ») + cloche de notifications avec compteur rouge.
- Fil de retour en haut des fiches (« ← Tableau de bord »).
- Sous 900 px : la barre latérale se replie (menu hamburger à implémenter), les grilles passent en une colonne, la frise défile horizontalement.

## 7. Écriture d'interface

- Français, ton professionnel et direct, vocabulaire du métier de l'édition (BAT, dépôt-vente, achevé d'imprimer — jamais de jargon informatique).
- Les erreurs disent le fait et le remède : « Encours dépassé : 4,9 M pour un plafond de 4,0 M. La commande sera bloquée en attente de validation. » Jamais « Une erreur est survenue ».
- Un écran vide invite à agir : « Aucune mission en cours — les nouvelles affectations apparaîtront ici. »
- Dates courtes `JJ/MM`, complètes en français dans les titres (« Samedi 4 juillet 2026 »).

## 8. Accessibilité et qualité (plancher non négociable)

- Focus clavier visible partout (`outline` or 2 px).
- Contrastes AA ; l'information n'est jamais portée par la couleur seule (les pastilles ont toujours un texte).
- `prefers-reduced-motion` respecté ; les animations sont rares et fonctionnelles.
- Libellés de formulaires reliés (`label for`) ; images avec `alt`.

## 9. Logo

- Écran de connexion et documents PDF générés : logo complet (ampoule-arbre + livre + devise).
- Barre latérale et espaces réduits : ampoule-arbre seule en or sur fond sombre.
- Demander à la maison le logo en **PNG fond transparent ou SVG** pour les fonds sombres et l'impression ; le JPG fond blanc actuel est réservé aux fonds clairs.
