/**
 * Le bandeau des trois étapes, montré une fois à un compte sans passe
 * (SPEC V4-A §4.1c). La décision de l'afficher est dans `onboarding.ts` ; ce
 * fichier n'en est que la forme.
 *
 * Sobre et refermable, pas une modale : il ne prend pas le focus, ne couvre
 * rien, et quelqu'un qui sait déjà quoi faire peut taper ses scores sans le
 * lire. Les trois étapes disent ce que l'application ne peut pas deviner — que
 * les scores se jouent dans KovaaK's, et qu'ils viennent ici ensuite.
 *
 * Exporté pour le rendu statique des tests : le tracker entier demande une
 * session, et ce sont ces trois phrases qu'on veut retenir de dériver.
 */

import type { BenchmarkDefinition } from "../../lib/energy";
import { aimTrainerName } from "../format";

interface OnboardingBannerProps {
  /** Le benchmark actif : c'est le sien, et son aim trainer, que les étapes décrivent. */
  readonly benchmark: BenchmarkDefinition;
  readonly onDismiss: () => void;
}

export function OnboardingBanner({ benchmark, onDismiss }: OnboardingBannerProps) {
  const benchmarkName = benchmark.name;
  const trainerName = aimTrainerName(benchmark.aimTrainer);
  const steps: readonly { readonly title: string; readonly detail: string }[] = [
    {
      title: "Choisis ton palier",
      detail: `Le sélecteur de palier décide des scénarios et des seuils. Dans le doute, commence par le premier : le barème ${benchmarkName} est fait pour être monté palier par palier.`,
    },
    {
      title: `Joue les scénarios sur ${trainerName}`,
      detail: `Les scores se font dans ${trainerName}, pas ici. Tu peux aussi lier ton compte : la saisie ira chercher toute seule les scénarios déjà joués.`,
    },
    {
      title: "Saisis ou importe tes scores",
      detail:
        "Tape les scores dans la grille, ou laisse l'import les remplir puis vérifie. Rien n'est enregistré tant que tu n'as pas sauvegardé.",
    },
  ];

  return (
    <section
      aria-label="Premiers pas"
      className="rounded-xl border border-steel-800 bg-steel-900/60 p-4 sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-steel-100">Première passe : trois étapes</h2>
          <p className="mt-0.5 text-xs text-steel-500">
            Le tracker relit tes scores {benchmarkName} et en tire ton énergie et ton rang.
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded-md border border-steel-700 px-2 py-1 text-[11px] font-medium text-steel-400 transition-colors hover:border-steel-600 hover:text-steel-100"
        >
          J'ai compris
        </button>
      </div>

      <ol className="mt-4 grid gap-3 sm:grid-cols-3">
        {steps.map((step, index) => (
          <li key={step.title} className="rounded-lg bg-steel-950/60 px-3 py-2.5">
            <p className="flex items-baseline gap-2 text-xs font-medium text-steel-200">
              <span className="font-mono text-ember-500">{index + 1}</span>
              {step.title}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-steel-500">{step.detail}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
