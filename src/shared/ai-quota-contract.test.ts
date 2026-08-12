/**
 * Le contrat des quotas IA : le jour, l'heure de réinitialisation, les phrases.
 *
 * Ce qui est vérifié ici est ce qui a été **relu dans les migrations** plutôt
 * que supposé : `ai_usage.day` vaut `(now() at time zone 'utc')::date` (0003,
 * 0010, 0011), donc le jour de quota est le jour civil UTC et le compteur
 * repart au prochain minuit UTC. Les cas qui comptent sont ceux où l'heure
 * locale et l'heure UTC ne tombent pas le même jour — c'est précisément là
 * qu'une supposition se serait vue en production, une fois par nuit.
 */

import { describe, expect, it } from "vitest";
import {
  type AiQuota,
  aiQuotaDay,
  aiQuotaLabel,
  aiQuotaNoun,
  aiQuotaOf,
  aiQuotaReachedMessage,
  aiQuotaResetLabel,
  aiQuotaResponseSchema,
  aiQuotaWithRemaining,
  DEFAULT_AI_QUOTA_LIMITS,
  nextAiQuotaResetAt,
} from "./ai-quota-contract.js";

describe("aiQuotaDay", () => {
  it("rend la date civile UTC, comme la clé primaire de ai_usage", () => {
    expect(aiQuotaDay(new Date("2026-08-12T10:30:00.000Z"))).toBe("2026-08-12");
  });

  it("suit UTC et non le fuseau local : 23:30 en France est déjà le lendemain UTC", () => {
    // 2026-08-12T23:30Z, soit 01:30 le 13 à Paris. Le jour de quota reste le 12.
    expect(aiQuotaDay(new Date("2026-08-12T23:30:00.000Z"))).toBe("2026-08-12");
    // Et l'inverse : 00:30 UTC le 13 est encore le 12 à New York.
    expect(aiQuotaDay(new Date("2026-08-13T00:30:00.000Z"))).toBe("2026-08-13");
  });
});

describe("nextAiQuotaResetAt", () => {
  it("rend le prochain minuit UTC", () => {
    expect(nextAiQuotaResetAt(new Date("2026-08-12T10:30:00.000Z"))).toBe(
      "2026-08-13T00:00:00.000Z",
    );
  });

  it("reste strictement devant, même à 23:59:59.999", () => {
    expect(nextAiQuotaResetAt(new Date("2026-08-12T23:59:59.999Z"))).toBe(
      "2026-08-13T00:00:00.000Z",
    );
  });

  it("à minuit UTC pile, vise le minuit suivant : le jour qui commence dure un jour", () => {
    expect(nextAiQuotaResetAt(new Date("2026-08-12T00:00:00.000Z"))).toBe(
      "2026-08-13T00:00:00.000Z",
    );
  });

  it("passe les fins de mois et les fins d'année", () => {
    expect(nextAiQuotaResetAt(new Date("2026-08-31T12:00:00.000Z"))).toBe(
      "2026-09-01T00:00:00.000Z",
    );
    expect(nextAiQuotaResetAt(new Date("2026-12-31T12:00:00.000Z"))).toBe(
      "2027-01-01T00:00:00.000Z",
    );
  });

  it("est cohérent avec le jour de quota : le reset est le lendemain du jour compté", () => {
    const now = new Date("2026-08-12T22:15:00.000Z");

    expect(nextAiQuotaResetAt(now).slice(0, 10)).not.toBe(aiQuotaDay(now));
    expect(Date.parse(nextAiQuotaResetAt(now)) - now.getTime()).toBeLessThanOrEqual(
      24 * 60 * 60 * 1000,
    );
  });
});

describe("aiQuotaOf", () => {
  const now = new Date("2026-08-12T10:00:00.000Z");

  it("porte le compteur, la limite et l'heure de réinitialisation", () => {
    expect(aiQuotaOf("routine", 3, 5, now)).toEqual({
      kind: "routine",
      used: 3,
      limit: 5,
      resetAt: "2026-08-13T00:00:00.000Z",
    });
  });

  it("plafonne à la limite : une tentative refusée incrémente quand même", () => {
    // `evaluateQuota` refuse à 6 sur 5, mais la base garde 6 (quota.ts) :
    // afficher « 6/5 » n'apprendrait rien, on montre le quota épuisé.
    expect(aiQuotaOf("coach", 6, 5, now).used).toBe(5);
  });

  it("ne descend jamais sous zéro", () => {
    expect(aiQuotaOf("chat", -1, 20, now).used).toBe(0);
  });
});

describe("aiQuotaWithRemaining", () => {
  const quota: AiQuota = {
    kind: "coach",
    used: 1,
    limit: 5,
    resetAt: "2026-08-13T00:00:00.000Z",
  };

  it("retraduit le restant rendu par l'API en compteur utilisé", () => {
    const now = new Date("2026-08-12T11:00:00.000Z");

    expect(aiQuotaWithRemaining(quota, 2, now)).toEqual({
      kind: "coach",
      used: 3,
      limit: 5,
      resetAt: "2026-08-13T00:00:00.000Z",
    });
  });

  it("garde l'heure du serveur tant qu'elle est devant", () => {
    const now = new Date("2026-08-12T23:59:00.000Z");

    expect(aiQuotaWithRemaining(quota, 0, now).resetAt).toBe("2026-08-13T00:00:00.000Z");
  });

  it("recalcule l'heure après minuit : un onglet de la veille ne promet pas une heure passée", () => {
    const now = new Date("2026-08-13T00:30:00.000Z");

    expect(aiQuotaWithRemaining(quota, 4, now).resetAt).toBe("2026-08-14T00:00:00.000Z");
  });

  it("survit à un instant illisible plutôt que de rendre NaN", () => {
    const now = new Date("2026-08-12T11:00:00.000Z");

    expect(aiQuotaWithRemaining({ ...quota, resetAt: "hier" }, 5, now).resetAt).toBe(
      "2026-08-13T00:00:00.000Z",
    );
  });

  it("borne le compteur des deux côtés", () => {
    const now = new Date("2026-08-12T11:00:00.000Z");

    expect(aiQuotaWithRemaining(quota, 0, now).used).toBe(5);
    expect(aiQuotaWithRemaining(quota, 9, now).used).toBe(0);
  });
});

describe("aiQuotaNoun", () => {
  it("accorde au pluriel à partir de deux", () => {
    expect(aiQuotaNoun("coach", 0)).toBe("debrief");
    expect(aiQuotaNoun("coach", 1)).toBe("debrief");
    expect(aiQuotaNoun("coach", 5)).toBe("debriefs");
    expect(aiQuotaNoun("routine", 5)).toBe("routines");
    expect(aiQuotaNoun("chat", 20)).toBe("messages");
  });
});

describe("aiQuotaResetLabel", () => {
  it("rend HH:MM en heure locale, dérivée de l'instant UTC du serveur", () => {
    const resetAt = "2026-08-13T00:00:00.000Z";
    const local = new Date(resetAt);
    const expected = `${String(local.getHours()).padStart(2, "0")}:${String(
      local.getMinutes(),
    ).padStart(2, "0")}`;

    expect(aiQuotaResetLabel(resetAt)).toBe(expected);
    expect(aiQuotaResetLabel(resetAt)).toMatch(/^\d{2}:\d{2}$/);
  });

  it("rend null sur un instant illisible plutôt qu'une heure inventée", () => {
    expect(aiQuotaResetLabel("demain")).toBeNull();
  });
});

describe("aiQuotaLabel", () => {
  it("dit le compteur, la limite et l'heure quand la donnée est là", () => {
    const quota: AiQuota = {
      kind: "routine",
      used: 3,
      limit: 5,
      resetAt: "2026-08-13T00:00:00.000Z",
    };
    const reset = aiQuotaResetLabel(quota.resetAt);

    expect(aiQuotaLabel("routine", { status: "counted", quota })).toBe(
      `3/5 aujourd'hui — se réinitialise à ${reset}`,
    );
  });

  it("dit la même chose pour les trois compteurs : une seule formulation", () => {
    const at = "2026-08-13T00:00:00.000Z";
    const reset = aiQuotaResetLabel(at);

    for (const kind of ["coach", "routine", "chat"] as const) {
      expect(
        aiQuotaLabel(kind, { status: "counted", quota: { kind, used: 1, limit: 4, resetAt: at } }),
      ).toBe(`1/4 aujourd'hui — se réinitialise à ${reset}`);
    }
  });

  it("annonce le quota levé sans jamais citer de limite", () => {
    const label = aiQuotaLabel("coach", { status: "lifted" });

    expect(label).toBe("Quota levé · ta configuration IA");
    expect(label).not.toMatch(/\d/);
  });

  it("retombe sur la limite par défaut tant que le serveur n'a pas répondu", () => {
    expect(aiQuotaLabel("chat", { status: "unknown" })).toBe(
      `${DEFAULT_AI_QUOTA_LIMITS.chat} messages par jour`,
    );
    expect(aiQuotaLabel("coach", { status: "unknown" })).toBe(
      `${DEFAULT_AI_QUOTA_LIMITS.coach} debriefs par jour`,
    );
  });

  it("n'affiche pas d'heure quand l'instant est illisible, mais garde le compteur", () => {
    expect(
      aiQuotaLabel("coach", {
        status: "counted",
        quota: { kind: "coach", used: 2, limit: 5, resetAt: "" },
      }),
    ).toBe("2/5 aujourd'hui");
  });
});

describe("aiQuotaReachedMessage", () => {
  it("nomme la chose comptée et la limite réellement appliquée", () => {
    expect(aiQuotaReachedMessage("routine", 3)).toBe(
      "Quota atteint : 3 routines par jour. Le compteur repart demain (heure UTC).",
    );
  });

  it("accorde le nom au singulier quand la limite vaut un", () => {
    expect(aiQuotaReachedMessage("coach", 1)).toBe(
      "Quota atteint : 1 debrief par jour. Le compteur repart demain (heure UTC).",
    );
  });

  it("accepte une incise pour un compteur qui paie plus d'un geste", () => {
    expect(aiQuotaReachedMessage("chat", 20, "analyses comprises")).toBe(
      "Quota atteint : 20 messages par jour, analyses comprises. Le compteur repart demain (heure UTC).",
    );
  });
});

describe("aiQuotaResponseSchema", () => {
  it("relit une réponse complète", () => {
    const payload = {
      lifted: false,
      quotas: [{ kind: "coach", used: 1, limit: 5, resetAt: "2026-08-13T00:00:00.000Z" }],
    };

    expect(aiQuotaResponseSchema.parse(payload)).toEqual(payload);
  });

  it("refuse un compteur inconnu plutôt que de l'afficher sans nom", () => {
    const payload = {
      lifted: false,
      quotas: [{ kind: "imports", used: 1, limit: 5, resetAt: "2026-08-13T00:00:00.000Z" }],
    };

    expect(aiQuotaResponseSchema.safeParse(payload).success).toBe(false);
  });
});
