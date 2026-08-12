/**
 * Le benchmark actif : ce qui doit tenir, c'est l'alignement.
 *
 * Le provider publie un identifiant dans un contexte React **et** aligne le
 * pointeur de `src/lib/energy`, dont dépendent tous les accès non qualifiés
 * (saisie du tracker, aperçu live, rails d'énergie). Les deux peuvent diverger
 * sans que rien ne casse à la compilation, et la divergence ne se verrait qu'en
 * production, sur une passe calculée avec les seuils d'un autre benchmark : d'où
 * ces tests.
 *
 * Aucun DOM ici (`environment: node`) : `renderToStaticMarkup` rend le premier
 * passage, sans effet. C'est exactement ce qu'on veut vérifier — l'état sur
 * lequel l'application s'ouvre, avant que la base ait répondu.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import {
  type BenchmarkId,
  currentBenchmark,
  DEFAULT_BENCHMARK_ID,
  syncCurrentBenchmark,
} from "../../lib/energy";
import { registerBenchmark } from "../../lib/energy/benchmarks";
import { benchmarkLike } from "../../lib/energy/fixtures";
import { ActiveBenchmarkProvider, adoptBenchmark, useActiveBenchmark } from "./active-benchmark";

const FAKE = "fake-s6" as BenchmarkId;

/** Remises en état : le benchmark courant est un état de module. */
const restores: (() => void)[] = [];

function withFakeBenchmark(): void {
  restores.push(registerBenchmark(benchmarkLike(DEFAULT_BENCHMARK_ID, FAKE, { name: "Fake S6" })));
}

afterEach(() => {
  syncCurrentBenchmark(DEFAULT_BENCHMARK_ID);
  while (restores.length > 0) restores.pop()?.();
});

/** Un consommateur minimal : il n'affiche que ce que le hook lui donne. */
function Probe() {
  const { benchmarkId, benchmark, saving, error } = useActiveBenchmark();

  return (
    <p>
      {benchmarkId} · {benchmark.name} · {saving ? "saving" : "idle"} · {error ?? "no-error"}
    </p>
  );
}

describe("adoptBenchmark", () => {
  it("aligne le benchmark courant de la lib", () => {
    withFakeBenchmark();
    expect(currentBenchmark()).toBe(DEFAULT_BENCHMARK_ID);

    expect(adoptBenchmark(FAKE)).toBe(FAKE);
    expect(currentBenchmark()).toBe(FAKE);
  });

  it("refuse un benchmark absent du registre plutôt que de le laisser passer", () => {
    expect(() => adoptBenchmark("jamais-publie" as BenchmarkId)).toThrow();
    expect(currentBenchmark()).toBe(DEFAULT_BENCHMARK_ID);
  });
});

describe("useActiveBenchmark", () => {
  it("ouvre sur le benchmark par défaut, sans écriture ni erreur", () => {
    const markup = renderToStaticMarkup(
      <ActiveBenchmarkProvider>
        <Probe />
      </ActiveBenchmarkProvider>,
    );

    expect(markup).toContain(DEFAULT_BENCHMARK_ID);
    expect(markup).toContain("Voltaic S5");
    expect(markup).toContain("idle");
    expect(markup).toContain("no-error");
  });

  it("rend le benchmark par défaut hors provider, sans lever", () => {
    // Un composant monté hors du provider (un test de rendu, un écran isolé) se
    // comporte comme un utilisateur qui n'a rien changé, plutôt que d'exploser.
    expect(renderToStaticMarkup(<Probe />)).toContain(DEFAULT_BENCHMARK_ID);
  });

  it("expose la définition du benchmark courant, pas seulement son identifiant", () => {
    // C'est elle qui porte le nom, le statut et la date de version affichés par
    // le tracker et par le sélecteur : sans elle, chaque écran redirait
    // « Voltaic S5 » en dur, ce que ce chantier vient justement défaire.
    withFakeBenchmark();
    syncCurrentBenchmark(FAKE);

    const markup = renderToStaticMarkup(
      <ActiveBenchmarkProvider>
        <Probe />
      </ActiveBenchmarkProvider>,
    );

    // Le provider ouvre sur le défaut : le pointeur de la lib ne le décide pas,
    // c'est le profil qui le décide (et l'effet de chargement ne tourne pas ici).
    expect(markup).toContain("Voltaic S5");
  });
});
