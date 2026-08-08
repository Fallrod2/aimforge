/** Une ligne de saisie : un scénario, son score, sa jauge, sa prochaine cible. */

import type { TierId } from "../../lib/energy";
import { EnergyRail } from "../components/EnergyRail";
import { nextTarget } from "../energy-view";
import { formatDelta, formatEnergy, scenarioLabel } from "../format";
import { parseScoreInput } from "./draft";

interface ScenarioRowProps {
  readonly tier: TierId;
  readonly tierLabel: string;
  readonly scenario: string;
  readonly value: string;
  readonly energy: number;
  readonly onChange: (raw: string) => void;
}

export function ScenarioRow({
  tier,
  tierLabel,
  scenario,
  value,
  energy,
  onChange,
}: ScenarioRowProps) {
  const parsed = parseScoreInput(value);
  const invalid = parsed.state === "invalid";
  const target = parsed.state === "ok" ? nextTarget(tier, scenario, parsed.score) : null;
  const inputId = `score-${scenario.replace(/\s+/g, "-").toLowerCase()}`;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-x-3 gap-y-2 py-2.5 sm:grid-cols-[minmax(0,9rem)_6rem_minmax(0,1fr)_5.5rem]">
      <label htmlFor={inputId} className="min-w-0 text-sm text-steel-200">
        <span className="block truncate" title={scenario}>
          {scenarioLabel(scenario, tierLabel)}
        </span>
      </label>

      <input
        id={inputId}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder="—"
        aria-label={`Score ${scenario}`}
        aria-invalid={invalid}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`h-11 w-full rounded-md border bg-steel-800 px-3 text-right font-mono text-base tabular-nums text-steel-100 transition-colors placeholder:text-steel-600 sm:h-10 sm:text-sm ${
          invalid
            ? "border-ember-500 text-ember-400"
            : "border-steel-700 hover:border-steel-600 focus:border-ember-500"
        }`}
      />

      <div className="col-start-1 flex min-w-0 flex-col gap-1.5 sm:col-start-3">
        <EnergyRail tier={tier} energy={energy} />
        <p className="truncate text-[11px] text-steel-500">
          {invalid ? (
            <span className="text-ember-400">Score attendu : un nombre positif</span>
          ) : target ? (
            <>
              {formatDelta(target.missing)} → {target.label}
            </>
          ) : parsed.state === "ok" ? (
            "Plafond du palier atteint"
          ) : (
            "Non joué"
          )}
        </p>
      </div>

      <p className="self-start text-right font-mono text-sm tabular-nums text-steel-300 sm:self-center">
        {energy > 0 ? formatEnergy(energy) : <span className="text-steel-600">—</span>}
      </p>
    </div>
  );
}
