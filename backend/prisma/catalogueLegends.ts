import type { PrismaClient } from "@prisma/client";

// ─────────────────────────────────────────────────────────────────────────────
// LÉGENDES BILINGUES du catalogue (fiche partageable) — demande opérateur
// 19/11/2026. Chaque ouvrage peut porter une légende FR/EN : synopsis + libellés
// d'affichage EXACTS voulus par la maison (collection, genre, pages, ISBN, auteur
// de couverture) + prix public.
//
// Ce module est APPELÉ par deux chemins :
//   • le seed complet (prisma/seed.ts) — pour une base neuve / les tests ;
//   • un petit script dédié (prisma/seedLegends.ts) exécuté SÉPARÉMENT au
//     déploiement, pour que les légendes s'installent même si le seed complet
//     échoue ou dépasse le temps/mémoire du hook (le bloc légendes se trouvait
//     tout à la fin du seed et ne s'exécutait jamais en production).
//
// Idempotent. Rattachement ROBUSTE : on vise TOUTE fiche de l'ouvrage, repérée
// par son ISBN (officiel + ancien provisoire) OU par le numéro du seed, car en
// production la fiche affichée au catalogue (celle qui porte l'ISBN) peut
// différer de la fiche « fonds » du seed. Les synopsis sont posés en
// « fill-if-empty » (on ne recouvre jamais une saisie faite depuis l'écran).
// ─────────────────────────────────────────────────────────────────────────────

export type CatalogueLegend = {
  num: string;           // numéro d'ouvrage du seed
  title?: string;        // titre canonique (corrige casse/accents/pluriel)
  author?: string;       // auteur d'AFFICHAGE (nom de couverture / de plume) — n'efface pas l'auteur réel
  isbn?: string;         // ISBN officiel (corrige un ISBN provisoire)
  isbnText?: string;     // ISBN hyphéné affiché sur la fiche
  matchIsbns?: string[]; // ISBN (chiffres) supplémentaires pour RETROUVER la fiche (ex. ancien provisoire)
  priceFcfa?: number;    // prix public en FCFA (XAF) ; l'euro est calculé à l'affichage (parité fixe)
  collectionFr: string; collectionEn: string;
  genreFr: string; genreEn: string; genreCode?: string;
  pages?: number;
  summaryFr?: string; summaryEn?: string;
};

export const catalogueLegends: CatalogueLegend[] = [
  {
    num: "LG-CAT-0045",
    title: "L'enfant bâtard",
    author: "Tchebal Dafrik", // nom de couverture (nom de plume)
    isbnText: "978-9956-0-7767-0",
    priceFcfa: 2500,
    collectionFr: "Canari", collectionEn: "Canari",
    genreFr: "Ouvrage de sensibilisation sociale", genreEn: "Social Awareness Book", genreCode: "SENSIBILISATION",
    summaryFr:
      "Un enfant doit-il porter toute sa vie le poids des circonstances de sa naissance ?\n\n" +
      "Dans cet ouvrage engagé, Tchebal Dafrik s'attaque aux préjugés sociaux et aux discriminations dont sont victimes les enfants nés hors mariage, trop souvent désignés par le terme stigmatisant d'« enfants bâtards ». À travers une réflexion personnelle et sociale, l'auteur dénonce une réalité profondément injuste : des enfants innocents qui subissent le rejet, les humiliations et les jugements d'une société qui les tient responsables de circonstances indépendantes de leur volonté.\n\n" +
      "L'auteur interpelle également les parents, particulièrement les hommes, sur leur responsabilité dans les situations de monoparentalité et leurs conséquences sur l'épanouissement des enfants. Il invite les mères célibataires et leurs enfants à dépasser la stigmatisation, à préserver leur dignité et à revendiquer pleinement leur place dans la société.\n\n" +
      "Un ouvrage de sensibilisation qui appelle à déconstruire les préjugés, à promouvoir l'égalité de traitement et à rappeler une vérité fondamentale : aucun enfant ne devrait être condamné pour les conditions de sa naissance.",
    summaryEn:
      "Should a child have to carry the burden of the circumstances of their birth throughout their entire life?\n\n" +
      "In this thought-provoking and socially engaged work, Tchebal Dafrik challenges the social prejudices and discrimination faced by children born out of wedlock, who are often subjected to the derogatory label of illegitimacy. Through personal reflection and social commentary, the author exposes a deeply unjust reality: innocent children endure rejection, humiliation and judgment from a society that holds them responsible for circumstances beyond their control.\n\n" +
      "The author also calls upon parents, particularly fathers, to acknowledge their responsibilities in situations of single parenthood and their impact on children's well-being. He encourages single mothers and their children to rise above social stigma, preserve their dignity and confidently claim their rightful place in society.\n\n" +
      "A powerful work of social awareness that challenges prejudice, promotes equal treatment and upholds a fundamental truth: no child should ever be judged or condemned because of the circumstances of their birth.",
  },
  {
    num: "LG-CAT-0072",
    title: "Ces vies que j'aurais vécues",
    author: "Irène Maben",
    isbnText: "978-9956-36-285-1",
    collectionFr: "Canari", collectionEn: "Canari",
    genreFr: "Roman", genreEn: "Novel", genreCode: "ROMAN",
    pages: 185,
    summaryFr:
      "Et si nos rêves nous révélaient des fragments d'autres vies ?\n\n" +
      "Sous une apparence ordinaire, certaines existences cachent des mystères qui défient toute logique. Dans ce roman fascinant, Irène Maben nous entraîne dans l'univers d'une héroïne qui, au fil de ses rêves, voyage à travers différentes époques et se retrouve dans la peau de personnages inconnus, sans lien apparent avec sa vie actuelle.\n\n" +
      "Troublée par ces expériences mystérieuses, elle entreprend une véritable enquête aux frontières du paranormal pour comprendre ce passé énigmatique dont elle ne garde aucun souvenir et tenter de réparer le présent. Ses investigations la conduisent au cœur de l'histoire profonde de sa famille, où les événements d'hier semblent étrangement faire écho à ceux d'aujourd'hui.\n\n" +
      "Entre rêves troublants, révélations familiales et coïncidences inexplicables, l'héroïne découvre progressivement l'existence de forces invisibles qui pourraient influencer le monde réel.\n\n" +
      "Un roman captivant aux accents mystérieux qui explore les liens entre passé et présent, mémoire et destinée, tout en interrogeant les frontières entre le visible et l'invisible.",
    summaryEn:
      "What if our dreams revealed fragments of other lives?\n\n" +
      "Behind an ordinary appearance, some lives conceal mysteries that defy all logic. In this fascinating novel, Irène Maben takes readers into the world of a heroine who, through her dreams, travels across different eras and finds herself inhabiting the lives of unfamiliar characters with no apparent connection to her present existence.\n\n" +
      "Disturbed by these mysterious experiences, she embarks on an extraordinary investigation into the paranormal in an attempt to uncover a forgotten past and make sense of the present. Her search leads her deep into her family's history, where events from yesterday seem strangely intertwined with those of today.\n\n" +
      "Between unsettling dreams, family revelations and inexplicable coincidences, the heroine gradually discovers the existence of invisible forces that may be shaping the world around her.\n\n" +
      "A captivating novel filled with mystery and intrigue, exploring the connections between past and present, memory and destiny, while challenging the boundaries between the visible and the invisible.",
  },
  {
    num: "LG-CAT-0051",
    title: "Victimes",
    author: "Irène Maben",
    isbnText: "978-9956-36-278-3",
    collectionFr: "Canari", collectionEn: "Canari",
    genreFr: "Recueil de nouvelles", genreEn: "Short Story Collection", genreCode: "NOUVELLE",
    pages: 134,
    // Résumé FRANÇAIS : traduction fidèle de la version anglaise (demande
    // opérateur, l'original français n'ayant pas été transmis).
    summaryFr:
      "Et si les victimes d'aujourd'hui devenaient les bourreaux de demain ?\n\n" +
      "Dans ce recueil de nouvelles bouleversant, Irène Maben explore les multiples visages de la souffrance humaine et les conséquences parfois dévastatrices des injustices de la vie. À travers des personnages confrontés à des situations difficiles, l'autrice met en lumière les blessures psychologiques, émotionnelles et relationnelles que peuvent engendrer les épreuves, la violence et l'abandon.\n\n" +
      "Fragilisées par leur situation, certaines victimes sombrent dans le désespoir et risquent de reproduire les comportements mêmes qui les ont fait souffrir.\n\n" +
      "Avec sensibilité et profondeur, l'autrice invite le lecteur à réfléchir à notre responsabilité collective envers ceux qui souffrent. Elle nous encourage à dépasser l'indifférence, à tendre la main à ceux que la vie a blessés et à contribuer à leur reconstruction.\n\n" +
      "Un recueil poignant et profondément humain qui rappelle que, derrière chaque victime, se cachent une histoire, une blessure et un profond besoin d'humanité.",
    summaryEn:
      "What if today's victims became tomorrow's perpetrators?\n\n" +
      "In this moving collection of short stories, Irène Maben explores the many faces of human suffering and the sometimes devastating consequences of life's injustices. Through characters facing difficult circumstances, the author highlights the psychological, emotional and relational wounds that can result from hardship, violence and abandonment.\n\n" +
      "Weakened by their circumstances, some victims fall into despair and risk repeating the very behaviours that once caused them pain.\n\n" +
      "With sensitivity and depth, the author challenges readers to reflect on their collective responsibility towards those who suffer. She encourages us to overcome indifference, extend a helping hand to those wounded by life's hardships and contribute to their healing and recovery.\n\n" +
      "A thought-provoking and deeply moving collection that reminds us that behind every victim lies a story, a wound and a profound need for humanity.",
  },
  {
    num: "LG-CAT-0075",
    title: "Félonica, la femme de chez nous",
    author: "Solange Nsomo",
    isbn: "9789956078561", // ISBN officiel (remplace l'ISBN provisoire)
    isbnText: "978-9956-0-7856-1",
    matchIsbns: ["9782001900176"], // ancien ISBN provisoire (pour retrouver la fiche)
    collectionFr: "Canari", collectionEn: "Canari",
    genreFr: "Roman", genreEn: "Novel", genreCode: "ROMAN",
    pages: 164,
    summaryFr:
      "Que signifie véritablement être une femme au sein d'une famille et d'une communauté ?\n\n" +
      "À travers le personnage de Félonica, Solange Nsomo dresse le portrait d'une femme au caractère exceptionnel, à la fois forte, maternelle et résiliente. Mariée à Ndjouby, elle apprend à s'adapter à un environnement socioculturel qui lui impose de nombreux défis : les responsabilités familiales, l'éducation des enfants, les travaux communautaires, les traditions et les réalités du quotidien.\n\n" +
      "Par sa détermination, son travail et sa capacité à surmonter les épreuves, Félonica parvient à s'imposer et à gagner la reconnaissance de son entourage. Belle, travailleuse, parfois soumise, mais aussi capable de colère, elle incarne toute la complexité de la condition féminine dans son environnement social.\n\n" +
      "Un roman authentique et profondément humain qui explore la place de la femme dans la famille et la société, tout en mettant en lumière sa force, son courage et sa contribution à l'équilibre familial.",
    summaryEn:
      "What does it truly mean to be a woman within a family and a community?\n\n" +
      "Through the character of Felonica, Solange Nsomo portrays an extraordinary woman who is strong, nurturing and resilient. Married to Ndjouby, she learns to adapt to a sociocultural environment that presents her with numerous challenges: family responsibilities, raising children, community work, traditions and the realities of everyday life.\n\n" +
      "Through determination, hard work and her ability to overcome adversity, Felonica gradually earns her place and the respect of those around her. Beautiful and hardworking, sometimes submissive, yet occasionally outspoken and temperamental, she embodies the many complexities of womanhood within her social environment.\n\n" +
      "An authentic and deeply human novel that explores the role of women in family and society, while highlighting their strength, courage and invaluable contribution to family life.",
  },
  {
    num: "LG-CAT-0048",
    title: "J'étais une femme riche",
    author: "Irène Maben",
    isbnText: "978-9956-0-7836-3",
    collectionFr: "Canari", collectionEn: "Canari",
    genreFr: "Roman", genreEn: "Novel", genreCode: "ROMAN",
    pages: 181,
    summaryFr:
      "La richesse fait-elle nécessairement le bonheur ?\n\n" +
      "Dans ce roman profondément humain, Irène Maben nous plonge dans l'univers d'une femme ambitieuse qui, partie de rêves modestes, gravit progressivement les échelons de la réussite jusqu'à atteindre la richesse et la célébrité. Pourtant, derrière cette réussite sociale se cache une réalité bien plus complexe : la solitude.\n\n" +
      "Entre pouvoir, ambition, réussite matérielle et quête d'épanouissement personnel, l'héroïne découvre que posséder beaucoup ne signifie pas forcément être heureuse. Privée de véritables amitiés et de relations sincères, elle réalise que l'argent ne peut acheter ni l'affection, ni la confiance, ni la présence humaine.\n\n" +
      "Un roman captivant qui interroge notre rapport à la richesse, au pouvoir et au bonheur, tout en invitant à réfléchir sur le véritable sens de la réussite.",
    summaryEn:
      "Does wealth necessarily bring happiness?\n\n" +
      "In this deeply human novel, Irène Maben takes readers into the world of an ambitious woman who rises from modest dreams to achieve wealth, success and fame. Yet behind this remarkable social ascent lies a far more complex reality: loneliness.\n\n" +
      "Caught between power, ambition, material success and the pursuit of personal fulfilment, the protagonist discovers that having everything does not necessarily mean being happy. Deprived of genuine friendships and meaningful relationships, she comes to realise that money cannot buy affection, trust or human companionship.\n\n" +
      "A compelling novel that explores our relationship with wealth, power and happiness, while inviting readers to reconsider the true meaning of success.",
  },
];

// Domaines nécessaires aux légendes (ajoutés au référentiel si absents).
const NEEDED_GENRES = [
  { code: "NOUVELLE", label: "Nouvelle & récit" },
  { code: "SENSIBILISATION", label: "Ouvrage de sensibilisation sociale" },
];

export async function applyCatalogueLegends(prisma: PrismaClient): Promise<{ legends: number; records: number }> {
  for (const g of NEEDED_GENRES) {
    await prisma.genre.upsert({ where: { code: g.code }, update: { label: g.label, deletedAt: null }, create: g });
  }
  const genresByCode = new Map((await prisma.genre.findMany({ select: { id: true, code: true } })).map((g) => [g.code, g.id]));

  let legends = 0;
  let records = 0;
  for (const lg of catalogueLegends) {
    const isbnDigits = Array.from(
      new Set(
        [lg.isbn, lg.isbnText, ...(lg.matchIsbns ?? [])]
          .filter(Boolean)
          .map((s) => String(s).replace(/\D/g, ""))
          .filter((s) => s.length >= 10),
      ),
    );
    const targets = await prisma.manuscript.findMany({
      where: {
        deletedAt: null,
        OR: [
          { manuscriptNumber: lg.num },
          ...(isbnDigits.length ? [{ isbns: { some: { isbn13: { in: isbnDigits } } } }] : []),
        ],
      },
      select: { id: true, summary: true, summaryEn: true },
    });
    if (targets.length === 0) continue;
    const genreId = lg.genreCode ? genresByCode.get(lg.genreCode) ?? null : null;
    for (const ms of targets) {
      const data: Record<string, unknown> = {
        legendCollectionFr: lg.collectionFr,
        legendCollectionEn: lg.collectionEn,
        legendGenreFr: lg.genreFr,
        legendGenreEn: lg.genreEn,
        legendPages: lg.pages ?? null,
        legendIsbn: lg.isbnText ?? null,
        legendAuthor: lg.author ?? null,
      };
      if (lg.title) data.title = lg.title;
      if (genreId) data.genreId = genreId;
      // Synopsis : ne jamais recouvrir une saisie existante (fill-if-empty).
      if (lg.summaryFr && !(ms.summary && ms.summary.trim())) data.summary = lg.summaryFr;
      if (lg.summaryEn && !(ms.summaryEn && ms.summaryEn.trim())) data.summaryEn = lg.summaryEn;
      await prisma.manuscript.update({ where: { id: ms.id }, data });

      // Prix public (FCFA) — renseigné s'il est fourni dans la légende.
      if (lg.priceFcfa != null) {
        await prisma.workMetadata.upsert({
          where: { manuscriptId: ms.id },
          update: { pricePublic: lg.priceFcfa },
          create: { manuscriptId: ms.id, pricePublic: lg.priceFcfa },
        });
      }

      // ISBN officiel (corrige un provisoire), en respectant « ISBN jamais réutilisé ».
      if (lg.isbn) {
        const clash = await prisma.isbn.findFirst({ where: { isbn13: lg.isbn, manuscriptId: { not: ms.id } } });
        if (!clash) {
          const existing = await prisma.isbn.findFirst({ where: { manuscriptId: ms.id, format: "print" } });
          if (!existing) {
            await prisma.isbn.create({ data: { isbn13: lg.isbn, format: "print", manuscriptId: ms.id, status: "published", assignedAt: new Date() } });
          } else if (existing.isbn13 !== lg.isbn) {
            await prisma.isbn.update({ where: { id: existing.id }, data: { isbn13: lg.isbn } });
          }
        }
      }
      records++;
    }
    legends++;
  }
  return { legends, records };
}
