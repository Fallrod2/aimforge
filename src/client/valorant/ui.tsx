/**
 * Les pièces communes de la vue Valorant : la carte de section et la phrase
 * d'absence.
 *
 * Elles sont ici plutôt que recopiées dans chaque écran parce qu'elles disent
 * toutes les deux la même chose partout — « voici un bloc », « il n'y a rien à
 * montrer, voilà pourquoi ». Deux rédactions séparées finiraient par ne plus
 * se ressembler d'une section à l'autre.
 */

import type { ReactNode } from "react";

interface SectionProps {
  readonly title: string;
  /** Précision sous le titre : ce que la section couvre exactement. */
  readonly caption?: string;
  /** Contrôle aligné à droite du titre (le sélecteur de période). */
  readonly control?: ReactNode;
  readonly children: ReactNode;
}

export function Section({ title, caption, control, children }: SectionProps) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-steel-800 bg-steel-900/60 p-4 sm:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-[11px] font-medium tracking-[0.18em] text-steel-400 uppercase">
            {title}
          </h2>
          {caption === undefined ? null : (
            <p className="mt-1 text-[11px] text-steel-500">{caption}</p>
          )}
        </div>
        {control}
      </div>
      {children}
    </section>
  );
}

/** Une absence expliquée. Jamais un cadre vide, jamais un zéro à la place. */
export function Empty({ children }: { readonly children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-steel-800 bg-steel-950/40 p-3 text-xs leading-relaxed text-steel-500">
      {children}
    </p>
  );
}

/** Un bloc gris en attendant la donnée. Muet : il n'annonce rien qu'il ignore. */
export function Skeleton({ lines = 3 }: { readonly lines?: number }) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-2">
      {Array.from({ length: lines }, (_, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: barres décoratives, jamais réordonnées
          key={index}
          className="h-4 rounded bg-steel-800/50"
          style={{ width: `${100 - index * 12}%` }}
        />
      ))}
    </div>
  );
}
