/**
 * Le statut des barèmes, tel qu'il s'affiche.
 *
 * Ce qui est vérifié ici tient en une phrase : plus aucun écran de l'application
 * ne dit « seuils officiels » sans dire **lesquels**. Le rendu est statique
 * (`renderToStaticMarkup`, aucun DOM) — c'est le premier passage, celui que
 * l'utilisateur voit.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_BENCHMARK_ID, getBenchmark } from "../../lib/energy";
import { benchmarkLike } from "../../lib/energy/fixtures";
import { BenchmarkNote, BenchmarkStatusBadge } from "./BenchmarkNote";

/** Le texte visible du rendu : les assertions parlent de ce qu'on lit. */
function textOf(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

const VOLTAIC = getBenchmark(DEFAULT_BENCHMARK_ID);

describe("BenchmarkNote", () => {
  it("nomme le barème, son état et la date de ses seuils", () => {
    const text = textOf(renderToStaticMarkup(<BenchmarkNote benchmark={VOLTAIC} />));

    expect(text).toContain("Barème Voltaic S5");
    expect(text).toContain("Beta");
    expect(text).toContain("version du 8 août 2026");
  });

  it("date les seuils en UTC : un jour civil ne doit pas reculer selon le fuseau", () => {
    // `dataVersion` est un jour sans heure, lu à minuit UTC. Rendu dans le fuseau
    // du navigateur, il afficherait la veille à l'ouest de Greenwich — un barème
    // daté d'un jour de moins que ce que dit sa source.
    expect(VOLTAIC.dataVersion).toBe("2026-08-08");
    expect(textOf(renderToStaticMarkup(<BenchmarkNote benchmark={VOLTAIC} />))).toContain(
      "8 août 2026",
    );
  });

  it("n'affiche le lien source que là où on le demande", () => {
    const without = renderToStaticMarkup(<BenchmarkNote benchmark={VOLTAIC} />);
    const with_ = renderToStaticMarkup(<BenchmarkNote benchmark={VOLTAIC} withSource />);

    expect(without).not.toContain(VOLTAIC.sourceUrl);
    expect(with_).toContain(VOLTAIC.sourceUrl);
    expect(textOf(with_)).toContain("source Voltaic");
  });
});

describe("BenchmarkStatusBadge", () => {
  it("ne badge pas un barème stable : un badge sur tous ne distingue rien", () => {
    const stable = benchmarkLike(DEFAULT_BENCHMARK_ID, DEFAULT_BENCHMARK_ID, { status: "stable" });

    expect(renderToStaticMarkup(<BenchmarkStatusBadge benchmark={stable} />)).toBe("");
  });

  it("signale une beta, parce que l'éditeur la publie ainsi", () => {
    expect(textOf(renderToStaticMarkup(<BenchmarkStatusBadge benchmark={VOLTAIC} />))).toBe("Beta");
  });
});
