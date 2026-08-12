/**
 * Le squelette, tel qu'il s'affiche vraiment.
 *
 * `progress.ts` prouve la règle ; ce test prouve qu'elle arrive à l'écran — et
 * surtout qu'une attente déjà longue n'est pas repartie de zéro parce que la
 * vue vient d'être remontée. C'est exactement ce qui arrive au retour de Perfs.
 *
 * Aucun DOM (`environment: node`) : `renderToStaticMarkup` rend le premier
 * passage, sans effet ni minuteur.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GenerationProgress } from "./GenerationProgress";
import { ELAPSED_AFTER_MS, ROUTINE_EXPECTATION, ROUTINE_STEPS } from "./progress";

/** Le squelette d'une routine commencée il y a `agoMs`. */
function markup(agoMs: number): string {
  return renderToStaticMarkup(
    <GenerationProgress
      title="La séance se construit…"
      steps={ROUTINE_STEPS}
      expectation={ROUTINE_EXPECTATION}
      startedAt={Date.now() - agoMs}
    />,
  );
}

describe("GenerationProgress", () => {
  it("affiche toutes les étapes, pas seulement celle en cours", () => {
    const html = markup(0);

    for (const step of ROUTINE_STEPS) {
      expect(html).toContain(step.label);
    }
  });

  it("se tait sur le temps écoulé tant que l'attente est normale", () => {
    expect(markup(0)).not.toContain("écoulées");
  });

  it("annonce le temps écoulé et l'ordre de grandeur au-delà du seuil", () => {
    const html = markup(ELAPSED_AFTER_MS + 4_000);

    expect(html).toContain("s écoulées");
    expect(html).toContain(ROUTINE_EXPECTATION);
  });

  it("reprend l'attente à son âge réel, sans repartir de zéro au remontage", () => {
    // Vingt secondes après le départ, la dernière étape est active : revenir de
    // Perfs ne doit pas réafficher « Lecture de ton bench… ».
    const html = markup(20_000);
    const last = ROUTINE_STEPS.at(-1)?.label ?? "";

    expect(html).toContain(last);
    expect(html).toContain("20 s écoulées");
  });
});
