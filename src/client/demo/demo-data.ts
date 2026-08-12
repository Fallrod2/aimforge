/**
 * Les données de la **démonstration publique** — celles que voient la landing et
 * la page `#/demo`, sans compte et sans une seule requête.
 *
 * Le principe est le même que celui de l'image de partage : on ne fabrique
 * jamais un chiffre, on **pose des scores sur des ancres réelles du registre**
 * et on laisse le vrai moteur d'énergie en tirer les sous-catégories, l'overall,
 * le rang et le badge « Complete ». Un seuil écrit à la main ici, et la démo
 * montrerait un produit qui ne calcule pas comme le vrai.
 *
 * D'où la forme du plan : chaque sous-catégorie désigne, pour chacun de ses deux
 * scénarios, **le libellé d'une ancre du palier** (« Jade II », « Diamond III »…).
 * Le score joué est le seuil que le registre associe à cette ancre pour ce
 * scénario-là. Rien d'autre n'est écrit.
 *
 * Le portrait choisi : palier **Intermediate**, ancré sur **Jade II** côté
 * clicking et switching, du **tracking en retard** autour de Diamond. C'est le
 * cas le plus fréquent et le plus parlant — un joueur qui clique bien et qui
 * suit mal —, et il produit un overall juste sous le rang Jade : la synthèse a
 * donc quelque chose à dire (« il manque tant pour Jade ») plutôt qu'un plateau.
 *
 * Le passé est le même plan **décalé d'un cran d'ancre** : cinq passes
 * hebdomadaires qui montent, sans qu'aucune valeur soit inventée non plus. La
 * dernière passe et sa précédente en sortent, donc les écarts affichés sont eux
 * aussi de vrais écarts.
 *
 * Module sans React et sans accès réseau : il n'importe de `../data` que des
 * **types**, qui s'effacent à la compilation — la démo ne doit toucher Supabase
 * en aucun cas.
 */

import {
  type BenchmarkId,
  computeBenchRunFor,
  DEFAULT_BENCHMARK_ID,
  getTierFor,
  listScenariosFor,
  listSubcategoriesFor,
  type ScoreMap,
  type TierId,
} from "../../lib/energy";
import type { RoutineSource, StoredRoutine } from "../../shared/routine-contract";
import type { BenchRunDetail } from "../data/types";
import { nextRankFor } from "../energy-view";
import { formatEnergy } from "../format";

/**
 * Le benchmark de la démo : celui par défaut, nommé explicitement.
 *
 * Tous les accès sont **qualifiés** (`…For`) plutôt que laissés au benchmark
 * courant : la démo décrit une passe figée, pas le présent de quelqu'un, et elle
 * doit rendre les mêmes chiffres quel que soit le benchmark actif du visiteur.
 */
export const DEMO_BENCHMARK_ID: BenchmarkId = DEFAULT_BENCHMARK_ID;

/** Le palier de la démo. */
export const DEMO_TIER: TierId = "intermediate";

/** L'ancre de référence du portrait : le haut du plan, côté clicking. */
export const DEMO_ANCHOR = "Jade II";

/**
 * Le plan : par sous-catégorie, l'ancre visée par chacun de ses deux scénarios.
 *
 * L'ordre suit celui du registre (`subcategory.scenarios`), qui est celui du
 * tableur officiel. Une sous-catégorie vaut le **max** de ses deux scénarios :
 * c'est donc la première ancre de chaque paire qui décide de son énergie.
 */
const ANCHOR_PLAN: Readonly<Record<string, readonly [string, string]>> = {
  // Clicking : le point fort du portrait.
  Dynamic: ["Jade II", "Jade"],
  Static: ["Jade III", "Jade II"],
  Linear: ["Jade", "Diamond III"],
  // Tracking : le retard, et donc ce que la routine d'exemple cible.
  Precise: ["Diamond III", "Diamond II"],
  Reactive: ["Diamond II", "Diamond"],
  Control: ["Diamond", "Diamond"],
  // Switching : entre les deux.
  Speed: ["Jade II", "Jade"],
  Evasive: ["Jade", "Diamond III"],
  Stability: ["Diamond III", "Diamond II"],
};

/**
 * Les décalages d'ancres des passes de la démo, de la plus ancienne à la
 * dernière. Six semaines, un cran par semaine : une courbe qui monte sans
 * qu'aucun point ne soit écrit à la main.
 */
const HISTORY_SHIFTS: readonly number[] = [-5, -4, -3, -2, -1, 0];

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** L'index d'une ancre du palier de démo, ou une erreur si elle n'existe pas. */
function anchorIndex(label: string): number {
  const index = getTierFor(DEMO_BENCHMARK_ID, DEMO_TIER).anchorLabels.indexOf(label);

  if (index < 0) throw new Error(`Ancre de démo inconnue : "${label}" (palier ${DEMO_TIER})`);
  return index;
}

/**
 * Les scores d'une passe de démo : un seuil du registre par scénario.
 *
 * `shift` décale toutes les ancres d'autant de crans (négatif = passé), borné
 * aux ancres qui existent — un décalage ne doit jamais sortir du barème.
 */
export function demoScores(shift = 0): ScoreMap {
  const { anchorLabels } = getTierFor(DEMO_BENCHMARK_ID, DEMO_TIER);
  const lastAnchor = anchorLabels.length - 1;
  const scores: Record<string, number> = {};

  for (const subcategory of listSubcategoriesFor(DEMO_BENCHMARK_ID, DEMO_TIER)) {
    const plan = ANCHOR_PLAN[subcategory.name];

    if (plan === undefined) {
      throw new Error(`Sous-catégorie hors du plan de démo : "${subcategory.name}"`);
    }

    for (const [position, scenario] of subcategory.scenarios.entries()) {
      const label = plan[position];

      if (label === undefined) {
        throw new Error(`Plan de démo incomplet pour "${subcategory.name}" (scénario ${position})`);
      }

      const index = Math.min(lastAnchor, Math.max(0, anchorIndex(label) + shift));
      const threshold = scenario.thresholds[index];

      if (threshold === undefined) {
        throw new Error(`Seuil ${index} absent pour "${scenario.name}"`);
      }
      scores[scenario.name] = threshold;
    }
  }
  return scores;
}

/** Combien de scénarios compte le palier de démo (18 sur Voltaic). */
export function demoScenarioCount(): number {
  return listScenariosFor(DEMO_BENCHMARK_ID, DEMO_TIER).length;
}

/** Une passe de démo, calculée par le moteur puis mise à la forme de l'UI. */
function demoRun(shift: number, id: number, date: Date): BenchRunDetail {
  const computed = computeBenchRunFor(DEMO_BENCHMARK_ID, DEMO_TIER, demoScores(shift));

  return {
    id,
    date: date.toISOString(),
    tier: DEMO_TIER,
    benchmarkId: DEMO_BENCHMARK_ID,
    overall: computed.overall,
    rank: computed.rank,
    complete: computed.complete,
    // Le portrait est celui d'un joueur qui importe ses scores : c'est le
    // chemin que la landing met en avant, autant que la démo le montre.
    source: "kovaaks",
    scores: computed.scores,
    subcategories: computed.subcategories,
  };
}

/** Le bench de démonstration : la dernière passe, la précédente, et l'historique. */
export interface DemoBench {
  /** La passe la plus récente : celle que montrent la synthèse et la carte. */
  readonly run: BenchRunDetail;
  /** Celle d'avant, qui donne les écarts affichés. */
  readonly previous: BenchRunDetail;
  /** Les six passes, de la plus ancienne à la dernière — la courbe. */
  readonly history: readonly BenchRunDetail[];
}

/**
 * Le bench de démonstration, daté par rapport à `now`.
 *
 * La date est relative et non figée : une démo qui annonce une passe de l'an
 * dernier se lit comme un produit abandonné. `now` reste un paramètre pour que
 * les tests parlent d'un instant précis.
 */
export function demoBench(now: Date = new Date()): DemoBench {
  const last = HISTORY_SHIFTS.length - 1;
  const history = HISTORY_SHIFTS.map((shift, index) =>
    demoRun(shift, index + 1, new Date(now.getTime() - (last - index) * WEEK_MS)),
  );
  const run = history[last];
  const previous = history[last - 1];

  if (run === undefined || previous === undefined) {
    throw new Error("Historique de démo trop court : il faut au moins deux passes.");
  }
  return { run, previous, history };
}

/**
 * La description de la courbe pour les lecteurs d'écran.
 *
 * Elle est **dérivée** des passes et non écrite à côté du composant : une
 * légende figée finirait par annoncer « de Platinum à Diamond » sur une série
 * qu'on aurait changée entre-temps, et personne ne s'en apercevrait — c'est le
 * propre d'un texte que seuls les lecteurs d'écran entendent.
 */
export function demoCurveLabel(bench: DemoBench): string {
  const first = bench.history[0];
  const rankOf = (run: BenchRunDetail | undefined) => run?.rank ?? "sans rang";

  return `Courbe d'exemple : ${bench.history.length} passes hebdomadaires, de ${rankOf(first)} à ${rankOf(bench.run)}.`;
}

/** Le nom d'une sous-catégorie précédé de sa catégorie (« Tracking · Control »). */
export function demoSubcategoryLabel(subcategory: string): string {
  for (const category of getTierFor(DEMO_BENCHMARK_ID, DEMO_TIER).categories) {
    for (const candidate of category.subcategories) {
      if (candidate.name === subcategory) return `${category.name} · ${subcategory}`;
    }
  }
  throw new Error(`Sous-catégorie inconnue : "${subcategory}"`);
}

/** L'énergie d'une sous-catégorie dans une passe de démo. */
function energyOf(run: BenchRunDetail, subcategory: string): number {
  const found = run.subcategories.find((entry) => entry.name === subcategory);

  if (found === undefined) throw new Error(`Sous-catégorie absente de la passe : "${subcategory}"`);
  return found.energy;
}

/**
 * L'énergie qui manque au prochain rang overall du palier, et son nom.
 * `null` au dernier rang — la démo n'y est pas, mais la fonction ne ment pas.
 *
 * `nextRankFor` et non `nextRank` : la variante non qualifiée résoudrait le
 * benchmark **ambiant** de la lib, que rien ne remet à sa valeur par défaut à la
 * déconnexion. Une démo qui annoncerait « il manque tant pour Jade » d'après le
 * barème adopté par une session précédente serait exactement le chiffre
 * fabriqué que ce module refuse.
 */
export function demoNextRank(run: BenchRunDetail): { name: string; missing: number } | null {
  const upcoming = nextRankFor(DEMO_BENCHMARK_ID, DEMO_TIER, run.overall);

  return upcoming === null ? null : { name: upcoming.rank.name, missing: upcoming.missing };
}

/**
 * Les sources de la routine d'exemple : **les chiffres réels de la démo**.
 *
 * C'est tout l'intérêt de la démonstration du bloc SOURCES — si les valeurs
 * citées ici étaient écrites à la main, la page prouverait exactement le
 * contraire de ce qu'elle affirme. Elles sont donc lues sur la passe, et mises
 * en forme par le même formateur que l'application.
 */
function demoRoutineSources(run: BenchRunDetail): RoutineSource[] {
  const upcoming = demoNextRank(run);
  const sources: RoutineSource[] = [
    {
      label: `Énergie overall · ${getTierFor(DEMO_BENCHMARK_ID, DEMO_TIER).label}`,
      value: formatEnergy(run.overall),
    },
  ];

  for (const subcategory of ["Control", "Reactive", "Precise", "Static"]) {
    sources.push({
      label: demoSubcategoryLabel(subcategory),
      value: formatEnergy(energyOf(run, subcategory)),
    });
  }
  if (upcoming !== null) {
    sources.push({
      label: `Énergie manquante pour ${upcoming.name}`,
      value: formatEnergy(upcoming.missing),
    });
  }
  return sources;
}

/**
 * La routine d'exemple : un contenu **écrit**, des sources **calculées**.
 *
 * Le texte est statique et assumé comme tel — générer une vraie routine pour un
 * visiteur coûterait un appel au modèle sur une page publique. Ce qui ne peut
 * pas être statique, ce sont les chiffres : ils viennent de la passe de démo,
 * donc ils correspondent trait pour trait à ce que la synthèse affiche
 * au-dessus.
 */
export function demoRoutine(bench: DemoBench, now: Date = new Date()): StoredRoutine {
  return {
    id: 1,
    date: now.toISOString(),
    titre: "Rattraper le tracking avant de remonter en clicking",
    duree_minutes: 45,
    duree_totale: 45,
    focus: null,
    done: false,
    blocs: [
      {
        nom: "Échauffement",
        duree: 10,
        items: [
          {
            texte: "VT Pasu Intermediate — 3 séries",
            detail:
              "Sur ta sous-catégorie la plus haute : on démarre sur ce qui répond bien, pas sur ce qui coince. Vise la régularité, pas le record.",
          },
          {
            texte: "VT DotTS Intermediate — 2 séries",
            detail:
              "Deux séries pour réveiller le switching, sans chercher la vitesse maximale. Le poignet doit être chaud avant le bloc suivant.",
          },
        ],
      },
      {
        nom: "Travail ciblé · Tracking",
        duree: 25,
        items: [
          {
            texte: "VT Raw Control Intermediate — 5 séries",
            detail:
              "C'est le point le plus bas de ta passe, donc celui qui tire l'overall vers le bas. Baisse la sensibilité d'un cran si la cible t'échappe par à-coups.",
          },
          {
            texte: "VT Controlsphere Intermediate — 4 séries",
            detail:
              "Même sous-catégorie, mouvement plus lent : cherche le contact continu plutôt que le rattrapage. Repose-toi 30 secondes entre deux séries.",
          },
          {
            texte: "VT Aether Intermediate — 4 séries",
            detail:
              "Tracking réactif : la cible change de direction sans prévenir. Regarde la cible, pas le crosshair — c'est ce qui fait la différence ici.",
          },
        ],
      },
      {
        nom: "Mise en jeu",
        duree: 10,
        items: [
          {
            texte: "Range ou deathmatch, 10 minutes",
            detail:
              "Fin de séance au calme, sur des cibles lentes. Le but est de finir sur une sensation propre, pas d'ajouter de la fatigue.",
          },
        ],
      },
    ],
    objectif_game:
      "Cette semaine, en partie : garde le crosshair sur la cible pendant les duels longs plutôt que de recliquer. C'est exactement ce que travaille le bloc tracking.",
    conseil:
      "Ton clicking est déjà au-dessus du reste : le gagner encore ne fera pas bouger l'overall, qui est tiré par ta sous-catégorie la plus basse. Trois séances de tracking valent mieux qu'une semaine de clicking.",
    // La routine d'exemple est bâtie sur le seul bench : la démo ne montre
    // aucune donnée de partie, et prétendre le contraire serait le premier
    // chiffre inventé de la page.
    mode: "bench_only",
    matchesUsed: 0,
    sources: demoRoutineSources(bench.run),
  };
}
