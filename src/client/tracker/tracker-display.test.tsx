/**
 * Ce que le tracker **dit** de l'énergie partielle et des premiers pas
 * (SPEC V4-A §4.1a et §4.1c).
 *
 * Les deux règles vérifiées ici sont des règles de langage, et rien d'autre
 * qu'un test de texte ne les retient de dériver :
 *
 * 1. une énergie partielle est **toujours étiquetée** partielle, accompagnée du
 *    compte de sous-catégories, et **jamais assortie d'un rang** — c'est la
 *    contrepartie de l'affichage d'un chiffre sur un bench incomplet ;
 * 2. le bandeau d'accueil nomme les trois étapes, dont celle qui se passe
 *    ailleurs : les scores se jouent dans l'aim trainer, pas dans AimForge.
 *
 * Les composants sont rendus seuls, en `renderToStaticMarkup` : la vue entière
 * demande une session Supabase.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  computeBenchRun,
  currentBenchmark,
  getBenchmark,
  getTier,
  listScenarios,
} from "../../lib/energy";
import { OnboardingBanner } from "./OnboardingBanner";
import { SummaryPanel } from "./SummaryPanel";

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

const TIER = "novice";

/** Les scores qui atteignent pile le seuil `rankName` sur les 18 scénarios. */
function atRank(rankName: string): Record<string, number> {
  const index = getTier(TIER).anchorLabels.indexOf(rankName);
  const scores: Record<string, number> = {};

  for (const scenario of listScenarios(TIER)) {
    scores[scenario.name] = scenario.thresholds[index] ?? 0;
  }
  return scores;
}

function summary(scores: Record<string, number>): string {
  return textOf(
    renderToStaticMarkup(
      <SummaryPanel
        benchmarkId={currentBenchmark()}
        tier={TIER}
        computed={computeBenchRun(TIER, scores)}
        scenarioCount={listScenarios(TIER).length}
        onTierChange={() => {}}
      />,
    ),
  );
}

describe("énergie partielle dans la synthèse", () => {
  /** Une seule sous-catégorie complète : Pasu et Popcorn sont la première. */
  const oneSubcategory = { "VT Pasu Novice": 807 };

  it("affiche une progression au lieu d'un tiret dès la première sous-catégorie", () => {
    const text = summary(oneSubcategory);

    expect(text).toContain("Énergie partielle");
    // 807 sur Pasu Novice = 412,96 (fixture officielle du kickoff).
    expect(text).toContain("412,96");
    expect(text).toContain("1/9 sous-catégories");
  });

  it("n'en tire aucun rang", () => {
    const text = summary(oneSubcategory);

    expect(text).toContain("Partiel");
    // Ni rang atteint, ni « sans rang » : le partiel remplace le badge.
    expect(text).not.toContain("Silver");
    expect(text).not.toContain("Gold");
  });

  it("dit qu'elle n'est pas enregistrée et rappelle que l'overall reste à 0", () => {
    const text = summary(oneSubcategory);

    expect(text).toContain("n'est pas enregistrée");
    expect(text).toContain("L'overall reste à 0");
  });

  it("ne montre rien tant qu'aucune sous-catégorie n'est complète", () => {
    // Aucun score : pas de sous-catégorie, donc pas de partiel.
    expect(summary({})).not.toContain("Énergie partielle");
    expect(summary({})).toContain("Énergie overall");
  });

  it("rend la main à l'overall et au rang dès que le bench est complet", () => {
    const text = summary(atRank("Silver"));

    expect(text).toContain("Énergie overall");
    expect(text).not.toContain("Partiel");
    // 18 scénarios au seuil Silver : rang Silver, et badge « Complete ».
    expect(text).toContain("Silver");
  });
});

describe("bandeau des premiers pas", () => {
  const benchmark = getBenchmark(currentBenchmark());

  it("nomme les trois étapes, dont celle qui se joue ailleurs", () => {
    const text = textOf(
      renderToStaticMarkup(<OnboardingBanner benchmark={benchmark} onDismiss={() => {}} />),
    );

    expect(text).toContain("Choisis ton palier");
    expect(text).toContain("KovaaK's");
    expect(text).toContain("Saisis ou importe tes scores");
    // La promesse reste bornée : rien n'est écrit avant la sauvegarde.
    expect(text).toContain("Rien n'est enregistré tant que tu n'as pas sauvegardé");
  });

  it("se referme : il ne bloque rien et ne revient pas", () => {
    const markup = renderToStaticMarkup(
      <OnboardingBanner benchmark={benchmark} onDismiss={() => {}} />,
    );

    expect(textOf(markup)).toContain("J'ai compris");
    // Un encart, pas une modale : aucun rôle de dialogue, aucun piège de focus.
    expect(markup).not.toContain('role="dialog"');
  });
});
