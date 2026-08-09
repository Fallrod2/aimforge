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
 */

import { useCallback, useMemo, useState } from "react";
import { computeBenchRun, getTier, listScenarios, TIER_IDS, type TierId } from "../../lib/energy";
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
import { formatEnergy } from "../format";
import { LinkInvite } from "../linked/LinkInvite";
import { useLinkedAccounts } from "../linked/useLinkedAccounts";
import { type BenchDraft, clearTier, draftScores, emptyDraft, setScoreInput } from "./draft";
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
import { ScenarioRow } from "./ScenarioRow";
import { SummaryPanel } from "./SummaryPanel";

interface TrackerViewProps {
  /** Ouvre l'historique sur la passe qui vient d'être enregistrée. */
  readonly onSaved: (run: BenchRunSummary) => void;
}

const tierOptions = TIER_IDS.map((id) => ({ value: id, label: getTier(id).label }));

export function TrackerView({ onSaved }: TrackerViewProps) {
  const [tier, setTier] = useState<TierId>("novice");
  const [draft, setDraft] = useState<BenchDraft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<BenchRunSummary | null>(null);

  const linked = useLinkedAccounts();
  const kovaaks =
    linked.state.status === "ready" ? primaryAccount(linked.state.accounts, "kovaaks") : null;
  /**
   * L'état d'import, par palier — comme la saisie. Un état unique survivrait au
   * changement de palier et annoncerait un import au-dessus d'une grille vide.
   */
  const [imports, setImports] = useState<ImportStates>(NO_IMPORTS);
  /** La grille manuelle a-t-elle été ouverte à la main ? */
  const [manualOpen, setManualOpen] = useState(false);

  const importState = importStateFor(imports, tier);
  const importedTier = isImportedTier(imports, tier);
  // Sans compte lié, il n'y a rien à replier : la grille est le seul chemin.
  const showGrid = kovaaks === null || manualOpen;

  const { scores, invalid } = useMemo(() => draftScores(draft, tier), [draft, tier]);
  const computed = useMemo(() => computeBenchRun(tier, scores), [tier, scores]);
  const scenarios = useMemo(() => listScenarios(tier), [tier]);
  const tierData = getTier(tier);

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
      const run = await saveBenchRun({ tier, scores, source: importedTier ? "kovaaks" : "manual" });

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
   */
  async function runImport(account: LinkedAccount, target: TierId) {
    setImports((current) => withImportState(current, target, LOADING));
    setSaved(null);
    setError(null);
    try {
      const result = await importKovaaksScores(account.externalId, target);

      setDraft((current) => applyImportedScores(current, target, result.scores));
      setImports((current) => withImportState(current, target, importSucceeded(result)));
      setManualOpen(true);
    } catch (cause) {
      const failure = importFailed(cause instanceof Error ? cause.message : "L'import a échoué.");

      setImports((current) => withImportState(current, target, failure));
    }
  }

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
          <Segmented label="Palier" options={tierOptions} value={tier} onChange={setTier} />
        </div>

        <SummaryPanel tier={tier} computed={computed} scenarioCount={scenarios.length} />

        <div className="hidden flex-col gap-3 lg:flex">
          <SaveActions
            canSave={canSave}
            saving={saving}
            hasDraft={Object.keys(draft[tier]).length > 0}
            onSave={save}
            onReset={reset}
          />
          <Feedback error={error} invalid={invalid} saved={saved} />
        </div>
      </aside>

      <div className="flex flex-col gap-8 lg:order-1">
        <ImportPanel
          account={kovaaks}
          loading={linked.state.status === "loading"}
          state={importState}
          scenarioCount={scenarios.length}
          tierLabel={tierData.label}
          imported={importedTier}
          manualOpen={manualOpen}
          onImport={() => {
            if (kovaaks !== null) void runImport(kovaaks, tier);
          }}
          onToggleManual={() => setManualOpen((open) => !open)}
        />

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

                <div className="flex flex-col gap-3">
                  {category.subcategories.map((subcategory) => {
                    const energy =
                      computed.subcategories.find((sub) => sub.name === subcategory.name)?.energy ??
                      0;

                    return (
                      <div
                        key={subcategory.name}
                        className="rounded-xl border border-steel-800 bg-steel-900/60 px-4 py-3"
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
                              value={draft[tier][scenario.name] ?? ""}
                              energy={
                                computed.scores.find((row) => row.scenario === scenario.name)
                                  ?.energy ?? 0
                              }
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
          (`BOTTOM_BAR_HEIGHT` dans `AppLayout`) : les deux s'empilent. */}
      <div className="fixed inset-x-0 bottom-16 z-10 border-t border-steel-800 bg-steel-950/95 px-4 py-3 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-xl leading-none font-semibold tabular-nums">
              {computed.overall > 0 ? formatEnergy(computed.overall) : "—"}
            </p>
            <p className="mt-1 truncate text-[11px] text-steel-500">
              {computed.scores.length}/{scenarios.length} scénarios
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

interface ImportPanelProps {
  /** Le compte KovaaK's lié, ou `null` s'il n'y en a pas. */
  readonly account: LinkedAccount | null;
  /** Les comptes liés ne sont pas encore connus : ne rien affirmer. */
  readonly loading: boolean;
  readonly state: ImportState;
  readonly scenarioCount: number;
  readonly tierLabel: string;
  /** La saisie courante du palier vient d'un import. */
  readonly imported: boolean;
  readonly manualOpen: boolean;
  readonly onImport: () => void;
  readonly onToggleManual: () => void;
}

/**
 * L'en-tête du tracker : l'import quand il est possible, l'invitation à lier
 * quand il ne l'est pas.
 *
 * Tant que les comptes liés ne sont pas chargés, on n'affiche ni l'un ni
 * l'autre : proposer de lier un compte à quelqu'un qui en a déjà un, même une
 * demi-seconde, c'est lui dire qu'on ne l'a pas reconnu.
 */
function ImportPanel({
  account,
  loading,
  state,
  scenarioCount,
  tierLabel,
  imported,
  manualOpen,
  onImport,
  onToggleManual,
}: ImportPanelProps) {
  if (loading) return null;

  if (account === null) {
    return (
      <LinkInvite title="Tes scores peuvent se remplir tout seuls">
        Lie ton pseudo KovaaK's une fois : le tracker ira chercher tes scores du benchmark Voltaic
        et remplira les {scenarioCount} champs pour toi. D'ici là, la saisie à la main ci-dessous
        fait le travail.
      </LinkInvite>
    );
  }

  const report = importReport(state, scenarioCount);
  const busy = state.status === "loading";

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-steel-800 bg-steel-900/60 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={onImport}
          className="rounded-lg bg-ember-500 px-4 py-2.5 text-sm font-semibold text-steel-950 transition-colors hover:bg-ember-400 disabled:cursor-not-allowed disabled:bg-steel-800 disabled:text-steel-500"
        >
          {busy ? "Import en cours…" : "Importer mes scores KovaaK's"}
        </button>
        {imported ? <SourceBadge /> : null}
        {/* Sur téléphone, le bouton occupe déjà la largeur : la provenance passe
            à la ligne plutôt que d'être tronquée à trois lettres. */}
        <p className="min-w-0 basis-full truncate text-[11px] text-steel-500 sm:flex-1 sm:basis-auto">
          {account.externalId} · palier {tierLabel}
        </p>
      </div>

      {state.status === "error" ? (
        <p aria-live="polite" className="text-xs text-ember-400">
          {state.message}
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
