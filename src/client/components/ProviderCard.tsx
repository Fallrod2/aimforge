/**
 * Le choix d'un fournisseur d'IA, sous forme de carte.
 *
 * Partagé par les réglages personnels (SPEC §5 ter) et par la configuration de
 * la plateforme (SPEC §5 quater) : c'est le même choix, avec les mêmes
 * conséquences, et notamment le même avertissement « Expérimental » — qui doit
 * s'afficher **avant** le clic, pas après le premier échec.
 */

import { type ProviderId, providerSpec } from "../../shared/ai-settings-contract";

interface ProviderCardProps {
  readonly id: ProviderId;
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly onSelect: () => void;
}

export function ProviderCard({ id, selected, disabled, onSelect }: ProviderCardProps) {
  const spec = providerSpec(id);

  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
      className={`flex min-h-16 flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed ${
        selected
          ? "border-ember-500 bg-ember-500/10"
          : "border-steel-700 bg-steel-900 hover:border-steel-600"
      }`}
    >
      <span className="flex flex-wrap items-center gap-1.5">
        <span className={`text-sm font-semibold ${selected ? "text-ember-300" : "text-steel-200"}`}>
          {spec.label}
        </span>
        {spec.experimental !== undefined ? (
          <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-amber-300 uppercase">
            Expérimental
          </span>
        ) : null}
      </span>
      <span className="text-[11px] text-steel-500">{spec.hint}</span>
    </button>
  );
}
