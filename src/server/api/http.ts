/**
 * Helpers HTTP partagés : lecture de corps JSON, réponses d'erreur uniformes,
 * et validation Zod des sorties.
 *
 * Forme d'erreur unique : `{ error: string }`, plus `issues` quand l'échec
 * vient d'un schéma Zod.
 */

import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";

/** Corps JSON lu, ou échec de parsing (corps absent ou mal formé). */
export type JsonBody = { readonly ok: true; readonly value: unknown } | { readonly ok: false };

export async function readJsonBody(c: Context): Promise<JsonBody> {
  try {
    return { ok: true, value: await c.req.json() };
  } catch {
    return { ok: false };
  }
}

export function badRequest(c: Context, message: string, error?: z.ZodError): Response {
  return error
    ? c.json({ error: message, issues: error.issues }, 400)
    : c.json({ error: message }, 400);
}

export function notFound(c: Context, message: string): Response {
  return c.json({ error: message }, 404);
}

/**
 * Sérialise `value` après l'avoir validé contre son schéma de sortie.
 * Un échec ici est un bug serveur : l'exception remonte au `onError` (500).
 */
export function jsonOut<T>(
  c: Context,
  schema: z.ZodType<T>,
  value: unknown,
  status: ContentfulStatusCode = 200,
): Response {
  return c.json(schema.parse(value), status);
}
