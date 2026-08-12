/**
 * La grammaire de nommage des scénarios, **tirée de la définition du
 * benchmark** au lieu d'être écrite en dur.
 *
 * Trois endroits du projet codaient la grammaire Voltaic dans une expression
 * régulière littérale :
 *
 * - la police anti-hallucination des citations (`src/server/shared/scenarios`)
 *   cherchait `\bVT\b` ;
 * - le libellé d'affichage (`src/client/format`) retirait « VT » puis le
 *   libellé du palier ;
 * - la correspondance des noms importés (`src/server/kovaaks/benchmark`)
 *   retirait un `\ss\d+$` générique, c'est-à-dire « quelque chose qui ressemble
 *   à un marqueur de saison », alors que le marqueur exact est connu.
 *
 * Trois copies d'une même règle qui n'appartient à aucune des trois : elle
 * appartient au benchmark. Ce module la lit là où elle est, et rend des
 * expressions régulières construites depuis la donnée — **échappées**, parce
 * qu'un marqueur ou un suffixe est une chaîne de données, pas un fragment de
 * regex à qui l'on fait confiance.
 *
 * Les regex sont gardées par définition de benchmark : elles sont sollicitées
 * une fois par nom de scénario relu, et une définition retirée du registre
 * (fixture de test) laisse partir les siennes avec elle.
 */

import { type BenchmarkId, getBenchmark } from "./benchmarks.js";

/** Neutralise les métacaractères d'une chaîne de données utilisée en regex. */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Minuscules, blancs resserrés, bords coupés — la forme comparable d'un nom. */
function normalizeSpacing(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Le suffixe d'import ramené à la forme des noms normalisés, **séparateur de
 * tête compris** : `" S5"` devient `" s5"` et non `"s5"`. Le couper en tête
 * laisserait « vt pasu novice » avec un blanc final, ou pire, ferait tomber le
 * suffixe au milieu d'un mot.
 */
function normalizeSuffix(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, " ").trimEnd();
}

interface NamingRegexes {
  readonly marker: RegExp;
  readonly displayPrefix: RegExp;
  /** `null` quand le benchmark ne s'importe pas depuis KovaaK's. */
  readonly importSuffix: RegExp | null;
}

const regexes = new WeakMap<object, NamingRegexes>();

function regexesFor(benchmarkId: BenchmarkId): NamingRegexes {
  const definition = getBenchmark(benchmarkId);
  const cached = regexes.get(definition);

  if (cached !== undefined) return cached;

  const { scenarioMarker, displayPrefix } = definition.naming;
  const suffix = definition.kovaaks?.scenarioSuffix;
  const built: NamingRegexes = {
    // Insensible à la casse : « vt pasu novice » n'est pas un nom valide, et on
    // préfère le signaler au modèle plutôt que de le laisser passer inaperçu
    // parce que la casse ne correspondait pas.
    marker: new RegExp(`\\b${escapeRegExp(scenarioMarker)}\\b`, "giu"),
    displayPrefix: new RegExp(`^${escapeRegExp(displayPrefix)}\\s+`),
    // Le suffixe est comparé sur un nom déjà normalisé (minuscules, blancs
    // resserrés) : la forme de référence l'est donc aussi.
    importSuffix:
      suffix === undefined || suffix.trim() === ""
        ? null
        : new RegExp(`${escapeRegExp(normalizeSuffix(suffix))}$`),
  };

  regexes.set(definition, built);
  return built;
}

/**
 * Le marqueur qui ouvre une citation de scénario, en expression régulière
 * globale. Une **nouvelle** instance par appel n'est pas nécessaire :
 * `String.prototype.matchAll` travaille sur une copie et ne touche pas au
 * `lastIndex` de l'originale — mais `exec` en boucle, lui, le partagerait.
 */
export function scenarioMarkerRegex(benchmarkId: BenchmarkId): RegExp {
  return regexesFor(benchmarkId).marker;
}

/**
 * Le nom d'un scénario allégé pour l'affichage : préfixe du benchmark retiré,
 * libellé du palier retiré s'il fait partie du nom (« VT Pasu Novice » →
 * « Pasu »). Un nom qui ne suit pas la grammaire ressort tel quel.
 */
export function scenarioDisplayName(
  benchmarkId: BenchmarkId,
  scenarioName: string,
  tierLabel: string,
): string {
  const { naming } = getBenchmark(benchmarkId);
  const withoutPrefix = scenarioName.replace(regexesFor(benchmarkId).displayPrefix, "");

  if (!naming.tierLabelSuffix) return withoutPrefix.trim();
  return withoutPrefix.replace(new RegExp(`\\s+${escapeRegExp(tierLabel)}$`), "").trim();
}

/**
 * Forme comparable d'un nom de scénario venu de l'aim trainer : casse ignorée,
 * blancs resserrés, marqueur d'import final retiré (`… Novice S5` →
 * `… novice`).
 *
 * Le marqueur retiré est **celui du benchmark** (`kovaaks.scenarioSuffix`), pas
 * un motif générique : un benchmark qui noterait sa saison autrement le dirait
 * dans sa définition, et rien ici ne changerait.
 */
export function normalizedScenarioKey(benchmarkId: BenchmarkId, raw: string): string {
  const normalized = normalizeSpacing(raw);
  const suffix = regexesFor(benchmarkId).importSuffix;

  return suffix === null ? normalized : normalized.replace(suffix, "");
}
