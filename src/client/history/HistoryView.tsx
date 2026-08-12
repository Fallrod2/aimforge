/**
 * Vue Historique : les passes enregistrées d'un palier, leur détail, leur
 * suppression, et la courbe de progression.
 *
 * L'historique est cadré sur **un** palier à la fois, comme le tracker : les
 * énergies de deux paliers ne sont pas comparables (500 en Novice n'est pas
 * 500 en Advanced), donc ni la liste ni la courbe ne les mélangent.
 *
 * **Et sur un seul benchmark** (SPEC §5 quinquies), pour la même raison portée
 * plus loin : deux benchmarks n'ont pas les mêmes seuils, donc un 447 S5 et un
 * 447 S6 ne décrivent pas la même performance. Le cadrage est le benchmark
 * **actif** de l'utilisateur (`profiles.active_benchmark`, DECISIONS.md D6) —
 * celui qu'il joue, celui que le tracker estampille. Il n'y a pas de sélecteur
 * ici : il vit au Profil, une fois, plutôt qu'une fois par écran. Les passes des
 * autres benchmarks ne sont pas cachées pour autant : elles sont comptées à côté
 * du total, comme le sont déjà les passes des autres paliers.
 *
 * Les passes d'archive, elles, se relisent **avec le benchmark de la passe** et
 * non avec l'actif (`mapping.ts`) : changer de benchmark actif ne réécrit aucun
 * chiffre déjà enregistré.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type BenchmarkId,
  firstTierFor,
  getTier,
  getTierFor,
  listScenariosFor,
  listSubcategories,
  type TierId,
  tierIdsFor,
} from "../../lib/energy";
import { useActiveBenchmark } from "../app/active-benchmark";
import { BenchmarkNote } from "../components/BenchmarkNote";
import { Notice } from "../components/Notice";
import { Segmented } from "../components/Segmented";
import { type BenchRunSummary, deleteBenchRun, listBenchRuns, listScenarioScores } from "../data";
import { previousRun } from "../run-delta";
import { benchRunsCsv, type CsvRun, csvFileName } from "./csv";
import { ProgressChart } from "./ProgressChart";
import { RunCard } from "./RunCard";
import { buildSeries } from "./series";
import { useRunDetails } from "./useRunDetails";

interface HistoryViewProps {
  /** Passe dépliée, portée par la route (un lien vers une passe reste valide). */
  readonly focusRunId: number | null;
  readonly onFocusRun: (runId: number | null) => void;
}

type Loadable =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly runs: readonly BenchRunSummary[] };

/**
 * Les paliers proposés : ceux du benchmark **actif**, dans son ordre. Calculés
 * au rendu, pas au chargement du module : un autre benchmark a d'autres paliers
 * (DECISIONS.md D5).
 */
function tierOptionsFor(benchmarkId: BenchmarkId) {
  return tierIdsFor(benchmarkId).map((id) => ({
    value: id,
    label: getTierFor(benchmarkId, id).label,
  }));
}

function failureMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

/**
 * Déclenche le téléchargement d'un texte, côté navigateur.
 *
 * L'`URL` objet est révoquée juste après : sans cela, chaque export garderait
 * son fichier en mémoire jusqu'au rechargement de l'onglet.
 */
function downloadText(content: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export function HistoryView({ focusRunId, onFocusRun }: HistoryViewProps) {
  const { benchmarkId, benchmark } = useActiveBenchmark();
  const tierOptions = useMemo(() => tierOptionsFor(benchmarkId), [benchmarkId]);
  const [state, setState] = useState<Loadable>({ status: "loading" });
  const [tier, setTier] = useState<TierId | null>(null);
  const [subcategory, setSubcategory] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // `focusRunId` ne sert au chargement qu'à choisir le palier initial. Le
  // passer en dépendance relancerait la liste à chaque dépliage de passe : on
  // le lit donc par référence, sans faire de `load` une fonction instable.
  const focusRunIdRef = useRef(focusRunId);
  focusRunIdRef.current = focusRunId;

  // Même raison pour le benchmark actif : il ne sert au chargement qu'à choisir
  // le palier initial. Le mettre en dépendance rechargerait toute la liste à
  // chaque changement de benchmark, alors que la lecture n'est pas filtrée en
  // base — c'est le rendu qui filtre, et il suit déjà.
  const benchmarkIdRef = useRef(benchmarkId);
  benchmarkIdRef.current = benchmarkId;

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const runs = await listBenchRuns();
      // Le palier initial se choisit dans ce que la vue va réellement montrer,
      // c'est-à-dire le benchmark actif : le déduire d'une passe d'archive
      // ouvrirait l'historique sur un palier vide.
      const active = benchmarkIdRef.current;
      const shown = runs.filter((run) => run.benchmarkId === active);

      setState({ status: "ready", runs });
      // Le palier n'est choisi qu'une fois, au premier chargement : celui de la
      // passe ouverte si la route en désigne une, sinon celui de la plus récente.
      setTier(
        (current) =>
          current ??
          shown.find((run) => run.id === focusRunIdRef.current)?.tier ??
          shown[0]?.tier ??
          firstTierFor(active),
      );
    } catch (cause) {
      setState({ status: "error", message: failureMessage(cause, "Chargement impossible.") });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runs = state.status === "ready" ? state.runs : [];
  /**
   * Le palier affiché, **ramené dans le benchmark actif**.
   *
   * Un palier choisi sous un benchmark peut ne pas exister sous le suivant
   * (DECISIONS.md D5) : sans ce garde-fou, changer de benchmark depuis le Profil
   * ferait lever `getTier` sur un palier inconnu au retour ici.
   */
  const activeTier = useMemo(() => {
    const tiers = tierIdsFor(benchmarkId);

    return tier !== null && tiers.includes(tier) ? tier : firstTierFor(benchmarkId);
  }, [tier, benchmarkId]);
  // Le filtre de benchmark passe **avant** celui de palier : le graphe ne doit
  // jamais tracer deux échelles de seuils sur le même axe.
  const benchmarkRuns = useMemo(
    () => runs.filter((run) => run.benchmarkId === benchmarkId),
    [runs, benchmarkId],
  );
  const otherBenchmarkCount = runs.length - benchmarkRuns.length;
  const tierRuns = useMemo(
    () => benchmarkRuns.filter((run) => run.tier === activeTier),
    [benchmarkRuns, activeTier],
  );
  const otherTierCount = benchmarkRuns.length - tierRuns.length;

  /**
   * La passe qui précède celle qu'on a dépliée (§4.4).
   *
   * Elle est cherchée dans **toutes** les passes chargées, pas dans `tierRuns` :
   * `previousRun` applique lui-même le cadrage palier + benchmark, et le lui
   * laisser évite qu'un filtre d'affichage devienne la définition de « la passe
   * précédente ».
   */
  const focusPrevious = useMemo(() => {
    const current = tierRuns.find((run) => run.id === focusRunId);

    return current === undefined ? null : previousRun(runs, current);
  }, [runs, tierRuns, focusRunId]);

  const neededIds = useMemo(() => {
    const ids = new Set<number>();

    if (focusRunId !== null) ids.add(focusRunId);
    // Le détail de la précédente est chargé avec celui de la passe ouverte :
    // les écarts par sous-catégorie ne se lisent pas dans le résumé, qui ne
    // porte que l'overall.
    if (focusPrevious !== null) ids.add(focusPrevious.id);
    if (subcategory !== null) for (const run of tierRuns) ids.add(run.id);
    return [...ids].sort((a, b) => a - b);
  }, [focusRunId, focusPrevious, subcategory, tierRuns]);

  const details = useRunDetails(neededIds);
  const points = useMemo(
    () => buildSeries(tierRuns, details.byId, subcategory),
    [tierRuns, details.byId, subcategory],
  );

  function changeTier(next: TierId): void {
    setTier(next);
    setConfirmingId(null);
    setDeleteError(null);
    onFocusRun(null);
  }

  /**
   * L'export CSV du benchmark actif (§4.8).
   *
   * Toutes ses passes, tous paliers confondus — l'historique en filtre un à
   * l'écran, mais un fichier qu'on ouvre dans un tableur n'a aucune raison
   * d'être amputé. Les colonnes de scénario, elles, sont celles du palier
   * affiché : ce sont les seules qui se remplissent, et les passes des autres
   * paliers y laissent des cases vides plutôt qu'un score sous une mauvaise
   * étiquette.
   *
   * Une seule requête pour les scores (`listScenarioScores`), même sur cinquante
   * passes. Le fichier, lui, est fabriqué et téléchargé sans quitter le
   * navigateur : rien de tout cela ne repasse par le serveur.
   */
  async function exportCsv(): Promise<void> {
    setExporting(true);
    setExportError(null);
    try {
      const scoresByRun = await listScenarioScores(benchmarkRuns.map((run) => run.id));
      const rows: readonly CsvRun[] = benchmarkRuns.map((run) => ({
        date: run.date,
        tierLabel: getTierFor(run.benchmarkId, run.tier).label,
        overall: run.overall,
        rank: run.rank,
        complete: run.complete,
        // Le garde-fou du cadrage : une passe d'un autre palier n'apporte aucun
        // score aux colonnes affichées, même si un benchmark venait à nommer
        // deux scénarios de paliers différents de la même façon.
        scores: run.tier === activeTier ? (scoresByRun.get(run.id) ?? {}) : {},
      }));
      const columns = listScenariosFor(benchmarkId, activeTier).map((scenario) => scenario.name);

      downloadText(
        benchRunsCsv(rows, columns),
        csvFileName(benchmarkId, getTier(activeTier).label, new Date()),
      );
    } catch (cause) {
      setExportError(failureMessage(cause, "L'export n'a pas pu être généré."));
    } finally {
      setExporting(false);
    }
  }

  async function confirmDelete(id: number): Promise<void> {
    setDeletingId(id);
    setDeleteError(null);
    try {
      await deleteBenchRun(id);
      setState((current) =>
        current.status === "ready"
          ? { status: "ready", runs: current.runs.filter((run) => run.id !== id) }
          : current,
      );
      details.forget(id);
      setConfirmingId(null);
      if (focusRunId === id) onFocusRun(null);
    } catch (cause) {
      setDeleteError(failureMessage(cause, "La suppression a échoué."));
    } finally {
      setDeletingId(null);
    }
  }

  if (state.status === "loading") {
    return <Notice tone="loading" title="Chargement de l'historique…" />;
  }
  if (state.status === "error") {
    return (
      <Notice tone="error" title="L'historique n'a pas pu être chargé." onRetry={() => void load()}>
        {state.message}
      </Notice>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-steel-100">Historique</h2>
          <p className="mt-0.5 text-xs text-steel-500">
            {tierRuns.length} passe{tierRuns.length > 1 ? "s" : ""} en {getTier(activeTier).label}
            {otherTierCount > 0 ? ` · ${otherTierCount} dans les autres paliers` : ""}
            {otherBenchmarkCount > 0 ? ` · ${otherBenchmarkCount} dans un autre barème` : ""}
          </p>
          {/* Le barème avec lequel ces passes se relisent, discrètement : c'est
              lui qui décide des seuils, donc des énergies affichées ci-dessous. */}
          <BenchmarkNote benchmark={benchmark} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Palier de l'historique"
            options={tierOptions}
            value={activeTier}
            onChange={changeTier}
          />
          {/* L'export n'a de sens que s'il y a quelque chose à exporter : sans
              passe dans ce barème, le bouton produirait un fichier d'en-têtes. */}
          {benchmarkRuns.length === 0 ? null : (
            <button
              type="button"
              onClick={() => void exportCsv()}
              disabled={exporting}
              className="rounded-lg border border-steel-700 px-3 py-1.5 text-xs font-medium text-steel-300 transition-colors hover:border-steel-600 hover:text-steel-100 disabled:cursor-not-allowed disabled:text-steel-600"
            >
              {exporting ? "Export…" : "Exporter (CSV)"}
            </button>
          )}
        </div>
      </div>

      {exportError === null ? null : (
        <Notice tone="error" title="Export impossible.">
          {exportError}
        </Notice>
      )}

      {tierRuns.length === 0 ? (
        <Notice tone="empty" title={`Aucune passe en ${getTier(activeTier).label}.`}>
          {otherTierCount > 0
            ? "Change de palier ci-dessus, ou enregistre une passe depuis la saisie."
            : otherBenchmarkCount > 0
              ? `L'historique ne montre que le barème ${benchmark.name} : ${otherBenchmarkCount} passe${otherBenchmarkCount > 1 ? "s" : ""} d'un autre barème en ${otherBenchmarkCount > 1 ? "sont" : "est"} écartée${otherBenchmarkCount > 1 ? "s" : ""}, ses seuils n'étant pas comparables.`
              : "Passe en Saisie, entre tes scores puis sauvegarde : la passe apparaîtra ici."}
        </Notice>
      ) : (
        <>
          <section className="rounded-xl border border-steel-800 bg-steel-900/60 p-4 sm:p-5">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="text-[11px] font-medium tracking-[0.18em] text-steel-400 uppercase">
                Progression
              </h3>
              <label className="flex items-center gap-2 text-xs text-steel-400">
                <span className="shrink-0">Sous-catégorie</span>
                <select
                  value={subcategory ?? ""}
                  onChange={(event) => setSubcategory(event.target.value || null)}
                  className="min-w-0 rounded-lg border border-steel-700 bg-steel-800 px-2.5 py-1.5 text-xs text-steel-100 transition-colors hover:border-steel-600"
                >
                  <option value="">Aucune</option>
                  {listSubcategories(activeTier).map((sub) => (
                    <option key={sub.name} value={sub.name}>
                      {sub.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {details.error !== null && subcategory !== null ? (
              <p className="mb-3 text-xs text-ember-400">
                Courbe de sous-catégorie indisponible : {details.error}
              </p>
            ) : null}

            <ProgressChart
              tier={activeTier}
              benchmarkId={benchmarkId}
              points={points}
              subcategory={subcategory}
            />
          </section>

          {deleteError !== null ? (
            <Notice tone="error" title="Suppression impossible.">
              {deleteError}
            </Notice>
          ) : null}

          <ul className="flex flex-col gap-2">
            {tierRuns.map((run) => (
              <RunCard
                key={run.id}
                run={run}
                detail={details.byId.get(run.id)}
                previous={
                  focusRunId === run.id && focusPrevious !== null
                    ? details.byId.get(focusPrevious.id)
                    : undefined
                }
                detailError={focusRunId === run.id ? details.error : null}
                expanded={focusRunId === run.id}
                onToggle={() => {
                  setConfirmingId(null);
                  onFocusRun(focusRunId === run.id ? null : run.id);
                }}
                confirming={confirmingId === run.id}
                deleting={deletingId === run.id}
                onAskDelete={() => setConfirmingId(run.id)}
                onCancelDelete={() => setConfirmingId(null)}
                onConfirmDelete={() => void confirmDelete(run.id)}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
