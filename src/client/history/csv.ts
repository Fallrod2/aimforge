/**
 * Export CSV de l'historique (SPEC V4-A §4.8). Module **pur** : il rend une
 * chaîne, il ne touche ni au DOM, ni au réseau, ni à `Blob`. Le téléchargement
 * est trois lignes dans la vue ; le format, lui, est ici et il est testé.
 *
 * Le fichier vise **Excel FR**, et cela dicte trois choses qui n'ont rien
 * d'esthétique :
 *
 * 1. le séparateur est le **point-virgule**. Excel en configuration française
 *    attend celui-là ; avec une virgule, tout atterrit dans une seule colonne ;
 * 2. les décimales sont des **virgules**, pour la même raison — un « 447.36 »
 *    lu par Excel FR devient du texte, donc une colonne qu'on ne peut plus
 *    additionner ;
 * 3. le fichier commence par un **BOM UTF-8**. Sans lui, Excel lit le fichier
 *    en ANSI et « Précision » devient « PrÃ©cision ».
 *
 * Deux décisions de contenu, elles, sont métier :
 *
 * - **un overall à 0 s'écrit vide.** 0 est la valeur juste d'un bench incomplet
 *   (moyenne harmonique, `energy.ts`), mais dans un tableur c'est un nombre :
 *   il entrerait dans les moyennes et tirerait toute colonne vers le bas. Une
 *   case vide dit « pas de valeur », ce qui est exactement le cas ;
 * - **les colonnes de scénario sont celles du palier exporté**, et les passes
 *   des autres paliers laissent ces cases vides plutôt que d'aligner un score
 *   de Novice sous une colonne d'Advanced.
 */

/** Le BOM UTF-8, en tête de fichier. Exporté pour que les tests le nomment. */
export const CSV_BOM = "\uFEFF";

const SEPARATOR = ";";
/** RFC 4180 : c'est la fin de ligne qu'Excel attend. */
const EOL = "\r\n";

/** Les colonnes fixes, avant les scénarios. */
const FIXED_HEADERS = ["date", "palier", "overall", "rang", "complete"] as const;

/** Une passe telle que l'export la voit : rien de plus que ce qui s'écrit. */
export interface CsvRun {
  /** Horodatage ISO 8601 de la passe. */
  readonly date: string;
  readonly tierLabel: string;
  /** Overall enregistré ; 0 = bench incomplet, écrit vide. */
  readonly overall: number;
  readonly rank: string | null;
  readonly complete: boolean;
  /** Scores par nom de scénario ; vide pour une passe d'un autre palier. */
  readonly scores: Readonly<Record<string, number>>;
}

export interface CsvOptions {
  /** Fuseau des dates écrites. Par défaut celui du navigateur. */
  readonly timeZone?: string;
}

/** Un champ CSV : mis entre guillemets seulement s'il le faut (RFC 4180). */
function csvField(field: string): string {
  if (!/[";\r\n]/.test(field)) return field;
  return `"${field.replace(/"/g, '""')}"`;
}

/** Un nombre à la française : la virgule décimale, sans séparateur de milliers. */
function csvNumber(value: number, fractionDigits?: number): string {
  const text = fractionDigits === undefined ? String(value) : value.toFixed(fractionDigits);

  return text.replace(".", ",");
}

/**
 * La date d'une passe au format qu'Excel FR reconnaît (`jj/mm/aaaa hh:mm`).
 *
 * L'ISO 8601 aurait été plus rigoureux, mais il atterrit en texte dans un
 * tableur français : le fichier existe pour être ouvert, pas pour être relu par
 * nous.
 */
function csvDate(iso: string, timeZone: string | undefined): string {
  const time = Date.parse(iso);

  // Une date illisible ne fait pas échouer l'export : elle s'écrit telle quelle
  // et l'utilisateur voit ce que la base contient.
  if (Number.isNaN(time)) return iso;
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(time));
}

/**
 * Le fichier CSV complet, BOM compris.
 *
 * `scenarioColumns` sont les scénarios du palier exporté, dans l'ordre du
 * tableur du benchmark : ce sont les colonnes, et elles ne dépendent pas des
 * passes reçues — un palier dont aucune passe n'aurait joué un scénario garde
 * sa colonne, vide.
 */
export function benchRunsCsv(
  runs: readonly CsvRun[],
  scenarioColumns: readonly string[],
  options: CsvOptions = {},
): string {
  const header = [...FIXED_HEADERS, ...scenarioColumns].map(csvField).join(SEPARATOR);
  const rows = runs.map((run) => {
    const fixed = [
      csvDate(run.date, options.timeZone),
      run.tierLabel,
      run.overall > 0 ? csvNumber(run.overall, 2) : "",
      run.rank ?? "",
      run.complete ? "oui" : "non",
    ];
    const scores = scenarioColumns.map((scenario) => {
      const score = run.scores[scenario];

      return score === undefined ? "" : csvNumber(score);
    });

    return [...fixed, ...scores].map(csvField).join(SEPARATOR);
  });

  return CSV_BOM + [header, ...rows].join(EOL);
}

/** Une portion de nom de fichier : minuscules, sans accent, sans séparateur. */
function slug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036F]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Le nom du fichier téléchargé.
 *
 * Le jour est celui d'**UTC** : le nom doit être le même quel que soit le
 * fuseau de la machine, sinon deux exports du même instant portent deux dates.
 * Tout le reste est translittéré — un nom de barème ou de palier ne doit jamais
 * pouvoir ouvrir un chemin. D'où le `string` en entrée plutôt qu'un `BenchmarkId` :
 * ici, un identifiant de barème n'est qu'un fragment de nom de fichier, et il est
 * traité comme tel — sans confiance.
 */
export function csvFileName(benchmarkId: string, tierLabel: string, now: Date): string {
  const day = now.toISOString().slice(0, 10);

  return `aimforge-${slug(benchmarkId)}-${slug(tierLabel)}-${day}.csv`;
}
