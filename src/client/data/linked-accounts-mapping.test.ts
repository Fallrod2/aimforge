import { describe, expect, it } from "vitest";
import { DataError } from "./errors";
import {
  formatRiotId,
  type LinkedAccountRow,
  parseRiotId,
  toLinkedAccount,
  toLinkedAccounts,
} from "./linked-accounts-mapping";

function row(overrides: Partial<LinkedAccountRow> = {}): LinkedAccountRow {
  return {
    id: 7,
    provider: "riot",
    external_id: "Ninja#EUW",
    riot_puuid: "puuid-1",
    riot_region: "eu",
    label: null,
    is_primary: true,
    created_at: "2026-08-09T10:00:00+00:00",
    last_refreshed_at: null,
    riot_mmr: null,
    ...overrides,
  };
}

describe("toLinkedAccount", () => {
  it("passe la ligne en camelCase et normalise les dates", () => {
    expect(toLinkedAccount(row({ last_refreshed_at: "2026-08-09T10:05:00+00:00" }))).toEqual({
      id: 7,
      provider: "riot",
      externalId: "Ninja#EUW",
      riotPuuid: "puuid-1",
      riotRegion: "eu",
      label: null,
      isPrimary: true,
      createdAt: "2026-08-09T10:00:00.000Z",
      lastRefreshedAt: "2026-08-09T10:05:00.000Z",
      riotMmr: null,
    });
  });

  it("relit le rang stocké quand il respecte le contrat", () => {
    const account = toLinkedAccount(
      row({ riot_mmr: { tier: "Ascendant 2", rr: 43, lastChange: -18, elo: 1543 } }),
    );

    expect(account.riotMmr).toEqual({ tier: "Ascendant 2", rr: 43, lastChange: -18, elo: 1543 });
  });

  it("ignore un rang stocké hors contrat plutôt que d'afficher faux", () => {
    expect(
      toLinkedAccount(row({ riot_mmr: { tier: "Ascendant 2", rr: 4312 } })).riotMmr,
    ).toBeNull();
    expect(toLinkedAccount(row({ riot_mmr: "Immortel" })).riotMmr).toBeNull();
  });

  it("garde `null` pour un compte jamais rafraîchi", () => {
    expect(toLinkedAccount(row()).lastRefreshedAt).toBeNull();
  });

  it("accepte un compte KovaaK's", () => {
    const account = toLinkedAccount(
      row({ provider: "kovaaks", external_id: "Victard", riot_puuid: null, riot_region: null }),
    );

    expect(account.provider).toBe("kovaaks");
    expect(account.externalId).toBe("Victard");
  });

  it("refuse un fournisseur inconnu plutôt que de le deviner", () => {
    expect(() => toLinkedAccount(row({ provider: "faceit" }))).toThrow(DataError);
  });

  it("refuse une date illisible", () => {
    expect(() => toLinkedAccount(row({ created_at: "hier" }))).toThrow(DataError);
  });
});

describe("toLinkedAccounts", () => {
  it("conserve l'ordre reçu", () => {
    const accounts = toLinkedAccounts([row({ id: 1 }), row({ id: 2 })]);

    expect(accounts.map((account) => account.id)).toEqual([1, 2]);
  });
});

describe("parseRiotId", () => {
  it("sépare le nom du tag", () => {
    expect(parseRiotId("Ninja#EUW")).toEqual({ name: "Ninja", tag: "EUW" });
  });

  it("accepte un nom à espaces et une saisie relâchée", () => {
    expect(parseRiotId("  Le Joueur # 123 ")).toEqual({ name: "Le Joueur", tag: "123" });
  });

  it("refuse une saisie sans tag, à tag vide ou à plusieurs dièses", () => {
    expect(parseRiotId("Ninja")).toBeNull();
    expect(parseRiotId("Ninja#")).toBeNull();
    expect(parseRiotId("#EUW")).toBeNull();
    expect(parseRiotId("Ninja#EU#W")).toBeNull();
    expect(parseRiotId("   ")).toBeNull();
  });

  it("refuse un tag contenant une espace", () => {
    expect(parseRiotId("Ninja#EU W")).toBeNull();
  });
});

describe("formatRiotId", () => {
  it("rend la forme canonique", () => {
    expect(formatRiotId({ name: "Ninja", tag: "EUW" })).toBe("Ninja#EUW");
  });

  it("fait l'aller-retour avec parseRiotId", () => {
    const parsed = parseRiotId(" Le Joueur # 123 ");

    expect(parsed).not.toBeNull();
    expect(parsed && formatRiotId(parsed)).toBe("Le Joueur#123");
  });
});
