/**
 * Le squelette affiché pendant une génération IA (V4-C §4.9).
 *
 * Toute la décision est dans `./progress.ts` — y compris celle de ne pas faire
 * de streaming, et pourquoi. Ce fichier ne fait que la mettre à l'écran, plus
 * l'horloge qui manque à un module pur.
 *
 * Le rendu est volontairement pauvre : trois lignes d'étapes, une pastille, et
 * un temps écoulé qui n'apparaît qu'au-delà du délai normal. Pas de barre de
 * progression — une barre suppose qu'on connaît la fin, ce qui est faux.
 */

import { useEffect, useState } from "react";
import {
  elapsedLabel,
  type ProgressStep,
  progressSteps,
  type RenderedStep,
  type StepState,
} from "./progress";

/**
 * Le temps écoulé depuis `startedAt`, rafraîchi chaque seconde.
 *
 * La seconde est la bonne granularité : c'est ce qu'on affiche, et un
 * rafraîchissement plus fin ne ferait que réveiller React pour rien. Le premier
 * calcul est immédiat — au retour sur l'onglet, l'attente a déjà de l'âge et
 * l'écran ne doit pas repartir de zéro.
 */
function useElapsed(startedAt: number): number {
  const [elapsed, setElapsed] = useState(() => Date.now() - startedAt);

  useEffect(() => {
    setElapsed(Date.now() - startedAt);

    const timer = setInterval(() => setElapsed(Date.now() - startedAt), 1_000);

    return () => clearInterval(timer);
  }, [startedAt]);

  return elapsed;
}

interface GenerationProgressProps {
  readonly title: string;
  readonly steps: readonly ProgressStep[];
  /** L'ordre de grandeur annoncé une fois l'attente devenue sensible. */
  readonly expectation: string;
  /** L'instant du départ, tel que le magasin de génération l'a retenu. */
  readonly startedAt: number;
}

export function GenerationProgress({
  title,
  steps,
  expectation,
  startedAt,
}: GenerationProgressProps) {
  const elapsed = useElapsed(startedAt);
  const rendered = progressSteps(steps, elapsed);
  const waited = elapsedLabel(elapsed, expectation);

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-xl border border-steel-800 bg-steel-900/60 p-4 sm:p-5"
    >
      <p className="text-sm font-medium text-steel-300">{title}</p>

      <ol className="mt-3 flex flex-col gap-2">
        {rendered.map((step) => (
          <Step key={step.label} step={step} />
        ))}
      </ol>

      {waited === null ? null : (
        <p className="mt-3 font-mono text-[11px] tabular-nums text-steel-500">{waited}</p>
      )}
    </div>
  );
}

const LABEL_CLASSES: Readonly<Record<StepState, string>> = {
  done: "text-steel-500",
  active: "text-steel-200",
  pending: "text-steel-600",
};

function Step({ step }: { readonly step: RenderedStep }) {
  return (
    <li className={`flex items-center gap-2.5 text-xs ${LABEL_CLASSES[step.state]}`}>
      <Bullet state={step.state} />
      {step.label}
    </li>
  );
}

/**
 * La pastille d'une étape. L'étape active tourne, les autres sont muettes —
 * c'est le seul mouvement de l'écran, et il désigne ce qui se passe vraiment.
 */
function Bullet({ state }: { readonly state: StepState }) {
  if (state === "active") {
    return (
      <span
        aria-hidden="true"
        className="inline-block size-3 shrink-0 animate-spin rounded-full border-2 border-steel-700 border-t-ember-500"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`inline-block size-3 shrink-0 rounded-full border-2 ${
        state === "done" ? "border-steel-600 bg-steel-600" : "border-steel-800"
      }`}
    />
  );
}
