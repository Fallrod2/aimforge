import { describe, expect, it } from "vitest";
import { COACH_DAILY_QUOTA } from "../../shared/coach-contract";
import { createQuotaRefund, evaluateQuota, refundQuota } from "./quota";

describe("evaluateQuota", () => {
  it("autorise le premier debrief du jour et annonce ce qui reste", () => {
    expect(evaluateQuota(1)).toEqual({ allowed: true, remaining: COACH_DAILY_QUOTA - 1 });
  });

  it("autorise le dernier debrief du quota, sans reste", () => {
    expect(evaluateQuota(COACH_DAILY_QUOTA)).toEqual({ allowed: true, remaining: 0 });
  });

  it("refuse le debrief suivant", () => {
    expect(evaluateQuota(COACH_DAILY_QUOTA + 1)).toEqual({ allowed: false, remaining: 0 });
  });

  it("ne rouvre jamais le quota, même si le compteur a dépassé (tentatives refusées)", () => {
    expect(evaluateQuota(42).allowed).toBe(false);
    expect(evaluateQuota(42).remaining).toBe(0);
  });

  it("accepte une limite explicite (P4 réutilisera la même règle)", () => {
    expect(evaluateQuota(2, 2)).toEqual({ allowed: true, remaining: 0 });
    expect(evaluateQuota(3, 2)).toEqual({ allowed: false, remaining: 0 });
  });

  /**
   * La propriété qui rend le décompte sûr sans verrou applicatif, et qu'aucun
   * test ne nommait jusqu'ici.
   *
   * `increment_ai_usage` (migrations 0003 et 0011) fait l'upsert, l'incrément et
   * la lecture dans **une seule instruction** :
   *
   * ```sql
   * insert … on conflict (user_id, day) do update set … returning …
   * ```
   *
   * `on conflict do update` prend le verrou de ligne sur la clé primaire : deux
   * requêtes simultanées sur le dernier debrief disponible ne peuvent pas lire
   * la même valeur, elles reçoivent `limit` et `limit + 1`. Le verdict étant
   * rendu **après** l'incrément et sur la valeur reçue, la seconde est refusée —
   * sans qu'aucun verrou n'ait à être posé côté fonction serverless.
   *
   * Le test ne peut pas jouer la concurrence (elle est en base) ; il fixe ce
   * dont elle dépend : deux compteurs distincts ⇒ au plus un passage.
   */
  it("ne laisse pas deux requêtes simultanées passer sur la dernière unité", () => {
    const limit = COACH_DAILY_QUOTA;
    // Les deux valeurs que l'incrément atomique rend à deux appels concurrents
    // arrivés alors que le compteur valait `limit - 1`.
    const verdicts = [evaluateQuota(limit, limit), evaluateQuota(limit + 1, limit)];

    expect(verdicts.filter((verdict) => verdict.allowed)).toHaveLength(1);
    expect(verdicts.map((verdict) => verdict.remaining)).toEqual([0, 0]);
  });
});

/**
 * Le remboursement existe à cause d'un incident réel : deux 502 dus à la
 * configuration de la plateforme ont consommé deux debriefs du quota d'un
 * utilisateur qui n'avait rien reçu. Les cas ci-dessous verrouillent les deux
 * bords de la règle — on rend ce qui n'a rien produit, on ne rend jamais deux
 * fois, et un remboursement en panne ne casse rien.
 */
describe("createQuotaRefund", () => {
  /** Un compteur du jour en mémoire, dans le rôle de `refund_ai_usage`. */
  function counter(countAfterIncrement: number): {
    readonly refundUsage: () => Promise<number | null>;
    readonly calls: () => number;
  } {
    let count = countAfterIncrement;
    let calls = 0;

    return {
      calls: () => calls,
      refundUsage: async () => {
        calls += 1;
        count = Math.max(0, count - 1);
        return count;
      },
    };
  }

  it("rend le debrief consommé : le quota remonte d'un cran", async () => {
    const { refundUsage } = counter(3);
    const refund = createQuotaRefund(evaluateQuota(3, 5).remaining, 5, refundUsage);

    expect(await refund.refund()).toBe(3);
  });

  it("ne rembourse qu'une fois, même appelé sur deux chemins d'échec", async () => {
    const { refundUsage, calls } = counter(3);
    const refund = createQuotaRefund(2, 5, refundUsage);

    expect(await refund.refund()).toBe(3);
    expect(await refund.refund()).toBe(3);
    expect(calls()).toBe(1);
  });

  it("ne rembourse qu'une fois même sur deux appels concurrents", async () => {
    const { refundUsage, calls } = counter(3);
    const refund = createQuotaRefund(2, 5, refundUsage);

    // Le drapeau est posé avant l'attente : le second appel n'atteint pas la base.
    await Promise.all([refund.refund(), refund.refund()]);
    expect(calls()).toBe(1);
  });

  it("garde le quota d'avant quand le remboursement échoue, sans lever", async () => {
    const refund = createQuotaRefund(2, 5, async () => null);

    // L'erreur d'origine est celle qui doit remonter : un compteur non rendu ne
    // doit ni la masquer ni la transformer en panne supplémentaire.
    expect(await refund.refund()).toBe(2);
  });

  it("ne rend jamais plus que la limite du jour", async () => {
    const refund = createQuotaRefund(5, 5, async () => 0);

    expect(await refund.refund()).toBe(5);
  });

  it("retraduit le compteur rendu par la base plutôt que d'incrémenter à l'aveugle", async () => {
    // La base fait foi : si une autre requête a consommé entre-temps, c'est son
    // compteur qui décide, pas notre `remaining` d'il y a trois secondes.
    const refund = createQuotaRefund(2, 5, async () => 4);

    expect(await refund.refund()).toBe(1);
  });
});

describe("refundQuota", () => {
  it("ne rembourse rien sur une configuration personnelle : rien n'a été compté", async () => {
    expect(await refundQuota(null, null)).toBeNull();
  });

  it("rembourse quand un incrément a eu lieu", async () => {
    const refund = createQuotaRefund(2, 5, async () => 2);

    expect(await refundQuota(refund, 2)).toBe(3);
  });
});
