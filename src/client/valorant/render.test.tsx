/**
 * Rendu statique des états de la vue Valorant.
 *
 * Ce fichier existe parce que les états qui comptent — « aucun compte lié »,
 * « aucune partie », « la source n'a pas renseigné la mesure » — ne se prouvent
 * pas en local autrement : il n'y a pas de clé HenrikDev sur cette machine, et
 * l'écran réel avec des données ne se vérifie qu'en production.
 *
 * Il ne monte rien : `renderToStaticMarkup` rend le premier passage, sans
 * effet ni DOM. C'est exactement ce qu'on veut vérifier ici — ce que
 * l'utilisateur voit **avant** que quoi que ce soit ait répondu, et ce que
 * chaque composant fait d'une donnée absente.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  LinkedAccount,
  MatchDetail,
  ScoreboardEntry,
  StatBreakdown,
  StatTotals,
  TrendPoint,
} from "../data";
import type { LinkedAccountsState } from "../linked/useLinkedAccounts";
import { ValorantPanel } from "../linked/ValorantPanel";
import { BreakdownTables } from "./BreakdownTables";
import { MatchList } from "./MatchList";
import { Analysis, Rounds, Scoreboard, Sides } from "./MatchView";
import { Overview } from "./Overview";

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

function account(overrides: Partial<LinkedAccount> = {}): LinkedAccount {
  return {
    id: 1,
    provider: "riot",
    externalId: "Alex#EUW",
    riotPuuid: null,
    riotRegion: "eu",
    label: null,
    isPrimary: true,
    createdAt: "2026-07-01T10:00:00.000Z",
    lastRefreshedAt: null,
    riotMmr: { tier: "Ascendant 2", rr: 47, lastChange: 18, elo: null },
    ...overrides,
  };
}

function totals(overrides: Partial<StatTotals> = {}): StatTotals {
  return {
    matches: 12,
    wins: 7,
    losses: 5,
    draws: 0,
    winrate: 58.3,
    kills: 210,
    deaths: 180,
    assists: 60,
    kd: 1.17,
    headshotPercent: 24.5,
    adr: 152,
    ...overrides,
  };
}

function breakdown(key: string, matches: number): StatBreakdown {
  return { key, totals: totals({ matches }) };
}

function trendPoint(overrides: Partial<TrendPoint> = {}): TrendPoint {
  return {
    matchId: "m1",
    playedAt: "2026-08-01T10:00:00.000Z",
    map: "Ascent",
    agent: "Jett",
    headshotPercent: 24,
    adr: 150,
    result: "victoire",
    rr: null,
    ...overrides,
  };
}

describe("carte Valorant du dashboard", () => {
  it("invite à lier un Riot ID quand aucun compte ne l'est", () => {
    const state: LinkedAccountsState = { status: "ready", accounts: [] };
    const text = textOf(renderToStaticMarkup(<ValorantPanel state={state} />));

    expect(text).toContain("Ton rang peut se suivre tout seul");
    expect(text).toContain("Lier un compte");
  });

  it("dit ce qui ne va pas quand les comptes liés sont illisibles", () => {
    const state: LinkedAccountsState = { status: "error", message: "Base injoignable." };

    expect(textOf(renderToStaticMarkup(<ValorantPanel state={state} />))).toContain(
      "Base injoignable.",
    );
  });

  it("montre le rang connu avant tout appel à la source", () => {
    const state: LinkedAccountsState = { status: "ready", accounts: [account()] };
    const text = textOf(renderToStaticMarkup(<ValorantPanel state={state} />));

    expect(text).toContain("Ascendant 2");
    expect(text).toContain("47 RR");
    expect(text).toContain("Alex#EUW");
  });

  /** Le geste qui dépense un quota a quitté l'accueil pour la page de match. */
  it("ne propose plus de débriefer depuis le dashboard", () => {
    const state: LinkedAccountsState = { status: "ready", accounts: [account()] };

    expect(textOf(renderToStaticMarkup(<ValorantPanel state={state} />))).not.toContain(
      "Débriefer",
    );
  });

  /**
   * Le rang et le bouton « Rafraîchir » ne sont plus doublés par un onglet :
   * ce panneau est le seul endroit d'où l'on va chercher les parties.
   */
  it("porte le rafraîchissement, et n'envoie plus vers un onglet Valorant", () => {
    const state: LinkedAccountsState = { status: "ready", accounts: [account()] };
    const markup = renderToStaticMarkup(<ValorantPanel state={state} />);

    expect(textOf(markup)).toContain("Rafraîchir");
    expect(markup).not.toContain("#/valorant");
  });
});

describe("vue d'ensemble", () => {
  it("affiche les quatre chiffres de la fenêtre", () => {
    const text = textOf(
      renderToStaticMarkup(
        <Overview totals={totals()} period="last30Days" onPeriodChange={() => {}} />,
      ),
    );

    expect(text).toContain("58,3 %");
    expect(text).toContain("1,17");
    expect(text).toContain("24,5 %");
    expect(text).toContain("152");
    expect(text).toContain("sur les 30 derniers jours");
  });

  /** « — » et « 0 » ne se disent pas pareil : c'est la règle du contrat. */
  it("dit « — » pour une mesure que la source n'a pas renseignée", () => {
    const text = textOf(
      renderToStaticMarkup(
        <Overview
          totals={totals({ headshotPercent: null, adr: null, kd: null })}
          period="all"
          onPeriodChange={() => {}}
        />,
      ),
    );

    expect(text).toContain("—");
    expect(text).toContain("pas qu'elle vaut zéro");
  });

  it("propose d'élargir la fenêtre quand elle est vide", () => {
    const text = textOf(
      renderToStaticMarkup(
        <Overview totals={totals({ matches: 0 })} period="last7Days" onPeriodChange={() => {}} />,
      ),
    );

    expect(text).toContain("Aucune partie sur cette fenêtre");
    expect(text).toContain("Élargis la période");
  });
});

describe("ventilations", () => {
  it("classe par volume et annonce ce qui dépasse", () => {
    const agents = [
      breakdown("Sova", 2),
      breakdown("Jett", 9),
      breakdown("Omen", 5),
      breakdown("Raze", 4),
      breakdown("Astra", 3),
      breakdown("Killjoy", 2),
      breakdown("Neon", 1),
    ];
    const markup = renderToStaticMarkup(<BreakdownTables byAgent={agents} byMap={[]} />);
    const text = textOf(markup);

    expect(text.indexOf("Jett")).toBeLessThan(text.indexOf("Omen"));
    expect(text).toContain("Et 1 autre agent");
    expect(text).toContain("Sur l'ensemble des parties importées.");
  });

  it("le dit quand aucune partie ne porte l'information", () => {
    expect(textOf(renderToStaticMarkup(<BreakdownTables byAgent={[]} byMap={[]} />))).toContain(
      "Aucune partie ne porte cette information",
    );
  });
});

describe("liste des parties", () => {
  const empty: ReadonlyMap<string, number> = new Map();

  it("met la partie la plus récente en tête", () => {
    const markup = renderToStaticMarkup(
      <MatchList
        trend={[
          trendPoint({ matchId: "vieux", map: "Bind" }),
          trendPoint({ matchId: "recent", map: "Lotus" }),
        ]}
        debriefed={empty}
      />,
    );

    expect(textOf(markup).indexOf("Lotus")).toBeLessThan(textOf(markup).indexOf("Bind"));
  });

  /** Depuis V6 la page d'une partie vit sous l'accueil : l'onglet a disparu. */
  it("fait de chaque ligne une adresse vers la page de la partie", () => {
    const markup = renderToStaticMarkup(
      <MatchList trend={[trendPoint({ matchId: "abc-123" })]} debriefed={empty} />,
    );

    expect(markup).toContain('href="#/accueil?match=abc-123"');
    expect(markup).not.toContain("#/valorant");
  });

  it("porte le badge des parties déjà débriefées, et seulement celles-là", () => {
    const markup = renderToStaticMarkup(
      <MatchList
        trend={[trendPoint({ matchId: "avec" }), trendPoint({ matchId: "sans" })]}
        debriefed={new Map([["avec", 42]])}
      />,
    );

    expect(textOf(markup).match(/Débriefé/g) ?? []).toHaveLength(1);
  });

  it("dit l'absence de mesure plutôt que zéro", () => {
    const text = textOf(
      renderToStaticMarkup(
        <MatchList
          trend={[trendPoint({ headshotPercent: null, adr: null, result: null })]}
          debriefed={empty}
        />,
      ),
    );

    expect(text).toContain("— HS");
    expect(text).toContain("— ADR");
    expect(text).toContain("Résultat inconnu");
  });

  it("annonce une fenêtre vide sans cadre vide", () => {
    expect(textOf(renderToStaticMarkup(<MatchList trend={[]} debriefed={empty} />))).toContain(
      "Aucune partie sur cette fenêtre.",
    );
  });
});

/* ------------------------------------------------------------------ */
/* La page d'une partie                                                */
/* ------------------------------------------------------------------ */

function player(overrides: Partial<ScoreboardEntry> = {}): ScoreboardEntry {
  return {
    name: "Joueur",
    agent: "Jett",
    team: "bleue",
    isYou: false,
    score: 200,
    kills: 15,
    deaths: 12,
    assists: 4,
    adr: 148,
    headshotPercent: 22,
    ...overrides,
  };
}

describe("scoreboard", () => {
  it("met en avant sa propre ligne, et elle seule", () => {
    const text = textOf(
      renderToStaticMarkup(
        <Scoreboard entries={[player({ name: "Moi", isYou: true }), player({ name: "Autre" })]} />,
      ),
    );

    expect(text.match(/ toi /g) ?? []).toHaveLength(1);
    expect(text.indexOf("Moi")).toBeLessThan(text.indexOf("Autre"));
  });

  it("ouvre par son équipe puis l'adverse", () => {
    const text = textOf(
      renderToStaticMarkup(
        <Scoreboard
          entries={[
            player({ name: "Adverse", team: "bleue" }),
            player({ name: "Moi", team: "rouge", isYou: true }),
          ]}
        />,
      ),
    );

    expect(text.indexOf("Équipe rouge")).toBeLessThan(text.indexOf("Équipe bleue"));
  });

  it("classe chaque équipe par score décroissant", () => {
    const text = textOf(
      renderToStaticMarkup(
        <Scoreboard
          entries={[player({ name: "Bas", score: 90 }), player({ name: "Haut", score: 320 })]}
        />,
      ),
    );

    expect(text.indexOf("Haut")).toBeLessThan(text.indexOf("Bas"));
  });

  it("dit « — » plutôt que zéro sur une colonne non renseignée", () => {
    const text = textOf(
      renderToStaticMarkup(
        <Scoreboard entries={[player({ kills: null, adr: null, headshotPercent: null })]} />,
      ),
    );

    expect(text).toContain("—");
    expect(text).not.toContain("0 / 0 / 0");
  });

  it("explique un scoreboard absent au lieu d'afficher un tableau vide", () => {
    expect(textOf(renderToStaticMarkup(<Scoreboard entries={[]} />))).toContain(
      "n'a pas renvoyé le tableau des joueurs",
    );
  });
});

describe("performance par side", () => {
  /** Le cas explicitement demandé : sides absents ⇒ mention sobre, pas de tableau. */
  it("remplace la section par une phrase quand la source n'a pas les sides", () => {
    const text = textOf(renderToStaticMarkup(<Sides sides={[]} />));

    expect(text).toContain("rattacher les rounds à un side");
    expect(text).not.toContain("Attaque");
    expect(text).not.toContain("Défense");
  });

  it("affiche les deux sides quand ils sont connus", () => {
    const text = textOf(
      renderToStaticMarkup(
        <Sides
          sides={[
            { side: "attaque", rounds: 12, roundsWon: 7, kills: 11, adr: 160, headshotPercent: 25 },
            { side: "defense", rounds: 12, roundsWon: 6, kills: 9, adr: 140, headshotPercent: 19 },
          ]}
        />,
      ),
    );

    expect(text).toContain("Attaque");
    expect(text).toContain("Défense");
    expect(text).toContain("7 / 12");
  });
});

describe("rounds", () => {
  it("numérote chaque round dans l'ordre", () => {
    const text = textOf(
      renderToStaticMarkup(
        <Rounds
          rounds={[
            { index: 1, won: true, side: "attaque" },
            { index: 2, won: false, side: "attaque" },
            { index: 3, won: null, side: null },
          ]}
        />,
      ),
    );

    expect(text).toContain("1 2 3");
  });

  /** La couleur ne dit jamais seule : le titre porte l'issue et le side. */
  it("porte l'issue et le side en texte, pas seulement en couleur", () => {
    const markup = renderToStaticMarkup(
      <Rounds rounds={[{ index: 1, won: true, side: "defense" }]} />,
    );

    expect(markup).toContain("Round 1 · Gagné · Défense");
  });

  it("explique un déroulé absent", () => {
    expect(textOf(renderToStaticMarkup(<Rounds rounds={[]} />))).toContain(
      "n'a pas renvoyé le déroulé des rounds",
    );
  });
});

describe("mini-analyse", () => {
  const DETAIL: MatchDetail = {
    matchId: "m-1",
    playedAt: "2026-08-09T18:12:00.000Z",
    map: "Ascent",
    mode: "Competitive",
    team: "bleue",
    result: "defaite",
    roundsWon: 11,
    roundsLost: 13,
    scoreboard: [],
    rounds: [],
    sides: [],
  };

  function analysisMarkup(overrides: Partial<Parameters<typeof Analysis>[0]> = {}): string {
    return renderToStaticMarkup(
      <Analysis
        analysis={null}
        detail={DETAIL}
        generating={false}
        error={null}
        remaining={null}
        onAnalyze={() => {}}
        {...overrides}
      />,
    );
  }

  /** Rien ne se génère tout seul : ouvrir une partie ne coûte pas un quota. */
  it("n'offre qu'un bouton tant qu'aucune analyse n'existe, et annonce son coût", () => {
    const text = textOf(analysisMarkup());

    expect(text).toContain("Analyser ce match");
    expect(text).toContain("un message de coach");
    expect(text).toContain("la relecture est gratuite");
    expect(text).not.toContain("Approfondir");
  });

  it("désarme le bouton et le dit pendant la génération", () => {
    const markup = analysisMarkup({ generating: true });

    expect(textOf(markup)).toContain("Le coach lit ta partie");
    expect(markup).toContain("disabled");
  });

  /**
   * Le bouton disparaît définitivement : le serveur ne regénérera pas, et
   * l'offrir serait une promesse fausse.
   */
  it("affiche l'analyse et le pont vers le coach, sans rouvrir le bouton", () => {
    const text = textOf(analysisMarkup({ analysis: "Tu meurs trop tôt en post-plant." }));

    expect(text).toContain("Tu meurs trop tôt en post-plant.");
    expect(text).toContain("Approfondir avec le coach");
    expect(text).not.toContain("Analyser ce match");
  });

  /**
   * La note de quota est celle de tout le monde (`QuotaNote`) : elle dit
   * « 3/20 aujourd'hui — se réinitialise à HH:MM » une fois la limite lue au
   * serveur, et pas « Il te reste 3 messages » comme cet écran le disait pour
   * lui seul (Vague 3.4).
   *
   * En rendu statique, aucun effet ne s'exécute : la limite n'est pas connue,
   * donc la note s'en tient à la formulation par défaut — sans inventer de
   * dénominateur, quel que soit le restant annoncé. C'est exactement la règle
   * que `QuotaNote.test.ts` fixe, vérifiée ici sur l'écran réel.
   */
  it("affiche la note de quota commune, avant comme après l'analyse", () => {
    expect(textOf(analysisMarkup())).toContain("messages par jour");
    expect(textOf(analysisMarkup({ analysis: "Court.", remaining: 7 }))).toContain(
      "messages par jour",
    );
    expect(textOf(analysisMarkup({ analysis: "Court.", remaining: 7 }))).not.toContain(
      "Il te reste",
    );
  });

  it("montre l'erreur du serveur telle qu'elle, quota atteint compris", () => {
    const markup = analysisMarkup({ error: "Quota atteint : 20 messages de coach par jour." });

    expect(textOf(markup)).toContain("Quota atteint");
    expect(markup).toContain('aria-live="polite"');
  });
});
