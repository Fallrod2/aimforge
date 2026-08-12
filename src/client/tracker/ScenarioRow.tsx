/**
 * Une ligne de saisie : un scénario, son score, sa jauge, sa prochaine cible,
 * et son record personnel (SPEC V4-A §4.3).
 *
 * La mise en page suit la **largeur de la carte**, pas celle de la fenêtre :
 * depuis que les sous-catégories s'affichent en deux ou trois colonnes sur grand
 * écran (§4.1b), une même largeur de fenêtre correspond à deux largeurs de ligne
 * très différentes. Une requête de conteneur (`@container` sur la carte de
 * sous-catégorie, variantes `@lg:` ici) répond à la seule question qui compte :
 * *cette ligne-ci a-t-elle la place de tenir sur un rang ?* Un `sm:` de fenêtre
 * répondait « oui » et écrasait les colonnes dès qu'on passait à deux colonnes.
 *
 * Le record, lui, n'est jamais une injonction : « PB 820 » sous le champ, et
 * rien de plus tant que le score tapé ne le dépasse pas.
 */

import type { TierId } from "../../lib/energy";
import { EnergyRail } from "../components/EnergyRail";
import { nextTarget } from "../energy-view";
import { formatDelta, formatEnergy, formatScore, scenarioLabel } from "../format";
import { parseScoreInput } from "./draft";

interface ScenarioRowProps {
  readonly tier: TierId;
  readonly tierLabel: string;
  readonly scenario: string;
  readonly value: string;
  readonly energy: number;
  /** Meilleur score personnel sur ce scénario ; `undefined` = jamais joué. */
  readonly personalBest?: number;
  readonly onChange: (raw: string) => void;
}

export function ScenarioRow({
  tier,
  tierLabel,
  scenario,
  value,
  energy,
  personalBest,
  onChange,
}: ScenarioRowProps) {
  const parsed = parseScoreInput(value);
  const invalid = parsed.state === "invalid";
  const target = parsed.state === "ok" ? nextTarget(tier, scenario, parsed.score) : null;
  const inputId = `score-${scenario.replace(/\s+/g, "-").toLowerCase()}`;
  /**
   * Le badge « Record » se décide **à la frappe**, sans requête : les records
   * sont chargés une fois par palier, et la comparaison est une soustraction.
   * Strictement supérieur : égaler son record n'est pas le battre.
   */
  const beatsBest =
    personalBest !== undefined && parsed.state === "ok" && parsed.score > personalBest;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-x-3 gap-y-2 py-2.5 @lg:grid-cols-[minmax(0,9rem)_6rem_minmax(0,1fr)_5.5rem]">
      <label htmlFor={inputId} className="min-w-0 text-sm text-steel-200">
        <span className="block truncate" title={scenario}>
          {scenarioLabel(scenario, tierLabel)}
        </span>
      </label>

      <div className="flex flex-col items-end gap-1">
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
          className={`h-11 w-full rounded-md border bg-steel-800 px-3 text-right font-mono text-base tabular-nums text-steel-100 transition-colors placeholder:text-steel-400 @lg:h-10 @lg:text-sm ${
            invalid
              ? "border-ember-500 text-ember-400"
              : beatsBest
                ? "border-quench-500 text-steel-100"
                : "border-steel-700 hover:border-steel-600 focus:border-ember-500"
          }`}
        />
        {beatsBest ? (
          <span className="rounded-full border border-quench-500/50 bg-quench-500/10 px-1.5 py-px text-[10px] font-semibold tracking-wide text-quench-500 uppercase">
            Record
          </span>
        ) : personalBest === undefined ? null : (
          <span className="font-mono text-[10px] tabular-nums text-steel-500">
            PB {formatScore(personalBest)}
          </span>
        )}
      </div>

      <div className="col-start-1 flex min-w-0 flex-col gap-1.5 @lg:col-start-3">
        <EnergyRail tier={tier} energy={energy} />
        {/* `steel-400` (5,21:1) et non `steel-500` : cette ligne porte « Non
            joué », c'est-à-dire l'état d'un scénario, en 11 px. La mesure de
            production la donnait à ~4:1 — sous AA pour le seul texte qui dise
            qu'il n'y a rien à lire au-dessus. */}
        <p className="truncate text-[11px] text-steel-400">
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

      <p className="self-start text-right font-mono text-sm tabular-nums text-steel-300 @lg:self-center">
        {energy > 0 ? formatEnergy(energy) : <span className="text-steel-500">—</span>}
      </p>
    </div>
  );
}
