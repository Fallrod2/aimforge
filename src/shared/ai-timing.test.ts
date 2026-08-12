/**
 * L'alignement des trois horloges, vérifié plutôt que promis.
 *
 * Le dernier test relit les fichiers `api/` sur le disque. C'est inhabituel, et
 * c'est justifié : la plateforme lit `export const maxDuration` par analyse
 * statique, la valeur ne peut donc pas être importée depuis ce module. Le
 * miroir est inévitable ; la dérive silencieuse, non — et une dérive ici coûte
 * un quota décompté sans contrepartie, sur une fonction tuée avant d'avoir pu
 * rembourser.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AI_CLIENT_TIMEOUT_MS,
  AI_FUNCTIONS,
  AI_MAX_DURATION_S,
  AI_MODEL_BUDGET_MS,
  AI_MODEL_CALL_CAP_MS,
  AI_MODEL_CALL_FLOOR_MS,
} from "./ai-timing";

const MAX_DURATION_MS = AI_MAX_DURATION_S * 1_000;

describe("les délais des générations IA", () => {
  it("laisse au serveur de quoi rembourser après le dernier appel au modèle", () => {
    expect(AI_MODEL_BUDGET_MS).toBeLessThan(MAX_DURATION_MS);
    // Assez pour lire le contexte, écrire en base, rembourser et répondre.
    expect(MAX_DURATION_MS - AI_MODEL_BUDGET_MS).toBeGreaterThanOrEqual(10_000);
  });

  it("garde de quoi tenter une relance corrective après un premier appel au plafond", () => {
    expect(AI_MODEL_CALL_CAP_MS).toBeLessThan(AI_MODEL_BUDGET_MS);
    expect(AI_MODEL_BUDGET_MS - AI_MODEL_CALL_CAP_MS).toBeGreaterThanOrEqual(
      AI_MODEL_CALL_FLOOR_MS,
    );
  });

  it("fait attendre le client plus longtemps que le serveur, jamais moins", () => {
    expect(AI_CLIENT_TIMEOUT_MS).toBeGreaterThan(MAX_DURATION_MS);
  });

  it("reste le miroir exact du `maxDuration` déclaré par chaque fonction IA", () => {
    for (const file of AI_FUNCTIONS) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      const declared = /export const maxDuration = (\d+);/.exec(source)?.[1];

      expect(declared, `${file} doit déclarer un maxDuration`).toBeDefined();
      expect(Number(declared), `${file} a dérivé de src/shared/ai-timing.ts`).toBe(
        AI_MAX_DURATION_S,
      );
    }
  });
});
