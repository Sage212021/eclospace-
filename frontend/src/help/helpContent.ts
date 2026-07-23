// Contenu de l'aide intégrée, organisé par pôle puis par sous-rubrique.
// Objectif : décrire le PROCÉDÉ RÉEL de chaque écran, étape par étape, en
// anticipant les blocages concrets. Rédigé en français, sans jargon.
//
// « procedure » = les étapes à suivre, dans l'ordre, avec les vrais boutons.
// « stuck » = les situations où l'utilisateur peut se retrouver bloqué.

export type HelpStuck = { q: string; a: string };
export type HelpEntry = {
  key: string;
  title: string;
  purpose: string;
  procedure: string[];
  stuck: HelpStuck[];
};
export type HelpPole = { pole: string; intro?: string; entries: HelpEntry[] };

// Sélectionne le contenu d'aide selon la langue de l'interface.
// (helpContentEn n'importe qu'un type d'ici : pas de cycle à l'exécution.)
import { HELP_CONTENT_EN } from "./helpContentEn";
export function getHelpContent(lang: string): HelpPole[] {
  return lang === "en" ? HELP_CONTENT_EN : HELP_CONTENT;
}

export const HELP_CONTENT: HelpPole[] = [
  {
    pole: "Pour bien démarrer",
    intro: "Les bases, valables sur tous les écrans.",
    entries: [
      {
        key: "g-connexion",
        title: "Se connecter",
        purpose: "Entrer dans l'application avec votre identifiant et votre mot de passe.",
        procedure: [
          "Ouvrez l'adresse de l'application (sur téléphone, vous pouvez « ajouter à l'écran d'accueil » pour l'ouvrir comme une vraie appli).",
          "Saisissez votre identifiant, puis votre mot de passe, et validez.",
          "Si la double sécurité est activée sur votre compte, saisissez ensuite le code à 6 chiffres affiché par votre application d'authentification.",
        ],
        stuck: [
          { q: "« Identifiants invalides » alors que je suis sûr de mon mot de passe", a: "Le clavier du téléphone ajoute parfois un espace ou une majuscule automatique. L'identifiant n'est pas sensible à la casse (« noah » = « Noah »), mais le mot de passe, si : retapez-le lettre à lettre. En dernier recours, un administrateur (RH ou Direction) vous en attribue un nouveau." },
          { q: "Mot de passe oublié", a: "Il n'existe pas de réinitialisation automatique par e-mail : demandez à un administrateur de vous en attribuer un nouveau, puis changez-le depuis votre profil." },
        ],
      },
      {
        key: "g-circuit",
        title: "Comprendre le circuit d'un ouvrage",
        purpose: "Beaucoup d'écrans ne sont pas des dossiers séparés, mais des ÉTAPES par lesquelles passe chaque ouvrage, du manuscrit au livre fini.",
        procedure: [
          "Un ouvrage avance étape par étape : comité de lecture → décision → contrat → correction → maquette → infographie → ISBN → BAT → impression → stock → vente → archivage.",
          "Chaque rubrique d'étape (Comité, Correction, Maquette, BAT…) affiche les ouvrages ACTUELLEMENT à cette étape.",
          "Pour travailler : ouvrez l'ouvrage dans la liste, faites le travail de l'étape (déposer un fichier, remplir une info…), puis cliquez « Valider cette étape ».",
          "L'ouvrage passe alors à l'étape suivante et la personne concernée est prévenue par une notification.",
        ],
        stuck: [
          { q: "Un ouvrage n'apparaît pas dans ma rubrique d'étape", a: "Il n'est pas encore arrivé à cette étape : l'étape précédente doit d'abord être validée. Il apparaîtra automatiquement le moment venu." },
          { q: "« Valider cette étape » est refusé", a: "Il manque un élément obligatoire (un fichier, une information) ou vous n'avez pas le droit de validation pour cette étape. Le message précise ce qui bloque." },
        ],
      },
      {
        key: "g-naviguer",
        title: "Se repérer et naviguer",
        purpose: "Le menu de gauche regroupe les écrans par pôle ; on déplie un pôle pour voir ses rubriques.",
        procedure: [
          "Sur téléphone, ouvrez le menu avec le bouton ☰ en haut à gauche.",
          "Cliquez un pôle pour le déplier, puis une rubrique pour ouvrir l'écran.",
          "Tous les pôles de la maison restent visibles, même hors de votre périmètre — mais ils ne s'ouvrent que pour les personnes concernées.",
        ],
        stuck: [
          { q: "« Accès non autorisé » en ouvrant une rubrique", a: "Normal : cet écran n'appartient pas à votre pôle. La structure est visible par tous ; les données, non. Si vous pensez y avoir droit, voyez avec la Direction ou le RH." },
        ],
      },
      {
        key: "g-email",
        title: "Envoyer un document par e-mail",
        purpose: "L'application n'envoie pas d'e-mails « libres » : elle envoie des DOCUMENTS précis (facture, relevé de droits, bulletin) ou un lien de signature.",
        procedure: [
          "Une facture ou un relevé de droits : dans « Finance & comptabilité », ouvrez le document et cliquez « Envoyer par e-mail ».",
          "Une fenêtre s'ouvre : le destinataire (souvent pré-rempli), un message, et un aperçu du document. Ajustez, puis « Envoyer ».",
          "Le bulletin interne : depuis « Bulletin d'actualités », bouton « Envoyer » (envoi à tout le personnel).",
          "Un devis d'auteur : son lien de signature est envoyé par e-mail à l'auteur depuis le devis.",
        ],
        stuck: [
          { q: "L'e-mail ne semble pas parti", a: "L'envoi dépend de la configuration du serveur de messagerie (côté hébergement). Si elle n'est pas en place, l'envoi est seulement journalisé, pas réellement expédié. Signalez-le à l'administrateur." },
          { q: "Je voudrais écrire un e-mail libre à un collègue", a: "L'application ne le permet pas : elle n'envoie que des documents officiels. Pour un message interne, utilisez le babillard ou le bulletin." },
        ],
      },
      {
        key: "g-couleurs",
        title: "Les codes couleur et les messages",
        purpose: "Les couleurs ont toujours le même sens dans toute l'application.",
        procedure: [
          "Or : positif, en cours, mis en avant. Bleu marine : fait / validé.",
          "Orange : retard ou à confirmer. Rouge : critique, erreur ou suppression.",
          "Les chiffres sont en police à chasse fixe (alignés) ; un chiffre rouge ou orange est une alerte.",
        ],
        stuck: [
          { q: "Un message d'erreur s'affiche", a: "Les erreurs sont explicites : elles disent la valeur concernée et quoi faire (ex. « Encours dépassé : 4,9 M pour un plafond de 4,0 M »). Lisez le message, il indique la marche à suivre." },
        ],
      },
      {
        key: "g-recherche",
        title: "Recherche, notifications et présence",
        purpose: "Retrouver un ouvrage/auteur, suivre ce qui vous concerne, voir qui travaille.",
        procedure: [
          "La barre de recherche en haut cherche un ouvrage, un auteur ou un ISBN.",
          "La cloche 🔔 liste vos notifications ; cliquez-en une pour ouvrir l'élément concerné.",
          "L'indicateur « en ligne » montre combien de personnes sont connectées (sans révéler qui, dans les autres pôles).",
        ],
        stuck: [
          { q: "Je ne vois pas l'identité des personnes en ligne", a: "C'est voulu : on n'affiche jamais qui est connecté dans un autre pôle, pour préserver la confidentialité." },
        ],
      },
      {
        key: "g-profil",
        title: "Mon compte et la langue",
        purpose: "Changer son mot de passe, la langue de l'interface.",
        procedure: [
          "Ouvrez votre profil via l'initiale en haut à droite.",
          "Choisissez la langue : français ou anglais.",
          "Pour changer votre mot de passe, l'ancien vous sera demandé, et le nouveau doit respecter une complexité minimale (au moins 8 caractères, une majuscule, un chiffre).",
        ],
        stuck: [
          { q: "Activer la double sécurité (2FA)", a: "Cette mise en route se fait avec la Direction : signalez-le à votre administrateur." },
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
        procedure: [
          "Lisez les grands indicateurs (ouvrages en cours, total, ventes, stock, ruptures, utilisateurs…).",
          "Le « pipeline éditorial » montre combien d'ouvrages sont à chaque étape du circuit.",
          "Cliquez une annonce en avant pour l'ouvrir ; les anniversaires du jour peuvent s'afficher (sans l'année).",
        ],
        stuck: [
          { q: "Un indicateur (chiffre d'affaires, RH) n'apparaît pas", a: "Il est réservé à un profil autorisé (finance, RH). Son absence n'est pas une panne : c'est le cloisonnement des données." },
        ],
      },
      {
        key: "suivi",
        title: "Suivi des ouvrages",
        purpose: "Voir d'un coup d'œil où en est chaque livre dans sa fabrication — pratique pour renseigner un auteur qui appelle.",
        procedure: [
          "La liste montre les ouvrages entrés en fabrication, avec leur étape en cours et un pourcentage d'avancement.",
          "Tapez un titre, un auteur ou un numéro dans la barre de recherche pour retrouver un ouvrage précis.",
          "Cliquez sur un ouvrage : une frise à voyants se déplie et montre chaque étape du circuit (verte = franchie, dorée = étape en cours, grise = à venir).",
        ],
        stuck: [
          { q: "Un ouvrage récent n'apparaît pas dans la liste", a: "Le suivi n'affiche que les ouvrages déjà passés en fabrication (à partir de la maquette). Un manuscrit encore en lecture ou en contrat n'y figure pas encore : suivez-le depuis « Manuscrits »." },
          { q: "Le pourcentage ne bouge pas", a: "Il n'avance que lorsque l'ouvrage change réellement d'étape dans le circuit. C'est le pôle concerné (production, BAT, impression…) qui fait avancer l'étape." },
        ],
      },
      {
        key: "mes-rapports",
        title: "Mes rapports hebdo",
        purpose: "Rédiger et retrouver vos comptes rendus hebdomadaires.",
        procedure: [
          "Sélectionnez la semaine concernée.",
          "Rédigez votre rapport et enregistrez-le.",
          "Retrouvez l'historique de vos rapports précédents en changeant de semaine.",
        ],
        stuck: [
          { q: "Je ne retrouve pas un ancien rapport", a: "Vérifiez la semaine sélectionnée : les rapports sont classés par date." },
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
        purpose: "Le point d'entrée de chaque ouvrage : dépôt, fiche, et suivi dans tout le circuit.",
        procedure: [
          "Pour déposer un nouveau manuscrit : bouton « + Ajouter » (ou nouveau manuscrit), renseignez titre, auteur, genre, collection…",
          "Cliquez un manuscrit pour ouvrir sa fiche : étape en cours, documents, historique.",
          "Depuis la fiche, faites avancer le circuit avec « Valider cette étape » quand le travail de l'étape est fait.",
        ],
        stuck: [
          { q: "Le bouton « + Ajouter » n'apparaît pas", a: "La création demande le droit de saisie éditoriale ; sans lui, l'écran est en lecture seule." },
          { q: "Une collection/genre manque dans le formulaire", a: "Ajoutez-la d'abord dans « Domaines & collections » ; elle apparaîtra ensuite dans le menu déroulant." },
        ],
      },
      {
        key: "ed-comite",
        title: "Comité de lecture",
        purpose: "Étape du circuit : faire évaluer les manuscrits reçus par des lecteurs, et rassembler leurs avis.",
        procedure: [
          "La liste montre les manuscrits actuellement au comité de lecture.",
          "Ouvrez un manuscrit et affectez un ou plusieurs lecteurs, avec une échéance.",
          "Chaque lecteur rend son évaluation dans « Mes lectures » ; suivez ici les avis rendus.",
          "Quand tous les rapports attendus sont remis, l'étape peut passer à la décision éditoriale (une notification le signale).",
        ],
        stuck: [
          { q: "Un lecteur ne voit pas sa mission", a: "Vérifiez qu'il a bien été affecté à CE manuscrit ; il la retrouvera dans sa rubrique « Mes lectures »." },
          { q: "Je ne peux pas passer à la suite", a: "Tant que tous les rapports attendus ne sont pas remis, l'étape reste ouverte." },
        ],
      },
      {
        key: "ed-mes-lectures",
        title: "Mes lectures",
        purpose: "Pour un lecteur : vos missions de lecture et la remise de vos évaluations. (Ce n'est pas un dépôt de fichier : on remplit une évaluation structurée.)",
        procedure: [
          "La liste montre vos missions, chacune avec une échéance et un statut.",
          "Cliquez « Évaluer » pour ouvrir la grille.",
          "Notez chaque critère (chaque critère a un coefficient) ; un score global indicatif s'affiche (il est recalculé et validé par le serveur à la remise).",
          "Choisissez une Recommandation (acceptation / corrections mineures / majeures / réécriture / nouvelle expertise / refus motivé) et rédigez l'appréciation générale.",
          "Cliquez « Remettre mon rapport ». Message : « Évaluation remise avec succès ».",
        ],
        stuck: [
          { q: "Puis-je télécharger un rapport de relecture ?", a: "Non : l'évaluation n'est pas un fichier à téléverser/télécharger, mais un formulaire (notes + recommandation + commentaire). Une fois remise, elle est consultée par la Direction éditoriale, pas téléchargée." },
          { q: "Ma liste est vide", a: "Aucune mission ne vous est affectée pour l'instant ; c'est le comité de lecture qui en attribue." },
          { q: "Je ne peux plus modifier une évaluation remise", a: "Une fois remise, elle est enregistrée. Voyez avec le responsable du comité si une correction est nécessaire." },
        ],
      },
      {
        key: "ed-direction",
        title: "Direction éditoriale",
        purpose: "Étape du circuit : trancher le sort de chaque manuscrit (accepté, refusé, à revoir) au vu des avis du comité.",
        procedure: [
          "La liste montre les manuscrits en attente de décision éditoriale.",
          "Ouvrez un manuscrit : consultez la synthèse des avis rendus.",
          "Prenez la décision et validez l'étape ; un manuscrit accepté part vers la contractualisation.",
        ],
        stuck: [
          { q: "Je ne peux pas trancher", a: "La décision demande le droit correspondant ; sans lui, l'écran reste en consultation." },
        ],
      },
      {
        key: "ed-correction",
        title: "Correction éditoriale",
        purpose: "Étape du circuit : la correction et la réécriture confiées aux correcteurs.",
        procedure: [
          "La liste montre les ouvrages en correction.",
          "Suivez les tâches de correction et leur avancement ; un correcteur voit et traite ses propres tâches.",
          "Quand la correction est terminée, « Valider la correction » fait avancer l'ouvrage.",
        ],
        stuck: [
          { q: "Un correcteur ne voit pas ses tâches", a: "Il ne voit que celles qui lui sont assignées : vérifiez l'affectation." },
        ],
      },
      {
        key: "ed-catalogue-ref",
        title: "Domaines & collections",
        purpose: "Gérer les catégories qui classent les ouvrages (domaines, collections) et alimentent les menus.",
        procedure: [
          "Créez ou modifiez un domaine / une collection (droit d'administration éditoriale requis).",
          "Ces listes apparaissent ensuite dans les menus déroulants au dépôt d'un manuscrit.",
        ],
        stuck: [
          { q: "Une collection manque dans un formulaire", a: "Ajoutez-la ici ; elle sera disponible immédiatement dans les formulaires." },
          { q: "Je ne peux rien modifier", a: "La gestion demande le droit d'administration ; sinon, c'est en consultation." },
        ],
      },
      {
        key: "ed-archives",
        title: "Archives",
        purpose: "Retrouver les ouvrages arrivés en fin de circuit (archivés).",
        procedure: [
          "Parcourez la liste des ouvrages archivés.",
          "Ouvrez une fiche pour consulter son historique complet.",
        ],
        stuck: [
          { q: "Un ouvrage a disparu des listes actives", a: "Il est sans doute archivé : cherchez-le ici. Rien n'est jamais supprimé définitivement (suppression logique)." },
        ],
      },
    ],
  },
  {
    pole: "Production",
    intro: "Ces rubriques sont les étapes de fabrication : chacune liste les ouvrages arrivés à cette étape ; on en ouvre un, on fait le travail, puis « Valider cette étape ».",
    entries: [
      {
        key: "pr-maquette",
        title: "Maquette & mise en page",
        purpose: "Étape du circuit : la mise en page intérieure de l'ouvrage.",
        procedure: [
          "La liste montre les ouvrages en maquette.",
          "Ouvrez un ouvrage, déposez/mettez à jour ses fichiers de mise en page (chaque dépôt crée une nouvelle version tracée).",
          "Quand la maquette est prête, validez l'étape.",
        ],
        stuck: [
          { q: "Je n'ai pas accès à la Maquette", a: "Cet écran demande un droit « Production ». Le juridique, le RH… n'y accèdent pas : c'est le cloisonnement par métier." },
        ],
      },
      {
        key: "pr-infographie",
        title: "Infographie & couvertures",
        purpose: "Étape du circuit : la couverture et les éléments graphiques.",
        procedure: [
          "Ouvrez l'ouvrage à l'étape infographie.",
          "Déposez la couverture ; l'application en génère une version allégée pour l'affichage à l'écran (la version d'impression reste de meilleure qualité).",
          "Suivez les versions successives, puis validez l'étape.",
        ],
        stuck: [
          { q: "La couverture paraît lourde", a: "À l'écran, c'est la version allégée qui s'affiche ; l'originale de qualité impression est conservée à part." },
        ],
      },
      {
        key: "pr-isbn",
        title: "ISBN & dépôt légal",
        purpose: "Étape du circuit : attribuer l'ISBN et préparer les métadonnées et le dépôt légal.",
        procedure: [
          "Ouvrez l'ouvrage à cette étape.",
          "Attribuez un ISBN depuis le pool disponible et renseignez les métadonnées nécessaires.",
          "Validez l'étape.",
        ],
        stuck: [
          { q: "Je ne peux pas réutiliser un ISBN", a: "C'est une règle non négociable : un ISBN attribué n'est jamais réutilisé, même après annulation." },
          { q: "Plus d'ISBN disponible", a: "Le pool est épuisé : il faut enregistrer une nouvelle tranche d'ISBN avant de pouvoir en attribuer." },
        ],
      },
      {
        key: "pr-bat",
        title: "BAT & contrôle qualité",
        purpose: "Étape du circuit : le « Bon À Tirer », dernier feu vert avant impression.",
        procedure: [
          "Ouvrez l'ouvrage à l'étape BAT.",
          "Déposez le BAT, notez le contrôle qualité, et comparez les versions si plusieurs cycles.",
          "Quand tout est bon, signez le BAT : la signature VERROUILLE les fichiers et transmet le dossier à l'impression.",
        ],
        stuck: [
          { q: "« Le BAT est signé : verrouillé »", a: "Une fois signé, le BAT et ses fichiers sont figés, pour garantir que l'impression correspond exactement à ce qui a été validé. Toute reprise doit être motivée et notifiée à la direction." },
          { q: "Je ne peux pas signer", a: "La signature demande le droit de validation BAT ; le dépôt et le contrôle demandent le droit de saisie." },
        ],
      },
      {
        key: "pr-impression",
        title: "Impression",
        purpose: "Étape du circuit : la fabrication, du dossier verrouillé à la réception des exemplaires.",
        procedure: [
          "Ouvrez l'ouvrage à l'étape impression : le dossier vient du BAT signé.",
          "Créez/suivez la commande d'impression.",
          "À la réception, enregistrez les exemplaires : ils entrent en stock.",
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
        purpose: "Connaître et gérer les exemplaires : entrées, sorties, transferts, emplacements et alertes.",
        procedure: [
          "Consultez les quantités par titre et par emplacement.",
          "Pour bouger du stock : « Enregistrer le mouvement » (entrée, sortie ou transfert).",
          "Pour un nouvel emplacement : « + Lieu ».",
          "Surveillez les seuils d'alerte (orange) et les ruptures (rouge).",
        ],
        stuck: [
          { q: "Un titre est en rupture (rouge)", a: "Le disponible est à zéro ou sous le seuil d'alerte : une réimpression ou une entrée de stock est à envisager." },
          { q: "Le stock ne correspond pas à une vente", a: "Ventes et stock sont liés automatiquement (opération atomique) : un écart ne devrait pas apparaître ; s'il persiste, signalez-le." },
        ],
      },
      {
        key: "co-ventes",
        title: "Commercial & ventes",
        purpose: "Clients, commandes, remises, livraisons, retours, avoirs et vente directe.",
        procedure: [
          "Créez une commande : « Créer la commande ». Le contrôle d'encours vérifie le plafond du client.",
          "Pour une vente directe (dont mobile money) : « Encaisser » ; vous pouvez ajouter un mode de paiement mixte.",
          "Gérez les livraisons, les retours et les avoirs ; ajoutez un point de vente avec « + nouveau point de vente ».",
        ],
        stuck: [
          { q: "« Encours dépassé »", a: "Le montant dû par le client dépasserait son plafond autorisé. Le message donne l'encours et le plafond. Il faut un règlement, ou relever le plafond du client." },
          { q: "« Période comptable clôturée »", a: "On ne peut plus écrire dans une période gelée. Adressez-vous à la finance pour la période concernée." },
          { q: "« Impossible d'ajouter le point de vente »", a: "Une information obligatoire manque ou est en double ; le message précise laquelle." },
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
        purpose: "Étape du circuit : établir le contrat d'un ouvrage accepté et fixer les conditions de droits.",
        procedure: [
          "La liste montre les ouvrages en contractualisation.",
          "Ouvrez l'ouvrage, établissez le contrat (conditions, taux de droits) et suivez sa signature.",
          "Validez la contractualisation : l'ouvrage part vers la correction. Les droits se calculeront ensuite à partir des ventes.",
        ],
        stuck: [
          { q: "Un calcul de droits semble faux", a: "Les droits sont recalculés automatiquement à partir des ventes et des retours : vérifiez d'abord les ventes/avoirs de l'ouvrage." },
        ],
      },
      {
        key: "jf-finance",
        title: "Finance & comptabilité",
        purpose: "Factures, encaissements, relevés de droits, échéanciers, clôtures et exports comptables.",
        procedure: [
          "Consultez les factures (immuables une fois émises) et enregistrez les encaissements (« Encaisser » / « Valider »).",
          "Envoyez une facture ou un relevé par e-mail : bouton « Envoyer par e-mail » → destinataire + message + aperçu → « Envoyer ».",
          "Générez un relevé de droits : « Générer un relevé de droits ».",
          "Clôturez une période comptable ; exportez pour le logiciel/cabinet comptable externe.",
        ],
        stuck: [
          { q: "Je ne peux pas modifier une facture", a: "Voulu : une facture émise est immuable et numérotée dans une série sécurisée. Pour corriger, on émet un avoir plutôt que de la modifier." },
          { q: "Les codes de compte de l'export", a: "Le plan de comptes fourni est indicatif, non certifié : à faire valider par votre comptable avant tout dépôt réel." },
          { q: "« déjà réglé »", a: "L'encaissement a déjà été enregistré pour ce document : inutile de le refaire." },
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
        purpose: "Dossiers du personnel, présences, absences, et paie (si activée).",
        procedure: [
          "Ajoutez un collaborateur (« + Collaborateur ») ; enregistrez un départ (« Enregistrer un départ »).",
          "Traitez les demandes d'absence : « Valider » ou « Refuser ».",
          "Les données sensibles se modifient via « Modifier les données confidentielles » (droit dédié).",
          "Si la paie interne est activée, lancez une campagne (« + Campagne ») et éditez les bulletins ; sinon, exportez pour la paie externe.",
        ],
        stuck: [
          { q: "Je ne vois pas les dates de naissance / l'âge", a: "La date de naissance reste en interne (RH) et l'âge n'est jamais affiché ; seule une info « anniversaire du jour » peut apparaître, sans l'année." },
          { q: "Les écrans RH sont vides pour moi", a: "Ils sont réservés au RH et à la Direction : cloisonnement voulu." },
        ],
      },
      {
        key: "ad-users",
        title: "Utilisateurs & rôles",
        purpose: "Créer les comptes et attribuer les rôles (habilitations).",
        procedure: [
          "« + Nouveau compte » → renseignez l'identifiant et l'e-mail → « Créer le compte ».",
          "Sur un compte : « + Attribuer un rôle… » puis « Attribuer » ; répétez pour plusieurs rôles.",
          "Autres actions : « Réinitialiser le mot de passe », « Suspendre le compte », « Supprimer le compte ».",
          "« Se connecter en tant que » permet de voir l'application avec les droits d'une autre personne (action tracée au journal).",
        ],
        stuck: [
          { q: "« Cet e-mail / identifiant est déjà utilisé »", a: "Une valeur doit être unique. Si elle appartenait à un compte SUPPRIMÉ, elle est libérée automatiquement ; si elle appartient à un compte ACTIF, choisissez-en une autre." },
          { q: "Un profil a un accès qu'il ne devrait pas avoir", a: "Chaque rôle ajoute ses accès : c'est souvent un rôle cumulé. Préférez un rôle par métier, et retirez le rôle en trop." },
        ],
      },
      {
        key: "ad-rights",
        title: "Droits & pôles",
        purpose: "Voir et ajuster, pôle par pôle, quels droits chaque rôle accorde.",
        procedure: [
          "Parcourez la matrice des droits par pôle et par rôle.",
          "Ajustez les habilitations d'un rôle (droit d'administration des utilisateurs requis).",
        ],
        stuck: [
          { q: "Comprendre un accès inattendu", a: "Repérez ici quel rôle porte le droit en question, puis resserrez-le, ou retirez le rôle en trop au niveau du compte." },
        ],
      },
      {
        key: "ad-parametres",
        title: "Paramètres",
        purpose: "Réglages généraux (identité de la maison, options, langue par défaut…).",
        procedure: [
          "Ajustez les paramètres disponibles selon vos droits, et enregistrez.",
        ],
        stuck: [
          { q: "Un réglage est grisé", a: "Il demande le droit d'administration des paramètres." },
        ],
      },
      {
        key: "ad-diagnostics",
        title: "Diagnostics système",
        purpose: "Vérifier l'état technique de l'application (réservé à l'administrateur général).",
        procedure: [
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
        procedure: [
          "Faites défiler le fil ; chaque élément montre sa date et un aperçu.",
          "Cliquez un élément pour ouvrir l'annonce ou le calendrier correspondant.",
        ],
        stuck: [
          { q: "Le fil est vide", a: "Il n'y a pas encore d'actualité, ou aucune ne vous est destinée." },
        ],
      },
      {
        key: "cm-babillard",
        title: "Babillard d'annonces",
        purpose: "Lire et publier les annonces internes.",
        procedure: [
          "Lisez les annonces publiées.",
          "Pour publier (droit de saisie communication) : rédigez l'annonce et publiez-la à son audience.",
          "Réglez vos préférences de notification pour choisir ce qui vous alerte.",
        ],
        stuck: [
          { q: "Je ne peux pas publier", a: "La publication demande le droit de saisie en communication." },
        ],
      },
      {
        key: "cm-evenements",
        title: "Planning des événements",
        purpose: "Les temps forts de la maison, en vue Liste ou Calendrier, avec statut et affiche.",
        procedure: [
          "Basculez entre « 📋 Liste » (détaillée) et « 📅 Calendrier » (toute l'année d'un coup d'œil).",
          "RH et Direction : « + Ajouter » ou « Modifier » un événement ; changez le statut (à venir / à confirmer / tenu / non tenu) ; « Déposer une affiche ».",
          "Dans le calendrier, cliquez un jour coloré pour voir les événements de ce jour.",
        ],
        stuck: [
          { q: "Je ne peux pas modifier un événement", a: "La gestion est réservée au RH et à la Direction ; les autres consultent." },
          { q: "Un événement colore trop de jours", a: "Il couvre toute sa plage de dates : ouvrez-le avec « Modifier » et vérifiez ses dates de début et de fin." },
        ],
      },
      {
        key: "cm-calendrier",
        title: "Calendrier partagé",
        purpose: "Un agenda mensuel partagé (événements, anniversaires du jour).",
        procedure: [
          "Naviguez de mois en mois.",
          "Publiez un événement si vous avez le droit de saisie ; l'audience concernée est notifiée.",
        ],
        stuck: [
          { q: "Différence avec le Planning des événements", a: "Le Planning suit les grands temps forts annuels (statut + affiche) ; le Calendrier partagé est un agenda mensuel plus général." },
        ],
      },
      {
        key: "cm-bulletin",
        title: "Bulletin d'actualités",
        purpose: "Composer et envoyer le bulletin interne (digest des annonces et événements).",
        procedure: [
          "Composez un bulletin (droit de saisie communication) et prévisualisez-le.",
          "Cliquez « Envoyer » : le bulletin part par e-mail à tout le personnel.",
          "Attention : l'envoi est DÉFINITIF — après envoi, le bulletin n'est plus modifiable.",
        ],
        stuck: [
          { q: "L'envoi n'est pas parti", a: "L'envoi d'e-mail dépend de la configuration du serveur de messagerie ; sans elle, il est seulement journalisé." },
          { q: "Je veux corriger un bulletin envoyé", a: "Impossible : un bulletin envoyé est figé. Envoyez-en un nouveau avec la correction." },
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
        purpose: "La vue de pilotage : indicateurs de direction et recommandations à traiter.",
        procedure: [
          "Consultez les indicateurs de pilotage.",
          "Générez les éléments proposés (« Générer ») et traitez les recommandations (« Confirmer »).",
        ],
        stuck: [
          { q: "Réservé à la direction", a: "Cet écran demande un droit de consultation « direction »." },
        ],
      },
      {
        key: "pi-rapports",
        title: "Rapports & statistiques",
        purpose: "Analyses et statistiques de la maison.",
        procedure: [
          "Consultez les rapports disponibles ; « Générer » un rapport pour une période.",
          "Créez une analyse (« + Analyse ») et enregistrez-la si vous en avez le droit.",
        ],
        stuck: [
          { q: "Je n'ai pas accès aux rapports", a: "Réservé aux profils de pilotage (Direction, Direction éditoriale, Finance, RH)." },
        ],
      },
      {
        key: "pi-journal",
        title: "Journal d'activité",
        purpose: "La trace de tout ce qui se fait dans l'application (audit).",
        procedure: [
          "Parcourez l'historique : qui a fait quoi, quand, sur quel élément.",
          "Filtrez pour retrouver une action précise.",
        ],
        stuck: [
          { q: "Peut-on effacer une ligne du journal ?", a: "Non : le journal est inaltérable (on ne peut qu'ajouter), même pour un administrateur. C'est une garantie de traçabilité." },
        ],
      },
    ],
  },
];
