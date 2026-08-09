import { describe, expect, it } from "vitest";
import {
  CHAT_MESSAGE_MAX,
  chatErrorSchema,
  chatMessageSchema,
  chatRequestSchema,
  chatResponseSchema,
  chatRoleSchema,
} from "./coach-chat-contract";

const MESSAGE = {
  id: 7,
  debriefId: 3,
  role: "coach",
  content: "Travaille tes retakes : entrez groupés après la pose.",
  createdAt: "2026-08-09T19:05:00.000Z",
};

describe("chatRequestSchema", () => {
  it("accepte une question sous un debrief", () => {
    expect(
      chatRequestSchema.safeParse({ debrief_id: 3, message: "Que faire pour l'axe 1 ?" }).success,
    ).toBe(true);
  });

  it("exige un identifiant de debrief entier et positif", () => {
    expect(chatRequestSchema.safeParse({ message: "Salut" }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ debrief_id: 0, message: "Salut" }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ debrief_id: 1.5, message: "Salut" }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ debrief_id: "3", message: "Salut" }).success).toBe(false);
  });

  it("refuse un message vide ou fait uniquement d'espaces", () => {
    // Sans détourage, ce corps atteindrait le modèle : la fonction est
    // appelable sans passer par le formulaire.
    expect(chatRequestSchema.safeParse({ debrief_id: 3, message: "" }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ debrief_id: 3, message: "  \n\t " }).success).toBe(false);
  });

  it("détoure le message accepté", () => {
    const parsed = chatRequestSchema.safeParse({ debrief_id: 3, message: "  Et le tracking ? \n" });

    expect(parsed.success && parsed.data.message).toBe("Et le tracking ?");
  });

  it("refuse un message au-delà de la borne", () => {
    expect(
      chatRequestSchema.safeParse({ debrief_id: 3, message: "x".repeat(CHAT_MESSAGE_MAX) }).success,
    ).toBe(true);
    expect(
      chatRequestSchema.safeParse({ debrief_id: 3, message: "x".repeat(CHAT_MESSAGE_MAX + 1) })
        .success,
    ).toBe(false);
  });
});

describe("chatRoleSchema", () => {
  it("n'accepte que les deux voix de la table", () => {
    expect(chatRoleSchema.safeParse("user").success).toBe(true);
    expect(chatRoleSchema.safeParse("coach").success).toBe(true);
    // « assistant » est le vocabulaire d'un fournisseur, pas celui du produit :
    // la traduction se fait dans le prompt, à un seul endroit.
    expect(chatRoleSchema.safeParse("assistant").success).toBe(false);
    expect(chatRoleSchema.safeParse("system").success).toBe(false);
  });
});

describe("chatMessageSchema", () => {
  it("accepte un message enregistré", () => {
    expect(chatMessageSchema.safeParse(MESSAGE).success).toBe(true);
  });

  it("refuse un message amputé d'une clé", () => {
    for (const key of ["id", "debriefId", "role", "content", "createdAt"] as const) {
      const { [key]: _removed, ...rest } = MESSAGE;

      expect(chatMessageSchema.safeParse(rest).success, key).toBe(false);
    }
  });

  it("refuse un contenu vide : la colonne l'interdit aussi", () => {
    expect(chatMessageSchema.safeParse({ ...MESSAGE, content: "" }).success).toBe(false);
  });
});

describe("réponses de la fonction", () => {
  it("valide un aller-retour complet", () => {
    const parsed = chatResponseSchema.safeParse({
      question: { ...MESSAGE, id: 6, role: "user", content: "Que faire pour l'axe 1 ?" },
      answer: MESSAGE,
      remaining: 18,
    });

    expect(parsed.success).toBe(true);
  });

  it("exige les deux messages : le sien n'existe qu'une fois la réponse obtenue", () => {
    expect(chatResponseSchema.safeParse({ answer: MESSAGE, remaining: 18 }).success).toBe(false);
  });

  it("accepte un quota levé (configuration IA personnelle)", () => {
    const parsed = chatResponseSchema.safeParse({
      question: { ...MESSAGE, id: 6, role: "user" },
      answer: MESSAGE,
      remaining: null,
    });

    expect(parsed.success).toBe(true);
  });

  it("valide une erreur, avec ou sans compteur", () => {
    expect(chatErrorSchema.safeParse({ error: "Quota atteint", remaining: 0 }).success).toBe(true);
    expect(chatErrorSchema.safeParse({ error: "IA non configurée" }).success).toBe(true);
    // Facultatif ne veut pas dire nullable : un `null` ferait échouer la
    // relecture côté client, qui remplacerait le message soigné par le sien.
    expect(chatErrorSchema.safeParse({ error: "Panne", remaining: null }).success).toBe(false);
    expect(chatErrorSchema.safeParse({ error: "" }).success).toBe(false);
  });
});
