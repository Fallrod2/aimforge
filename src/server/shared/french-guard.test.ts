/**
 * Ce qui se vérifie ici tient en une phrase : **la typo se répare, le sens ne
 * se touche pas**.
 *
 * Les fixtures ne sont pas inventées. Les quatre fautes vedettes viennent de
 * générations réelles capturées en production, et chacune a son test :
 * « si tu tenus ces deux blocs », « Ton est très bas », « avant de bouger.
 * mérite un travail ciblé », « car se construira bloc par bloc ».
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  detectFrenchIssues,
  frenchGuard,
  hasConjugatedVerb,
  inspectFrench,
  repairFrench,
  splitFrenchSentences,
} from "./french-guard";

const SCENARIOS = ["VT Pasu Novice", "VT 1w4ts Novice", "VT Popcorn Novice"];

function kinds(issues: readonly { readonly kind: string }[]): readonly string[] {
  return issues.map((issue) => issue.kind);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("repairFrench", () => {
  it("remet la majuscule après un point", () => {
    const { text, fixes } = repairFrench("Trois runs de plus. tu tiens la ligne.");

    expect(text).toBe("Trois runs de plus. Tu tiens la ligne.");
    expect(fixes).toContainEqual({ kind: "majuscule_apres_point", count: 1 });
  });

  it("remet la majuscule après un point d'exclamation ou d'interrogation", () => {
    expect(repairFrench("Bien joué ! garde ce rythme.").text).toBe("Bien joué ! Garde ce rythme.");
    expect(repairFrench("Où ça casse ? le placement.").text).toBe("Où ça casse ? Le placement.");
  });

  it("ne pose pas de majuscule après une abréviation connue", () => {
    expect(repairFrench("Trois runs, etc. puis tu enchaînes.").text).toBe(
      "Trois runs, etc. puis tu enchaînes.",
    );
  });

  it("ne pose pas de majuscule après un point de numérotation", () => {
    expect(repairFrench("Ordre : 1. clicking, 2. tracking.").text).toBe(
      "Ordre : 1. clicking, 2. tracking.",
    );
  });

  it("écrase les doubles espaces et l'espace parasite avant la ponctuation", () => {
    const { text, fixes } = repairFrench("Trois  runs , puis une pause .");

    expect(text).toBe("Trois runs, puis une pause.");
    expect(kinds(fixes)).toContain("double_espace");
    expect(kinds(fixes)).toContain("espace_avant_ponctuation");
  });

  it("pose l'espace manquant après une virgule ou un point", () => {
    expect(repairFrench("Trois runs,puis une pause.Ensuite tu vises.").text).toBe(
      "Trois runs, puis une pause. Ensuite tu vises.",
    );
  });

  it("laisse un nombre décimal intact", () => {
    expect(repairFrench("Ton overall est à 401,4 pour 500.").text).toBe(
      "Ton overall est à 401,4 pour 500.",
    );
  });

  it("ne touche à rien dans un marqueur de citation", () => {
    const { text } = repairFrench("Tu es encore à [HS% 23]. relance trois runs.");

    expect(text).toContain("[HS% 23]");
    expect(text).toContain(". Relance");
  });

  it("ne touche à rien dans un nom de scénario protégé", () => {
    const { text } = repairFrench("Enchaîne VT 1w4ts Novice. puis souffle.", {
      protectedNames: SCENARIOS,
    });

    expect(text).toContain("VT 1w4ts Novice");
    expect(text).toContain(". Puis souffle.");
  });

  it("ne touche à rien dans une URL", () => {
    const text = "Le barème est sur https://voltaic.gg/s5.page et rien d'autre.";

    expect(repairFrench(text).text).toBe(text);
  });

  it("rend un texte propre à l'identique, sans annoncer de correction", () => {
    const clean = "Ton pourcentage de tirs à la tête est bas. Trois runs de plus suffisent.";
    const { text, fixes } = repairFrench(clean);

    expect(text).toBe(clean);
    expect(fixes).toEqual([]);
  });
});

describe("hasConjugatedVerb", () => {
  it("reconnaît un verbe conjugué courant", () => {
    expect(hasConjugatedVerb("Ton pourcentage de tirs à la tête est très bas")).toBe(true);
    expect(hasConjugatedVerb("Tu tiens la ligne sur trois runs")).toBe(true);
    expect(hasConjugatedVerb("Ce scénario mérite un travail ciblé")).toBe(true);
  });

  it("reconnaît un verbe posé juste après un clitique", () => {
    expect(hasConjugatedVerb("Ta stabilité se construira bloc par bloc")).toBe(true);
  });

  it("ne voit aucun verbe dans une tournure télégraphique", () => {
    expect(hasConjugatedVerb("Trois runs de suite sur le tracking précis")).toBe(false);
  });
});

describe("splitFrenchSentences", () => {
  it("découpe sur la ponctuation forte", () => {
    expect(splitFrenchSentences("Un point. Deux points ! Trois ?")).toEqual([
      "Un point.",
      "Deux points !",
      "Trois ?",
    ]);
  });

  it("traite chaque puce comme une phrase et retire son tiret", () => {
    expect(splitFrenchSentences("- Trois runs\n- Puis une pause")).toEqual([
      "Trois runs",
      "Puis une pause",
    ]);
  });
});

describe("detectFrenchIssues", () => {
  it("signale une conjugaison impossible après « tu »", () => {
    const issues = detectFrenchIssues("Tes stabilisations si tu tenus ces deux blocs.");

    expect(kinds(issues)).toContain("conjugaison_2e_personne");
    expect(issues.some((issue) => issue.excerpt.includes("tenus"))).toBe(true);
  });

  it("signale une deuxième personne mal terminée", () => {
    expect(kinds(detectFrenchIssues("Tu prendra le temps de viser."))).toContain(
      "conjugaison_2e_personne",
    );
  });

  it("accepte les formes justes de la deuxième personne", () => {
    const issues = detectFrenchIssues("Tu peux tenir. Tu ne perds rien. Tu t'appliques.");

    expect(kinds(issues)).not.toContain("conjugaison_2e_personne");
  });

  it("signale un déterminant collé à un verbe : le sujet a sauté", () => {
    const issues = detectFrenchIssues("Ton est très bas, chaque run compte.");

    expect(kinds(issues)).toContain("sujet_manquant");
  });

  it("signale une phrase qui s'ouvre sur un verbe sans sujet", () => {
    expect(kinds(detectFrenchIssues("Avant de bouger. mérite un travail ciblé."))).toContain(
      "sujet_manquant",
    );
    expect(kinds(detectFrenchIssues("Se construira bloc par bloc."))).toContain("sujet_manquant");
  });

  it("signale la minuscule après un point", () => {
    expect(kinds(detectFrenchIssues("Avant de bouger. mérite un travail ciblé."))).toContain(
      "minuscule_apres_point",
    );
  });

  it("signale une subordonnée laissée seule", () => {
    expect(kinds(detectFrenchIssues("Car se construira bloc par bloc."))).toContain(
      "fragment_subordonne",
    );
  });

  it("signale une phrase coupée sur un mot de liaison", () => {
    expect(kinds(detectFrenchIssues("Tu gagnes du temps sur le placement et"))).toContain(
      "fragment_subordonne",
    );
  });

  it("signale une phrase sans verbe conjugué", () => {
    expect(kinds(detectFrenchIssues("Trois runs de suite sur le tracking."))).toContain(
      "phrase_sans_verbe",
    );
  });

  it("laisse passer une tournure brève : un titre n'est pas une phrase", () => {
    expect(kinds(detectFrenchIssues("Bloc de tracking", { role: "titre" }))).not.toContain(
      "phrase_sans_verbe",
    );
  });

  it("signale une citation en position de sujet", () => {
    expect(kinds(detectFrenchIssues("[HS% 23] est très bas, chaque run compte."))).toContain(
      "citation_sujet",
    );
  });

  it("ne signale rien sur un français propre", () => {
    const clean = [
      "Ton pourcentage de tirs à la tête reste bas sur la fenêtre.",
      "Tu gagnes plus en stabilisant ta visée qu'en cherchant la vitesse.",
      "Ce scénario mérite trois runs de plus avant de changer de bloc.",
    ].join(" ");

    expect(detectFrenchIssues(clean)).toEqual([]);
  });

  it("ne signale rien dans un nom de scénario protégé", () => {
    const issues = detectFrenchIssues("Enchaîne VT 1w4ts Novice pendant six minutes.", {
      protectedNames: SCENARIOS,
    });

    expect(kinds(issues)).not.toContain("minuscule_apres_point");
  });
});

describe("inspectFrench", () => {
  it("relève la faute sur le texte brut, puis rend le texte réparé", () => {
    const report = inspectFrench("Avant de bouger. mérite un travail ciblé.");

    expect(report.text).toBe("Avant de bouger. Mérite un travail ciblé.");
    expect(kinds(report.issues)).toContain("minuscule_apres_point");
    expect(kinds(report.issues)).toContain("sujet_manquant");
  });

  it("ne réécrit jamais une phrase signalée : seul le caractère fautif bouge", () => {
    const report = inspectFrench("Tes stabilisations si tu tenus ces deux blocs.");

    expect(report.text).toBe("Tes stabilisations si tu tenus ces deux blocs.");
    expect(report.issues.length).toBeGreaterThan(0);
  });
});

describe("frenchGuard", () => {
  it("répare champ par champ et rassemble tout dans un seul résumé", () => {
    const guard = frenchGuard("routine", { protectedNames: SCENARIOS });

    expect(guard.apply("Trois runs. puis une pause.", "conseil")).toBe(
      "Trois runs. Puis une pause.",
    );
    expect(guard.apply("Bloc de tracking", "titre", "titre")).toBe("Bloc de tracking");

    const summary = guard.flush();

    expect(summary.source).toBe("routine");
    expect(summary.fixes).toContainEqual({ kind: "majuscule_apres_point", count: 1 });
    expect(summary.issues.every((issue) => issue.field !== undefined)).toBe(true);
  });

  it("nomme le champ fautif dans le résumé", () => {
    const guard = frenchGuard("coach");

    guard.apply("Ton est très bas.", "resume");

    const summary = guard.flush();

    expect(summary.issues.some((issue) => issue.field === "resume")).toBe(true);
  });

  it("écrit une ligne de journal quand une faute de structure passe", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const guard = frenchGuard("thread");

    guard.apply("Ton est très bas.", "answer");
    guard.flush();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("[french-guard]");
  });

  it("reste muet sur une sortie propre", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const guard = frenchGuard("thread");

    guard.apply("Tu gagnes du temps en stabilisant ta visée.", "answer");

    expect(guard.flush().issues).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });
});
