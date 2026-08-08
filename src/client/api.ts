/**
 * Accès à l'API. Les contrats viennent des schémas Zod du serveur
 * (`src/server/api/schemas.ts`, module pur : Zod + moteur d'énergie) : aucun
 * type de réponse n'est réécrit à la main côté client.
 */

import type { z } from "zod";
import {
  benchRunDetailSchema,
  benchRunSummaryListSchema,
  type benchRunSummarySchema,
  type CreateBenchRunInput,
  createBenchRunSchema,
} from "../server/api/schemas";

export type BenchRunSummary = z.infer<typeof benchRunSummarySchema>;
export type BenchRunDetail = z.infer<typeof benchRunDetailSchema>;
export type { CreateBenchRunInput };

/** Erreur d'appel API portant un message affichable tel quel. */
export class ApiError extends Error {
  override readonly name = "ApiError";
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();

    if (typeof body === "object" && body !== null && "error" in body) {
      const { error } = body as { error: unknown };

      if (typeof error === "string") return error;
    }
  } catch {
    // Corps absent ou non JSON : le statut suffit à qualifier l'échec.
  }
  return `Réponse ${response.status} de l'API`;
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  let response: Response;

  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError("Serveur injoignable. Vérifie que l'API tourne sur le port 3000.");
  }
  if (!response.ok) throw new ApiError(await errorMessage(response));
  return response;
}

async function get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  return schema.parse(await (await send(path)).json());
}

/** Toutes les passes, de la plus récente à la plus ancienne. */
export function listBenchRuns(): Promise<readonly BenchRunSummary[]> {
  return get("/api/bench-runs", benchRunSummaryListSchema);
}

/** Le détail d'une passe : 18 scores et 9 sous-catégories. */
export function getBenchRun(id: number): Promise<BenchRunDetail> {
  return get(`/api/bench-runs/${id}`, benchRunDetailSchema);
}

/** Enregistre une passe. Les énergies sont (re)calculées par le serveur. */
export async function createBenchRun(input: CreateBenchRunInput): Promise<BenchRunDetail> {
  const payload = createBenchRunSchema.parse(input);
  const response = await send("/api/bench-runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  return benchRunDetailSchema.parse(await response.json());
}

export async function deleteBenchRun(id: number): Promise<void> {
  await send(`/api/bench-runs/${id}`, { method: "DELETE" });
}
