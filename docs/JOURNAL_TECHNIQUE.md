# Eclospace — Journal technique

Document vivant : chaque choix technique structurant y est consigné avec sa justification (CLAUDE.md, règle 6). Complète le registre des décisions (`06_Registre_des_decisions.md`), qui reste la source des arbitrages métier.

| Date | Choix | Raison |
|---|---|---|
| 04/07/2026 | Hébergement : **Cloud** (D-004) | Décidé par l'opérateur. Fournisseur et région précis à choisir avant la mise en production (Ch. 21 §21.7) ; en dev, tout tourne en local via Docker pour ne pas dépendre du choix final. |
| 04/07/2026 | Backend : **Node.js + TypeScript + Fastify** | Un seul langage (TypeScript) du backend au frontend : plus simple à relire pour un chef de projet non-développeur. Fastify est léger, rapide, peu gourmand en ressources — cohérent avec l'exigence de sobriété (Ch. 21 §21.6) et un hébergement cloud à coût maîtrisé. |
| 04/07/2026 | ORM/migrations : **Prisma** | Schéma déclaratif proche du modèle de données déjà écrit (`02_Modele_de_donnees.md`) : UUID, champs d'audit, snake_case via `@map`. Migrations versionnées, lisibles en revue. |
| 04/07/2026 | Base de données : **PostgreSQL** | Imposé par le cahier des charges (Ch. 21 §21.3) et l'hypothèse H4 du modèle de données. |
| 04/07/2026 | Frontend : **React + TypeScript + Vite** | Écosystème large, PWA/mobile facile (scan stock, vente en salon), pas de bibliothèque UI lourde imposée — les composants du prototype (`.pill`, `.card`, `.spine`...) sont repris directement en CSS aux jetons du guide de style. |
| 04/07/2026 | Authentification : sessions signées + **argon2** (hachage) + **TOTP** (2FA, librairie `otplib`) | Standards éprouvés, aucune dépendance à un fournisseur d'identité tiers payant — condition de réversibilité complète (Ch. 21 §21.13). |
| 04/07/2026 | Journal d'audit : table `audit_log` sans droits `UPDATE`/`DELETE` au niveau base (contrainte SQL, pas seulement applicative) | Exigence non négociable Ch. 0 §0.3 et modèle de données §13.5 : même l'administrateur ne peut pas altérer le journal. |
| 04/07/2026 | Fichiers (GED) : stockage sur disque (dev) / objet compatible S3 (prod cloud), hash SHA-256 calculé serveur | Le modèle l'exige (`document_versions.sha256_hash`) ; un stockage compatible S3 garde le choix du fournisseur cloud ouvert. |
| 04/07/2026 | Tests : **Vitest** | Intégré à l'écosystème TypeScript/Vite, rapide, sans configuration lourde. |

| 04/07/2026 | Endpoints ajoutés hors spécification API v1 : `GET /genres`, `GET /collections`, `GET /evaluation-criteria`, `GET /users` | Plomberie minimale nécessaire aux listes déroulantes du Ch. 6 §6.2 et à la grille du Ch. 7 §7.4, absente de `03_Specification_API.md` (document explicitement « version de travail »). Lecture seule, permissions vérifiées. |

## Points d'interprétation du Lot 1 à confirmer avec la Direction éditoriale

Le cahier des charges décrit le comité de lecture et la décision éditoriale en langage métier ; certains détails d'implémentation ont exigé un choix non explicitement tranché par les documents. Signalés ici conformément à CLAUDE.md règle 2 :

1. **Échelle de notation** : les critères (Ch. 7 §7.4) sont notés de 0 à 10. Le cahier des charges ne précise pas l'échelle.
2. **Seuils de classement qualitatif** (Ch. 7 §7.5 : « seuils paramétrables ») : valeurs de départ Excellent ≥ 8,5, Très bon ≥ 7, Bon ≥ 5, À retravailler ≥ 3, sinon Refusé. Stockées dans `settings` (clé `evaluation_rating_thresholds`), modifiables sans redéploiement.
3. **Seuil d'écart signalant un désaccord entre lecteurs** (Ch. 7 §7.5) : fixé à 3 points par défaut (clé `evaluation_score_gap_threshold`), à confirmer.
4. **Coefficients de la grille** (Ch. 7 §7.5) : seuls 3 exemples sont donnés dans le texte (ligne éditoriale ×3, potentiel commercial ×2, originalité ×2) ; les 6 autres critères ont reçu un coefficient par défaut de 1, à valider avec la Direction éditoriale.
5. **Étape 4 (décision éditoriale) marquée « validée »** uniquement pour les décisions terminales (acceptation, acceptation sous conditions, refus) ; une révision ou une mise en attente n'avance pas le workflow et ne clôt pas l'étape — lecture combinée du Ch. 4 §4.3 (3 statuts) et du Ch. 8 §8.2 (5 décisions), qui ne se recoupent pas exactement.
6. **Genres de départ** (Ch. 6 §6.2) : liste limitée aux exemples cités dans le texte (roman, essai, poésie, manuel, jeunesse) ; à compléter par le secrétariat éditorial selon le catalogue réel. Aucune collection n'a été pré-remplie (donnée propre à la maison, non spécifiée).

## Environnements

- **Développement** : Docker Compose local (PostgreSQL + backend + frontend), aucune donnée réelle (Ch. 21 §21.4).
- **Recette** et **Production** : à provisionner chez le fournisseur cloud retenu, une fois choisi ; les migrations Prisma et les seeds sont identiques d'un environnement à l'autre.
