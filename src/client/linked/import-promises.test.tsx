/**
 * Ce que les écrans **promettent** à propos des imports, et ce qu'ils laissent
 * comme issue quand l'import n'a pas lieu (vague 3.3).
 *
 * Les trois surfaces concernées vivent dans des vues qui demandent une session
 * (accueil, tracker) : on rend donc les composants porteurs de la phrase, seuls,
 * en `renderToStaticMarkup`. C'est aussi ce qui rend le test utile — la promesse
 * est du texte, et rien d'autre qu'un test de texte ne la retient de dériver.
 *
 * Deux règles y sont fixées, toutes deux issues du code réel :
 *
 * 1. **aucun écran ne promet un nombre fixe de scores.** L'import ne rend que
 *    les scénarios déjà joués (`mapBenchmarkProgress`, `missing` non vide dès
 *    qu'un palier est entamé) : « tes 18 scores arrivent » ferait passer le cas
 *    ordinaire pour une panne ;
 * 2. **tout échec d'import laisse voir la saisie manuelle.** C'est le seul
 *    chemin qui ne dépend d'aucune source tierce, et le seul qui reste quand
 *    kovaaks.com est muet ou que la clé HenrikDev n'est pas posée.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { currentBenchmark, getBenchmark } from "../../lib/energy";
import { LastBench } from "../dashboard/DashboardView";
import type { LinkedAccount } from "../data";
import type { ImportState } from "../tracker/import";
import { ImportPanel } from "../tracker/TrackerView";
import type { LinkedAccountsState } from "./useLinkedAccounts";
import { ValorantPanel } from "./ValorantPanel";

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

const benchmark = getBenchmark(currentBenchmark());

/** Un compte KovaaK's lié, tel que le panneau d'import le reçoit. */
const kovaaks: LinkedAccount = {
  id: 1,
  provider: "kovaaks",
  externalId: "Victard",
  riotPuuid: null,
  riotRegion: null,
  label: null,
  isPrimary: true,
  createdAt: "2026-07-01T10:00:00.000Z",
  lastRefreshedAt: null,
  riotMmr: null,
};

function importPanel(state: ImportState, account: LinkedAccount | null): string {
  return renderToStaticMarkup(
    <ImportPanel
      account={account}
      loading={false}
      state={state}
      benchmark={benchmark}
      scenarioCount={18}
      tierLabel="Intermediate"
      imported={false}
      manualOpen={false}
      onRefresh={() => {}}
      onToggleManual={() => {}}
    />,
  );
}

describe("promesse d'import KovaaK's", () => {
  it("n'annonce pas un nombre fixe de scores sur l'accueil", () => {
    const text = textOf(
      renderToStaticMarkup(
        <LastBench
          bench={{ status: "empty", reason: null }}
          kovaaksLinked={false}
          onRetry={() => {}}
        />,
      ),
    );

    // La promesse porte sur « tes scores », pas sur les dix-huit : un palier
    // entamé revient incomplet, et c'est le cas le plus fréquent.
    expect(text).toContain("Tes scores peuvent arriver tout seuls");
    expect(text).not.toContain("Tes 18 scores");
    // Le chemin manuel reste nommé dans la même carte.
    expect(text).toContain("à la main");
  });

  it("dit dans le tracker que l'import remplit ce qu'il trouve, pas tout", () => {
    const text = textOf(importPanel({ status: "idle" }, null));

    expect(text).toContain("les champs qu'il trouve");
    expect(text).toContain("la saisie à la main ci-dessous fait le travail");
  });
});

describe("repli quand l'import échoue", () => {
  /**
   * Le message du serveur est repris tel quel — il dit *ce qui* s'est passé —
   * et l'écran ajoute *ce qui reste possible*. Les deux, toujours : les erreurs
   * qui viennent de chez nous (compteur indisponible, frein quotidien) ne
   * parlent pas de saisie manuelle, elles.
   */
  it("montre la cause et le chemin manuel, quelle que soit la cause", () => {
    const text = textOf(
      importPanel({ status: "error", message: "Le compteur d'imports est indisponible." }, kovaaks),
    );

    expect(text).toContain("Le compteur d'imports est indisponible.");
    expect(text).toContain("Tes scores restent saisissables à la main ci-dessous.");
  });

  it("ne prétend pas qu'un import en vol va tout remplir", () => {
    const text = textOf(importPanel({ status: "loading" }, kovaaks));

    expect(text).toContain("Récupération de tes scores KovaaK's…");
    expect(text).not.toContain("18 scénarios importés");
  });
});

describe("promesse de suivi Valorant", () => {
  /**
   * Le rang ne dépend pas de nous : il vient de HenrikDev, dont la clé peut ne
   * pas être posée (503 `NOT_CONFIGURED` dans `api/_lib/henrikdev.ts`).
   * L'invitation doit donc dire d'où vient le chiffre et ce qui se passe quand
   * la source manque — « suis ton rang sans rien saisir » ne le disait pas.
   */
  it("nomme la dépendance tierce au lieu de promettre le rang sans condition", () => {
    const state: LinkedAccountsState = { status: "ready", accounts: [] };
    const text = textOf(renderToStaticMarkup(<ValorantPanel state={state} />));

    expect(text).toContain("Ton rang peut se suivre tout seul");
    expect(text).toContain("service tiers");
    expect(text).not.toContain("sans rien saisir");
  });
});
