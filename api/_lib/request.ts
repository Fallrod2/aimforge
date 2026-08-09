/**
 * Le préambule commun des fonctions de comptes liés : réponse JSON, identité
 * de l'appelant, lecture du corps.
 *
 * Les trois fonctions (`valorant/link`, `valorant/refresh`, `kovaaks/import`)
 * partagent exactement la même entrée en matière — vérifier le jeton, monter un
 * client Supabase qui parle **sous l'identité de l'appelant**, valider le corps.
 * Écrire ces trente lignes trois fois, c'est se garantir qu'un jour l'une des
 * trois vérifiera un peu moins bien que les deux autres.
 *
 * Le point non négociable : le client rendu ici porte le JWT de l'appelant, pas
 * la service key. La RLS s'applique donc à ces fonctions exactement comme au
 * navigateur — une fonction qui se tromperait d'identifiant se ferait refuser
 * par la base, et non par sa propre prudence. Aucune des trois fonctions n'a
 * besoin de la service key, et aucune ne la lit.
 *
 * Le préfixe `_` sort ce fichier du routage Vercel : il est importé, jamais
 * appelé en HTTP.
 *
 * Note d'exécution, vérifiée et non devinée : les fonctions qui consomment ce
 * module s'exportent en **`export async function POST(request: Request)`**, et
 * non en export par défaut. C'est la forme sur laquelle le runtime Node de
 * Vercel bascule en gestionnaires Web ; avec un export par défaut, il appelle
 * la fonction à la mode Node (`req`, `res`) et `request.headers.get` n'existe
 * pas. Le refus des autres verbes est du même coup gratuit : le routeur ne
 * dirige vers la fonction que les méthodes qu'elle exporte.
 */

import { createClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type { Database } from "../../src/client/supabase/database-types.js";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "../../src/shared/supabase-config.js";

export type UserClient = ReturnType<typeof createClient<Database>>;

const JSON_HEADERS: Readonly<Record<string, string>> = {
  "content-type": "application/json; charset=utf-8",
  // Ces réponses décrivent le compte d'une personne : aucun intermédiaire ne
  // les garde.
  "cache-control": "no-store",
};

export function json(
  body: unknown,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } });
}

export function fail(error: string, status: number, headers?: Record<string, string>): Response {
  return json({ error }, status, headers);
}

/* ------------------------------------------------------------------ */
/* Identité                                                            */
/* ------------------------------------------------------------------ */

export type Authenticated =
  | { readonly ok: true; readonly userId: string; readonly client: UserClient }
  | { readonly ok: false; readonly response: Response };

/**
 * Vérifie le jeton et monte le client Supabase de l'appelant.
 *
 * L'ordre est délibéré : l'identité passe **avant** toute vérification de
 * configuration. Un appel sans jeton doit être refusé même quand la clé
 * HenrikDev n'est pas posée — sinon la fonction annoncerait son état de
 * configuration à n'importe qui.
 */
export async function authenticate(request: Request): Promise<Authenticated> {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "";

  if (token === "") {
    return { ok: false, response: fail("Authentification requise : reconnecte-toi.", 401) };
  }

  const client = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await client.auth.getUser(token);
  const user = data?.user ?? null;

  if (error !== null || user === null) {
    return { ok: false, response: fail("Session invalide ou expirée : reconnecte-toi.", 401) };
  }
  return { ok: true, userId: user.id, client };
}

/* ------------------------------------------------------------------ */
/* Corps de requête                                                    */
/* ------------------------------------------------------------------ */

export type Parsed<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly response: Response };

/**
 * Lit et valide le corps JSON.
 *
 * `invalid` porte le message métier : « Riot ID incomplet » vaut mieux que
 * « corps invalide » pour quelqu'un qui a mal tapé son tag, et ces fonctions
 * sont appelables directement, sans passer par le formulaire.
 */
export async function readBody<T extends z.ZodType>(
  request: Request,
  schema: T,
  invalid: string,
): Promise<Parsed<z.infer<T>>> {
  let raw: unknown;

  try {
    raw = JSON.parse(await request.text());
  } catch {
    return { ok: false, response: fail("Corps de requête illisible : JSON attendu.", 400) };
  }

  const parsed = schema.safeParse(raw);

  if (!parsed.success) return { ok: false, response: fail(invalid, 400) };
  return { ok: true, value: parsed.data };
}
