/**
 * Sélecteur à segments (palier, filtre). Braise sur le segment actif.
 *
 * Les segments font **44 px de haut** (V5-A §5.5a), et pas seulement sur
 * téléphone : ils en faisaient 32, c'est-à-dire sous le plancher tactile, pour
 * ce qui est le contrôle le plus utilisé de l'application — on change de palier
 * bien plus souvent qu'on ne sauvegarde. Rendre la cible conforme au doigt
 * seulement en dessous de `sm` aurait demandé de garder deux hauteurs pour un
 * même composant ; à 44 px partout, il n'y a qu'une règle à retenir, et le
 * bandeau ne prend qu'une douzaine de pixels de plus au-dessus des grilles.
 */

interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

interface SegmentedProps<T extends string> {
  readonly label: string;
  readonly options: readonly SegmentedOption<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
}

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: SegmentedProps<T>) {
  return (
    <fieldset
      aria-label={label}
      className="grid grid-flow-col gap-1 rounded-lg border border-steel-700 bg-steel-900 p-1"
    >
      {options.map((option) => {
        const active = option.value === value;

        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`inline-flex min-h-11 items-center justify-center rounded-md px-3 py-2 text-xs font-semibold tracking-wide uppercase transition-colors ${
              active
                ? "bg-ember-500/15 text-ember-400 shadow-[inset_0_0_0_1px_var(--color-ember-500)]"
                : "text-steel-400 hover:bg-steel-800 hover:text-steel-200"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </fieldset>
  );
}
