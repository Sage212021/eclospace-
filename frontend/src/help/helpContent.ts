// Contenu de l'aide intégrée, organisé par pôle puis par sous-rubrique — pour
// orienter les utilisateurs quand ils bloquent. Rédigé en français (langue
// première de la maison). Chaque entrée : à quoi sert l'écran, les actions
// principales, et « si vous êtes bloqué » (les situations fréquentes).
//
// Volontairement sans jargon technique. Les intitulés correspondent au menu.

export type HelpStuck = { q: string; a: string };
export type HelpEntry = {
  key: string;
  title: string;
  purpose: string;
  actions: string[];
  stuck: HelpStuck[];
};
export type HelpPole = { pole: string; intro?: string; entries: HelpEntry[] };

export const HELP_CONTENT: HelpPole[] = [
  {
    pole: "Pour bien démarrer",
    intro: "Les bases, valables sur tous les écrans.",
    entries: [
      {
        key: "g-connexion",
        title: "Se connecter",
        purpose: "Entrer dans l'application avec votre identifiant et votre mot de passe.",
        actions: [
          "Saisissez votre identifiant puis votre mot de passe, et validez.",
          "Si la double sécurité (code du téléphone) est activée sur votre compte, saisissez ensuite le code à 6 chiffres.",
          "Sur téléphone, vous pouvez « ajouter à l'écran d'accueil » pour ouvrir l'application comme une vraie appli.",
        ],
        stuck: [
          { q: "« Identifiants invalides »", a: "Vérifiez qu'il n'y a pas d'espace ni de majuscule automatique ajoutés par le clavier. L'identifiant n'est pas sensible à la casse, mais le mot de passe, si. En dernier recours, un administrateur peut réinitialiser votre mot de passe." },
          { q: "Mot de passe oublié", a: "Il n'y a pas de réinitialisation automatique : demandez à un administrateur (RH ou Direction) de vous en attribuer un nouveau." },
        ],
      },
      {
        key: "g-naviguer",
        title: "Se repérer et naviguer",
        purpose: "Le menu de gauche regroupe les écrans par pôle ; on déplie un pôle pour voir ses rubriques.",
        actions: [
          "Sur téléphone, ouvrez le menu avec le bouton ☰ en haut à gauche.",
          "Cliquez un pôle pour le déplier, puis une rubrique pour ouvrir l'écran.",
          "Tous les pôles de la maison sont visibles, même ceux hors de votre périmètre.",
        ],
        stuck: [
          { q: "« Accès non autorisé » en ouvrant une rubrique", a: "C'est normal : cet écran n'appartient pas à votre pôle. La structure est visible par tous, mais les données ne s'ouvrent que pour les personnes concernées. Si vous pensez y avoir droit, voyez avec la Direction ou le RH." },
        ],
      },
      {
        key: "g-couleurs",
        title: "Les codes couleur et les messages",
        purpose: "Les couleurs ont toujours le même sens dans toute l'application.",
        actions: [
          "Or : positif, en cours, mis en avant. Bleu marine : fait / validé.",
          "Orange : retard ou à confirmer. Rouge : critique, erreur ou suppression.",
          "Les messages d'erreur sont explicites (ils disent quoi corriger), jamais un simple « une erreur est survenue ».",
        ],
        stuck: [
          { q: "Un chiffre s'affiche en rouge ou orange", a: "C'est une alerte : rouge = critique (ex. plafond dépassé, rupture), orange = à surveiller (retard). Le message précise la valeur concernée." },
        ],
      },
      {
        key: "g-recherche",
        title: "Recherche et notifications",
        purpose: "Retrouver un ouvrage/auteur, et suivre ce qui vous concerne.",
        actions: [
          "La barre de recherche en haut cherche un ouvrage, un auteur ou un ISBN.",
          "La cloche 🔔 signale les notifications qui vous sont destinées ; cliquez-en une pour ouvrir l'élément concerné.",
          "L'indicateur « en ligne » montre le nombre de personnes connectées.",
        ],
        stuck: [
          { q: "Je ne vois pas l'identité des autres personnes connectées", a: "C'est voulu : on n'affiche jamais qui est connecté dans un autre pôle, pour préserver la confidentialité." },
        ],
      },
      {
        key: "g-profil",
        title: "Mon compte et la langue",
        purpose: "Changer son mot de passe, la langue, et gérer sa sécurité.",
        actions: [
          "Ouvrez votre profil via l'initiale en haut à droite.",
          "L'interface est disponible en français et en anglais, au choix.",
          "Vous pouvez changer votre mot de passe (l'ancien vous sera demandé).",
        ],
        stuck: [
          { q: "Je veux activer la double sécurité (2FA)", a: "Cette option se met en place avec la Direction — dites-le à votre administrateur." },
        ],
      },
    ],
  },
  {
    pole: "Accueil",
    entries: [
      {
        key: "dashboard",
        title: "Tableau de bord",
        purpose: "La vue d'ensemble de la maison : grands indicateurs et pipeline éditorial, en temps réel.",
        actions: [
          "Lisez les grands indicateurs (ouvrages, ventes, stock, alertes…) d'un coup d'œil.",
          "Le « pipeline éditorial » montre combien d'ouvrages sont à chaque étape.",
          "Certains indicateurs (chiffre d'affaires, RH) n'apparaissent que si vous y avez droit.",
        ],
        stuck: [
          { q: "Un indicateur est vide ou absent", a: "Soit il n'y a pas encore de donnée, soit cet indicateur est réservé à un autre profil (finance, RH). Ce n'est pas une panne." },
        ],
      },
      {
        key: "mes-rapports",
        title: "Mes rapports hebdo",
        purpose: "Rédiger et retrouver vos comptes rendus hebdomadaires.",
        actions: [
          "Créez le rapport de la semaine et enregistrez-le.",
          "Retrouvez l'historique de vos rapports précédents.",
        ],
        stuck: [
          { q: "Je ne retrouve pas un ancien rapport", a: "Vérifiez la semaine sélectionnée ; les rapports sont classés par date." },
        ],
      },
    ],
  },
  {
    pole: "Éditorial",
    entries: [
      {
        key: "ed-manuscrits",
        title: "Manuscrits",
        purpose: "Le point d'entrée de chaque ouvrage : dépôt, suivi et avancement dans le circuit.",
        actions: [
          "Déposez un nouveau manuscrit avec « + Ajouter » et renseignez ses informations.",
          "Ouvrez un manuscrit pour voir sa fiche, son étape en cours et ses documents.",
          "Suivez son avancement d'étape en étape jusqu'à l'archivage.",
        ],
        stuck: [
          { q: "Je ne peux pas créer de manuscrit", a: "La création demande le droit de saisie éditoriale. Si le bouton « + Ajouter » n'apparaît pas, votre profil est en lecture seule." },
          { q: "Une étape refuse de passer à la suivante", a: "Le circuit impose un ordre : l'étape précédente doit être terminée. Le message indique ce qui manque." },
        ],
      },
      {
        key: "ed-comite",
        title: "Comité de lecture",
        purpose: "Organiser l'évaluation des manuscrits reçus par les lecteurs.",
        actions: [
          "Affectez des manuscrits à des lecteurs.",
          "Suivez les avis rendus et l'état d'avancement des lectures.",
        ],
        stuck: [
          { q: "Un lecteur ne voit pas sa lecture", a: "Vérifiez qu'elle lui a bien été affectée ; il la retrouvera dans « Mes lectures »." },
        ],
      },
      {
        key: "ed-mes-lectures",
        title: "Mes lectures",
        purpose: "Pour un lecteur : les manuscrits qui vous sont confiés et l'avis à rendre.",
        actions: [
          "Ouvrez une lecture, prenez connaissance du manuscrit.",
          "Rédigez et rendez votre avis selon la grille prévue.",
        ],
        stuck: [
          { q: "Ma liste est vide", a: "Aucun manuscrit ne vous est affecté pour l'instant ; c'est le comité de lecture qui en attribue." },
        ],
      },
      {
        key: "ed-direction",
        title: "Direction éditoriale",
        purpose: "Décider de la suite à donner aux manuscrits (accepté, refusé, à revoir) après les avis.",
        actions: [
          "Consultez les avis du comité pour un manuscrit.",
          "Prenez et enregistrez la décision éditoriale.",
        ],
        stuck: [
          { q: "Je ne peux pas trancher un manuscrit", a: "La décision demande le droit correspondant ; sans lui, l'écran reste en consultation." },
        ],
      },
      {
        key: "ed-correction",
        title: "Correction éditoriale",
        purpose: "Suivre le travail de correction et de réécriture confié aux correcteurs.",
        actions: [
          "Suivez les tâches de correction en cours et leur avancement.",
          "Un correcteur voit et traite ses propres tâches.",
        ],
        stuck: [
          { q: "Je ne vois pas mes tâches", a: "Un correcteur ne voit que les tâches qui lui sont assignées ; demandez leur affectation si besoin." },
        ],
      },
      {
        key: "ed-catalogue-ref",
        title: "Domaines & collections",
        purpose: "Gérer les catégories qui classent les ouvrages (domaines, collections).",
        actions: [
          "Créez ou modifiez un domaine / une collection (droit d'administration requis).",
          "Ces listes alimentent les menus déroulants lors du dépôt d'un manuscrit.",
        ],
        stuck: [
          { q: "Une collection manque dans un menu déroulant", a: "Ajoutez-la ici ; elle apparaîtra ensuite dans les formulaires." },
        ],
      },
      {
        key: "ed-archives",
        title: "Archives",
        purpose: "Retrouver les ouvrages arrivés en fin de circuit (archivés).",
        actions: [
          "Parcourez les ouvrages archivés et ouvrez leur fiche.",
        ],
        stuck: [
          { q: "Un ouvrage a disparu de la liste active", a: "Il est peut-être archivé : cherchez-le ici. Rien n'est jamais supprimé définitivement (suppression logique)." },
        ],
      },
    ],
  },
  {
    pole: "Production",
    entries: [
      {
        key: "pr-maquette",
        title: "Maquette",
        purpose: "Suivre la mise en page des ouvrages et déposer les fichiers de maquette.",
        actions: [
          "Ouvrez un ouvrage en maquette, déposez/mettez à jour ses fichiers.",
          "Faites avancer la maquette jusqu'à sa validation.",
        ],
        stuck: [
          { q: "Je n'ai pas accès à la Maquette", a: "Cet écran demande un droit « Production ». Le juridique, le RH, etc. n'y accèdent pas — c'est le cloisonnement par métier." },
        ],
      },
      {
        key: "pr-infographie",
        title: "Infographie & couvertures",
        purpose: "Créer et gérer les couvertures et éléments graphiques.",
        actions: [
          "Déposez une couverture ; elle peut être optimisée pour un affichage léger et net.",
          "Suivez les versions successives d'une couverture.",
        ],
        stuck: [
          { q: "Ma couverture s'affiche mais paraît lourde à télécharger", a: "L'application génère une version allégée pour l'écran ; la version d'impression reste de meilleure qualité." },
        ],
      },
      {
        key: "pr-isbn",
        title: "ISBN & dépôt légal",
        purpose: "Attribuer les ISBN et gérer les métadonnées et le dépôt légal.",
        actions: [
          "Attribuez un ISBN à un ouvrage depuis le pool disponible.",
          "Renseignez les métadonnées nécessaires au dépôt légal.",
        ],
        stuck: [
          { q: "Je ne peux pas réutiliser un ISBN", a: "C'est voulu : un ISBN attribué n'est jamais réutilisé, même en cas d'annulation. C'est une règle non négociable." },
        ],
      },
      {
        key: "pr-bat",
        title: "BAT & contrôle qualité",
        purpose: "Gérer le « Bon À Tirer » : le feu vert final avant impression.",
        actions: [
          "Déposez le BAT, notez les corrections, comparez les versions.",
          "La signature du BAT verrouille les fichiers : plus de modification après.",
        ],
        stuck: [
          { q: "« Le BAT est signé : verrouillé »", a: "Une fois signé, le BAT et ses fichiers sont figés pour garantir que l'impression correspond bien à ce qui a été validé. Toute reprise doit être motivée et notifiée à la direction." },
        ],
      },
      {
        key: "pr-impression",
        title: "Impression",
        purpose: "Suivre la fabrication : du dossier verrouillé à la réception des exemplaires.",
        actions: [
          "Créez le dossier d'impression à partir du BAT signé.",
          "Suivez la commande d'impression jusqu'à la réception.",
        ],
        stuck: [
          { q: "Je ne peux pas lancer l'impression", a: "Le BAT doit d'abord être signé : c'est lui qui transmet le dossier verrouillé à l'impression." },
        ],
      },
    ],
  },
  {
    pole: "Commercial",
    entries: [
      {
        key: "co-stock",
        title: "Stock & magasin",
        purpose: "Connaître et gérer les exemplaires en stock, les entrées, les alertes.",
        actions: [
          "Consultez les quantités disponibles par titre et par emplacement.",
          "Enregistrez les entrées en stock ; surveillez les seuils d'alerte et les ruptures.",
        ],
        stuck: [
          { q: "Un titre est en rupture (rouge)", a: "Le stock disponible est à zéro ou sous le seuil d'alerte. Une réimpression ou une entrée de stock est à envisager." },
          { q: "Le stock ne correspond pas à une vente", a: "Ventes et stock sont liés automatiquement (opération atomique) ; si un écart persiste, signalez-le, il ne devrait pas se produire." },
        ],
      },
      {
        key: "co-ventes",
        title: "Commercial & ventes",
        purpose: "Clients, commandes, remises, livraisons, retours et vente directe.",
        actions: [
          "Créez une commande ; le contrôle d'encours vérifie le plafond du client.",
          "Gérez livraisons, retours et avoirs ; encaissez en vente directe (dont mobile money).",
        ],
        stuck: [
          { q: "« Encours dépassé »", a: "Le montant dû par le client dépasserait son plafond autorisé. Le message indique l'encours et le plafond. Un règlement ou un relèvement de plafond est nécessaire." },
          { q: "Une période comptable est « clôturée »", a: "On ne peut plus écrire dans une période gelée. Adressez-vous à la finance pour la période concernée." },
        ],
      },
    ],
  },
  {
    pole: "Juridique & Finance",
    entries: [
      {
        key: "jf-contrats",
        title: "Contrats & droits d'auteur",
        purpose: "Établir les contrats, suivre les droits d'auteur et les reversements.",
        actions: [
          "Créez un contrat pour un ouvrage/auteur et suivez sa signature.",
          "Suivez le calcul et le versement des droits d'auteur.",
        ],
        stuck: [
          { q: "Un calcul de droits semble faux", a: "Les droits sont recalculés automatiquement à partir des ventes et des retours ; vérifiez d'abord les ventes/avoirs de l'ouvrage." },
        ],
      },
      {
        key: "jf-finance",
        title: "Finance & comptabilité",
        purpose: "Factures, encaissements, échéanciers, clôtures et exports comptables.",
        actions: [
          "Consultez les factures (immuables une fois émises) et les paiements.",
          "Clôturez une période ; exportez pour le logiciel/cabinet comptable externe.",
        ],
        stuck: [
          { q: "Je ne peux pas modifier une facture", a: "C'est voulu : une facture émise est immuable et numérotée dans une série sécurisée. On émet un avoir plutôt que de la modifier." },
          { q: "L'export comptable : les codes de compte", a: "Le plan de comptes fourni est indicatif, non certifié : à faire valider par votre comptable avant tout dépôt réel." },
        ],
      },
    ],
  },
  {
    pole: "Administration",
    entries: [
      {
        key: "ad-rh",
        title: "Ressources humaines",
        purpose: "Dossiers du personnel, présences, absences et paie.",
        actions: [
          "Gérez les fiches du personnel, les présences et les absences.",
          "Si la paie interne est activée, éditez les bulletins ; sinon, exportez pour la paie externe.",
        ],
        stuck: [
          { q: "Je ne vois pas les dates de naissance / l'âge", a: "La date de naissance reste en interne (RH) et l'âge n'est jamais affiché ; seule une info « anniversaire du jour » peut apparaître, sans l'année." },
          { q: "Les données RH sont invisibles pour moi", a: "Elles sont réservées au RH et à la Direction. C'est le cloisonnement voulu." },
        ],
      },
      {
        key: "ad-users",
        title: "Utilisateurs & rôles",
        purpose: "Créer les comptes et attribuer les rôles (habilitations).",
        actions: [
          "Créez un compte avec « + Nouveau compte ».",
          "Attribuez un ou plusieurs rôles ; suspendez, réinitialisez le mot de passe, ou supprimez un compte.",
          "« Se connecter en tant que » permet de voir l'application avec les droits d'un autre (traçable).",
        ],
        stuck: [
          { q: "« Cet e-mail / identifiant est déjà utilisé »", a: "Une valeur doit être unique. Si elle appartenait à un compte supprimé, elle est libérée automatiquement ; si elle appartient à un compte actif, choisissez-en une autre." },
          { q: "Chaque rôle ajoute des accès", a: "Attention aux cumuls : un rôle en trop élargit le périmètre. Préférez un rôle par métier, sauf cumul voulu." },
        ],
      },
      {
        key: "ad-rights",
        title: "Droits & pôles",
        purpose: "Voir et ajuster, pôle par pôle, quels droits sont accordés à chaque rôle.",
        actions: [
          "Parcourez la matrice des droits par pôle.",
          "Ajustez les habilitations d'un rôle (droit d'administration requis).",
        ],
        stuck: [
          { q: "Un profil a un accès qu'il ne devrait pas avoir", a: "Vérifiez ses rôles : un accès vient souvent d'un rôle cumulé. On resserre ici, ou en retirant le rôle en trop." },
        ],
      },
      {
        key: "ad-parametres",
        title: "Paramètres",
        purpose: "Réglages généraux de l'application (identité de la maison, options).",
        actions: [
          "Ajustez les paramètres disponibles selon vos droits.",
        ],
        stuck: [
          { q: "Un réglage est grisé", a: "Il demande un droit d'administration des paramètres." },
        ],
      },
      {
        key: "ad-diagnostics",
        title: "Diagnostics système",
        purpose: "Vérifier l'état technique de l'application (réservé à l'administrateur général).",
        actions: [
          "Consultez les indicateurs techniques et l'état des services.",
        ],
        stuck: [
          { q: "Je n'y ai pas accès", a: "Cet écran est réservé à l'administrateur général." },
        ],
      },
    ],
  },
  {
    pole: "Communication interne",
    entries: [
      {
        key: "cm-actualites",
        title: "Fil d'actualités",
        purpose: "Une chronologie de ce qui se passe dans la maison (annonces, événements, échéances).",
        actions: [
          "Faites défiler le fil ; cliquez un élément pour l'ouvrir.",
        ],
        stuck: [
          { q: "Le fil est vide", a: "Il n'y a pas encore d'actualité, ou aucune ne vous est destinée." },
        ],
      },
      {
        key: "cm-babillard",
        title: "Babillard d'annonces",
        purpose: "Lire et publier les annonces internes.",
        actions: [
          "Lisez les annonces ; publiez-en une si vous avez le droit de saisie.",
          "Réglez vos préférences de notification.",
        ],
        stuck: [
          { q: "Je ne peux pas publier", a: "La publication demande le droit de saisie en communication." },
        ],
      },
      {
        key: "cm-evenements",
        title: "Planning des événements",
        purpose: "Les temps forts de la maison, en vue Liste ou Calendrier, avec statut et affiche.",
        actions: [
          "Basculez entre « 📋 Liste » et « 📅 Calendrier » (aperçu de toute l'année).",
          "RH et Direction gèrent : ajouter/modifier un événement, changer le statut, déposer une affiche.",
          "Cliquez un jour du calendrier pour voir les événements de ce jour.",
        ],
        stuck: [
          { q: "Je ne peux pas modifier un événement", a: "La gestion est réservée au RH et à la Direction ; les autres consultent." },
          { q: "Un événement colore trop de jours", a: "Il couvre toute sa plage de dates : vérifiez ses dates de début et de fin (bouton Modifier)." },
        ],
      },
      {
        key: "cm-calendrier",
        title: "Calendrier partagé",
        purpose: "Un calendrier mensuel partagé (événements, anniversaires du jour).",
        actions: [
          "Naviguez de mois en mois ; publiez un événement si vous en avez le droit.",
        ],
        stuck: [
          { q: "Différence avec le Planning des événements", a: "Le Planning des événements suit les temps forts annuels avec statut et affiche ; le Calendrier partagé est un agenda mensuel plus général." },
        ],
      },
      {
        key: "cm-bulletin",
        title: "Bulletin d'actualités",
        purpose: "Composer et envoyer le bulletin interne (newsletter).",
        actions: [
          "Composez un bulletin et envoyez-le à son audience (droit de saisie requis).",
          "Retrouvez les bulletins déjà envoyés.",
        ],
        stuck: [
          { q: "L'envoi n'est pas parti", a: "L'envoi d'e-mail dépend de la configuration du serveur de messagerie ; sans elle, l'envoi est seulement journalisé." },
        ],
      },
    ],
  },
  {
    pole: "Pilotage",
    entries: [
      {
        key: "pi-direction",
        title: "Direction générale",
        purpose: "La vue de pilotage : indicateurs de direction et recommandations.",
        actions: [
          "Consultez les indicateurs de pilotage.",
          "Traitez les recommandations si vous en avez le droit.",
        ],
        stuck: [
          { q: "Réservé à la direction", a: "Cet écran demande un droit de consultation « direction »." },
        ],
      },
      {
        key: "pi-rapports",
        title: "Rapports & statistiques",
        purpose: "Analyses et statistiques de la maison.",
        actions: [
          "Consultez les rapports disponibles ; créez une analyse si vous en avez le droit.",
        ],
        stuck: [
          { q: "Je n'ai pas accès aux rapports", a: "Réservé aux profils de pilotage (Direction, Finance, RH)." },
        ],
      },
      {
        key: "pi-journal",
        title: "Journal d'activité",
        purpose: "La trace de tout ce qui se fait dans l'application (audit).",
        actions: [
          "Parcourez l'historique des actions (qui a fait quoi, quand).",
        ],
        stuck: [
          { q: "Peut-on effacer une ligne du journal ?", a: "Non : le journal est inaltérable (append-only), même pour un administrateur. C'est une garantie de traçabilité." },
        ],
      },
    ],
  },
];
