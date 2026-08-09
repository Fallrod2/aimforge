/**
 * Le jeton opaque qui porte une liaison ChatGPT en cours (SPEC §5 ter).
 *
 * Le problème qu'il résout est bête et sans solution élégante autrement :
 * `link_start` et `link_poll` sont deux requêtes HTTP, donc potentiellement
 * **deux instances serverless différentes**. L'identifiant de la demande
 * d'autorisation (`device_auth_id`) ne peut donc pas rester en mémoire, et il
 * ne mérite pas une table — il vit quinze minutes et ne survit à rien.
 *
 * Il fait donc l'aller-retour par le navigateur, **scellé** : un JSON encodé en
 * base64url, suivi de son HMAC-SHA256. Ce n'est pas du chiffrement, et ce n'est
 * pas un oubli — le code utilisateur qu'il contient est déjà affiché à l'écran.
 * Ce qu'on protège, c'est l'**intégrité** et surtout la **liaison à son
 * demandeur** : le jeton porte l'`user_id` de celui qui a lancé le flux, et
 * `openHandle` refuse de l'ouvrir pour quelqu'un d'autre. Sans cela, un jeton
 * intercepté permettrait d'attacher les jetons ChatGPT d'une personne au compte
 * AimForge d'une autre.
 *
 * Module **pur** : la clé de signature est un paramètre, jamais une lecture
 * d'environnement. C'est ce qui rend le scellement testable — et ce qui évite
 * qu'un module bas niveau décide seul de sa propre configuration.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { DEVICE_EXPIRES_IN_SECONDS } from "./codex-oauth.js";

/** Ce que le jeton transporte. Rien de secret, mais rien de modifiable non plus. */
interface HandlePayload {
  readonly deviceAuthId: string;
  readonly userCode: string;
  readonly userId: string;
  /** Échéance en millisecondes epoch : au-delà, il faut recommencer. */
  readonly exp: number;
}

/** Ce qu'on retrouve en ouvrant un jeton valide. */
export interface OpenedHandle {
  readonly deviceAuthId: string;
  readonly userCode: string;
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

/** Scelle la demande en cours pour son demandeur. */
export function sealHandle(
  payload: { readonly deviceAuthId: string; readonly userCode: string; readonly userId: string },
  secret: string,
  now: number = Date.now(),
): string {
  const content: HandlePayload = {
    ...payload,
    exp: now + DEVICE_EXPIRES_IN_SECONDS * 1000,
  };
  const body = Buffer.from(JSON.stringify(content), "utf8").toString("base64url");

  return `${body}.${sign(body, secret)}`;
}

/**
 * Ouvre un jeton **pour cet utilisateur**. Rend `null` dès que quelque chose
 * cloche — signature, propriétaire, échéance — et l'appelant traite les trois
 * pareil : « la demande n'est plus valable, recommence ». Distinguer les cas
 * dans la réponse renseignerait un attaquant sans aider personne.
 */
export function openHandle(
  handle: string,
  userId: string,
  secret: string,
  now: number = Date.now(),
): OpenedHandle | null {
  const separator = handle.indexOf(".");

  if (separator <= 0) return null;

  const body = handle.slice(0, separator);
  const mac = Buffer.from(handle.slice(separator + 1), "utf8");
  const expected = Buffer.from(sign(body, secret), "utf8");

  // Comparaison à temps constant : la signature se compare comme un secret,
  // même quand ce qu'elle protège n'en est pas un.
  if (mac.length !== expected.length || !timingSafeEqual(mac, expected)) return null;

  let payload: HandlePayload;

  try {
    const parsed: unknown = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));

    if (parsed === null || typeof parsed !== "object") return null;
    payload = parsed as HandlePayload;
  } catch {
    return null;
  }

  if (payload.userId !== userId) return null;
  if (typeof payload.exp !== "number" || payload.exp < now) return null;
  if (typeof payload.deviceAuthId !== "string" || payload.deviceAuthId === "") return null;
  if (typeof payload.userCode !== "string" || payload.userCode === "") return null;

  return { deviceAuthId: payload.deviceAuthId, userCode: payload.userCode };
}

/**
 * La clé de signature du processus courant, faute de mieux.
 *
 * Tirée au sort **une fois par instance** : un jeton scellé avec elle ne
 * s'ouvrira pas ailleurs, et l'utilisateur lira « la demande a expiré,
 * recommence ». C'est un repli honnête — dégradé mais jamais faux — là où une
 * constante écrite en dur aurait été un secret public, donc un scellement pour
 * de faux.
 */
const PROCESS_SECRET = randomBytes(32).toString("base64url");

/**
 * La clé de signature à utiliser, dans l'ordre : celle qu'on a posée pour ça,
 * puis la clé de service (présente dans toute fonction qui sert ce flux en
 * production), puis le repli de processus ci-dessus.
 *
 * Réutiliser la clé de service comme clé HMAC ne l'expose pas : un HMAC ne
 * laisse rien deviner de sa clé. Ce qu'on gagne est concret — le flux
 * fonctionne en production sans variable supplémentaire à poser.
 */
export function linkSecret(env: Record<string, string | undefined>): string {
  const explicit = (env.AI_LINK_SECRET ?? "").trim();

  if (explicit !== "") return explicit;

  const service = (env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();

  return service === "" ? PROCESS_SECRET : service;
}
