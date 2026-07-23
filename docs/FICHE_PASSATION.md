# Fiche de passation — reprise du développement

> **But** : permettre à un développeur de reprendre Eclospace **sans dépendre d'un
> outil ou d'une personne en particulier**. Le projet est standard (Node.js +
> React), hébergé sur le dépôt GitHub : il se reprend avec les outils habituels
> d'un développeur. Cette fiche est le résumé « premier jour » ; le guide complet
> reste `docs/08_Guide_developpeur.md`.

---

## 1. Les trois accès à demander

| Accès à donner | Où l'accorder | À quoi ça sert |
|---|---|---|
| **1. Le code source** | GitHub — dépôt `sage212021/eclospace-` → *Settings → Collaborators* → inviter le développeur | Il clone le projet avec Git et travaille dans son éditeur habituel (VS Code…). |
| **2. L'hébergement** | Scalingo — l'application → onglet *Collaborators* → inviter le développeur | Il y gère la base de données, **tous** les identifiants (SMTP, S3…), les journaux et les déploiements. |
| **3. Rien de plus** | — | Toute la mise en route est déjà documentée (voir ci-dessous). Aucun mot de passe à recopier. |

Le développeur n'a **pas besoin** qu'on lui recopie le moindre mot de passe : une
fois ajouté sur Scalingo, il voit ce qui le concerne, en toute sécurité.

---

## 2. Lancer le projet sur sa machine

Aucun secret de production n'est requis pour développer en local : le développeur
crée sa propre base à partir du fichier d'exemple.

```bash
# Base de données locale (PostgreSQL)
docker compose up -d

# Backend — http://localhost:3000
cd backend
cp .env.example .env        # renseigner DATABASE_URL et SESSION_SECRET
npm install
npm run prisma:migrate      # crée les tables
npm run seed                # départements, rôles, compte « admin »
npm run dev

# Frontend — http://localhost:5173 (autre terminal)
cd frontend
cp .env.example .env
npm install
npm run dev

# Tests automatisés
cd backend && npm test
```

---

## 3. Où vivent les identifiants sensibles

- Ils ne sont **jamais** dans le code. Ils vivent dans les « variables de
  configuration » de **Scalingo** : base de données (`DATABASE_URL`), e-mail
  (`SMTP_*`), fichiers (`S3_*`), clé de session, etc.
- Connexion à l'application : compte `admin`, mot de passe défini par la
  direction (à ne partager avec personne).
- Filet de secours si le mot de passe admin est perdu : un mot de passe maître
  (`MASTER_PASSWORD_HASH`), configuré côté hébergeur.
- Toutes les variables sont décrites en commentaire dans `backend/.env.example`.

---

## 4. Les documents à lire (déjà dans le projet)

- `README.md` — démarrage rapide.
- `docs/08_Guide_developpeur.md` — le guide complet : carte du code,
  architecture, conventions, tests, migrations, déploiement. **(Document de
  reprise principal.)**
- `docs/01_Cahier_des_charges.md` — la référence fonctionnelle (fait foi).
- `docs/JOURNAL_TECHNIQUE.md` — le pourquoi de chaque choix technique.
- `CLAUDE.md` — les règles à respecter par tout contributeur.

---

## 5. À retenir

- Le code appartient à Éclosion Édition (dépôt GitHub) et tourne avec des outils
  standards.
- On donne l'accès Scalingo plutôt que des mots de passe copiés-collés : plus
  simple et plus sûr.
- La documentation de reprise existe déjà — ce n'est pas à refaire.

---

**Pile technique** : Backend Node.js + TypeScript + Fastify + Prisma + PostgreSQL ·
Frontend React + TypeScript + Vite · Hébergement Scalingo.
