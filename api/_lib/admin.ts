/**
 * La garde des fonctions `api/admin/*` (SPEC §5 quater).
 *
 * Une seule règle, et elle est plus stricte que partout ailleurs dans le
 * projet : **tout ce qui n'est pas un administrateur prouvé reçoit 404.** Pas
 * 401, pas 403 — 404, le même corps et le même statut qu'une route qui
 * n'existe pas.
 *
 * Pourquoi ce n'est pas de la coquetterie : 403 répond « cette surface existe,
 * tu n'y as pas droit », et cette phrase est une information. Elle dit qu'il y
 * a un panneau d'administration, donc qu'il y a des clés de plateforme
 * derrière, donc qu'il y a une cible. 404 ne dit rien du tout — et un
 * utilisateur légitime ne rencontre jamais ce cas, puisque l'entrée n'apparaît
 * pas dans son interface. Le coût est nul, le gain est de ne pas se signaler.
 *
 * Trois choses peuvent manquer, et les trois donnent le même 404 : le jeton,
 * la service key (sans elle, on ne peut pas vérifier — et une habilitation
 * qu'on ne sait pas établir n'en est pas une), la ligne dans
 * `platform_admins`. Le journal de la fonction, lui, distingue les trois.
 *
 * Ce que la garde rend en cas de succès : les **deux** clients. Le client de
 * service pour ce que seule la service key peut faire (relire la présence des
 * clés, agréger l'usage de tout le monde), et le client de l'appelant pour les
 * écritures — que les policies admin-only de la migration 0009 revérifient
 * alors en base. C'est le même partage qu'en `api/ai-settings` : la RLS fait la
 * police, pas la prudence de notre code.
 *
 * Le préfixe `_` sort ce fichier du routage Vercel : il est importé, jamais
 * appelé en HTTP.
 */

import { adminVerdict } from "../../src/server/platform/admin.js";
import { isPlatformAdmin } from "./platform-settings.js";
import { authenticate, fail, type UserClient } from "./request.js";
import { type ServiceClient, serviceClient } from "./service.js";

export type AdminContext =
  | {
      readonly ok: true;
      readonly userId: string;
      /** Le JWT de l'appelant : les écritures passent par lui, sous RLS. */
      readonly client: UserClient;
      /** La service key : les lectures que la RLS interdit, par construction. */
      readonly service: ServiceClient;
    }
  | { readonly ok: false; readonly response: Response };

export async function requireAdmin(request: Request): Promise<AdminContext> {
  const auth = await authenticate(request);
  const service = serviceClient();

  // La décision elle-même vit dans un module pur
  // (`src/server/platform/admin.ts`) : les trois façons d'échouer doivent
  // rendre exactement la même chose, et c'est une propriété qui se teste — ce
  // qu'on ne saurait pas faire ici, entre un jeton à vérifier et un client
  // Supabase à monter.
  const verdict = await adminVerdict({
    authenticated: auth.ok,
    serviceAvailable: service !== null,
    lookup: async () =>
      auth.ok && service !== null && (await isPlatformAdmin(service, auth.userId)),
  });

  if (!verdict.ok) {
    // La raison reste dans le journal de la fonction : c'est là qu'elle sert.
    console.warn("[admin] accès refusé", verdict.reason);
    return { ok: false, response: fail(verdict.message, verdict.status) };
  }

  // `verdict.ok` implique les deux vérifications ci-dessus ; TypeScript ne sait
  // pas lire cette promesse, d'où ce dernier filet — qui n'arrive jamais.
  if (!auth.ok || service === null) {
    return { ok: false, response: fail("Ressource introuvable.", 404) };
  }
  return { ok: true, userId: auth.userId, client: auth.client, service };
}
