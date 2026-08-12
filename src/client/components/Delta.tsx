/**
 * L'écart d'une passe avec la précédente : une flèche, un chiffre, une couleur
 * (SPEC V4-A §4.4).
 *
 * Le calcul est ailleurs (`run-delta.ts`) : ce composant n'affiche que ce qu'on
 * lui donne, et il n'affiche **rien** quand on ne lui donne rien — le cas
 * « première passe », où il n'y a pas de comparaison à faire.
 *
 * Les couleurs restent dans la palette du thème, sans y ajouter de vert ni de
 * rouge : `quench` pour une progression (le bleu déjà utilisé en seconde série
 * de courbe), `ember` pour une régression (la teinte que l'application emploie
 * partout pour ce qui demande l'attention), acier pour un écart nul. Les rangs
 * gardent leurs couleurs officielles pour eux seuls.
 *
 * La flèche est décorative : c'est le libellé lu par les lecteurs d'écran qui
 * porte le sens (« en hausse de… »), pas le glyphe.
 */

import { formatEnergyDelta } from "../format";
import type { Delta } from "../run-delta";

interface DeltaBadgeProps {
  /** L'écart à montrer ; `null` = rien à comparer, donc rien à afficher. */
  readonly delta: Delta | null;
  /** Ce que l'écart compare, pour le lecteur d'écran (« l'overall »). */
  readonly label?: string;
  readonly size?: "sm" | "md";
}

const ARROWS: Readonly<Record<Delta["direction"], string>> = {
  up: "▲",
  down: "▼",
  flat: "=",
};

const TONES: Readonly<Record<Delta["direction"], string>> = {
  up: "text-quench-500",
  down: "text-ember-400",
  flat: "text-steel-500",
};

const SPOKEN: Readonly<Record<Delta["direction"], string>> = {
  up: "en hausse de",
  down: "en baisse de",
  flat: "stable, écart de",
};

export function DeltaBadge({ delta, label, size = "md" }: DeltaBadgeProps) {
  if (delta === null) return null;

  return (
    <span
      className={`inline-flex items-baseline gap-1 font-mono tabular-nums ${TONES[delta.direction]} ${
        size === "sm" ? "text-[10px]" : "text-xs"
      }`}
    >
      <span aria-hidden="true">{ARROWS[delta.direction]}</span>
      <span aria-hidden="true">{formatEnergyDelta(delta.value)}</span>
      <span className="sr-only">
        {label === undefined ? "" : `${label} `}
        {SPOKEN[delta.direction]} {formatEnergyDelta(Math.abs(delta.value))} par rapport à la passe
        précédente
      </span>
    </span>
  );
}
