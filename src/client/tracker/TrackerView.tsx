/**
 * Vue Tracker : saisie des 18 scénarios d'un palier, calcul live, sauvegarde.
 *
 * Le calcul live appelle `computeBenchRun`, la **même** fonction que la route
 * POST : l'aperçu ne peut pas diverger de ce qui sera enregistré, et rien ne
 * part au serveur tant que l'utilisateur n'a pas sauvegardé.
 */

import { useCallback, useMemo, useState } from "react";
import { getTier, listScenarios, TIER_IDS, type TierId } from "../../lib/energy";
import { computeBenchRun } from "../../server/api/compute";
import { type BenchRunSummary, createBenchRun } from "../api";
import { RankBadge } from "../components/RankBadge";
import { Segmented } from "../components/Segmented";
import { rankColorFor } from "../energy-view";
import { formatEnergy } from "../format";
import { type BenchDraft, clearTier, draftScores, emptyDraft, setScoreInput } from "./draft";
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
      const run = await createBenchRun({ tier, scores });

      setSaved(run);
      onSaved(run);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "L'enregistrement a échoué.");
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setSaved(null);
    setError(null);
    setDraft((current) => clearTier(current, tier));
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
        {tierData.categories.map((category) => (
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
                  computed.subcategories.find((sub) => sub.name === subcategory.name)?.energy ?? 0;

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
                            computed.scores.find((row) => row.scenario === scenario.name)?.energy ??
                            0
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
          accessibles en bas d'écran plutôt qu'en haut de page. */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-steel-800 bg-steel-950/95 px-4 py-3 backdrop-blur lg:hidden">
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
