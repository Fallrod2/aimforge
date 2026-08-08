/**
 * Page d'un module pas encore livré.
 *
 * Elle dit ce que le module fera et à quelle phase il arrive, plutôt que
 * d'afficher un formulaire mort : un onglet qui existe déjà dans la navigation
 * doit expliquer son absence, sinon il passe pour cassé.
 */

interface ComingSoonProps {
  readonly title: string;
  readonly phase: string;
  readonly summary: string;
  readonly points: readonly string[];
}

export function ComingSoon({ title, phase, summary, points }: ComingSoonProps) {
  return (
    <section className="flex flex-col gap-5">
      <div>
        <p className="text-[11px] font-medium tracking-[0.18em] text-ember-500 uppercase">
          Bientôt · {phase}
        </p>
        <h2 className="mt-1.5 text-lg font-semibold text-steel-100">{title}</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-steel-400">{summary}</p>
      </div>

      <ul className="flex max-w-2xl flex-col gap-2">
        {points.map((point) => (
          <li
            key={point}
            className="rounded-xl border border-dashed border-steel-800 bg-steel-900/40 px-4 py-3 text-sm text-steel-400"
          >
            {point}
          </li>
        ))}
      </ul>
    </section>
  );
}
