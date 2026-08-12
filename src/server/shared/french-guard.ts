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

/** Le rôle d'un champ : un titre n'a pas à être une phrase complète. */
export type FrenchRole = "phrase" | "titre";

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
  "compar",
  "compt",
  "concentr",
  "continu",
  "corrig",
  "coût",
  "demand",
  "démarr",
  "dur",
  "échauff",
  "écout",
  "entraîn",
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
  "pouss",
  "prépar",
  "progress",
  "ralent",
  "rat",
  "regard",
  "relâch",
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
 * La phrase contient-elle un verbe conjugué ?
 *
 * Deux voies : une forme de la liste fermée, ou un mot à terminaison verbale
 * placé juste après un pronom sujet ou un clitique — c'est la position qui fait
 * le verbe (« se construira », « tu tiens », « il progresse »).
 */
export function hasConjugatedVerb(sentence: string): boolean {
  const words = frenchTokens(sentence);

  return words.some((word, index) => {
    if (CONJUGATED.has(word)) return true;

    const previous = index === 0 ? null : (words[index - 1] ?? null);

    return previous !== null && CLITICS.has(previous) && word.length >= 3 && VERB_ENDING.test(word);
  });
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

/** Un déterminant collé à un verbe : le nom qui devait porter le sujet a sauté. */
const DETERMINER_THEN_VERB =
  /\b(?:ton|ta|tes|son|sa|ses|mon|ma|mes|ce|cet|cette|ces|le|la|les|un|une)\s+(?:est|sont|était|étaient|sera|seront|reste|restent|mérite|méritent|semble|semblent|manque|manquent|montre|montrent|permet|permettent|a|ont)\b/giu;

/** Une citation chiffrée en position de sujet : la faute que la Vague 3.1 vise. */
const CITATION_AS_SUBJECT =
  /\[[^\]\n]*\]\s+(?:est|sont|était|étaient|sera|seront|reste|restent|mérite|méritent|montre|montrent|demande|demandent|semble|semblent)\b/giu;

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
 * Après « tu », le verbe se termine par `s` ou `x` — sans exception en
 * français. Les clitiques intercalés (« tu ne », « tu te », « tu l' ») sont
 * traversés avant de regarder la forme.
 */
function badSecondPerson(sentence: string): string | null {
  const words = frenchTokens(sentence);

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

  for (const match of text.matchAll(CITATION_AS_SUBJECT)) {
    issues.push({ kind: "citation_sujet", excerpt: excerpt(match[0]) });
  }

  for (const match of text.matchAll(DETERMINER_THEN_VERB)) {
    issues.push({ kind: "sujet_manquant", excerpt: excerpt(match[0]) });
  }

  for (const sentence of splitFrenchSentences(text)) {
    const words = frenchTokens(sentence);
    const first = words[0] ?? "";
    const last = words[words.length - 1] ?? "";
    const bad = badSecondPerson(sentence);

    if (bad !== null) issues.push({ kind: "conjugaison_2e_personne", excerpt: excerpt(sentence) });
    if (NO_SUBJECT_START.has(first)) {
      issues.push({ kind: "sujet_manquant", excerpt: excerpt(sentence) });
    }
    if (role === "titre") continue;
    if (SUBORDINATE_START.has(first) || (words.length > 1 && DANGLING_END.has(last))) {
      issues.push({ kind: "fragment_subordonne", excerpt: excerpt(sentence) });
    }
    if (words.length >= MIN_WORDS_FOR_VERB && !hasConjugatedVerb(sentence)) {
      issues.push({ kind: "phrase_sans_verbe", excerpt: excerpt(sentence) });
    }
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
