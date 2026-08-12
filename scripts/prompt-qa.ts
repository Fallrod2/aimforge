#!/usr/bin/env bun
/**
 * Harnais de QA des prompts, **hors UI** (Vague 3.1).
 *
 *     bun scripts/prompt-qa.ts --target routine --n 20
 *     bun scripts/prompt-qa.ts --target thread  --n 20 --concurrency 3
 *     bun scripts/prompt-qa.ts --target routine --provider openrouter \
 *       --model deepseek/deepseek-v4-flash-0731 --n 20
 *
 * ## Ce qu'il mesure, et pourquoi il existe
 *
 * Les fautes de structure du français des sorties IA (« si tu tenus », « Ton
 * est très bas », « mérite un travail ciblé ») ne se voient qu'en volume : une
 * génération sur cinq, sur des profils qu'on n'a pas sous la main. Les
 * reproduire à la souris coûte une demi-journée et ne se compare pas d'une
 * semaine à l'autre. Ce script produit un chiffre : **X générations sur N sans
 * faute**, sur des profils fixés.
 *
 * ## Trois règles qui font sa valeur
 *
 * 1. **Aucun prompt n'est recopié ici.** Le script importe les vrais
 *    constructeurs du serveur (`routineSystemPrompt`, `buildRoutineMessages`,
 *    `coachThreadSystemPrompt`, `buildThreadMessages`) et les vraies polices
 *    de sortie (`parseRoutine`, `parseThreadAnswer`). Un harnais qui aurait sa
 *    propre copie du prompt mesurerait la copie.
 * 2. **Aucun appel à l'API du produit, aucune base.** Il parle directement au
 *    fournisseur. Il ne consomme donc ni quota, ni compteur, et n'écrit nulle
 *    part ailleurs que dans son dossier de sortie.
 * 3. **Le fournisseur et le modèle se choisissent**, parce que celui qui répond
 *    en production n'est pas forcément celui qu'on croit. La configuration de
 *    la plateforme vit en base (`platform_settings`, SPEC §5 quater) et peut
 *    nommer n'importe quel fournisseur ; `DEFAULT_ANTHROPIC_MODEL` n'est que le
 *    **repli d'environnement**, servi quand la table ne configure rien
 *    (`src/server/platform/settings.ts`). Figer Anthropic ici reviendrait à
 *    mesurer un modèle que personne n'interroge : les fautes de français d'un
 *    petit modèle rapide ne sont pas celles d'un gros.
 *
 *    D'où `--provider` et `--model`. Le harnais ne lit pas `platform_settings`
 *    lui-même — il n'ouvre aucune base, c'est la règle 2 — donc c'est à
 *    l'appelant de lui donner le couple servi en production. Il l'écrit ensuite
 *    dans le rapport et dans le JSON : un chiffre « 17/20 » sans le modèle qui
 *    l'a produit ne veut rien dire.
 *
 * ## Ce que le rapport dit
 *
 * Pour chaque génération : le profil joué, le verdict de la police de sortie
 * (contrat, scénarios, citations) et les fautes de **structure** relevées par
 * `src/server/shared/french-guard.ts` — sur le texte **brut**, avant garde-fou,
 * pour que les corrections mécaniques que le serveur applique déjà restent
 * visibles au lieu d'être comptées comme des non-événements.
 */

import { mkdir, writeFile } from "node:fs/promises";
import type { MatchSummary } from "../src/client/data/linked-accounts-contract.js";
import {
  type BenchmarkId,
  computeBenchRunFor,
  DEFAULT_BENCHMARK_ID,
  listSubcategoriesFor,
  type ScoreMap,
  type TierId,
} from "../src/lib/energy/index.js";
import { createAsk, ModelError, type ProviderConfig } from "../src/server/ai/index.js";
import {
  type BenchRunForCoach,
  type ScenarioScoreForCoach,
  summarizeTierBench,
} from "../src/server/coach/bench.js";
import { extractJsonObject } from "../src/server/coach/parse.js";
import {
  type CoachBenchTiers,
  type CoachMessage,
  type CoachProfile,
  identityOf,
} from "../src/server/coach/prompt.js";
import { parseThreadAnswer, stripDebriefSuggestion } from "../src/server/coach/thread.js";
import {
  buildThreadMessages,
  coachThreadSystemPrompt,
  type ThreadContext,
  type ThreadDebrief,
} from "../src/server/coach/thread-prompt.js";
import {
  type RoutineBenchTiers,
  summarizeTierBenchForRoutine,
} from "../src/server/routine/bench.js";
import { summarizeIngameForRoutine } from "../src/server/routine/ingame.js";
import { parseRoutine } from "../src/server/routine/parse.js";
import {
  buildRoutineMessages,
  citableFacts,
  type RoutineContext,
  routineSystemPrompt,
} from "../src/server/routine/prompt.js";
import {
  type FrenchFix,
  type FrenchIssue,
  type FrenchRole,
  inspectFrench,
} from "../src/server/shared/french-guard.js";
import { scenarioCatalog, scenarioNames } from "../src/server/shared/scenarios.js";
import { DEFAULT_ANTHROPIC_MODEL } from "../src/shared/ai-settings-contract.js";
import { routineContentSchema } from "../src/shared/routine-contract.js";

/* ------------------------------------------------------------------ */
/* Arguments                                                           */
/* ------------------------------------------------------------------ */

type Target = "routine" | "thread";

/**
 * Les fournisseurs que ce harnais sait interroger.
 *
 * Deux et pas cinq, à dessein : ce sont ceux que la plateforme sert
 * réellement — Anthropic par le repli d'environnement, OpenRouter par la
 * configuration en base. Les autres passent par le même adaptateur
 * OpenAI-compatible qu'OpenRouter, et s'ajouteraient d'une ligne ici le jour où
 * la plateforme les servirait ; les ouvrir aujourd'hui serait offrir des
 * chemins que personne n'emprunte.
 */
type QaProvider = "anthropic" | "openrouter";

interface ProviderSpec {
  /** La variable qui porte la clé. Distincte par fournisseur, et c'est voulu. */
  readonly envVar: string;
  /** Le modèle servi par défaut, ou `null` quand il faut le nommer. */
  readonly defaultModel: string | null;
  /** Où l'on obtient la clé, pour que le message d'erreur soit actionnable. */
  readonly keyHint: string;
}

/**
 * Deux variables d'environnement différentes, et ce n'est pas une maladresse.
 *
 * `ANTHROPIC_API_KEY` est déjà la variable du produit : la réutiliser ne
 * demande rien de neuf. Pour OpenRouter, `PROMPT_QA_API_KEY` plutôt que
 * `OPENROUTER_API_KEY` — le nom dit que c'est une clé posée le temps d'une
 * mesure, pas un réglage de service. Une variable au nom de fournisseur finit
 * dans un `.env`, puis dans un déploiement ; celle-ci se pose sur la ligne de
 * commande et repart avec elle.
 */
const PROVIDERS: Readonly<Record<QaProvider, ProviderSpec>> = {
  anthropic: {
    envVar: "ANTHROPIC_API_KEY",
    // Le repli d'environnement de la plateforme : le seul modèle qu'on puisse
    // supposer sans rien lire (`src/server/platform/settings.ts`).
    defaultModel: DEFAULT_ANTHROPIC_MODEL,
    keyHint: "console.anthropic.com, format « sk-ant-… »",
  },
  openrouter: {
    envVar: "PROMPT_QA_API_KEY",
    // Aucun défaut, et c'est la règle la plus utile du fichier : le modèle
    // OpenRouter servi en production est un choix inscrit en base, que ce
    // script ne lit pas. En deviner un mesurerait le mauvais modèle sans le
    // dire — exactement le piège qu'on vient d'éviter.
    defaultModel: null,
    keyHint: "openrouter.ai/keys, format « sk-or-… »",
  },
};

interface Options {
  readonly target: Target;
  readonly provider: QaProvider;
  readonly model: string;
  readonly count: number;
  readonly concurrency: number;
}

const USAGE = [
  "usage : bun scripts/prompt-qa.ts --target routine|thread [options]",
  "  --provider anthropic|openrouter   défaut : anthropic",
  "  --model <identifiant>             défaut : le modèle du fournisseur (aucun pour openrouter)",
  "  --n <entier>                      défaut : 20",
  "  --concurrency <entier>            défaut : 3",
].join("\n");

/** Sortie franche : un harnais qui devine ses paramètres mesure autre chose. */
function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function readOptions(argv: readonly string[]): Options {
  const values = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];

    if (flag === undefined || !flag.startsWith("--")) continue;

    const inline = flag.indexOf("=");

    if (inline !== -1) {
      values.set(flag.slice(2, inline), flag.slice(inline + 1));
      continue;
    }
    values.set(flag.slice(2), argv[index + 1] ?? "");
    index += 1;
  }

  const target = values.get("target") ?? "";

  if (target !== "routine" && target !== "thread") fail(`--target manquant ou inconnu.\n${USAGE}`);

  const provider = values.get("provider") ?? "anthropic";

  if (provider !== "anthropic" && provider !== "openrouter") {
    fail(`--provider inconnu : « ${provider} ».\n${USAGE}`);
  }

  const spec = PROVIDERS[provider];
  const model = (values.get("model") ?? "").trim() || spec.defaultModel;

  if (model === null) {
    fail(
      [
        `--model est obligatoire avec --provider ${provider} : ce fournisseur n'a pas de modèle par`,
        "défaut ici. Le modèle servi en production est inscrit dans platform_settings.ai_model, que",
        "ce harnais ne lit pas (il n'ouvre aucune base) — donne-le explicitement, sinon la mesure",
        "porterait sur un modèle que personne n'interroge. Par exemple :",
        `  bun scripts/prompt-qa.ts --target ${target} --provider ${provider} \\`,
        "    --model deepseek/deepseek-v4-flash-0731",
      ].join("\n"),
    );
  }

  const count = Number(values.get("n") ?? "20");
  const concurrency = Number(values.get("concurrency") ?? "3");

  if (!Number.isInteger(count) || count < 1) fail(`--n doit être un entier positif.\n${USAGE}`);
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    fail(`--concurrency doit être un entier positif.\n${USAGE}`);
  }
  return { target, provider, model, count, concurrency };
}

/* ------------------------------------------------------------------ */
/* Profils de bench, construits depuis le jeu de données               */
/* ------------------------------------------------------------------ */

/**
 * Un palier joué à un niveau donné.
 *
 * `anchor` est l'indice d'une **ancre du benchmark** : les scores viennent donc
 * du tableur Voltaic lui-même (`Scenario.thresholds`), jamais d'un chiffre
 * inventé. C'est la seule façon d'obtenir un profil dont l'énergie, le rang et
 * le badge « Complete » sont ceux que le produit calculerait vraiment.
 */
interface TierSpec {
  readonly tier: TierId;
  /** Indice d'ancre visé pour les sous-catégories ordinaires. */
  readonly anchor: number;
  /** Sous-catégories laissées à la première ancre : les faiblesses du profil. */
  readonly weak: readonly string[];
  /** Nombre de scénarios renseignés, ou `"all"` pour une passe complète. */
  readonly filled: number | "all";
  /** Jours écoulés depuis la passe. */
  readonly daysAgo: number;
}

export interface ProfileSpec {
  readonly key: string;
  readonly label: string;
  readonly tiers: readonly TierSpec[];
  /** Parties classées importées ; 0 = profil sans statistiques in-game. */
  readonly matches: number;
  readonly profile: CoachProfile | null;
}

const BENCHMARK: BenchmarkId = DEFAULT_BENCHMARK_ID;

const PLAYER: CoachProfile = {
  pseudo: "Fallrod",
  rangValorant: "Ascendant 2",
  peak: "Immortel 1",
  mainAgent: "Jett",
  objectif: "Atteindre Immortel avant la fin de l'acte",
  notesMaps: "Icebox en attaque, je perds le contrôle du milieu",
  game: "valorant",
  activeBenchmark: BENCHMARK,
};

/**
 * Six profils, et ils ne se ressemblent pas.
 *
 * Le but n'est pas de couvrir le produit mais de couvrir les **formes de
 * contexte** qui font écrire le modèle différemment : un bench absent (il n'a
 * aucun chiffre à citer), un bench incomplet (il doit dire qu'il ne sait pas),
 * deux sous-catégories effondrées (il doit choisir), un palier terminé (il doit
 * viser le suivant), avec et sans statistiques de parties.
 */
export const PROFILES: readonly ProfileSpec[] = [
  {
    key: "novice-incomplet",
    label: "novice, passe incomplète (5 scénarios sur 18), sans stats de parties",
    tiers: [{ tier: "novice", anchor: 1, weak: [], filled: 5, daysAgo: 2 }],
    matches: 0,
    profile: PLAYER,
  },
  {
    key: "novice-complet-faible",
    label: "novice complet mais bas (première ancre partout), avec stats de parties",
    tiers: [{ tier: "novice", anchor: 0, weak: [], filled: "all", daysAgo: 1 }],
    matches: 22,
    profile: PLAYER,
  },
  {
    key: "intermediate-deux-faiblesses",
    label: "intermediate moyen avec deux sous-catégories effondrées, avec stats",
    tiers: [
      { tier: "novice", anchor: 5, weak: [], filled: "all", daysAgo: 40 },
      { tier: "intermediate", anchor: 3, weak: ["Dynamic", "Precise"], filled: "all", daysAgo: 3 },
    ],
    matches: 18,
    profile: PLAYER,
  },
  {
    key: "advanced-fort",
    label: "advanced solide (avant-dernière ancre), sans stats de parties",
    tiers: [{ tier: "advanced", anchor: 4, weak: [], filled: "all", daysAgo: 5 }],
    matches: 0,
    profile: PLAYER,
  },
  {
    key: "sans-profil-ni-stats",
    label: "intermediate moyen, profil non renseigné, sans stats de parties",
    tiers: [{ tier: "intermediate", anchor: 2, weak: [], filled: "all", daysAgo: 9 }],
    matches: 0,
    profile: null,
  },
  {
    key: "sans-bench-avec-stats",
    label: "aucune passe de bench, mais des parties importées",
    tiers: [],
    matches: 26,
    profile: PLAYER,
  },
];

/** Un score par scénario, pris **sur une ancre du benchmark**. */
function scoresFor(spec: TierSpec): ScoreMap {
  const scores: Record<string, number> = {};
  let written = 0;

  for (const subcategory of listSubcategoriesFor(BENCHMARK, spec.tier)) {
    const anchor = spec.weak.includes(subcategory.name) ? 0 : spec.anchor;

    for (const scenario of subcategory.scenarios) {
      if (spec.filled !== "all" && written >= spec.filled) return scores;

      const index = Math.min(Math.max(anchor, 0), scenario.thresholds.length - 1);
      const threshold = scenario.thresholds[index];

      if (threshold === undefined) continue;
      scores[scenario.name] = threshold;
      written += 1;
    }
  }
  return scores;
}

function isoDaysAgo(days: number, now: Date): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** Une passe telle que la base la rendrait, calculée par le moteur d'énergie. */
function runFor(
  spec: TierSpec,
  now: Date,
): { readonly run: BenchRunForCoach; readonly scores: readonly ScenarioScoreForCoach[] } {
  const scores = scoresFor(spec);
  const computed = computeBenchRunFor(BENCHMARK, spec.tier, scores);

  return {
    run: {
      tier: spec.tier,
      benchmarkId: BENCHMARK,
      date: isoDaysAgo(spec.daysAgo, now),
      overall: computed.overall,
      rank: computed.rank,
      complete: computed.complete,
    },
    scores: Object.entries(scores).map(([scenario, score]) => ({ scenario, score })),
  };
}

/** Le palier de la passe la plus récente : celui dont les scénarios sont autorisés. */
function latestTierOf(spec: ProfileSpec): TierId | null {
  const latest = [...spec.tiers].sort((left, right) => left.daysAgo - right.daysAgo)[0];

  return latest?.tier ?? null;
}

/* ------------------------------------------------------------------ */
/* Parties importées                                                   */
/* ------------------------------------------------------------------ */

const MAPS = ["Ascent", "Icebox", "Bind", "Haven", "Lotus", "Sunset"];
const AGENTS = ["Jett", "Raze", "Chamber", "Reyna"];

/** Générateur déterministe : deux exécutions doivent se comparer. */
function pseudoRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_00_00_00_00;
  };
}

function matchesFor(spec: ProfileSpec, now: Date): readonly MatchSummary[] {
  const random = pseudoRandom(spec.key.length * 7919 + spec.matches);

  return Array.from({ length: spec.matches }, (_, index) => {
    const kills = 8 + Math.floor(random() * 16);
    const deaths = 8 + Math.floor(random() * 12);
    const won = random() > 0.45;

    return {
      matchId: `${spec.key}-${index}`,
      // Réparties sur la fenêtre de 30 jours des moyennes in-game, en
      // resserrant les plus récentes pour passer le seuil de 14 jours.
      playedAt: isoDaysAgo(Math.floor(index * 1.2), now),
      map: MAPS[index % MAPS.length] ?? "Ascent",
      mode: "Compétitif",
      agent: AGENTS[index % AGENTS.length] ?? "Jett",
      kills,
      deaths,
      assists: Math.floor(random() * 8),
      adr: 110 + Math.round(random() * 60),
      headshotPercent: 15 + Math.round(random() * 18),
      roundsWon: won ? 13 : 6 + Math.floor(random() * 6),
      roundsLost: won ? 6 + Math.floor(random() * 6) : 13,
      result: won ? "victoire" : "defaite",
    } satisfies MatchSummary;
  });
}

/* ------------------------------------------------------------------ */
/* Contextes                                                           */
/* ------------------------------------------------------------------ */

/** Durées demandées, cyclées : une séance de 30 min ne s'écrit pas comme 90. */
const DURATIONS: readonly number[] = [30, 45, 60, 90];

const FOCUS: readonly (string | null)[] = [
  null,
  "je perds mes duels d'entrée",
  null,
  "mon tracking décroche quand la cible change de sens",
];

const QUESTIONS: readonly string[] = [
  "Où j'en suis sur mon bench ?",
  "Qu'est-ce que je travaille cette semaine ?",
  "Pourquoi je stagne alors que je m'entraîne tous les jours ?",
  "Je fais quoi de mes 20 minutes avant de lancer une compétitive ?",
];

const PAST_DEBRIEFS: readonly ThreadDebrief[] = [
  {
    date: "2026-08-08T19:20:00.000Z",
    resume: "Défaite serrée sur Ascent, perdue sur les retakes.",
    axes: ["Prise d'information en post-plant", "Placement de viseur"],
    focus: "Garde le viseur à hauteur de tête.",
  },
  {
    date: "2026-08-05T21:05:00.000Z",
    resume: "Victoire nette sur Bind, entrées propres.",
    axes: ["Économie", "Timing d'entrée"],
    focus: "Attends la fumée avant d'entrer.",
  },
];

export function routineContextFor(spec: ProfileSpec, index: number, now: Date): RoutineContext {
  const runs = spec.tiers.map((tier) => runFor(tier, now));
  const bench: RoutineBenchTiers = {
    tiers: runs.map((entry) => summarizeTierBenchForRoutine(entry.run, entry.scores)),
    latestTier: latestTierOf(spec),
  };
  const matches = matchesFor(spec, now);
  const catalog = scenarioCatalog(bench.latestTier ?? "novice");

  return {
    dureeMinutes: DURATIONS[index % DURATIONS.length] ?? 45,
    focus: FOCUS[index % FOCUS.length] ?? null,
    bench,
    debriefs: [],
    // Le mode « bench seul » du produit passe par `gateRoutine` sur un compteur
    // de parties ; ici, un profil sans parties est un profil sans stats, ce qui
    // produit exactement le même prompt : aucun bloc in-game, aucun chiffre
    // citable in-game.
    ingame: matches.length === 0 ? null : summarizeIngameForRoutine(matches, now),
    scenarios: catalog.groups,
  };
}

export function threadContextFor(spec: ProfileSpec, index: number, now: Date): ThreadContext {
  const runs = spec.tiers.map((tier) => runFor(tier, now));
  const bench: CoachBenchTiers = {
    tiers: runs.map((entry) => summarizeTierBench(entry.run, entry.scores)),
    latestTier: latestTierOf(spec),
  };
  const catalog = scenarioCatalog(bench.latestTier ?? "novice");

  return {
    profile: spec.profile,
    bench,
    scenarios: catalog.groups,
    matches: matchesFor(spec, now).slice(0, 8),
    debriefs: PAST_DEBRIEFS,
    history: [],
    question: QUESTIONS[index % QUESTIONS.length] ?? QUESTIONS[0] ?? "Où j'en suis ?",
    hasUndebriefedMatch: spec.matches > 0,
  };
}

/* ------------------------------------------------------------------ */
/* Appel au modèle                                                     */
/* ------------------------------------------------------------------ */

/** Les mêmes plafonds que les fonctions serverless correspondantes. */
const MAX_TOKENS: Readonly<Record<Target, number>> = { routine: 3000, thread: 800 };
const TIMEOUT_MS = 60_000;

/**
 * La configuration d'appel, telle que la plateforme la construirait.
 *
 * `source: "platform"` dans les deux cas : c'est lui qui décide des réglages
 * envoyés (`output_config.effort` sur Anthropic) et de la rédaction des
 * erreurs. Un harnais qui se déclarerait `user` mesurerait un appel que la
 * production ne fait pas.
 *
 * `baseUrl: null` pour OpenRouter, et ce n'est pas un oubli : le point d'entrée
 * `https://openrouter.ai/api/v1/chat/completions` est déjà connu de
 * l'adaptateur (`src/server/ai/openai-compatible.ts`), qui y ajoute les
 * en-têtes d'attribution. Le renseigner ici en ferait une seconde source de
 * vérité, et la production n'en a pas besoin non plus.
 */
function providerConfig(options: Options, apiKey: string): ProviderConfig {
  return {
    source: "platform",
    provider: options.provider,
    model: options.model,
    baseUrl: null,
    apiKey,
  };
}

/* ------------------------------------------------------------------ */
/* Analyse d'une sortie                                                */
/* ------------------------------------------------------------------ */

interface FieldText {
  readonly field: string;
  readonly text: string;
  readonly role: FrenchRole;
}

interface Analysis {
  readonly issues: readonly FrenchIssue[];
  readonly fixes: readonly FrenchFix[];
}

/**
 * Les fautes d'une sortie, relevées sur le texte **brut**.
 *
 * Le garde-fou du serveur répare la typographie avant l'affichage ; le compter
 * comme « rien à signaler » masquerait précisément ce qu'on veut faire baisser.
 * Le rapport distingue donc les deux : `fixes` = ce que le serveur a rattrapé,
 * `issues` = ce qui est passé quand même.
 */
function analyse(fields: readonly FieldText[], allowed: readonly string[]): Analysis {
  const issues: FrenchIssue[] = [];
  const counts = new Map<FrenchFix["kind"], number>();

  for (const entry of fields) {
    const report = inspectFrench(entry.text, { protectedNames: allowed, role: entry.role });

    for (const issue of report.issues) issues.push({ ...issue, field: entry.field });
    for (const fix of report.fixes) counts.set(fix.kind, (counts.get(fix.kind) ?? 0) + fix.count);
  }
  return { issues, fixes: [...counts].map(([kind, count]) => ({ kind, count })) };
}

/** Les champs d'une routine, **avant** garde-fou : relus depuis le JSON du modèle. */
function routineFields(raw: string): readonly FieldText[] | null {
  const candidate = extractJsonObject(raw);

  if (candidate === null) return null;

  let value: unknown;

  try {
    value = JSON.parse(candidate);
  } catch {
    return null;
  }

  const parsed = routineContentSchema.safeParse(value);

  if (!parsed.success) return null;

  const routine = parsed.data;

  return [
    { field: "titre", text: routine.titre, role: "titre" },
    ...routine.blocs.flatMap((bloc, index) => [
      { field: `blocs[${index}].nom`, text: bloc.nom, role: "titre" as const },
      ...bloc.items.flatMap((item, item_index) => [
        {
          field: `blocs[${index}].items[${item_index}].texte`,
          text: item.texte,
          role: "titre" as const,
        },
        {
          field: `blocs[${index}].items[${item_index}].detail`,
          text: item.detail,
          role: "phrase" as const,
        },
      ]),
    ]),
    { field: "objectif_game", text: routine.objectif_game, role: "phrase" },
    { field: "conseil", text: routine.conseil, role: "phrase" },
  ];
}

/* ------------------------------------------------------------------ */
/* Une génération                                                      */
/* ------------------------------------------------------------------ */

interface Generation {
  readonly index: number;
  readonly profile: string;
  readonly label: string;
  /** Le verdict de la police de sortie du produit, ou l'erreur d'appel. */
  readonly verdict: string;
  readonly raw: string;
  readonly issues: readonly FrenchIssue[];
  readonly fixes: readonly FrenchFix[];
}

async function runOne(
  options: Options,
  index: number,
  apiKey: string,
  now: Date,
): Promise<Generation> {
  const spec = PROFILES[index % PROFILES.length];

  if (spec === undefined) throw new Error("aucun profil : la table des profils est vide");

  const base = { index, profile: spec.key, label: spec.label };

  try {
    if (options.target === "routine") {
      const context = routineContextFor(spec, index, now);
      const allowed = scenarioNames(context.scenarios);
      const ask = createAsk(providerConfig(options, apiKey), {
        system: routineSystemPrompt(identityOf(spec.profile)),
        maxTokens: MAX_TOKENS.routine,
      });
      const answer = await ask(buildRoutineMessages(context) as CoachMessage[], TIMEOUT_MS);
      const parsed = parseRoutine(answer.text, allowed, citableFacts(context));
      const fields = routineFields(answer.text);
      const analysis = fields === null ? { issues: [], fixes: [] } : analyse(fields, [...allowed]);

      return {
        ...base,
        verdict: parsed.ok ? "police OK" : `police KO : ${parsed.reason}`,
        raw: answer.text,
        ...analysis,
      };
    }

    const context = threadContextFor(spec, index, now);
    const allowed = scenarioNames(context.scenarios);
    const ask = createAsk(providerConfig(options, apiKey), {
      system: coachThreadSystemPrompt(identityOf(spec.profile)),
      maxTokens: MAX_TOKENS.thread,
    });
    const answer = await ask(buildThreadMessages(context), TIMEOUT_MS);
    const parsed = parseThreadAnswer(answer.text, allowed);
    const text = stripDebriefSuggestion(answer.text).text.trim();
    const analysis = analyse([{ field: "answer", text, role: "phrase" }], [...allowed]);

    return {
      ...base,
      verdict: parsed.ok ? "police OK" : `police KO : ${parsed.reason}`,
      raw: answer.text,
      ...analysis,
    };
  } catch (cause) {
    const detail = cause instanceof ModelError ? cause.message : String(cause);

    return { ...base, verdict: `appel en échec : ${detail}`, raw: "", issues: [], fixes: [] };
  }
}

/** Une file d'attente à largeur fixe : le fournisseur a des limites de débit. */
async function runAll(options: Options, apiKey: string, now: Date): Promise<Generation[]> {
  const results: Generation[] = [];
  let next = 0;

  const worker = async (): Promise<void> => {
    while (next < options.count) {
      const index = next;

      next += 1;
      const generation = await runOne(options, index, apiKey, now);

      results.push(generation);
      process.stderr.write(`  ${results.length}/${options.count}\r`);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(options.concurrency, options.count) }, () => worker()),
  );
  return results.sort((left, right) => left.index - right.index);
}

/* ------------------------------------------------------------------ */
/* Rapport                                                             */
/* ------------------------------------------------------------------ */

const OUT_DIR =
  "/private/tmp/claude-501/-Users-alexabriel-Projects-aimforge/fbab6e8a-7c22-44f6-8016-d822d78fddb4/scratchpad/prompt-qa";

function clean(generation: Generation): boolean {
  return (
    generation.verdict === "police OK" &&
    generation.issues.length === 0 &&
    generation.fixes.length === 0
  );
}

function report(options: Options, generations: readonly Generation[]): string {
  const lines: string[] = [
    // Le couple fournisseur/modèle en tête, et pas en note de bas de page : un
    // « 17/20 » sans lui ne se compare à rien, et c'est précisément la confusion
    // qui a fait mesurer le mauvais modèle.
    `Cible : ${options.target} · fournisseur : ${options.provider} · modèle : ${options.model}`,
    `Générations : ${options.count} · concurrence : ${options.concurrency}`,
    "",
  ];

  for (const generation of generations) {
    const mark = clean(generation) ? "OK " : "FAUTE";
    const number = String(generation.index + 1).padStart(2, "0");

    lines.push(`#${number} [${mark}] ${generation.profile} — ${generation.verdict}`);

    for (const fix of generation.fixes) {
      lines.push(`      (rattrapé par le garde-fou) ${fix.kind} ×${fix.count}`);
    }
    for (const issue of generation.issues) {
      lines.push(`      ${issue.kind} · ${issue.field ?? "?"} · « ${issue.excerpt} »`);
    }
  }

  const kinds = new Map<string, number>();

  for (const generation of generations) {
    for (const issue of generation.issues) kinds.set(issue.kind, (kinds.get(issue.kind) ?? 0) + 1);
  }

  const passed = generations.filter(clean).length;

  lines.push(
    "",
    `TOTAL : ${passed}/${generations.length} générations sans faute`,
    kinds.size === 0
      ? "Aucune faute de structure relevée."
      : `Par type : ${[...kinds].map(([kind, count]) => `${kind} ${count}`).join(" · ")}`,
  );
  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* Entrée                                                              */
/* ------------------------------------------------------------------ */

/** L'exemple de ligne de commande qui va avec le fournisseur choisi. */
function exampleCommand(options: Options): string {
  const spec = PROVIDERS[options.provider];
  const model = options.provider === "anthropic" ? "" : ` --model ${options.model}`;

  return `  ${spec.envVar}=… bun scripts/prompt-qa.ts --target ${options.target} --provider ${options.provider}${model} --n 20`;
}

async function main(): Promise<void> {
  const options = readOptions(process.argv.slice(2));
  const spec = PROVIDERS[options.provider];
  const apiKey = (process.env[spec.envVar] ?? "").trim();

  if (apiKey === "") {
    fail(
      [
        `${spec.envVar} est absente de l'environnement (fournisseur : ${options.provider}).`,
        "Ce harnais appelle le fournisseur directement : sans clé, il n'a rien à mesurer.",
        `Clé attendue : ${spec.keyHint}.`,
        "Pose-la le temps d'une exécution :",
        exampleCommand(options),
      ].join("\n"),
    );
  }

  const now = new Date();

  console.error(
    `Génération de ${options.count} sorties « ${options.target} » via ${options.provider}/${options.model}…`,
  );

  const generations = await runAll(options, apiKey, now);
  const stamp = now.toISOString().replaceAll(":", "-");
  // Le fournisseur est dans le nom du fichier : deux campagnes sur deux modèles
  // se comparent, donc elles ne doivent pas s'écraser ni se confondre.
  const path = `${OUT_DIR}/${options.target}-${options.provider}-${stamp}.json`;

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(
    path,
    JSON.stringify(
      {
        target: options.target,
        provider: options.provider,
        model: options.model,
        count: options.count,
        ranAt: now.toISOString(),
        generations,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(report(options, generations));
  console.log(`\nSorties brutes : ${path}`);
}

// Gardé derrière `import.meta.main` : les profils et les contextes sont
// exportés pour être vérifiables sans clé d'API, et les importer ne doit pas
// déclencher vingt appels au fournisseur.
if (import.meta.main) await main();
