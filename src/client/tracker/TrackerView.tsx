/**
 * Vue Tracker : saisie des 18 scénarios d'un palier, calcul live, sauvegarde.
 *
 * Le calcul live appelle `computeBenchRun`, la **même** fonction que la
 * sauvegarde : l'aperçu ne peut pas diverger de ce qui sera enregistré, et
 * rien ne part en base tant que l'utilisateur n'a pas sauvegardé.
 *
 * Depuis l'import KovaaK's (SPEC §5 bis), l'écran a deux visages, et lequel
 * s'affiche dépend d'une seule chose — un compte KovaaK's est-il lié ?
 *
 * - **oui** : l'import est le chemin principal, et les 18 champs se replient
 *   derrière un « saisir à la main » discret. Ils ne disparaissent pas : ils
 *   se rouvrent seuls après un import, parce que l'utilisateur doit vérifier
 *   avant de sauvegarder — c'est lui qui valide, pas l'API ;
 * - **non** : la grille reste dépliée comme avant, et un encart explique ce
 *   que la liaison ferait gagner. On ne bloque rien, on propose.
 *
 * V6 (SPEC §5 sexies) enlève le dernier clic du premier cas : l'import **part
 * tout seul** à l'ouverture, pour le palier affiché, et « Rafraîchir » ne sert
 * plus qu'à le rejouer. Ce qui ne bouge pas : la sauvegarde reste manuelle, et
 * rien n'est écrit avant que l'utilisateur ait relu ses chiffres.
 *
 * Trois détails d'attente en découlent, tous dictés par le fait qu'on ouvre
 * désormais sur du réseau plutôt que sur une grille vide :
 *
 * - le palier de départ est celui du **dernier bench** (`useStartTier`), et le
 *   pull l'attend — sinon on importerait Novice avant de découvrir qu'on joue
 *   Intermediate ;
 * - pendant le pull, la zone de saisie montre le **squelette** des 9
 *   sous-catégories du palier plutôt qu'un écran quasi vide ;
 * - un échec (429 du frein quotidien, source muette) déplie la saisie manuelle
 *   sous le message : il reste toujours un chemin pour enregistrer sa passe.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type BenchmarkDefinition,
  type BenchmarkId,
  computeBenchRun,
  firstTierFor,
  getTier,
  getTierFor,
  listScenarios,
  partialEnergy,
  type TierId,
  tierIdsFor,
} from "../../lib/energy";
import { useActiveBenchmark } from "../app/active-benchmark";
import { BenchmarkNote } from "../components/BenchmarkNote";
import { RankBadge } from "../components/RankBadge";
import { Segmented } from "../components/Segmented";
import {
  type BenchRunSummary,
  importKovaaksScores,
  type LinkedAccount,
  primaryAccount,
  saveBenchRun,
} from "../data";
import { rankColorFor } from "../energy-view";
import { formatEnergy, scenarioLabel } from "../format";
import { LinkInvite } from "../linked/LinkInvite";
import { useLinkedAccounts } from "../linked/useLinkedAccounts";
import { awaitsAutoPull, rememberAutoPull, sessionAutoPulls, shouldAutoPull } from "./auto-import";
import {
  type BenchDraft,
  clearTier,
  draftScores,
  emptyDraft,
  setScoreInput,
  tierDraft,
} from "./draft";
import { GoalPanel } from "./GoalPanel";
import { goalProgress, readGoal, writeGoal } from "./goal";
import {
  applyImportedScores,
  clearImportState,
  type ImportState,
  type ImportStates,
  importFailed,
  importReport,
  importStateFor,
  importSucceeded,
  isImportedTier,
  LOADING,
  NO_IMPORTS,
  withImportState,
} from "./import";
import { browserStore } from "./local-store";
import {
  isManualOpen,
  type ManualTiers,
  NO_MANUAL,
  openManual,
  opensManualGrid,
  toggleManual,
} from "./manual";
import { OnboardingBanner } from "./OnboardingBanner";
import { dismissOnboarding, isOnboardingDismissed, showsOnboarding } from "./onboarding";
import { ScenarioRow } from "./ScenarioRow";
import { SummaryPanel } from "./SummaryPanel";
import { usePersonalBests } from "./usePersonalBests";
import { useStartTier } from "./useStartTier";

interface TrackerViewProps {
  /** Ouvre l'historique sur la passe qui vient d'être enregistrée. */
  readonly onSaved: (run: BenchRunSummary) => void;
}

/**
 * Les paliers proposés : ceux du benchmark **actif**, dans son ordre.
 *
 * Calculés dans le rendu et non une fois pour toutes au chargement du module :
 * un autre benchmark peut avoir d'autres paliers (DECISIONS.md D5), et une
 * constante de module les figerait à ceux du benchmark par défaut.
 */
function tierOptionsFor(benchmarkId: BenchmarkId) {
  return tierIdsFor(benchmarkId).map((id) => ({
    value: id,
    label: getTierFor(benchmarkId, id).label,
  }));
}

export function TrackerView({ onSaved }: TrackerViewProps) {
  // Le tracker saisit **dans le benchmark actif** : ses paliers, ses scénarios,
  // ses seuils, et c'est lui qu'estampille la sauvegarde. Les accès non
  // qualifiés de la lib (`computeBenchRun`, `listScenarios`, `getTier`) le
  // suivent d'eux-mêmes — le provider aligne le benchmark courant du module.
  const { benchmarkId, benchmark } = useActiveBenchmark();
  const tierOptions = useMemo(() => tierOptionsFor(benchmarkId), [benchmarkId]);
  /**
   * Le palier choisi à la main, `null` tant que l'utilisateur n'a rien choisi :
   * on affiche alors celui de son dernier bench. Un `useState` initialisé puis
   * corrigé par un effet ferait clignoter Novice sous quelqu'un qui joue
   * Intermediate — et surtout, déclencherait un import de trop.
   */
  const [chosenTier, setChosenTier] = useState<TierId | null>(null);
  const start = useStartTier();
  /**
   * Le palier saisi, **ramené dans le benchmark actif**.
   *
   * Le palier de départ vient du dernier bench enregistré, et un palier n'existe
   * que dans son benchmark (DECISIONS.md D5) : sans ce garde-fou, un joueur dont
   * la dernière passe appartient à un autre barème ouvrirait le tracker sur un
   * palier que `getTier` ne connaît pas — c'est-à-dire sur une exception.
   */
  const tier = useMemo(() => {
    const wanted = chosenTier ?? (start.status === "ready" ? start.tier : null);
    const tiers = tierIdsFor(benchmarkId);

    return wanted !== null && tiers.includes(wanted) ? wanted : firstTierFor(benchmarkId);
  }, [chosenTier, start, benchmarkId]);

  const [draft, setDraft] = useState<BenchDraft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<BenchRunSummary | null>(null);
  /**
   * Le stockage des préférences d'écran (objectif de rang, bandeau refermé).
   *
   * Résolu **une fois par montage** : `browserStore()` sonde `localStorage` à
   * chaque appel, et le refaire à chaque rendu ferait une écriture-lecture par
   * caractère tapé.
   */
  const [prefs] = useState(browserStore);
  const [dismissed, setDismissed] = useState(() => isOnboardingDismissed(prefs));
  /** Les records personnels du palier, chargés une fois — pas à chaque frappe. */
  const personalBests = usePersonalBests(benchmarkId, tier);

  const linked = useLinkedAccounts();
  const accountsKnown = linked.state.status !== "loading";
  const kovaaks =
    linked.state.status === "ready" ? primaryAccount(linked.state.accounts, "kovaaks") : null;
  /**
   * L'état d'import, par palier — comme la saisie. Un état unique survivrait au
   * changement de palier et annoncerait un import au-dessus d'une grille vide.
   */
  const [imports, setImports] = useState<ImportStates>(NO_IMPORTS);
  /**
   * La grille manuelle dépliée, palier par palier — comme la saisie et comme
   * l'état d'import, et pour la même raison : deux pulls peuvent être en vol en
   * même temps, et celui du palier qu'on a quitté n'a pas à décider de ce qui
   * s'affiche sur celui qu'on regarde (`manual.ts`).
   */
  const [manual, setManual] = useState<ManualTiers>(NO_MANUAL);
  const manualOpen = isManualOpen(manual, tier);

  const importState = importStateFor(imports, tier);
  const importedTier = isImportedTier(imports, tier);
  const tierEmpty = Object.keys(tierDraft(draft, tier)).length === 0;
  /**
   * Le squelette tient la place de la grille tant qu'on attend des chiffres :
   * comptes liés encore inconnus, ou import en route sur un palier encore vide
   * (`awaitsAutoPull`). Deux choses qu'il ne fait jamais : escamoter des champs
   * déjà remplis — un « Rafraîchir » ne retire pas à l'écran ce que
   * l'utilisateur est en train de lire —, et faire attendre quelqu'un dont plus
   * rien n'arrivera tout seul (import abouti, échoué, ou saisie effacée).
   *
   * La mémoire d'onglet est lue pendant le rendu : elle n'est écrite que juste
   * avant `setImports(LOADING)`, donc aucun rendu ne la voit changer sans que
   * l'état d'import change dans la foulée.
   *
   * Il s'affiche aussi le temps de savoir s'il y a un compte lié, donc y compris
   * à quelqu'un qui n'en a pas. C'est assumé : on ne peut pas le savoir avant, et
   * le squelette montre les vrais noms de scénarios du palier, aux places exactes
   * qu'ils occuperont — il se change en grille, il ne clignote pas. L'éviter
   * demanderait de repartir sur un écran vide, c'est-à-dire de rendre l'attente
   * plus longue pour le cas que V6 vient d'optimiser.
   */
  const showSkeleton =
    !accountsKnown ||
    (kovaaks !== null && tierEmpty && awaitsAutoPull(importState, sessionAutoPulls(), tier));
  // Sans compte lié, il n'y a rien à replier : la grille est le seul chemin.
  const showGrid = !showSkeleton && (kovaaks === null || manualOpen);

  const { scores, invalid } = useMemo(() => draftScores(draft, tier), [draft, tier]);
  /**
   * `benchmarkId` est dans les dépendances alors qu'aucune de ces deux lignes ne
   * le nomme : c'est justement le piège. `computeBenchRun` et `listScenarios`
   * lisent le benchmark **courant** de la lib — un pointeur de module que
   * `syncCurrentBenchmark` déplace, et dont React ne sait rien. Sans cette
   * dépendance, changer de benchmark au Profil laisserait le tracker afficher
   * les scénarios et les énergies de l'ancien barème jusqu'au prochain
   * changement de palier ou de saisie.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: `computeBenchRun` lit le benchmark courant de la lib, que React ne voit pas.
  const computed = useMemo(() => computeBenchRun(tier, scores), [tier, scores, benchmarkId]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: idem — `listScenarios` dépend du benchmark courant sans le nommer.
  const scenarios = useMemo(() => listScenarios(tier), [tier, benchmarkId]);
  // Lu à chaque rendu, donc déjà aligné sur le benchmark affiché.
  const tierData = getTier(tier);
  /**
   * L'énergie partielle de la saisie en cours (§4.1a).
   *
   * Elle n'a d'usage que tant que l'overall vaut 0 : au-delà, les deux sont
   * égales par construction (même moyenne harmonique, mêmes neuf termes).
   */
  const partial = useMemo(
    () =>
      computed.subcategories.length === 0
        ? null
        : partialEnergy(computed.subcategories.map((sub) => sub.energy)),
    [computed],
  );
  const showPartial = computed.overall === 0 && partial !== null;

  /** L'objectif de rang du palier, relu à chaque changement de palier (§4.5). */
  const [goal, setGoal] = useState<string | null>(null);

  useEffect(() => {
    setGoal(readGoal(prefs, benchmarkId, tier));
  }, [prefs, benchmarkId, tier]);

  const changeGoal = useCallback(
    (rank: string | null) => {
      writeGoal(prefs, benchmarkId, tier, rank);
      setGoal(rank);
    },
    [prefs, benchmarkId, tier],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: `goalProgress` lit les seuils du benchmark courant, que React ne voit pas.
  const goalState = useMemo(
    () => (goal === null ? null : goalProgress(tier, goal, scores)),
    [tier, goal, scores, benchmarkId],
  );

  const update = useCallback(
    (scenario: string, raw: string) => {
      setSaved(null);
      setDraft((current) => setScoreInput(current, tier, scenario, raw));
    },
    [tier],
  );

  const canSave = computed.scores.length > 0 && invalid.length === 0 && !saving;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      // Une passe pré-remplie reste pré-remplie même si l'utilisateur en a
      // corrigé un champ : ce qui compte pour l'historique, c'est que ces
      // chiffres n'ont pas été relevés à la main.
      const run = await saveBenchRun({
        tier,
        scores,
        source: importedTier ? "kovaaks" : "manual",
        // Dit explicitement, alors que le défaut donnerait la même valeur : la
        // passe est estampillée du benchmark que l'écran affiche, pas d'un
        // pointeur de module qu'il faudrait aller vérifier ailleurs.
        benchmarkId,
      });

      setSaved(run);
      onSaved(run);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "L'enregistrement a échoué.");
    } finally {
      setSaving(false);
    }
  }

  /**
   * Importe les scores du palier courant et les verse dans la saisie.
   *
   * La grille s'ouvre à l'arrivée, toujours : l'import ne sauvegarde rien, et
   * un écran qui annoncerait « 18 scores importés » sans les montrer
   * demanderait de faire confiance à une source non officielle les yeux fermés.
   * Elle s'ouvre aussi sur un échec — c'est le repli manuel (`auto-import.ts`).
   */
  const runImport = useCallback(async (account: LinkedAccount, target: TierId) => {
    setImports((current) => withImportState(current, target, LOADING));
    setSaved(null);
    setError(null);

    let settled: ImportState;

    try {
      const result = await importKovaaksScores(account.externalId, target);

      setDraft((current) => applyImportedScores(current, target, result.scores));
      settled = importSucceeded(result);
    } catch (cause) {
      settled = importFailed(cause instanceof Error ? cause.message : "L'import a échoué.");
    }
    setImports((current) => withImportState(current, target, settled));
    // `target`, pas le palier affiché : une réponse en retard n'ouvre que sa
    // propre grille, jamais celle que l'utilisateur vient de replier ailleurs.
    if (opensManualGrid(settled)) setManual((current) => openManual(current, target));
  }, []);

  /**
   * Le pull automatique : l'import du palier affiché, sans clic, une fois par
   * palier et par session d'onglet.
   *
   * La marque est posée **avant** la requête, dans une mémoire de module que
   * ni le double montage de `StrictMode` ni un aller-retour par le tableau de
   * bord ne remettent à zéro : deux imports pour un écran, ce sont deux unités
   * du quota quotidien de l'utilisateur (SPEC §5 bis, 20/jour).
   */
  useEffect(() => {
    if (kovaaks === null) return;
    const context = {
      tier,
      hasAccount: true,
      ready: start.status === "ready",
      pulls: sessionAutoPulls(),
      state: importState,
    };

    if (!shouldAutoPull(context)) return;
    rememberAutoPull(tier);
    void runImport(kovaaks, tier);
  }, [kovaaks, tier, start.status, importState, runImport]);

  function reset() {
    setSaved(null);
    setError(null);
    setDraft((current) => clearTier(current, tier));
    // Effacer la saisie efface aussi sa provenance : ce qui sera tapé ensuite
    // ne vient plus de l'import. Les autres paliers gardent la leur.
    setImports((current) => clearImportState(current, tier));
  }

  return (
    <div className="grid gap-6 pb-24 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:pb-0">
      <aside className="flex flex-col gap-4 lg:order-2 lg:sticky lg:top-24">
        <div>
          <p className="mb-2 text-[11px] font-medium tracking-[0.18em] text-steel-400 uppercase">
            Palier
          </p>
          <Segmented label="Palier" options={tierOptions} value={tier} onChange={setChosenTier} />
          {/* Le barème dans lequel on saisit, juste sous le palier : les deux
              décident ensemble des seuils, et le second se change au Profil. */}
          <div className="mt-2">
            <BenchmarkNote benchmark={benchmark} />
          </div>
        </div>

        <SummaryPanel
          tier={tier}
          computed={computed}
          scenarioCount={scenarios.length}
          onTierChange={setChosenTier}
        />

        <GoalPanel
          tier={tier}
          tierLabel={tierData.label}
          goal={goal}
          progress={goalState}
          onGoalChange={changeGoal}
        />

        <div className="hidden flex-col gap-3 lg:flex">
          <SaveActions
            canSave={canSave}
            saving={saving}
            hasDraft={Object.keys(tierDraft(draft, tier)).length > 0}
            onSave={save}
            onReset={reset}
          />
          <Feedback error={error} invalid={invalid} saved={saved} />
        </div>
      </aside>

      <div className="flex flex-col gap-8 lg:order-1">
        {/* Les trois étapes, une seule fois, à un compte qui n'a ni passe ni
            saisie en cours. Elles passent **avant** l'import : c'est la seule
            chose à lire quand on ne sait pas encore d'où viennent les scores. */}
        {showsOnboarding({
          hasRuns: start.status === "ready" ? start.hasRuns : null,
          hasDraft: !tierEmpty,
          dismissed,
        }) ? (
          <OnboardingBanner
            benchmark={benchmark}
            onDismiss={() => {
              dismissOnboarding(prefs);
              setDismissed(true);
            }}
          />
        ) : null}

        <ImportPanel
          account={kovaaks}
          loading={!accountsKnown}
          state={importState}
          benchmark={benchmark}
          scenarioCount={scenarios.length}
          tierLabel={tierData.label}
          imported={importedTier}
          manualOpen={manualOpen}
          onRefresh={() => {
            if (kovaaks !== null) void runImport(kovaaks, tier);
          }}
          onToggleManual={() => setManual((current) => toggleManual(current, tier))}
        />

        {showSkeleton ? <TierSkeleton tier={tier} /> : null}

        {!showGrid
          ? null
          : tierData.categories.map((category) => (
              <section key={category.name}>
                <div className="mb-3 flex items-center gap-3">
                  <h2 className="text-[11px] font-semibold tracking-[0.18em] text-steel-300 uppercase">
                    {category.name}
                  </h2>
                  <span className="h-px flex-1 bg-steel-800" />
                </div>

                {/* Sur grand écran, les sous-catégories se rangent en colonnes
                    (§4.1b) : la saisie mobile fait environ 3 400 px de haut, et
                    l'empilement d'une colonne unique obligeait à faire défiler
                    tout l'écran pour relire une ligne saisie trois minutes plus
                    tôt. Le téléphone, lui, ne change pas.

                    **Deux** colonnes et pas trois : la coque plafonne à
                    `max-w-5xl` et le panneau latéral prend 20 rem, ce qui laisse
                    environ 630 px à la grille. Une troisième colonne y ferait
                    des cartes de 200 px — plus étroites que le champ de saisie
                    qu'elles contiennent. Le nombre de colonnes suit la place
                    réelle, pas la largeur de la fenêtre.

                    Chaque carte est d'ailleurs un **conteneur** : c'est sa
                    largeur, et non celle de la fenêtre, qui décide de la mise en
                    page de ses lignes (cf. `ScenarioRow`). */}
                <div className="flex flex-col gap-3 lg:grid lg:grid-cols-2">
                  {category.subcategories.map((subcategory) => {
                    const energy =
                      computed.subcategories.find((sub) => sub.name === subcategory.name)?.energy ??
                      0;

                    return (
                      <div
                        key={subcategory.name}
                        className="@container rounded-xl border border-steel-800 bg-steel-900/60 px-4 py-3"
                      >
                        <div className="flex items-baseline justify-between gap-3 border-b border-steel-800 pb-2">
                          <h3 className="text-sm font-medium text-steel-100">{subcategory.name}</h3>
                          <p className="font-mono text-xs tabular-nums text-steel-400">
                            {energy > 0 ? formatEnergy(energy) : "—"}
                          </p>
                        </div>
                        <div className="divide-y divide-steel-800/70">
                          {subcategory.scenarios.map((scenario) => (
                            <ScenarioRow
                              key={scenario.name}
                              tier={tier}
                              tierLabel={tierData.label}
                              scenario={scenario.name}
                              value={tierDraft(draft, tier)[scenario.name] ?? ""}
                              energy={
                                computed.scores.find((row) => row.scenario === scenario.name)
                                  ?.energy ?? 0
                              }
                              personalBest={personalBests.get(scenario.name)}
                              onChange={(raw) => update(scenario.name, raw)}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
      </div>

      {/* Sur téléphone, les 18 champs défilent : l'overall et l'action restent
          accessibles en bas d'écran plutôt qu'en haut de page.
          `bottom-16` = la hauteur de la barre de navigation du pouce
          (`BOTTOM_BAR_HEIGHT` dans `AppLayout`) : les deux s'empilent.

          La barre portait « X/18 · SANS RANG » et un tiret à la place du
          chiffre : sur un bench en cours — c'est-à-dire pendant tout le temps
          où l'on tape — elle n'affichait donc aucune énergie. Elle montre
          désormais l'overall dès qu'il existe, et l'énergie **partielle**
          étiquetée avant cela (§4.7), recalculée à chaque frappe comme le reste
          de l'écran. */}
      <div className="fixed inset-x-0 bottom-16 z-10 border-t border-steel-800 bg-steel-950/95 px-4 py-3 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="flex items-baseline gap-1.5">
              <span
                className={`font-mono text-xl leading-none font-semibold tabular-nums ${
                  showPartial ? "text-steel-300" : ""
                }`}
              >
                {computed.overall > 0
                  ? formatEnergy(computed.overall)
                  : showPartial
                    ? formatEnergy(partial.energy)
                    : "—"}
              </span>
              {/* L'étiquette est collée au chiffre, pas reléguée en légende :
                  c'est elle qui empêche de lire une énergie partielle comme un
                  overall. Le badge de rang reste à sa place et continue
                  d'annoncer « Sans rang » — aucun rang ne sort d'un partiel. */}
              {showPartial ? (
                <span className="text-[10px] font-medium tracking-wide text-steel-500 uppercase">
                  Partiel
                </span>
              ) : null}
            </p>
            <p className="mt-1 truncate text-[11px] text-steel-500">
              {computed.scores.length}/{scenarios.length} scénarios
              {showPartial ? ` · ${partial.counted}/${partial.total} sous-catégories` : ""}
            </p>
          </div>
          <RankBadge
            rank={computed.rank}
            color={rankColorFor(tier, computed.overall)}
            complete={computed.complete}
            size="sm"
          />
          <SaveButton canSave={canSave} saving={saving} onSave={save} compact />
        </div>
        <div className="mx-auto mt-2 max-w-3xl lg:hidden">
          <Feedback error={error} invalid={invalid} saved={saved} />
        </div>
      </div>
    </div>
  );
}

export interface ImportPanelProps {
  /** Le compte KovaaK's lié, ou `null` s'il n'y en a pas. */
  readonly account: LinkedAccount | null;
  /** Les comptes liés ne sont pas encore connus : ne rien affirmer. */
  readonly loading: boolean;
  readonly state: ImportState;
  /** Le benchmark actif : c'est le sien que l'import va chercher. */
  readonly benchmark: BenchmarkDefinition;
  readonly scenarioCount: number;
  readonly tierLabel: string;
  /** La saisie courante du palier vient d'un import. */
  readonly imported: boolean;
  readonly manualOpen: boolean;
  /** Rejoue l'import du palier affiché, à la demande. */
  readonly onRefresh: () => void;
  readonly onToggleManual: () => void;
}

/**
 * L'en-tête du tracker : l'import quand il est possible, l'invitation à lier
 * quand il ne l'est pas.
 *
 * Tant que les comptes liés ne sont pas chargés, on n'affiche ni l'un ni
 * l'autre : proposer de lier un compte à quelqu'un qui en a déjà un, même une
 * demi-seconde, c'est lui dire qu'on ne l'a pas reconnu.
 *
 * Depuis V6, l'import ne s'y déclenche plus : il est déjà parti. Le panneau
 * rend compte (« Récupération… », le bilan, ce qui manque) et garde un
 * « Rafraîchir » discret pour rejouer le palier — un bouton d'action primaire
 * n'a plus de sens pour quelque chose que l'écran fait de lui-même.
 *
 * Exporté pour le rendu statique des tests : ce qu'il promet quand rien n'est
 * lié, et ce qu'il laisse comme issue quand l'import échoue, sont les deux
 * phrases que la vue entière ne permet pas de vérifier sans session.
 */
export function ImportPanel({
  account,
  loading,
  state,
  benchmark,
  scenarioCount,
  tierLabel,
  imported,
  manualOpen,
  onRefresh,
  onToggleManual,
}: ImportPanelProps) {
  if (loading) return null;

  if (account === null) {
    return (
      <LinkInvite title="Tes scores peuvent se remplir tout seuls">
        Lie ton pseudo KovaaK's une fois : le tracker ira chercher tes scores du benchmark{" "}
        {benchmark.name} et remplira les champs qu'il trouve — les {scenarioCount} si tu as joué
        tout le palier. D'ici là, et chaque fois que la source ne répond pas, la saisie à la main
        ci-dessous fait le travail.
      </LinkInvite>
    );
  }

  const report = importReport(state, scenarioCount);
  const busy = state.status === "loading";

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-steel-800 bg-steel-900/60 p-4">
      <div className="flex flex-wrap items-center gap-3">
        {imported ? <SourceBadge /> : null}
        <button
          type="button"
          disabled={busy}
          onClick={onRefresh}
          className="shrink-0 rounded-md border border-steel-700 px-2.5 py-1.5 text-[11px] font-medium text-steel-300 transition-colors hover:border-steel-600 hover:text-steel-100 disabled:cursor-not-allowed disabled:border-steel-800 disabled:text-steel-600"
        >
          {busy ? "Récupération…" : "Rafraîchir"}
        </button>
        {/* Sur téléphone, badge et bouton occupent déjà la ligne : la
            provenance passe dessous plutôt que d'être tronquée à trois lettres. */}
        <p className="min-w-0 basis-full truncate text-[11px] text-steel-500 sm:flex-1 sm:basis-auto">
          {account.externalId} · palier {tierLabel}
        </p>
      </div>

      {busy ? (
        <p aria-live="polite" className="text-xs text-steel-400">
          Récupération de tes scores KovaaK's…
        </p>
      ) : null}
      {state.status === "error" ? (
        <p aria-live="polite" className="text-xs text-ember-400">
          {state.message} Tes scores restent saisissables à la main ci-dessous.
        </p>
      ) : null}
      {report === null ? null : (
        <p aria-live="polite" className="text-xs text-steel-400">
          {report}
        </p>
      )}
      {state.status === "done" && state.missing.length > 0 ? (
        <MissingList missing={state.missing} />
      ) : null}

      <button
        type="button"
        onClick={onToggleManual}
        aria-expanded={manualOpen}
        className="self-start text-[11px] text-steel-500 underline-offset-2 transition-colors hover:text-steel-300 hover:underline"
      >
        {manualOpen ? "Masquer la saisie manuelle" : "Saisir à la main"}
      </button>
    </div>
  );
}

/** Le badge de provenance : ces chiffres n'ont pas été relevés à la main. */
function SourceBadge() {
  return (
    <span className="shrink-0 rounded-full border border-quench-500/50 bg-quench-500/10 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-quench-500 uppercase">
      Importé KovaaK's
    </span>
  );
}

/**
 * Les scénarios que l'import n'a pas ramenés.
 *
 * Les nommer plutôt que les compter : « 4 manquants » envoie chercher lesquels
 * dans dix-huit champs, alors que la liste dit directement où taper.
 */
function MissingList({ missing }: { readonly missing: ImportMissing }) {
  return (
    <details className="text-[11px] text-steel-500">
      <summary className="cursor-pointer transition-colors hover:text-steel-300">
        Voir les {missing.length} scénarios restés vides
      </summary>
      <ul className="mt-2 flex flex-col gap-1">
        {missing.map((entry) => (
          <li key={entry.scenario} className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-steel-400">{entry.scenario}</span>
            <span className="shrink-0">{MISSING_LABELS[entry.reason]}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

type ImportMissing = Extract<ImportState, { status: "done" }>["missing"];

const MISSING_LABELS: Readonly<Record<ImportMissing[number]["reason"], string>> = {
  absent: "absent du benchmark",
  "sans-score": "jamais joué",
  incoherent: "score inexploitable",
};

/**
 * Le squelette de saisie : les 9 sous-catégories et leurs 18 scénarios, aux
 * vrais noms du palier, sans valeur.
 *
 * Il ne s'agit pas de meubler. Depuis que l'import part tout seul, l'écran
 * passe une à deux secondes sans grille — et une page quasi vide ne dit ni ce
 * qui arrive, ni ce que l'application va demander. Les noms réels, eux,
 * répondent aux deux : voilà les scénarios de ton palier, les chiffres
 * arrivent. C'est aussi ce qui rend la bascule sans saut de mise en page,
 * puisque le squelette a la forme de la grille qui le remplace.
 */
function TierSkeleton({ tier }: { readonly tier: TierId }) {
  const { label, categories } = getTier(tier);

  return (
    <div aria-busy="true" className="flex flex-col gap-8">
      {categories.map((category) => (
        <section key={category.name}>
          <div className="mb-3 flex items-center gap-3">
            <h2 className="text-[11px] font-semibold tracking-[0.18em] text-steel-300 uppercase">
              {category.name}
            </h2>
            <span className="h-px flex-1 bg-steel-800" />
          </div>

          <div className="flex flex-col gap-3">
            {category.subcategories.map((subcategory) => (
              <div
                key={subcategory.name}
                className="rounded-xl border border-steel-800 bg-steel-900/40 px-4 py-3"
              >
                <div className="flex items-baseline justify-between gap-3 border-b border-steel-800 pb-2">
                  <h3 className="text-sm font-medium text-steel-400">{subcategory.name}</h3>
                  <p className="font-mono text-xs tabular-nums text-steel-600">—</p>
                </div>
                <div className="divide-y divide-steel-800/70">
                  {subcategory.scenarios.map((scenario) => (
                    <div
                      key={scenario.name}
                      className="flex items-center justify-between gap-3 py-3"
                    >
                      <span className="min-w-0 truncate text-sm text-steel-500">
                        {scenarioLabel(scenario.name, label)}
                      </span>
                      <span className="h-9 w-24 shrink-0 animate-pulse rounded-md bg-steel-800/70" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

interface SaveButtonProps {
  readonly canSave: boolean;
  readonly saving: boolean;
  readonly onSave: () => void;
  readonly compact?: boolean;
}

function SaveButton({ canSave, saving, onSave, compact = false }: SaveButtonProps) {
  return (
    <button
      type="button"
      disabled={!canSave}
      onClick={onSave}
      className={`rounded-lg bg-ember-500 font-semibold text-steel-950 transition-colors hover:bg-ember-400 disabled:cursor-not-allowed disabled:bg-steel-800 disabled:text-steel-500 ${
        compact ? "shrink-0 px-4 py-2.5 text-sm" : "w-full px-4 py-3 text-sm"
      }`}
    >
      {saving ? "Enregistrement…" : "Sauvegarder"}
    </button>
  );
}

interface SaveActionsProps extends SaveButtonProps {
  readonly hasDraft: boolean;
  readonly onReset: () => void;
}

function SaveActions({ canSave, saving, hasDraft, onSave, onReset }: SaveActionsProps) {
  return (
    <div className="flex flex-col gap-2">
      <SaveButton canSave={canSave} saving={saving} onSave={onSave} />
      <button
        type="button"
        disabled={!hasDraft || saving}
        onClick={onReset}
        className="rounded-lg border border-steel-700 px-4 py-2.5 text-xs font-medium text-steel-300 transition-colors hover:border-steel-600 hover:text-steel-100 disabled:cursor-not-allowed disabled:text-steel-600"
      >
        Effacer la saisie
      </button>
    </div>
  );
}

interface FeedbackProps {
  readonly error: string | null;
  readonly invalid: readonly string[];
  readonly saved: BenchRunSummary | null;
}

function Feedback({ error, invalid, saved }: FeedbackProps) {
  if (invalid.length > 0) {
    return (
      <p className="text-xs text-ember-400">
        {invalid.length} score{invalid.length > 1 ? "s" : ""} à corriger avant de sauvegarder.
      </p>
    );
  }
  if (error !== null) {
    return <p className="text-xs text-ember-400">{error}</p>;
  }
  if (saved !== null) {
    return <p className="text-xs text-steel-400">Passe enregistrée. Elle est dans l'historique.</p>;
  }
  return null;
}
