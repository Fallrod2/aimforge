/**
 * Le garde-fou de **français** des sorties IA (Vague 3.1).
 *
 * Module **pur** : aucune dépendance au réseau, à Supabase ou au SDK d'un
 * fournisseur — comme la police des scénarios (`./scenarios.ts`), il vit entre
 * la réponse du modèle et ce que le client reçoit, et il se prouve en fixture.
 *
 * ## Pourquoi
 *
 * Des générations réelles ont livré « tes stabilisations si tu **tenus** ces
 * deux blocs », « **Ton est très bas**, chaque run compte », « avant de bouger.
 * **mérite** un travail ciblé », « car **se construira** bloc par bloc ». Le
 * motif est toujours le même : une phrase bâtie autour d'une **citation de
 * donnée** (`[HS% 23]`, un nom de scénario) à qui le modèle laisse porter le
 * rôle de sujet. La citation saute ou se place mal, et la phrase se disloque.
 * Un conseil juste écrit dans un français cassé n'est pas un conseil juste :
 * c'est un produit qui a l'air faux.
 *
 * ## Ce que ce module fait, et ce qu'il ne fait pas
 *
 * La frontière est nette, et c'est elle qui rend le module sûr :
 *
 * - **il répare la typographie mécanique** — majuscule après un point, doubles
 *   espaces, espace parasite avant une virgule, espace manquant après. Ces
 *   corrections ne touchent pas au sens : on peut les appliquer sans rien
 *   comprendre à la phrase ;
 * - **il ne réécrit jamais une phrase**. Un fragment sans verbe, un sujet
 *   manquant, une conjugaison impossible sont **signalés** (compteur + une
 *   ligne de journal structurée), pas corrigés. Réécrire demanderait de deviner
 *   ce que le modèle voulait dire, et un garde-fou qui invente du sens est pire
 *   que la faute qu'il corrige. Le vrai correctif est en amont, dans les
 *   prompts ; ce module mesure ce qui passe encore.
 *
 * ## Les zones protégées
 *
 * Rien n'est retouché à l'intérieur d'une URL, d'un segment entre crochets (les
 * marqueurs de citation, `[SOURCES]`) ni d'un nom de scénario passé en option.
 * « VT 1w4ts Novice » n'est pas du français : lui appliquer des règles de
 * français produirait exactement la faute qu'on essaie d'éviter.
 *
 * ## L'honnêteté des heuristiques
 *
 * La détection de verbe conjugué s'appuie sur une **liste fermée** de formes
 * fréquentes et sur la position du mot (après un pronom sujet, en tête de
 * clause). Elle est volontairement incomplète : un verbe rare passera pour
 * absent. C'est acceptable parce que la sortie de ce module est un **signal**
 * — un compteur à regarder, pas un verdict qui bloque une réponse.
 */

/**
 * Le rôle d'un champ : tous les textes n'ont pas à être des phrases.
 *
 * Trois rôles, et la distinction vient d'une campagne réelle (20 routines, 20
 * fils, `deepseek/deepseek-v4-flash-0731`) où la moitié des signalements
 * étaient faux faute de l'avoir faite :
 *
 * - `titre` — « Bloc de tracking ». Aucun contrôle de phrase ;
 * - `consigne` — le `detail` d'un exercice, la réponse du fil. La phrase
 *   nominale y est **correcte** : « Deux runs de cinq minutes. », « Objectif
 *   concret : atteindre 480. » sont du français juste, et c'est la forme qu'on
 *   veut dans une consigne d'entraînement. Elle n'est signalée que si elle
 *   trahit une **rupture** — commencer par une minuscule, ou n'être qu'une
 *   subordonnée ;
 * - `phrase` — le résumé d'un debrief, un conseil, un focus. Là, une phrase
 *   sans verbe est une phrase inachevée.
 */
export type FrenchRole = "phrase" | "consigne" | "titre";

/** Une correction mécanique, donc appliquée. */
export type FrenchFixKind =
  | "majuscule_apres_point"
  | "double_espace"
  | "espace_avant_ponctuation"
  | "espace_apres_ponctuation";

/** Un défaut de structure, donc signalé mais **jamais** corrigé. */
export type FrenchIssueKind =
  | "minuscule_apres_point"
  | "phrase_sans_verbe"
  | "fragment_subordonne"
  | "sujet_manquant"
  | "conjugaison_2e_personne"
  | "citation_sujet";

export interface FrenchFix {
  readonly kind: FrenchFixKind;
  readonly count: number;
}

export interface FrenchIssue {
  readonly kind: FrenchIssueKind;
  /** L'extrait fautif, coupé court : c'est un journal, pas une archive. */
  readonly excerpt: string;
  /** Le champ d'où vient l'extrait, quand l'appelant l'a nommé. */
  readonly field?: string;
}

export interface FrenchGuardOptions {
  /**
   * Les noms à ne jamais retoucher : scénarios KovaaK's, en pratique. Ils sont
   * en anglais et n'obéissent pas à la typographie française.
   */
  readonly protectedNames?: readonly string[];
  /** `titre` désactive les contrôles qui exigent une phrase complète. */
  readonly role?: FrenchRole;
}

export interface FrenchReport {
  /** Le texte après corrections mécaniques : c'est lui qu'on rend au client. */
  readonly text: string;
  readonly fixes: readonly FrenchFix[];
  readonly issues: readonly FrenchIssue[];
}

/* ------------------------------------------------------------------ */
/* Zones protégées                                                     */
/* ------------------------------------------------------------------ */

/**
 * `matchAll` plutôt qu'un `exec` en boucle sur ces deux constantes : le drapeau
 * `g` porte un `lastIndex` qu'une regex de module partagerait entre deux
 * appels. `matchAll` travaille sur une copie, donc l'état ne fuit pas.
 */
const URL_PATTERN = /(?:https?:\/\/|www\.)\S+/giu;
const BRACKET_PATTERN = /\[[^\]\n]*\]/gu;

/** Un booléen par caractère : `true` = intouchable. */
function protectedMask(text: string, names: readonly string[]): readonly boolean[] {
  const mask = new Array<boolean>(text.length).fill(false);
  const cover = (start: number, end: number): void => {
    for (let index = Math.max(0, start); index < Math.min(text.length, end); index += 1) {
      mask[index] = true;
    }
  };

  for (const match of text.matchAll(URL_PATTERN)) cover(match.index, match.index + match[0].length);
  for (const match of text.matchAll(BRACKET_PATTERN)) {
    cover(match.index, match.index + match[0].length);
  }
  for (const name of names) {
    if (name === "") continue;

    let from = text.indexOf(name);

    while (from !== -1) {
      cover(from, from + name.length);
      from = text.indexOf(name, from + name.length);
    }
  }
  return mask;
}

/** Un remplacement qui saute tout ce qui touche une zone protégée. */
function replaceOutside(
  text: string,
  mask: readonly boolean[],
  pattern: RegExp,
  replace: (match: RegExpMatchArray, index: number) => string | null,
): { readonly text: string; readonly count: number } {
  let out = "";
  let cursor = 0;
  let count = 0;

  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    const end = start + match[0].length;
    // La zone regardée déborde d'un caractère : plusieurs règles s'appuient sur
    // une anticipation (le caractère qui suit la ponctuation) qui ne fait pas
    // partie de la correspondance.
    const touched = mask.slice(start, Math.min(text.length, end + 1)).some(Boolean);

    if (touched) continue;

    const replacement = replace(match, start);

    if (replacement === null) continue;
    out += text.slice(cursor, start) + replacement;
    cursor = end;
    count += 1;
  }
  return { text: out + text.slice(cursor), count };
}

/* ------------------------------------------------------------------ */
/* Corrections mécaniques                                              */
/* ------------------------------------------------------------------ */

/**
 * Les abréviations après lesquelles un point ne termine pas la phrase.
 *
 * Liste courte et fermée : chaque entrée est une majuscule qu'on renonce à
 * poser. En cas de doute, ne rien faire vaut mieux que défigurer un texte juste.
 */
const ABBREVIATIONS: ReadonlySet<string> = new Set([
  "art",
  "cf",
  "env",
  "etc",
  "ex",
  "fig",
  "min",
  "mme",
  "mlle",
  "no",
  "p",
  "réf",
  "sec",
  "st",
  "vs",
]);

const DOUBLE_SPACE = /[ \t]{2,}/gu;
const SPACE_BEFORE = /[ \t]+(?=[,.])/gu;
const SPACE_AFTER = /[,.](?=\p{L})/gu;
const STOP_THEN_LOWER = /([.!?…])([ \t]+|\n+)(\p{Ll})/gu;

/** Le mot (ou le chiffre) qui précède immédiatement un point. */
function tokenBefore(text: string, index: number): string {
  const before = text.slice(0, index);
  const match = /([\p{L}\p{N}]+)$/u.exec(before);

  return (match?.[1] ?? "").toLowerCase();
}

/** Un point qui suit une abréviation connue ou un chiffre ne clôt pas la phrase. */
function endsSentence(text: string, stopIndex: number): boolean {
  const stop = text[stopIndex];

  if (stop !== ".") return true;

  const token = tokenBefore(text, stopIndex);

  if (token === "") return true;
  if (/^\p{N}+$/u.test(token)) return false;
  return !ABBREVIATIONS.has(token);
}

/**
 * La typographie mécanique, réparée. Le sens n'est jamais touché : chacune de
 * ces quatre règles se décide sans lire la phrase.
 */
export function repairFrench(
  text: string,
  options: FrenchGuardOptions = {},
): { readonly text: string; readonly fixes: readonly FrenchFix[] } {
  const names = options.protectedNames ?? [];
  const counts = new Map<FrenchFixKind, number>();
  const bump = (kind: FrenchFixKind, count: number): void => {
    if (count > 0) counts.set(kind, (counts.get(kind) ?? 0) + count);
  };

  let current = text;

  const doubles = replaceOutside(current, protectedMask(current, names), DOUBLE_SPACE, () => " ");

  current = doubles.text;
  bump("double_espace", doubles.count);

  const before = replaceOutside(current, protectedMask(current, names), SPACE_BEFORE, () => "");

  current = before.text;
  bump("espace_avant_ponctuation", before.count);

  const after = replaceOutside(
    current,
    protectedMask(current, names),
    SPACE_AFTER,
    (match) => `${match[0]} `,
  );

  current = after.text;
  bump("espace_apres_ponctuation", after.count);

  const capitalized = replaceOutside(
    current,
    protectedMask(current, names),
    STOP_THEN_LOWER,
    (match, index) => {
      if (!endsSentence(current, index)) return null;

      const [, stop = "", gap = "", letter = ""] = match;

      return `${stop}${gap}${letter.toLocaleUpperCase("fr")}`;
    },
  );

  current = capitalized.text;
  bump("majuscule_apres_point", capitalized.count);

  return {
    text: current,
    fixes: [...counts].map(([kind, count]) => ({ kind, count })),
  };
}

/* ------------------------------------------------------------------ */
/* Découpage et vocabulaire                                            */
/* ------------------------------------------------------------------ */

/**
 * Les phrases d'un texte : une ligne à la fois, puce de liste retirée, puis
 * découpage sur la ponctuation forte.
 *
 * Le découpage par ligne vient du chat et du fil, dont le prompt autorise « des
 * tirets en début de ligne pour une courte liste » : sans lui, deux puces
 * successives seraient lues comme une seule phrase interminable.
 */
export function splitFrenchSentences(text: string): readonly string[] {
  return text
    .split(/\r?\n+/u)
    .flatMap((line) => line.replace(/^\s*(?:[-–—•*]|\d+[.)])\s+/u, "").split(/(?<=[.!?…])\s+/u))
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== "");
}

const TOKEN = /\p{L}+['’]|\p{L}+|\p{N}+(?:[.,]\p{N}+)?/gu;

/** Les mots d'une phrase, en minuscules, apostrophes normalisées et collées. */
export function frenchTokens(sentence: string): readonly string[] {
  return sentence.toLocaleLowerCase("fr").replace(/’/gu, "'").match(TOKEN) ?? [];
}

/** Les formes conjuguées d'un verbe régulier du premier groupe. */
function erForms(stem: string): readonly string[] {
  return [
    `${stem}e`,
    `${stem}es`,
    `${stem}ent`,
    `${stem}ons`,
    `${stem}ez`,
    `${stem}ais`,
    `${stem}ait`,
    `${stem}aient`,
    `${stem}erai`,
    `${stem}eras`,
    `${stem}era`,
    `${stem}erons`,
    `${stem}erez`,
    `${stem}eront`,
    `${stem}erais`,
    `${stem}erait`,
    `${stem}eraient`,
  ];
}

/**
 * Les radicaux du premier groupe qui reviennent dans le vocabulaire du coach.
 *
 * Générer les formes plutôt que les écrire : dix-sept formes par verbe écrites
 * à la main dérivent au premier oubli, et l'oubli ne se verrait que sous la
 * forme d'un faux positif silencieux dans un journal.
 */
const ER_STEMS: readonly string[] = [
  "activ",
  "ajust",
  "altern",
  "amélior",
  "appliqu",
  "arrêt",
  "augment",
  "baiss",
  "bloqu",
  "boug",
  "calcul",
  "chang",
  "chauff",
  "cherch",
  "cibl",
  "command",
  "commenc",
  "compar",
  "compt",
  "concentr",
  "continu",
  "corrig",
  "coup",
  "coût",
  "demand",
  "démarr",
  "dur",
  "échauff",
  "écout",
  "enchaîn",
  "enchain",
  "entraîn",
  "étir",
  "évit",
  "expliqu",
  "ferm",
  "forc",
  "gagn",
  "gard",
  "grimp",
  "jou",
  "laiss",
  "lanc",
  "lev",
  "limit",
  "manqu",
  "march",
  "mesur",
  "mérit",
  "mont",
  "montr",
  "not",
  "oubli",
  "pass",
  "pens",
  "plac",
  "point",
  "pouss",
  "prépar",
  "privilégi",
  "progress",
  "ralent",
  "rat",
  "regard",
  "relâch",
  "relanc",
  "renforc",
  "replac",
  "rest",
  "sécuris",
  "serr",
  "stabilis",
  "termin",
  "test",
  "tir",
  "tomb",
  "travaill",
  "trouv",
  "utilis",
  "vari",
  "vérifi",
  "vis",
];

/**
 * Les formes conjuguées reconnues sans contexte.
 *
 * Volontairement fermée : elle couvre les auxiliaires, les modaux et les verbes
 * irréguliers courants du registre, plus les verbes du premier groupe générés
 * ci-dessus. Un verbe absent d'ici n'est pas « faux » — il est simplement
 * invisible pour l'heuristique, et une phrase qui ne contiendrait que lui sera
 * signalée à tort. Voir l'en-tête : c'est un signal, pas un verdict.
 */
const CONJUGATED: ReadonlySet<string> = new Set([
  ...ER_STEMS.flatMap(erForms),
  // être
  "suis",
  "es",
  "est",
  "sommes",
  "êtes",
  "sont",
  "étais",
  "était",
  "étions",
  "étiez",
  "étaient",
  "serai",
  "seras",
  "sera",
  "serons",
  "serez",
  "seront",
  "serais",
  "serait",
  "serions",
  "seraient",
  "sois",
  "soit",
  "soyons",
  "soyez",
  "soient",
  "fut",
  "furent",
  // avoir
  "ai",
  "as",
  "a",
  "avons",
  "avez",
  "ont",
  "avais",
  "avait",
  "avions",
  "aviez",
  "avaient",
  "aurai",
  "auras",
  "aura",
  "aurons",
  "aurez",
  "auront",
  "aurais",
  "aurait",
  "auraient",
  "aie",
  "aies",
  "ait",
  "ayons",
  "ayez",
  "aient",
  // aller
  "vais",
  "vas",
  "va",
  "allons",
  "allez",
  "vont",
  "allait",
  "allaient",
  "irai",
  "iras",
  "ira",
  "irons",
  "irez",
  "iront",
  "irais",
  "irait",
  "aille",
  "aillent",
  // faire
  "fais",
  "fait",
  "faisons",
  "faites",
  "font",
  "faisais",
  "faisait",
  "faisaient",
  "ferai",
  "feras",
  "fera",
  "ferons",
  "ferez",
  "feront",
  "ferais",
  "ferait",
  "feraient",
  "fasse",
  "fasses",
  "fassent",
  // pouvoir
  "peux",
  "peut",
  "pouvons",
  "pouvez",
  "peuvent",
  "pouvais",
  "pouvait",
  "pouvaient",
  "pourrai",
  "pourras",
  "pourra",
  "pourrons",
  "pourrez",
  "pourront",
  "pourrais",
  "pourrait",
  "pourraient",
  "puisse",
  "puisses",
  "puissent",
  // devoir
  "dois",
  "doit",
  "devons",
  "devez",
  "doivent",
  "devais",
  "devait",
  "devaient",
  "devrai",
  "devras",
  "devra",
  "devrons",
  "devrez",
  "devront",
  "devrais",
  "devrait",
  "devraient",
  "doive",
  // vouloir
  "veux",
  "veut",
  "voulons",
  "voulez",
  "veulent",
  "voulais",
  "voulait",
  "voudrai",
  "voudras",
  "voudra",
  "voudrais",
  "voudrait",
  "veuille",
  // savoir
  "sais",
  "sait",
  "savons",
  "savez",
  "savent",
  "savais",
  "savait",
  "saurai",
  "sauras",
  "saura",
  "saurais",
  "saurait",
  "sache",
  "sachent",
  // falloir, valoir, suffire, permettre
  "faut",
  "fallait",
  "faudra",
  "faudrait",
  "vaut",
  "valent",
  "vaudra",
  "vaudrait",
  "suffit",
  "suffisent",
  "suffira",
  "suffirait",
  "permet",
  "permettent",
  "permettra",
  "permettrait",
  // prendre et sa famille
  "prends",
  "prend",
  "prenons",
  "prenez",
  "prennent",
  "prenais",
  "prenait",
  "prendrai",
  "prendras",
  "prendra",
  "prendrons",
  "prendrez",
  "prendront",
  "prendrais",
  "prendrait",
  "prenne",
  "apprends",
  "apprend",
  "apprennent",
  "comprends",
  "comprend",
  "comprennent",
  "reprends",
  "reprend",
  "reprennent",
  // mettre
  "mets",
  "met",
  "mettons",
  "mettez",
  "mettent",
  "mettais",
  "mettait",
  "mettrai",
  "mettras",
  "mettra",
  "mettrais",
  "mettrait",
  "mette",
  // tenir, venir
  "tiens",
  "tient",
  "tenons",
  "tenez",
  "tiennent",
  "tenais",
  "tenait",
  "tiendrai",
  "tiendras",
  "tiendra",
  "tiendrais",
  "tiendrait",
  "tienne",
  "viens",
  "vient",
  "venons",
  "venez",
  "viennent",
  "venait",
  "viendrai",
  "viendras",
  "viendra",
  "viendrait",
  "vienne",
  // voir, dire, lire, écrire
  "vois",
  "voit",
  "voyons",
  "voyez",
  "voient",
  "voyais",
  "voyait",
  "verrai",
  "verras",
  "verra",
  "verrais",
  "verrait",
  "voie",
  "dis",
  "dit",
  "disent",
  "dira",
  "dirait",
  "lis",
  "lit",
  "lisent",
  "écris",
  "écrit",
  "écrivent",
  // rendre, perdre, attendre, entendre, descendre, répondre
  "rends",
  "rend",
  "rendent",
  "rendra",
  "perds",
  "perd",
  "perdent",
  "perdra",
  "perdait",
  "attends",
  "attend",
  "attendent",
  "entends",
  "entend",
  "entendent",
  "descends",
  "descend",
  "descendent",
  "réponds",
  "répond",
  "répondent",
  // construire, produire, réduire
  "construis",
  "construit",
  "construisent",
  "construira",
  "construiront",
  "construisait",
  "produit",
  "produisent",
  "réduis",
  "réduit",
  "réduisent",
  "réduira",
  // servir, sortir, partir, finir, réussir, choisir, suivre
  "sers",
  "sert",
  "servent",
  "servira",
  "sors",
  "sort",
  "sortent",
  "sortira",
  "pars",
  "part",
  "partent",
  "finis",
  "finit",
  "finissent",
  "finira",
  "réussis",
  "réussit",
  "réussissent",
  "choisis",
  "choisit",
  "choisissent",
  "suit",
  "suivent",
  "suivra",
  "suivait",
]);

/** Ce qui peut précéder un verbe sans être un sujet plein : pronoms et clitiques. */
const CLITICS: ReadonlySet<string> = new Set([
  "je",
  "j'",
  "tu",
  "il",
  "elle",
  "on",
  "nous",
  "vous",
  "ils",
  "elles",
  "ce",
  "c'",
  "ça",
  "cela",
  "qui",
  "que",
  "qu'",
  "se",
  "s'",
  "te",
  "t'",
  "me",
  "m'",
  "ne",
  "n'",
  "y",
  "en",
  "lui",
  "leur",
]);

/** Terminaisons verbales, acceptées **seulement** après un pronom ou un clitique. */
const VERB_ENDING = /(?:ent|ons|ez|ais|ait|aient|rai|ras|ra|rons|rez|ront|is|it|es|e|s|t)$/u;

/**
 * Les terminaisons qui, à elles seules, disent le verbe : imparfait,
 * conditionnel, futur, passé simple.
 *
 * Elles ne dépendent d'aucune liste de radicaux, et c'est tout leur intérêt —
 * « pointait », « verrais », « stabiliseront » sont reconnus sans que personne
 * ait eu à penser au verbe. Les terminaisons ambiguës du présent (`-e`, `-es`,
 * `-ent`, `-ons`) en sont **exclues** : « séance », « moment », « talent »,
 * « bons » les portent aussi, et les accepter noierait la détection.
 */
const TENSE_ENDING =
  /(?:ais|ait|aient|erai|eras|era|erons|erez|eront|irai|iras|ira|irons|irez|iront|issons|issez|issent|èrent)$/u;

/**
 * Les mots qui portent une terminaison verbale sans être des verbes.
 *
 * Presque tous en `-ait` / `-ais` : c'est la rançon d'une règle purement
 * morphologique, et elle se paie par une liste — courte, parce que ces
 * homographes-là sont peu nombreux.
 */
const NOT_A_VERB: ReadonlySet<string> = new Set([
  "trait",
  "portrait",
  "retrait",
  "extrait",
  "attrait",
  "souhait",
  "forfait",
  "parfait",
  "imparfait",
  "lait",
  "plait",
  "palais",
  "marais",
  "jamais",
  "mais",
  "désormais",
  "biais",
  "balais",
  "relais",
  "essais",
  "délais",
  "frais",
  "vrais",
  "gais",
  "rais",
  "opéra",
  "caméra",
]);

/**
 * Les classes **fermées** du français : déterminants, numéraux, pronoms,
 * prépositions, conjonctions, adverbes courants.
 *
 * C'est l'inversion qui rend la reconnaissance de l'impératif tenable. Les
 * verbes forment une classe ouverte — on ne peut pas les lister —, mais ce qui
 * ouvre une phrase **sans** être un verbe appartient presque toujours à une
 * classe fermée, elle, énumérable. On ne dit donc pas « ce mot est un verbe »,
 * on dit « ce mot n'est aucune des choses qu'un verbe n'est pas ».
 */
const CLOSED_CLASS: ReadonlySet<string> = new Set([
  // déterminants et pronoms
  "le",
  "la",
  "les",
  "l'",
  "un",
  "une",
  "des",
  "du",
  "de",
  "d'",
  "ce",
  "cet",
  "cette",
  "ces",
  "mon",
  "ma",
  "mes",
  "ton",
  "ta",
  "tes",
  "son",
  "sa",
  "ses",
  "notre",
  "nos",
  "votre",
  "vos",
  "leur",
  "leurs",
  "chaque",
  "quelque",
  "quelques",
  "plusieurs",
  "certains",
  "certaines",
  "tout",
  "toute",
  "toutes",
  "tous",
  "même",
  "mêmes",
  "autre",
  "autres",
  "tel",
  "telle",
  "aucun",
  "aucune",
  "je",
  "tu",
  "il",
  "elle",
  "on",
  "nous",
  "vous",
  "ils",
  "elles",
  // numéraux
  "deux",
  "trois",
  "quatre",
  "cinq",
  "six",
  "sept",
  "huit",
  "neuf",
  "dix",
  "onze",
  "douze",
  "quinze",
  "vingt",
  "trente",
  "quarante",
  "cinquante",
  "soixante",
  "cent",
  "mille",
  "premier",
  "première",
  "deuxième",
  "troisième",
  // prépositions, conjonctions, adverbes
  "à",
  "au",
  "aux",
  "en",
  "y",
  "par",
  "pour",
  "sans",
  "sous",
  "sur",
  "dans",
  "vers",
  "dès",
  "lors",
  "avec",
  "avant",
  "après",
  "pendant",
  "depuis",
  "malgré",
  "selon",
  "contre",
  "entre",
  "comme",
  "sauf",
  "hors",
  "près",
  "ensuite",
  "puis",
  "ainsi",
  "alors",
  "encore",
  "aussi",
  "ici",
  "donc",
  "enfin",
  "bref",
  "juste",
  "presque",
  "plutôt",
  "jamais",
  "toujours",
  "souvent",
  "parfois",
  "autant",
  "davantage",
  "mieux",
  "pire",
  "moins",
  "plus",
  "très",
  "trop",
  "assez",
  "beaucoup",
  "peu",
  "moitié",
  "seulement",
]);

/**
 * Ce qui ouvre un complément d'objet : déterminants et clitiques, rien d'autre.
 *
 * Y ajouter les prépositions (« de », « pour », « sur ») ferait passer « Deux
 * runs pour travailler la souplesse » — une phrase nominale parfaitement
 * correcte — pour un impératif, et on perdrait la détection qu'on cherche à
 * garder.
 */
const COMPLEMENT_STARTERS: ReadonlySet<string> = new Set([
  "le",
  "la",
  "l'",
  "les",
  "un",
  "une",
  "des",
  "du",
  "ce",
  "cet",
  "cette",
  "ces",
  "mon",
  "ma",
  "mes",
  "ton",
  "ta",
  "tes",
  "son",
  "sa",
  "ses",
  "notre",
  "nos",
  "votre",
  "vos",
  "toi",
  "y",
  "en",
  "chaque",
  "deux",
  "trois",
  "quatre",
  "cinq",
  "six",
  "sept",
  "huit",
  "neuf",
  "dix",
]);

/** Terminaisons d'un impératif ou d'un présent aux deux premières personnes. */
const IMPERATIVE_SHAPE = /(?:e|es|is|ds|ts|ez|ons)$/u;

/** Combien de mots de classe fermée on traverse avant de chercher le verbe. */
const LEADING_SKIP = 3;

/**
 * La phrase commence-t-elle par un impératif ?
 *
 * « Coupe le chat vocal », « Étire tes balayages », « Enchaîne 3 runs » : le
 * verbe est en tête, sans sujet, et c'est du français juste — c'est même le
 * registre naturel d'une consigne d'entraînement. On l'identifie par sa
 * **place** et par ce qui le suit, jamais par une liste de verbes.
 *
 * Une amorce adverbiale est traversée (« Ici aussi, privilégie… », « Ensuite,
 * garde… ») : sans cela, la moitié des impératifs du corpus réel passaient
 * pour des phrases nominales.
 */
function startsWithImperative(words: readonly string[]): boolean {
  let index = 0;

  while (index < Math.min(LEADING_SKIP, words.length) && CLOSED_CLASS.has(words[index] ?? "")) {
    index += 1;
  }

  const candidate = words[index];
  const next = words[index + 1];

  if (candidate === undefined || next === undefined) return false;
  if (candidate.length < 4 || CLOSED_CLASS.has(candidate)) return false;
  if (!IMPERATIVE_SHAPE.test(candidate)) return false;
  return COMPLEMENT_STARTERS.has(next) || /^\p{N}+$/u.test(next);
}

/**
 * La phrase contient-elle un verbe conjugué ?
 *
 * Quatre voies, de la plus sûre à la plus contextuelle : une forme de la liste
 * fermée ; une terminaison de temps sans ambiguïté (imparfait, futur,
 * conditionnel, passé simple) ; un mot à terminaison verbale placé juste après
 * un pronom sujet ou un clitique — c'est la position qui fait le verbe
 * (« se construira ») ; et l'impératif en tête de phrase.
 *
 * Elle rend `false` par défaut, donc **elle se trompe du côté du signalement**
 * pour les verbes qu'aucune des quatre voies n'attrape. C'est la raison d'être
 * du rôle `consigne` : là où la phrase nominale est légitime, l'absence de
 * verbe ne suffit plus à faire une faute.
 */
export function hasConjugatedVerb(sentence: string): boolean {
  // Une inversion interrogative **est** une conjugaison : seul un verbe
  // conjugué peut porter un sujet postposé (« Remarques-tu… »).
  if (HAS_INVERSION.test(sentence)) return true;

  const words = frenchTokens(sentence);

  const found = words.some((word, index) => {
    if (CONJUGATED.has(word)) return true;
    if (NOT_A_VERB.has(word)) return false;
    if (word.length >= 5 && TENSE_ENDING.test(word)) return true;

    const previous = index === 0 ? null : (words[index - 1] ?? null);

    return previous !== null && CLITICS.has(previous) && word.length >= 3 && VERB_ENDING.test(word);
  });

  return found || startsWithImperative(words);
}

/* ------------------------------------------------------------------ */
/* Détection des défauts de structure                                  */
/* ------------------------------------------------------------------ */

/** Sous quel nombre de mots une tournure brève reste légitime. */
const MIN_WORDS_FOR_VERB = 4;

/** Longueur d'un extrait de journal : de quoi reconnaître la phrase, pas plus. */
const EXCERPT_LENGTH = 80;

function excerpt(text: string): string {
  const clean = text.replace(/\s+/gu, " ").trim();

  return clean.length <= EXCERPT_LENGTH ? clean : `${clean.slice(0, EXCERPT_LENGTH)}…`;
}

/** Une subordonnée seule n'est pas une phrase : elle annonce une suite absente. */
const SUBORDINATE_START: ReadonlySet<string> = new Set(["car", "parce", "puisque", "que", "qu'"]);

/** Un mot qui ne peut pas terminer une phrase : il en attend une autre. */
const DANGLING_END: ReadonlySet<string> = new Set([
  "car",
  "que",
  "qu'",
  "de",
  "du",
  "des",
  "à",
  "au",
  "aux",
  "pour",
  "avec",
  "sur",
  "dans",
  "et",
  "ou",
  "mais",
  "donc",
  "qui",
  "dont",
  "si",
  "en",
]);

/**
 * Les formes qui ne peuvent pas ouvrir une phrase sans sujet.
 *
 * L'impératif est exclu de cette liste par construction : « Reste concentré »
 * et « Garde ton crosshair » sont des phrases justes, alors que « Mérite un
 * travail ciblé » et « Se construira bloc par bloc » sont les deux fautes
 * relevées en production.
 */
const NO_SUBJECT_START: ReadonlySet<string> = new Set([
  "se",
  "s'",
  "est",
  "sont",
  "était",
  "étaient",
  "sera",
  "seront",
  "serait",
  "mérite",
  "méritent",
  "permet",
  "permettent",
  "suffit",
  "suffisent",
]);

/**
 * Bornes de mot **compatibles Unicode**.
 *
 * `\b` de JavaScript est défini sur `[A-Za-z0-9_]`, y compris avec le drapeau
 * `u` : il voit donc une frontière entre « ô » et « l ». La campagne réelle l'a
 * payé — `\ble\s+est` s'accrochait au milieu de « contrô|le est mesurée » et
 * signalait un sujet manquant dans une phrase parfaitement construite. Ces deux
 * bornes-ci comptent les lettres accentuées comme des lettres.
 */
const LEFT_EDGE = "(?<![\\p{L}\\p{N}'’-])";
const RIGHT_EDGE = "(?![\\p{L}\\p{N}])";

/**
 * Un déterminant collé à un verbe : le nom qui devait porter le sujet a sauté.
 *
 * Les deux listes sont **étroites**, et chaque exclusion vient d'un faux
 * positif observé :
 *
 * - `le`, `la`, `les`, `un`, `une` sont exclus des déterminants : ce sont aussi
 *   des pronoms objets, et « tu **les as** vus » ou « il **la voit** » sont du
 *   français juste. `ce` l'est également — « **ce sont** précisément ces deux
 *   familles » est la tournure présentative normale ;
 * - `reste`, `manque`, `mérite`, `montre` sont exclus des verbes : ce sont
 *   aussi des noms communs, et « tout **le reste** », « **son manque** de
 *   structure » ont tous deux été signalés à tort. Leurs formes plurielles,
 *   elles, ne sont que des verbes et restent surveillées.
 */
const DETERMINER_THEN_VERB = new RegExp(
  `${LEFT_EDGE}(?:ton|ta|tes|son|sa|ses|mon|ma|mes|notre|nos|votre|vos|cet|cette|ces)\\s+(?:est|sont|était|étaient|sera|seront|serait|seraient|ont|avait|avaient|aura|auront|restent|méritent|manquent|montrent|semble|semblent|permet|permettent)${RIGHT_EDGE}`,
  "giu",
);

/**
 * N'importe quel segment entre crochets : marqueur de citation, `[SOURCES]`.
 *
 * Deux constantes pour un seul motif, et ce n'est pas un doublon : `.test()`
 * sur une regex globale avance son `lastIndex` et rend un résultat différent
 * à l'appel suivant. La version non globale existe pour cet usage-là.
 */
const ANY_MARKER = /\[[^\]\n]*\]/gu;
const HAS_MARKER = /\[[^\]\n]*\]/u;

/**
 * Le texte tel qu'il s'**affichera** : marqueurs retirés, espaces recollés.
 *
 * Même geste que `../routine/citations.ts` avant l'affichage, en plus large
 * (ici on ne demande pas au marqueur d'être une citation bien formée). C'est ce
 * texte-là qu'il faut lire pour juger une phrase : le marqueur ne survit pas à
 * l'écran.
 */
function withoutMarkers(text: string): string {
  return text
    .replace(ANY_MARKER, "")
    .replace(/[ \t]{2,}/gu, " ")
    .replace(/[ \t]+([,;:.!?…])/gu, "$1");
}

/** Un participe passé ou un infinitif directement après « tu ». */
const BAD_AFTER_TU: ReadonlySet<string> = new Set([
  "tenu",
  "tenus",
  "pris",
  "prise",
  "prises",
  "mis",
  "mise",
  "mises",
  "vu",
  "vus",
  "eu",
  "eus",
  "été",
  "allé",
  "allés",
  "venu",
  "venus",
  "su",
  "sus",
  "pu",
  "dû",
  "fait",
  "faits",
  "dit",
  "dits",
  "écrit",
  "écrits",
  "ouvert",
  "offert",
  "couvert",
  "construit",
  "compris",
  "appris",
  "perdu",
  "rendu",
  "entendu",
  "attendu",
  "répondu",
  "voulu",
  "connu",
  "cru",
  "lu",
  "bu",
  "couru",
]);

/**
 * L'**inversion interrogative** : le sujet passe derrière le verbe, soudé par
 * un trait d'union — « Veux-tu », « As-tu », « a-t-il », « peut-on ».
 *
 * Elle a coûté quatre signalements faux sur une campagne réelle. La règle
 * « après *tu*, le verbe finit par s ou x » lisait « Veux-**tu** que je te
 * **propose** » et prenait `propose` pour le verbe de ce `tu` — alors que le
 * verbe est devant, et que la phrase est impeccable.
 *
 * Deux constantes pour un motif : `.test()` sur une regex globale avance son
 * `lastIndex` et rend un résultat différent à l'appel suivant.
 */
const INVERSION =
  /(?<![\p{L}\p{N}-])(\p{L}+)-(?:t-)?(?:je|tu|il|elle|on|nous|vous|ils|elles)(?![\p{L}\p{N}])/giu;
const HAS_INVERSION =
  /(?<![\p{L}\p{N}-])\p{L}+-(?:t-)?(?:je|tu|il|elle|on|nous|vous|ils|elles)(?![\p{L}\p{N}])/iu;

/**
 * La même phrase, sujets postposés retirés : il ne reste que le verbe.
 *
 * On ne supprime pas la tournure, on la remet à l'endroit — « Veux-tu que… »
 * devient « Veux que… ». Le `tu` inversé disparaît donc de la liste des mots,
 * et la règle de la deuxième personne ne le confond plus avec un sujet
 * antéposé.
 */
function withoutInversion(sentence: string): string {
  return sentence.replace(INVERSION, "$1");
}

/**
 * Après « tu », le verbe se termine par `s` ou `x` — sans exception en
 * français. Les clitiques intercalés (« tu ne », « tu te », « tu l' ») sont
 * traversés avant de regarder la forme.
 *
 * L'inversion est neutralisée d'abord : elle place un `tu` qui n'est pas le
 * sujet de ce qui suit.
 */
function badSecondPerson(sentence: string): string | null {
  const words = frenchTokens(withoutInversion(sentence));

  for (const [index, word] of words.entries()) {
    if (word !== "tu") continue;

    let next = index + 1;

    while (next < words.length && CLITICS.has(words[next] ?? "") && words[next] !== "tu") {
      next += 1;
    }

    const verb = words[next];

    if (verb === undefined) continue;
    if (BAD_AFTER_TU.has(verb) || /(?:é|és|ée|ées)$/u.test(verb)) return `tu ${verb}`;
    if (!/[sx]$/u.test(verb)) return `tu ${verb}`;
  }
  return null;
}

/**
 * Les phrases d'un texte où le **sujet manque** : un déterminant collé à un
 * verbe, ou une clause qui s'ouvre sur un verbe conjugué.
 *
 * Sortie : des extraits, pas des positions. Ils servent deux fois — tels quels
 * sur le texte, et sur le texte débarrassé de ses marqueurs — et c'est la
 * **différence** entre les deux qui dénonce une citation employée comme sujet.
 */
function subjectFaults(text: string): readonly string[] {
  const found: string[] = [];

  for (const match of text.matchAll(DETERMINER_THEN_VERB)) found.push(excerpt(match[0]));

  for (const sentence of splitFrenchSentences(text)) {
    const first = frenchTokens(sentence)[0] ?? "";

    // « Est-ce que… » ouvre bien sur `est`, et c'est une question, pas un sujet
    // manquant. La forme se reconnaît au trait d'union, que la tokenisation perd.
    if (NO_SUBJECT_START.has(first) && !/^est-ce\b/iu.test(sentence)) {
      found.push(excerpt(sentence));
    }
  }
  return found;
}

/**
 * Les défauts de structure d'un texte. **Aucune** correction ici : cette
 * fonction lit, elle ne touche à rien.
 */
export function detectFrenchIssues(
  text: string,
  options: FrenchGuardOptions = {},
): readonly FrenchIssue[] {
  const role = options.role ?? "phrase";
  const mask = protectedMask(text, options.protectedNames ?? []);
  const issues: FrenchIssue[] = [];

  for (const match of text.matchAll(STOP_THEN_LOWER)) {
    if (mask.slice(match.index, match.index + match[0].length).some(Boolean)) continue;
    if (!endsSentence(text, match.index)) continue;
    issues.push({ kind: "minuscule_apres_point", excerpt: excerpt(match[0]) });
  }

  const faults = subjectFaults(text);

  for (const fault of faults) issues.push({ kind: "sujet_manquant", excerpt: fault });

  /*
   * La citation en position de sujet, jugée comme le lecteur la jugera.
   *
   * La campagne réelle a montré que le modèle **suit** la consigne « le
   * marqueur est un complément » à la lettre tout en la manquant : il écrit
   * « ton [HS% 25.1] est ta base », avec un déterminant devant — mais c'est le
   * marqueur qui tient la place du nom. Une fois retiré avant l'affichage, il
   * reste « ton est ta base ».
   *
   * On ne cherche donc pas un motif de crochets : on retire les marqueurs et on
   * regarde ce qui reste. Un défaut qui n'apparaît **qu'**après retrait est,
   * par construction, causé par le marqueur. C'est exactement la relecture que
   * le prompt demande au modèle, appliquée par la machine.
   */
  if (HAS_MARKER.test(text)) {
    const known = new Set(faults);

    for (const fault of subjectFaults(withoutMarkers(text))) {
      if (known.has(fault)) continue;
      known.add(fault);
      issues.push({ kind: "citation_sujet", excerpt: fault });
    }
  }

  for (const sentence of splitFrenchSentences(text)) {
    const words = frenchTokens(sentence);
    const first = words[0] ?? "";
    const last = words[words.length - 1] ?? "";
    const bad = badSecondPerson(sentence);
    const fragment = SUBORDINATE_START.has(first) || (words.length > 1 && DANGLING_END.has(last));

    if (bad !== null) issues.push({ kind: "conjugaison_2e_personne", excerpt: excerpt(sentence) });
    if (role === "titre") continue;
    if (fragment) issues.push({ kind: "fragment_subordonne", excerpt: excerpt(sentence) });

    if (words.length < MIN_WORDS_FOR_VERB || hasConjugatedVerb(sentence)) continue;

    // Le rôle `consigne` tolère la phrase nominale : « Deux runs de cinq
    // minutes. » est la forme juste d'une consigne d'exercice, pas une faute.
    // Elle ne le devient que si elle porte une marque de rupture — une
    // minuscule initiale (la phrase d'avant s'est arrêtée en plein milieu) ou
    // une subordonnée laissée seule.
    const broken = fragment || /^\p{Ll}/u.test(sentence);

    if (role === "consigne" && !broken) continue;
    issues.push({ kind: "phrase_sans_verbe", excerpt: excerpt(sentence) });
  }
  return issues;
}

/**
 * Le rapport complet d'un texte : ce qui a été relevé (sur le texte **brut**,
 * avant toute retouche) et ce qui a été réparé.
 *
 * L'ordre compte : détecter d'abord, réparer ensuite. Une majuscule posée par
 * la réparation effacerait le symptôme que la détection doit compter.
 */
export function inspectFrench(text: string, options: FrenchGuardOptions = {}): FrenchReport {
  const issues = detectFrenchIssues(text, options);
  const { text: repaired, fixes } = repairFrench(text, options);

  return { text: repaired, fixes, issues };
}

/* ------------------------------------------------------------------ */
/* Le garde-fou tel que les chemins serveur l'emploient                */
/* ------------------------------------------------------------------ */

export interface FrenchGuardSummary {
  /** Le chemin qui a produit le texte (`routine`, `coach`, `thread`…). */
  readonly source: string;
  readonly fixes: readonly FrenchFix[];
  readonly issues: readonly FrenchIssue[];
}

export interface FrenchGuardRun {
  /** Corrige un champ et retient ce qui reste suspect. Rend le texte à livrer. */
  readonly apply: (text: string, field: string, role?: FrenchRole) => string;
  /**
   * Clôt la passe : une **seule** ligne de journal pour toute la réponse, et le
   * résumé rendu à l'appelant (les tests lisent celui-ci, pas la console).
   */
  readonly flush: () => FrenchGuardSummary;
}

/** Nombre d'extraits journalisés : au-delà, c'est du bruit dans les logs. */
const MAX_LOGGED = 5;

function total(fixes: readonly FrenchFix[]): number {
  return fixes.reduce((sum, fix) => sum + fix.count, 0);
}

/**
 * Une passe du garde-fou sur une réponse.
 *
 * Un objet plutôt que cinq appels indépendants pour une seule raison :
 * l'observabilité. Un debrief a dix champs de texte ; dix `console.warn` pour
 * une génération rendraient le journal illisible, et c'est la réponse entière
 * qu'on veut pouvoir compter.
 */
export function frenchGuard(source: string, options: FrenchGuardOptions = {}): FrenchGuardRun {
  const fixes = new Map<FrenchFixKind, number>();
  const issues: FrenchIssue[] = [];

  return {
    apply(text, field, role) {
      const report = inspectFrench(text, { ...options, role: role ?? options.role });

      for (const fix of report.fixes) fixes.set(fix.kind, (fixes.get(fix.kind) ?? 0) + fix.count);
      for (const issue of report.issues) issues.push({ ...issue, field });
      return report.text;
    },
    flush() {
      const summary: FrenchGuardSummary = {
        source,
        fixes: [...fixes].map(([kind, count]) => ({ kind, count })),
        issues,
      };

      // Seuls les défauts de **structure** justifient une ligne de journal : une
      // majuscule reposée est un non-événement, un fragment sans verbe est un
      // symptôme de prompt qu'on veut pouvoir suivre dans le temps.
      if (issues.length > 0) {
        console.warn("[french-guard] défauts de structure dans une sortie IA", {
          source: summary.source,
          issues: issues.length,
          fixes: total(summary.fixes),
          kinds: [...new Set(issues.map((issue) => issue.kind))],
          samples: issues.slice(0, MAX_LOGGED).map((issue) => ({
            kind: issue.kind,
            field: issue.field,
            excerpt: issue.excerpt,
          })),
        });
      }
      return summary;
    },
  };
}
