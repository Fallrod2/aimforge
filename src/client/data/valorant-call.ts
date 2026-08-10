/**
 * L'appel des fonctions `/api/valorant/*` enrichies (SPEC §5 sexies, V1) : le
 * jeton joint à la main, la réponse validée par le contrat partagé.
 *
 * C'est le même patron que `linked-accounts.ts` et `admin.ts`, et il est
 * recopié plutôt qu'importé pour une raison précise : chacun de ces modules
 * porte **son** type d'erreur, et c'est ce type qui dit à l'écran quoi faire
 * d'un 404 ou d'un 503. Partager la mécanique obligerait à partager la
 * sémantique, et un jour un 404 « pas déployé » se retrouverait affiché comme
 * un 404 « partie inconnue ».
 *
 * Ce module ne fait rien d'autre : ni état, ni cache, ni React. Les deux
 * appels réels vivent dans `valorant-match.ts` et `valorant-stats.ts`.
 */

import type { z } from "zod";
import { valorantErrorSchema } from "../../shared/valorant-contract";
import { supabase } from "../supabase/client";
import { NO_SESSION_MESSAGE } from "./errors";

/** Échec d'un appel Valorant, porteur d'un message destiné à l'écran. */
export class ValorantError extends Error {
  override readonly name = "ValorantError";
  /** Statut HTTP, ou `0` si la requête n'a jamais abouti. */
  readonly status: number;

  constructor(message: string, status: number, cause?: unknown) {
    super(message, { cause });
    this.status = status;
  }

  /** La clé de la source n'est pas posée : rien à réessayer, rien à corriger. */
  get notConfigured(): boolean {
    return this.status === 503;
  }

  /** La partie demandée n'est pas dans les matchs importés de l'appelant. */
  get notFound(): boolean {
    return this.status === 404;
  }

  /** La source a demandé de lever le pied. */
  get rateLimited(): boolean {
    return this.status === 429;
  }
}

const OFFLINE = "Service injoignable : vérifie ta connexion, puis réessaie.";

const NOT_DEPLOYED =
  "Cette fonctionnalité n'est pas servie ici : les fonctions `/api/**` sont absentes. En local, lance `bunx vercel dev` plutôt que `bun dev`.";

const UNEXPECTED = "Réponse inattendue du service. Réessaie dans un instant.";

/** Le message d'un échec HTTP : celui de la fonction si elle en a donné un. */
function errorMessage(status: number, body: string): string {
  try {
    const parsed = valorantErrorSchema.safeParse(JSON.parse(body));

    if (parsed.success) return parsed.data.error;
  } catch {
    // Corps non-JSON : le 404 servi par Vite en développement, ou une page
    // d'erreur de plateforme. Traité juste en dessous.
  }
  return status === 404 ? NOT_DEPLOYED : UNEXPECTED;
}

/**
 * Un appel à une fonction Valorant, avec le JWT joint et la réponse validée.
 *
 * `payload` absent ⇒ `GET` : c'est la distinction que font les deux surfaces —
 * `stats` est une lecture, `match` déclenche potentiellement un appel sortant.
 */
export async function callValorant<T extends z.ZodType>(
  path: string,
  schema: T,
  payload?: unknown,
): Promise<z.infer<T>> {
  const { data, error } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (error !== null || token === undefined) {
    throw new ValorantError(NO_SESSION_MESSAGE, 401, error);
  }

  let response: Response;

  try {
    response = await fetch(path, {
      method: payload === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${token}`,
        ...(payload === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
  } catch (cause) {
    throw new ValorantError(OFFLINE, 0, cause);
  }

  const body = await response.text();

  if (!response.ok) {
    throw new ValorantError(errorMessage(response.status, body), response.status);
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(body);
  } catch (cause) {
    throw new ValorantError(UNEXPECTED, response.status, cause);
  }

  const validated = schema.safeParse(parsed);

  if (!validated.success) {
    throw new ValorantError(UNEXPECTED, response.status, validated.error);
  }
  return validated.data;
}
